// r628: the comps board's OWN "Export" button — a SECOND spreadsheet exporter,
// entirely separate from ChatBGP's export_to_excel, that nobody had looked at.
// It disagreed with the board it exports: the board's headline green "Net
// Effective" column is the SERVER devaluation attached to every
// /api/crm/comps row, while the CSV only carried the separate hand-typed
// `netEffectiveRent`, so a devalued comp exported a BLANK Net Effective. The
// on-screen "Net psf" column was missing from the file entirely, and `|| ""`
// turned a recorded 0 into an empty cell.
// Asserts the export against the SAME devalueComp the board renders.
import { devalueComp } from "../server/comp-devalue";
import { compsCsv, COMPS_CSV_HEADERS } from "../shared/comps-csv";

let failures = 0;
function ok(name: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

// A real leasing package the board CAN devalue, with nothing typed into the
// manual netEffectiveRent field — the normal state of a comp.
const pkg = {
  name: "88 Regent Street W1",
  tenant: "Café Nero",
  areaLocation: "Regent Street",
  headlineRent: "£185,000 pa",
  term: "10 years",
  breakClause: "5",
  rentFreeMonths: "12",
  fitoutContribution: "0",
  niaSqft: "2400",
  effectiveRatePsf: "60.00",
  netEffectiveRent: null as string | null,
  verified: true,
  comments: 'He said "fine", then went quiet',
};

function main() {
  const dv = devalueComp(pkg as any);
  ok("the board can devalue this package at all (else the check is vacuous)",
    !!dv && dv.netEffectiveRentPa > 0, dv ? `£${Math.round(dv.netEffectiveRentPa)} pa` : "null");
  if (!dv) { process.exit(1); }

  const csv = compsCsv([{ ...pkg, devaluation: dv } as any]);
  const lines = csv.replace(/^﻿/, "").split("\n");
  const head = (lines[0].match(/"(?:[^"]|"")*"/g) || []).map(h => h.slice(1, -1).replace(/""/g, '"'));
  const cells = (lines[1].match(/"(?:[^"]|"")*"/g) || []).map(c => c.slice(1, -1).replace(/""/g, '"'));
  const at = (h: string) => {
    const i = head.indexOf(h);
    return i < 0 ? undefined : cells[i];
  };

  ok("header and row have the same width", head.length === cells.length, `${head.length} vs ${cells.length}`);

  // THE BUG: the board shows a devalued Net Effective, the file shipped blank.
  const paCol = "Net Effective Rent (devalued £ pa)";
  ok(`the file carries the board's devalued Net Effective (£ pa)`,
    at(paCol) === String(Math.round(dv.netEffectiveRentPa)),
    `csv="${at(paCol)}" board="${Math.round(dv.netEffectiveRentPa)}"`);
  const psfCol = "Net Effective Rent (devalued £ psf)";
  ok("the file carries the board's devalued Net Effective (£ psf)",
    dv.netEffectiveRentPsf != null && at(psfCol) === String(dv.netEffectiveRentPsf),
    `csv="${at(psfCol)}" board="${dv.netEffectiveRentPsf}"`);
  ok("the devalued figure is NOT the untouched headline rent",
    Math.round(dv.netEffectiveRentPa) !== 185000, `£${Math.round(dv.netEffectiveRentPa)} pa`);

  // The on-screen "Net psf" column existed nowhere in the old file.
  ok("the on-screen Net psf column is in the file",
    at("Net Effective Rate (psf)") === "60.00", `"${at("Net Effective Rate (psf)")}"`);

  // Not a found bug — every comp column is TEXT, so the old `|| ""` only ever
  // saw strings and "0" is truthy. But the two devalued columns are the first
  // NUMBERS this file carries, and a numeric 0 under `|| ""` would export as
  // an empty cell, so the cell writer is pinned.
  const zero = compsCsv([{ ...pkg, devaluation: { netEffectiveRentPa: 0, netEffectiveRentPsf: 0 } } as any]);
  const zeroCells = (zero.split("\n")[1].match(/"(?:[^"]|"")*"/g) || []).map(c => c.slice(1, -1));
  ok("a numeric 0 in a devalued column exports as 0, not blank",
    zeroCells[head.indexOf("Net Effective Rent (devalued £ psf)")] === "0",
    `"${zeroCells[head.indexOf("Net Effective Rent (devalued £ psf)")]}"`);

  // The manual field stays its own column — the two numbers are different facts.
  ok("the hand-typed Net Effective Rent keeps its own column",
    COMPS_CSV_HEADERS.includes("Net Effective Rent") && at("Net Effective Rent") === "",
    `"${at("Net Effective Rent")}"`);

  ok("quotes inside a comment are escaped, not broken out of",
    at("Comments") === 'He said "fine", then went quiet', `"${at("Comments")}"`);
  ok("Excel is told the file is UTF-8 (a BOM), so Café Nero is not CafÃ©",
    csv.charCodeAt(0) === 0xfeff && at("Tenant") === "Café Nero", `tenant="${at("Tenant")}"`);
  ok("Verified renders as a word", at("Verified") === "Yes", `"${at("Verified")}"`);

  console.log(failures === 0 ? "  comps-csv-check: all green" : `  comps-csv-check: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
