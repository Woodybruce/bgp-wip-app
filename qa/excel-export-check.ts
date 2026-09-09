// r627: export_to_excel is the only door a spreadsheet leaves the app through,
// and it was a comps-table dumper being asked to carry financial models.
// Before the fix: cellText() coerced every cell to a string, so a formula could
// never survive (a real workbook arrived with =IRR/=SUMIF/=B2*B3 as inert
// text); a merged title row pushed headers to row 2 and data to row 3 while the
// schema described a plain headers+rows grid, so every reference the model
// wrote was one row short; and the number format keyed off the COLUMN HEADER,
// so a label/value sheet headed "Value" formatted an exit yield of 0.068 as
// "£0". Direct module access — the LLM cannot be driven in the keyless QA env.
import { pool } from "../server/db";

let failures = 0;
function ok(name: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

async function main() {
  const { executeCrmToolRaw } = await import("../server/chatbgp");
  const u = await pool.query(`SELECT id FROM users WHERE email = $1`, ['victoria@brucegillinghampollard.com']);
  if (!u.rows[0]) throw new Error('victoria fixture user missing');
  const req: any = { session: { userId: u.rows[0].id } };

  // Shaped like the appraisal workbook the tool is actually asked for: a
  // cashflow with live formulas and a label/value assumptions sheet. Every
  // reference below is written the way the schema reads — headers row 1,
  // first data row row 2.
  const args = {
    filename: "qa_excel_export_check",
    sheets: [
      {
        name: "Asset Schedule",
        headers: ["Site", "Sq Ft", "Rent PSF", "Gross Rent"],
        rows: [
          ["Bluewater Unit 12", "2400", "45", "=B2*C2"],
          ["Bluewater Unit 14", "1800", "52", "=B3*C3"],
          ["TOTAL", "=SUM(B2:B3)", "", { formula: "=SUM(D2:D3)" }],
        ],
      },
      {
        name: "Assumptions",
        headers: ["Metric", "Value", "Notes"],
        rows: [
          ["Exit yield", "0.068", "6.8% NIY"],
          ["Rental growth", { value: 0.1, numFmt: "0.0%" }, "10% over hold"],
          ["Purchase price", "18500000", "Gross"],
          ["Ungeared IRR", "=IRR('Asset Schedule'!B2:D2)", "Five-year hold"],
        ],
      },
    ],
  };

  const res: any = await executeCrmToolRaw('export_to_excel', args, req);
  ok('export_to_excel returns a download link', !!res?.data?.downloadUrl, res?.data?.error || '');
  const fname = String(res.data.downloadUrl).split('/').pop();

  const { getFile } = await import('../server/file-storage');
  const stored = await getFile(`chat-media/${fname}`);
  ok('workbook landed in chat-media storage', !!stored);
  if (!stored) return;

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(stored.data as any);

  const asset = wb.getWorksheet('Asset Schedule')!;
  const assume = wb.getWorksheet('Assumptions')!;
  ok('both sheets present', !!asset && !!assume);
  if (!asset || !assume) return;

  const isFormula = (c: any) => !!(c && typeof c.value === 'object' && c.value && 'formula' in c.value);
  const formulaOf = (c: any) => (isFormula(c) ? String((c.value as any).formula) : null);

  // 1. LAYOUT — headers on row 1, first data row on row 2, no merged title bar.
  ok('headers land on ROW 1', asset.getCell('A1').value === 'Site' && asset.getCell('D1').value === 'Gross Rent',
    `A1=${JSON.stringify(asset.getCell('A1').value)}`);
  ok('first data row lands on ROW 2', asset.getCell('A2').value === 'Bluewater Unit 12',
    `A2=${JSON.stringify(asset.getCell('A2').value)}`);
  ok('no merged title row above the headers', (asset as any).model?.merges?.length ? false : true,
    JSON.stringify((asset as any).model?.merges || []));

  // 2. FORMULAS — plain "=..." strings AND {formula} objects both go in live.
  ok('plain "=B2*C2" string is a LIVE formula', formulaOf(asset.getCell('D2')) === 'B2*C2',
    JSON.stringify(asset.getCell('D2').value));
  ok('"=SUM(...)" string is a LIVE formula', formulaOf(asset.getCell('B4')) === 'SUM(B2:B3)',
    JSON.stringify(asset.getCell('B4').value));
  ok('{formula:"=SUM(...)"} typed cell is a LIVE formula', formulaOf(asset.getCell('D4')) === 'SUM(D2:D3)',
    JSON.stringify(asset.getCell('D4').value));
  ok('cross-sheet =IRR(...) is a LIVE formula', formulaOf(assume.getCell('B5')) === "IRR('Asset Schedule'!B2:D2)",
    JSON.stringify(assume.getCell('B5').value));

  // 3. FORMULA REFERENCES point at the rows the schema promised.
  const grossRent = formulaOf(asset.getCell('D2'));
  ok('a first-data-row formula references row 2, not row 3', grossRent === 'B2*C2', String(grossRent));

  // 4. NUMBER FORMATS must never swallow the number.
  ok('a fraction under a "Value" header is NOT formatted as £ (0.068 showed "£0")',
    assume.getCell('B2').value === 0.068 && !/£/.test(assume.getCell('B2').numFmt || ''),
    `value=${assume.getCell('B2').value} numFmt=${assume.getCell('B2').numFmt || '(none)'}`);
  ok('an explicit numFmt on a typed cell is honoured',
    assume.getCell('B3').value === 0.1 && assume.getCell('B3').numFmt === '0.0%',
    `numFmt=${assume.getCell('B3').numFmt || '(none)'}`);
  ok('a real money figure under "Value" still formats as £',
    assume.getCell('B4').value === 18500000 && /£/.test(assume.getCell('B4').numFmt || ''),
    `numFmt=${assume.getCell('B4').numFmt || '(none)'}`);

  // 5. Plain numeric text still becomes a number (the original behaviour).
  ok('numeric strings still land as numbers', asset.getCell('B2').value === 2400,
    JSON.stringify(asset.getCell('B2').value));

  console.log(failures === 0 ? 'excel-export-check: all green' : `excel-export-check: ${failures} failure(s)`);
}

main()
  .then(async () => { await pool.end().catch(() => {}); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
