import ExcelJS from "exceljs";

const MINE = "docs/unit-column-ownership.xlsx";
const THEIRS = "/root/.claude/uploads/f939dbdb-7d3d-50a9-b5a1-f8c321c4e23e/7c96d797-08062026_unitcolumnownership_1.xlsx";

type Row = {
  section: string;
  fact: string;
  grain: string;
  owner: string;
  tenancy: string;
  tracker: string;
  leasing: string;
  deals: string;
  clientPage: string;
  onSchedule: string;
  notes: string;
};

async function load(path: string, droppedClientPage = false): Promise<{ sheets: string[]; rows: Row[]; headers: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheets = wb.worksheets.map((w) => w.name);
  const ws = wb.worksheets[0];
  const headers: string[] = [];
  ws.getRow(1).eachCell((c) => headers.push(String(c.value ?? "").trim()));
  const rows: Row[] = [];
  let lastSection = "";
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const v = (i: number) => String(r.getCell(i).value ?? "").trim();
    const section = v(1) || lastSection;
    if (v(1)) lastSection = v(1);
    // Their file dropped the "Client Property Page" column entirely,
    // so columns 9 and 10 are onSchedule + notes (mine had 9=clientPage,
    // 10=onSchedule, 11=notes). Map accordingly.
    const onScheduleCol = droppedClientPage ? 9  : 10;
    const notesCol      = droppedClientPage ? 10 : 11;
    rows.push({
      section,
      fact: v(2),
      grain: v(3),
      owner: v(4),
      tenancy: v(5),
      tracker: v(6),
      leasing: v(7),
      deals: v(8),
      clientPage: droppedClientPage ? "" : v(9),
      onSchedule: v(onScheduleCol),
      notes: v(notesCol),
    });
  });
  return { sheets, rows, headers };
}

async function main() {
  const mine = await load(MINE, false);
  const theirs = await load(THEIRS, true);

  console.log("=== SHEETS ===");
  console.log("mine:  ", mine.sheets.join(" · "));
  console.log("theirs:", theirs.sheets.join(" · "));

  console.log("\n=== HEADERS ===");
  console.log("mine:  ", mine.headers.join(" | "));
  console.log("theirs:", theirs.headers.join(" | "));

  console.log(`\n=== ROW COUNTS ===  mine=${mine.rows.length}  theirs=${theirs.rows.length}\n`);

  const key = (r: Row) => r.fact.toLowerCase().trim();
  const mineByFact = new Map(mine.rows.map((r) => [key(r), r]));
  const theirsByFact = new Map(theirs.rows.map((r) => [key(r), r]));

  // Added (in theirs not mine)
  const added = theirs.rows.filter((r) => r.fact && !mineByFact.has(key(r)));
  // Removed (in mine not theirs)
  const removed = mine.rows.filter((r) => r.fact && !theirsByFact.has(key(r)));

  console.log("=== FACTS WOODY ADDED (in his file, not mine) ===");
  for (const r of added) {
    console.log(`+ [${r.section}] ${r.fact}`);
    const cols = `    grain="${r.grain}" owner="${r.owner}" tenancy="${r.tenancy}" tracker="${r.tracker}" leasing="${r.leasing}" deals="${r.deals}" clientPage="${r.clientPage}" onSchedule="${r.onSchedule}"`;
    console.log(cols);
    if (r.notes) console.log(`    notes: ${r.notes}`);
  }
  if (added.length === 0) console.log("  (none)");

  console.log("\n=== FACTS WOODY REMOVED (in mine, not his) ===");
  for (const r of removed) console.log(`- [${r.section}] ${r.fact}`);
  if (removed.length === 0) console.log("  (none)");

  console.log("\n=== FACTS PRESENT IN BOTH — CELL DIFFS ===");
  let changed = 0;
  // Drop clientPage from comparison since Woody removed that column
  const fields: (keyof Row)[] = ["section", "grain", "owner", "tenancy", "tracker", "leasing", "deals", "onSchedule", "notes"];
  for (const t of theirs.rows) {
    const m = mineByFact.get(key(t));
    if (!m || !t.fact) continue;
    const diffs: string[] = [];
    for (const f of fields) {
      if (String(m[f]).trim() !== String(t[f]).trim()) {
        diffs.push(`${f}: "${m[f]}" → "${t[f]}"`);
      }
    }
    if (diffs.length) {
      changed++;
      console.log(`~ [${t.section}] ${t.fact}`);
      for (const d of diffs) console.log(`    ${d}`);
    }
  }
  if (changed === 0) console.log("  (no cell changes)");
  console.log(`\nSummary: +${added.length} added · -${removed.length} removed · ~${changed} changed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
