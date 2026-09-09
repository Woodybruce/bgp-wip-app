// r627/r628: export_to_excel is the only door a spreadsheet leaves the app
// through, and it was a comps-table dumper being asked to carry financial
// models. r628 made "=..." strings live formulas and documented the sheet
// layout (title row 1, headers row 2, data from row 3). r627 adds the typed
// cell — {formula} / {value, numFmt} — and stops the header-guessed currency
// format swallowing the number it formats: a label/value sheet headed "Value"
// rendered an exit yield of 0.068 as "£0". This check holds all of it.
// Direct module access — the LLM cannot be driven in the keyless QA env.
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
  // reference is written the way the tool description states the layout —
  // title row 1, headers row 2, first data row row 3.
  const args = {
    filename: "qa_excel_export_check",
    sheets: [
      {
        name: "Asset Schedule",
        headers: ["Site", "Sq Ft", "Rent PSF", "Gross Rent"],
        rows: [
          ["Bluewater Unit 12", "2400", "45", "=B3*C3"],
          ["Bluewater Unit 14", "1800", "52", "=B4*C4"],
          ["TOTAL", "=SUM(B3:B4)", "", { formula: "=SUM(D3:D4)" }],
        ],
      },
      {
        name: "Assumptions",
        headers: ["Metric", "Value", "Notes"],
        rows: [
          ["Exit yield", "0.068", "6.8% NIY"],
          ["Rental growth", { value: 0.1, numFmt: "0.0%" }, "10% over hold"],
          ["Purchase price", "18500000", "Gross"],
          ["Ungeared IRR", "=IRR('Asset Schedule'!B3:D3)", "Five-year hold"],
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

  // 1. LAYOUT — the layout the tool description promises the model.
  ok('row 1 is the merged title bar', asset.getCell('A1').value === 'Asset Schedule',
    `A1=${JSON.stringify(asset.getCell('A1').value)}`);
  ok('headers land on ROW 2', asset.getCell('A2').value === 'Site' && asset.getCell('D2').value === 'Gross Rent',
    `A2=${JSON.stringify(asset.getCell('A2').value)}`);
  ok('first data row lands on ROW 3', asset.getCell('A3').value === 'Bluewater Unit 12',
    `A3=${JSON.stringify(asset.getCell('A3').value)}`);

  // 2. FORMULAS — plain "=..." strings AND {formula} objects both go in live.
  ok('plain "=B3*C3" string is a LIVE formula', formulaOf(asset.getCell('D3')) === 'B3*C3',
    JSON.stringify(asset.getCell('D3').value));
  ok('"=SUM(...)" string is a LIVE formula', formulaOf(asset.getCell('B5')) === 'SUM(B3:B4)',
    JSON.stringify(asset.getCell('B5').value));
  ok('{formula:"=SUM(...)"} typed cell is a LIVE formula', formulaOf(asset.getCell('D5')) === 'SUM(D3:D4)',
    JSON.stringify(asset.getCell('D5').value));
  ok('cross-sheet =IRR(...) is a LIVE formula', formulaOf(assume.getCell('B6')) === "IRR('Asset Schedule'!B3:D3)",
    JSON.stringify(assume.getCell('B6').value));
  // (fullCalcOnLoad is r628's assertion — ExcelJS's own load() does not
  // round-trip calcProperties, so it has to be read out of the raw XML.)

  // 3. NUMBER FORMATS must never swallow the number.
  ok('a fraction under a "Value" header is NOT formatted as £ (0.068 showed "£0")',
    assume.getCell('B3').value === 0.068 && !/£/.test(assume.getCell('B3').numFmt || ''),
    `value=${assume.getCell('B3').value} numFmt=${assume.getCell('B3').numFmt || '(none)'}`);
  ok('an explicit numFmt on a typed cell is honoured',
    assume.getCell('B4').value === 0.1 && assume.getCell('B4').numFmt === '0.0%',
    `numFmt=${assume.getCell('B4').numFmt || '(none)'}`);
  ok('a real money figure under "Value" still formats as £',
    assume.getCell('B5').value === 18500000 && /£/.test(assume.getCell('B5').numFmt || ''),
    `numFmt=${assume.getCell('B5').numFmt || '(none)'}`);

  // 4. Plain numeric text still becomes a number (the original behaviour).
  ok('numeric strings still land as numbers', asset.getCell('B3').value === 2400,
    JSON.stringify(asset.getCell('B3').value));

  console.log(failures === 0 ? 'excel-export-check: all green' : `excel-export-check: ${failures} failure(s)`);
}

main()
  .then(async () => { await pool.end().catch(() => {}); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
