/**
 * model-engine.test.ts — golden maths tests for the model engine pipeline.
 *
 * Proves that buildInvestmentModel (excel-builder.ts) + createEngineFromWorkbook
 * (model-engine.ts) produce numerically correct results, by comparing every
 * material output against an independent reference implementation of the same
 * financial formulas, plus an independent Newton–Raphson XIRR solver.
 *
 * Run with: npm test  (node --import tsx --test server/model-engine.test.ts)
 *
 * Two load-bearing integration details:
 * - excel-builder.ts imports exceljs with a default import (`import ExcelJS
 *   from "exceljs"`): the exceljs package is CJS, and only the default import
 *   resolves to the workbook class under both native ESM (tsx) and the esbuild
 *   production bundle. This file loads the builder through createRequire, which
 *   works under either module system.
 * - Every XLSX read that feeds the engine passes `sheetStubs: true`
 *   (createEngineFromFile, the models.ts template/run sites, and buildEngine
 *   below): ExcelJS writes formula cells with no cached value, and SheetJS
 *   drops such cells entirely unless stubs are enabled — the engine would
 *   otherwise see blank cells.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import XLSX from "xlsx-js-style";
import {
  createEngineFromWorkbook,
  createEngineFromFile,
  normalizeInputValue,
  applyMappedInputs,
  readEngineOutputs,
  desugarLet,
  boundFullRowColRefs,
  foldPositionGuards,
  rewriteBooleanLiterals,
  acquireTemplateEngine,
  disposeTemplateEngineCache,
  engineCacheKeyForFile,
  type ModelEngine,
  type SheetDims,
} from "./model-engine";

const require = createRequire(import.meta.url);
const { buildInvestmentModel } = require("./excel-builder.ts") as {
  buildInvestmentModel: (params: {
    modelName: string;
    assumptions: Record<string, unknown>;
    quarters?: number;
  }) => Promise<Buffer>;
};

// ─── Assertion helpers (counted, so the harness can report a total) ────────

let assertionCount = 0;

function T(condition: unknown, message: string): void {
  assertionCount++;
  assert.ok(condition, message);
}

/** |actual − expected| ≤ max(abs, rel·|expected|). Defaults: rel 1e-9. */
function approx(actual: number, expected: number, message: string, rel = 1e-9, abs = 0): void {
  assertionCount++;
  const tolerance = Math.max(abs, rel * Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual} (tol ${tolerance})`,
  );
}

// ─── Golden assumptions (equal to the builder's own defaults) ──────────────

const GOLDEN = {
  purchasePrice: 10_000_000,
  stampDutyRate: 0.05,
  acquisitionCostsRate: 0.018,
  agentFeeRate: 0.01,
  currentRentPA: 500_000,
  totalAreaSqFt: 5000,
  ervPerSqFt: 120,
  rentGrowthPA: 0.025,
  voidPeriodMonths: 3,
  rentFreeMonths: 6,
  managementFeeRate: 0.03,
  vacancyRate: 0.05,
  opexPerSqFt: 5,
  capexReserveRate: 0.05,
  costInflationPA: 0.02,
  ltv: 0.6,
  interestRate: 0.055,
  loanTermYears: 5,
  amortisationType: "Interest Only",
  arrangementFeeRate: 0.015,
  exitCapRate: 0.055,
  disposalCostsRate: 0.02,
  holdPeriodYears: 5,
  discountRate: 0.08,
  acquisitionDate: "2025-07-01",
  corporateTaxRate: 0.25,
};
type Assumptions = typeof GOLDEN;
const QUARTERS = 20;

// ─── Independent reference model ────────────────────────────────────────────

interface ReferenceModel {
  stampDuty: number;
  acquisitionCosts: number;
  agentFee: number;
  totalAcquisitionCost: number;
  loan: number;
  arrangementFee: number;
  equityContribution: number;
  ervTotal: number;
  niy: number;
  reversionaryYield: number;
  rent: number[];
  grossRentalIncome: number[];
  noi: number[];
  terminalNOI: number;
  grossExit: number;
  disposalCosts: number;
  netExit: number;
  /** Debt service per quarter (negative outflow), IO or fully amortising. */
  debtService: number[];
  interestPaid: number[];
  principalPaid: number[];
  levelPayment: number;
  closingBalance: number[];
  netExitLevered: number;
  unleveredMOIC: number;
  leveredMOIC: number;
  unleveredProfit: number;
  leveredProfit: number;
  unleveredNPV: number;
  leveredNPV: number;
}

function referenceModel(A: Assumptions, quarters: number): ReferenceModel {
  const stampDuty = A.purchasePrice * A.stampDutyRate;
  const acquisitionCosts = A.purchasePrice * A.acquisitionCostsRate;
  const agentFee = A.purchasePrice * A.agentFeeRate;
  const totalAcquisitionCost = A.purchasePrice + stampDuty + acquisitionCosts + agentFee;
  const loan = A.purchasePrice * A.ltv;
  const arrangementFee = loan * A.arrangementFeeRate;
  const equityContribution = totalAcquisitionCost - loan + arrangementFee;
  const ervTotal = A.ervPerSqFt * A.totalAreaSqFt;
  const niy = A.currentRentPA / totalAcquisitionCost;
  const reversionaryYield = ervTotal / totalAcquisitionCost;

  const loanTermQuarters = A.loanTermYears * 4;
  const quarterlyRate = A.interestRate / 4;
  const isIO = A.amortisationType === "Interest Only";
  const levelPayment = isIO
    ? loan * quarterlyRate
    : (loan * quarterlyRate) / (1 - Math.pow(1 + quarterlyRate, -loanTermQuarters));

  const rent: number[] = [];
  const grossRentalIncome: number[] = [];
  const noi: number[] = [];
  const debtService: number[] = [];
  const interestPaid: number[] = [];
  const principalPaid: number[] = [];
  const closingBalance: number[] = [];

  let balance = loan;
  for (let q = 1; q <= quarters; q++) {
    const yearIndex = Math.floor((q - 1) / 4);
    const r = (A.currentRentPA / 4) * Math.pow(1 + A.rentGrowthPA, yearIndex);
    const voidAllowance = q <= A.voidPeriodMonths / 3 ? -r : 0;
    const rentFree =
      q > A.voidPeriodMonths / 3 && q <= A.voidPeriodMonths / 3 + A.rentFreeMonths / 3 ? -r : 0;
    const vacancy = -r * A.vacancyRate;
    const gri = Math.max(0, r + voidAllowance + rentFree + vacancy);
    const mgmtFee = -gri * A.managementFeeRate;
    const opex =
      -((A.opexPerSqFt * A.totalAreaSqFt) / 4) * Math.pow(1 + A.costInflationPA, yearIndex);
    const capex = -Math.abs(gri) * A.capexReserveRate;
    rent.push(r);
    grossRentalIncome.push(gri);
    noi.push(gri + mgmtFee + opex + capex);

    const interest = q <= loanTermQuarters ? balance * quarterlyRate : 0;
    const principal = q <= loanTermQuarters ? (isIO ? 0 : levelPayment - interest) : 0;
    balance -= principal;
    interestPaid.push(interest);
    principalPaid.push(principal);
    debtService.push(-(interest + principal));
    closingBalance.push(balance);
  }

  const terminalNOI = noi[quarters - 1] * 4;
  const grossExit = terminalNOI / A.exitCapRate;
  const disposalCosts = -grossExit * A.disposalCostsRate;
  const netExit = grossExit + disposalCosts;
  // Levered exit repays the outstanding balance at exit: the full loan when
  // interest-only, zero once the loan has fully amortised over the hold.
  const netExitLevered = netExit - closingBalance[quarters - 1];

  const sumNOI = noi.reduce((a, b) => a + b, 0);
  const leveredQuarterly = noi.map((n, i) => n + debtService[i]);
  const sumLevered = leveredQuarterly.reduce((a, b) => a + b, 0);

  const unleveredMOIC = (sumNOI + netExit) / totalAcquisitionCost;
  const leveredMOIC = (sumLevered + netExitLevered) / equityContribution;
  const unleveredProfit = -totalAcquisitionCost + sumNOI + netExit;
  const leveredProfit = -equityContribution + sumLevered + netExitLevered;

  const qDisc = A.discountRate / 4;
  const holdPeriodQuarters = A.holdPeriodYears * 4;
  const unleveredNPV =
    -totalAcquisitionCost +
    noi.reduce((acc, n, i) => acc + n / Math.pow(1 + qDisc, i + 1), 0) +
    netExit / Math.pow(1 + qDisc, holdPeriodQuarters);
  const leveredNPV =
    -equityContribution +
    leveredQuarterly.reduce((acc, n, i) => acc + n / Math.pow(1 + qDisc, i + 1), 0) +
    netExitLevered / Math.pow(1 + qDisc, holdPeriodQuarters);

  return {
    stampDuty, acquisitionCosts, agentFee, totalAcquisitionCost, loan, arrangementFee,
    equityContribution, ervTotal, niy, reversionaryYield, rent, grossRentalIncome, noi,
    terminalNOI, grossExit, disposalCosts, netExit, debtService, interestPaid, principalPaid,
    levelPayment, closingBalance, netExitLevered, unleveredMOIC, leveredMOIC, unleveredProfit,
    leveredProfit, unleveredNPV, leveredNPV,
  };
}

/**
 * Independent XIRR solver: Excel convention NPV = Σ cf·(1+r)^(−(d_i−d_0)/365).
 * Uses day differences between engine-provided date serials, so any global
 * serial offset cancels out.
 */
function xirr(cashflows: number[], serialDates: number[]): number {
  const d0 = serialDates[0];
  let r = 0.1;
  for (let iter = 0; iter < 200; iter++) {
    let f = 0;
    let df = 0;
    for (let i = 0; i < cashflows.length; i++) {
      const t = (serialDates[i] - d0) / 365;
      const discount = Math.pow(1 + r, -t);
      f += cashflows[i] * discount;
      df += (-t * cashflows[i] * discount) / (1 + r);
    }
    const step = f / df;
    r -= step;
    if (Math.abs(step) < 1e-14) break;
  }
  if (!isFinite(r)) throw new Error("reference XIRR failed to converge");
  return r;
}

// ─── Engine plumbing ────────────────────────────────────────────────────────

async function buildEngine(overrides: Partial<Assumptions> = {}, quarters = QUARTERS): Promise<ModelEngine> {
  const buffer = await buildInvestmentModel({
    modelName: "Golden Test Model",
    assumptions: { ...GOLDEN, ...overrides },
    quarters,
  });
  const wb = XLSX.read(buffer, {
    type: "buffer",
    cellFormula: true,
    cellDates: false,
    sheetStubs: true, // ExcelJS emits no cached values; without stubs SheetJS drops formula cells
  });
  return createEngineFromWorkbook(wb);
}

function colLetter(colNum: number): string {
  let result = "";
  let n = colNum;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

/** Cash Flow quarter column: E.. = Q1.. (col q+4). Debt Schedule: C.. = Q1.. (col q+2). */
const cfCol = (q: number) => colLetter(q + 4);
const dsCol = (q: number) => colLetter(q + 2);

/** Hard precondition reader — a non-numeric cell fails the test immediately. */
function cellNum(engine: ModelEngine, sheet: string, a1: string): number {
  const result = engine.getCellValue(sheet, a1);
  if (!result.ok || typeof result.value !== "number") {
    throw new Error(`expected numeric ${sheet}!${a1}, got ${JSON.stringify(result)}`);
  }
  return result.value;
}

/** Locate a row by its label in column B, so the tests survive layout shifts. */
function findRowByLabel(engine: ModelEngine, sheet: string, label: string, maxRow = 150): number {
  for (let row = 1; row <= maxRow; row++) {
    const result = engine.getCellValue(sheet, `B${row}`);
    if (result.ok && result.value === label) return row;
  }
  throw new Error(`label not found on ${sheet}: "${label}"`);
}

function readRow(engine: ModelEngine, sheet: string, row: number, cols: string[]): number[] {
  return cols.map((c) => cellNum(engine, sheet, `${c}${row}`));
}

// ═══════════════════════════════════════════════════════════════════════════
// Golden workbook — interest-only loan
// ═══════════════════════════════════════════════════════════════════════════

describe("golden workbook (interest-only, 20 quarters)", () => {
  let engine: ModelEngine;
  const ref = referenceModel(GOLDEN, QUARTERS);
  const quarterCols = Array.from({ length: QUARTERS }, (_, i) => cfCol(i + 1));

  before(async () => {
    engine = await buildEngine();
  });
  after(() => engine.dispose());

  it("loads cleanly: all six sheets, no calculation errors", () => {
    T(engine.sheetNames.length === 6, `six sheets, got ${engine.sheetNames.join(",")}`);
    T(engine.sheetNames.includes("Cash Flow"), "has Cash Flow sheet");
    const errors = engine.collectErrors(200);
    T(errors.length === 0, `no calculation errors, got ${JSON.stringify(errors.slice(0, 5))}`);
    // The builder defines SensVar1/SensVar2, which HyperFormula refuses to
    // register (letters-then-digits reads as a cell-reference-like name).
    // Non-fatal: nothing references them. Any other warning is a failure.
    const unexpected = engine.warnings.filter((w) => !/SensVar[12]/.test(w));
    T(unexpected.length === 0, `only known SensVar warnings, got ${JSON.stringify(unexpected)}`);
  });

  it("computes derived acquisition and financing figures", () => {
    const expected: Array<[string, number]> = [
      ["Stamp Duty", ref.stampDuty],
      ["Acquisition Costs", ref.acquisitionCosts],
      ["Agent Fee", ref.agentFee],
      ["Total Acquisition Cost", ref.totalAcquisitionCost],
      ["Loan Amount", ref.loan],
      ["Arrangement Fee", ref.arrangementFee],
      ["Equity Contribution", ref.equityContribution],
      ["Quarterly Interest Payment", ref.loan * GOLDEN.interestRate / 4],
      ["Hold Period (quarters)", 20],
      ["Loan Term (quarters)", 20],
      ["ERV (total p.a.)", ref.ervTotal],
    ];
    for (const [label, value] of expected) {
      const row = findRowByLabel(engine, "Assumptions", label);
      approx(cellNum(engine, "Assumptions", `C${row}`), value, `Assumptions "${label}"`);
    }
    approx(
      cellNum(engine, "Assumptions", `C${findRowByLabel(engine, "Assumptions", "Net Initial Yield")}`),
      ref.niy, "Net Initial Yield",
    );
    approx(
      cellNum(engine, "Assumptions", `C${findRowByLabel(engine, "Assumptions", "Reversionary Yield")}`),
      ref.reversionaryYield, "Reversionary Yield",
    );
  });

  it("matches the reference model for rent, GRI and NOI in every quarter", () => {
    const rentRow = findRowByLabel(engine, "Cash Flow", "Passing Rent (quarterly)");
    const griRow = findRowByLabel(engine, "Cash Flow", "Gross Rental Income");
    const noiRow = findRowByLabel(engine, "Cash Flow", "Net Operating Income (NOI)");
    for (let q = 1; q <= QUARTERS; q++) {
      approx(cellNum(engine, "Cash Flow", `${cfCol(q)}${rentRow}`), ref.rent[q - 1], `rent Q${q}`);
      approx(cellNum(engine, "Cash Flow", `${cfCol(q)}${griRow}`), ref.grossRentalIncome[q - 1], `GRI Q${q}`);
      approx(cellNum(engine, "Cash Flow", `${cfCol(q)}${noiRow}`), ref.noi[q - 1], `NOI Q${q}`);
    }
  });

  it("applies void and rent-free correctly: GRI is zero in Q1–Q3", () => {
    const griRow = findRowByLabel(engine, "Cash Flow", "Gross Rental Income");
    for (const q of [1, 2, 3]) {
      approx(cellNum(engine, "Cash Flow", `${cfCol(q)}${griRow}`), 0, `GRI Q${q} is zero`, 0, 1e-9);
    }
  });

  it("computes the exit valuation from terminal NOI", () => {
    const d = (label: string) =>
      cellNum(engine, "Cash Flow", `D${findRowByLabel(engine, "Cash Flow", label)}`);
    approx(d("Terminal NOI (annualised)"), ref.terminalNOI, "terminal NOI");
    approx(d("Gross Exit Value"), ref.grossExit, "gross exit value");
    approx(d("Disposal Costs"), ref.disposalCosts, "disposal costs");
    approx(d("Net Exit Proceeds (Unlevered)"), ref.netExit, "net exit (unlevered)");
    approx(d("Loan Repayment at Exit"), -ref.closingBalance[QUARTERS - 1], "loan repayment at exit");
    approx(d("Net Exit Proceeds (Levered)"), ref.netExitLevered, "net exit (levered)");
  });

  it("carries entry and exit exactly once in the total cash flow rows", () => {
    const unlevRow = findRowByLabel(engine, "Cash Flow", "Total Unlevered Cash Flow");
    const levRow = findRowByLabel(engine, "Cash Flow", "Total Levered Cash Flow");
    approx(cellNum(engine, "Cash Flow", `C${unlevRow}`), -ref.totalAcquisitionCost, "unlevered entry");
    approx(cellNum(engine, "Cash Flow", `D${unlevRow}`), ref.netExit, "unlevered exit");
    approx(cellNum(engine, "Cash Flow", `C${levRow}`), -ref.equityContribution, "levered entry");
    approx(cellNum(engine, "Cash Flow", `D${levRow}`), ref.netExitLevered, "levered exit");
    for (let q = 1; q <= QUARTERS; q++) {
      approx(cellNum(engine, "Cash Flow", `${cfCol(q)}${unlevRow}`), ref.noi[q - 1], `unlevered CF Q${q}`);
      approx(
        cellNum(engine, "Cash Flow", `${cfCol(q)}${levRow}`),
        ref.noi[q - 1] + ref.debtService[q - 1],
        `levered CF Q${q}`,
      );
    }
  });

  it("matches an independent XIRR solver on its own cash flows and dates", () => {
    const unlevRow = findRowByLabel(engine, "Cash Flow", "Total Unlevered Cash Flow");
    const levRow = findRowByLabel(engine, "Cash Flow", "Total Levered Cash Flow");
    const dateRow = findRowByLabel(engine, "Cash Flow", "XIRR Dates");
    const cols = ["C", "D", ...quarterCols];
    const dates = readRow(engine, "Cash Flow", dateRow, cols);
    const refUnlev = xirr(readRow(engine, "Cash Flow", unlevRow, cols), dates);
    const refLev = xirr(readRow(engine, "Cash Flow", levRow, cols), dates);
    const unlevIRRRow = findRowByLabel(engine, "Cash Flow", "Unlevered IRR (XIRR)");
    const levIRRRow = findRowByLabel(engine, "Cash Flow", "Levered IRR (XIRR)");
    approx(cellNum(engine, "Cash Flow", `C${unlevIRRRow}`), refUnlev, "unlevered IRR", 1e-7);
    approx(cellNum(engine, "Cash Flow", `C${levIRRRow}`), refLev, "levered IRR", 1e-7);
  });

  it("computes MOIC, profit and NPV per the reference model", () => {
    const c = (label: string) =>
      cellNum(engine, "Cash Flow", `C${findRowByLabel(engine, "Cash Flow", label)}`);
    approx(c("Unlevered Equity Multiple"), ref.unleveredMOIC, "unlevered MOIC");
    approx(c("Levered Equity Multiple"), ref.leveredMOIC, "levered MOIC");
    approx(c("Unlevered Total Profit"), ref.unleveredProfit, "unlevered profit");
    approx(c("Levered Total Profit"), ref.leveredProfit, "levered profit");
    approx(c("Unlevered NPV @ Discount Rate"), ref.unleveredNPV, "unlevered NPV");
    approx(c("Levered NPV @ Discount Rate"), ref.leveredNPV, "levered NPV");
  });

  it("satisfies the profit and MOIC identities on engine-read cells", () => {
    const unlevRow = findRowByLabel(engine, "Cash Flow", "Total Unlevered Cash Flow");
    const levRow = findRowByLabel(engine, "Cash Flow", "Total Levered Cash Flow");
    const cols = ["C", "D", ...quarterCols];
    const unlevCF = readRow(engine, "Cash Flow", unlevRow, cols);
    const levCF = readRow(engine, "Cash Flow", levRow, cols);
    const unlevProfit = cellNum(engine, "Cash Flow", `C${findRowByLabel(engine, "Cash Flow", "Unlevered Total Profit")}`);
    const levProfit = cellNum(engine, "Cash Flow", `C${findRowByLabel(engine, "Cash Flow", "Levered Total Profit")}`);
    const unlevMOIC = cellNum(engine, "Cash Flow", `C${findRowByLabel(engine, "Cash Flow", "Unlevered Equity Multiple")}`);
    const levMOIC = cellNum(engine, "Cash Flow", `C${findRowByLabel(engine, "Cash Flow", "Levered Equity Multiple")}`);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    // Profit is the straight sum of the total CF row (exit counted exactly once).
    // rel 1e-9: HF's SUM and a JS left-to-right reduce differ by float
    // summation-order noise (~5e-5 on £8e5), not by any logic difference.
    approx(unlevProfit, sum(unlevCF), "unlevered profit == Σ total unlevered CF", 1e-9);
    approx(levProfit, sum(levCF), "levered profit == Σ total levered CF", 1e-9);
    // MOIC is distributions over contributions on the same row.
    const sumQuarters = (xs: number[]) => sum(xs.slice(2));
    approx(unlevMOIC, (sumQuarters(unlevCF) + unlevCF[1]) / -unlevCF[0], "unlevered MOIC identity", 1e-9);
    approx(levMOIC, (sumQuarters(levCF) + levCF[1]) / -levCF[0], "levered MOIC identity", 1e-9);
  });

  it("runs the interest-only debt schedule correctly", () => {
    const row = (label: string) => findRowByLabel(engine, "Debt Schedule", label);
    const quarterlyInterest = ref.loan * GOLDEN.interestRate / 4;
    approx(
      cellNum(engine, "Debt Schedule", `C${row("Quarterly PMT (if amortising)")}`),
      quarterlyInterest, "IO quarterly payment",
    );
    approx(cellNum(engine, "Debt Schedule", `C${row("Opening Balance")}`), ref.loan, "Q1 opening balance");
    for (let q = 1; q <= QUARTERS; q++) {
      approx(cellNum(engine, "Debt Schedule", `${dsCol(q)}${row("Interest")}`), quarterlyInterest, `DS interest Q${q}`);
      approx(cellNum(engine, "Debt Schedule", `${dsCol(q)}${row("Principal Repayment")}`), 0, `DS principal Q${q}`, 0, 1e-9);
      approx(cellNum(engine, "Debt Schedule", `${dsCol(q)}${row("Closing Balance")}`), ref.loan, `DS closing Q${q}`);
    }
    approx(
      cellNum(engine, "Debt Schedule", `${dsCol(QUARTERS)}${row("Cumulative Interest")}`),
      QUARTERS * quarterlyInterest, "cumulative interest over the hold",
    );
    // Q5 (a quarter with no voids) DSCR and interest cover against reference NOI.
    approx(
      cellNum(engine, "Debt Schedule", `${dsCol(5)}${row("DSCR")}`),
      ref.noi[4] / quarterlyInterest, "DSCR Q5",
    );
    approx(
      cellNum(engine, "Debt Schedule", `${dsCol(5)}${row("Interest Cover Ratio")}`),
      ref.noi[4] / quarterlyInterest, "interest cover Q5",
    );
    approx(
      cellNum(engine, "Debt Schedule", `${dsCol(QUARTERS)}${row("LTV (on purchase price)")}`),
      GOLDEN.ltv, "LTV at exit quarter",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Second parameter set — profitable deal, 28 quarters, no voids
// ═══════════════════════════════════════════════════════════════════════════

describe("golden workbook (second parameter set, 28 quarters)", () => {
  const overrides: Partial<Assumptions> = {
    purchasePrice: 5_000_000,
    currentRentPA: 550_000,
    ervPerSqFt: 130,
    rentGrowthPA: 0.03,
    voidPeriodMonths: 0,
    rentFreeMonths: 0,
    ltv: 0.65,
    interestRate: 0.05,
    exitCapRate: 0.05,
    holdPeriodYears: 7,
    loanTermYears: 7,
    discountRate: 0.09,
  };
  const quarters = 28;
  const caseA = { ...GOLDEN, ...overrides };
  const ref = referenceModel(caseA, quarters);
  let engine: ModelEngine;

  before(async () => {
    engine = await buildEngine(overrides, quarters);
  });
  after(() => engine.dispose());

  it("headline outputs match the reference model", () => {
    T(engine.collectErrors(200).length === 0, "no calculation errors");
    const noiRow = findRowByLabel(engine, "Cash Flow", "Net Operating Income (NOI)");
    approx(cellNum(engine, "Cash Flow", `${cfCol(1)}${noiRow}`), ref.noi[0], "NOI Q1");
    approx(cellNum(engine, "Cash Flow", `${cfCol(28)}${noiRow}`), ref.noi[27], "NOI Q28");
    approx(
      cellNum(engine, "Assumptions", `C${findRowByLabel(engine, "Assumptions", "Total Acquisition Cost")}`),
      ref.totalAcquisitionCost, "total acquisition cost",
    );
    approx(
      cellNum(engine, "Assumptions", `C${findRowByLabel(engine, "Assumptions", "Equity Contribution")}`),
      ref.equityContribution, "equity contribution",
    );
    approx(
      cellNum(engine, "Cash Flow", `D${findRowByLabel(engine, "Cash Flow", "Net Exit Proceeds (Unlevered)")}`),
      ref.netExit, "net exit",
    );
    const c = (label: string) =>
      cellNum(engine, "Cash Flow", `C${findRowByLabel(engine, "Cash Flow", label)}`);
    approx(c("Unlevered Equity Multiple"), ref.unleveredMOIC, "unlevered MOIC");
    approx(c("Levered Equity Multiple"), ref.leveredMOIC, "levered MOIC");
    approx(c("Unlevered Total Profit"), ref.unleveredProfit, "unlevered profit");
    approx(c("Levered Total Profit"), ref.leveredProfit, "levered profit");
    approx(c("Unlevered NPV @ Discount Rate"), ref.unleveredNPV, "unlevered NPV");
    approx(c("Levered NPV @ Discount Rate"), ref.leveredNPV, "levered NPV");
  });

  it("IRRs match the independent solver and are positive for a profitable deal", () => {
    const cols = ["C", "D", ...Array.from({ length: quarters }, (_, i) => cfCol(i + 1))];
    const dateRow = findRowByLabel(engine, "Cash Flow", "XIRR Dates");
    const dates = readRow(engine, "Cash Flow", dateRow, cols);
    const unlevRow = findRowByLabel(engine, "Cash Flow", "Total Unlevered Cash Flow");
    const levRow = findRowByLabel(engine, "Cash Flow", "Total Levered Cash Flow");
    const refUnlev = xirr(readRow(engine, "Cash Flow", unlevRow, cols), dates);
    const refLev = xirr(readRow(engine, "Cash Flow", levRow, cols), dates);
    approx(
      cellNum(engine, "Cash Flow", `C${findRowByLabel(engine, "Cash Flow", "Unlevered IRR (XIRR)")}`),
      refUnlev, "unlevered IRR", 1e-7,
    );
    approx(
      cellNum(engine, "Cash Flow", `C${findRowByLabel(engine, "Cash Flow", "Levered IRR (XIRR)")}`),
      refLev, "levered IRR", 1e-7,
    );
    T(refUnlev > 0 && refLev > 0, "both IRRs positive for the profitable case");
    T(refLev > refUnlev, "leverage amplifies returns for a profitable deal");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fully amortising loan — pins IPMT/PPMT behaviour and balance recursion
// ═══════════════════════════════════════════════════════════════════════════

describe("fully amortising loan (term = hold = 5 years)", () => {
  const caseA = { ...GOLDEN, amortisationType: "Fully Amortising" };
  const ref = referenceModel(caseA, QUARTERS);
  let engine: ModelEngine;

  before(async () => {
    engine = await buildEngine({ amortisationType: "Fully Amortising" });
  });
  after(() => engine.dispose());

  it("level payment equals the annuity formula", () => {
    approx(
      cellNum(engine, "Debt Schedule", `C${findRowByLabel(engine, "Debt Schedule", "Quarterly PMT (if amortising)")}`),
      ref.levelPayment, "level quarterly payment",
    );
  });

  it("interest + principal equals the level payment in every quarter", () => {
    const intRow = findRowByLabel(engine, "Cash Flow", "Interest Payment");
    const princRow = findRowByLabel(engine, "Cash Flow", "Principal Repayment");
    for (let q = 1; q <= QUARTERS; q++) {
      const interest = cellNum(engine, "Cash Flow", `${cfCol(q)}${intRow}`);
      const principal = cellNum(engine, "Cash Flow", `${cfCol(q)}${princRow}`);
      // IPMT/PPMT come back negative (outflows) under Excel's sign convention.
      approx(interest, -ref.interestPaid[q - 1], `CF interest Q${q}`);
      approx(principal, -ref.principalPaid[q - 1], `CF principal Q${q}`);
      approx(Math.abs(interest) + Math.abs(principal), ref.levelPayment, `level payment identity Q${q}`);
    }
  });

  it("debt schedule balance recursion amortises the loan to zero", () => {
    const closeRow = findRowByLabel(engine, "Debt Schedule", "Closing Balance");
    const princRow = findRowByLabel(engine, "Debt Schedule", "Principal Repayment");
    for (let q = 1; q <= QUARTERS; q++) {
      // abs 1e-6 covers the PMT rounding residue on a £6m balance (the engine
      // lands the final balance on exactly 0; the reference recursion carries
      // ~4e-8 of float noise).
      approx(
        cellNum(engine, "Debt Schedule", `${dsCol(q)}${closeRow}`),
        ref.closingBalance[q - 1], `closing balance Q${q}`, 1e-9, 1e-6,
      );
    }
    approx(
      cellNum(engine, "Debt Schedule", `${dsCol(QUARTERS)}${closeRow}`),
      0, "loan fully amortised at exit", 0, 1e-6, // residue of PMT rounding, on a £6m balance
    );
    let principalSum = 0;
    for (let q = 1; q <= QUARTERS; q++) {
      principalSum += cellNum(engine, "Debt Schedule", `${dsCol(q)}${princRow}`);
    }
    approx(principalSum, ref.loan, "total principal repaid equals the loan");
    approx(
      cellNum(engine, "Debt Schedule", `${dsCol(5)}${findRowByLabel(engine, "Debt Schedule", "DSCR")}`),
      ref.noi[4] / ref.levelPayment, "DSCR Q5 under amortisation",
    );
  });

  it("repays only the outstanding balance at exit, not the original principal", () => {
    const d = (label: string) =>
      cellNum(engine, "Cash Flow", `D${findRowByLabel(engine, "Cash Flow", label)}`);
    // Fully amortised over the hold: the exit-quarter closing balance is zero,
    // so nothing is repaid at exit (abs tol covers the PMT rounding residue).
    approx(d("Loan Repayment at Exit"), 0, "loan repayment at exit is zero", 0, 1e-6);
    approx(
      d("Loan Repayment at Exit"), -ref.closingBalance[QUARTERS - 1],
      "loan repayment equals minus the exit-quarter closing balance", 1e-9, 1e-6,
    );
    // Golden value: the levered exit keeps the full £8,112,714.92 net proceeds —
    // the old −LoanAmount formula double-counted the £6m of repaid principal.
    approx(d("Net Exit Proceeds (Levered)"), 8112714.92, "golden net exit (levered)", 0, 0.01);
    approx(d("Net Exit Proceeds (Levered)"), ref.netExitLevered, "net exit (levered)");
    const levRow = findRowByLabel(engine, "Cash Flow", "Total Levered Cash Flow");
    approx(cellNum(engine, "Cash Flow", `D${levRow}`), ref.netExitLevered, "levered exit carried once");
    const c = (label: string) =>
      cellNum(engine, "Cash Flow", `C${findRowByLabel(engine, "Cash Flow", label)}`);
    approx(c("Levered Equity Multiple"), ref.leveredMOIC, "levered MOIC");
    approx(c("Levered Total Profit"), ref.leveredProfit, "levered profit");
  });

  it("levered IRR matches the independent XIRR solver", () => {
    const cols = ["C", "D", ...Array.from({ length: QUARTERS }, (_, i) => cfCol(i + 1))];
    const dateRow = findRowByLabel(engine, "Cash Flow", "XIRR Dates");
    const dates = readRow(engine, "Cash Flow", dateRow, cols);
    const levRow = findRowByLabel(engine, "Cash Flow", "Total Levered Cash Flow");
    const refLev = xirr(readRow(engine, "Cash Flow", levRow, cols), dates);
    approx(
      cellNum(engine, "Cash Flow", `C${findRowByLabel(engine, "Cash Flow", "Levered IRR (XIRR)")}`),
      refLev, "levered IRR", 1e-7,
    );
    T(isFinite(refLev), "levered IRR is finite (solver converged)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Void + rent-free covering the whole hold — GRI floor at zero
// ═══════════════════════════════════════════════════════════════════════════

describe("voids and rent-free covering all 20 quarters", () => {
  let engine: ModelEngine;

  before(async () => {
    engine = await buildEngine({ voidPeriodMonths: 36, rentFreeMonths: 24 });
  });
  after(() => engine.dispose());

  it("gross rental income is floored at zero, never negative", () => {
    const griRow = findRowByLabel(engine, "Cash Flow", "Gross Rental Income");
    for (let q = 1; q <= QUARTERS; q++) {
      const gri = cellNum(engine, "Cash Flow", `${cfCol(q)}${griRow}`);
      approx(gri, 0, `GRI Q${q}`, 0, 1e-9);
    }
  });

  it("NOI equals minus operating costs when no rent is collected", () => {
    const ref = referenceModel({ ...GOLDEN, voidPeriodMonths: 36, rentFreeMonths: 24 }, QUARTERS);
    const noiRow = findRowByLabel(engine, "Cash Flow", "Net Operating Income (NOI)");
    for (const q of [1, 10, 20]) {
      approx(cellNum(engine, "Cash Flow", `${cfCol(q)}${noiRow}`), ref.noi[q - 1], `NOI Q${q}`);
      T(ref.noi[q - 1] < 0, `reference NOI Q${q} is negative (costs only)`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// What-if: setCell must recompute dependent formulas
// ═══════════════════════════════════════════════════════════════════════════

describe("setCell what-if on the discount rate", () => {
  let engine: ModelEngine;

  before(async () => {
    engine = await buildEngine();
  });
  after(() => engine.dispose());

  it("unlevered NPV responds to a discount-rate change by the analytic amount", () => {
    const ref8 = referenceModel(GOLDEN, QUARTERS);
    const ref10 = referenceModel({ ...GOLDEN, discountRate: 0.1 }, QUARTERS);
    const npvCell = `C${findRowByLabel(engine, "Cash Flow", "Unlevered NPV @ Discount Rate")}`;
    approx(cellNum(engine, "Cash Flow", npvCell), ref8.unleveredNPV, "NPV at 8% before change");
    const discountRow = findRowByLabel(engine, "Assumptions", "Discount Rate");
    engine.setCell("Assumptions", `C${discountRow}`, 0.1);
    approx(cellNum(engine, "Cash Flow", npvCell), ref10.unleveredNPV, "NPV at 10% after setCell");
    T(ref10.unleveredNPV < ref8.unleveredNPV, "higher discount rate lowers the NPV");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// createEngineFromFile — the on-disk read path used by the models routes
// ═══════════════════════════════════════════════════════════════════════════

describe("createEngineFromFile on an ExcelJS-built workbook", () => {
  it("sees formula cells, not blanks (sheetStubs), and computes the outputs", async () => {
    const ref = referenceModel(GOLDEN, QUARTERS);
    const filePath = join(tmpdir(), `golden-test-${process.pid}-${Date.now()}.xlsx`);
    let engine: ModelEngine | undefined;
    try {
      const buffer = await buildInvestmentModel({
        modelName: "Golden Test Model",
        assumptions: { ...GOLDEN },
        quarters: QUARTERS,
      });
      writeFileSync(filePath, buffer);
      // Regression pin: ExcelJS writes formula cells with no cached value, so
      // without sheetStubs SheetJS drops them and the engine reads blanks.
      engine = createEngineFromFile(filePath);
      T(engine.collectErrors(200).length === 0, "no calculation errors from the file path");
      approx(
        cellNum(engine, "Assumptions", `C${findRowByLabel(engine, "Assumptions", "Total Acquisition Cost")}`),
        ref.totalAcquisitionCost, "Total Acquisition Cost via createEngineFromFile",
      );
      approx(
        cellNum(engine, "Cash Flow", `C${findRowByLabel(engine, "Cash Flow", "Unlevered Equity Multiple")}`),
        ref.unleveredMOIC, "Unlevered MOIC via createEngineFromFile",
      );
      const levIRR = cellNum(
        engine, "Cash Flow", `C${findRowByLabel(engine, "Cash Flow", "Levered IRR (XIRR)")}`,
      );
      T(isFinite(levIRR), "Levered IRR is a finite number, not a dropped blank");
    } finally {
      engine?.dispose();
      try { unlinkSync(filePath); } catch {}
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Engine edge cases — error handling, input normalisation, mapped I/O
// ═══════════════════════════════════════════════════════════════════════════

describe("engine edge cases", () => {
  it("a circular reference freezes at its cached value (0 when none) instead of #CYCLE!", () => {
    // Excel with iterative calculation off resolves genuine circular refs to 0;
    // the engine freezes one member at the Excel-cached value to reproduce that.
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet([[null], [null], [null]]);
    ws["A1"] = { t: "n", f: "A2+1" };
    ws["A2"] = { t: "n", f: "A1+1" };
    ws["A3"] = { t: "n", f: "A1*10" };
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    const engine = createEngineFromWorkbook(wb);
    const a1 = engine.getCellValue("S", "A1");
    const a2 = engine.getCellValue("S", "A2");
    T(a1.ok && a1.value === 0, `A1 frozen at 0, got ${JSON.stringify(a1)}`);
    T(a2.ok && a2.value === 1, `A2 computes from the freeze, got ${JSON.stringify(a2)}`);
    approx(cellNum(engine, "S", "A3"), 0, "downstream computes from the frozen member");
    T(engine.warnings.some((w) => w.includes("Circular reference")), "freeze warning recorded");
    T(!engine.collectErrors().some((e) => e.error === "#CYCLE!"), "no #CYCLE! remains");
    engine.dispose();
  });

  it("missing sheets and blank cells behave per the engine contract", () => {
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet([[1]]);
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    const engine = createEngineFromWorkbook(wb);
    const missing = engine.getCellValue("No Such Sheet", "A1");
    T(!missing.ok, `missing sheet returns ok:false, got ${JSON.stringify(missing)}`);
    const blank = engine.getCellValue("S", "B9");
    T(blank.ok && blank.value === null, `blank cell reads as null, got ${JSON.stringify(blank)}`);
    engine.dispose();
  });

  it("normalizeInputValue mirrors writeCellValue conventions", () => {
    T(normalizeInputValue(5.5, "percent") === 0.055, "percent number divided by 100");
    T(normalizeInputValue("5.5", "percent") === 0.055, "percent string divided by 100");
    T(normalizeInputValue("", "percent") === undefined, "empty string not written");
    T(normalizeInputValue(null, "percent") === undefined, "null not written");
    T(normalizeInputValue("abc", "number") === undefined, "non-numeric not written");
    T(normalizeInputValue("hello", "text") === "hello", "text passes through");
    T(normalizeInputValue(42) === 42, "plain number passes through");
  });

  it("applyMappedInputs writes percent inputs and recalculates dependents", () => {
    // Two rows so A2 falls inside the sheet's !ref range (the engine only
    // loads cells within !ref).
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet([[0], [0]]);
    ws["A1"] = { t: "n", v: 0 };
    ws["A2"] = { t: "n", f: "A1*2" };
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    const engine = createEngineFromWorkbook(wb);
    const mapping = { rate: { sheet: "S", cell: "A1", type: "percent" } };
    const applied = applyMappedInputs(engine, { rate: "5.5", bogus: 1 }, mapping);
    T(applied.length === 1 && applied[0] === "rate", "only mapped keys applied");
    approx(cellNum(engine, "S", "A2"), 0.11, "dependent formula recalculated", 0, 1e-12);
    const skipped = applyMappedInputs(engine, { rate: "" }, mapping);
    T(skipped.length === 0, "empty input skipped");
    approx(cellNum(engine, "S", "A1"), 0.055, "previous value left intact", 0, 1e-15);
    engine.dispose();
  });

  it("readEngineOutputs maps blanks to null and errors into the error list", () => {
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet([[null], [null]]);
    ws["A1"] = { t: "n", f: "1/0" };
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    const engine = createEngineFromWorkbook(wb);
    const { outputs, errors } = readEngineOutputs(engine, {
      blank: { sheet: "S", cell: "B9" },
      boom: { sheet: "S", cell: "A1" },
      missingSheet: { sheet: "Nope", cell: "A1" },
      noMapping: undefined as never,
    });
    T(outputs.blank === null, "blank output is null");
    T(outputs.boom === "#DIV/0!", `error output carries the error string, got ${outputs.boom}`);
    T(typeof outputs.missingSheet === "string", "missing sheet output carries the error string");
    T(outputs.noMapping === null, "unmapped output is null");
    T(errors.length === 2, `two errors listed, got ${errors.length}`);
    engine.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Excel-compat shims: LOOKUP / IFS / DATEDIF plugins (model-functions.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("Excel-compat function plugins", () => {
  const serial = (y: number, m: number, d: number) =>
    Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);

  function engineWith(cells: Record<string, { f?: string; v?: number | string }>, size: [number, number] = [4, 4]): ModelEngine {
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet(
      Array.from({ length: size[0] }, () => Array.from({ length: size[1] }, () => null)),
    );
    for (const [a1, cell] of Object.entries(cells)) {
      ws[a1] = cell.f !== undefined ? { t: "n", f: cell.f } : { t: typeof cell.v === "string" ? "s" : "n", v: cell.v };
    }
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    return createEngineFromWorkbook(wb);
  }

  it("LOOKUP vector form over a sorted date spine picks the right row", () => {
    const engine = engineWith({
      A1: { v: serial(2024, 1, 31) }, B1: { v: serial(2024, 2, 29) }, C1: { v: serial(2024, 3, 31) },
      A2: { v: 100 }, B2: { v: 200 }, C2: { v: 300 },
      A3: { f: "LOOKUP(DATE(2024,3,15),A1:C1,A2:C2)" },
      B3: { f: "LOOKUP(DATE(2024,3,31),A1:C1,A2:C2)" },
      C3: { f: "LOOKUP(DATE(2025,1,1),A1:C1,A2:C2)" },
    });
    approx(cellNum(engine, "S", "A3"), 200, "mid-spine lookup -> Feb row");
    approx(cellNum(engine, "S", "B3"), 300, "exact end-date match");
    approx(cellNum(engine, "S", "C3"), 300, "past-the-end lookup clamps to last");
    engine.dispose();
  });

  it("LOOKUP vector form returns #N/A below the first value", () => {
    const engine = engineWith({
      A1: { v: 10 }, B1: { v: 20 },
      A2: { v: 1 }, B2: { v: 2 },
      A3: { f: "LOOKUP(5,A1:B1,A2:B2)" },
      B3: { f: "IFERROR(LOOKUP(5,A1:B1,A2:B2),-1)" },
    });
    const r = engine.getCellValue("S", "A3");
    T(!r.ok && r.error === "#N/A", `too-small key is #N/A, got ${JSON.stringify(r)}`);
    approx(cellNum(engine, "S", "B3"), -1, "IFERROR catches the #N/A");
    engine.dispose();
  });

  it("LOOKUP two-arg vector form returns from the lookup vector itself", () => {
    const engine = engineWith({
      A1: { v: 10 }, B1: { v: 20 }, C1: { v: 30 },
      A2: { f: "LOOKUP(25,A1:C1)" },
    });
    approx(cellNum(engine, "S", "A2"), 20, "self-vector lookup");
    engine.dispose();
  });

  it("LOOKUP array form searches the first row and returns from the last", () => {
    const engine = engineWith({
      A1: { v: 1 }, B1: { v: 2 }, C1: { v: 3 },
      A2: { v: "a" }, B2: { v: "b" }, C2: { v: "c" },
      A3: { f: "LOOKUP(2,A1:C2)" },
      // vertical orientation: more rows than columns -> search col 1, return col 2
      E1: { v: 10 }, F1: { v: 5 },
      E2: { v: 20 }, F2: { v: 6 },
      E3: { v: 30 }, F3: { v: 7 },
      B3: { f: "LOOKUP(25,E1:F3)" },
    }, [4, 8]);
    const horiz = engine.getCellValue("S", "A3");
    T(horiz.ok && horiz.value === "b", `horizontal array form -> "b", got ${JSON.stringify(horiz)}`);
    approx(cellNum(engine, "S", "B3"), 6, "vertical array form");
    engine.dispose();
  });

  it("IFS returns the value of the first truthy condition", () => {
    const engine = engineWith({
      A1: { f: 'IFS(FALSE(),1,TRUE(),2,TRUE(),3)' },
      B1: { f: 'IFS(1=1,"yes",TRUE(),"no")' },
      C1: { f: 'IFS(FALSE(),1,FALSE(),2)' },
      D1: { f: 'IFS(FALSE(),1,1/0,2)' },
    });
    approx(cellNum(engine, "S", "A1"), 2, "first match wins");
    const b = engine.getCellValue("S", "B1");
    T(b.ok && b.value === "yes", `string result, got ${JSON.stringify(b)}`);
    const c = engine.getCellValue("S", "C1");
    T(!c.ok && c.error === "#N/A", `no match is #N/A, got ${JSON.stringify(c)}`);
    const d = engine.getCellValue("S", "D1");
    T(!d.ok && d.error === "#DIV/0!", `error in a reached condition propagates, got ${JSON.stringify(d)}`);
    engine.dispose();
  });

  it("DATEDIF accepts lowercase units and computes complete months and years", () => {
    const engine = engineWith({
      A1: { v: serial(2024, 1, 1) }, B1: { v: serial(2025, 1, 1) },
      C1: { f: 'DATEDIF(A1,B1,"m")' },
      D1: { f: 'DATEDIF(A1,B1,"Y")' },
      E1: { f: 'DATEDIF(A1,B1,"d")' },
      F1: { f: 'DATEDIF(A1,DATE(2025,3,15),"ym")' },
      G1: { f: 'DATEDIF(B1,A1,"m")' },
      H1: { f: 'DATEDIF(A1,B1,"w")' },
    }, [4, 8]);
    approx(cellNum(engine, "S", "C1"), 12, 'DATEDIF "m" complete months');
    approx(cellNum(engine, "S", "D1"), 1, 'DATEDIF "Y" complete years');
    approx(cellNum(engine, "S", "E1"), 366, 'DATEDIF "d" days across a leap year');
    approx(cellNum(engine, "S", "F1"), 2, 'DATEDIF "ym" months ignoring years');
    const rev = engine.getCellValue("S", "G1");
    T(!rev.ok && rev.error === "#NUM!", `end before start is #NUM!, got ${JSON.stringify(rev)}`);
    const badUnit = engine.getCellValue("S", "H1");
    T(!badUnit.ok && badUnit.error === "#NUM!", `unknown unit is #NUM!, got ${JSON.stringify(badUnit)}`);
    engine.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REX-grade Excel semantics — TRIM/CLEAN vectorization, CHOOSE array
// selectors, FILTER row-keep, INDEX array selectors, computed defined names.
// Each test mirrors a construct in the REX exemplar workbook that stock
// HyperFormula evaluates differently from Excel.
// ═══════════════════════════════════════════════════════════════════════════

describe("REX-grade Excel semantics", () => {
  function engineWith(
    cells: Record<string, { f?: string; v?: number | string }>,
    size: [number, number] = [6, 8],
    names?: Array<{ Name: string; Ref: string }>,
  ): ModelEngine {
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet(
      Array.from({ length: size[0] }, () => Array.from({ length: size[1] }, () => null)),
    );
    for (const [a1, cell] of Object.entries(cells)) {
      ws[a1] = cell.f !== undefined ? { t: "n", f: cell.f } : { t: typeof cell.v === "string" ? "s" : "n", v: cell.v };
    }
    const wb = { SheetNames: ["S"], Sheets: { S: ws }, Workbook: names ? { Names: names } : undefined } as never;
    return createEngineFromWorkbook(wb);
  }

  it("TRIM maps over ranges and cleans inner whitespace", () => {
    const engine = engineWith({
      A1: { v: "  x  " }, A2: { v: " y" }, A3: { v: "x" },
      B1: { f: "TRIM(A1)" },
      B2: { f: 'SUMPRODUCT(--(TRIM(A1:A3)="x"))' },
    });
    const b1 = engine.getCellValue("S", "B1");
    T(b1.ok && b1.value === "x", `scalar TRIM, got ${JSON.stringify(b1)}`);
    approx(cellNum(engine, "S", "B2"), 2, "TRIM over a range inside SUMPRODUCT");
    engine.dispose();
  });

  it("CLEAN maps over ranges and strips control characters", () => {
    const engine = engineWith({
      A1: { f: '"a"&CHAR(10)&"b"' }, A2: { v: "ab" },
      B1: { f: "CLEAN(A1)" },
      B2: { f: 'SUMPRODUCT(--(CLEAN(A1:A2)="ab"))' },
    });
    const b1 = engine.getCellValue("S", "B1");
    T(b1.ok && b1.value === "ab", `scalar CLEAN, got ${JSON.stringify(b1)}`);
    approx(cellNum(engine, "S", "B2"), 2, "CLEAN over a range inside SUMPRODUCT");
    engine.dispose();
  });

  it("CHOOSE with an array selector tiles the candidates in selector arrangement", () => {
    // CHOOSE({1,2}, A1:A2, B1:B2) -> [[A1,B1],[A2,B2]] = [[1,10],[2,20]]
    const engine = engineWith({
      A1: { v: 1 }, A2: { v: 2 }, B1: { v: 10 }, B2: { v: 20 },
      C1: { f: "SUM(CHOOSE({1,2},A1:A2,B1:B2))" },
      C2: { f: "CHOOSE(5,A1,B1)" },
    });
    approx(cellNum(engine, "S", "C1"), 33, "tiled CHOOSE sums all picked cells");
    const out = engine.getCellValue("S", "C2");
    T(!out.ok && out.error === "#NUM!", `selector beyond candidates is #NUM!, got ${JSON.stringify(out)}`);
    engine.dispose();
  });

  it("FILTER keeps whole rows for a column mask and honours if_empty", () => {
    // Excel semantics: 2-D data + column-vector mask of matching height keeps
    // whole rows (stock HyperFormula demands a same-shape mask and rejects it).
    const engine = engineWith({
      A1: { v: "a" }, B1: { v: 5 },
      A2: { v: "b" }, B2: { v: 0 },
      A3: { v: "c" }, B3: { v: 7 },
      D1: { f: "SUM(FILTER(A1:B3,B1:B3>0))" },
      D2: { f: 'FILTER(A1:A3,B1:B3>100,"none")' },
    });
    approx(cellNum(engine, "S", "D1"), 12, "rows with B>0 contribute B values 5+7");
    const d2 = engine.getCellValue("S", "D2");
    T(d2.ok && d2.value === "none", `empty FILTER yields if_empty, got ${JSON.stringify(d2)}`);
    engine.dispose();
  });

  it("INDEX with array selectors returns the cross-product grid and spills", () => {
    // INDEX(A1:B2, SEQUENCE(2), {1,2}) = whole 2x2 block, spilling right/down.
    const engine = engineWith({
      A1: { v: 1 }, B1: { v: 2 }, A2: { v: 3 }, B2: { v: 4 },
      D1: { f: "INDEX(A1:B2,SEQUENCE(2),{1,2})" },
    });
    approx(cellNum(engine, "S", "D1"), 1, "anchor");
    approx(cellNum(engine, "S", "E1"), 2, "spill right");
    approx(cellNum(engine, "S", "D2"), 3, "spill down");
    approx(cellNum(engine, "S", "E2"), 4, "spill corner");
    engine.dispose();
  });

  it("INDEX with vector row and scalar column preserves orientation", () => {
    // INDEX(A1:B3, SEQUENCE(3), 2) picks column 2 top-to-bottom, spilling down.
    const engine = engineWith({
      A1: { v: 1 }, B1: { v: 7 }, A2: { v: 2 }, B2: { v: 8 }, A3: { v: 3 }, B3: { v: 9 },
      E1: { f: "INDEX(A1:B3,SEQUENCE(3),2)" },
    });
    approx(cellNum(engine, "S", "E1"), 7, "anchor");
    approx(cellNum(engine, "S", "E2"), 8, "row 2 of the column spill");
    approx(cellNum(engine, "S", "E3"), 9, "row 3 of the column spill");
    engine.dispose();
  });

  it("computed defined names are inlined; one bad reference can't poison others", () => {
    // Import_Key-style name: an expression, not a pure ref. HyperFormula's
    // array-valued named expressions poison the name's cached vertex when a
    // comparison reads it, so the engine inlines computed names instead.
    const engine = engineWith({
      A1: { v: "x" }, A2: { v: "y" }, A3: { v: "z" },
      B1: { v: 1 }, B2: { v: 2 }, B3: { v: 3 },
      C1: { f: 'SUMPRODUCT(--(Import_Key="y2"))' },
      C2: { f: "INDEX(Import_Key,3)" },
    }, [6, 8], [{ Name: "Import_Key", Ref: "=S!$A$1:$A$3&S!$B$1:$B$3" }]);
    approx(cellNum(engine, "S", "C1"), 1, "SUMPRODUCT over the inlined name");
    const c2 = engine.getCellValue("S", "C2");
    T(c2.ok && c2.value === "z3", `INDEX over the inlined name stays correct, got ${JSON.stringify(c2)}`);
    engine.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Template engine cache — scenario/sensitivity loops lease one shared engine
// per template instead of rebuilding the graph per combination.
// ═══════════════════════════════════════════════════════════════════════════

describe("template engine cache", () => {
  after(() => disposeTemplateEngineCache());

  function tinyWb(): never {
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet([[null], [null]]);
    ws["A1"] = { t: "n", v: 10 }; // input cell
    ws["A2"] = { t: "n", f: "A1*2" };
    return { SheetNames: ["S"], Sheets: { S: ws } } as never;
  }

  it("reuses the same engine across leases and restores run inputs on release", () => {
    let builds = 0;
    const build = () => { builds++; return tinyWb(); };

    const first = acquireTemplateEngine("t1", build);
    approx(cellNum(first.engine, "S", "A2"), 20, "template default before any run");
    applyMappedInputs(first.engine, { x: 100 }, { x: { sheet: "S", cell: "A1", type: "number" } });
    approx(cellNum(first.engine, "S", "A2"), 200, "run sees the applied input");
    first.release();

    const second = acquireTemplateEngine("t1", build);
    T(builds === 1, `second lease is a cache hit, builds=${builds}`);
    T(second.engine === first.engine, "same engine instance reused");
    approx(cellNum(second.engine, "S", "A1"), 10, "input cell restored to the template value");
    approx(cellNum(second.engine, "S", "A2"), 20, "dependents recalculated back");
    second.release();

    const third = acquireTemplateEngine("t1", build);
    applyMappedInputs(third.engine, { x: 7 }, { x: { sheet: "S", cell: "A1", type: "number" } });
    approx(cellNum(third.engine, "S", "A2"), 14, "a later run applies its own inputs cleanly");
    third.release();
  });

  it("double release is a no-op and independent keys get independent engines", () => {
    const a1 = acquireTemplateEngine("t2", tinyWb);
    a1.release();
    a1.release(); // must not throw or corrupt the cache
    const b1 = acquireTemplateEngine("t3", tinyWb);
    const a2 = acquireTemplateEngine("t2", tinyWb);
    T(b1.engine !== a2.engine, "different cache keys hold different engines");
    b1.release();
    a2.release();
  });

  it("a key per mtime invalidates when the template file changes", () => {
    T(engineCacheKeyForFile("/definitely/missing.xlsx").endsWith(":unknown"), "missing file degrades to a stable key");
    const p = join(tmpdir(), `cache-key-${process.pid}.xlsx`);
    writeFileSync(p, "x");
    const k1 = engineCacheKeyForFile(p);
    T(k1.startsWith(`${p}:`) && !k1.endsWith(":unknown"), "key includes the mtime");
    unlinkSync(p);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LET desugaring (model-let.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("LET desugaring", () => {
  it("rewrites simple LETs to inlined arithmetic", () => {
    T(desugarLet("=LET(x,1,x+1)") === "=((1)+1)", `simple LET, got ${desugarLet("=LET(x,1,x+1)")}`);
    T(desugarLet("=1+1") === "=1+1", "formula without LET untouched");
  });

  it("handles nesting and shadowing like Excel", () => {
    // Excel: =LET(x,1,LET(x,2,x)+x) -> 3 (inner x shadows outer in inner body)
    T(
      desugarLet("=LET(x,1,LET(x,2,x)+x)") === "=(((2))+(1))",
      `shadowed LET, got ${desugarLet("=LET(x,1,LET(x,2,x)+x)")}`,
    );
  });

  it("does not touch names inside string literals or longer identifiers", () => {
    T(desugarLet('=LET(x,1,"x, y")') === '=("x, y")', `string literal, got ${desugarLet('=LET(x,1,"x, y")')}`);
    T(desugarLet("=LET(n,2,nx+n)") === "=(nx+(2))", `longer identifier, got ${desugarLet("=LET(n,2,nx+n)")}`);
  });

  it("substitutes later names' values before earlier names", () => {
    // LET(a,1,b,a+1,b*2) -> ((1)+1)*2 = 4
    T(
      desugarLet("=LET(a,1,b,a+1,b*2)") === "=(((1)+1)*2)",
      `chained names, got ${desugarLet("=LET(a,1,b,a+1,b*2)")}`,
    );
  });

  it("leaves malformed LETs unchanged", () => {
    T(desugarLet("=LET(x,1)") === "=LET(x,1)", "too few args unchanged");
    T(desugarLet("=LET(x+1,2,x)") === "=LET(x+1,2,x)", "non-identifier name unchanged");
  });

  it("desugared LET formulas compute in the engine", () => {
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet([[null], [null], [null]]);
    ws["A1"] = { t: "n", f: "LET(x,1,x+1)" };
    ws["A2"] = { t: "n", f: "LET(x,1,LET(x,2,x)+x)" };
    ws["A3"] = { t: "n", f: "LET(_xlpm.n,3,_xlpm.n*2)" };
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    const engine = createEngineFromWorkbook(wb);
    approx(cellNum(engine, "S", "A1"), 2, "simple LET computes");
    approx(cellNum(engine, "S", "A2"), 3, "shadowed nested LET computes to Excel's 3");
    approx(cellNum(engine, "S", "A3"), 6, "_xlpm.-prefixed names (as stored in xlsx) work");
    engine.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Full-row/column reference bounding (model-ranges.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("full-row/column bounding", () => {
  // Mirrors pete.xlsx geometry: CF/Tenant_Calc start at A and end at GG;
  // TS_Map-like sheets start at B2.
  const dims = new Map<string, SheetDims>([
    ["Calc", { firstRow: 0, firstCol: 0, lastRow: 99, lastCol: 25 }], // A1:Z100
    ["CF", { firstRow: 0, firstCol: 0, lastRow: 226, lastCol: 188 }], // A1:GG227
    ["My Sheet", { firstRow: 0, firstCol: 0, lastRow: 99, lastCol: 3 }], // A1:D100
    ["Offset", { firstRow: 1, firstCol: 1, lastRow: 67, lastCol: 38 }], // B2:AM68
  ]);
  const bound = (f: string, host = "Calc") => boundFullRowColRefs(f, host, dims);

  it("bounds full-row refs to the host sheet's used columns", () => {
    T(bound("=$8:$8") === "=$A$8:$Z$8", `host row pair, got ${bound("=$8:$8")}`);
    T(bound("=8:13") === "=$A$8:$Z$13", `relative row pair, got ${bound("=8:13")}`);
    T(bound("=SUM($8:$8, 10:10)") === "=SUM($A$8:$Z$8, $A$10:$Z$10)", "two pairs in one formula");
  });

  it("bounds full-column refs to the host sheet's used rows", () => {
    T(bound("=A:A") === "=$A$1:$A$100", `column pair, got ${bound("=A:A")}`);
    T(bound("=$a:$C") === "=$A$1:$C$100", `mixed case/$ column pair, got ${bound("=$a:$C")}`);
  });

  it("uses the referenced sheet's dims for sheet-qualified refs", () => {
    T(
      bound("=LOOKUP(X,CF!$8:$8,CF!$13:$13)") === "=LOOKUP(X,CF!$A$8:$GG$8,CF!$A$13:$GG$13)",
      `sheet-qualified rows, got ${bound("=LOOKUP(X,CF!$8:$8,CF!$13:$13)")}`,
    );
    T(
      bound("='My Sheet'!A:A") === "='My Sheet'!$A$1:$A$100",
      `quoted sheet name, got ${bound("='My Sheet'!A:A")}`,
    );
  });

  it("honours sheets whose used range does not start at A1", () => {
    T(bound("=$5:$5", "Offset") === "=$B$5:$AM$5", `offset rows, got ${bound("=$5:$5", "Offset")}`);
    T(bound("=B:B", "Offset") === "=$B$2:$B$68", `offset cols, got ${bound("=B:B", "Offset")}`);
  });

  it("never touches string literals", () => {
    T(bound('=IF(A1="8:8",1,2)') === '=IF(A1="8:8",1,2)', "row pair inside string");
    T(bound('=IF(A1="CF!$8:$8",1,$8:$8)') === '=IF(A1="CF!$8:$8",1,$A$8:$Z$8)', "only the real ref is bounded");
    T(bound('="a""A:A"') === '="a""A:A"', "escaped quotes keep the string open");
  });

  it("requires identifier boundaries on both sides", () => {
    T(bound("=LOG10(A1)") === "=LOG10(A1)", "no colon at all");
    T(bound("=LOG10(A8:A10)") === "=LOG10(A8:A10)", "LOG10( and a normal range untouched");
    T(bound("=X8:8") === "=X8:8", "letter before the pair blocks the match");
    T(bound("=8:8AM") === "=8:8AM", "letter after the pair blocks the match");
    T(bound("=SUM(A1:B2)") === "=SUM(A1:B2)", "ordinary range untouched");
    T(bound("=Nope!$8:$8") === "=Nope!$8:$8", "unknown sheet left alone");
    T(bound("=CF!A8") === "=CF!A8", "sheet-qualified single cell untouched");
  });

  it("leaves formulas without colon untouched", () => {
    T(bound("=SUM(A1,A2)") === "=SUM(A1,A2)", "cheap gate");
  });

  it("bounded full-row/column refs compute in the engine", () => {
    const data: Record<string, unknown> = XLSX.utils.aoa_to_sheet([
      [null, null, null, null],
      [1, 2, 3, 4],
    ]);
    const calc: Record<string, unknown> = XLSX.utils.aoa_to_sheet([[null], [null], [null]]);
    calc["A1"] = { t: "n", f: "SUM(Data!$2:$2)" };
    calc["A2"] = { t: "n", f: "SUM(Data!B:B)" };
    calc["A3"] = { t: "n", f: "COUNT(Data!$2:$2)" };
    const wb = { SheetNames: ["Calc", "Data"], Sheets: { Calc: calc, Data: data } } as never;
    const engine = createEngineFromWorkbook(wb);
    approx(cellNum(engine, "Calc", "A1"), 10, "full-row SUM computes");
    approx(cellNum(engine, "Calc", "A2"), 2, "full-column SUM computes");
    approx(cellNum(engine, "Calc", "A3"), 4, "full-row COUNT computes");
    engine.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Position-guard folding (model-guards.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("position-guard folding", () => {
  // Row/col are 0-based: (10, 6) is G11, (10, 7) is H11.
  it("folds IF(COLUMN()=7,...) to the taken branch", () => {
    T(
      foldPositionGuards("=IF(COLUMN()=7,0,F11)+1", 10, 6) === "=0+1",
      `G11 takes the guard branch, got ${foldPositionGuards("=IF(COLUMN()=7,0,F11)+1", 10, 6)}`,
    );
    T(
      foldPositionGuards("=IF(COLUMN()=7,0,F11)+1", 10, 7) === "=F11+1",
      `H11 takes the else branch, got ${foldPositionGuards("=IF(COLUMN()=7,0,F11)+1", 10, 7)}`,
    );
  });

  it("handles ROW() and the other comparison operators", () => {
    T(foldPositionGuards("=IF(ROW()=5,10,20)", 4, 0) === "=10", "ROW() true branch");
    T(foldPositionGuards("=IF(ROW()=5,10,20)", 5, 0) === "=20", "ROW() false branch");
    T(foldPositionGuards("=IF(COLUMN()<>7,0,F11)", 10, 6) === "=F11", "<> operator");
    T(foldPositionGuards("=IF(COLUMN()>=7,1,2)", 10, 6) === "=1", ">= operator");
  });

  it("supports two-argument IF (false -> FALSE)", () => {
    T(foldPositionGuards("=IF(COLUMN()=9,7)", 0, 8) === "=7", "2-arg true");
    T(foldPositionGuards("=IF(COLUMN()=9,7)", 0, 2) === "=FALSE", "2-arg false");
  });

  it("respects strings, boundaries, and non-constant conditions", () => {
    T(
      foldPositionGuards('=IF(A1="IF(COLUMN()=7",1,2)', 10, 6) === '=IF(A1="IF(COLUMN()=7",1,2)',
      "IF( inside a string untouched",
    );
    T(foldPositionGuards("=IF(A1>5,1,2)", 10, 6) === "=IF(A1>5,1,2)", "non-constant condition untouched");
    T(
      foldPositionGuards("=SUMIF(A:A,\">0\")+IF(COLUMN()=2,1,0)", 0, 1) === '=SUMIF(A:A,">0")+1',
      `SUMIF( not matched as IF(, got ${foldPositionGuards("=SUMIF(A:A,\">0\")+IF(COLUMN()=2,1,0)", 0, 1)}`,
    );
    T(
      foldPositionGuards("=IF(COLUMN()=7,SUM(1,2),MAX(F11,3))", 10, 6) === "=SUM(1,2)",
      "branches with nested parens/commas split correctly",
    );
  });

  it("folds guards nested inside other functions", () => {
    T(
      foldPositionGuards('=MAX(IF(COLUMN()=7,0,F11),XLOOKUP(1,A:A,B:B,""))', 10, 6) ===
        '=MAX(0,XLOOKUP(1,A:A,B:B,""))',
      `guard inside MAX, got ${foldPositionGuards('=MAX(IF(COLUMN()=7,0,F11),XLOOKUP(1,A:A,B:B,""))', 10, 6)}`,
    );
  });

  it("dissolves the running-total false cycle in the engine", () => {
    // The pete.xlsx idiom: row total in F, first period guards the left-ref.
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet([
      [null, null, null, null, null, null, null, null, null],
    ]);
    ws["F1"] = { t: "n", f: "SUM(G1:I1)" };
    ws["G1"] = { t: "n", f: "IF(COLUMN()=7,0,F1)+5" };
    ws["H1"] = { t: "n", f: "IF(COLUMN()=7,0,G1)+1" };
    ws["I1"] = { t: "n", f: "IF(COLUMN()=7,0,H1)*2" };
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    const engine = createEngineFromWorkbook(wb);
    approx(cellNum(engine, "S", "G1"), 5, "first period uses 0, not F1");
    approx(cellNum(engine, "S", "H1"), 6, "second period chains from G1");
    approx(cellNum(engine, "S", "I1"), 12, "third period chains from H1");
    approx(cellNum(engine, "S", "F1"), 23, "row total computes (no #CYCLE!)");
    engine.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Circular-reference freezing (Excel no-iterative-calc semantics)
// ═══════════════════════════════════════════════════════════════════════════

describe("circular reference freezing", () => {
  it("freezes a genuine cycle at the Excel-cached value and computes dependents", () => {
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet([[null], [null], [null]]);
    ws["A1"] = { t: "n", v: 10, f: "A2*2" }; // Excel cached 10 for the circular pair
    ws["A2"] = { t: "n", v: 5, f: "A1+1" };
    ws["A3"] = { t: "n", f: "A2*100" }; // downstream of the cycle
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    const engine = createEngineFromWorkbook(wb);
    approx(cellNum(engine, "S", "A1"), 10, "cycle member frozen at cached value");
    approx(cellNum(engine, "S", "A2"), 11, "other member computes from the freeze");
    approx(cellNum(engine, "S", "A3"), 1100, "downstream computes (no #CYCLE! poisoning)");
    T(
      engine.warnings.some((w) => w.includes("Circular reference")),
      `freeze warning recorded, got ${JSON.stringify(engine.warnings)}`,
    );
    engine.dispose();
  });

  it("leaves acyclic workbooks untouched", () => {
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet([[1, 2, null]]);
    ws["C1"] = { t: "n", f: "A1+B1" };
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    const engine = createEngineFromWorkbook(wb);
    approx(cellNum(engine, "S", "C1"), 3, "plain formula");
    T(!engine.warnings.some((w) => w.includes("Circular")), "no freeze warning");
    engine.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEX whole-row/column vectors + date-text MONTH/YEAR/DAY (model-functions.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("INDEX whole-row/column selection", () => {
  function indexEngine(): ModelEngine {
    // 14 rows x 4 cols so every formula cell lands inside !ref.
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet([
      [1, 2, 3, null],
      [4, 5, 6, null],
      [7, 8, 9, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      ["a", 100, 0, null],
      ["b", 200, 1, null],
      ["c", 300, 0, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ]);
    ws["A5"] = { t: "n", f: "INDEX(A1:C3,2,3)" };
    ws["B5"] = { t: "n", f: "SUM(INDEX(A1:C3,0,2))" };
    ws["C5"] = { t: "n", f: "SUM(INDEX(A1:C3,2,0))" };
    ws["D5"] = { t: "n", f: "SUM(INDEX(A1:C3,0,0))" };
    ws["A6"] = { t: "n", f: "INDEX(A1:C3,0,4)" };
    ws["B6"] = { t: "n", f: "INDEX(A1:C3,4,0)" };
    ws["C6"] = { t: "n", f: "INDEX(A1:C3,0,-1)" };
    ws["D6"] = { t: "n", f: "INDEX(A1:C3,-1,0)" };
    ws["A7"] = { t: "n", f: "INDEX(A1:C3,3)" };
    // The Occupancy_History idiom: XLOOKUP over a computed lookup array whose
    // one factor is a whole-column INDEX vector.
    ws["A12"] = { t: "n", f: 'XLOOKUP(1,(C9:C11=1)*(INDEX(B9:B11,0,1)=200),A9:A11,"none")' };
    ws["B12"] = { t: "n", f: "SUMPRODUCT(INDEX(A1:C3,0,3))" };
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    return createEngineFromWorkbook(wb);
  }

  it("keeps the built-in scalar path identical", () => {
    const engine = indexEngine();
    approx(cellNum(engine, "S", "A5"), 6, "scalar INDEX(row,col)");
    approx(cellNum(engine, "S", "A7"), 7, "2-arg INDEX defaults col to 1");
    engine.dispose();
  });

  it("returns whole-column / whole-row / whole-range vectors for zero", () => {
    const engine = indexEngine();
    approx(cellNum(engine, "S", "B5"), 15, "INDEX(range,0,2) sums the column");
    approx(cellNum(engine, "S", "C5"), 15, "INDEX(range,2,0) sums the row");
    approx(cellNum(engine, "S", "D5"), 45, "INDEX(range,0,0) sums the range");
    approx(cellNum(engine, "S", "B12"), 18, "SUMPRODUCT over a column vector");
    engine.dispose();
  });

  it("keeps the built-in bounds and negative errors", () => {
    const engine = indexEngine();
    const colTooBig = engine.getCellValue("S", "A6");
    T(!colTooBig.ok && colTooBig.error === "#NUM!", `col past width is #NUM!, got ${JSON.stringify(colTooBig)}`);
    const rowTooBig = engine.getCellValue("S", "B6");
    T(!rowTooBig.ok && rowTooBig.error === "#NUM!", `row past height is #NUM!, got ${JSON.stringify(rowTooBig)}`);
    const negCol = engine.getCellValue("S", "C6");
    T(!negCol.ok && negCol.error === "#VALUE!", `negative col is #VALUE!, got ${JSON.stringify(negCol)}`);
    const negRow = engine.getCellValue("S", "D6");
    T(!negRow.ok && negRow.error === "#VALUE!", `negative row is #VALUE!, got ${JSON.stringify(negRow)}`);
    engine.dispose();
  });

  it("feeds a vector into XLOOKUP's computed lookup array", () => {
    const engine = indexEngine();
    const r = engine.getCellValue("S", "A12");
    T(r.ok && r.value === "b", `XLOOKUP over INDEX vector finds "b", got ${JSON.stringify(r)}`);
    engine.dispose();
  });
});

describe("MONTH/YEAR/DAY date-text coercion", () => {
  function dateEngine(): ModelEngine {
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet([
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ]);
    ws["A1"] = { t: "s", v: "Nov-2022" };
    ws["B1"] = { t: "n", f: "MONTH(A1)" };
    ws["C1"] = { t: "n", f: "YEAR(A1)" };
    ws["D1"] = { t: "n", f: "DAY(A1)" };
    ws["A2"] = { t: "n", f: 'MONTH("1 Nov 2022")' };
    ws["B2"] = { t: "n", f: 'DAY("1-Nov-2022")' };
    ws["C2"] = { t: "n", f: 'YEAR("2022-11-15")' };
    ws["D2"] = { t: "n", f: 'DAY("2022-11-15")' };
    ws["A3"] = { t: "n", f: "MONTH(DATE(2022,11,1))" };
    ws["B3"] = { t: "n", f: "MONTH(45292)" };
    ws["C3"] = { t: "n", f: 'MONTH("45292")' };
    ws["D3"] = { t: "n", f: 'MONTH("hello")' };
    ws["A4"] = { t: "n", f: "MONTH(-1)" };
    ws["B4"] = { t: "n", f: 'MONTH("AUGUST 2026")' };
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    return createEngineFromWorkbook(wb);
  }

  it("coerces month-year text the way Excel does (first of the month)", () => {
    const engine = dateEngine();
    approx(cellNum(engine, "S", "B1"), 11, 'MONTH of a "Nov-2022" cell');
    approx(cellNum(engine, "S", "C1"), 2022, 'YEAR of a "Nov-2022" cell');
    approx(cellNum(engine, "S", "D1"), 1, 'DAY of a "Nov-2022" cell');
    approx(cellNum(engine, "S", "B4"), 8, 'full month name with space ("AUGUST 2026")');
    engine.dispose();
  });

  it("coerces day-precision date text", () => {
    const engine = dateEngine();
    approx(cellNum(engine, "S", "A2"), 11, 'MONTH("1 Nov 2022")');
    approx(cellNum(engine, "S", "B2"), 1, 'DAY("1-Nov-2022")');
    approx(cellNum(engine, "S", "C2"), 2022, 'YEAR of ISO text');
    approx(cellNum(engine, "S", "D2"), 15, 'DAY of ISO text');
    engine.dispose();
  });

  it("leaves the numeric path byte-identical to the built-in", () => {
    const engine = dateEngine();
    approx(cellNum(engine, "S", "A3"), 11, "MONTH of a DATE() serial");
    approx(cellNum(engine, "S", "B3"), 1, "MONTH(45292) is January 2024");
    approx(cellNum(engine, "S", "C3"), 1, "numeric string coerces as before");
    engine.dispose();
  });

  it("keeps #VALUE! for non-date text and #NUM! for negatives", () => {
    const engine = dateEngine();
    const bad = engine.getCellValue("S", "D3");
    T(!bad.ok && bad.error === "#VALUE!", `non-date text is #VALUE!, got ${JSON.stringify(bad)}`);
    const neg = engine.getCellValue("S", "A4");
    T(!neg.ok && neg.error === "#NUM!", `negative serial is #NUM!, got ${JSON.stringify(neg)}`);
    engine.dispose();
  });
});

describe("boolean literal rewrite", () => {
  it("rewrites bare TRUE/FALSE to calls, respecting boundaries and strings", () => {
    T(
      rewriteBooleanLiterals('=IF(D23=TRUE,"OK","ERROR")') === '=IF(D23=TRUE(),"OK","ERROR")',
      `the Checks-sheet shape, got ${rewriteBooleanLiterals('=IF(D23=TRUE,"OK","ERROR")')}`,
    );
    T(rewriteBooleanLiterals('="TRUE inside a string"') === '="TRUE inside a string"', "string literal untouched");
    T(rewriteBooleanLiterals("=ISTRUE(A1)") === "=ISTRUE(A1)", "longer identifier untouched");
    T(rewriteBooleanLiterals("=TRUE()") === "=TRUE()", "already a call untouched");
    T(rewriteBooleanLiterals("=A1+1") === "=A1+1", "no token untouched");
    T(rewriteBooleanLiterals("=if(a1,true,false)") === "=if(a1,TRUE(),FALSE())", "lowercase rewritten");
  });

  it("bare TRUE/FALSE compute in the engine", () => {
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet([[null, null], [null, null], [null, null]]);
    ws["A1"] = { t: "b", v: true };
    ws["B1"] = { t: "n", f: 'IF(A1=TRUE,"OK","ERROR")' };
    ws["A2"] = { t: "n", f: "IF(1=1,TRUE,FALSE)" };
    ws["B2"] = { t: "n", f: "IF(1=2,TRUE,FALSE)" };
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    const engine = createEngineFromWorkbook(wb);
    const b1 = engine.getCellValue("S", "B1");
    T(b1.ok && b1.value === "OK", `Checks!E23 shape computes "OK", got ${JSON.stringify(b1)}`);
    const a2 = engine.getCellValue("S", "A2");
    T(a2.ok && a2.value === true, `TRUE branch literal, got ${JSON.stringify(a2)}`);
    const b2 = engine.getCellValue("S", "B2");
    T(b2.ok && b2.value === false, `FALSE branch literal, got ${JSON.stringify(b2)}`);
    engine.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("test harness", () => {
  it("executed a meaningful number of assertions", () => {
    console.log(`    golden-maths assertion count: ${assertionCount}`);
    T(assertionCount > 150, `expected >150 assertions, ran ${assertionCount}`);
  });
});
