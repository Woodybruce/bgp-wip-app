/**
 * model-automap.test.ts — digest, heuristic and validation tests for the
 * template auto-mapper. AI calls are not exercised here (heuristic path only);
 * the AI prompt output passes through the same validateProposal gate.
 *
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx-js-style";
import { buildWorkbookDigest, heuristicAutoMap, validateProposal } from "./model-automap";

function buildTestWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // Assumptions: labels in col B, constants in col C
  const assumptions = [
    ["", ""],
    ["", "ASSUMPTIONS"],
    ["", "Purchase Price", 10000000],
    ["", "Current Rent (pa)", 500000],
    ["", "Rent Growth (%)", 0.025],
    ["", "LTV (%)", 0.6],
    ["", "Exit Cap Rate (%)", 0.055],
    ["", "Hold Period (yrs)", 5],
    ["", "Acquisition Date", 45839],
    ["", "Amortisation Type", "Interest Only"],
  ];
  const wsA = XLSX.utils.aoa_to_sheet(assumptions);
  XLSX.utils.book_append_sheet(wb, wsA, "Assumptions");

  // Returns: labels in col B, formulas in col C
  const returns = XLSX.utils.aoa_to_sheet([
    ["", ""],
    ["", "RETURNS"],
    ["", "Unlevered IRR", null],
    ["", "Levered IRR", null],
    ["", "Net Initial Yield", null],
    ["", "Total Profit", null],
  ]);
  for (const [addr, f] of [["C3", "0.08"], ["C4", "0.12"], ["C5", "Assumptions!C3/Assumptions!C2"], ["C6", "Assumptions!C3*2"]] as const) {
    returns[addr] = { t: "n", v: 0, f };
  }
  XLSX.utils.book_append_sheet(wb, returns, "Returns");

  return wb;
}

test("digest picks up labelled constants and formulas, skips bare labels and orphans", () => {
  const digest = buildWorkbookDigest(buildTestWorkbook());
  const a = digest.sheets.find((s) => s.name === "Assumptions");
  const r = digest.sheets.find((s) => s.name === "Returns");
  assert.ok(a && r, "both sheets present");

  const price = a.cells.find((c) => c.addr === "C3");
  assert.equal(price?.kind, "const");
  assert.equal(price?.label, "Purchase Price");
  assert.equal(price?.value, "10000000");

  const irr = r.cells.find((c) => c.addr === "C3");
  assert.equal(irr?.kind, "formula");
  assert.equal(irr?.label, "Unlevered IRR");

  // bare label rows (ASSUMPTIONS, RETURNS) are context, not candidates
  assert.ok(!a.cells.some((c) => c.label === "ASSUMPTIONS"));
  assert.ok(!r.cells.some((c) => c.label === "RETURNS"));
});

test("heuristic maps financial labels with correct types and formats", () => {
  const proposal = heuristicAutoMap(buildWorkbookDigest(buildTestWorkbook()));

  assert.equal(proposal.inputs.purchasePrice?.type, "number");
  assert.equal(proposal.inputs.purchasePrice?.sheet, "Assumptions");
  assert.equal(proposal.inputs.rentGrowth?.type, "percent");
  assert.equal(proposal.inputs.ltv?.type, "percent");
  assert.equal(proposal.inputs.exitCapRate?.type, "percent");
  assert.equal(proposal.inputs.holdPeriod?.type, "number");

  // date serial is skipped as a scenario input (C9 = Acquisition Date)
  assert.ok(!Object.values(proposal.inputs).some((m) => m.cell === "C9"));

  assert.equal(proposal.outputs.unleveredIRR?.format, "percent");
  assert.equal(proposal.outputs.unleveredIRR?.sheet, "Returns");
  assert.equal(proposal.outputs.netInitialYield?.format, "percent");
  assert.equal(proposal.outputs.totalProfit?.format, "number0");
});

test("validation drops inputs pointing at formulas and unknown cells", () => {
  const digest = buildWorkbookDigest(buildTestWorkbook());
  const proposal = validateProposal(digest, {
    goodInput: { sheet: "Assumptions", cell: "C3", label: "Purchase Price", type: "number" },
    badInputFormula: { sheet: "Returns", cell: "C3", label: "Unlevered IRR", type: "number" },
    badInputMissing: { sheet: "Assumptions", cell: "Z99", label: "Nope", type: "number" },
  }, {
    goodOutput: { sheet: "Returns", cell: "C3", label: "Unlevered IRR", format: "percent" },
    constOutput: { sheet: "Assumptions", cell: "C3", label: "Purchase Price", format: "number0" },
  });

  assert.ok(proposal.inputs.goodInput, "valid input kept");
  assert.ok(!proposal.inputs.badInputFormula, "formula cell rejected as input");
  assert.ok(!proposal.inputs.badInputMissing, "unknown cell rejected");
  assert.ok(proposal.outputs.goodOutput, "formula output kept");
  assert.ok(proposal.outputs.constOutput, "constant output kept with warning");
  assert.ok(proposal.warnings.some((w) => w.includes("constant, not a formula")));
  assert.ok(proposal.warnings.some((w) => w.includes("must be constants")));
});

test("validation normalises junk types and formats to safe defaults", () => {
  const digest = buildWorkbookDigest(buildTestWorkbook());
  const proposal = validateProposal(digest, {
    x: { sheet: "Assumptions", cell: "C3", label: "P", type: "nonsense" },
  }, {
    y: { sheet: "Returns", cell: "C3", label: "IRR", format: "weird" },
  });
  assert.equal(proposal.inputs.x.type, "number");
  assert.equal(proposal.outputs.y.format, "number0");
});
