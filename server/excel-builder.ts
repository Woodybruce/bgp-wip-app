/**
 * Professional Excel Model Builder using ExcelJS
 *
 * Generates institutional-quality investment appraisal models with:
 * - 6 interconnected sheets (Summary, Assumptions, Cash Flow, Debt Schedule, Sensitivity, Returns Analysis)
 * - Real working Excel formulas with cross-sheet references
 * - Named ranges for all input cells
 * - BGP brand formatting, conditional formatting, data validation
 * - Freeze panes, print setup, cell protection
 */

import * as ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";

// ─── BGP Brand Logo ─────────────────────────────────────────────────────────

// Resolve the BGP logo across dev and production build paths.
function loadBGPLogo(): Buffer | null {
  const candidates = [
    path.join(process.cwd(), "server", "assets", "BGP_BlackHolder.png"),
    path.join(process.cwd(), "dist", "server", "assets", "BGP_BlackHolder.png"),
    path.join(process.cwd(), "client", "src", "assets", "BGP_BlackHolder.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch {}
  }
  return null;
}

// ─── BGP Brand Colors ───────────────────────────────────────────────────────

const BGP_GREEN = 'FF2E5E3F';
const BGP_DARK = 'FF1A3A28';
const BGP_LIGHT = 'FFE8F0EB';
const BGP_GOLD = 'FFC4A35A';
const INPUT_YELLOW = 'FFFFFDE7';
const INPUT_BLUE = 'FF1565C0';
const SECTION_GRAY = 'FFF5F5F5';
const WHITE = 'FFFFFFFF';
const BLACK = 'FF000000';
const RED_NEGATIVE = 'FFC62828';
const GREEN_POSITIVE = 'FF2E7D32';
const BORDER_GRAY = 'FFB0BEC5';
const BORDER_DARK = 'FF546E7A';
const TOTAL_BG = 'FFE0E0E0';

// ─── Number Formats ─────────────────────────────────────────────────────────

const NUMBER_FORMATS: Record<string, string> = {
  currency: '£#,##0',
  currency_neg: '£#,##0;[Red](£#,##0)',
  currency_k: '£#,##0,"K"',
  currency_m: '£#,##0.0,,"M"',
  percentage: '0.00%',
  percentage_1dp: '0.0%',
  multiple: '0.00"x"',
  integer: '#,##0',
  decimal: '#,##0.00',
  date: 'DD-MMM-YYYY',
  accounting: '£#,##0;[Red](£#,##0)',
  sqft: '#,##0 "sq ft"',
  psf: '£#,##0.00 "/sq ft"',
  bps: '0 "bps"',
};

// ─── Style Presets ──────────────────────────────────────────────────────────

const FONT_DEFAULT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10 };
const FONT_TITLE: Partial<ExcelJS.Font> = { name: 'Calibri', size: 16, bold: true, color: { argb: WHITE } };
const FONT_SECTION: Partial<ExcelJS.Font> = { name: 'Calibri', size: 11, bold: true, color: { argb: WHITE } };
const FONT_SUBSECTION: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, bold: true, color: { argb: BGP_DARK } };
const FONT_LABEL: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, color: { argb: 'FF424242' } };
const FONT_INPUT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, bold: true, color: { argb: INPUT_BLUE } };
const FONT_FORMULA: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, color: { argb: BLACK } };
const FONT_TOTAL: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, bold: true, color: { argb: BLACK } };

const FILL_TITLE: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: BGP_DARK } };
const FILL_SECTION: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: BGP_GREEN } };
const FILL_SUBSECTION: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: BGP_LIGHT } };
const FILL_INPUT: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_YELLOW } };
const FILL_TOTAL: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } };
const FILL_GRAY: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_GRAY } };

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: BORDER_GRAY } },
  left: { style: 'thin', color: { argb: BORDER_GRAY } },
  bottom: { style: 'thin', color: { argb: BORDER_GRAY } },
  right: { style: 'thin', color: { argb: BORDER_GRAY } },
};

const BORDER_TOTAL: Partial<ExcelJS.Borders> = {
  top: { style: 'medium', color: { argb: BORDER_DARK } },
  left: { style: 'thin', color: { argb: BORDER_GRAY } },
  bottom: { style: 'double', color: { argb: BORDER_DARK } },
  right: { style: 'thin', color: { argb: BORDER_GRAY } },
};

const BORDER_BOTTOM_THIN: Partial<ExcelJS.Borders> = {
  bottom: { style: 'thin', color: { argb: BORDER_GRAY } },
};

// ─── Type Definitions ───────────────────────────────────────────────────────

type CellStyle = 'title' | 'section_header' | 'sub_header' | 'label' | 'input' | 'formula' | 'total' | 'subtotal' | 'percentage' | 'currency' | 'date' | 'blank';

interface AssumptionInput {
  label: string;
  value: number | string;
  format: string;
  namedRange: string;
  note?: string;
  category: string;
  validation?: { type: string; values?: string[]; min?: number; max?: number };
}

interface InvestmentModelParams {
  modelName: string;
  assumptions: Record<string, any>;
  quarters?: number;
}

interface DCFModelParams {
  modelName: string;
  assumptions: Record<string, any>;
  years?: number;
  discountRate?: number;
}

// ─── Helper Functions ───────────────────────────────────────────────────────

function colLetter(colNum: number): string {
  let result = '';
  let n = colNum;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function applyStyle(cell: ExcelJS.Cell, style: CellStyle, numFmt?: string): void {
  switch (style) {
    case 'title':
      cell.font = FONT_TITLE;
      cell.fill = FILL_TITLE;
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      break;
    case 'section_header':
      cell.font = FONT_SECTION;
      cell.fill = FILL_SECTION;
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = BORDER_THIN;
      break;
    case 'sub_header':
      cell.font = FONT_SUBSECTION;
      cell.fill = FILL_SUBSECTION;
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = BORDER_THIN;
      break;
    case 'label':
      cell.font = FONT_LABEL;
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cell.border = BORDER_BOTTOM_THIN;
      break;
    case 'input':
      cell.font = FONT_INPUT;
      cell.fill = FILL_INPUT;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.border = BORDER_THIN;
      cell.protection = { locked: false };
      break;
    case 'formula':
      cell.font = FONT_FORMULA;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.border = BORDER_THIN;
      break;
    case 'total':
      cell.font = FONT_TOTAL;
      cell.fill = FILL_TOTAL;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.border = BORDER_TOTAL;
      break;
    case 'subtotal':
      cell.font = { ...FONT_TOTAL, size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.border = { ...BORDER_THIN, top: { style: 'thin', color: { argb: BORDER_DARK } }, bottom: { style: 'thin', color: { argb: BORDER_DARK } } };
      break;
    case 'percentage':
      cell.font = FONT_FORMULA;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.border = BORDER_THIN;
      break;
    case 'currency':
      cell.font = FONT_FORMULA;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.border = BORDER_THIN;
      break;
    case 'date':
      cell.font = FONT_FORMULA;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = BORDER_THIN;
      break;
    case 'blank':
      break;
  }
  if (numFmt) {
    cell.numFmt = NUMBER_FORMATS[numFmt] || numFmt;
  }
}

function setVal(ws: ExcelJS.Worksheet, row: number, col: number, value: any, style: CellStyle, numFmt?: string): ExcelJS.Cell {
  const cell = ws.getCell(row, col);
  cell.value = value;
  applyStyle(cell, style, numFmt);
  return cell;
}

function setFormula(ws: ExcelJS.Worksheet, row: number, col: number, formula: string, style: CellStyle, numFmt?: string): ExcelJS.Cell {
  const cell = ws.getCell(row, col);
  cell.value = { formula } as ExcelJS.CellFormulaValue;
  applyStyle(cell, style, numFmt);
  return cell;
}

function addSectionHeader(ws: ExcelJS.Worksheet, row: number, label: string, lastCol: number): number {
  for (let c = 1; c <= lastCol; c++) {
    const cell = ws.getCell(row, c);
    cell.fill = FILL_SECTION;
    cell.border = BORDER_THIN;
  }
  const cell = ws.getCell(row, 2);
  cell.value = label;
  cell.font = FONT_SECTION;
  cell.fill = FILL_SECTION;
  return row;
}

function addSubHeader(ws: ExcelJS.Worksheet, row: number, label: string, lastCol: number): number {
  for (let c = 1; c <= lastCol; c++) {
    const cell = ws.getCell(row, c);
    cell.fill = FILL_SUBSECTION;
    cell.border = BORDER_THIN;
  }
  const cell = ws.getCell(row, 2);
  cell.value = label;
  cell.font = FONT_SUBSECTION;
  cell.fill = FILL_SUBSECTION;
  return row;
}

// ─── Default Assumptions ────────────────────────────────────────────────────

function getDefaultAssumptions(overrides: Record<string, any> = {}): Record<string, AssumptionInput> {
  const defaults: Record<string, AssumptionInput> = {
    // Acquisition
    purchasePrice: { label: 'Purchase Price', value: 10000000, format: 'currency', namedRange: 'PurchasePrice', category: 'Acquisition', note: 'Headline price' },
    stampDutyRate: { label: 'Stamp Duty Rate', value: 0.05, format: 'percentage', namedRange: 'StampDutyRate', category: 'Acquisition' },
    acquisitionCostsRate: { label: 'Acquisition Costs (%)', value: 0.018, format: 'percentage', namedRange: 'AcquisitionCostsRate', category: 'Acquisition', note: 'Legal, DD, surveys' },
    agentFeeRate: { label: 'Agent Fee (%)', value: 0.01, format: 'percentage', namedRange: 'AgentFeeRate', category: 'Acquisition' },

    // Income
    currentRentPA: { label: 'Current Passing Rent (p.a.)', value: 500000, format: 'currency', namedRange: 'CurrentRentPA', category: 'Income' },
    totalAreaSqFt: { label: 'Total Lettable Area', value: 5000, format: 'sqft', namedRange: 'TotalAreaSqFt', category: 'Income' },
    ervPerSqFt: { label: 'ERV (per sq ft)', value: 120, format: 'psf', namedRange: 'ERVPerSqFt', category: 'Income' },
    rentGrowthPA: { label: 'Rental Growth (p.a.)', value: 0.025, format: 'percentage', namedRange: 'RentGrowthPA', category: 'Income' },
    voidPeriodMonths: { label: 'Void Period (months)', value: 3, format: 'integer', namedRange: 'VoidPeriodMonths', category: 'Income', validation: { type: 'whole', min: 0, max: 36 } },
    rentFreeMonths: { label: 'Rent Free Period (months)', value: 6, format: 'integer', namedRange: 'RentFreeMonths', category: 'Income', validation: { type: 'whole', min: 0, max: 24 } },

    // Operating Costs
    managementFeeRate: { label: 'Management Fee (%)', value: 0.03, format: 'percentage', namedRange: 'ManagementFeeRate', category: 'Costs', note: '% of gross rent' },
    vacancyRate: { label: 'Structural Vacancy (%)', value: 0.05, format: 'percentage', namedRange: 'VacancyRate', category: 'Costs' },
    opexPerSqFt: { label: 'Non-Recoverable OpEx (/sq ft)', value: 5, format: 'psf', namedRange: 'OpExPerSqFt', category: 'Costs' },
    capexReserveRate: { label: 'CapEx Reserve (% of rent)', value: 0.05, format: 'percentage', namedRange: 'CapExReserveRate', category: 'Costs' },
    costInflationPA: { label: 'Cost Inflation (p.a.)', value: 0.02, format: 'percentage', namedRange: 'CostInflationPA', category: 'Costs' },

    // Financing
    ltv: { label: 'Loan to Value (%)', value: 0.60, format: 'percentage', namedRange: 'LTV', category: 'Financing' },
    interestRate: { label: 'All-in Interest Rate', value: 0.055, format: 'percentage', namedRange: 'InterestRate', category: 'Financing' },
    loanTermYears: { label: 'Loan Term (years)', value: 5, format: 'integer', namedRange: 'LoanTermYears', category: 'Financing', validation: { type: 'whole', min: 1, max: 30 } },
    amortisationType: { label: 'Amortisation Type', value: 'Interest Only', format: 'text', namedRange: 'AmortisationType', category: 'Financing', validation: { type: 'list', values: ['Interest Only', 'Fully Amortising', 'Partial Amortisation'] } },
    arrangementFeeRate: { label: 'Arrangement Fee (%)', value: 0.015, format: 'percentage', namedRange: 'ArrangementFeeRate', category: 'Financing' },

    // Exit
    exitCapRate: { label: 'Exit Cap Rate', value: 0.055, format: 'percentage', namedRange: 'ExitCapRate', category: 'Exit' },
    disposalCostsRate: { label: 'Disposal Costs (%)', value: 0.02, format: 'percentage', namedRange: 'DisposalCostsRate', category: 'Exit', note: 'Agent + legal on exit' },
    holdPeriodYears: { label: 'Hold Period (years)', value: 5, format: 'integer', namedRange: 'HoldPeriodYears', category: 'Exit', validation: { type: 'whole', min: 1, max: 25 } },

    // Dates
    acquisitionDate: { label: 'Acquisition Date', value: '2025-07-01', format: 'date', namedRange: 'AcquisitionDate', category: 'Dates' },

    // Tax
    corporateTaxRate: { label: 'Corporation Tax Rate', value: 0.25, format: 'percentage', namedRange: 'CorporateTaxRate', category: 'Tax' },

    // Sensitivity
    sensitivityVar1: { label: 'Sensitivity Variable 1', value: 'Exit Cap Rate', format: 'text', namedRange: 'SensVar1', category: 'Sensitivity' },
    sensitivityVar2: { label: 'Sensitivity Variable 2', value: 'Rental Growth', format: 'text', namedRange: 'SensVar2', category: 'Sensitivity' },
  };

  // Apply overrides
  for (const [key, val] of Object.entries(overrides)) {
    if (defaults[key]) {
      if (typeof val === 'object' && val !== null) {
        defaults[key] = { ...defaults[key], ...val };
      } else {
        defaults[key].value = val;
      }
    }
  }

  return defaults;
}

// ─── Sheet 2: Assumptions ───────────────────────────────────────────────────

interface AssumptionRowMap {
  [namedRange: string]: number; // row number for each named range
}

function buildAssumptionsSheet(wb: ExcelJS.Workbook, assumptions: Record<string, AssumptionInput>): { ws: ExcelJS.Worksheet; rowMap: AssumptionRowMap } {
  const ws = wb.addWorksheet('Assumptions', {
    properties: { defaultColWidth: 12 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

  ws.columns = [
    { width: 3 },   // A - spacer
    { width: 35 },  // B - labels
    { width: 18 },  // C - values
    { width: 30 },  // D - notes
  ];

  // Title row
  ws.mergeCells('B1:D1');
  const titleCell = ws.getCell('B1');
  titleCell.value = 'ASSUMPTIONS';
  applyStyle(titleCell, 'title');
  ws.getRow(1).height = 32;
  for (let c = 1; c <= 4; c++) {
    ws.getCell(1, c).fill = FILL_TITLE;
  }

  // Column headers
  setVal(ws, 2, 2, 'Parameter', 'sub_header');
  setVal(ws, 2, 3, 'Value', 'sub_header');
  setVal(ws, 2, 4, 'Notes', 'sub_header');
  ws.getRow(2).height = 22;

  // Group assumptions by category
  const categories = ['Acquisition', 'Income', 'Costs', 'Financing', 'Exit', 'Dates', 'Tax', 'Sensitivity'];
  const grouped: Record<string, Array<[string, AssumptionInput]>> = {};
  for (const cat of categories) grouped[cat] = [];
  for (const [key, val] of Object.entries(assumptions)) {
    const cat = val.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push([key, val]);
  }

  let row = 3;
  const rowMap: AssumptionRowMap = {};

  for (const cat of categories) {
    const items = grouped[cat];
    if (!items || items.length === 0) continue;

    // Blank row before category
    row++;

    // Category header
    addSectionHeader(ws, row, cat.toUpperCase(), 4);
    ws.getRow(row).height = 22;
    row++;

    for (const [key, item] of items) {
      // Label
      setVal(ws, row, 2, item.label, 'label');

      // Value
      const valCell = ws.getCell(row, 3);
      if (item.format === 'date' && typeof item.value === 'string') {
        valCell.value = new Date(item.value);
        applyStyle(valCell, 'input', 'date');
      } else if (item.format === 'text') {
        valCell.value = item.value;
        applyStyle(valCell, 'input');
      } else {
        valCell.value = typeof item.value === 'number' ? item.value : parseFloat(String(item.value)) || 0;
        applyStyle(valCell, 'input', item.format);
      }

      // Note
      if (item.note) {
        const noteCell = ws.getCell(row, 4);
        noteCell.value = item.note;
        noteCell.font = { ...FONT_LABEL, italic: true, size: 9, color: { argb: 'FF757575' } };
      }

      // Data validation
      if (item.validation) {
        if (item.validation.type === 'list' && item.validation.values) {
          // Excel list-validation expects a single quoted, comma-separated string.
          // Individual items must not contain commas (Excel's list separator) or
          // double quotes. Strip them defensively so we never emit malformed XML
          // that Excel has to "repair" on open.
          const sanitised = item.validation.values
            .map((v: string) => String(v).replace(/[",]/g, ' ').trim())
            .filter(Boolean);
          const joined = sanitised.join(',');
          // Excel caps the list formula at 255 characters. If we exceed, skip
          // data validation entirely rather than writing an invalid file.
          if (joined.length > 0 && joined.length <= 255) {
            valCell.dataValidation = {
              type: 'list',
              allowBlank: false,
              formulae: [`"${joined}"`],
              showErrorMessage: true,
              errorTitle: 'Invalid',
              error: `Please select from: ${sanitised.join(', ')}`,
            };
          }
        } else if (item.validation.type === 'whole') {
          valCell.dataValidation = {
            type: 'whole',
            operator: 'between',
            allowBlank: false,
            formulae: [String(item.validation.min ?? 0), String(item.validation.max ?? 100)],
            showErrorMessage: true,
            errorTitle: 'Invalid',
            error: `Enter a whole number between ${item.validation.min ?? 0} and ${item.validation.max ?? 100}`,
          };
        }
      }

      // Named range
      if (item.namedRange) {
        rowMap[item.namedRange] = row;
        wb.definedNames.add(`Assumptions!$C$${row}`, item.namedRange);
      }

      row++;
    }
  }

  // Calculated fields section
  row++;
  addSectionHeader(ws, row, 'CALCULATED FIELDS', 4);
  ws.getRow(row).height = 22;
  row++;

  // Stamp Duty Amount
  setVal(ws, row, 2, 'Stamp Duty', 'label');
  setFormula(ws, row, 3, `PurchasePrice*StampDutyRate`, 'formula', 'currency');
  rowMap['StampDuty'] = row;
  wb.definedNames.add(`Assumptions!$C$${row}`, 'StampDuty');
  row++;

  // Acquisition Costs Amount
  setVal(ws, row, 2, 'Acquisition Costs', 'label');
  setFormula(ws, row, 3, `PurchasePrice*AcquisitionCostsRate`, 'formula', 'currency');
  rowMap['AcquisitionCosts'] = row;
  wb.definedNames.add(`Assumptions!$C$${row}`, 'AcquisitionCosts');
  row++;

  // Agent Fee
  setVal(ws, row, 2, 'Agent Fee', 'label');
  setFormula(ws, row, 3, `PurchasePrice*AgentFeeRate`, 'formula', 'currency');
  rowMap['AgentFee'] = row;
  wb.definedNames.add(`Assumptions!$C$${row}`, 'AgentFee');
  row++;

  // Total Acquisition Cost
  setVal(ws, row, 2, 'Total Acquisition Cost', 'label');
  setFormula(ws, row, 3, `PurchasePrice+StampDuty+AcquisitionCosts+AgentFee`, 'total', 'currency');
  rowMap['TotalAcquisitionCost'] = row;
  wb.definedNames.add(`Assumptions!$C$${row}`, 'TotalAcquisitionCost');
  row++;

  // Loan Amount
  row++;
  setVal(ws, row, 2, 'Loan Amount', 'label');
  setFormula(ws, row, 3, `PurchasePrice*LTV`, 'formula', 'currency');
  rowMap['LoanAmount'] = row;
  wb.definedNames.add(`Assumptions!$C$${row}`, 'LoanAmount');
  row++;

  // Arrangement Fee
  setVal(ws, row, 2, 'Arrangement Fee', 'label');
  setFormula(ws, row, 3, `LoanAmount*ArrangementFeeRate`, 'formula', 'currency');
  rowMap['ArrangementFee'] = row;
  wb.definedNames.add(`Assumptions!$C$${row}`, 'ArrangementFee');
  row++;

  // Equity Contribution
  setVal(ws, row, 2, 'Equity Contribution', 'label');
  setFormula(ws, row, 3, `TotalAcquisitionCost-LoanAmount+ArrangementFee`, 'total', 'currency');
  rowMap['EquityContribution'] = row;
  wb.definedNames.add(`Assumptions!$C$${row}`, 'EquityContribution');
  row++;

  // Quarterly Interest Payment
  row++;
  setVal(ws, row, 2, 'Quarterly Interest Payment', 'label');
  setFormula(ws, row, 3, `LoanAmount*InterestRate/4`, 'formula', 'currency');
  rowMap['QuarterlyInterest'] = row;
  wb.definedNames.add(`Assumptions!$C$${row}`, 'QuarterlyInterest');
  row++;

  // Hold Period Quarters
  setVal(ws, row, 2, 'Hold Period (quarters)', 'label');
  setFormula(ws, row, 3, `HoldPeriodYears*4`, 'formula', 'integer');
  rowMap['HoldPeriodQuarters'] = row;
  wb.definedNames.add(`Assumptions!$C$${row}`, 'HoldPeriodQuarters');
  row++;

  // Loan Term Quarters
  setVal(ws, row, 2, 'Loan Term (quarters)', 'label');
  setFormula(ws, row, 3, `LoanTermYears*4`, 'formula', 'integer');
  rowMap['LoanTermQuarters'] = row;
  wb.definedNames.add(`Assumptions!$C$${row}`, 'LoanTermQuarters');
  row++;

  // ERV Total
  setVal(ws, row, 2, 'ERV (total p.a.)', 'label');
  setFormula(ws, row, 3, `ERVPerSqFt*TotalAreaSqFt`, 'formula', 'currency');
  rowMap['ERVTotal'] = row;
  wb.definedNames.add(`Assumptions!$C$${row}`, 'ERVTotal');
  row++;

  // NIY
  setVal(ws, row, 2, 'Net Initial Yield', 'label');
  setFormula(ws, row, 3, `CurrentRentPA/TotalAcquisitionCost`, 'formula', 'percentage');
  rowMap['NIY'] = row;
  wb.definedNames.add(`Assumptions!$C$${row}`, 'NIY');
  row++;

  // Reversionary Yield
  setVal(ws, row, 2, 'Reversionary Yield', 'label');
  setFormula(ws, row, 3, `ERVTotal/TotalAcquisitionCost`, 'formula', 'percentage');
  rowMap['ReversionaryYield'] = row;
  wb.definedNames.add(`Assumptions!$C$${row}`, 'ReversionaryYield');
  row++;

  // Freeze panes: freeze row 2 and column B
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2, topLeftCell: 'B3', activeCell: 'C5' }];

  // Protection: lock formula cells, unlock inputs
  ws.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatCells: true });

  return { ws, rowMap };
}

// ─── Sheet 3: Cash Flow ─────────────────────────────────────────────────────

function buildCashFlowSheet(wb: ExcelJS.Workbook, quarters: number, rowMap: AssumptionRowMap): ExcelJS.Worksheet {
  const ws = wb.addWorksheet('Cash Flow', {
    properties: { defaultColWidth: 14 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

  const totalCols = quarters + 4; // A=spacer, B=labels, C=Entry, D=Exit, E..=Q1..Qn
  const lastDataCol = quarters + 4;

  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 16;
  for (let c = 5; c <= lastDataCol; c++) {
    ws.getColumn(c).width = 14;
  }

  // Row 1: Title
  ws.mergeCells(1, 2, 1, Math.min(lastDataCol, 10));
  const titleCell = ws.getCell(1, 2);
  titleCell.value = 'CASH FLOW PROJECTION';
  applyStyle(titleCell, 'title');
  ws.getRow(1).height = 32;
  for (let c = 1; c <= lastDataCol; c++) {
    ws.getCell(1, c).fill = FILL_TITLE;
  }

  // Row 2: Column headers
  setVal(ws, 2, 2, '', 'sub_header');
  setVal(ws, 2, 3, 'Entry', 'sub_header');
  setVal(ws, 2, 4, 'Exit', 'sub_header');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const c = ws.getCell(2, col);
    c.value = `Q${q}`;
    applyStyle(c, 'sub_header');
  }
  ws.getRow(2).height = 22;

  // Row 3: Dates
  setVal(ws, 3, 2, 'Date', 'label');
  setFormula(ws, 3, 3, 'AcquisitionDate', 'date', 'date');
  // Exit date = acquisition date + hold period
  setFormula(ws, 3, 4, `DATE(YEAR(AcquisitionDate)+HoldPeriodYears,MONTH(AcquisitionDate),DAY(AcquisitionDate))`, 'date', 'date');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    if (q === 1) {
      setFormula(ws, 3, col, 'AcquisitionDate', 'date', 'date');
    } else {
      const prevCol = colLetter(col - 1);
      setFormula(ws, 3, col, `DATE(YEAR(${prevCol}3),MONTH(${prevCol}3)+3,DAY(${prevCol}3))`, 'date', 'date');
    }
  }

  // Row 4: Year labels
  setVal(ws, 4, 2, 'Year', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    setFormula(ws, 4, col, `YEAR(${cl}3)`, 'formula', '#,##0');
  }

  let r = 5; // current row

  // ── BLANK ROW
  r++;

  // ── GROSS INCOME SECTION
  r = addSectionHeader(ws, r, 'GROSS INCOME', lastDataCol);
  r++;

  const rentRow = r;
  setVal(ws, r, 2, 'Passing Rent (quarterly)', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    // Rent grows annually: CurrentRentPA/4 * (1+RentGrowthPA)^(quarter_year)
    setFormula(ws, r, col, `CurrentRentPA/4*(1+RentGrowthPA)^INT((${q}-1)/4)`, 'formula', 'currency');
  }
  r++;

  const voidRow = r;
  setVal(ws, r, 2, 'Void Allowance', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    // Void: if quarter is within void period (in quarters), no rent
    setFormula(ws, r, col, `IF(${q}<=VoidPeriodMonths/3,-${cl}${rentRow},0)`, 'formula', 'currency');
  }
  r++;

  const rentFreeRow = r;
  setVal(ws, r, 2, 'Rent Free Adjustment', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    setFormula(ws, r, col, `IF(AND(${q}>VoidPeriodMonths/3,${q}<=VoidPeriodMonths/3+RentFreeMonths/3),-${cl}${rentRow},0)`, 'formula', 'currency');
  }
  r++;

  const vacancyRow = r;
  setVal(ws, r, 2, 'Structural Vacancy', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    setFormula(ws, r, col, `-${cl}${rentRow}*VacancyRate`, 'formula', 'currency');
  }
  r++;

  const griRow = r;
  setVal(ws, r, 2, 'Gross Rental Income', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    setFormula(ws, r, col, `${cl}${rentRow}+${cl}${voidRow}+${cl}${rentFreeRow}+${cl}${vacancyRow}`, 'subtotal', 'currency');
  }
  r++;

  // ── BLANK ROW
  r++;

  // ── OPERATING EXPENSES SECTION
  r = addSectionHeader(ws, r, 'OPERATING EXPENSES', lastDataCol);
  r++;

  const mgmtFeeRow = r;
  setVal(ws, r, 2, 'Management Fee', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    setFormula(ws, r, col, `-${cl}${griRow}*ManagementFeeRate`, 'formula', 'currency');
  }
  r++;

  const opexRow = r;
  setVal(ws, r, 2, 'Non-Recoverable OpEx', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    setFormula(ws, r, col, `-(OpExPerSqFt*TotalAreaSqFt/4)*(1+CostInflationPA)^INT((${q}-1)/4)`, 'formula', 'currency');
  }
  r++;

  const capexRow = r;
  setVal(ws, r, 2, 'CapEx Reserve', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    setFormula(ws, r, col, `-ABS(${cl}${griRow})*CapExReserveRate`, 'formula', 'currency');
  }
  r++;

  const totalOpexRow = r;
  setVal(ws, r, 2, 'Total Operating Expenses', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    setFormula(ws, r, col, `${cl}${mgmtFeeRow}+${cl}${opexRow}+${cl}${capexRow}`, 'subtotal', 'currency');
  }
  r++;

  // ── BLANK ROW
  r++;

  // ── NOI SECTION
  r = addSectionHeader(ws, r, 'NET OPERATING INCOME', lastDataCol);
  r++;

  const noiRow = r;
  setVal(ws, r, 2, 'Net Operating Income (NOI)', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    setFormula(ws, r, col, `${cl}${griRow}+${cl}${totalOpexRow}`, 'total', 'currency');
  }
  r++;

  // ── BLANK ROW
  r++;

  // ── DEBT SERVICE SECTION
  r = addSectionHeader(ws, r, 'DEBT SERVICE', lastDataCol);
  r++;

  const interestRow = r;
  setVal(ws, r, 2, 'Interest Payment', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    setFormula(ws, r, col, `IF(${q}<=LoanTermQuarters,-LoanAmount*InterestRate/4,0)`, 'formula', 'currency');
  }
  r++;

  const principalRow = r;
  setVal(ws, r, 2, 'Principal Repayment', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    // For interest-only: principal = 0; for amortising: use PMT
    setFormula(ws, r, col,
      `IF(AmortisationType="Interest Only",0,IF(${q}<=LoanTermQuarters,-PMT(InterestRate/4,LoanTermQuarters,LoanAmount)-(-LoanAmount*InterestRate/4),0))`,
      'formula', 'currency');
  }
  r++;

  const totalDebtRow = r;
  setVal(ws, r, 2, 'Total Debt Service', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    setFormula(ws, r, col, `${cl}${interestRow}+${cl}${principalRow}`, 'subtotal', 'currency');
  }
  r++;

  // ── BLANK ROW
  r++;

  // ── UNLEVERED CASH FLOW
  r = addSectionHeader(ws, r, 'UNLEVERED CASH FLOW', lastDataCol);
  r++;

  const acquCFRow = r;
  setVal(ws, r, 2, 'Acquisition Cost', 'label');
  setFormula(ws, r, 3, `-TotalAcquisitionCost`, 'formula', 'currency');
  r++;

  const unlevCFRow = r;
  setVal(ws, r, 2, 'Quarterly Unlevered CF', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    setFormula(ws, r, col, `${cl}${noiRow}`, 'formula', 'currency');
  }
  r++;

  // Exit proceeds (unlevered)
  const exitNOIRow = r;
  setVal(ws, r, 2, 'Terminal NOI (annualised)', 'label');
  const lastQCol = colLetter(quarters + 4);
  setFormula(ws, r, 4, `${lastQCol}${noiRow}*4`, 'formula', 'currency');
  r++;

  const grossExitRow = r;
  setVal(ws, r, 2, 'Gross Exit Value', 'label');
  setFormula(ws, r, 4, `D${exitNOIRow}/ExitCapRate`, 'formula', 'currency');
  r++;

  const disposalCostsRow = r;
  setVal(ws, r, 2, 'Disposal Costs', 'label');
  setFormula(ws, r, 4, `-D${grossExitRow}*DisposalCostsRate`, 'formula', 'currency');
  r++;

  const netExitRow = r;
  setVal(ws, r, 2, 'Net Exit Proceeds (Unlevered)', 'label');
  setFormula(ws, r, 4, `D${grossExitRow}+D${disposalCostsRow}`, 'total', 'currency');
  r++;

  // ── BLANK ROW
  r++;

  // ── TOTAL UNLEVERED CASH FLOW (for XIRR)
  const unlevTotalRow = r;
  setVal(ws, r, 2, 'Total Unlevered Cash Flow', 'label');
  setFormula(ws, r, 3, `C${acquCFRow}`, 'total', 'currency');
  setFormula(ws, r, 4, `D${netExitRow}`, 'total', 'currency');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    if (q === quarters) {
      setFormula(ws, r, col, `${cl}${unlevCFRow}+D${netExitRow}`, 'total', 'currency');
    } else {
      setFormula(ws, r, col, `${cl}${unlevCFRow}`, 'total', 'currency');
    }
  }
  r++;

  // Dates row for XIRR
  const unlevDateRow = r;
  setVal(ws, r, 2, 'XIRR Dates', 'label');
  setFormula(ws, r, 3, 'AcquisitionDate', 'date', 'date');
  setFormula(ws, r, 4, `DATE(YEAR(AcquisitionDate)+HoldPeriodYears,MONTH(AcquisitionDate),DAY(AcquisitionDate))`, 'date', 'date');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    setFormula(ws, r, col, `${cl}3`, 'date', 'date');
  }
  r++;

  // ── BLANK ROW
  r++;

  // ── LEVERED CASH FLOW
  r = addSectionHeader(ws, r, 'LEVERED CASH FLOW', lastDataCol);
  r++;

  const equityCFRow = r;
  setVal(ws, r, 2, 'Equity Outlay', 'label');
  setFormula(ws, r, 3, `-EquityContribution`, 'formula', 'currency');
  r++;

  const levCFRow = r;
  setVal(ws, r, 2, 'Quarterly Levered CF', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    setFormula(ws, r, col, `${cl}${noiRow}+${cl}${totalDebtRow}`, 'formula', 'currency');
  }
  r++;

  // Exit: repay loan
  const loanRepayRow = r;
  setVal(ws, r, 2, 'Loan Repayment at Exit', 'label');
  setFormula(ws, r, 4, `-LoanAmount`, 'formula', 'currency');
  r++;

  const netExitLevRow = r;
  setVal(ws, r, 2, 'Net Exit Proceeds (Levered)', 'label');
  setFormula(ws, r, 4, `D${netExitRow}+D${loanRepayRow}`, 'total', 'currency');
  r++;

  // ── BLANK ROW
  r++;

  // ── TOTAL LEVERED CASH FLOW (for XIRR)
  const levTotalRow = r;
  setVal(ws, r, 2, 'Total Levered Cash Flow', 'label');
  setFormula(ws, r, 3, `C${equityCFRow}`, 'total', 'currency');
  setFormula(ws, r, 4, `D${netExitLevRow}`, 'total', 'currency');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    const cl = colLetter(col);
    if (q === quarters) {
      setFormula(ws, r, col, `${cl}${levCFRow}+D${netExitLevRow}`, 'total', 'currency');
    } else {
      setFormula(ws, r, col, `${cl}${levCFRow}`, 'total', 'currency');
    }
  }
  r++;

  // ── BLANK ROW
  r++;

  // ── IRR SECTION
  r = addSectionHeader(ws, r, 'RETURNS', lastDataCol);
  r++;

  // Unlevered IRR
  const unlevIRRRow = r;
  setVal(ws, r, 2, 'Unlevered IRR (XIRR)', 'label');
  const cfRange1 = `C${unlevTotalRow}:${lastQCol}${unlevTotalRow}`;
  const dateRange1 = `C${unlevDateRow}:${lastQCol}${unlevDateRow}`;
  setFormula(ws, r, 3, `XIRR(${cfRange1},${dateRange1})`, 'total', 'percentage');
  ws.getCell(r, 3).font = { ...FONT_TOTAL, size: 12, color: { argb: BGP_GREEN } };
  r++;

  // Levered IRR
  const levIRRRow = r;
  setVal(ws, r, 2, 'Levered IRR (XIRR)', 'label');
  const cfRange2 = `C${levTotalRow}:${lastQCol}${levTotalRow}`;
  setFormula(ws, r, 3, `XIRR(${cfRange2},${dateRange1})`, 'total', 'percentage');
  ws.getCell(r, 3).font = { ...FONT_TOTAL, size: 12, color: { argb: BGP_GREEN } };
  r++;

  // Equity Multiple (unlevered)
  const unlevMOICRow = r;
  setVal(ws, r, 2, 'Unlevered Equity Multiple', 'label');
  setFormula(ws, r, 3, `(SUM(E${unlevTotalRow}:${lastQCol}${unlevTotalRow})+D${unlevTotalRow})/(-C${unlevTotalRow})`, 'total', 'multiple');
  r++;

  // Equity Multiple (levered)
  const levMOICRow = r;
  setVal(ws, r, 2, 'Levered Equity Multiple', 'label');
  setFormula(ws, r, 3, `(SUM(E${levTotalRow}:${lastQCol}${levTotalRow})+D${levTotalRow})/(-C${levTotalRow})`, 'total', 'multiple');
  r++;

  // Profit (unlevered)
  const unlevProfitRow = r;
  setVal(ws, r, 2, 'Unlevered Total Profit', 'label');
  setFormula(ws, r, 3, `SUM(C${unlevTotalRow}:${lastQCol}${unlevTotalRow})+D${unlevTotalRow}`, 'total', 'currency');
  r++;

  // Profit (levered)
  const levProfitRow = r;
  setVal(ws, r, 2, 'Levered Total Profit', 'label');
  setFormula(ws, r, 3, `SUM(C${levTotalRow}:${lastQCol}${levTotalRow})+D${levTotalRow}`, 'total', 'currency');
  r++;

  // Store key row references as named ranges
  wb.definedNames.add(`'Cash Flow'!$C$${unlevIRRRow}`, 'UnleveredIRR');
  wb.definedNames.add(`'Cash Flow'!$C$${levIRRRow}`, 'LeveredIRR');
  wb.definedNames.add(`'Cash Flow'!$C$${unlevMOICRow}`, 'UnleveredMOIC');
  wb.definedNames.add(`'Cash Flow'!$C$${levMOICRow}`, 'LeveredMOIC');
  wb.definedNames.add(`'Cash Flow'!$C$${unlevProfitRow}`, 'UnleveredProfit');
  wb.definedNames.add(`'Cash Flow'!$C$${levProfitRow}`, 'LeveredProfit');

  // Conditional formatting: negative values in red
  for (let row = 6; row <= r; row++) {
    for (let c = 3; c <= lastDataCol; c++) {
      const cell = ws.getCell(row, c);
      if (cell.value && typeof cell.value === 'object' && 'formula' in cell.value) {
        // ExcelJS conditional formatting needs to be added per-range
      }
    }
  }

  // Add conditional formatting for negative values
  ws.addConditionalFormatting({
    ref: `C6:${colLetter(lastDataCol)}${r}`,
    rules: [{
      type: 'cellIs',
      operator: 'lessThan',
      priority: 1,
      formulae: [0],
      style: { font: { color: { argb: RED_NEGATIVE } } },
    }],
  });

  // Freeze panes
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 3, topLeftCell: 'C4', activeCell: 'E6' }];

  return ws;
}

// ─── Sheet 4: Debt Schedule ─────────────────────────────────────────────────

function buildDebtScheduleSheet(wb: ExcelJS.Workbook, quarters: number): ExcelJS.Worksheet {
  const ws = wb.addWorksheet('Debt Schedule', {
    properties: { defaultColWidth: 14 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

  const lastDataCol = quarters + 2; // A=spacer, B=labels, C..=Q1..Qn

  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 30;
  for (let c = 3; c <= lastDataCol; c++) {
    ws.getColumn(c).width = 14;
  }

  // Row 1: Title
  ws.mergeCells(1, 2, 1, Math.min(lastDataCol, 10));
  const titleCell = ws.getCell(1, 2);
  titleCell.value = 'DEBT SCHEDULE';
  applyStyle(titleCell, 'title');
  ws.getRow(1).height = 32;
  for (let c = 1; c <= lastDataCol; c++) {
    ws.getCell(1, c).fill = FILL_TITLE;
  }

  // Row 2: headers
  setVal(ws, 2, 2, '', 'sub_header');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    setVal(ws, 2, col, `Q${q}`, 'sub_header');
  }
  ws.getRow(2).height = 22;

  // Row 3: Dates
  setVal(ws, 3, 2, 'Date', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    if (q === 1) {
      setFormula(ws, 3, col, 'AcquisitionDate', 'date', 'date');
    } else {
      const prevCol = colLetter(col - 1);
      setFormula(ws, 3, col, `DATE(YEAR(${prevCol}3),MONTH(${prevCol}3)+3,DAY(${prevCol}3))`, 'date', 'date');
    }
  }

  let r = 4;
  r++;

  // Loan Parameters Section
  r = addSectionHeader(ws, r, 'LOAN PARAMETERS', lastDataCol);
  r++;

  setVal(ws, r, 2, 'Loan Amount', 'label');
  setFormula(ws, r, 3, 'LoanAmount', 'formula', 'currency');
  r++;

  setVal(ws, r, 2, 'Interest Rate (p.a.)', 'label');
  setFormula(ws, r, 3, 'InterestRate', 'formula', 'percentage');
  r++;

  setVal(ws, r, 2, 'Quarterly Rate', 'label');
  setFormula(ws, r, 3, 'InterestRate/4', 'formula', 'percentage');
  r++;

  setVal(ws, r, 2, 'Term (quarters)', 'label');
  setFormula(ws, r, 3, 'LoanTermQuarters', 'formula', 'integer');
  r++;

  setVal(ws, r, 2, 'Amortisation', 'label');
  setFormula(ws, r, 3, 'AmortisationType', 'formula');
  r++;

  // Quarterly PMT (for amortising)
  const pmtRow = r;
  setVal(ws, r, 2, 'Quarterly PMT (if amortising)', 'label');
  setFormula(ws, r, 3, `IF(AmortisationType="Interest Only",LoanAmount*InterestRate/4,PMT(InterestRate/4,LoanTermQuarters,-LoanAmount))`, 'formula', 'currency');
  r++;

  r++;

  // Amortisation Schedule
  r = addSectionHeader(ws, r, 'AMORTISATION SCHEDULE', lastDataCol);
  r++;

  // Opening Balance
  const openBalRow = r;
  setVal(ws, r, 2, 'Opening Balance', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    if (q === 1) {
      setFormula(ws, r, col, 'LoanAmount', 'formula', 'currency');
    } else {
      const prevCol = colLetter(col - 1);
      setFormula(ws, r, col, `${prevCol}${openBalRow + 4}`, 'formula', 'currency');  // closing balance of prev quarter
    }
  }
  r++;

  // Interest
  const intRow = r;
  setVal(ws, r, 2, 'Interest', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const cl = colLetter(col);
    setFormula(ws, r, col, `IF(${q}<=LoanTermQuarters,${cl}${openBalRow}*InterestRate/4,0)`, 'formula', 'currency');
  }
  r++;

  // Principal
  const princRow = r;
  setVal(ws, r, 2, 'Principal Repayment', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const cl = colLetter(col);
    setFormula(ws, r, col,
      `IF(AmortisationType="Interest Only",0,IF(${q}<=LoanTermQuarters,$C$${pmtRow}-${cl}${intRow},0))`,
      'formula', 'currency');
  }
  r++;

  // Total Debt Service
  const totalDSRow = r;
  setVal(ws, r, 2, 'Total Debt Service', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const cl = colLetter(col);
    setFormula(ws, r, col, `${cl}${intRow}+${cl}${princRow}`, 'subtotal', 'currency');
  }
  r++;

  // Closing Balance
  const closeBalRow = r;
  setVal(ws, r, 2, 'Closing Balance', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const cl = colLetter(col);
    setFormula(ws, r, col, `${cl}${openBalRow}-${cl}${princRow}`, 'total', 'currency');
  }
  r++;

  r++;

  // ── METRICS
  r = addSectionHeader(ws, r, 'DEBT METRICS', lastDataCol);
  r++;

  // Cumulative Interest
  const cumIntRow = r;
  setVal(ws, r, 2, 'Cumulative Interest', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const cl = colLetter(col);
    if (q === 1) {
      setFormula(ws, r, col, `${cl}${intRow}`, 'formula', 'currency');
    } else {
      const prevCol = colLetter(col - 1);
      setFormula(ws, r, col, `${prevCol}${cumIntRow}+${cl}${intRow}`, 'formula', 'currency');
    }
  }
  r++;

  // LTV at each period
  setVal(ws, r, 2, 'LTV (on purchase price)', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const cl = colLetter(col);
    setFormula(ws, r, col, `IF(PurchasePrice>0,${cl}${closeBalRow}/PurchasePrice,0)`, 'percentage', 'percentage');
  }
  r++;

  // DSCR
  setVal(ws, r, 2, 'DSCR', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const qCFCol = colLetter(q + 4); // Cash Flow sheet columns start at E (col 5)
    // Reference NOI from Cash Flow - we use a cross-sheet reference
    setFormula(ws, r, col, `IF(ABS(${colLetter(col)}${totalDSRow})>0,'Cash Flow'!${qCFCol}6/ABS(${colLetter(col)}${totalDSRow}),0)`, 'formula', 'decimal');
  }
  r++;

  // Interest Cover Ratio
  setVal(ws, r, 2, 'Interest Cover Ratio', 'label');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const qCFCol = colLetter(q + 4);
    setFormula(ws, r, col, `IF(ABS(${colLetter(col)}${intRow})>0,'Cash Flow'!${qCFCol}6/ABS(${colLetter(col)}${intRow}),0)`, 'formula', 'decimal');
  }
  r++;

  // Freeze panes
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 3, topLeftCell: 'C4', activeCell: 'C5' }];

  // Conditional formatting for LTV > 75%
  ws.addConditionalFormatting({
    ref: `C${r - 2}:${colLetter(lastDataCol)}${r - 2}`,
    rules: [{
      type: 'cellIs',
      operator: 'greaterThan',
      priority: 1,
      formulae: [0.75],
      style: { font: { color: { argb: RED_NEGATIVE }, bold: true } },
    }],
  });

  return ws;
}

// ─── Sheet 5: Sensitivity Analysis ──────────────────────────────────────────

function buildSensitivitySheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
  const ws = wb.addWorksheet('Sensitivity', {
    properties: { defaultColWidth: 14 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 22;

  // Title
  ws.mergeCells('B1:J1');
  const titleCell = ws.getCell('B1');
  titleCell.value = 'SENSITIVITY ANALYSIS';
  applyStyle(titleCell, 'title');
  ws.getRow(1).height = 32;
  for (let c = 1; c <= 10; c++) {
    ws.getCell(1, c).fill = FILL_TITLE;
  }

  // ── Unlevered IRR Sensitivity: Exit Cap Rate vs Rent Growth ──
  let r = 3;

  r = addSectionHeader(ws, r, 'UNLEVERED IRR — Exit Cap Rate vs Rental Growth', 10);
  r++;

  // Exit cap rate variations (rows): 4.0%, 4.5%, 5.0%, 5.5%, 6.0%, 6.5%, 7.0%
  const exitCapRates = [0.040, 0.045, 0.050, 0.055, 0.060, 0.065, 0.070];
  // Rent growth variations (columns): 0.0%, 1.0%, 1.5%, 2.0%, 2.5%, 3.0%, 3.5%, 4.0%
  const rentGrowths = [0.000, 0.010, 0.015, 0.020, 0.025, 0.030, 0.035, 0.040];

  // Corner cell with formula reference
  setVal(ws, r, 2, 'Exit Cap Rate \\ Rent Growth', 'sub_header');

  // Column headers (rent growth rates)
  for (let j = 0; j < rentGrowths.length; j++) {
    const col = j + 3;
    const c = ws.getCell(r, col);
    c.value = rentGrowths[j];
    applyStyle(c, 'sub_header', 'percentage_1dp');
  }
  r++;

  // Base IRR cell (hidden calculation helper) — this references the main model IRR
  const baseIRRRow = r;
  setVal(ws, r, 2, 'Base Unlevered IRR', 'label');
  setFormula(ws, r, 3, 'UnleveredIRR', 'formula', 'percentage');
  r++;

  // Explanation
  setVal(ws, r, 2, 'Note: approximate sensitivities', 'label');
  ws.getCell(r, 2).font = { ...FONT_LABEL, italic: true, size: 9 };
  r++;

  // Sensitivity grid: each cell adjusts IRR based on deviation from base assumptions
  // This uses approximate sensitivities since Excel can't re-run XIRR for each combo
  // We use a linear approximation: IRR_adj = BaseIRR + (RentGrowth_change * sensitivity_coeff) - (ExitCap_change * sensitivity_coeff)
  for (let i = 0; i < exitCapRates.length; i++) {
    const row = r + i;
    // Row header (exit cap rate)
    const rowHeader = ws.getCell(row, 2);
    rowHeader.value = exitCapRates[i];
    applyStyle(rowHeader, 'label', 'percentage_1dp');
    rowHeader.font = { ...FONT_LABEL, bold: true };

    for (let j = 0; j < rentGrowths.length; j++) {
      const col = j + 3;
      // Approximate IRR sensitivity:
      // deltaExit = this cap rate - ExitCapRate (base)
      // deltaRent = this rent growth - RentGrowthPA (base)
      // IRR ~ BaseIRR - 2*deltaExit + 1.5*deltaRent (reasonable approximation for property)
      const exitRate = exitCapRates[i];
      const rentGrowth = rentGrowths[j];
      setFormula(ws, row, col,
        `$C$${baseIRRRow}-2*(${exitRate}-ExitCapRate)+1.5*(${rentGrowth}-RentGrowthPA)`,
        'formula', 'percentage');
    }
  }

  // Conditional formatting for the IRR grid: green > 10%, red < 5%
  const gridRef = `C${r}:${colLetter(2 + rentGrowths.length)}${r + exitCapRates.length - 1}`;
  ws.addConditionalFormatting({
    ref: gridRef,
    rules: [
      {
        type: 'cellIs',
        operator: 'greaterThan',
        priority: 1,
        formulae: [0.10],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC8E6C9' } }, font: { color: { argb: GREEN_POSITIVE }, bold: true } },
      },
      {
        type: 'cellIs',
        operator: 'lessThan',
        priority: 2,
        formulae: [0.05],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFCDD2' } }, font: { color: { argb: RED_NEGATIVE }, bold: true } },
      },
    ],
  });

  r += exitCapRates.length + 2;

  // ── Levered IRR Sensitivity ──
  r = addSectionHeader(ws, r, 'LEVERED IRR — Exit Cap Rate vs LTV', 10);
  r++;

  const ltvs = [0.40, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75];

  setVal(ws, r, 2, 'Exit Cap Rate \\ LTV', 'sub_header');
  for (let j = 0; j < ltvs.length; j++) {
    const col = j + 3;
    const c = ws.getCell(r, col);
    c.value = ltvs[j];
    applyStyle(c, 'sub_header', 'percentage');
  }
  r++;

  const baseLevIRRRow = r;
  setVal(ws, r, 2, 'Base Levered IRR', 'label');
  setFormula(ws, r, 3, 'LeveredIRR', 'formula', 'percentage');
  r++;

  r++; // spacer

  for (let i = 0; i < exitCapRates.length; i++) {
    const row = r + i;
    const rowHeader = ws.getCell(row, 2);
    rowHeader.value = exitCapRates[i];
    applyStyle(rowHeader, 'label', 'percentage_1dp');
    rowHeader.font = { ...FONT_LABEL, bold: true };

    for (let j = 0; j < ltvs.length; j++) {
      const col = j + 3;
      const exitRate = exitCapRates[i];
      const ltvVal = ltvs[j];
      // Leverage amplifies returns: higher LTV = more amplification
      // IRR_lev ~ BaseIRR_lev - 2*(exitCap - base) + (LTV - baseLTV)*BaseIRR_lev/(1-baseLTV)
      setFormula(ws, row, col,
        `$C$${baseLevIRRRow}-2*(${exitRate}-ExitCapRate)+(${ltvVal}-LTV)*$C$${baseLevIRRRow}/(1-LTV)`,
        'formula', 'percentage');
    }
  }

  // Conditional formatting
  const gridRef2 = `C${r}:${colLetter(2 + ltvs.length)}${r + exitCapRates.length - 1}`;
  ws.addConditionalFormatting({
    ref: gridRef2,
    rules: [
      {
        type: 'cellIs',
        operator: 'greaterThan',
        priority: 1,
        formulae: [0.15],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC8E6C9' } }, font: { color: { argb: GREEN_POSITIVE }, bold: true } },
      },
      {
        type: 'cellIs',
        operator: 'lessThan',
        priority: 2,
        formulae: [0.05],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFCDD2' } }, font: { color: { argb: RED_NEGATIVE }, bold: true } },
      },
    ],
  });

  // Freeze panes
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1, topLeftCell: 'C2', activeCell: 'C4' }];

  return ws;
}

// ─── Sheet 6: Returns Analysis ──────────────────────────────────────────────

function buildReturnsSheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
  const ws = wb.addWorksheet('Returns Analysis', {
    properties: { defaultColWidth: 16 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 35;
  ws.getColumn(3).width = 20;
  ws.getColumn(4).width = 20;
  ws.getColumn(5).width = 20;

  // Title
  ws.mergeCells('B1:E1');
  const titleCell = ws.getCell('B1');
  titleCell.value = 'RETURNS ANALYSIS';
  applyStyle(titleCell, 'title');
  ws.getRow(1).height = 32;
  for (let c = 1; c <= 5; c++) {
    ws.getCell(1, c).fill = FILL_TITLE;
  }

  // Headers
  setVal(ws, 2, 2, 'Metric', 'sub_header');
  setVal(ws, 2, 3, 'Unlevered', 'sub_header');
  setVal(ws, 2, 4, 'Levered', 'sub_header');
  setVal(ws, 2, 5, 'Notes', 'sub_header');
  ws.getRow(2).height = 22;

  let r = 3;

  // Key Returns
  r++;
  r = addSectionHeader(ws, r, 'KEY RETURNS', 5);
  r++;

  setVal(ws, r, 2, 'Internal Rate of Return (IRR)', 'label');
  setFormula(ws, r, 3, 'UnleveredIRR', 'total', 'percentage');
  setFormula(ws, r, 4, 'LeveredIRR', 'total', 'percentage');
  r++;

  setVal(ws, r, 2, 'Equity Multiple (MOIC)', 'label');
  setFormula(ws, r, 3, 'UnleveredMOIC', 'total', 'multiple');
  setFormula(ws, r, 4, 'LeveredMOIC', 'total', 'multiple');
  r++;

  setVal(ws, r, 2, 'Total Profit', 'label');
  setFormula(ws, r, 3, 'UnleveredProfit', 'total', 'currency');
  setFormula(ws, r, 4, 'LeveredProfit', 'total', 'currency');
  r++;

  // Investment Summary
  r++;
  r = addSectionHeader(ws, r, 'INVESTMENT SUMMARY', 5);
  r++;

  setVal(ws, r, 2, 'Purchase Price', 'label');
  setFormula(ws, r, 3, 'PurchasePrice', 'formula', 'currency');
  r++;

  setVal(ws, r, 2, 'Total Acquisition Cost', 'label');
  setFormula(ws, r, 3, 'TotalAcquisitionCost', 'formula', 'currency');
  r++;

  setVal(ws, r, 2, 'Equity Required', 'label');
  setFormula(ws, r, 3, 'EquityContribution', 'formula', 'currency');
  r++;

  setVal(ws, r, 2, 'Loan Amount', 'label');
  setFormula(ws, r, 3, 'LoanAmount', 'formula', 'currency');
  r++;

  setVal(ws, r, 2, 'LTV', 'label');
  setFormula(ws, r, 3, 'LTV', 'formula', 'percentage');
  r++;

  // Yields
  r++;
  r = addSectionHeader(ws, r, 'YIELD ANALYSIS', 5);
  r++;

  setVal(ws, r, 2, 'Net Initial Yield (NIY)', 'label');
  setFormula(ws, r, 3, 'NIY', 'formula', 'percentage');
  setVal(ws, r, 5, 'Passing rent / total cost', 'label');
  ws.getCell(r, 5).font = { ...FONT_LABEL, italic: true, size: 9 };
  r++;

  setVal(ws, r, 2, 'Reversionary Yield', 'label');
  setFormula(ws, r, 3, 'ReversionaryYield', 'formula', 'percentage');
  setVal(ws, r, 5, 'ERV / total cost', 'label');
  ws.getCell(r, 5).font = { ...FONT_LABEL, italic: true, size: 9 };
  r++;

  setVal(ws, r, 2, 'Exit Cap Rate', 'label');
  setFormula(ws, r, 3, 'ExitCapRate', 'formula', 'percentage');
  r++;

  setVal(ws, r, 2, 'Current Rent (p.a.)', 'label');
  setFormula(ws, r, 3, 'CurrentRentPA', 'formula', 'currency');
  r++;

  setVal(ws, r, 2, 'ERV (total p.a.)', 'label');
  setFormula(ws, r, 3, 'ERVTotal', 'formula', 'currency');
  r++;

  // Cash Flow Summary
  r++;
  r = addSectionHeader(ws, r, 'CASH FLOW PROFILE', 5);
  r++;

  setVal(ws, r, 2, 'Hold Period (years)', 'label');
  setFormula(ws, r, 3, 'HoldPeriodYears', 'formula', 'integer');
  r++;

  setVal(ws, r, 2, 'Rental Growth (p.a.)', 'label');
  setFormula(ws, r, 3, 'RentGrowthPA', 'formula', 'percentage');
  r++;

  setVal(ws, r, 2, 'Interest Rate', 'label');
  setFormula(ws, r, 3, 'InterestRate', 'formula', 'percentage');
  r++;

  // Profit Waterfall
  r++;
  r = addSectionHeader(ws, r, 'PROFIT WATERFALL (UNLEVERED)', 5);
  r++;

  setVal(ws, r, 2, 'Total Acquisition Cost', 'label');
  setFormula(ws, r, 3, '-TotalAcquisitionCost', 'formula', 'currency');
  setVal(ws, r, 4, '', 'blank');
  setVal(ws, r, 5, 'Day 1 outflow', 'label');
  ws.getCell(r, 5).font = { ...FONT_LABEL, italic: true, size: 9 };
  const waterfallStart = r;
  r++;

  setVal(ws, r, 2, 'Total Rental Income (net)', 'label');
  setFormula(ws, r, 3, 'UnleveredProfit+TotalAcquisitionCost', 'formula', 'currency');
  setVal(ws, r, 5, 'Sum of all quarterly NOI + exit proceeds', 'label');
  ws.getCell(r, 5).font = { ...FONT_LABEL, italic: true, size: 9 };
  r++;

  setVal(ws, r, 2, 'Net Profit / (Loss)', 'label');
  setFormula(ws, r, 3, 'UnleveredProfit', 'total', 'currency');
  r++;

  // Conditional formatting for returns
  ws.addConditionalFormatting({
    ref: `C5:D5`,
    rules: [{
      type: 'cellIs',
      operator: 'greaterThan',
      priority: 1,
      formulae: [0.08],
      style: { font: { color: { argb: GREEN_POSITIVE }, bold: true, size: 12 } },
    }],
  });

  // Freeze panes
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 2, topLeftCell: 'C3', activeCell: 'C5' }];

  return ws;
}

// ─── Sheet 1: Summary Dashboard ─────────────────────────────────────────────

function buildSummarySheet(wb: ExcelJS.Workbook, modelName: string): ExcelJS.Worksheet {
  const ws = wb.addWorksheet('Summary', {
    properties: { defaultColWidth: 14 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

  // Move to first position
  wb.removeWorksheet(ws.id);
  const wsNew = wb.addWorksheet('Summary', {
    properties: { defaultColWidth: 14 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

  const wsRef = wsNew;
  wsRef.getColumn(1).width = 3;
  wsRef.getColumn(2).width = 28;
  wsRef.getColumn(3).width = 18;
  wsRef.getColumn(4).width = 5;
  wsRef.getColumn(5).width = 28;
  wsRef.getColumn(6).width = 18;

  // BGP Logo — embedded in the title bar
  const logoBuffer = loadBGPLogo();
  if (logoBuffer) {
    try {
      const imageId = wb.addImage({ buffer: logoBuffer as any, extension: 'png' });
      wsRef.addImage(imageId, {
        tl: { col: 5.1, row: 0.1 },
        ext: { width: 140, height: 50 },
        editAs: 'oneCell',
      });
    } catch {
      // If image embedding fails, fall back to text-only title.
    }
  }

  // Title
  wsRef.mergeCells('B1:F1');
  const titleCell = wsRef.getCell('B1');
  titleCell.value = modelName.toUpperCase();
  applyStyle(titleCell, 'title');
  wsRef.getRow(1).height = 50;
  for (let c = 1; c <= 6; c++) {
    wsRef.getCell(1, c).fill = FILL_TITLE;
  }

  // Subtitle
  wsRef.mergeCells('B2:F2');
  const subCell = wsRef.getCell('B2');
  subCell.value = 'Bruce Gillingham Pollard — Investment Appraisal';
  subCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: BGP_GREEN } };
  subCell.fill = FILL_SUBSECTION;
  wsRef.getRow(2).height = 24;
  for (let c = 1; c <= 6; c++) {
    wsRef.getCell(2, c).fill = FILL_SUBSECTION;
  }

  let r = 4;

  // KEY RETURNS
  r = addSectionHeader(wsRef, r, 'KEY RETURNS', 6);
  r++;

  setVal(wsRef, r, 2, 'Unlevered IRR', 'label');
  setFormula(wsRef, r, 3, 'UnleveredIRR', 'total', 'percentage');
  wsRef.getCell(r, 3).font = { ...FONT_TOTAL, size: 14, color: { argb: BGP_GREEN } };
  setVal(wsRef, r, 5, 'Levered IRR', 'label');
  setFormula(wsRef, r, 6, 'LeveredIRR', 'total', 'percentage');
  wsRef.getCell(r, 6).font = { ...FONT_TOTAL, size: 14, color: { argb: BGP_GREEN } };
  r++;

  setVal(wsRef, r, 2, 'Unlevered Multiple', 'label');
  setFormula(wsRef, r, 3, 'UnleveredMOIC', 'total', 'multiple');
  setVal(wsRef, r, 5, 'Levered Multiple', 'label');
  setFormula(wsRef, r, 6, 'LeveredMOIC', 'total', 'multiple');
  r++;

  setVal(wsRef, r, 2, 'Unlevered Profit', 'label');
  setFormula(wsRef, r, 3, 'UnleveredProfit', 'total', 'currency');
  setVal(wsRef, r, 5, 'Levered Profit', 'label');
  setFormula(wsRef, r, 6, 'LeveredProfit', 'total', 'currency');
  r++;

  r++;

  // ACQUISITION
  r = addSectionHeader(wsRef, r, 'ACQUISITION', 6);
  r++;

  setVal(wsRef, r, 2, 'Purchase Price', 'label');
  setFormula(wsRef, r, 3, 'PurchasePrice', 'formula', 'currency');
  setVal(wsRef, r, 5, 'Total Area', 'label');
  setFormula(wsRef, r, 6, 'TotalAreaSqFt', 'formula', 'sqft');
  r++;

  setVal(wsRef, r, 2, 'Total Acquisition Cost', 'label');
  setFormula(wsRef, r, 3, 'TotalAcquisitionCost', 'formula', 'currency');
  setVal(wsRef, r, 5, 'Current Rent (p.a.)', 'label');
  setFormula(wsRef, r, 6, 'CurrentRentPA', 'formula', 'currency');
  r++;

  setVal(wsRef, r, 2, 'Equity Required', 'label');
  setFormula(wsRef, r, 3, 'EquityContribution', 'formula', 'currency');
  setVal(wsRef, r, 5, 'ERV (p.a.)', 'label');
  setFormula(wsRef, r, 6, 'ERVTotal', 'formula', 'currency');
  r++;

  r++;

  // YIELDS
  r = addSectionHeader(wsRef, r, 'YIELDS', 6);
  r++;

  setVal(wsRef, r, 2, 'Net Initial Yield', 'label');
  setFormula(wsRef, r, 3, 'NIY', 'formula', 'percentage');
  setVal(wsRef, r, 5, 'Exit Cap Rate', 'label');
  setFormula(wsRef, r, 6, 'ExitCapRate', 'formula', 'percentage');
  r++;

  setVal(wsRef, r, 2, 'Reversionary Yield', 'label');
  setFormula(wsRef, r, 3, 'ReversionaryYield', 'formula', 'percentage');
  setVal(wsRef, r, 5, 'Rental Growth (p.a.)', 'label');
  setFormula(wsRef, r, 6, 'RentGrowthPA', 'formula', 'percentage');
  r++;

  r++;

  // FINANCING
  r = addSectionHeader(wsRef, r, 'FINANCING', 6);
  r++;

  setVal(wsRef, r, 2, 'Loan Amount', 'label');
  setFormula(wsRef, r, 3, 'LoanAmount', 'formula', 'currency');
  setVal(wsRef, r, 5, 'LTV', 'label');
  setFormula(wsRef, r, 6, 'LTV', 'formula', 'percentage');
  r++;

  setVal(wsRef, r, 2, 'Interest Rate', 'label');
  setFormula(wsRef, r, 3, 'InterestRate', 'formula', 'percentage');
  setVal(wsRef, r, 5, 'Loan Term', 'label');
  setFormula(wsRef, r, 6, 'LoanTermYears', 'formula', 'integer');
  r++;

  setVal(wsRef, r, 2, 'Hold Period (years)', 'label');
  setFormula(wsRef, r, 3, 'HoldPeriodYears', 'formula', 'integer');
  setVal(wsRef, r, 5, 'Amortisation', 'label');
  setFormula(wsRef, r, 6, 'AmortisationType', 'formula');
  r++;

  // Conditional formatting for IRRs
  wsRef.addConditionalFormatting({
    ref: 'C5:C5',
    rules: [{
      type: 'cellIs',
      operator: 'greaterThan',
      priority: 1,
      formulae: [0.08],
      style: { font: { color: { argb: GREEN_POSITIVE }, bold: true } },
    }],
  });

  // Freeze panes
  wsRef.views = [{ state: 'frozen', xSplit: 1, ySplit: 3, topLeftCell: 'B4', activeCell: 'C5' }];

  return wsRef;
}

// ─── Apply BGP Branding ─────────────────────────────────────────────────────

export function applyBGPBranding(workbook: ExcelJS.Workbook): void {
  workbook.creator = 'Bruce Gillingham Pollard';
  workbook.lastModifiedBy = 'BGP Model Studio';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.company = 'Bruce Gillingham Pollard';

  // Set workbook properties
  workbook.properties.date1904 = false;

  // Ensure all sheets have print setup
  workbook.eachSheet((sheet) => {
    sheet.pageSetup = {
      ...sheet.pageSetup,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9, // A4
      horizontalCentered: true,
      printTitlesRow: '1:3',
    };

    // Header/footer
    sheet.headerFooter = {
      oddHeader: '&L&"Calibri,Bold"&10Bruce Gillingham Pollard&R&"Calibri"&8&D',
      oddFooter: '&L&"Calibri"&8Confidential&C&"Calibri"&8Page &P of &N&R&"Calibri"&8BGP Model Studio',
    };
  });
}

// ─── Main Export: Build Investment Model ─────────────────────────────────────

export async function buildInvestmentModel(params: InvestmentModelParams): Promise<Buffer> {
  const { modelName, assumptions: rawAssumptions, quarters = 20 } = params;

  const wb = new ExcelJS.Workbook();
  applyBGPBranding(wb);

  // Parse assumptions with defaults
  const assumptions = getDefaultAssumptions(rawAssumptions);

  // Build sheets in order (Summary will be repositioned to first)
  const { ws: assumptionsWs, rowMap } = buildAssumptionsSheet(wb, assumptions);
  const cashFlowWs = buildCashFlowSheet(wb, quarters, rowMap);
  const debtWs = buildDebtScheduleSheet(wb, quarters);
  const sensitivityWs = buildSensitivitySheet(wb);
  const returnsWs = buildReturnsSheet(wb);

  // Build summary sheet (it uses named ranges from other sheets)
  // We need to add it first in the workbook order
  // ExcelJS adds sheets in order, so we'll reorder
  const summaryWs = buildSummarySheet(wb, modelName);

  // Reorder sheets: Summary first
  // ExcelJS doesn't have a direct reorder method, but we can set the order via orderNo
  // The sheets are: Assumptions, Cash Flow, Debt Schedule, Sensitivity, Returns Analysis, Summary
  // We want: Summary, Assumptions, Cash Flow, Debt Schedule, Sensitivity, Returns Analysis
  // We'll rebuild the workbook order by accessing internal properties
  try {
    const worksheets = wb.worksheets;
    const summaryIdx = worksheets.findIndex(s => s.name === 'Summary');
    if (summaryIdx > 0) {
      // Move Summary to index 0 by adjusting orderNo
      worksheets.forEach((ws, i) => {
        if (ws.name === 'Summary') {
          (ws as any).orderNo = 0;
        } else {
          (ws as any).orderNo = i + 1;
        }
      });
      worksheets.sort((a: any, b: any) => (a.orderNo || 0) - (b.orderNo || 0));
    }
  } catch {
    // If reordering fails, Summary will just be last - acceptable
  }

  // Write to buffer
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── DCF Model Builder ──────────────────────────────────────────────────────

export async function buildDCFModel(params: DCFModelParams): Promise<Buffer> {
  const { modelName, assumptions: rawAssumptions, years = 10, discountRate = 0.08 } = params;

  // DCF uses annual periods instead of quarterly
  const quarters = years * 4;

  // Add/override DCF-specific assumptions
  const dcfOverrides = {
    ...rawAssumptions,
    holdPeriodYears: { value: years },
    discountRate: { label: 'Discount Rate', value: discountRate, format: 'percentage', namedRange: 'DiscountRate', category: 'Exit' },
  };

  return buildInvestmentModel({
    modelName,
    assumptions: dcfOverrides,
    quarters,
  });
}

// ─── Analyse what was built (for the response) ─────────────────────────────

export function analyzeAdvancedWorkbook(wb: ExcelJS.Workbook): { sheets: { name: string; rows: number; cols: number }[]; namedRanges: string[]; formulaCount: number } {
  const sheets: { name: string; rows: number; cols: number }[] = [];
  let formulaCount = 0;
  const namedRanges: string[] = [];

  wb.eachSheet((ws) => {
    let maxRow = 0;
    let maxCol = 0;
    ws.eachRow((row, rowNum) => {
      if (rowNum > maxRow) maxRow = rowNum;
      row.eachCell((cell, colNum) => {
        if (colNum > maxCol) maxCol = colNum;
        if (cell.value && typeof cell.value === 'object' && 'formula' in cell.value) {
          formulaCount++;
        }
      });
    });
    sheets.push({ name: ws.name, rows: maxRow, cols: maxCol });
  });

  // Collect named ranges
  try {
    const names = (wb as any)._definedNames;
    if (names && names._matrixMap) {
      for (const [name] of Object.entries(names._matrixMap)) {
        if (!name.startsWith('_')) namedRanges.push(name);
      }
    }
  } catch {
    // Named ranges extraction failed - not critical
  }

  return { sheets, namedRanges, formulaCount };
}

// ─── Addin Model Builder (JSON definition for Office.js) ────────────────

interface AddinCellDef {
  cell: string;
  value?: string | number;
  formula?: string;
  numberFormat?: string;
  bold?: boolean;
  fontColor?: string;
  fillColor?: string;
  fontSize?: number;
  horizontalAlignment?: string;
  borders?: 'thin' | 'medium' | 'thick';
  merge?: string;
}

interface AddinSheetDef {
  name: string;
  columnWidths: Record<number, number>;
  freezeRow: number;
  freezeCol: number;
  cells: AddinCellDef[];
  namedRanges?: Array<{ name: string; range: string }>;
}

interface AddinModelDefinition {
  sheets: AddinSheetDef[];
}

// Number format lookup (same as above but as Excel format strings)
const NF: Record<string, string> = {
  currency: '£#,##0',
  currency_neg: '£#,##0;[Red](£#,##0)',
  percentage: '0.00%',
  percentage_1dp: '0.0%',
  multiple: '0.00"x"',
  integer: '#,##0',
  decimal: '#,##0.00',
  date: 'DD-MMM-YYYY',
  accounting: '£#,##0;[Red](£#,##0)',
  sqft: '#,##0 "sq ft"',
  psf: '£#,##0.00 "/sq ft"',
};

function addinSectionRow(cells: AddinCellDef[], row: number, label: string, lastCol: number): void {
  for (let c = 1; c <= lastCol; c++) {
    cells.push({
      cell: `${colLetter(c)}${row}`,
      value: c === 2 ? label : '',
      bold: true,
      fontColor: WHITE,
      fillColor: BGP_GREEN,
      fontSize: 11,
      borders: 'thin',
    });
  }
}

function addinSubHeaderRow(cells: AddinCellDef[], row: number, label: string, lastCol: number): void {
  for (let c = 1; c <= lastCol; c++) {
    cells.push({
      cell: `${colLetter(c)}${row}`,
      value: c === 2 ? label : '',
      bold: true,
      fontColor: BGP_DARK,
      fillColor: BGP_LIGHT,
      borders: 'thin',
    });
  }
}

function addinTitleRow(cells: AddinCellDef[], row: number, title: string, lastCol: number, mergeEnd?: string): void {
  for (let c = 1; c <= lastCol; c++) {
    cells.push({
      cell: `${colLetter(c)}${row}`,
      value: c === 2 ? title : '',
      bold: true,
      fontColor: WHITE,
      fillColor: BGP_DARK,
      fontSize: 16,
      ...(c === 2 && mergeEnd ? { merge: `B${row}:${mergeEnd}${row}` } : {}),
    });
  }
}

function addinLabel(cells: AddinCellDef[], row: number, col: number, text: string): void {
  cells.push({
    cell: `${colLetter(col)}${row}`,
    value: text,
    fontColor: '424242',
    horizontalAlignment: 'Left',
    borders: 'thin',
  });
}

function addinInput(cells: AddinCellDef[], row: number, col: number, value: number | string, fmt?: string): void {
  cells.push({
    cell: `${colLetter(col)}${row}`,
    value,
    bold: true,
    fontColor: '1565C0',
    fillColor: 'FFFDE7',
    horizontalAlignment: 'Right',
    borders: 'thin',
    ...(fmt ? { numberFormat: NF[fmt] || fmt } : {}),
  });
}

function addinFormula(cells: AddinCellDef[], row: number, col: number, formula: string, fmt?: string, style?: Partial<AddinCellDef>): void {
  cells.push({
    cell: `${colLetter(col)}${row}`,
    formula: `=${formula}`,
    horizontalAlignment: 'Right',
    borders: 'thin',
    ...(fmt ? { numberFormat: NF[fmt] || fmt } : {}),
    ...style,
  });
}

function addinTotal(cells: AddinCellDef[], row: number, col: number, formula: string, fmt?: string): void {
  cells.push({
    cell: `${colLetter(col)}${row}`,
    formula: `=${formula}`,
    bold: true,
    fillColor: 'E0E0E0',
    horizontalAlignment: 'Right',
    borders: 'medium',
    ...(fmt ? { numberFormat: NF[fmt] || fmt } : {}),
  });
}

function addinSubtotal(cells: AddinCellDef[], row: number, col: number, formula: string, fmt?: string): void {
  cells.push({
    cell: `${colLetter(col)}${row}`,
    formula: `=${formula}`,
    bold: true,
    horizontalAlignment: 'Right',
    borders: 'thin',
    ...(fmt ? { numberFormat: NF[fmt] || fmt } : {}),
  });
}

export function buildModelForAddin(params: InvestmentModelParams): AddinModelDefinition {
  const { modelName, assumptions: rawAssumptions, quarters = 20 } = params;
  const assumptions = getDefaultAssumptions(rawAssumptions);
  const sheets: AddinSheetDef[] = [];

  // ─── Sheet: Assumptions ───────────────────────────────────────────────
  const assumCells: AddinCellDef[] = [];
  const assumNR: Array<{ name: string; range: string }> = [];

  // Title
  addinTitleRow(assumCells, 1, 'ASSUMPTIONS', 4, 'D');

  // Column headers
  addinSubHeaderRow(assumCells, 2, 'Parameter', 4);
  assumCells.push({ cell: 'C2', value: 'Value', bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT, borders: 'thin' });
  assumCells.push({ cell: 'D2', value: 'Notes', bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT, borders: 'thin' });

  const categories = ['Acquisition', 'Income', 'Costs', 'Financing', 'Exit', 'Dates', 'Tax', 'Sensitivity'];
  const grouped: Record<string, Array<[string, AssumptionInput]>> = {};
  for (const cat of categories) grouped[cat] = [];
  for (const [key, val] of Object.entries(assumptions)) {
    const cat = val.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push([key, val]);
  }

  let aRow = 3;
  const rowMap: Record<string, number> = {};

  for (const cat of categories) {
    const items = grouped[cat];
    if (!items || items.length === 0) continue;
    aRow++;
    addinSectionRow(assumCells, aRow, cat.toUpperCase(), 4);
    aRow++;

    for (const [_key, item] of items) {
      addinLabel(assumCells, aRow, 2, item.label);
      if (item.format === 'date' && typeof item.value === 'string') {
        addinInput(assumCells, aRow, 3, item.value, 'date');
      } else if (item.format === 'text') {
        addinInput(assumCells, aRow, 3, String(item.value));
      } else {
        const numVal = typeof item.value === 'number' ? item.value : parseFloat(String(item.value)) || 0;
        addinInput(assumCells, aRow, 3, numVal, item.format);
      }
      if (item.note) {
        assumCells.push({
          cell: `D${aRow}`, value: item.note,
          fontColor: '757575', fontSize: 9,
        });
      }
      if (item.namedRange) {
        rowMap[item.namedRange] = aRow;
        assumNR.push({ name: item.namedRange, range: `C${aRow}` });
      }
      aRow++;
    }
  }

  // Calculated fields
  aRow++;
  addinSectionRow(assumCells, aRow, 'CALCULATED FIELDS', 4);
  aRow++;

  addinLabel(assumCells, aRow, 2, 'Stamp Duty');
  addinFormula(assumCells, aRow, 3, 'PurchasePrice*StampDutyRate', 'currency');
  rowMap['StampDuty'] = aRow;
  assumNR.push({ name: 'StampDuty', range: `C${aRow}` });
  aRow++;

  addinLabel(assumCells, aRow, 2, 'Acquisition Costs');
  addinFormula(assumCells, aRow, 3, 'PurchasePrice*AcquisitionCostsRate', 'currency');
  rowMap['AcquisitionCosts'] = aRow;
  assumNR.push({ name: 'AcquisitionCosts', range: `C${aRow}` });
  aRow++;

  addinLabel(assumCells, aRow, 2, 'Agent Fee');
  addinFormula(assumCells, aRow, 3, 'PurchasePrice*AgentFeeRate', 'currency');
  rowMap['AgentFee'] = aRow;
  assumNR.push({ name: 'AgentFee', range: `C${aRow}` });
  aRow++;

  addinLabel(assumCells, aRow, 2, 'Total Acquisition Cost');
  addinTotal(assumCells, aRow, 3, 'PurchasePrice+StampDuty+AcquisitionCosts+AgentFee', 'currency');
  rowMap['TotalAcquisitionCost'] = aRow;
  assumNR.push({ name: 'TotalAcquisitionCost', range: `C${aRow}` });
  aRow++;

  aRow++;
  addinLabel(assumCells, aRow, 2, 'Loan Amount');
  addinFormula(assumCells, aRow, 3, 'PurchasePrice*LTV', 'currency');
  rowMap['LoanAmount'] = aRow;
  assumNR.push({ name: 'LoanAmount', range: `C${aRow}` });
  aRow++;

  addinLabel(assumCells, aRow, 2, 'Arrangement Fee');
  addinFormula(assumCells, aRow, 3, 'LoanAmount*ArrangementFeeRate', 'currency');
  rowMap['ArrangementFee'] = aRow;
  assumNR.push({ name: 'ArrangementFee', range: `C${aRow}` });
  aRow++;

  addinLabel(assumCells, aRow, 2, 'Equity Contribution');
  addinTotal(assumCells, aRow, 3, 'TotalAcquisitionCost-LoanAmount+ArrangementFee', 'currency');
  rowMap['EquityContribution'] = aRow;
  assumNR.push({ name: 'EquityContribution', range: `C${aRow}` });
  aRow++;

  aRow++;
  addinLabel(assumCells, aRow, 2, 'Quarterly Interest Payment');
  addinFormula(assumCells, aRow, 3, 'LoanAmount*InterestRate/4', 'currency');
  rowMap['QuarterlyInterest'] = aRow;
  assumNR.push({ name: 'QuarterlyInterest', range: `C${aRow}` });
  aRow++;

  addinLabel(assumCells, aRow, 2, 'Hold Period (quarters)');
  addinFormula(assumCells, aRow, 3, 'HoldPeriodYears*4', 'integer');
  rowMap['HoldPeriodQuarters'] = aRow;
  assumNR.push({ name: 'HoldPeriodQuarters', range: `C${aRow}` });
  aRow++;

  addinLabel(assumCells, aRow, 2, 'Loan Term (quarters)');
  addinFormula(assumCells, aRow, 3, 'LoanTermYears*4', 'integer');
  rowMap['LoanTermQuarters'] = aRow;
  assumNR.push({ name: 'LoanTermQuarters', range: `C${aRow}` });
  aRow++;

  addinLabel(assumCells, aRow, 2, 'ERV (total p.a.)');
  addinFormula(assumCells, aRow, 3, 'ERVPerSqFt*TotalAreaSqFt', 'currency');
  rowMap['ERVTotal'] = aRow;
  assumNR.push({ name: 'ERVTotal', range: `C${aRow}` });
  aRow++;

  addinLabel(assumCells, aRow, 2, 'Net Initial Yield');
  addinFormula(assumCells, aRow, 3, 'CurrentRentPA/TotalAcquisitionCost', 'percentage');
  rowMap['NIY'] = aRow;
  assumNR.push({ name: 'NIY', range: `C${aRow}` });
  aRow++;

  addinLabel(assumCells, aRow, 2, 'Reversionary Yield');
  addinFormula(assumCells, aRow, 3, 'ERVTotal/TotalAcquisitionCost', 'percentage');
  rowMap['ReversionaryYield'] = aRow;
  assumNR.push({ name: 'ReversionaryYield', range: `C${aRow}` });
  aRow++;

  sheets.push({
    name: 'Assumptions',
    columnWidths: { 1: 3, 2: 35, 3: 18, 4: 30 },
    freezeRow: 2, freezeCol: 1,
    cells: assumCells,
    namedRanges: assumNR,
  });

  // ─── Sheet: Cash Flow ─────────────────────────────────────────────────
  const cfCells: AddinCellDef[] = [];
  const cfNR: Array<{ name: string; range: string }> = [];
  const lastDataCol = quarters + 4;

  addinTitleRow(cfCells, 1, 'CASH FLOW PROJECTION', lastDataCol, colLetter(Math.min(lastDataCol, 10)));

  // Column headers
  addinSubHeaderRow(cfCells, 2, '', lastDataCol);
  cfCells.push({ cell: 'C2', value: 'Entry', bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT, borders: 'thin' });
  cfCells.push({ cell: 'D2', value: 'Exit', bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT, borders: 'thin' });
  for (let q = 1; q <= quarters; q++) {
    cfCells.push({
      cell: `${colLetter(q + 4)}2`, value: `Q${q}`,
      bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT, borders: 'thin',
    });
  }

  // Row 3: Dates
  addinLabel(cfCells, 3, 2, 'Date');
  addinFormula(cfCells, 3, 3, 'AcquisitionDate', 'date');
  addinFormula(cfCells, 3, 4, 'DATE(YEAR(AcquisitionDate)+HoldPeriodYears,MONTH(AcquisitionDate),DAY(AcquisitionDate))', 'date');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    if (q === 1) {
      addinFormula(cfCells, 3, col, 'AcquisitionDate', 'date');
    } else {
      const prevCol = colLetter(col - 1);
      addinFormula(cfCells, 3, col, `DATE(YEAR(${prevCol}3),MONTH(${prevCol}3)+3,DAY(${prevCol}3))`, 'date');
    }
  }

  // Row 4: Year labels
  addinLabel(cfCells, 4, 2, 'Year');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 4;
    addinFormula(cfCells, 4, col, `YEAR(${colLetter(col)}3)`, '#,##0');
  }

  let r = 6;

  // GROSS INCOME
  addinSectionRow(cfCells, r, 'GROSS INCOME', lastDataCol);
  r++;

  const rentRow = r;
  addinLabel(cfCells, r, 2, 'Passing Rent (quarterly)');
  for (let q = 1; q <= quarters; q++) {
    addinFormula(cfCells, r, q + 4, `CurrentRentPA/4*(1+RentGrowthPA)^INT((${q}-1)/4)`, 'currency');
  }
  r++;

  const voidRow = r;
  addinLabel(cfCells, r, 2, 'Void Allowance');
  for (let q = 1; q <= quarters; q++) {
    const cl = colLetter(q + 4);
    addinFormula(cfCells, r, q + 4, `IF(${q}<=VoidPeriodMonths/3,-${cl}${rentRow},0)`, 'currency');
  }
  r++;

  const rentFreeRow = r;
  addinLabel(cfCells, r, 2, 'Rent Free Adjustment');
  for (let q = 1; q <= quarters; q++) {
    const cl = colLetter(q + 4);
    addinFormula(cfCells, r, q + 4, `IF(AND(${q}>VoidPeriodMonths/3,${q}<=VoidPeriodMonths/3+RentFreeMonths/3),-${cl}${rentRow},0)`, 'currency');
  }
  r++;

  const vacancyRow = r;
  addinLabel(cfCells, r, 2, 'Structural Vacancy');
  for (let q = 1; q <= quarters; q++) {
    const cl = colLetter(q + 4);
    addinFormula(cfCells, r, q + 4, `-${cl}${rentRow}*VacancyRate`, 'currency');
  }
  r++;

  const griRow = r;
  addinLabel(cfCells, r, 2, 'Gross Rental Income');
  for (let q = 1; q <= quarters; q++) {
    const cl = colLetter(q + 4);
    addinSubtotal(cfCells, r, q + 4, `${cl}${rentRow}+${cl}${voidRow}+${cl}${rentFreeRow}+${cl}${vacancyRow}`, 'currency');
  }
  r++;

  r++; // blank

  // OPERATING EXPENSES
  addinSectionRow(cfCells, r, 'OPERATING EXPENSES', lastDataCol);
  r++;

  const mgmtFeeRow = r;
  addinLabel(cfCells, r, 2, 'Management Fee');
  for (let q = 1; q <= quarters; q++) {
    const cl = colLetter(q + 4);
    addinFormula(cfCells, r, q + 4, `-${cl}${griRow}*ManagementFeeRate`, 'currency');
  }
  r++;

  const opexRow = r;
  addinLabel(cfCells, r, 2, 'Non-Recoverable OpEx');
  for (let q = 1; q <= quarters; q++) {
    addinFormula(cfCells, r, q + 4, `-(OpExPerSqFt*TotalAreaSqFt/4)*(1+CostInflationPA)^INT((${q}-1)/4)`, 'currency');
  }
  r++;

  const capexRow = r;
  addinLabel(cfCells, r, 2, 'CapEx Reserve');
  for (let q = 1; q <= quarters; q++) {
    const cl = colLetter(q + 4);
    addinFormula(cfCells, r, q + 4, `-ABS(${cl}${griRow})*CapExReserveRate`, 'currency');
  }
  r++;

  const totalOpexRow = r;
  addinLabel(cfCells, r, 2, 'Total Operating Expenses');
  for (let q = 1; q <= quarters; q++) {
    const cl = colLetter(q + 4);
    addinSubtotal(cfCells, r, q + 4, `${cl}${mgmtFeeRow}+${cl}${opexRow}+${cl}${capexRow}`, 'currency');
  }
  r++;

  r++; // blank

  // NOI
  addinSectionRow(cfCells, r, 'NET OPERATING INCOME', lastDataCol);
  r++;

  const noiRow = r;
  addinLabel(cfCells, r, 2, 'Net Operating Income (NOI)');
  for (let q = 1; q <= quarters; q++) {
    const cl = colLetter(q + 4);
    addinTotal(cfCells, r, q + 4, `${cl}${griRow}+${cl}${totalOpexRow}`, 'currency');
  }
  r++;

  r++; // blank

  // DEBT SERVICE
  addinSectionRow(cfCells, r, 'DEBT SERVICE', lastDataCol);
  r++;

  const interestRow = r;
  addinLabel(cfCells, r, 2, 'Interest Payment');
  for (let q = 1; q <= quarters; q++) {
    addinFormula(cfCells, r, q + 4, `IF(${q}<=LoanTermQuarters,-LoanAmount*InterestRate/4,0)`, 'currency');
  }
  r++;

  const principalRow = r;
  addinLabel(cfCells, r, 2, 'Principal Repayment');
  for (let q = 1; q <= quarters; q++) {
    addinFormula(cfCells, r, q + 4,
      `IF(AmortisationType="Interest Only",0,IF(${q}<=LoanTermQuarters,-PMT(InterestRate/4,LoanTermQuarters,LoanAmount)-(-LoanAmount*InterestRate/4),0))`,
      'currency');
  }
  r++;

  const totalDebtRow = r;
  addinLabel(cfCells, r, 2, 'Total Debt Service');
  for (let q = 1; q <= quarters; q++) {
    const cl = colLetter(q + 4);
    addinSubtotal(cfCells, r, q + 4, `${cl}${interestRow}+${cl}${principalRow}`, 'currency');
  }
  r++;

  r++; // blank

  // UNLEVERED CASH FLOW
  addinSectionRow(cfCells, r, 'UNLEVERED CASH FLOW', lastDataCol);
  r++;

  const acquCFRow = r;
  addinLabel(cfCells, r, 2, 'Acquisition Cost');
  addinFormula(cfCells, r, 3, '-TotalAcquisitionCost', 'currency');
  r++;

  const unlevCFRow = r;
  addinLabel(cfCells, r, 2, 'Quarterly Unlevered CF');
  for (let q = 1; q <= quarters; q++) {
    const cl = colLetter(q + 4);
    addinFormula(cfCells, r, q + 4, `${cl}${noiRow}`, 'currency');
  }
  r++;

  const exitNOIRow = r;
  addinLabel(cfCells, r, 2, 'Terminal NOI (annualised)');
  const lastQCol = colLetter(quarters + 4);
  addinFormula(cfCells, r, 4, `${lastQCol}${noiRow}*4`, 'currency');
  r++;

  const grossExitRow = r;
  addinLabel(cfCells, r, 2, 'Gross Exit Value');
  addinFormula(cfCells, r, 4, `D${exitNOIRow}/ExitCapRate`, 'currency');
  r++;

  const disposalCostsRow = r;
  addinLabel(cfCells, r, 2, 'Disposal Costs');
  addinFormula(cfCells, r, 4, `-D${grossExitRow}*DisposalCostsRate`, 'currency');
  r++;

  const netExitRow = r;
  addinLabel(cfCells, r, 2, 'Net Exit Proceeds (Unlevered)');
  addinTotal(cfCells, r, 4, `D${grossExitRow}+D${disposalCostsRow}`, 'currency');
  r++;

  r++; // blank

  // Total Unlevered CF
  const unlevTotalRow = r;
  addinLabel(cfCells, r, 2, 'Total Unlevered Cash Flow');
  addinTotal(cfCells, r, 3, `C${acquCFRow}`, 'currency');
  addinTotal(cfCells, r, 4, `D${netExitRow}`, 'currency');
  for (let q = 1; q <= quarters; q++) {
    const cl = colLetter(q + 4);
    if (q === quarters) {
      addinTotal(cfCells, r, q + 4, `${cl}${unlevCFRow}+D${netExitRow}`, 'currency');
    } else {
      addinTotal(cfCells, r, q + 4, `${cl}${unlevCFRow}`, 'currency');
    }
  }
  r++;

  // XIRR Dates
  const unlevDateRow = r;
  addinLabel(cfCells, r, 2, 'XIRR Dates');
  addinFormula(cfCells, r, 3, 'AcquisitionDate', 'date');
  addinFormula(cfCells, r, 4, 'DATE(YEAR(AcquisitionDate)+HoldPeriodYears,MONTH(AcquisitionDate),DAY(AcquisitionDate))', 'date');
  for (let q = 1; q <= quarters; q++) {
    addinFormula(cfCells, r, q + 4, `${colLetter(q + 4)}3`, 'date');
  }
  r++;

  r++; // blank

  // LEVERED CASH FLOW
  addinSectionRow(cfCells, r, 'LEVERED CASH FLOW', lastDataCol);
  r++;

  const equityCFRow = r;
  addinLabel(cfCells, r, 2, 'Equity Outlay');
  addinFormula(cfCells, r, 3, '-EquityContribution', 'currency');
  r++;

  const levCFRow = r;
  addinLabel(cfCells, r, 2, 'Quarterly Levered CF');
  for (let q = 1; q <= quarters; q++) {
    const cl = colLetter(q + 4);
    addinFormula(cfCells, r, q + 4, `${cl}${noiRow}+${cl}${totalDebtRow}`, 'currency');
  }
  r++;

  const loanRepayRow = r;
  addinLabel(cfCells, r, 2, 'Loan Repayment at Exit');
  addinFormula(cfCells, r, 4, '-LoanAmount', 'currency');
  r++;

  const netExitLevRow = r;
  addinLabel(cfCells, r, 2, 'Net Exit Proceeds (Levered)');
  addinTotal(cfCells, r, 4, `D${netExitRow}+D${loanRepayRow}`, 'currency');
  r++;

  r++; // blank

  // Total Levered CF
  const levTotalRow = r;
  addinLabel(cfCells, r, 2, 'Total Levered Cash Flow');
  addinTotal(cfCells, r, 3, `C${equityCFRow}`, 'currency');
  addinTotal(cfCells, r, 4, `D${netExitLevRow}`, 'currency');
  for (let q = 1; q <= quarters; q++) {
    const cl = colLetter(q + 4);
    if (q === quarters) {
      addinTotal(cfCells, r, q + 4, `${cl}${levCFRow}+D${netExitLevRow}`, 'currency');
    } else {
      addinTotal(cfCells, r, q + 4, `${cl}${levCFRow}`, 'currency');
    }
  }
  r++;

  r++; // blank

  // RETURNS
  addinSectionRow(cfCells, r, 'RETURNS', lastDataCol);
  r++;

  const unlevIRRRow = r;
  addinLabel(cfCells, r, 2, 'Unlevered IRR (XIRR)');
  const cfRange1 = `C${unlevTotalRow}:${lastQCol}${unlevTotalRow}`;
  const dateRange1 = `C${unlevDateRow}:${lastQCol}${unlevDateRow}`;
  addinTotal(cfCells, r, 3, `XIRR(${cfRange1},${dateRange1})`, 'percentage');
  cfNR.push({ name: 'UnleveredIRR', range: `C${unlevIRRRow}` });
  r++;

  const levIRRRow = r;
  addinLabel(cfCells, r, 2, 'Levered IRR (XIRR)');
  const cfRange2 = `C${levTotalRow}:${lastQCol}${levTotalRow}`;
  addinTotal(cfCells, r, 3, `XIRR(${cfRange2},${dateRange1})`, 'percentage');
  cfNR.push({ name: 'LeveredIRR', range: `C${levIRRRow}` });
  r++;

  const unlevMOICRow = r;
  addinLabel(cfCells, r, 2, 'Unlevered Equity Multiple');
  addinTotal(cfCells, r, 3, `(SUM(E${unlevTotalRow}:${lastQCol}${unlevTotalRow})+D${unlevTotalRow})/(-C${unlevTotalRow})`, 'multiple');
  cfNR.push({ name: 'UnleveredMOIC', range: `C${unlevMOICRow}` });
  r++;

  const levMOICRow = r;
  addinLabel(cfCells, r, 2, 'Levered Equity Multiple');
  addinTotal(cfCells, r, 3, `(SUM(E${levTotalRow}:${lastQCol}${levTotalRow})+D${levTotalRow})/(-C${levTotalRow})`, 'multiple');
  cfNR.push({ name: 'LeveredMOIC', range: `C${levMOICRow}` });
  r++;

  const unlevProfitRow = r;
  addinLabel(cfCells, r, 2, 'Unlevered Total Profit');
  addinTotal(cfCells, r, 3, `SUM(C${unlevTotalRow}:${lastQCol}${unlevTotalRow})+D${unlevTotalRow}`, 'currency');
  cfNR.push({ name: 'UnleveredProfit', range: `C${unlevProfitRow}` });
  r++;

  const levProfitRow = r;
  addinLabel(cfCells, r, 2, 'Levered Total Profit');
  addinTotal(cfCells, r, 3, `SUM(C${levTotalRow}:${lastQCol}${levTotalRow})+D${levTotalRow}`, 'currency');
  cfNR.push({ name: 'LeveredProfit', range: `C${levProfitRow}` });
  r++;

  const cfColWidths: Record<number, number> = { 1: 3, 2: 30, 3: 16, 4: 16 };
  for (let c = 5; c <= lastDataCol; c++) cfColWidths[c] = 14;

  sheets.push({
    name: 'Cash Flow',
    columnWidths: cfColWidths,
    freezeRow: 3, freezeCol: 2,
    cells: cfCells,
    namedRanges: cfNR,
  });

  // ─── Sheet: Debt Schedule ─────────────────────────────────────────────
  const dsCells: AddinCellDef[] = [];
  const dsLastCol = quarters + 2;

  addinTitleRow(dsCells, 1, 'DEBT SCHEDULE', dsLastCol, colLetter(Math.min(dsLastCol, 10)));

  // Headers
  dsCells.push({ cell: 'B2', value: '', bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT, borders: 'thin' });
  for (let q = 1; q <= quarters; q++) {
    dsCells.push({
      cell: `${colLetter(q + 2)}2`, value: `Q${q}`,
      bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT, borders: 'thin',
    });
  }

  // Dates
  addinLabel(dsCells, 3, 2, 'Date');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    if (q === 1) {
      addinFormula(dsCells, 3, col, 'AcquisitionDate', 'date');
    } else {
      const prevCol = colLetter(col - 1);
      addinFormula(dsCells, 3, col, `DATE(YEAR(${prevCol}3),MONTH(${prevCol}3)+3,DAY(${prevCol}3))`, 'date');
    }
  }

  let dr = 5;
  addinSectionRow(dsCells, dr, 'LOAN PARAMETERS', dsLastCol);
  dr++;
  addinLabel(dsCells, dr, 2, 'Loan Amount');
  addinFormula(dsCells, dr, 3, 'LoanAmount', 'currency');
  dr++;
  addinLabel(dsCells, dr, 2, 'Interest Rate (p.a.)');
  addinFormula(dsCells, dr, 3, 'InterestRate', 'percentage');
  dr++;
  addinLabel(dsCells, dr, 2, 'Quarterly Rate');
  addinFormula(dsCells, dr, 3, 'InterestRate/4', 'percentage');
  dr++;
  addinLabel(dsCells, dr, 2, 'Term (quarters)');
  addinFormula(dsCells, dr, 3, 'LoanTermQuarters', 'integer');
  dr++;
  addinLabel(dsCells, dr, 2, 'Amortisation');
  addinFormula(dsCells, dr, 3, 'AmortisationType');
  dr++;

  const pmtRow = dr;
  addinLabel(dsCells, dr, 2, 'Quarterly PMT (if amortising)');
  addinFormula(dsCells, dr, 3, 'IF(AmortisationType="Interest Only",LoanAmount*InterestRate/4,PMT(InterestRate/4,LoanTermQuarters,-LoanAmount))', 'currency');
  dr++;

  dr++;
  addinSectionRow(dsCells, dr, 'AMORTISATION SCHEDULE', dsLastCol);
  dr++;

  const openBalRow = dr;
  addinLabel(dsCells, dr, 2, 'Opening Balance');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    if (q === 1) {
      addinFormula(dsCells, dr, col, 'LoanAmount', 'currency');
    } else {
      const prevCol = colLetter(col - 1);
      addinFormula(dsCells, dr, col, `${prevCol}${openBalRow + 4}`, 'currency');
    }
  }
  dr++;

  const intRow = dr;
  addinLabel(dsCells, dr, 2, 'Interest');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const cl = colLetter(col);
    addinFormula(dsCells, dr, col, `IF(${q}<=LoanTermQuarters,${cl}${openBalRow}*InterestRate/4,0)`, 'currency');
  }
  dr++;

  const princRow = dr;
  addinLabel(dsCells, dr, 2, 'Principal Repayment');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const cl = colLetter(col);
    addinFormula(dsCells, dr, col,
      `IF(AmortisationType="Interest Only",0,IF(${q}<=LoanTermQuarters,$C$${pmtRow}-${cl}${intRow},0))`,
      'currency');
  }
  dr++;

  const totalDSRow = dr;
  addinLabel(dsCells, dr, 2, 'Total Debt Service');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const cl = colLetter(col);
    addinSubtotal(dsCells, dr, col, `${cl}${intRow}+${cl}${princRow}`, 'currency');
  }
  dr++;

  const closeBalRow = dr;
  addinLabel(dsCells, dr, 2, 'Closing Balance');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const cl = colLetter(col);
    addinTotal(dsCells, dr, col, `${cl}${openBalRow}-${cl}${princRow}`, 'currency');
  }
  dr++;

  dr++;
  addinSectionRow(dsCells, dr, 'DEBT METRICS', dsLastCol);
  dr++;

  const cumIntRow = dr;
  addinLabel(dsCells, dr, 2, 'Cumulative Interest');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const cl = colLetter(col);
    if (q === 1) {
      addinFormula(dsCells, dr, col, `${cl}${intRow}`, 'currency');
    } else {
      const prevCol = colLetter(col - 1);
      addinFormula(dsCells, dr, col, `${prevCol}${cumIntRow}+${cl}${intRow}`, 'currency');
    }
  }
  dr++;

  addinLabel(dsCells, dr, 2, 'LTV (on purchase price)');
  for (let q = 1; q <= quarters; q++) {
    const col = q + 2;
    const cl = colLetter(col);
    addinFormula(dsCells, dr, col, `IF(PurchasePrice>0,${cl}${closeBalRow}/PurchasePrice,0)`, 'percentage');
  }
  dr++;

  const dsColWidths: Record<number, number> = { 1: 3, 2: 30 };
  for (let c = 3; c <= dsLastCol; c++) dsColWidths[c] = 14;

  sheets.push({
    name: 'Debt Schedule',
    columnWidths: dsColWidths,
    freezeRow: 3, freezeCol: 2,
    cells: dsCells,
    namedRanges: [],
  });

  // ─── Sheet: Sensitivity Analysis ──────────────────────────────────────
  const sensCells: AddinCellDef[] = [];

  addinTitleRow(sensCells, 1, 'SENSITIVITY ANALYSIS', 10, 'J');

  let sr = 3;
  addinSectionRow(sensCells, sr, 'UNLEVERED IRR \u2014 Exit Cap Rate vs Rental Growth', 10);
  sr++;

  const exitCapRates = [0.040, 0.045, 0.050, 0.055, 0.060, 0.065, 0.070];
  const rentGrowths = [0.000, 0.010, 0.015, 0.020, 0.025, 0.030, 0.035, 0.040];

  sensCells.push({ cell: `B${sr}`, value: 'Exit Cap Rate \\ Rent Growth', bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT, borders: 'thin' });
  for (let j = 0; j < rentGrowths.length; j++) {
    sensCells.push({
      cell: `${colLetter(j + 3)}${sr}`,
      value: rentGrowths[j],
      bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT,
      numberFormat: NF.percentage_1dp, borders: 'thin',
    });
  }
  sr++;

  const baseIRRRow = sr;
  addinLabel(sensCells, sr, 2, 'Base Unlevered IRR');
  addinFormula(sensCells, sr, 3, 'UnleveredIRR', 'percentage');
  sr++;
  sr++; // spacer

  for (let i = 0; i < exitCapRates.length; i++) {
    const row = sr + i;
    sensCells.push({
      cell: `B${row}`, value: exitCapRates[i],
      bold: true, fontColor: '424242',
      numberFormat: NF.percentage_1dp, borders: 'thin',
    });
    for (let j = 0; j < rentGrowths.length; j++) {
      addinFormula(sensCells, row, j + 3,
        `$C$${baseIRRRow}-2*(${exitCapRates[i]}-ExitCapRate)+1.5*(${rentGrowths[j]}-RentGrowthPA)`,
        'percentage');
    }
  }
  sr += exitCapRates.length + 2;

  // Levered sensitivity
  addinSectionRow(sensCells, sr, 'LEVERED IRR \u2014 Exit Cap Rate vs LTV', 10);
  sr++;
  const ltvs = [0.40, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75];
  sensCells.push({ cell: `B${sr}`, value: 'Exit Cap Rate \\ LTV', bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT, borders: 'thin' });
  for (let j = 0; j < ltvs.length; j++) {
    sensCells.push({
      cell: `${colLetter(j + 3)}${sr}`,
      value: ltvs[j],
      bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT,
      numberFormat: NF.percentage, borders: 'thin',
    });
  }
  sr++;

  const baseLevIRRRow = sr;
  addinLabel(sensCells, sr, 2, 'Base Levered IRR');
  addinFormula(sensCells, sr, 3, 'LeveredIRR', 'percentage');
  sr++;
  sr++; // spacer

  for (let i = 0; i < exitCapRates.length; i++) {
    const row = sr + i;
    sensCells.push({
      cell: `B${row}`, value: exitCapRates[i],
      bold: true, fontColor: '424242',
      numberFormat: NF.percentage_1dp, borders: 'thin',
    });
    for (let j = 0; j < ltvs.length; j++) {
      addinFormula(sensCells, row, j + 3,
        `$C$${baseLevIRRRow}-2*(${exitCapRates[i]}-ExitCapRate)+(${ltvs[j]}-LTV)*$C$${baseLevIRRRow}/(1-LTV)`,
        'percentage');
    }
  }

  sheets.push({
    name: 'Sensitivity',
    columnWidths: { 1: 3, 2: 22, 3: 14, 4: 14, 5: 14, 6: 14, 7: 14, 8: 14, 9: 14, 10: 14 },
    freezeRow: 1, freezeCol: 2,
    cells: sensCells,
    namedRanges: [],
  });

  // ─── Sheet: Returns Analysis ──────────────────────────────────────────
  const retCells: AddinCellDef[] = [];

  addinTitleRow(retCells, 1, 'RETURNS ANALYSIS', 5, 'E');
  addinSubHeaderRow(retCells, 2, 'Metric', 5);
  retCells.push({ cell: 'C2', value: 'Unlevered', bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT, borders: 'thin' });
  retCells.push({ cell: 'D2', value: 'Levered', bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT, borders: 'thin' });
  retCells.push({ cell: 'E2', value: 'Notes', bold: true, fontColor: BGP_DARK, fillColor: BGP_LIGHT, borders: 'thin' });

  let rr = 4;
  addinSectionRow(retCells, rr, 'KEY RETURNS', 5);
  rr++;
  addinLabel(retCells, rr, 2, 'Internal Rate of Return (IRR)');
  addinTotal(retCells, rr, 3, 'UnleveredIRR', 'percentage');
  addinTotal(retCells, rr, 4, 'LeveredIRR', 'percentage');
  rr++;
  addinLabel(retCells, rr, 2, 'Equity Multiple (MOIC)');
  addinTotal(retCells, rr, 3, 'UnleveredMOIC', 'multiple');
  addinTotal(retCells, rr, 4, 'LeveredMOIC', 'multiple');
  rr++;
  addinLabel(retCells, rr, 2, 'Total Profit');
  addinTotal(retCells, rr, 3, 'UnleveredProfit', 'currency');
  addinTotal(retCells, rr, 4, 'LeveredProfit', 'currency');
  rr++;

  rr++;
  addinSectionRow(retCells, rr, 'INVESTMENT SUMMARY', 5);
  rr++;
  addinLabel(retCells, rr, 2, 'Purchase Price');
  addinFormula(retCells, rr, 3, 'PurchasePrice', 'currency');
  rr++;
  addinLabel(retCells, rr, 2, 'Total Acquisition Cost');
  addinFormula(retCells, rr, 3, 'TotalAcquisitionCost', 'currency');
  rr++;
  addinLabel(retCells, rr, 2, 'Equity Required');
  addinFormula(retCells, rr, 3, 'EquityContribution', 'currency');
  rr++;
  addinLabel(retCells, rr, 2, 'Loan Amount');
  addinFormula(retCells, rr, 3, 'LoanAmount', 'currency');
  rr++;
  addinLabel(retCells, rr, 2, 'LTV');
  addinFormula(retCells, rr, 3, 'LTV', 'percentage');
  rr++;

  rr++;
  addinSectionRow(retCells, rr, 'YIELD ANALYSIS', 5);
  rr++;
  addinLabel(retCells, rr, 2, 'Net Initial Yield (NIY)');
  addinFormula(retCells, rr, 3, 'NIY', 'percentage');
  rr++;
  addinLabel(retCells, rr, 2, 'Reversionary Yield');
  addinFormula(retCells, rr, 3, 'ReversionaryYield', 'percentage');
  rr++;
  addinLabel(retCells, rr, 2, 'Exit Cap Rate');
  addinFormula(retCells, rr, 3, 'ExitCapRate', 'percentage');
  rr++;
  addinLabel(retCells, rr, 2, 'Current Rent (p.a.)');
  addinFormula(retCells, rr, 3, 'CurrentRentPA', 'currency');
  rr++;
  addinLabel(retCells, rr, 2, 'ERV (total p.a.)');
  addinFormula(retCells, rr, 3, 'ERVTotal', 'currency');
  rr++;

  rr++;
  addinSectionRow(retCells, rr, 'CASH FLOW PROFILE', 5);
  rr++;
  addinLabel(retCells, rr, 2, 'Hold Period (years)');
  addinFormula(retCells, rr, 3, 'HoldPeriodYears', 'integer');
  rr++;
  addinLabel(retCells, rr, 2, 'Rental Growth (p.a.)');
  addinFormula(retCells, rr, 3, 'RentGrowthPA', 'percentage');
  rr++;
  addinLabel(retCells, rr, 2, 'Interest Rate');
  addinFormula(retCells, rr, 3, 'InterestRate', 'percentage');
  rr++;

  sheets.push({
    name: 'Returns Analysis',
    columnWidths: { 1: 3, 2: 35, 3: 20, 4: 20, 5: 20 },
    freezeRow: 2, freezeCol: 2,
    cells: retCells,
    namedRanges: [],
  });

  // ─── Sheet: Summary (first in workbook) ───────────────────────────────
  const sumCells: AddinCellDef[] = [];

  addinTitleRow(sumCells, 1, modelName.toUpperCase(), 6, 'F');

  // Subtitle
  sumCells.push({
    cell: 'B2', value: 'Bruce Gillingham Pollard \u2014 Investment Appraisal',
    fontColor: BGP_GREEN, fillColor: BGP_LIGHT, fontSize: 11,
    merge: 'B2:F2',
  });

  let smr = 4;
  addinSectionRow(sumCells, smr, 'KEY RETURNS', 6);
  smr++;

  addinLabel(sumCells, smr, 2, 'Unlevered IRR');
  addinTotal(sumCells, smr, 3, 'UnleveredIRR', 'percentage');
  addinLabel(sumCells, smr, 5, 'Levered IRR');
  addinTotal(sumCells, smr, 6, 'LeveredIRR', 'percentage');
  smr++;

  addinLabel(sumCells, smr, 2, 'Unlevered Multiple');
  addinTotal(sumCells, smr, 3, 'UnleveredMOIC', 'multiple');
  addinLabel(sumCells, smr, 5, 'Levered Multiple');
  addinTotal(sumCells, smr, 6, 'LeveredMOIC', 'multiple');
  smr++;

  addinLabel(sumCells, smr, 2, 'Unlevered Profit');
  addinTotal(sumCells, smr, 3, 'UnleveredProfit', 'currency');
  addinLabel(sumCells, smr, 5, 'Levered Profit');
  addinTotal(sumCells, smr, 6, 'LeveredProfit', 'currency');
  smr++;

  smr++;
  addinSectionRow(sumCells, smr, 'ACQUISITION', 6);
  smr++;
  addinLabel(sumCells, smr, 2, 'Purchase Price');
  addinFormula(sumCells, smr, 3, 'PurchasePrice', 'currency');
  addinLabel(sumCells, smr, 5, 'Total Area');
  addinFormula(sumCells, smr, 6, 'TotalAreaSqFt', 'sqft');
  smr++;
  addinLabel(sumCells, smr, 2, 'Total Acquisition Cost');
  addinFormula(sumCells, smr, 3, 'TotalAcquisitionCost', 'currency');
  addinLabel(sumCells, smr, 5, 'Current Rent (p.a.)');
  addinFormula(sumCells, smr, 6, 'CurrentRentPA', 'currency');
  smr++;
  addinLabel(sumCells, smr, 2, 'Equity Required');
  addinFormula(sumCells, smr, 3, 'EquityContribution', 'currency');
  addinLabel(sumCells, smr, 5, 'ERV (p.a.)');
  addinFormula(sumCells, smr, 6, 'ERVTotal', 'currency');
  smr++;

  smr++;
  addinSectionRow(sumCells, smr, 'YIELDS', 6);
  smr++;
  addinLabel(sumCells, smr, 2, 'Net Initial Yield');
  addinFormula(sumCells, smr, 3, 'NIY', 'percentage');
  addinLabel(sumCells, smr, 5, 'Exit Cap Rate');
  addinFormula(sumCells, smr, 6, 'ExitCapRate', 'percentage');
  smr++;
  addinLabel(sumCells, smr, 2, 'Reversionary Yield');
  addinFormula(sumCells, smr, 3, 'ReversionaryYield', 'percentage');
  addinLabel(sumCells, smr, 5, 'Rental Growth (p.a.)');
  addinFormula(sumCells, smr, 6, 'RentGrowthPA', 'percentage');
  smr++;

  smr++;
  addinSectionRow(sumCells, smr, 'FINANCING', 6);
  smr++;
  addinLabel(sumCells, smr, 2, 'Loan Amount');
  addinFormula(sumCells, smr, 3, 'LoanAmount', 'currency');
  addinLabel(sumCells, smr, 5, 'LTV');
  addinFormula(sumCells, smr, 6, 'LTV', 'percentage');
  smr++;
  addinLabel(sumCells, smr, 2, 'Interest Rate');
  addinFormula(sumCells, smr, 3, 'InterestRate', 'percentage');
  addinLabel(sumCells, smr, 5, 'Loan Term');
  addinFormula(sumCells, smr, 6, 'LoanTermYears', 'integer');
  smr++;
  addinLabel(sumCells, smr, 2, 'Hold Period (years)');
  addinFormula(sumCells, smr, 3, 'HoldPeriodYears', 'integer');
  addinLabel(sumCells, smr, 5, 'Amortisation');
  addinFormula(sumCells, smr, 6, 'AmortisationType');
  smr++;

  // Summary goes first but we build it last because it references named ranges
  // We'll insert it at position 0 in the array
  sheets.unshift({
    name: 'Summary',
    columnWidths: { 1: 3, 2: 28, 3: 18, 4: 5, 5: 28, 6: 18 },
    freezeRow: 3, freezeCol: 1,
    cells: sumCells,
    namedRanges: [],
  });

  return { sheets };
}

// ─── Pathway Integration: build a branded model from an agreed business plan ──

interface PathwayBusinessPlanShape {
  strategy?: string;
  holdPeriodYrs?: number;
  targetPurchasePrice?: number;
  targetNIY?: number;
  exitPrice?: number;
  exitYield?: number;
  exitYear?: number;
  capex?: { amount?: number; scope?: string };
  leasing?: { vacantUnits?: string[]; targetRentPsf?: number; reversionNotes?: string };
  equityCheck?: number;
  targetIRR?: number;
  targetMOIC?: number;
  risks?: string[];
  keyMoves?: string[];
  notes?: string;
}

/**
 * Create an Excel model run for a Property Pathway investigation, seeded from
 * the agreed business plan. Returns identifiers the pathway orchestrator stores
 * in stage7 so the UI can link the user into the model (Model Studio or the
 * Excel add-in) to continue iterating before locking.
 *
 * Implementation notes:
 * - We need a templateId because excel_model_runs.template_id is NOT NULL, so
 *   we ensure a singleton "BGP Pathway Investment Model" template row exists
 *   (the workbook itself is generated each time — not from a template file).
 * - The initial workbook is saved as run version 1.
 */
export async function createPathwayModelRun(args: {
  runId: string;
  address: string;
  plan: PathwayBusinessPlanShape;
  propertyId?: string | null;
  totalAreaSqFt?: number;
  currentRentPA?: number;
}): Promise<{ modelRunId: string; modelVersionId: string; workbookUrl: string; modelRunName: string; modelVersionLabel: string }>
{
  const { db } = await import("./db");
  const { excelModelRuns, excelModelRunVersions, excelTemplates } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { saveFileFromDisk } = await import("./file-storage");

  // 1. Ensure singleton pathway template exists — with a real blank workbook on
  //    disk + in file_storage so clicking the template in Model Studio doesn't
  //    404. Heal old rows that were created with the "(generated-per-run)"
  //    placeholder by back-filling a blank workbook too.
  const PATHWAY_TEMPLATE_NAME = "BGP Pathway Investment Model";
  const TEMPLATES_DIR = path.join(process.cwd(), "uploads", "templates");
  if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

  async function ensureBlankTemplateFile(): Promise<string> {
    const tplFileName = `bgp-pathway-template.xlsx`;
    const tplFilePath = path.join(TEMPLATES_DIR, tplFileName);
    if (!fs.existsSync(tplFilePath)) {
      const blankBuf = await buildInvestmentModel({ modelName: "BGP Pathway Investment Model", assumptions: {} });
      fs.writeFileSync(tplFilePath, blankBuf);
    }
    try {
      await saveFileFromDisk(
        `templates/${tplFileName}`,
        tplFilePath,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        tplFileName,
      );
    } catch (err: any) {
      console.warn("[createPathwayModelRun] failed to persist template to file_storage:", err?.message);
    }
    return tplFilePath;
  }

  let [tpl] = await db.select().from(excelTemplates).where(eq(excelTemplates.name, PATHWAY_TEMPLATE_NAME)).limit(1);
  if (!tpl) {
    const tplFilePath = await ensureBlankTemplateFile();
    [tpl] = await db.insert(excelTemplates).values({
      name: PATHWAY_TEMPLATE_NAME,
      description: "Auto-generated branded investment model for Property Pathway runs. Seeded from the agreed business plan.",
      filePath: tplFilePath,
      originalFileName: "bgp-pathway-model.xlsx",
      inputMapping: "{}",
      outputMapping: "{}",
      version: 1,
    }).returning();
  } else if (!tpl.filePath || tpl.filePath === "(generated-per-run)" || !fs.existsSync(tpl.filePath)) {
    const tplFilePath = await ensureBlankTemplateFile();
    [tpl] = await db.update(excelTemplates)
      .set({ filePath: tplFilePath })
      .where(eq(excelTemplates.id, tpl.id))
      .returning();
  }

  // 2. Map business plan → excel-builder assumptions
  const plan = args.plan || {};
  const assumptions: Record<string, any> = {};
  if (typeof plan.targetPurchasePrice === "number") assumptions.purchasePrice = plan.targetPurchasePrice;
  if (typeof plan.holdPeriodYrs === "number") assumptions.holdPeriodYears = plan.holdPeriodYrs;
  if (typeof plan.exitYield === "number") assumptions.exitCapRate = plan.exitYield;
  if (plan.leasing && typeof plan.leasing.targetRentPsf === "number") assumptions.ervPerSqFt = plan.leasing.targetRentPsf;
  // NIY isn't a direct input — we derive passing rent from price * NIY if we have both
  if (typeof plan.targetPurchasePrice === "number" && typeof plan.targetNIY === "number") {
    assumptions.currentRentPA = Math.round(plan.targetPurchasePrice * plan.targetNIY);
  }
  // Area + passing rent pulled from Stage 1 (tenancy units / aiFacts / VOA)
  // when the plan doesn't carry them. Overrides the 5,000 sq ft default,
  // which was sinking things like 18-22 Haymarket.
  if (typeof args.totalAreaSqFt === "number" && args.totalAreaSqFt > 0) {
    assumptions.totalAreaSqFt = Math.round(args.totalAreaSqFt);
  }
  if (
    (assumptions.currentRentPA == null) &&
    typeof args.currentRentPA === "number" &&
    args.currentRentPA > 0
  ) {
    assumptions.currentRentPA = Math.round(args.currentRentPA);
  }

  // 3. Build the workbook (branded, BGP palette + logo)
  //    Short-form the address for the model name — full Google-geocoded strings
  //    ("18, 22 Haymarket, London SW1Y 4DG, UK") are too noisy for a card title.
  //    Keep the first meaningful segment (building + street).
  const shortAddress = (() => {
    const cleaned = args.address
      .replace(/,\s*UK\b/i, "")
      .replace(/,\s*United Kingdom\b/i, "")
      .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, "")
      .trim();
    const head = cleaned.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2).join(" ");
    return head.replace(/\s+/g, " ").trim() || args.address;
  })();
  const modelName = `${shortAddress} · Pathway Model`;
  const buffer = await buildInvestmentModel({ modelName, assumptions });

  // 4. Write to disk — use the server's uploads/model-runs folder so existing
  //    model-studio download + version endpoints can serve the file.
  const RUNS_DIR = path.join(process.cwd(), "uploads", "runs");
  if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });
  const safeAddress = args.address.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "pathway";
  const fileName = `pathway-${args.runId.slice(0, 8)}-${Date.now()}-${safeAddress}.xlsx`;
  const filePath = path.join(RUNS_DIR, fileName);
  fs.writeFileSync(filePath, buffer);
  // Persist to file_storage (Postgres) so the workbook survives Railway
  // container restarts — without this, ensureRunFile can't find it.
  try {
    await saveFileFromDisk(
      `runs/${fileName}`,
      filePath,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName,
    );
  } catch (err: any) {
    console.warn("[createPathwayModelRun] failed to persist run to file_storage:", err?.message);
  }

  // 5. Insert model run row
  const [run] = await db.insert(excelModelRuns).values({
    templateId: tpl.id,
    name: modelName,
    inputValues: JSON.stringify({
      pathwayRunId: args.runId,
      plan: args.plan,
      assumptions,
    }),
    outputValues: JSON.stringify({}),
    generatedFilePath: filePath,
    status: "draft",
    propertyId: args.propertyId || undefined,
  }).returning();

  // 6. Insert version 1 row. Version note summarises the key numbers so the
  //    model history reads like "v1 · 20 Apr · £60m / 4.75% NIY / 15% IRR"
  //    rather than an opaque UUID.
  const versionDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const priceStr = typeof plan.targetPurchasePrice === "number"
    ? `£${(plan.targetPurchasePrice / 1_000_000).toFixed(plan.targetPurchasePrice >= 10_000_000 ? 0 : 1)}m`
    : null;
  const niyStr = typeof plan.targetNIY === "number" ? `${(plan.targetNIY * 100).toFixed(2)}% NIY` : null;
  const irrStr = typeof plan.targetIRR === "number" ? `${(plan.targetIRR * 100).toFixed(1)}% IRR` : null;
  const versionBits = [`v1`, versionDate, priceStr, niyStr, irrStr].filter(Boolean);
  const versionNote = versionBits.join(" · ");
  const [version] = await db.insert(excelModelRunVersions).values({
    modelRunId: run.id,
    version: 1,
    filePath,
    inputValues: { pathwayRunId: args.runId, plan: args.plan, assumptions } as any,
    outputValues: {} as any,
    notes: versionNote,
  }).returning();

  // 7. Link back onto the pathway run (sets pathway.modelRunId too so existing UI works)
  try {
    const { propertyPathwayRuns } = await import("@shared/schema");
    await db.update(propertyPathwayRuns)
      .set({ modelRunId: run.id, updatedAt: new Date() })
      .where(eq(propertyPathwayRuns.id, args.runId));
  } catch (err: any) {
    console.warn("[createPathwayModelRun] failed to back-link pathway:", err?.message);
  }

  // Workbook URL — direct download endpoint so clicking "Open in Excel"
  // actually opens the xlsx in Excel (desktop or Online), rather than dumping
  // the user on the Model Studio landing page.
  const workbookUrl = `/api/models/runs/${run.id}/download`;

  return {
    modelRunId: run.id,
    modelVersionId: version.id,
    workbookUrl,
    modelRunName: modelName,
    modelVersionLabel: versionNote,
  };
}
