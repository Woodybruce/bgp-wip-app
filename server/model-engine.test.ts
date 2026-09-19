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
  type ModelEngine,
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
  it("a circular reference loads and surfaces #CYCLE! without crashing", () => {
    const ws: Record<string, unknown> = XLSX.utils.aoa_to_sheet([[null], [null]]);
    ws["A1"] = { t: "n", f: "A2+1" };
    ws["A2"] = { t: "n", f: "A1+1" };
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    const engine = createEngineFromWorkbook(wb);
    const a1 = engine.getCellValue("S", "A1");
    const a2 = engine.getCellValue("S", "A2");
    T(!a1.ok && a1.error === "#CYCLE!", `A1 is #CYCLE!, got ${JSON.stringify(a1)}`);
    T(!a2.ok && a2.error === "#CYCLE!", `A2 is #CYCLE!, got ${JSON.stringify(a2)}`);
    T(engine.collectErrors().some((e) => e.error === "#CYCLE!"), "collectErrors lists the cycle");
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
    ws["A1"] = { t: "n", f: "A2+1" };
    ws["A2"] = { t: "n", f: "A1+1" };
    const wb = { SheetNames: ["S"], Sheets: { S: ws } } as never;
    const engine = createEngineFromWorkbook(wb);
    const { outputs, errors } = readEngineOutputs(engine, {
      blank: { sheet: "S", cell: "B9" },
      cycle: { sheet: "S", cell: "A1" },
      missingSheet: { sheet: "Nope", cell: "A1" },
      noMapping: undefined as never,
    });
    T(outputs.blank === null, "blank output is null");
    T(outputs.cycle === "#CYCLE!", "error output carries the error string");
    T(typeof outputs.missingSheet === "string", "missing sheet output carries the error string");
    T(outputs.noMapping === null, "unmapped output is null");
    T(errors.length === 2, `two errors listed, got ${errors.length}`);
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
