// Proof for the two spreadsheet fixes Woody reported on 2026-09-09.
//
// 1. ChatBGP's export_to_excel must write "=..." cells as LIVE formulas.
//    Before the fix every one landed as literal text, so a generated model
//    showed "=IRR(...)" in the cell and calculated nothing.
// 2. The Pathway model builder's DSCR / Interest Cover must divide the NOI
//    row, not Cash Flow row 6 (the "GROSS INCOME" section banner), and the
//    workbook must carry fullCalcOnLoad so readers that don't recalculate
//    for themselves still show numbers.
//
// Run: DATABASE_URL=… npx tsx qa/r628-excel-formula-probe.ts
import { pool } from "../server/db";

const FAIL: string[] = [];
function check(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) FAIL.push(label);
}

async function probeExportToExcel() {
  console.log("\n── export_to_excel: live formulas ──");
  const { executeCrmToolRaw } = await import("../server/chatbgp");
  const { getFile, deleteFile } = await import("../server/file-storage");
  const u = await pool.query(`SELECT id FROM users WHERE email = $1`, ["victoria@brucegillinghampollard.com"]);
  const req: any = { session: { userId: u.rows[0]?.id } };

  const res = await executeCrmToolRaw(
    "export_to_excel",
    {
      filename: "QA_r628_Formula_Probe",
      sheets: [
        {
          name: "Assumptions",
          headers: ["Input", "Value", "Notes"],
          // Data starts on row 3 (row 1 title, row 2 headers) — the tool
          // description now states this, so the references below are correct.
          rows: [
            ["Purchase price", "1000000", "INPUT"],
            ["Acquisition costs %", "0.05", "INPUT"],
            ["Acquisition costs", "=C3*C4", "Calculated"],
            ["Total cost", "=C3+C5", "Calculated"],
          ],
        },
        {
          name: "Returns",
          headers: ["Metric", "Value", "Notes"],
          rows: [
            ["Total cost", "=Assumptions!C6", "Cross-sheet"],
            ["Yield on cost", "=50000/Assumptions!C6", "Live"],
          ],
        },
      ],
    },
    req,
  );

  check(res?.data?.success === true, "tool returned success", JSON.stringify(res?.data?.message || res?.data?.error || ""));
  const url: string = res?.data?.downloadUrl || "";
  const key = url.replace("/api/chat-media/", "");
  check(!!key, "download key returned", key);

  const stored = await getFile(`chat-media/${key}`);
  const buf: Buffer | undefined = (stored as any)?.buffer ?? (stored as any)?.data ?? (Buffer.isBuffer(stored) ? stored : undefined);
  check(!!buf, "stored workbook readable", buf ? `${buf.length} bytes` : "not found");
  if (!buf) return;

  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(buf);
  const entry = (name: string) => zip.getEntry(name)?.getData().toString("utf8") || "";
  const s1 = entry("xl/worksheets/sheet1.xml");
  const s2 = entry("xl/worksheets/sheet2.xml");
  const book = entry("xl/workbook.xml");

  const fCount = (s1.match(/<f>/g) || []).length + (s2.match(/<f>/g) || []).length;
  check(fCount === 4, "all four formula cells are real formula records", `<f> count = ${fCount}`);
  check(s1.includes("<f>C3*C4</f>"), "acquisition costs is a formula, not text");
  check(s1.includes("<f>C3+C5</f>"), "total cost is a formula");
  check(s2.includes("Assumptions!C6"), "cross-sheet reference survived");

  // The failure mode we are guarding: a formula stored as a shared string.
  const shared = entry("xl/sharedStrings.xml");
  check(!/=\s*C3\*C4/.test(shared), "no formula leaked into sharedStrings as text");
  check(/fullCalcOnLoad="1"/.test(book), "workbook asks Excel to calculate on open");

  await deleteFile(`chat-media/${key}`).catch(() => {});
}

async function probePathwayModel() {
  console.log("\n── Pathway model: DSCR reads NOI, not a section header ──");
  const { buildInvestmentModel } = await import("../server/excel-builder");
  const buf = await buildInvestmentModel({ modelName: "QA r628 Probe", assumptions: {}, quarters: 20 } as any);
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(buf);
  const names = zip.getEntries().map((e) => e.entryName);
  const book = zip.getEntry("xl/workbook.xml")!.getData().toString("utf8");
  check(/fullCalcOnLoad="1"/.test(book), "workbook asks Excel to calculate on open");

  // Find the Cash Flow and Debt Schedule sheets by their workbook order.
  const order = [...book.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="rId(\d+)"/g)].map((m) => m[1]);
  const rels = zip.getEntry("xl/_rels/workbook.xml.rels")!.getData().toString("utf8");
  const sheetFile = (sheetName: string) => {
    const m = book.match(new RegExp(`<sheet[^>]*name="${sheetName}"[^>]*r:id="(rId\\d+)"`));
    if (!m) return "";
    const rel = rels.match(new RegExp(`Id="${m[1]}"[^>]*Target="([^"]+)"`));
    return rel ? `xl/${rel[1].replace(/^\/?xl\//, "")}` : "";
  };
  const cfFile = sheetFile("Cash Flow");
  const dsFile = sheetFile("Debt Schedule");
  check(!!cfFile && !!dsFile, "found both sheets", `${cfFile} / ${dsFile} of ${names.length} entries`);
  const cf = zip.getEntry(cfFile)!.getData().toString("utf8");
  const ds = zip.getEntry(dsFile)!.getData().toString("utf8");

  // Which Cash Flow row is NOI? Locate the label cell in column B.
  const ss = zip.getEntry("xl/sharedStrings.xml")!.getData().toString("utf8");
  const strings = [...ss.matchAll(/<si>(?:<t[^>]*>|<r>.*?<t[^>]*>)(.*?)<\/t>/gs)].map((m) => m[1]);
  const noiIdx = strings.findIndex((s) => s === "Net Operating Income (NOI)");
  check(noiIdx >= 0, "found the NOI label in sharedStrings", `index ${noiIdx}`);
  const noiCell = cf.match(new RegExp(`<c r="B(\\d+)"[^>]*t="s"[^>]*><v>${noiIdx}</v></c>`));
  const noiRow = noiCell ? Number(noiCell[1]) : -1;
  check(noiRow > 6, "NOI is not on row 6", `NOI is row ${noiRow}`);

  // Sheet XML escapes the apostrophes in a quoted sheet name, so match both
  // forms — matching only the raw one finds nothing and every assertion below
  // it then passes vacuously.
  const refs = [...ds.matchAll(/(?:'|&apos;)Cash Flow(?:'|&apos;)!([A-Z]+)(\d+)/g)].map((m) => Number(m[2]));
  check(refs.length >= 2 * 20, "Debt Schedule references Cash Flow on every quarter", `${refs.length} refs (expect 40: DSCR + ICR x 20 quarters)`);
  check(
    refs.every((row) => row === noiRow),
    "every DSCR / ICR reference points at the NOI row",
    `rows referenced: ${[...new Set(refs)].join(", ")} (NOI is ${noiRow})`,
  );
  check(!refs.includes(6), "no reference to row 6, the GROSS INCOME banner");
}

async function main() {
  await probeExportToExcel();
  await probePathwayModel();
  console.log(`\n── r628 excel probe: ${FAIL.length ? `${FAIL.length} FAILURE(S): ${FAIL.join("; ")}` : "all green"} ──`);
  await pool.end();
  process.exit(FAIL.length ? 1 : 0);
}

main().catch((err) => {
  console.error("[r628 probe] crashed:", err?.message || err);
  process.exit(2);
});
