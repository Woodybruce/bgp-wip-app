import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { db } from "./db";
import multer from "multer";
import XLSX from "xlsx-js-style";
import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { setupAdvancedModelsRoutes } from "./models-advanced";
import { buildInvestmentModel, buildDCFModel, analyzeAdvancedWorkbook, applyBGPBranding, buildModelForAddin } from "./excel-builder";
import { getValidMsToken } from "./microsoft";
import { performPropertyLookup, formatPropertyReport } from "./property-lookup";
import { crmDeals, crmContacts, crmCompanies, crmProperties, chatbgpLearnings, appFeedbackLog, appChangeRequests, excelTemplates, excelModelRuns } from "@shared/schema";
import { ilike, or, eq, sql } from "drizzle-orm";
import { saveFileFromDisk, ensureFileOnDisk, syncFileToDisk } from "./file-storage";

const UPLOAD_DIR = path.join(process.cwd(), "ChatBGP", "templates");
const RUNS_DIR = path.join(process.cwd(), "ChatBGP", "runs");
const DOCS_DIR = path.join(process.cwd(), "ChatBGP", "smart-docs");

interface ModelJob {
  status: "processing" | "done" | "error";
  result?: any;
  error?: string;
  createdAt: number;
}
const modelJobs = new Map<string, ModelJob>();

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of modelJobs) {
    if (job.createdAt < cutoff) modelJobs.delete(id);
  }
}, 5 * 60 * 1000);

try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.mkdirSync(DOCS_DIR, { recursive: true });
} catch (err: any) {
  console.error("[models] Failed to create required directories:", err?.message);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
      cb(null, unique + "-" + file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_"));
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const DEFAULT_INPUT_MAPPING: Record<string, { sheet: string; cell: string; label: string; type: string; group: string }> = {
  dealName: { sheet: "Dashboard", cell: "H18", label: "Deal Name", type: "text", group: "General" },
  country: { sheet: "Dashboard", cell: "H19", label: "Country", type: "text", group: "General" },
  purchasePrice: { sheet: "Dashboard", cell: "H7", label: "Purchase Price (£000s)", type: "number", group: "Pricing" },
  annualRentalGrowth: { sheet: "Dashboard", cell: "D21", label: "Annual Rental Growth (%)", type: "percent", group: "Income" },
  rentInflation: { sheet: "Dashboard", cell: "D22", label: "Rent Inflation (%)", type: "percent", group: "Income" },
  costInflation: { sheet: "Dashboard", cell: "D23", label: "Cost Inflation (%)", type: "percent", group: "Income" },
  structuralVacancy: { sheet: "Dashboard", cell: "D24", label: "Structural Vacancy (%)", type: "percent", group: "Income" },
  purchasersCosts: { sheet: "Dashboard", cell: "D25", label: "Purchasers Costs (%)", type: "percent", group: "Costs" },
  startingCashBalance: { sheet: "Dashboard", cell: "D26", label: "Starting Cash Balance (£000s)", type: "number", group: "Costs" },
  corporateIncomeTax: { sheet: "Dashboard", cell: "H32", label: "Corporate Income Tax (%)", type: "percent", group: "Tax" },
  capitalGainsTaxHit: { sheet: "Dashboard", cell: "H33", label: "Capital Gains Tax Hit (%)", type: "percent", group: "Tax" },
  seniorLoanLTV: { sheet: "Dashboard", cell: "O28", label: "LTV (%)", type: "percent", group: "Financing" },
  seniorLoanMargin: { sheet: "Dashboard", cell: "H34", label: "Margin - On Drawn (%)", type: "percent", group: "Financing" },
};

const DEFAULT_OUTPUT_MAPPING: Record<string, { sheet: string; cell: string; label: string; format: string; group: string }> = {
  unleveredIRR: { sheet: "Dashboard", cell: "D8", label: "Unlevered IRR", format: "percent", group: "Returns" },
  leveredPreTaxIRR: { sheet: "Dashboard", cell: "E8", label: "Levered Pre-Tax IRR", format: "percent", group: "Returns" },
  leveredPostTaxIRR: { sheet: "Dashboard", cell: "F8", label: "Levered Post-Tax IRR", format: "percent", group: "Returns" },
  agIRR: { sheet: "Dashboard", cell: "G8", label: "AG IRR (Post Promote)", format: "percent", group: "Returns" },
  unleveredMOIC: { sheet: "Dashboard", cell: "D9", label: "Unlevered MOIC", format: "number2", group: "Returns" },
  leveredPreTaxMOIC: { sheet: "Dashboard", cell: "E9", label: "Levered Pre-Tax MOIC", format: "number2", group: "Returns" },
  agMOIC: { sheet: "Dashboard", cell: "G9", label: "AG MOIC (Post Promote)", format: "number2", group: "Returns" },
  profits: { sheet: "Dashboard", cell: "G10", label: "AG Profits (£000s)", format: "number0", group: "Returns" },
  peakEquity: { sheet: "Dashboard", cell: "G11", label: "AG Peak Equity (£000s)", format: "number0", group: "Returns" },
  griYieldPurchase: { sheet: "Dashboard", cell: "N18", label: "GRI Yield on Purchase Price", format: "percent", group: "Yields" },
  noiYieldPurchase: { sheet: "Dashboard", cell: "N19", label: "NOI Yield on Purchase Price", format: "percent", group: "Yields" },
  ervYieldPurchase: { sheet: "Dashboard", cell: "N20", label: "ERV Yield on Purchase Price", format: "percent", group: "Yields" },
  occupancy: { sheet: "Dashboard", cell: "O30", label: "Occupancy (%)", format: "percent", group: "Property" },
  totalLettableArea: { sheet: "Dashboard", cell: "O31", label: "Total Lettable Area (SF)", format: "number0", group: "Property" },
};

async function ensureTemplateFile(filePath: string): Promise<void> {
  if (fs.existsSync(filePath)) return;
  const key = `templates/${path.basename(filePath)}`;
  const restored = await ensureFileOnDisk(key, filePath);
  if (!restored) throw new Error(`Template file not found: ${filePath}`);
}

async function ensureRunFile(filePath: string): Promise<boolean> {
  if (fs.existsSync(filePath)) return true;
  const key = `runs/${path.basename(filePath)}`;
  return await ensureFileOnDisk(key, filePath);
}

const DATE_FORMATS = /^(dd|d|mm|m|yy|yyyy|mmm|mmmm)[\-\/\.](dd|d|mm|m|yy|yyyy|mmm|mmmm)/i;
const DATE_STRING_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$|^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/;

function normalizeFormulaCells(modelDef: any): void {
  if (!modelDef?.sheets || !Array.isArray(modelDef.sheets)) return;
  for (const sheetDef of modelDef.sheets) {
    if (!sheetDef.cells) continue;
    for (const [cellRef, cellDef] of Object.entries(sheetDef.cells)) {
      const cd = cellDef as any;
      if (!cd.f && typeof cd.v === "string" && cd.v.trim().startsWith("=")) {
        cd.f = cd.v.trim().replace(/^=/, "");
        delete cd.v;
      }
      if (cd.f && typeof cd.f === "string") {
        cd.f = cd.f.replace(/^=/, "");
      }
    }
  }
}

function expandQuarterColumns(modelDef: any): void {
  if (!modelDef?.sheets || !Array.isArray(modelDef.sheets)) return;
  for (const sheetDef of modelDef.sheets) {
    if (!sheetDef.expandQuarters || !sheetDef.cells) continue;
    const eq = sheetDef.expandQuarters;
    const templateCols: string[] = eq.templateCols || ["E", "F"];
    const totalQ: number = eq.totalQuarters || 20;
    if (templateCols.length < 2 || totalQ <= 2) continue;

    const col0Idx = XLSX.utils.decode_col(templateCols[0]);
    const col1Idx = XLSX.utils.decode_col(templateCols[1]);
    const colShift = col1Idx - col0Idx;
    const startRow = eq.startRow || 0;
    const endRow = eq.endRow || 200;

    const templateEntries: { row: number; def: any }[] = [];
    for (const [cellRef, cellDef] of Object.entries(sheetDef.cells)) {
      try {
        const decoded = XLSX.utils.decode_cell(cellRef);
        if (decoded.c === col1Idx && decoded.r >= startRow && decoded.r <= endRow) {
          templateEntries.push({ row: decoded.r, def: cellDef });
        }
      } catch { continue; }
    }

    if (templateEntries.length === 0) continue;

    for (let q = 2; q < totalQ; q++) {
      const targetColIdx = col0Idx + (q * colShift);
      const prevColIdx = targetColIdx - colShift;
      for (const entry of templateEntries) {
        const targetRef = XLSX.utils.encode_cell({ r: entry.row, c: targetColIdx });
        const cd = JSON.parse(JSON.stringify(entry.def));
        if (cd.f && typeof cd.f === "string") {
          const prevColLetter = XLSX.utils.encode_col(prevColIdx);
          const templateColLetter = XLSX.utils.encode_col(col1Idx);
          const targetColLetter = XLSX.utils.encode_col(targetColIdx);
          const col0Letter = XLSX.utils.encode_col(col0Idx);
          cd.f = cd.f.replace(new RegExp('(?<![A-Z])' + templateColLetter + '(?=\\$?\\d)', 'g'), targetColLetter)
                     .replace(new RegExp('(?<![A-Z])' + col0Letter + '(?=\\$?\\d)', 'g'), prevColLetter);
        } else if (cd.v && typeof cd.v === "string") {
          const trimV = cd.v.trim();
          const isDateStr = DATE_STRING_RE.test(trimV) || /^\d{1,2}[\-\/]\w{3}[\-\/]\d{2,4}$/i.test(trimV);
          if (isDateStr) {
            const baseDate = new Date(cd.v);
            if (!isNaN(baseDate.getTime())) {
              const newDate = new Date(baseDate);
              newDate.setMonth(newDate.getMonth() + (3 * (q - 1)));
              cd.v = newDate.toISOString().split("T")[0];
            }
          }
        } else if (typeof cd.v === "number" && cd.nf && isDateFormat(cd.nf)) {
          const epoch = new Date(1899, 11, 30);
          const baseDate = new Date(epoch.getTime() + cd.v * 86400000);
          if (!isNaN(baseDate.getTime())) {
            const newDate = new Date(baseDate);
            newDate.setMonth(newDate.getMonth() + (3 * (q - 1)));
            const newEpoch = new Date(1899, 11, 30);
            cd.v = Math.round((newDate.getTime() - newEpoch.getTime()) / 86400000);
          }
        }
        sheetDef.cells[targetRef] = cd;
      }
    }
    console.log(`[create-model] Expanded ${templateEntries.length} rows across ${totalQ} quarters`);

    let dateRowFound = false;
    for (let dateRow = 0; dateRow <= 10; dateRow++) {
      let baseDate: Date | null = null;
      let dateNf: string = "dd-mmm-yy";
      let dateBold = false;

      for (let scanCol = col0Idx; scanCol <= col1Idx; scanCol++) {
        const ref = XLSX.utils.encode_cell({ r: dateRow, c: scanCol });
        const c = sheetDef.cells[ref];
        if (!c) continue;
        if (c.f) continue;
        if (c.v && typeof c.v === "string") {
          const trimV = c.v.trim();
          if (DATE_STRING_RE.test(trimV) || /^\d{1,2}[\-\/]\w{3}[\-\/]\d{2,4}$/i.test(trimV) || /^\d{1,2}\s+\w{3,9}\s+\d{4}$/i.test(trimV)) {
            const d = new Date(c.v);
            if (!isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100) {
              if (scanCol === col0Idx) {
                baseDate = d;
              } else if (!baseDate) {
                baseDate = new Date(d);
                baseDate.setMonth(baseDate.getMonth() - (3 * (scanCol - col0Idx)));
              }
              if (c.nf) dateNf = c.nf;
              if (c.bold) dateBold = true;
            }
          }
        } else if (typeof c.v === "number" && c.nf && isDateFormat(c.nf)) {
          const epoch = new Date(1899, 11, 30);
          const d = new Date(epoch.getTime() + c.v * 86400000);
          if (!isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100) {
            if (scanCol === col0Idx) {
              baseDate = d;
            } else if (!baseDate) {
              baseDate = new Date(d);
              baseDate.setMonth(baseDate.getMonth() - (3 * (scanCol - col0Idx)));
            }
            dateNf = c.nf;
            if (c.bold) dateBold = true;
          }
        }
        if (baseDate) break;
      }
      if (!baseDate) continue;

      for (let q = 0; q < totalQ; q++) {
        const colIdx = col0Idx + (q * colShift);
        const cellRef = XLSX.utils.encode_cell({ r: dateRow, c: colIdx });
        const newDate = new Date(baseDate);
        newDate.setMonth(newDate.getMonth() + (3 * q));
        const dateStr = newDate.toISOString().split("T")[0];
        sheetDef.cells[cellRef] = {
          v: dateStr,
          nf: dateNf,
          ...(dateBold ? { bold: true } : {}),
        };
      }
      console.log(`[create-model] Generated dates in row ${dateRow + 1} across ${totalQ} quarters from base ${baseDate.toISOString().split("T")[0]}`);
      dateRowFound = true;
      break;
    }
    if (!dateRowFound) {
      console.log(`[create-model] WARNING: No date row found in first 10 rows of quarter columns`);
    }

    let labelRow = -1;
    for (let scanRow = 0; scanRow <= 10; scanRow++) {
      const ref = XLSX.utils.encode_cell({ r: scanRow, c: col0Idx });
      const c = sheetDef.cells[ref];
      if (c && typeof c.v === "string" && /^Q\d$/i.test(c.v.trim())) {
        labelRow = scanRow;
        break;
      }
    }
    if (labelRow >= 0) {
      for (let q = 0; q < totalQ; q++) {
        const colIdx = col0Idx + (q * colShift);
        const cellRef = XLSX.utils.encode_cell({ r: labelRow, c: colIdx });
        const existing = sheetDef.cells[cellRef];
        if (existing && typeof existing.v === "string" && /^Q\d$/i.test(existing.v.trim())) {
          existing.v = `Q${(q % 4) + 1}`;
        } else if (!existing || (existing && existing.f)) {
          sheetDef.cells[cellRef] = { v: `Q${(q % 4) + 1}`, bold: true };
        }
      }
    }

    const lastColIdx = col0Idx + ((totalQ - 1) * colShift);
    const lastColLetter = XLSX.utils.encode_col(lastColIdx);
    const templateLastCol = XLSX.utils.encode_col(col0Idx + colShift);
    const rangeEndRe = new RegExp(
      `(\\$?)([A-Z]{1,2})(\\$?)(\\d+):(\\$?)${templateLastCol}(\\$?)(\\d+)`,
      "g"
    );
    let irrFixCount = 0;
    for (const [cellRef, cellDef] of Object.entries(sheetDef.cells)) {
      const cd = cellDef as any;
      if (!cd.f || typeof cd.f !== "string") continue;
      const decoded = XLSX.utils.decode_cell(cellRef);
      if (decoded.c >= col0Idx) continue;
      if (/XIRR|IRR|NPV/i.test(cd.f)) {
        const original = cd.f;
        cd.f = cd.f.replace(rangeEndRe, (match, d1, startC, d2, startR, d3, _endC, d4, endR) => {
          const sColIdx = XLSX.utils.decode_col(startC);
          if (sColIdx > col1Idx) return match;
          return `${d1}${startC}${d2}${startR}:${d3}${lastColLetter}${d4}${endR}`;
        });
        if (cd.f !== original) irrFixCount++;
      }
    }
    if (irrFixCount > 0) {
      console.log(`[create-model] Fixed ${irrFixCount} formula ranges to extend to column ${lastColLetter}`);
    }
  }
}

function applyInputCellFormatting(ws: XLSX.WorkSheet): void {
  const colCIdx = 2;
  for (const [cellRef, cellObj] of Object.entries(ws)) {
    if (cellRef.startsWith("!")) continue;
    try {
      const decoded = XLSX.utils.decode_cell(cellRef);
      if (decoded.c !== colCIdx) continue;
      if (decoded.r < 2) continue;
      const cell = cellObj as any;
      if (cell.f) continue;
      if (cell.t === "s" && typeof cell.v === "string") continue;
      if (cell.v === undefined || cell.v === null) continue;
      const s = cell.s || {};
      s.fill = { patternType: "solid", fgColor: { rgb: "FFFFC0" } };
      const existingFont = s.font || {};
      existingFont.color = { rgb: "0000FF" };
      s.font = existingFont;
      cell.s = s;
    } catch { continue; }
  }
}

function toExcelDate(v: any): number | null {
  if (typeof v === "number") return null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  if (d.getFullYear() < 1900 || d.getFullYear() > 2200) return null;
  const epoch = new Date(1899, 11, 30);
  const diff = (d.getTime() - epoch.getTime()) / 86400000;
  return Math.round(diff);
}

function isDateFormat(nf: string): boolean {
  if (!nf) return false;
  return DATE_FORMATS.test(nf) || /date/i.test(nf);
}

function buildCell(cd: any): any | null {
  const cell: any = {};

  if (!cd.f && typeof cd.v === "string" && cd.v.trim().startsWith("=")) {
    cd.f = cd.v.trim();
    delete cd.v;
  }

  if (cd.f) {
    const formula = typeof cd.f === "string" ? cd.f.replace(/^=/, "") : String(cd.f);
    cell.f = formula;
    // xlsx-js-style cannot evaluate formulas; use pre-calculated value so cells aren't blank
    if (cd.pv !== undefined && cd.pv !== null) {
      const parsed = typeof cd.pv === "number" ? cd.pv : parseFloat(String(cd.pv));
      if (!isNaN(parsed)) {
        cell.v = parsed;
        cell.t = "n";
      }
    }
  } else if (typeof cd.v === "number") {
    cell.v = cd.v;
    cell.t = "n";
  } else if (typeof cd.v === "string") {
    const trimmed = cd.v.trim();
    if ((trimmed === "-" || trimmed === "–" || trimmed === "—") && cd.nf && !isDateFormat(cd.nf)) {
      cell.v = 0;
      cell.t = "n";
    } else {
      const dateNf = cd.nf && isDateFormat(cd.nf);
      const excelDate = (dateNf || DATE_STRING_RE.test(trimmed)) ? toExcelDate(cd.v) : null;
      if (excelDate !== null) {
        cell.v = excelDate;
        cell.t = "n";
        if (!cd.nf) cd.nf = "dd-mmm-yy";
      } else {
        cell.v = cd.v;
        cell.t = "s";
      }
    }
  } else if (cd.v === true || cd.v === false) {
    cell.v = cd.v;
    cell.t = "b";
  } else {
    return null;
  }

  if (cd.nf) cell.z = cd.nf;

  const style: any = {};
  const font: any = cd.bold ? { bold: true } : {};
  if (cd.color) font.color = { rgb: cd.color };
  if (Object.keys(font).length > 0) style.font = font;
  if (cd.align === "right") style.alignment = { horizontal: "right" };
  if (cd.nf) style.numFmt = cd.nf;
  if (cd.fgColor) style.fill = { patternType: "solid", fgColor: { rgb: cd.fgColor } };
  if (Object.keys(style).length > 0) cell.s = style;

  return cell;
}

function readCellValue(ws: XLSX.WorkSheet, cell: string): any {
  const c = ws[cell];
  if (!c) return null;
  return c.v !== undefined ? c.v : null;
}

function writeCellValue(ws: XLSX.WorkSheet, cell: string, value: any, type: string): void {
  if (value === null || value === undefined || value === "") return;
  const numVal = type === "percent" ? parseFloat(value) / 100 : parseFloat(value);
  const existing = ws[cell] || {};
  const preservedStyle = existing.s;
  const preservedFormat = existing.z;
  if (type === "text") {
    ws[cell] = { t: "s", v: String(value) };
  } else if (!isNaN(numVal)) {
    ws[cell] = { t: "n", v: numVal };
  }
  if (preservedStyle && ws[cell]) ws[cell].s = preservedStyle;
  if (preservedFormat && ws[cell]) ws[cell].z = preservedFormat;
}

function extractOutputs(wb: XLSX.WorkBook, mapping: Record<string, any>): Record<string, any> {
  const outputs: Record<string, any> = {};
  for (const [key, config] of Object.entries(mapping)) {
    try {
      const ws = wb.Sheets[config.sheet];
      if (!ws) continue;
      const raw = readCellValue(ws, config.cell);
      if (raw === null) {
        outputs[key] = null;
        continue;
      }
      if (config.format === "percent") {
        outputs[key] = typeof raw === "number" ? (raw * 100).toFixed(2) + "%" : raw;
      } else if (config.format === "number0") {
        outputs[key] = typeof raw === "number" ? Math.round(raw).toLocaleString() : raw;
      } else if (config.format === "number2") {
        outputs[key] = typeof raw === "number" ? raw.toFixed(2) : raw;
      } else {
        outputs[key] = raw;
      }
    } catch {
      outputs[key] = null;
    }
  }
  return outputs;
}

function analyzeWorkbook(wb: XLSX.WorkBook): { sheets: { name: string; rows: number; cols: number }[]; properties: string[] } {
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    return { name, rows: range.e.r + 1, cols: range.e.c + 1 };
  });
  const properties: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const ws = wb.Sheets[String(i)];
    if (ws) {
      const nameCell = ws["H75"] || ws["H74"] || ws["E2"];
      if (nameCell && nameCell.v && nameCell.v !== 0) {
        properties.push(String(nameCell.v));
      }
    }
  }
  return { sheets, properties };
}

function extractRichWorkbookContext(wb: XLSX.WorkBook, maxRowsPerSheet: number = 80): string {
  const sections: string[] = [];
  const sheetCount = wb.SheetNames.length;
  sections.push(`WORKBOOK OVERVIEW: ${sheetCount} sheets: ${wb.SheetNames.join(", ")}`);

  if (wb.Workbook?.Names?.length) {
    const namedRanges = wb.Workbook.Names
      .filter((n: any) => n.Name && !n.Name.startsWith("_"))
      .map((n: any) => `  ${n.Name} = ${n.Ref || ""}`)
      .join("\n");
    if (namedRanges) sections.push(`NAMED RANGES:\n${namedRanges}`);
  }

  for (const sheetName of wb.SheetNames.slice(0, 15)) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const rowCount = Math.min(range.e.r + 1, maxRowsPerSheet);
    const colCount = Math.min(range.e.c + 1, 26);

    const lines: string[] = [];
    lines.push(`\n=== SHEET: "${sheetName}" (${range.e.r + 1} rows × ${range.e.c + 1} cols) ===`);

    if (ws["!merges"]?.length) {
      const merges = ws["!merges"].slice(0, 20).map((m: any) => {
        const s = XLSX.utils.encode_cell(m.s);
        const e = XLSX.utils.encode_cell(m.e);
        return `${s}:${e}`;
      });
      lines.push(`Merged cells: ${merges.join(", ")}`);
    }

    for (let r = range.s.r; r < rowCount; r++) {
      const cellInfos: string[] = [];
      let hasContent = false;
      for (let c = range.s.c; c < colCount; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) {
          cellInfos.push("");
          continue;
        }
        hasContent = true;
        let info = "";
        if (cell.f) {
          info = `=${cell.f}`;
          if (cell.v !== undefined && cell.v !== null) {
            info += ` → ${cell.v}`;
          }
        } else if (cell.v !== undefined && cell.v !== null) {
          info = String(cell.v);
        }
        if (cell.t && cell.t !== "s" && cell.t !== "n") {
          info += ` [${cell.t === "b" ? "bool" : cell.t === "e" ? "error" : cell.t === "d" ? "date" : cell.t}]`;
        }
        if (cell.z && cell.z !== "General" && cell.t === "n") {
          info += ` [fmt:${cell.z}]`;
        }
        cellInfos.push(info);
      }
      if (hasContent) {
        const rowLabel = `R${r + 1}`;
        lines.push(`${rowLabel}: ${cellInfos.join(" | ")}`);
      }
    }

    if (range.e.r + 1 > maxRowsPerSheet) {
      lines.push(`... (${range.e.r + 1 - maxRowsPerSheet} more rows)`);
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}

const docUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DOCS_DIR),
    filename: (_req, file, cb) => {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
      cb(null, unique + "-" + file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_"));
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

async function extractTextFromDocument(filePath: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === ".xlsx" || ext === ".xls") {
    const wb = XLSX.readFile(filePath);
    const lines: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      if (csv.trim()) {
        lines.push(`--- Sheet: ${sheetName} ---`);
        lines.push(csv);
      }
    }
    return lines.join("\n");
  }

  if (ext === ".pdf") {
    const pdfModule = await import("pdf-parse");
    const PDFParseClass = (pdfModule as any).PDFParse || (pdfModule as any).default;
    const buffer = fs.readFileSync(filePath);
    const uint8 = new Uint8Array(buffer);
    const parser = new PDFParseClass(uint8);
    const data = await parser.getText();
    return typeof data === "string" ? data : (data as any).text || String(data);
  }

  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (ext === ".csv") {
    return fs.readFileSync(filePath, "utf-8");
  }

  throw new Error("Unsupported file format");
}

const SMART_EXTRACT_PROMPT = `You are a commercial property investment analyst at Bruce Gillingham Pollard (BGP), a London-based property consultancy.

You will be given text extracted from property documents (tenancy schedules, brochures, marketing materials). Your job is to extract structured investment model inputs from these documents.

Extract as many of the following fields as you can find in the documents. Return ONLY a valid JSON object with the extracted values. Use null for fields you cannot determine.

Fields to extract:
{
  "dealName": "Property/deal name (string)",
  "country": "Country (string, default 'United Kingdom')",
  "purchasePrice": "Purchase/asking price in £000s (number, e.g. 5000 for £5m)",
  "annualRentalGrowth": "Annual rental growth as percentage (number, e.g. 2.5 for 2.5%)",
  "rentInflation": "Rent inflation as percentage (number)",
  "costInflation": "Cost inflation as percentage (number)",
  "structuralVacancy": "Structural vacancy rate as percentage (number)",
  "purchasersCosts": "Purchaser's costs as percentage (number, typically 6-7%)",
  "startingCashBalance": "Starting cash balance in £000s (number)",
  "corporateIncomeTax": "Corporate income tax as percentage (number)",
  "capitalGainsTaxHit": "Capital gains tax hit as percentage (number)",
  "seniorLoanLTV": "Senior loan LTV as percentage (number)",
  "seniorLoanMargin": "Senior loan margin as percentage (number)",
  "totalRentPA": "Total passing rent per annum in £ (number)",
  "totalArea": "Total lettable area in sq ft (number)",
  "propertyType": "Type of property (string: retail, office, mixed-use, residential, etc.)",
  "location": "Location/address (string)",
  "numberOfUnits": "Number of lettable units (number)",
  "occupancyRate": "Current occupancy rate as percentage (number)",
  "waultYears": "Weighted average unexpired lease term in years (number)",
  "ervPerSqFt": "Estimated rental value per sq ft (number)",
  "tenants": "List of tenant names (array of strings)",
  "leaseExpiries": "Summary of upcoming lease expiries (string)"
}

Also include a "summary" field with a 2-3 sentence overview of the property opportunity.

Important:
- For prices, convert to £000s (thousands). So £5,000,000 becomes 5000.
- For percentages, use the raw number (e.g. 5.5 for 5.5%), not decimal (not 0.055).
- If you find a rent roll or tenancy schedule, sum up the total annual rent.
- Calculate occupancy from the schedule if possible.
- Return ONLY the JSON object, no markdown formatting.`;

function getAnthropicClient() {
  // Use direct API key first (same dual-key approach as chatbgp.ts)
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const baseURL = process.env.ANTHROPIC_API_KEY
    ? undefined
    : process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  return new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

function getGeminiModelClient() {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (!apiKey || !baseUrl) return null;
  const { GoogleGenAI } = require("@google/genai");
  return new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
}

async function extractPropertyDataWithAI(documentTexts: { name: string; text: string }[]): Promise<any> {
  const anthropic = getAnthropicClient();

  const combinedText = documentTexts
    .map((doc) => `=== DOCUMENT: ${doc.name} ===\n${doc.text.slice(0, 15000)}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: SMART_EXTRACT_PROMPT,
    messages: [
      { role: "user", content: combinedText },
    ],
  });

  const content = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
}

async function analyzeTemplateWithAI(wb: XLSX.WorkBook): Promise<{
  inputMapping: Record<string, any>;
  outputMapping: Record<string, any>;
  description: string;
  modelType: string;
}> {
  const anthropic = getAnthropicClient();
  const richContext = extractRichWorkbookContext(wb, 60);

  const systemPrompt = `You are an expert property investment analyst with deep Excel expertise, reviewing a financial model workbook. You can see every cell's value AND its formula (shown as =FORMULA → calculated_value), merged cell regions, named ranges, and number formats.

Your task: Identify INPUT cells (where users enter assumptions) and OUTPUT cells (formula-driven results).

FORMULA ANALYSIS GUIDELINES:
- Cells with formulas (=...) are OUTPUTS — they compute results from other cells
- Cells with plain values (no = prefix) are potential INPUTS — especially if they have labels nearby
- Follow formula dependencies: if cell D8 has =IRR(...), that's an output
- Named ranges often point to key inputs or outputs
- Look for cells referenced by many formulas — these are likely important inputs
- Identify the model's calculation flow: inputs → intermediate calculations → final outputs

Return ONLY valid JSON in this format:
{
  "inputMapping": {
    "fieldKey": { "sheet": "SheetName", "cell": "A1", "label": "Human Label", "type": "number|percent|text", "group": "GroupName" }
  },
  "outputMapping": {
    "fieldKey": { "sheet": "SheetName", "cell": "A1", "label": "Human Label", "format": "percent|number0|number2", "group": "GroupName" }
  },
  "description": "Brief description of what this model does and its calculation methodology",
  "modelType": "investment|development|valuation|cashflow|other"
}

Guidelines:
- Use camelCase keys like purchasePrice, annualRentalGrowth, unleveredIRR
- For type: use "percent" for percentages, "number" for currency/areas, "text" for strings
- For format: use "percent" for %, "number0" for whole numbers, "number2" for 2 decimal places
- Common groups: General, Pricing, Income, Costs, Tax, Financing, Returns, Yields, Property
- Dashboard or Summary sheets often contain the key inputs and outputs
- Pay attention to number formats [fmt:...] to determine if a cell is a percentage, currency, etc.
- Return ONLY the JSON, no markdown`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      { role: "user", content: `Analyse this workbook with full formula visibility:\n\n${richContext.slice(0, 50000)}` }
    ],
  });

  const content = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
}

async function askAboutModel(wb: XLSX.WorkBook, question: string, templateName: string, inputMapping?: Record<string, any>, outputMapping?: Record<string, any>): Promise<string> {
  const anthropic = getAnthropicClient();
  const richContext = extractRichWorkbookContext(wb, 80);

  let mappingContext = "";
  if (inputMapping && Object.keys(inputMapping).length > 0) {
    mappingContext += "\n\nKNOWN INPUT CELLS:\n" + Object.entries(inputMapping)
      .map(([key, m]: [string, any]) => `  ${m.label} (${m.sheet}!${m.cell}) — ${m.type}`)
      .join("\n");
  }
  if (outputMapping && Object.keys(outputMapping).length > 0) {
    mappingContext += "\n\nKNOWN OUTPUT CELLS:\n" + Object.entries(outputMapping)
      .map(([key, m]: [string, any]) => `  ${m.label} (${m.sheet}!${m.cell}) — ${m.format}`)
      .join("\n");
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: `You are an expert Excel financial modelling analyst at BGP (Bruce Gillingham Pollard), a London property consultancy. You have full visibility of a workbook including:
- Every cell's value and formula (formulas shown as =FORMULA → calculated_value)
- Named ranges, merged cells, and number formats
- The complete multi-tab workbook structure

When answering questions:
- Reference specific cells (e.g. "Dashboard!D8 contains =IRR(...) which calculates...")
- Trace formula dependencies across sheets when relevant
- Explain the model's logic and calculation methodology
- Flag any potential issues: circular references, #REF! errors, hardcoded values that should be inputs, missing dependencies
- Provide actionable, specific answers with cell references
- Use professional property investment language

Be thorough but concise. If the user asks about a specific area, focus there. If they ask a general question, give a structured overview.`,
    messages: [
      { role: "user", content: `Model: "${templateName}"${mappingContext}\n\nFULL WORKBOOK DATA:\n${richContext.slice(0, 50000)}\n\nQUESTION: ${question}` }
    ],
  });

  return response.content[0]?.type === "text" ? response.content[0].text : "Unable to analyse the model.";
}

async function analyzeModelResults(
  inputValues: Record<string, any>,
  outputValues: Record<string, any>,
  inputMapping: Record<string, any>,
  outputMapping: Record<string, any>,
  templateName: string
): Promise<string> {
  const anthropic = getAnthropicClient();

  const inputSummary = Object.entries(inputValues)
    .map(([key, val]) => {
      const label = inputMapping[key]?.label || key;
      const type = inputMapping[key]?.type || "";
      return `${label}: ${val}${type === "percent" ? "%" : ""}`;
    })
    .join("\n");

  const outputSummary = Object.entries(outputValues)
    .filter(([_, val]) => val !== null && val !== undefined)
    .map(([key, val]) => {
      const label = outputMapping[key]?.label || key;
      return `${label}: ${val}`;
    })
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: `You are a senior investment analyst at BGP (Bruce Gillingham Pollard), a London property consultancy. Provide a concise, professional analysis of these model results. Cover:
1. Overall attractiveness of the investment (based on IRR, MOIC, yields)
2. Key risks or concerns (high LTV, low occupancy, tax drag, etc.)
3. How the returns compare to typical market benchmarks
4. One actionable recommendation

Keep it to 4-5 sentences. Be specific about numbers. Use professional property investment language.`,
    messages: [
      { role: "user", content: `Model: ${templateName}\n\nInputs:\n${inputSummary}\n\nResults:\n${outputSummary}` }
    ],
  });

  return response.content[0]?.type === "text" ? response.content[0].text : "";
}

async function suggestInputValues(
  inputMapping: Record<string, any>,
  currentValues: Record<string, any>,
  templateName: string,
  context?: string
): Promise<{ suggestions: Record<string, any>; reasoning: string }> {
  const anthropic = getAnthropicClient();

  const fieldDescriptions = Object.entries(inputMapping)
    .map(([key, field]: [string, any]) => {
      const currentVal = currentValues[key];
      return `${key} (${field.label}, ${field.type}${field.group ? ", group: " + field.group : ""})${currentVal ? " = currently " + currentVal : ""}`;
    })
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: `You are a senior property investment analyst at BGP, a London property consultancy. Suggest reasonable default/market-standard values for a property investment model. Base suggestions on current London property market conditions. Return JSON with:
{
  "suggestions": { "fieldKey": suggestedValue },
  "reasoning": "Brief explanation of why these values are reasonable"
}
Only suggest values for fields that are currently empty. Use numbers (not strings). For percent fields, use the percentage number (e.g. 5.5 for 5.5%), not decimal.`,
    messages: [
      { role: "user", content: `Model: ${templateName}\n\nFields:\n${fieldDescriptions}${context ? "\n\nAdditional context: " + context : ""}` }
    ],
  });

  const content = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
}

export function setupModelsRoutes(app: Express) {
  app.get("/api/models/templates", requireAuth, async (req: Request, res: Response) => {
    try {
      let templates = await storage.getExcelTemplates();
      const propertyId = req.query.propertyId as string;
      if (propertyId) {
        templates = templates.filter(t => t.propertyId === propertyId);
      }
      res.json(templates);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  app.get("/api/models/templates/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const template = await storage.getExcelTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const inputMapping = JSON.parse(template.inputMapping || "{}");
      const outputMapping = JSON.parse(template.outputMapping || "{}");

      let analysis = null;
      try {
        await ensureTemplateFile(template.filePath);
      const wb = XLSX.readFile(template.filePath);
        analysis = analyzeWorkbook(wb);
        const existingOutputs = extractOutputs(wb, outputMapping);
        res.json({ ...template, inputMapping, outputMapping, analysis, sampleOutputs: existingOutputs });
      } catch {
        res.json({ ...template, inputMapping, outputMapping, analysis });
      }
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch template" });
    }
  });

  app.get("/api/models/templates/:id/cells", requireAuth, async (req: Request, res: Response) => {
    try {
      const template = await storage.getExcelTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });

      await ensureTemplateFile(template.filePath);
      const wb = XLSX.readFile(template.filePath);
      const sheetName = (req.query.sheet as string) || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      if (!ws) return res.status(404).json({ message: `Sheet "${sheetName}" not found` });

      const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
      const rows: any[][] = [];
      const colWidths: number[] = [];
      const merges: { r: number; c: number; rs: number; cs: number }[] = [];

      for (let r = range.s.r; r <= Math.min(range.e.r, 200); r++) {
        const row: any[] = [];
        for (let c = range.s.c; c <= Math.min(range.e.c, 50); c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (cell) {
            row.push({
              v: cell.v !== undefined ? cell.v : "",
              f: cell.f || undefined,
              t: cell.t || "s",
              w: cell.w || undefined,
              s: cell.s || undefined,
            });
          } else {
            row.push(null);
          }
        }
        rows.push(row);
      }

      if (ws["!cols"]) {
        for (let c = 0; c <= range.e.c; c++) {
          colWidths.push(ws["!cols"][c]?.wpx || ws["!cols"][c]?.wch ? (ws["!cols"][c].wch || 10) * 8 : 80);
        }
      }

      if (ws["!merges"]) {
        for (const m of ws["!merges"]) {
          merges.push({ r: m.s.r, c: m.s.c, rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1 });
        }
      }

      const inputMapping = JSON.parse(template.inputMapping || "{}");
      const outputMapping = JSON.parse(template.outputMapping || "{}");
      const inputCells = new Set<string>();
      const outputCells = new Set<string>();
      for (const v of Object.values(inputMapping) as any[]) {
        if (v.sheet === sheetName) inputCells.add(v.cell);
      }
      for (const v of Object.values(outputMapping) as any[]) {
        if (v.sheet === sheetName) outputCells.add(v.cell);
      }

      res.json({
        sheetNames: wb.SheetNames,
        activeSheet: sheetName,
        totalRows: range.e.r - range.s.r + 1,
        totalCols: range.e.c - range.s.c + 1,
        rows,
        colWidths,
        merges,
        inputCells: Array.from(inputCells),
        outputCells: Array.from(outputCells),
      });
    } catch (err: any) {
      console.error("[cells]", err);
      res.status(500).json({ message: "Failed to read cells" });
    }
  });

  app.post("/api/models/templates/:id/cells", requireAuth, async (req: Request, res: Response) => {
    try {
      const template = await storage.getExcelTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const { sheet, cell, value } = req.body;
      if (!sheet || !cell) return res.status(400).json({ message: "Sheet and cell are required" });

      await ensureTemplateFile(template.filePath);
      const wb = XLSX.readFile(template.filePath);
      const ws = wb.Sheets[sheet];
      if (!ws) return res.status(404).json({ message: `Sheet "${sheet}" not found` });

      const cellAddr = XLSX.utils.decode_cell(cell);
      const cellRef = XLSX.utils.encode_cell(cellAddr);

      if (value === "" || value === null || value === undefined) {
        delete ws[cellRef];
      } else if (typeof value === "string" && value.startsWith("=")) {
        ws[cellRef] = { f: value.slice(1), t: "n", v: 0 };
      } else {
        const numVal = Number(value);
        if (!isNaN(numVal) && value !== "") {
          ws[cellRef] = { v: numVal, t: "n" };
        } else {
          ws[cellRef] = { v: String(value), t: "s" };
        }
      }

      XLSX.writeFile(wb, template.filePath);
      try { await syncFileToDisk(`templates/${path.basename(template.filePath)}`, template.filePath); } catch {}
      res.json({ success: true, sheet, cell: cellRef, value });
    } catch (err: any) {
      console.error("[update-cell]", err);
      res.status(500).json({ message: "Failed to update cell" });
    }
  });

  app.get("/api/models/runs/:runId/cells", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await storage.getExcelModelRun(req.params.runId as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (!run.generatedFilePath) return res.status(404).json({ message: "Run file not found" });
      await ensureRunFile(run.generatedFilePath);
      if (!fs.existsSync(run.generatedFilePath)) {
        return res.status(404).json({ message: "Run file not found" });
      }

      const wb = XLSX.readFile(run.generatedFilePath);
      const sheetName = (req.query.sheet as string) || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      if (!ws) return res.status(404).json({ message: `Sheet "${sheetName}" not found` });

      const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
      const rows: any[][] = [];
      const merges: { r: number; c: number; rs: number; cs: number }[] = [];

      for (let r = range.s.r; r <= Math.min(range.e.r, 200); r++) {
        const row: any[] = [];
        for (let c = range.s.c; c <= Math.min(range.e.c, 50); c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (cell) {
            row.push({
              v: cell.v !== undefined ? cell.v : "",
              f: cell.f || undefined,
              t: cell.t || "s",
              w: cell.w || undefined,
            });
          } else {
            row.push(null);
          }
        }
        rows.push(row);
      }

      if (ws["!merges"]) {
        for (const m of ws["!merges"]) {
          merges.push({ r: m.s.r, c: m.s.c, rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1 });
        }
      }

      res.json({
        sheetNames: wb.SheetNames,
        activeSheet: sheetName,
        totalRows: range.e.r - range.s.r + 1,
        totalCols: range.e.c - range.s.c + 1,
        rows,
        merges,
        inputCells: [],
        outputCells: [],
      });
    } catch (err: any) {
      console.error("[run-cells]", err);
      res.status(500).json({ message: "Failed to read run cells" });
    }
  });

  app.post("/api/models/templates", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const wb = XLSX.readFile(req.file.path);
      const analysis = analyzeWorkbook(wb);

      const hasDashboard = wb.SheetNames.includes("Dashboard");
      let inputMapping = hasDashboard ? DEFAULT_INPUT_MAPPING : {};
      let outputMapping = hasDashboard ? DEFAULT_OUTPUT_MAPPING : {};
      let aiDescription = `Portfolio model with ${analysis.sheets.length} sheets`;
      let aiModelType = "";

      if (process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
        try {
          const aiAnalysis = await analyzeTemplateWithAI(wb);
          if (aiAnalysis.inputMapping && Object.keys(aiAnalysis.inputMapping).length > 0) {
            inputMapping = { ...inputMapping, ...aiAnalysis.inputMapping };
          }
          if (aiAnalysis.outputMapping && Object.keys(aiAnalysis.outputMapping).length > 0) {
            outputMapping = { ...outputMapping, ...aiAnalysis.outputMapping };
          }
          if (aiAnalysis.description) {
            aiDescription = aiAnalysis.description;
          }
          aiModelType = aiAnalysis.modelType || "";
        } catch (err: any) {
          console.error("AI template analysis failed, using defaults:", err?.message);
        }
      }

      const template = await storage.createExcelTemplate({
        name: req.body.name || path.parse(req.file.originalname).name,
        description: req.body.description || aiDescription,
        filePath: req.file.path,
        originalFileName: req.file.originalname,
        inputMapping: JSON.stringify(inputMapping),
        outputMapping: JSON.stringify(outputMapping),
      });

      try {
        await saveFileFromDisk(`templates/${path.basename(req.file.path)}`, req.file.path, req.file.mimetype || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", req.file.originalname);
      } catch (e: any) { console.error("Failed to persist template to DB:", e?.message); }

      res.json({ ...template, analysis, inputMapping, outputMapping, aiModelType });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to upload template" });
    }
  });

  app.patch("/api/models/templates/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { propertyId, name } = req.body;
      const updates: Partial<{ propertyId: string | null; name: string }> = {};
      if (propertyId !== undefined) updates.propertyId = propertyId || null;
      if (name !== undefined) updates.name = name;
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "No updates provided" });
      await db.update(excelTemplates).set(updates).where(eq(excelTemplates.id, req.params.id));
      const updated = await storage.getExcelTemplate(req.params.id as string);
      if (!updated) return res.status(404).json({ message: "Template not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to update template" });
    }
  });

  app.patch("/api/models/runs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { propertyId } = req.body;
      if (propertyId === undefined) return res.status(400).json({ message: "No updates provided" });
      await db.update(excelModelRuns).set({ propertyId: propertyId || null }).where(eq(excelModelRuns.id, req.params.id));
      res.json({ message: "Updated" });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to update run" });
    }
  });

  app.delete("/api/models/templates/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const template = await storage.getExcelTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });
      try { fs.unlinkSync(template.filePath); } catch {}
      try { const { deleteFile } = await import("./file-storage"); await deleteFile(`templates/${path.basename(template.filePath)}`); } catch {}
      await storage.deleteExcelTemplate(req.params.id as string);
      res.json({ message: "Template deleted" });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  // ─── Build model for Excel Add-in (Office.js write engine) ────────────
  app.post("/api/models/build-for-addin", requireAuth, async (req: Request, res: Response) => {
    try {
      const { modelType, modelName, assumptions } = req.body;
      if (!modelName || typeof modelName !== "string") {
        return res.status(400).json({ message: "modelName is required" });
      }

      const quarters = (assumptions?.holdPeriodYears || 5) * 4;

      if (modelType === "dcf") {
        // DCF uses same structure but with longer periods
        const years = assumptions?.holdPeriodYears || 10;
        const modelDef = buildModelForAddin({
          modelName,
          assumptions: { ...assumptions, holdPeriodYears: years },
          quarters: years * 4,
        });
        return res.json(modelDef);
      }

      // Default: investment appraisal
      const modelDef = buildModelForAddin({
        modelName,
        assumptions: assumptions || {},
        quarters,
      });

      res.json(modelDef);
    } catch (err: any) {
      console.error("[models] build-for-addin error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to build model definition" });
    }
  });

  setupAdvancedModelsRoutes(app);

  app.get("/api/models/runs", requireAuth, async (req: Request, res: Response) => {
    try {
      const templateId = req.query.templateId as string;
      const propertyId = req.query.propertyId as string;
      let runs = templateId
        ? await storage.getExcelModelRunsByTemplate(templateId)
        : await storage.getExcelModelRuns();
      if (propertyId) {
        runs = runs.filter(r => r.propertyId === propertyId);
      }
      res.json(runs);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch model runs" });
    }
  });

  app.get("/api/models/runs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await storage.getExcelModelRun(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });

      const template = await storage.getExcelTemplate(run.templateId);
      const outputMapping = template ? JSON.parse(template.outputMapping || "{}") : {};
      const inputMapping = template ? JSON.parse(template.inputMapping || "{}") : {};

      res.json({
        ...run,
        inputValues: JSON.parse(run.inputValues || "{}"),
        outputValues: run.outputValues ? JSON.parse(run.outputValues) : null,
        inputMapping,
        outputMapping,
        templateName: template?.name,
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch run" });
    }
  });

  app.post("/api/models/runs", requireAuth, async (req: Request, res: Response) => {
    try {
      const { templateId, name, inputValues } = req.body;
      if (!templateId || !name) {
        return res.status(400).json({ message: "Template ID and name are required" });
      }

      const template = await storage.getExcelTemplate(templateId);
      if (!template) return res.status(404).json({ message: "Template not found" });

      await ensureTemplateFile(template.filePath);
      const wb = XLSX.readFile(template.filePath);
      const inputMapping = JSON.parse(template.inputMapping || "{}");
      const outputMapping = JSON.parse(template.outputMapping || "{}");

      if (inputValues && typeof inputValues === "object") {
        for (const [key, value] of Object.entries(inputValues)) {
          const mapping = inputMapping[key];
          if (mapping) {
            const ws = wb.Sheets[mapping.sheet];
            if (ws) {
              writeCellValue(ws, mapping.cell, value, mapping.type);
            }
          }
        }
      }

      const runFileName = `run-${Date.now()}-${name.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`;
      const runFilePath = path.join(RUNS_DIR, runFileName);
      XLSX.writeFile(wb, runFilePath);
      try { await saveFileFromDisk(`runs/${runFileName}`, runFilePath, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${name}.xlsx`); } catch {}

      const reloadedWb = XLSX.readFile(runFilePath);
      const outputs = extractOutputs(reloadedWb, outputMapping);

      const run = await storage.createExcelModelRun({
        templateId,
        name,
        inputValues: JSON.stringify(inputValues || {}),
        outputValues: JSON.stringify(outputs),
        generatedFilePath: runFilePath,
        status: "completed",
      });

      res.json({
        ...run,
        inputValues: inputValues || {},
        outputValues: outputs,
      });
    } catch (err: any) {
      console.error("Model run error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to create model run" });
    }
  });

  app.get("/api/models/runs/:id/download", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await storage.getExcelModelRun(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (!run.generatedFilePath) return res.status(404).json({ message: "Generated file not found" });
      await ensureRunFile(run.generatedFilePath);
      if (!fs.existsSync(run.generatedFilePath)) {
        return res.status(404).json({ message: "Generated file not found" });
      }
      const resolved = path.resolve(run.generatedFilePath);
      if (!resolved.startsWith(path.resolve(RUNS_DIR))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const safeName = run.name.replace(/[^a-zA-Z0-9 _-]/g, "_");
      res.download(resolved, `${safeName}.xlsx`);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  app.get("/api/models/templates/:id/download", requireAuth, async (req: Request, res: Response) => {
    try {
      const template = await storage.getExcelTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });
      if (!template.filePath) return res.status(404).json({ message: "Template file not found" });
      await ensureTemplateFile(template.filePath);
      if (!fs.existsSync(template.filePath)) {
        return res.status(404).json({ message: "Template file not found" });
      }
      const resolved = path.resolve(template.filePath);
      const safeName = (template.name || "template").replace(/[^a-zA-Z0-9 _-]/g, "_");
      res.download(resolved, `${safeName}.xlsx`);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to download template" });
    }
  });

  app.post("/api/models/templates/:id/save-to-sharepoint", requireAuth, async (req: Request, res: Response) => {
    try {
      const template = await storage.getExcelTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });
      if (!template.filePath) return res.status(404).json({ message: "Template file not found" });
      await ensureTemplateFile(template.filePath);
      if (!fs.existsSync(template.filePath)) {
        return res.status(404).json({ message: "Template file not found" });
      }

      const { folderPath } = req.body;
      const destinationFolder = folderPath || "BGP share drive/Models";

      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);
      if (!msToken) return res.status(401).json({ message: "Microsoft 365 not connected" });

      const SP_HOST = "brucegillinghampollard.sharepoint.com";
      const SP_SITE = "/sites/BGPsharedrive";
      const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE}`, { headers: { Authorization: `Bearer ${msToken}` } });
      if (!siteRes.ok) return res.status(500).json({ message: "Could not access SharePoint" });
      const site = await siteRes.json();

      const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${msToken}` } });
      if (!drivesRes.ok) return res.status(500).json({ message: "Could not list drives" });
      const drives = await drivesRes.json();
      const bgpDrive = drives.value?.find((d: any) => d.name === "BGP share drive" || d.name === "Documents");
      if (!bgpDrive) return res.status(500).json({ message: "BGP share drive not found" });

      const fileName = `${(template.name || "model").replace(/[^a-zA-Z0-9 _-]/g, "_")}.xlsx`;
      const cleanFolder = destinationFolder.replace(/^\/+|\/+$/g, "");
      const encoded = encodeURIComponent(cleanFolder).replace(/%2F/g, "/");
      const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root:/${encoded}/${encodeURIComponent(fileName)}:/content`;

      const fileBuffer = fs.readFileSync(template.filePath);
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${msToken}`,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: fileBuffer,
      });

      if (!uploadRes.ok) {
        const errBody = await uploadRes.text();
        return res.status(500).json({ message: `SharePoint upload failed: ${uploadRes.status}` });
      }

      const uploadResult = await uploadRes.json();
      res.json({ success: true, webUrl: uploadResult.webUrl, name: fileName, folder: cleanFolder });
    } catch (err: any) {
      console.error("[save-to-sharepoint]", err);
      res.status(500).json({ message: `Failed to save to SharePoint: ${err?.message}` });
    }
  });

  app.post("/api/models/runs/:id/save-to-sharepoint", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await storage.getExcelModelRun(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (!run.generatedFilePath) return res.status(404).json({ message: "Run file not found" });
      await ensureRunFile(run.generatedFilePath);
      if (!fs.existsSync(run.generatedFilePath)) {
        return res.status(404).json({ message: "Run file not found" });
      }

      const { folderPath } = req.body;
      const destinationFolder = folderPath || "BGP share drive/Models";

      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);
      if (!msToken) return res.status(401).json({ message: "Microsoft 365 not connected" });

      const SP_HOST = "brucegillinghampollard.sharepoint.com";
      const SP_SITE = "/sites/BGPsharedrive";
      const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE}`, { headers: { Authorization: `Bearer ${msToken}` } });
      if (!siteRes.ok) return res.status(500).json({ message: "Could not access SharePoint" });
      const site = await siteRes.json();

      const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${msToken}` } });
      if (!drivesRes.ok) return res.status(500).json({ message: "Could not list drives" });
      const drives = await drivesRes.json();
      const bgpDrive = drives.value?.find((d: any) => d.name === "BGP share drive" || d.name === "Documents");
      if (!bgpDrive) return res.status(500).json({ message: "BGP share drive not found" });

      const fileName = `${(run.name || "model-run").replace(/[^a-zA-Z0-9 _-]/g, "_")}.xlsx`;
      const cleanFolder = destinationFolder.replace(/^\/+|\/+$/g, "");
      const encoded = encodeURIComponent(cleanFolder).replace(/%2F/g, "/");
      const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root:/${encoded}/${encodeURIComponent(fileName)}:/content`;

      const fileBuffer = fs.readFileSync(run.generatedFilePath);
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${msToken}`,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: fileBuffer,
      });

      if (!uploadRes.ok) {
        return res.status(500).json({ message: `SharePoint upload failed: ${uploadRes.status}` });
      }

      const uploadResult = await uploadRes.json();
      await db.update(excelModelRuns).set({
        sharepointUrl: uploadResult.webUrl,
        sharepointDriveItemId: uploadResult.id,
      }).where(eq(excelModelRuns.id, req.params.id as string));
      res.json({ success: true, webUrl: uploadResult.webUrl, name: fileName, folder: cleanFolder });
    } catch (err: any) {
      console.error("[save-run-to-sharepoint]", err);
      res.status(500).json({ message: `Failed to save to SharePoint: ${err?.message}` });
    }
  });

  app.post("/api/models/runs/:id/embed-excel", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await storage.getExcelModelRun(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (!run.generatedFilePath) return res.status(404).json({ message: "Run file not found" });
      await ensureRunFile(run.generatedFilePath);
      if (!fs.existsSync(run.generatedFilePath)) {
        return res.status(404).json({ message: "Run file not found" });
      }

      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);
      if (!msToken) return res.status(401).json({ message: "Microsoft 365 not connected — required for embedded Excel" });

      const SP_HOST = "brucegillinghampollard.sharepoint.com";
      const SP_SITE = "/sites/BGPsharedrive";
      const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE}`, { headers: { Authorization: `Bearer ${msToken}` } });
      if (!siteRes.ok) return res.status(500).json({ message: "Could not access SharePoint" });
      const site = await siteRes.json();

      const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${msToken}` } });
      if (!drivesRes.ok) return res.status(500).json({ message: "Could not list drives" });
      const drives = await drivesRes.json();
      const bgpDrive = drives.value?.find((d: any) => d.name === "BGP share drive" || d.name === "Documents");
      if (!bgpDrive) return res.status(500).json({ message: "BGP share drive not found" });

      let driveItemId = run.sharepointDriveItemId;
      let webUrl = run.sharepointUrl;

      const folderPath = "Models/Live";
      const fileName = `${(run.name || "model-run").replace(/[^a-zA-Z0-9 _-]/g, "_")}.xlsx`;
      const encoded = encodeURIComponent(folderPath).replace(/%2F/g, "/");
      const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root:/${encoded}/${encodeURIComponent(fileName)}:/content`;

      const fileBuffer = fs.readFileSync(run.generatedFilePath);
      const uploadRes2 = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${msToken}`,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: fileBuffer,
      });

      if (!uploadRes2.ok) {
        return res.status(500).json({ message: `SharePoint upload failed: ${uploadRes2.status}` });
      }

      const uploadResult = await uploadRes2.json();
      webUrl = uploadResult.webUrl;
      driveItemId = uploadResult.id;

      await db.update(excelModelRuns).set({
        sharepointUrl: webUrl,
        sharepointDriveItemId: driveItemId,
      }).where(eq(excelModelRuns.id, req.params.id as string));

      const previewRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/items/${driveItemId}/preview`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${msToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      let embedUrl = "";
      if (previewRes.ok) {
        const previewData = await previewRes.json();
        embedUrl = previewData.getUrl || "";
      }

      if (!embedUrl && webUrl) {
        embedUrl = webUrl.replace(/\?.*$/, "") + "?action=embedview&wdbipreview=true";
      }

      res.json({
        success: true,
        embedUrl,
        webUrl,
        driveItemId,
        fileName,
      });
    } catch (err: any) {
      console.error("[embed-excel]", err);
      res.status(500).json({ message: `Failed to get embed URL: ${err?.message}` });
    }
  });

  app.post("/api/models/runs/:id/sync-to-sharepoint", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await storage.getExcelModelRun(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (!run.sharepointDriveItemId) return res.status(400).json({ message: "Run not synced to SharePoint yet" });
      if (!run.generatedFilePath) return res.status(404).json({ message: "Run file not found" });
      await ensureRunFile(run.generatedFilePath);
      if (!fs.existsSync(run.generatedFilePath)) {
        return res.status(404).json({ message: "Run file not found" });
      }

      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);
      if (!msToken) return res.status(401).json({ message: "Microsoft 365 not connected" });

      const fileBuffer = fs.readFileSync(run.generatedFilePath);
      const uploadUrl = `https://graph.microsoft.com/v1.0/drives/items/${run.sharepointDriveItemId}/content`;
      const uploadRes2 = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${msToken}`,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: fileBuffer,
      });

      if (!uploadRes2.ok) {
        const uploadResult = await uploadRes2.json();
        return res.status(500).json({ message: `SharePoint sync failed: ${uploadRes2.status}` });
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("[sync-to-sharepoint]", err);
      res.status(500).json({ message: `Failed to sync to SharePoint: ${err?.message}` });
    }
  });

  app.post("/api/models/templates/:id/ask", requireAuth, async (req: Request, res: Response) => {
    try {
      const { question } = req.body;
      if (!question || typeof question !== "string") {
        return res.status(400).json({ message: "Question is required" });
      }
      if (question.length > 2000) {
        return res.status(400).json({ message: "Question too long (max 2000 characters)" });
      }

      const template = await storage.getExcelTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });

      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ message: "AI integration not configured" });
      }

      await ensureTemplateFile(template.filePath);
      const wb = XLSX.readFile(template.filePath);
      const inputMapping = JSON.parse(template.inputMapping || "{}");
      const outputMapping = JSON.parse(template.outputMapping || "{}");

      const answer = await askAboutModel(wb, question, template.name, inputMapping, outputMapping);

      res.json({ answer, question });
    } catch (err: any) {
      console.error("Model Q&A error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to analyse model" });
    }
  });

  app.post("/api/models/templates/:id/design-chat", requireAuth, async (req: Request, res: Response) => {
    try {
      const { message, conversationHistory } = req.body;
      if (!message || typeof message !== "string" || message.length > 2000) {
        return res.status(400).json({ message: "Message is required (max 2000 chars)" });
      }

      const template = await storage.getExcelTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });

      await ensureTemplateFile(template.filePath);
      const wb = XLSX.readFile(template.filePath);
      const richContext = extractRichWorkbookContext(wb, 40);
      const inputMapping = JSON.parse(template.inputMapping || "{}");
      const outputMapping = JSON.parse(template.outputMapping || "{}");

      let mappingContext = "";
      if (Object.keys(inputMapping).length > 0) {
        mappingContext += "\nINPUT CELLS:\n" + Object.entries(inputMapping)
          .map(([key, m]: [string, any]) => `  ${m.label} (${m.sheet}!${m.cell})`)
          .join("\n");
      }
      if (Object.keys(outputMapping).length > 0) {
        mappingContext += "\nOUTPUT CELLS:\n" + Object.entries(outputMapping)
          .map(([key, m]: [string, any]) => `  ${m.label} (${m.sheet}!${m.cell})`)
          .join("\n");
      }

      const systemPrompt = `You are a senior Excel financial model designer at BGP (Bruce Gillingham Pollard), a premium London property consultancy. You help improve Excel template design, layout, formatting, and structure.

You have full visibility of the workbook. When the user asks you to make changes, you MUST respond with valid JSON containing:
1. "reply" — a brief explanation of what you did or recommend (1-3 sentences)
2. "changes" — an array of cell changes to apply. Each change: {"sheet":"SheetName","cell":"A1","value":"new value or =FORMULA"}

If the user asks a question (no changes needed), return: {"reply":"your answer","changes":[]}

RULES:
- Reference specific cells (e.g. "I'll update Dashboard!A1")
- For formulas, prefix with = (e.g. "=SUM(B2:B10)")
- For formatting suggestions you can't apply via cell values, explain in the reply
- Keep the model's existing structure intact unless asked to restructure
- Use professional property investment conventions (UK formatting, £, proper labels)
- For new sections, use clear headers in uppercase
- Ensure formulas reference correct cells

Return ONLY valid JSON. No markdown, no code fences.`;

      const userContent = `Model: "${template.name}"${mappingContext}\n\nWORKBOOK:\n${richContext.slice(0, 30000)}\n\nRequest: ${message}`;

      const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
      if (conversationHistory && Array.isArray(conversationHistory)) {
        for (const msg of conversationHistory.slice(-6)) {
          messages.push({
            role: msg.role === "assistant" ? "assistant" : "user",
            content: msg.content,
          });
        }
      }
      messages.push({ role: "user", content: userContent });

      let responseText = "";
      const gemini = getGeminiModelClient();
      if (gemini) {
        try {
          const geminiContents: any[] = [];
          let lastRole = "";
          for (const m of messages) {
            const role = m.role === "assistant" ? "model" : "user";
            if (role === lastRole && geminiContents.length > 0) {
              geminiContents[geminiContents.length - 1].parts[0].text += "\n\n" + m.content;
            } else {
              geminiContents.push({ role, parts: [{ text: m.content }] });
            }
            lastRole = role;
          }
          console.log("[model-design-chat] Using Gemini 3.1 Pro");
          const geminiResponse = await gemini.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: geminiContents,
            config: { maxOutputTokens: 4096, temperature: 0.3, systemInstruction: systemPrompt },
          });
          responseText = geminiResponse.text || "";
        } catch (geminiErr: any) {
          console.log("[model-design-chat] Gemini failed, falling back to Claude:", geminiErr?.message);
        }
      }

      if (!responseText) {
        console.log("[model-design-chat] Using Claude Sonnet fallback");
        const anthropic = getAnthropicClient();
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          messages,
        });
        responseText = response.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
      }

      let result: any;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON");
        result = JSON.parse(jsonMatch[0]);
      } catch {
        result = { reply: responseText.slice(0, 500), changes: [] };
      }

      const changes = Array.isArray(result.changes) ? result.changes : [];
      let appliedCount = 0;
      const skippedSheets: string[] = [];

      if (changes.length > 0) {
        for (const change of changes) {
          if (!change.sheet || !change.cell) continue;
          let ws = wb.Sheets[change.sheet];
          if (!ws) {
            if (!wb.SheetNames.includes(change.sheet)) {
              ws = XLSX.utils.aoa_to_sheet([]);
              XLSX.utils.book_append_sheet(wb, ws, change.sheet);
              console.log(`[model-design-chat] Created new sheet: ${change.sheet}`);
            } else {
              skippedSheets.push(change.sheet);
              continue;
            }
          }
          try {
            const cellAddr = XLSX.utils.decode_cell(change.cell);
            const cellRef = XLSX.utils.encode_cell(cellAddr);
            const val = change.value;
            if (val === "" || val === null || val === undefined) {
              delete ws[cellRef];
            } else if (typeof val === "string" && val.startsWith("=")) {
              ws[cellRef] = { f: val.slice(1), t: "n", v: 0 };
            } else {
              const numVal = Number(val);
              if (!isNaN(numVal) && val !== "") {
                ws[cellRef] = { v: numVal, t: "n" };
              } else {
                ws[cellRef] = { v: String(val), t: "s" };
              }
            }

            const currentRef = ws["!ref"];
            const currentRange = currentRef ? XLSX.utils.decode_range(currentRef) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
            if (cellAddr.r > currentRange.e.r) currentRange.e.r = cellAddr.r;
            if (cellAddr.c > currentRange.e.c) currentRange.e.c = cellAddr.c;
            ws["!ref"] = XLSX.utils.encode_range(currentRange);

            appliedCount++;
          } catch (cellErr: any) {
            console.log(`[model-design-chat] Failed to apply change ${change.sheet}!${change.cell}:`, cellErr?.message);
          }
        }

        if (appliedCount > 0) {
          XLSX.writeFile(wb, template.filePath);
      try { await syncFileToDisk(`templates/${path.basename(template.filePath)}`, template.filePath); } catch {}
        }
      }

      res.json({
        reply: result.reply || "Done.",
        changesApplied: appliedCount,
        totalChanges: changes.length,
      });
    } catch (err: any) {
      console.error("Model design chat error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to process design request" });
    }
  });

  app.post("/api/models/runs/:id/ask", requireAuth, async (req: Request, res: Response) => {
    try {
      const { question } = req.body;
      if (!question || typeof question !== "string") {
        return res.status(400).json({ message: "Question is required" });
      }
      if (question.length > 2000) {
        return res.status(400).json({ message: "Question too long (max 2000 characters)" });
      }

      const run = await storage.getExcelModelRun(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (!run.generatedFilePath) return res.status(404).json({ message: "Run file not found" });
      await ensureRunFile(run.generatedFilePath);
      if (!fs.existsSync(run.generatedFilePath)) {
        return res.status(404).json({ message: "Run file not found" });
      }

      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ message: "AI integration not configured" });
      }

      const template = run.templateId ? await storage.getExcelTemplate(run.templateId) : null;
      const inputMapping = template ? JSON.parse(template.inputMapping || "{}") : {};
      const outputMapping = template ? JSON.parse(template.outputMapping || "{}") : {};

      const wb = XLSX.readFile(run.generatedFilePath);
      const answer = await askAboutModel(wb, question, run.name, inputMapping, outputMapping);

      res.json({ answer, question });
    } catch (err: any) {
      console.error("Run Q&A error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to analyse model run" });
    }
  });

  app.delete("/api/models/runs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await storage.getExcelModelRun(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.generatedFilePath) {
        try { fs.unlinkSync(run.generatedFilePath); } catch {}
        try { const { deleteFile } = await import("./file-storage"); await deleteFile(`runs/${path.basename(run.generatedFilePath)}`); } catch {}
      }
      await storage.deleteExcelModelRun(req.params.id as string);
      res.json({ message: "Run deleted" });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to delete run" });
    }
  });

  app.post("/api/models/smart-extract", requireAuth, docUpload.array("documents", 5), async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No documents uploaded" });
      }

      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ message: "Anthropic AI integration not configured" });
      }

      const documentTexts: { name: string; text: string }[] = [];
      for (const file of files) {
        try {
          const text = await extractTextFromDocument(file.path, file.originalname);
          documentTexts.push({ name: file.originalname, text });
        } catch (err: any) {
          console.error(`Failed to extract text from ${file.originalname}:`, err?.message);
        }
      }

      if (documentTexts.length === 0) {
        return res.status(400).json({ message: "Could not extract text from any uploaded documents" });
      }

      const extracted = await extractPropertyDataWithAI(documentTexts);

      for (const file of files) {
        try { fs.unlinkSync(file.path); } catch {}
      }

      res.json({
        extracted,
        documentsProcessed: documentTexts.map((d) => d.name),
      });
    } catch (err: any) {
      console.error("Smart extract error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to extract data from documents" });
    }
  });

  app.post("/api/models/smart-run", requireAuth, docUpload.array("documents", 5), async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      const { templateId, name } = req.body;

      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No documents uploaded" });
      }
      if (!templateId) {
        return res.status(400).json({ message: "Template ID is required" });
      }
      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ message: "Anthropic AI integration not configured" });
      }

      const template = await storage.getExcelTemplate(templateId);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const documentTexts: { name: string; text: string }[] = [];
      for (const file of files) {
        try {
          const text = await extractTextFromDocument(file.path, file.originalname);
          documentTexts.push({ name: file.originalname, text });
        } catch (err: any) {
          console.error(`Failed to extract text from ${file.originalname}:`, err?.message);
        }
      }

      if (documentTexts.length === 0) {
        return res.status(400).json({ message: "Could not extract text from any uploaded documents" });
      }

      const extracted = await extractPropertyDataWithAI(documentTexts);

      const inputMapping = JSON.parse(template.inputMapping || "{}");
      const outputMapping = JSON.parse(template.outputMapping || "{}");

      const inputValues: Record<string, any> = {};
      for (const [key, mapping] of Object.entries(inputMapping) as [string, any][]) {
        if (extracted[key] !== undefined && extracted[key] !== null) {
          inputValues[key] = extracted[key];
        }
      }

      await ensureTemplateFile(template.filePath);
      const wb = XLSX.readFile(template.filePath);
      for (const [key, value] of Object.entries(inputValues)) {
        const mapping = inputMapping[key];
        if (mapping) {
          const ws = wb.Sheets[mapping.sheet];
          if (ws) {
            writeCellValue(ws, mapping.cell, value, mapping.type);
          }
        }
      }

      const runName = name || extracted.dealName || `Smart Run ${new Date().toLocaleDateString()}`;
      const runFileName = `run-${Date.now()}-${runName.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`;
      const runFilePath = path.join(RUNS_DIR, runFileName);
      XLSX.writeFile(wb, runFilePath);
      try { await saveFileFromDisk(`runs/${runFileName}`, runFilePath, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${runName}.xlsx`); } catch {}

      const reloadedWb = XLSX.readFile(runFilePath);
      const outputs = extractOutputs(reloadedWb, outputMapping);

      const run = await storage.createExcelModelRun({
        templateId,
        name: runName,
        inputValues: JSON.stringify(inputValues),
        outputValues: JSON.stringify(outputs),
        generatedFilePath: runFilePath,
        status: "completed",
      });

      for (const file of files) {
        try { fs.unlinkSync(file.path); } catch {}
      }

      res.json({
        ...run,
        inputValues,
        outputValues: outputs,
        extracted,
        documentsProcessed: documentTexts.map((d) => d.name),
      });
    } catch (err: any) {
      console.error("Smart run error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to run smart model" });
    }
  });

  const docsUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
      filename: (_req, file, cb) => {
        const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
        cb(null, unique + "-" + file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_"));
      },
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
  }).array("documents", 10);

  app.get("/api/models/create-model/status/:jobId", requireAuth, (req: Request, res: Response) => {
    const job = modelJobs.get(req.params.jobId);
    if (!job) return res.json({ status: "error", message: "Model creation was interrupted (server restarted). Please try again." });
    if (job.status === "processing") return res.json({ status: "processing" });
    if (job.status === "error") return res.json({ status: "error", message: job.error });
    return res.json({ status: "done", result: job.result });
  });

  app.post("/api/models/create-model", requireAuth, (req: Request, res: Response, next: any) => {
    docsUpload(req, res, (err: any) => {
      if (err) return res.status(400).json({ message: err.message });
      next();
    });
  }, async (req: Request, res: Response) => {
    let jobId: string | null = null;
    try {
      const description = req.body?.description;
      const modelType = req.body?.modelType;
      if (!description || typeof description !== "string") {
        return res.status(400).json({ message: "Please describe the model you want to create" });
      }

      jobId = `model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      modelJobs.set(jobId, { status: "processing", createdAt: Date.now() });

      res.json({ jobId, status: "processing" });

      // ─── Advanced ExcelJS Model Path ───────────────────────────────
      const useAdvanced = req.body?.useAdvanced === true || req.body?.useAdvanced === "true"
        || /investment appraisal|investment model|acquisition model|full model|professional model|advanced model|6.sheet|multi.sheet/i.test(description);

      if (useAdvanced) {
        console.log("[create-model] Using ADVANCED ExcelJS builder (job " + jobId + "):", description.slice(0, 80));
        try {
          const anthropic = getAnthropicClient();

          // Use Claude to extract assumptions from the description
          const extractPrompt = `You are an expert UK property investment analyst at Bruce Gillingham Pollard. Extract financial model assumptions from the user's description.

Return ONLY valid JSON — no markdown, no explanation. The JSON should map assumption keys to their values.

Available assumption keys and their default values:
- purchasePrice: number (£, default 10000000)
- stampDutyRate: decimal (default 0.05)
- acquisitionCostsRate: decimal (default 0.018)
- agentFeeRate: decimal (default 0.01)
- currentRentPA: number (£ p.a., default 500000)
- totalAreaSqFt: number (default 5000)
- ervPerSqFt: number (£/sq ft, default 120)
- rentGrowthPA: decimal (default 0.025)
- voidPeriodMonths: integer (default 3)
- rentFreeMonths: integer (default 6)
- managementFeeRate: decimal (default 0.03)
- vacancyRate: decimal (default 0.05)
- opexPerSqFt: number (default 5)
- capexReserveRate: decimal (default 0.05)
- costInflationPA: decimal (default 0.02)
- ltv: decimal (default 0.60)
- interestRate: decimal (all-in, default 0.055)
- loanTermYears: integer (default 5)
- amortisationType: "Interest Only" | "Fully Amortising" | "Partial Amortisation" (default "Interest Only")
- arrangementFeeRate: decimal (default 0.015)
- exitCapRate: decimal (default 0.055)
- disposalCostsRate: decimal (default 0.02)
- holdPeriodYears: integer (default 5)
- acquisitionDate: "YYYY-MM-DD" (default "2025-07-01")
- corporateTaxRate: decimal (default 0.25)

Also include:
- "modelName": string (short name for the model)
- "quarters": integer (number of quarterly periods, default = holdPeriodYears * 4)

Only include keys where the user has specified or implied a value. Use sensible London commercial property defaults for anything not mentioned. Percentages should be decimals (e.g., 5% = 0.05).`;

          const extractResponse = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4000,
            system: extractPrompt,
            messages: [{ role: "user", content: `Create an investment appraisal model for: ${description}${modelType ? `\nModel type: ${modelType}` : ""}` }],
          });

          const extractText = extractResponse.content[0]?.type === "text" ? extractResponse.content[0].text : "{}";
          const cleaned = extractText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          let parsed: any = {};
          try {
            parsed = JSON.parse(cleaned);
          } catch {
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
          }

          const modelName = parsed.modelName || description.slice(0, 60);
          const quarters = parsed.quarters || (parsed.holdPeriodYears ? parsed.holdPeriodYears * 4 : 20);
          delete parsed.modelName;
          delete parsed.quarters;

          console.log(`[create-model] Advanced model: "${modelName}", ${quarters} quarters, ${Object.keys(parsed).length} assumptions extracted`);

          // Build the professional ExcelJS model
          const buffer = await buildInvestmentModel({
            modelName,
            assumptions: parsed,
            quarters,
          });

          // Save the file
          const fileName = `${Date.now()}-${modelName.replace(/[^a-zA-Z0-9._-]/g, "_")}.xlsx`;
          const filePath = path.join(UPLOAD_DIR, fileName);
          fs.writeFileSync(filePath, buffer);
          try { await saveFileFromDisk(`templates/${fileName}`, filePath, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName); } catch {}

          // Create template record
          const template = await storage.createExcelTemplate({
            name: modelName,
            description: `Professional investment appraisal: ${description.slice(0, 200)}`,
            filePath,
            originalFileName: fileName,
            inputMapping: JSON.stringify({}),
            outputMapping: JSON.stringify({}),
          });

          const result = {
            ...template,
            analysis: { sheets: [
              { name: 'Summary', rows: 30, cols: 6 },
              { name: 'Assumptions', rows: 50, cols: 4 },
              { name: 'Cash Flow', rows: 60, cols: quarters + 4 },
              { name: 'Debt Schedule', rows: 35, cols: quarters + 2 },
              { name: 'Sensitivity', rows: 40, cols: 10 },
              { name: 'Returns Analysis', rows: 45, cols: 5 },
            ], properties: [] },
            inputMapping: {},
            outputMapping: {},
            sheetsCreated: ['Summary', 'Assumptions', 'Cash Flow', 'Debt Schedule', 'Sensitivity', 'Returns Analysis'],
            advancedModel: true,
          };

          modelJobs.set(jobId, { status: "done", result, createdAt: Date.now() });
          console.log("[create-model] Advanced model job", jobId, "completed successfully — 6 sheets with working formulas");
          return;
        } catch (advErr: any) {
          console.error("[create-model] Advanced builder failed, falling back to standard:", advErr?.message);
          // Fall through to standard builder below
        }
      }
      // ─── End Advanced ExcelJS Model Path ───────────────────────────

      console.log("[create-model] Starting model creation (job " + jobId + "):", description.slice(0, 80));
      const anthropic = getAnthropicClient();

      const systemPrompt = `Expert financial modeller for Bruce Gillingham Pollard (London property, Belgravia/Mayfair/Chelsea). Respond with valid JSON only — no markdown.

JSON: {"name":"...","description":"...","sheets":[{"name":"...","cells":{"B2":{"v":"Label","bold":true},"C2":{"v":100000,"nf":"#,##0;(#,##0);\\"-\\""}},"colWidths":{"A":5,"B":40},"merges":["B2:D2"],"expandQuarters":{"templateCols":["E","F"],"totalQuarters":20,"startRow":2,"endRow":50}}],"inputCells":{...},"outputCells":{...}}

Cell: "v"=display value (for labels/hardcoded inputs), "f"=formula (no = prefix), "pv"=pre-calculated numeric result of the formula (REQUIRED for every formula cell), "nf"=format, "bold"=true, "align"="right".
CRITICAL — "pv" rule: xlsx-js cannot evaluate formulas, so every formula cell MUST include "pv" with a realistic numeric estimate so the file shows values immediately on open. Example: {"f":"SUM(C6:C10)","pv":2500000,"nf":"£#,##0"}. For XIRR: {"f":"XIRR(C20:V20,C5:V5)","pv":0.142}. Missing "pv" = blank cell.
Formats: £#,##0;(£#,##0);"-" (GBP), #,##0;(#,##0);"-" (int), #,##0.0%;(#,##0.0%);"-" (%), dd-mmm-yy (dates).

2 sheets. Row 1 blank. Col A=spacer(5w). Labels in B(40w).

"Assumptions": B=labels, C=values, D=notes. LEAVE 1 BLANK ROW between each section for readability. Sections: ACQUISITION (Purchase Price, Stamp Duty, Acquisition Costs, Total Acquisition Cost=SUM of above), [blank row], DEBT (Loan Amount e.g. =TotalAcqCost*LTV%, Finance Arrangement Fee with formula linking to Loan Amount e.g. =LoanAmount*1.5%, Equity Contribution=TotalAcqCost-LoanAmount — NEVER reference cells below Equity for Equity calc), [blank row], EXIT, [blank row], INCOME (per tenant), [blank row], CLIENT LIABILITY. IMPORTANT: Equity Contribution must equal Total Acquisition Cost minus Loan Amount. Finance Arrangement Fee MUST use a formula referencing the Loan Amount cell. Double-check all Assumptions formulas reference the correct rows.

INPUT CELL FORMATTING: Any cell in column C on the Assumptions sheet that contains a hard-coded constant (not a formula) — i.e. user inputs like purchase price, percentages, rates, dates — must have fill colour {"fgColor":"FFFFC0"} and font colour {"color":"0000FF"}. This visually distinguishes editable inputs from calculated cells. Do NOT apply this formatting to formula cells or label cells.

"Cash Flow": ONLY define cols B-F (B=labels, C=Entry, D=Exit, E=Q1, F=Q2). Add "expandQuarters" to auto-replicate E/F formulas across remaining quarters.
Row 2: B2 = sheet title (bold, e.g. "Cash Flow Projection"). This row is ONLY for the title — no other data in row 2. Row 3 blank spacer.
Row 4: column headers — C4:"Entry", D4:"Exit", E4:"Q1", F4:"Q2" (quarter labels auto-expand).
Row 5: QUARTER START DATES — C5: acquisition date as "YYYY-MM-DD" string, D5: exit date as "YYYY-MM-DD" string, E5: Q1 start date as "YYYY-MM-DD" string (same as acquisition date), F5: Q2 start date as "YYYY-MM-DD" string (E5 + 3 months). These MUST be literal date strings like "2025-07-01" NOT formulas, so the server can auto-expand them to Q3, Q4, etc. XIRR formulas reference this date row.
All data rows start from row 6 onwards (row 2 = title, row 3 = blank, row 4 = headers, row 5 = dates, row 6+ = data).
LEAVE 1 BLANK ROW between each major section (e.g. after dates, after gross income, after deductions, after NOI, after debt service, after exit, etc.) for readability.
Sections: GROSS INCOME, GROSS RENTS, DEDUCTIONS, NOI, DEBT SERVICE, LEVERED NCF, EXIT, EQUITY CASH FLOW, IRR (XIRR), RETURNS, SENSITIVITIES.

CRITICAL RULES:
1. For Cash Flow, ONLY define 2 quarter columns (E,F). The server expands to full hold period. XIRR/IRR ranges will be auto-adjusted. Keep JSON under 30KB. Use "expandQuarters" on Cash Flow sheet.
2. For nil/zero values use numeric 0, NEVER use "-" or "–" strings as cell values — they cause #VALUE errors. The number format already shows dashes for zeros.
3. Quarter start dates in E3, F3 MUST be literal "YYYY-MM-DD" date strings (e.g. "2025-07-01", "2025-10-01") — NEVER formulas. The server auto-increments them by 3 months per quarter during expansion. XIRR formulas must reference this date row for the dates argument.
4. Unlevered IRR: The XIRR cash flow series must start with the NEGATIVE Total Acquisition Cost as the initial outflow in the Entry column, include all quarterly NOI cash flows, and end with Exit Proceeds. The dates argument must reference the corresponding date row. Do NOT use levered cash flows for the unlevered IRR.
5. Levered IRR: The XIRR must start with the NEGATIVE Equity Contribution as the initial outflow, include all quarterly levered net cash flows (after debt service), and end with levered exit proceeds.`;

      let raw = "";
      let fullResponse: any = null;
      const maxAttempts = 3;
      let currentMessages: any[] = [
        {
          role: "user",
          content: `Create a professional Excel financial model for: ${description}${modelType ? `\nModel type: ${modelType}` : ""}\n\nUse real formulas, quarterly cash flows, XIRR. Keep JSON compact — define 2 quarterly columns explicitly then use formula patterns. Short labels. No empty cells. Use 0 (numeric zero) for nil values, never "-".`,
        },
      ];

      const startTime = Date.now();
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const attemptStart = Date.now();
        fullResponse = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 12000,
          system: systemPrompt,
          messages: currentMessages,
        });

        const chunk = fullResponse.content[0]?.type === "text" ? fullResponse.content[0].text : "";
        raw += chunk;
        console.log(`[create-model] Attempt ${attempt + 1}: ${chunk.length} chars in ${((Date.now() - attemptStart) / 1000).toFixed(1)}s (total ${raw.length} chars, ${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);

        if (fullResponse.stop_reason === "end_turn") break;

        if (fullResponse.stop_reason === "max_tokens" && attempt < maxAttempts - 1) {
          console.log(`[create-model] Response truncated, requesting continuation...`);
          currentMessages = [
            ...currentMessages,
            { role: "assistant", content: chunk },
            { role: "user", content: "Continue the JSON from exactly where you left off. Do not restart or repeat — just continue the output." },
          ];
        } else {
          break;
        }
      }
      let modelDef: any;
      try {
        const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const tryParse = (s: string): any => {
          try { return JSON.parse(s); } catch { return null; }
        };
        modelDef = tryParse(cleaned);
        if (!modelDef) {
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (jsonMatch) modelDef = tryParse(jsonMatch[0]);
        }
        if (!modelDef) {
          let truncated = cleaned;
          if (!truncated.startsWith("{")) {
            const idx = truncated.indexOf("{");
            if (idx >= 0) truncated = truncated.slice(idx);
          }
          const openBraces = (truncated.match(/\{/g) || []).length;
          const closeBraces = (truncated.match(/\}/g) || []).length;
          const openBrackets = (truncated.match(/\[/g) || []).length;
          const closeBrackets = (truncated.match(/\]/g) || []).length;
          let repaired = truncated.replace(/,\s*$/, "").replace(/,\s*\}/g, "}").replace(/,\s*\]/g, "]");
          repaired = repaired.replace(/"[^"]*$/, '"');
          for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]";
          for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}";
          console.log("[create-model] Attempting JSON repair — closing", openBraces - closeBraces, "braces and", openBrackets - closeBrackets, "brackets");
          modelDef = tryParse(repaired);
          if (!modelDef) {
            const lastGoodCell = repaired.lastIndexOf('":{"');
            if (lastGoodCell > 0) {
              const lastCompleteCell = repaired.lastIndexOf('},"', lastGoodCell);
              if (lastCompleteCell > 0) {
                let sliced = repaired.slice(0, lastCompleteCell + 1);
                const ob = (sliced.match(/\{/g) || []).length;
                const cb = (sliced.match(/\}/g) || []).length;
                const oB = (sliced.match(/\[/g) || []).length;
                const cB = (sliced.match(/\]/g) || []).length;
                for (let i = 0; i < oB - cB; i++) sliced += "]";
                for (let i = 0; i < ob - cb; i++) sliced += "}";
                modelDef = tryParse(sliced);
                if (modelDef) console.log("[create-model] Recovered model with partial sheet data (kept all complete cells)");
              }
            }
            if (!modelDef) {
              const lastValidSheet = repaired.lastIndexOf('"cells"');
              if (lastValidSheet > 0) {
                const lastCompleteObj = repaired.lastIndexOf("},", lastValidSheet);
                if (lastCompleteObj > 0) {
                  let sliced = repaired.slice(0, lastCompleteObj + 1);
                  const ob = (sliced.match(/\{/g) || []).length;
                  const cb = (sliced.match(/\}/g) || []).length;
                  const oB = (sliced.match(/\[/g) || []).length;
                  const cB = (sliced.match(/\]/g) || []).length;
                  for (let i = 0; i < oB - cB; i++) sliced += "]";
                  for (let i = 0; i < ob - cb; i++) sliced += "}";
                  modelDef = tryParse(sliced);
                  if (modelDef) console.log("[create-model] Recovered partial model by truncating incomplete sheet");
                }
              }
            }
          }
        }
        if (!modelDef) throw new Error("No valid JSON found");
      } catch (parseErr: any) {
        console.error("[create-model] JSON parse failed. Raw length:", raw.length, "First 500 chars:", raw.slice(0, 500));
        modelJobs.set(jobId, { status: "error", error: "The AI response couldn't be parsed. Please try again.", createdAt: Date.now() });
        return;
      }

      if (!modelDef.sheets || !Array.isArray(modelDef.sheets) || modelDef.sheets.length === 0) {
        modelJobs.set(jobId, { status: "error", error: "The AI generated an empty model. Please try again with more detail.", createdAt: Date.now() });
        return;
      }

      normalizeFormulaCells(modelDef);
      expandQuarterColumns(modelDef);

      const wb = XLSX.utils.book_new();
      const usedSheetNames = new Set<string>();

      for (const sheetDef of modelDef.sheets) {
        let sheetName = (sheetDef.name || "Sheet1").slice(0, 31).replace(/[\\/*?:\[\]]/g, "");
        let suffix = 1;
        while (usedSheetNames.has(sheetName)) {
          sheetName = `${sheetName.slice(0, 28)}_${suffix++}`;
        }
        usedSheetNames.add(sheetName);

        const ws: XLSX.WorkSheet = {};
        let maxRow = 0;
        let maxCol = 0;

        for (const [cellRef, cellDef] of Object.entries(sheetDef.cells || {})) {
          try { XLSX.utils.decode_cell(cellRef); } catch { continue; }

          const cell = buildCell(cellDef as any);
          if (!cell) continue;

          ws[cellRef] = cell;

          const decoded = XLSX.utils.decode_cell(cellRef);
          if (decoded.r > maxRow) maxRow = decoded.r;
          if (decoded.c > maxCol) maxCol = decoded.c;
        }

        ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });

        if (sheetDef.colWidths && typeof sheetDef.colWidths === "object") {
          ws["!cols"] = [];
          for (const [colLetter, width] of Object.entries(sheetDef.colWidths)) {
            try {
              const colIdx = XLSX.utils.decode_col(colLetter);
              const w = typeof width === "number" ? width : 12;
              while ((ws["!cols"] as any[]).length <= colIdx) (ws["!cols"] as any[]).push({});
              (ws["!cols"] as any[])[colIdx] = { wch: Math.min(Math.max(w, 5), 80) };
            } catch {
              // skip invalid col
            }
          }
        }

        if (sheetDef.merges && Array.isArray(sheetDef.merges)) {
          ws["!merges"] = [];
          for (const m of sheetDef.merges) {
            try {
              (ws["!merges"] as any[]).push(XLSX.utils.decode_range(m));
            } catch {
              // skip invalid merge
            }
          }
        }

        if (/assumptions/i.test(sheetName)) {
          applyInputCellFormatting(ws);
        }

        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }

      const fileName = `${Date.now()}-${(modelDef.name || "model").replace(/[^a-zA-Z0-9._-]/g, "_")}.xlsx`;
      const filePath = path.join(UPLOAD_DIR, fileName);
      XLSX.writeFile(wb, filePath);
      try { await saveFileFromDisk(`templates/${fileName}`, filePath, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName); } catch {}

      const template = await storage.createExcelTemplate({
        name: modelDef.name || description.slice(0, 50),
        description: modelDef.description || description,
        filePath,
        originalFileName: fileName,
        inputMapping: JSON.stringify(modelDef.inputCells || {}),
        outputMapping: JSON.stringify(modelDef.outputCells || {}),
      });

      const analysis = analyzeWorkbook(wb);

      const result = {
        ...template,
        analysis,
        inputMapping: modelDef.inputCells || {},
        outputMapping: modelDef.outputCells || {},
        sheetsCreated: (modelDef.sheets || []).map((s: any) => s.name),
      };
      modelJobs.set(jobId, { status: "done", result, createdAt: Date.now() });
      console.log("[create-model] Job", jobId, "completed successfully");
    } catch (err: any) {
      console.error("[create-model] Error:", err?.message, err?.status, err?.error?.type);
      const msg = err?.status === 529 || err?.error?.type === "overloaded_error"
        ? "AI service is temporarily overloaded. Please try again in a moment."
        : err?.message?.includes?.("timeout") || err?.message?.includes?.("ETIMEDOUT")
        ? "The request timed out — the model was too complex. Try a simpler description."
        : err?.message || "Failed to create model. Please try again.";
      if (jobId && modelJobs.has(jobId)) {
        modelJobs.set(jobId, { status: "error", error: msg, createdAt: Date.now() });
      }
    }
  });

  app.post("/api/models/claude-agent", requireAuth, async (req: Request, res: Response) => {
    try {
      const { question, conversationHistory } = req.body;
      if (!question || typeof question !== "string") {
        return res.status(400).json({ message: "Question is required" });
      }

      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ message: "AI integration not configured" });
      }

      const anthropic = getAnthropicClient();

      const tools: any[] = [
        {
          name: "list_templates",
          description: "List all available Excel model templates with their IDs, names, descriptions, and file details",
          input_schema: { type: "object" as const, properties: {}, required: [] },
        },
        {
          name: "list_runs",
          description: "List all model runs with their IDs, names, input/output values, and status",
          input_schema: { type: "object" as const, properties: {}, required: [] },
        },
        {
          name: "read_template",
          description: "Read the full contents of a template including all sheets, cells, formulas, values, and mappings. Returns the complete workbook data.",
          input_schema: {
            type: "object" as const,
            properties: {
              templateId: { type: "string", description: "The template ID to read" },
            },
            required: ["templateId"],
          },
        },
        {
          name: "read_run",
          description: "Read the full contents of a model run's generated workbook including all sheets, cells, formulas, and values",
          input_schema: {
            type: "object" as const,
            properties: {
              runId: { type: "string", description: "The run ID to read" },
            },
            required: ["runId"],
          },
        },
        {
          name: "update_cells",
          description: "Update cell values or formulas in a template. Can modify existing cells or add new ones. Use this to fix formulas, update assumptions, add calculations, etc.",
          input_schema: {
            type: "object" as const,
            properties: {
              templateId: { type: "string", description: "The template ID to modify" },
              sheetName: { type: "string", description: "The sheet name to modify" },
              cells: {
                type: "object",
                description: "Object mapping cell references (e.g. 'B5') to values. Each value can be a number, string, or an object with {f: 'formula', nf: 'number_format'}",
                additionalProperties: true,
              },
            },
            required: ["templateId", "sheetName", "cells"],
          },
        },
        {
          name: "add_sheet",
          description: "Add a new sheet to a template with optional cell data",
          input_schema: {
            type: "object" as const,
            properties: {
              templateId: { type: "string", description: "The template ID" },
              sheetName: { type: "string", description: "Name for the new sheet" },
              cells: {
                type: "object",
                description: "Optional cell data for the new sheet. Object mapping cell refs to values/formulas.",
                additionalProperties: true,
              },
            },
            required: ["templateId", "sheetName"],
          },
        },
        {
          name: "delete_sheet",
          description: "Delete a sheet from a template",
          input_schema: {
            type: "object" as const,
            properties: {
              templateId: { type: "string", description: "The template ID" },
              sheetName: { type: "string", description: "The sheet name to delete" },
            },
            required: ["templateId", "sheetName"],
          },
        },
        {
          name: "rename_template",
          description: "Rename a template",
          input_schema: {
            type: "object" as const,
            properties: {
              templateId: { type: "string", description: "The template ID" },
              newName: { type: "string", description: "New name for the template" },
              newDescription: { type: "string", description: "Optional new description" },
            },
            required: ["templateId", "newName"],
          },
        },
        {
          name: "duplicate_template",
          description: "Create a copy of a template with a new name",
          input_schema: {
            type: "object" as const,
            properties: {
              templateId: { type: "string", description: "The source template ID to copy" },
              newName: { type: "string", description: "Name for the copy" },
            },
            required: ["templateId", "newName"],
          },
        },
        {
          name: "update_mappings",
          description: "Update the input or output cell mappings for a template. This controls which cells are shown as inputs/outputs in the UI.",
          input_schema: {
            type: "object" as const,
            properties: {
              templateId: { type: "string", description: "The template ID" },
              inputMapping: { type: "object", description: "New input mapping (key → {sheet, cell, label, type, group})", additionalProperties: true },
              outputMapping: { type: "object", description: "New output mapping (key → {sheet, cell, label, format, group})", additionalProperties: true },
            },
            required: ["templateId"],
          },
        },
        {
          name: "sharepoint_browse",
          description: "Browse a folder on the BGP SharePoint share drive. Use a path like 'BGP share drive/Investment' or '' for root. Returns list of files and subfolders with names, types, sizes, and web URLs.",
          input_schema: {
            type: "object" as const,
            properties: {
              folderPath: { type: "string", description: "Folder path relative to drive root. Examples: 'BGP share drive', 'BGP share drive/Investment', 'BGP share drive/London Leasing'. Use empty string for root." },
            },
            required: ["folderPath"],
          },
        },
        {
          name: "sharepoint_read_file",
          description: "Read the contents of a file from SharePoint. For Excel files, returns all cell data. For text/CSV, returns text content. Provide either a path like 'BGP share drive/Investment/report.xlsx' or a SharePoint sharing URL.",
          input_schema: {
            type: "object" as const,
            properties: {
              filePath: { type: "string", description: "File path or SharePoint sharing URL" },
            },
            required: ["filePath"],
          },
        },
        {
          name: "sharepoint_create_folder",
          description: "Create a new folder on SharePoint. All folders should be inside 'BGP share drive'. Team folders: Investment, London Leasing, National Leasing, Tenant Rep, Development, Lease Advisory, Office / Corporate.",
          input_schema: {
            type: "object" as const,
            properties: {
              folderName: { type: "string", description: "Name of the folder to create" },
              parentPath: { type: "string", description: "Parent folder path. Example: 'BGP share drive/Investment'" },
            },
            required: ["folderName", "parentPath"],
          },
        },
        {
          name: "sharepoint_move_file",
          description: "Move or rename a file/folder on SharePoint.",
          input_schema: {
            type: "object" as const,
            properties: {
              sourcePath: { type: "string", description: "Current path of the file/folder" },
              destinationFolderPath: { type: "string", description: "Destination folder path" },
              newName: { type: "string", description: "Optional new name for the item" },
            },
            required: ["sourcePath", "destinationFolderPath"],
          },
        },
        {
          name: "sharepoint_upload_template",
          description: "Upload a model template from the system to SharePoint. Copies the template's Excel file to a specified SharePoint folder.",
          input_schema: {
            type: "object" as const,
            properties: {
              templateId: { type: "string", description: "The template ID to upload" },
              destinationPath: { type: "string", description: "SharePoint folder path. Example: 'BGP share drive/Investment/Models'" },
              fileName: { type: "string", description: "Optional custom file name (defaults to original file name)" },
            },
            required: ["templateId", "destinationPath"],
          },
        },
        {
          name: "sharepoint_import_excel",
          description: "Import an Excel file from SharePoint as a new model template. Reads the file and creates a template with AI-analysed input/output mappings.",
          input_schema: {
            type: "object" as const,
            properties: {
              filePath: { type: "string", description: "SharePoint path to the Excel file. Example: 'BGP share drive/Investment/Model.xlsx'" },
              templateName: { type: "string", description: "Name for the imported template" },
            },
            required: ["filePath"],
          },
        },
        {
          name: "search_crm",
          description: "Search the BGP CRM for deals, contacts, companies, or properties by keyword. Returns matching records with IDs, names, and key details.",
          input_schema: {
            type: "object" as const,
            properties: {
              query: { type: "string", description: "Search keyword or phrase" },
              entityType: { type: "string", enum: ["deals", "contacts", "companies", "properties", "all"], description: "Which entity type to search. Default: all" },
            },
            required: ["query"],
          },
        },
        {
          name: "create_deal",
          description: "Create a new deal in the BGP CRM. Use when asked to add a deal, log a transaction, or start tracking new work.",
          input_schema: {
            type: "object" as const,
            properties: {
              name: { type: "string", description: "Deal name (usually the property address)" },
              team: { type: "array", items: { type: "string" }, description: "Team(s): London Leasing, National Leasing, Investment, Tenant Rep, Development, Lease Advisory, Office / Corporate" },
              groupName: { type: "string", description: "Pipeline stage: Under Offer, Exchanged, Completed, New Instructions, etc." },
              dealType: { type: "string", description: "Type: Letting, Acquisition, Sale, Lease Renewal, Rent Review" },
              status: { type: "string", description: "Status of the deal" },
              pricing: { type: "number", description: "Deal value/price in GBP" },
              fee: { type: "number", description: "BGP fee in GBP" },
              rentPa: { type: "number", description: "Annual rent in GBP" },
              totalAreaSqft: { type: "number", description: "Total area in sq ft" },
              comments: { type: "string", description: "Any additional notes" },
            },
            required: ["name"],
          },
        },
        {
          name: "update_deal",
          description: "Update an existing deal in the CRM. Use when asked to change a deal's status, price, stage, or any other field.",
          input_schema: {
            type: "object" as const,
            properties: {
              id: { type: "string", description: "The deal ID (UUID)" },
              name: { type: "string" },
              team: { type: "array", items: { type: "string" } },
              groupName: { type: "string" },
              dealType: { type: "string" },
              status: { type: "string" },
              pricing: { type: "number" },
              fee: { type: "number" },
              rentPa: { type: "number" },
              totalAreaSqft: { type: "number" },
              comments: { type: "string" },
            },
            required: ["id"],
          },
        },
        {
          name: "create_contact",
          description: "Create a new contact in the BGP CRM.",
          input_schema: {
            type: "object" as const,
            properties: {
              name: { type: "string", description: "Full name" },
              email: { type: "string", description: "Email address" },
              phone: { type: "string", description: "Phone number" },
              role: { type: "string", description: "Job title/role" },
              companyName: { type: "string", description: "Company name" },
              contactType: { type: "string", description: "Type: Landlord, Tenant, Agent, Surveyor, Solicitor, etc." },
              notes: { type: "string" },
            },
            required: ["name"],
          },
        },
        {
          name: "update_contact",
          description: "Update an existing contact in the CRM.",
          input_schema: {
            type: "object" as const,
            properties: {
              id: { type: "string", description: "The contact ID (UUID)" },
              name: { type: "string" },
              email: { type: "string" },
              phone: { type: "string" },
              role: { type: "string" },
              companyName: { type: "string" },
              contactType: { type: "string" },
              notes: { type: "string" },
            },
            required: ["id"],
          },
        },
        {
          name: "create_company",
          description: "Create a new company in the BGP CRM.",
          input_schema: {
            type: "object" as const,
            properties: {
              name: { type: "string", description: "Company name" },
              companyType: { type: "string", description: "Type: Landlord, Tenant, Agent, Developer, Investor, etc." },
              description: { type: "string", description: "Brief description" },
              domain: { type: "string", description: "Website domain" },
              groupName: { type: "string", description: "CRM group" },
            },
            required: ["name"],
          },
        },
        {
          name: "update_company",
          description: "Update an existing company in the CRM.",
          input_schema: {
            type: "object" as const,
            properties: {
              id: { type: "string", description: "The company ID (UUID)" },
              name: { type: "string" },
              companyType: { type: "string" },
              description: { type: "string" },
              domain: { type: "string" },
              groupName: { type: "string" },
            },
            required: ["id"],
          },
        },
        {
          name: "delete_record",
          description: "Delete a record from the CRM. Only use after confirming with the user. This is irreversible.",
          input_schema: {
            type: "object" as const,
            properties: {
              entityType: { type: "string", enum: ["deal", "contact", "company", "property"], description: "Type of record to delete" },
              id: { type: "string", description: "The record ID (UUID)" },
              confirmName: { type: "string", description: "The name of the record being deleted, for confirmation" },
            },
            required: ["entityType", "id", "confirmName"],
          },
        },
        {
          name: "property_lookup",
          description: "Look up comprehensive property information by property name, address, or postcode. Aggregates EPC energy ratings, VOA rateable values, HMLR price paid history, flood risk, listed buildings, and planning designations. Pass a property name like 'Harrods' or '10 Downing Street' — the system finds the postcode automatically.",
          input_schema: {
            type: "object" as const,
            properties: {
              postcode: { type: "string", description: "UK postcode (e.g. SW1X 8DT). If not known, provide query instead." },
              query: { type: "string", description: "Property name, address, or place name to search for" },
              street: { type: "string", description: "Street name" },
              buildingNameOrNumber: { type: "string", description: "Building name or number" },
              address: { type: "string", description: "Full address string for EPC lookup" },
            },
            required: [],
          },
        },
        {
          name: "send_email",
          description: "Send an email from the BGP shared mailbox (chatbgp@brucegillinghampollard.com).",
          input_schema: {
            type: "object" as const,
            properties: {
              to: { type: "string", description: "Recipient email address" },
              subject: { type: "string", description: "Email subject line" },
              body: { type: "string", description: "Email body (HTML supported)" },
              cc: { type: "string", description: "CC email address (optional)" },
            },
            required: ["to", "subject", "body"],
          },
        },
        {
          name: "navigate_to",
          description: "Navigate the user to a specific page in the BGP Dashboard.",
          input_schema: {
            type: "object" as const,
            properties: {
              page: { type: "string", enum: ["dashboard", "deals", "comps", "contacts", "companies", "properties", "requirements", "instructions", "news", "mail", "chatbgp", "sharepoint", "models", "templates", "settings", "land-registry", "voa-rates", "business-rates", "intelligence-map", "leasing-units", "investment-tracker"], description: "The page to navigate to" },
              message: { type: "string", description: "Brief message about why" },
            },
            required: ["page"],
          },
        },
        {
          name: "save_learning",
          description: "Save a piece of business knowledge or insight that Claude has learned during this conversation. This persists across all future conversations.",
          input_schema: {
            type: "object" as const,
            properties: {
              category: { type: "string", enum: ["client_intel", "market_knowledge", "bgp_process", "property_insight", "team_preference", "general"], description: "Category of the learning" },
              learning: { type: "string", description: "The specific knowledge or insight to remember" },
            },
            required: ["category", "learning"],
          },
        },
        {
          name: "log_app_feedback",
          description: "Log feedback about the BGP Dashboard app — bugs, suggestions, complaints, praise.",
          input_schema: {
            type: "object" as const,
            properties: {
              category: { type: "string", enum: ["bug", "suggestion", "complaint", "praise", "error"], description: "Type of feedback" },
              summary: { type: "string", description: "Short one-line summary" },
              detail: { type: "string", description: "Detailed description" },
              pageContext: { type: "string", description: "Which page or feature this relates to" },
            },
            required: ["category", "summary"],
          },
        },
        {
          name: "create_model",
          description: "Create a brand new Excel financial model from scratch using AI. Generates a complete professional spreadsheet with formulas, sheets, and input/output mappings following the BGP IRR template structure. Use when the user asks to 'create', 'build', 'make', or 'generate' a new model.",
          input_schema: {
            type: "object" as const,
            properties: {
              description: { type: "string", description: "Detailed description of what the model should calculate and include (e.g. 'A DCF model for a mixed-use property on Sloane Street with 3 tenants')" },
              modelType: { type: "string", description: "Optional model type label (e.g. 'BGP Investment Appraisal (DCF)', 'BGP Development Appraisal')" },
            },
            required: ["description"],
          },
        },
        {
          name: "request_app_change",
          description: "Submit a request to change the app's structure, layout, or add new features. Goes through developer review then admin approval.",
          input_schema: {
            type: "object" as const,
            properties: {
              description: { type: "string", description: "Detailed description of the change" },
              category: { type: "string", enum: ["feature", "layout", "field", "integration", "bug_fix", "other"], description: "Category" },
              priority: { type: "string", enum: ["low", "normal", "high", "urgent"], description: "Priority" },
            },
            required: ["description"],
          },
        },
      ];

      async function executeTool(name: string, input: any): Promise<string> {
        switch (name) {
          case "list_templates": {
            const templates = await storage.getExcelTemplates();
            return JSON.stringify(templates.map(t => ({
              id: t.id, name: t.name, description: t.description,
              originalFileName: t.originalFileName, createdAt: t.createdAt,
              inputCount: Object.keys(JSON.parse(t.inputMapping || "{}")).length,
              outputCount: Object.keys(JSON.parse(t.outputMapping || "{}")).length,
            })));
          }

          case "list_runs": {
            const runs = await storage.getExcelModelRuns();
            return JSON.stringify(runs.map(r => ({
              id: r.id, name: r.name, templateId: r.templateId,
              status: r.status, createdAt: r.createdAt,
              inputValues: r.inputValues ? JSON.parse(r.inputValues) : {},
              outputValues: r.outputValues ? JSON.parse(r.outputValues) : {},
            })));
          }

          case "read_template": {
            const template = await storage.getExcelTemplate(input.templateId);
            if (!template) return JSON.stringify({ error: "Template not found" });
            if (!fs.existsSync(template.filePath)) return JSON.stringify({ error: "Template file missing" });
            await ensureTemplateFile(template.filePath);
      const wb = XLSX.readFile(template.filePath);
            const context = extractRichWorkbookContext(wb, 100);
            const inputMapping = JSON.parse(template.inputMapping || "{}");
            const outputMapping = JSON.parse(template.outputMapping || "{}");
            return JSON.stringify({
              name: template.name, description: template.description,
              sheets: wb.SheetNames,
              inputMapping, outputMapping,
              workbookData: context.slice(0, 80000),
            });
          }

          case "read_run": {
            const run = await storage.getExcelModelRun(input.runId);
            if (!run) return JSON.stringify({ error: "Run not found" });
            if (!run.generatedFilePath) return JSON.stringify({ error: "Run file missing" });
            await ensureRunFile(run.generatedFilePath);
            if (!fs.existsSync(run.generatedFilePath)) {
              return JSON.stringify({ error: "Run file missing" });
            }
            const wb = XLSX.readFile(run.generatedFilePath);
            const context = extractRichWorkbookContext(wb, 100);
            return JSON.stringify({
              name: run.name, templateId: run.templateId,
              inputValues: run.inputValues ? JSON.parse(run.inputValues) : {},
              outputValues: run.outputValues ? JSON.parse(run.outputValues) : {},
              workbookData: context.slice(0, 80000),
            });
          }

          case "update_cells": {
            const template = await storage.getExcelTemplate(input.templateId);
            if (!template) return JSON.stringify({ error: "Template not found" });
            if (!fs.existsSync(template.filePath)) return JSON.stringify({ error: "Template file missing" });

            await ensureTemplateFile(template.filePath);
      const wb = XLSX.readFile(template.filePath);
            const ws = wb.Sheets[input.sheetName];
            if (!ws) return JSON.stringify({ error: `Sheet "${input.sheetName}" not found. Available: ${wb.SheetNames.join(", ")}` });

            let updated = 0;
            for (const [cellRef, val] of Object.entries(input.cells || {})) {
              const cell: any = {};
              if (typeof val === "object" && val !== null && (val as any).f) {
                const formula = String((val as any).f).replace(/^=/, "");
                cell.f = formula;
                cell.v = 0;
                cell.t = "n";
                if ((val as any).nf) cell.z = (val as any).nf;
              } else if (typeof val === "number") {
                cell.v = val;
                cell.t = "n";
              } else if (typeof val === "string") {
                cell.v = val;
                cell.t = "s";
              } else if (typeof val === "object" && val !== null && (val as any).v !== undefined) {
                const v = (val as any).v;
                cell.v = v;
                cell.t = typeof v === "number" ? "n" : "s";
                if ((val as any).nf) cell.z = (val as any).nf;
              }
              if (typeof val === "object" && val !== null) {
                const st: any = {};
                if ((val as any).bold) st.font = { bold: true };
                if ((val as any).align === "right") st.alignment = { horizontal: "right" };
                if ((val as any).nf) st.numFmt = (val as any).nf;
                if (Object.keys(st).length > 0) cell.s = st;
              }
              ws[cellRef] = cell;
              updated++;
            }

            const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
            for (const cellRef of Object.keys(input.cells || {})) {
              const decoded = XLSX.utils.decode_cell(cellRef);
              if (decoded.r > range.e.r) range.e.r = decoded.r;
              if (decoded.c > range.e.c) range.e.c = decoded.c;
            }
            ws["!ref"] = XLSX.utils.encode_range(range);

            XLSX.writeFile(wb, template.filePath);
      try { await syncFileToDisk(`templates/${path.basename(template.filePath)}`, template.filePath); } catch {}
            return JSON.stringify({ success: true, cellsUpdated: updated, sheet: input.sheetName });
          }

          case "add_sheet": {
            const template = await storage.getExcelTemplate(input.templateId);
            if (!template) return JSON.stringify({ error: "Template not found" });

            await ensureTemplateFile(template.filePath);
      const wb = XLSX.readFile(template.filePath);
            if (wb.SheetNames.includes(input.sheetName)) {
              return JSON.stringify({ error: `Sheet "${input.sheetName}" already exists` });
            }

            const ws: XLSX.WorkSheet = {};
            let maxRow = 0, maxCol = 0;

            if (input.cells) {
              for (const [cellRef, val] of Object.entries(input.cells)) {
                const cd = val as any;
                const cell: any = {};
                if (cd.f) {
                  cell.f = String(cd.f).replace(/^=/, "");
                  cell.v = 0;
                  cell.t = "n";
                } else if (typeof cd === "number" || (typeof cd === "object" && typeof cd.v === "number")) {
                  cell.v = typeof cd === "number" ? cd : cd.v;
                  cell.t = "n";
                } else if (typeof cd === "string" || (typeof cd === "object" && typeof cd.v === "string")) {
                  cell.v = typeof cd === "string" ? cd : cd.v;
                  cell.t = "s";
                }
                if (typeof cd === "object" && cd.nf) cell.z = cd.nf;
                if (typeof cd === "object") {
                  const st: any = {};
                  if (cd.bold) st.font = { bold: true };
                  if (cd.align === "right") st.alignment = { horizontal: "right" };
                  if (cd.nf) st.numFmt = cd.nf;
                  if (Object.keys(st).length > 0) cell.s = st;
                }
                ws[cellRef] = cell;
                const decoded = XLSX.utils.decode_cell(cellRef);
                if (decoded.r > maxRow) maxRow = decoded.r;
                if (decoded.c > maxCol) maxCol = decoded.c;
              }
            }

            ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
            XLSX.utils.book_append_sheet(wb, ws, input.sheetName);
            XLSX.writeFile(wb, template.filePath);
      try { await syncFileToDisk(`templates/${path.basename(template.filePath)}`, template.filePath); } catch {}
            return JSON.stringify({ success: true, sheetName: input.sheetName, totalSheets: wb.SheetNames.length });
          }

          case "delete_sheet": {
            const template = await storage.getExcelTemplate(input.templateId);
            if (!template) return JSON.stringify({ error: "Template not found" });

            await ensureTemplateFile(template.filePath);
      const wb = XLSX.readFile(template.filePath);
            if (!wb.SheetNames.includes(input.sheetName)) {
              return JSON.stringify({ error: `Sheet "${input.sheetName}" not found` });
            }
            if (wb.SheetNames.length <= 1) {
              return JSON.stringify({ error: "Cannot delete the only sheet in a workbook" });
            }

            delete wb.Sheets[input.sheetName];
            wb.SheetNames = wb.SheetNames.filter((n: string) => n !== input.sheetName);
            XLSX.writeFile(wb, template.filePath);
      try { await syncFileToDisk(`templates/${path.basename(template.filePath)}`, template.filePath); } catch {}
            return JSON.stringify({ success: true, deletedSheet: input.sheetName, remainingSheets: wb.SheetNames });
          }

          case "rename_template": {
            const updated = await storage.updateExcelTemplate(input.templateId, {
              name: input.newName,
              ...(input.newDescription ? { description: input.newDescription } : {}),
            });
            return JSON.stringify({ success: true, name: updated.name, description: updated.description });
          }

          case "duplicate_template": {
            const source = await storage.getExcelTemplate(input.templateId);
            if (!source) return JSON.stringify({ error: "Source template not found" });

            const newFileName = `${Date.now()}-${input.newName.replace(/[^a-zA-Z0-9._-]/g, "_")}.xlsx`;
            const newFilePath = path.join(UPLOAD_DIR, newFileName);
            fs.copyFileSync(source.filePath, newFilePath);

            const copy = await storage.createExcelTemplate({
              name: input.newName,
              description: source.description || "",
              filePath: newFilePath,
              originalFileName: newFileName,
              inputMapping: source.inputMapping,
              outputMapping: source.outputMapping,
            });
            return JSON.stringify({ success: true, newTemplateId: copy.id, name: copy.name });
          }

          case "update_mappings": {
            const updates: any = {};
            if (input.inputMapping) updates.inputMapping = JSON.stringify(input.inputMapping);
            if (input.outputMapping) updates.outputMapping = JSON.stringify(input.outputMapping);
            const updated = await storage.updateExcelTemplate(input.templateId, updates);
            return JSON.stringify({ success: true, templateId: updated.id });
          }

          case "sharepoint_browse": {
            const msToken = await getValidMsToken(req);
            if (!msToken) return JSON.stringify({ error: "Microsoft 365 is not connected. Please connect via the SharePoint page first." });

            const SP_HOST = "brucegillinghampollardlimited.sharepoint.com";
            const SP_SITE = "/sites/BGP";
            const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE}`, { headers: { Authorization: `Bearer ${msToken}` } });
            if (!siteRes.ok) return JSON.stringify({ error: "Could not access BGP SharePoint site" });
            const site = await siteRes.json();

            const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${msToken}` } });
            if (!drivesRes.ok) return JSON.stringify({ error: "Could not list drives" });
            const drives = await drivesRes.json();
            const bgpDrive = drives.value?.find((d: any) => d.name === "BGP share drive" || d.name === "Documents");
            if (!bgpDrive) return JSON.stringify({ error: "BGP share drive not found" });

            const cleanPath = (input.folderPath || "").replace(/^\/+|\/+$/g, "");
            let itemUrl: string;
            if (!cleanPath || cleanPath === "") {
              itemUrl = `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root/children?$top=200&$select=name,size,webUrl,id,file,folder,lastModifiedDateTime`;
            } else {
              const encoded = encodeURIComponent(cleanPath).replace(/%2F/g, "/");
              itemUrl = `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root:/${encoded}:/children?$top=200&$select=name,size,webUrl,id,file,folder,lastModifiedDateTime`;
            }

            const childrenRes = await fetch(itemUrl, { headers: { Authorization: `Bearer ${msToken}` } });
            if (!childrenRes.ok) return JSON.stringify({ error: `Could not list folder "${cleanPath}" (${childrenRes.status})` });
            const children = await childrenRes.json();

            const items = (children.value || []).map((c: any) => ({
              name: c.name,
              type: c.folder ? "folder" : "file",
              size: c.size ? `${Math.round(c.size / 1024)}KB` : undefined,
              lastModified: c.lastModifiedDateTime,
              webUrl: c.webUrl,
            }));
            return JSON.stringify({ success: true, path: cleanPath || "/", itemCount: items.length, items });
          }

          case "sharepoint_read_file": {
            const msToken = await getValidMsToken(req);
            if (!msToken) return JSON.stringify({ error: "Microsoft 365 is not connected." });

            const SP_HOST = "brucegillinghampollardlimited.sharepoint.com";
            const SP_SITE = "/sites/BGP";
            const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE}`, { headers: { Authorization: `Bearer ${msToken}` } });
            if (!siteRes.ok) return JSON.stringify({ error: "Could not access SharePoint" });
            const site = await siteRes.json();
            const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${msToken}` } });
            const drives = await drivesRes.json();
            const bgpDrive = drives.value?.find((d: any) => d.name === "BGP share drive" || d.name === "Documents");
            if (!bgpDrive) return JSON.stringify({ error: "Drive not found" });

            const filePath = input.filePath.trim().replace(/^\/+|\/+$/g, "");
            const encoded = encodeURIComponent(filePath).replace(/%2F/g, "/");
            const itemRes = await fetch(
              `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root:/${encoded}`,
              { headers: { Authorization: `Bearer ${msToken}` } }
            );
            if (!itemRes.ok) return JSON.stringify({ error: `File not found: ${filePath}` });
            const item = await itemRes.json();
            const fileName = item.name || filePath.split("/").pop() || "file";

            const ext = path.extname(fileName).toLowerCase();
            const downloadUrl = item["@microsoft.graph.downloadUrl"] ||
              `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root:/${encoded}:/content`;

            const fetchHeaders: Record<string, string> = {};
            if (downloadUrl.includes("graph.microsoft.com")) {
              fetchHeaders["Authorization"] = `Bearer ${msToken}`;
            }
            const fileRes = await fetch(downloadUrl, { headers: fetchHeaders });
            if (!fileRes.ok) return JSON.stringify({ error: `Failed to download (${fileRes.status})` });

            if ([".xlsx", ".xls"].includes(ext)) {
              const buffer = Buffer.from(await fileRes.arrayBuffer());
              const tempPath = path.join(process.cwd(), "ChatBGP", "sp-temp", `sp-${Date.now()}-${fileName}`);
              fs.mkdirSync(path.dirname(tempPath), { recursive: true });
              fs.writeFileSync(tempPath, buffer);
              const wb = XLSX.readFile(tempPath);
              const context = extractRichWorkbookContext(wb, 80);
              try { fs.unlinkSync(tempPath); } catch {}
              return JSON.stringify({ success: true, fileName, type: "excel", sheets: wb.SheetNames, data: context.slice(0, 60000) });
            } else if ([".csv", ".txt"].includes(ext)) {
              const text = await fileRes.text();
              return JSON.stringify({ success: true, fileName, type: "text", content: text.slice(0, 50000) });
            } else {
              return JSON.stringify({ success: true, fileName, webUrl: item.webUrl, note: `${ext} files can't be read directly, but the file exists at the URL.` });
            }
          }

          case "sharepoint_create_folder": {
            const msToken = await getValidMsToken(req);
            if (!msToken) return JSON.stringify({ error: "Microsoft 365 is not connected." });

            const SP_HOST = "brucegillinghampollardlimited.sharepoint.com";
            const SP_SITE = "/sites/BGP";
            const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE}`, { headers: { Authorization: `Bearer ${msToken}` } });
            if (!siteRes.ok) return JSON.stringify({ error: "Could not access SharePoint" });
            const site = await siteRes.json();
            const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${msToken}` } });
            const drives = await drivesRes.json();
            const bgpDrive = drives.value?.find((d: any) => d.name === "BGP share drive" || d.name === "Documents");
            if (!bgpDrive) return JSON.stringify({ error: "Drive not found" });

            const parentPath = (input.parentPath || "").replace(/^\/+|\/+$/g, "");
            let createUrl: string;
            if (!parentPath) {
              createUrl = `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root/children`;
            } else {
              createUrl = `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root:/${encodeURIComponent(parentPath).replace(/%2F/g, "/")}:/children`;
            }

            const createRes = await fetch(createUrl, {
              method: "POST",
              headers: { Authorization: `Bearer ${msToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({ name: input.folderName, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
            });

            if (createRes.status === 409) return JSON.stringify({ success: true, note: "Folder already exists" });
            if (!createRes.ok) return JSON.stringify({ error: `Failed to create folder (${createRes.status})` });
            const folder = await createRes.json();
            return JSON.stringify({ success: true, name: input.folderName, path: parentPath ? `${parentPath}/${input.folderName}` : input.folderName, webUrl: folder.webUrl });
          }

          case "sharepoint_move_file": {
            const msToken = await getValidMsToken(req);
            if (!msToken) return JSON.stringify({ error: "Microsoft 365 is not connected." });

            const SP_HOST = "brucegillinghampollardlimited.sharepoint.com";
            const SP_SITE = "/sites/BGP";
            const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE}`, { headers: { Authorization: `Bearer ${msToken}` } });
            if (!siteRes.ok) return JSON.stringify({ error: "Could not access SharePoint" });
            const site = await siteRes.json();
            const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${msToken}` } });
            const drives = await drivesRes.json();
            const bgpDrive = drives.value?.find((d: any) => d.name === "BGP share drive" || d.name === "Documents");
            if (!bgpDrive) return JSON.stringify({ error: "Drive not found" });

            const sourcePath = input.sourcePath.replace(/^\/+|\/+$/g, "");
            const sourceRes = await fetch(
              `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root:/${encodeURIComponent(sourcePath).replace(/%2F/g, "/")}`,
              { headers: { Authorization: `Bearer ${msToken}` } }
            );
            if (!sourceRes.ok) return JSON.stringify({ error: `Source not found: ${sourcePath}` });
            const sourceItem = await sourceRes.json();

            const destPath = input.destinationFolderPath.replace(/^\/+|\/+$/g, "");
            const destRes = await fetch(
              `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root:/${encodeURIComponent(destPath).replace(/%2F/g, "/")}`,
              { headers: { Authorization: `Bearer ${msToken}` } }
            );
            if (!destRes.ok) return JSON.stringify({ error: `Destination folder not found: ${destPath}` });
            const destItem = await destRes.json();

            const moveBody: any = { parentReference: { driveId: bgpDrive.id, id: destItem.id } };
            if (input.newName) moveBody.name = input.newName;

            const moveRes = await fetch(
              `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/items/${sourceItem.id}`,
              { method: "PATCH", headers: { Authorization: `Bearer ${msToken}`, "Content-Type": "application/json" }, body: JSON.stringify(moveBody) }
            );
            if (!moveRes.ok) return JSON.stringify({ error: `Move failed (${moveRes.status})` });
            const moved = await moveRes.json();
            return JSON.stringify({ success: true, name: moved.name, from: sourcePath, to: destPath, webUrl: moved.webUrl });
          }

          case "sharepoint_upload_template": {
            const msToken = await getValidMsToken(req);
            if (!msToken) return JSON.stringify({ error: "Microsoft 365 is not connected." });

            const template = await storage.getExcelTemplate(input.templateId);
            if (!template) return JSON.stringify({ error: "Template not found" });
            if (!fs.existsSync(template.filePath)) return JSON.stringify({ error: "Template file missing" });

            const SP_HOST = "brucegillinghampollardlimited.sharepoint.com";
            const SP_SITE = "/sites/BGP";
            const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE}`, { headers: { Authorization: `Bearer ${msToken}` } });
            if (!siteRes.ok) return JSON.stringify({ error: "Could not access SharePoint" });
            const site = await siteRes.json();
            const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${msToken}` } });
            const drives = await drivesRes.json();
            const bgpDrive = drives.value?.find((d: any) => d.name === "BGP share drive" || d.name === "Documents");
            if (!bgpDrive) return JSON.stringify({ error: "Drive not found" });

            const destPath = input.destinationPath.replace(/^\/+|\/+$/g, "");
            const uploadName = input.fileName || template.originalFileName;
            const fileBuffer = fs.readFileSync(template.filePath);

            const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root:/${encodeURIComponent(destPath).replace(/%2F/g, "/")}/${encodeURIComponent(uploadName)}:/content`;
            const uploadRes = await fetch(uploadUrl, {
              method: "PUT",
              headers: { Authorization: `Bearer ${msToken}`, "Content-Type": "application/octet-stream" },
              body: fileBuffer,
            });
            if (!uploadRes.ok) return JSON.stringify({ error: `Upload failed (${uploadRes.status})` });
            const uploaded = await uploadRes.json();
            return JSON.stringify({ success: true, name: uploadName, path: `${destPath}/${uploadName}`, webUrl: uploaded.webUrl });
          }

          case "sharepoint_import_excel": {
            const msToken = await getValidMsToken(req);
            if (!msToken) return JSON.stringify({ error: "Microsoft 365 is not connected." });

            const SP_HOST = "brucegillinghampollardlimited.sharepoint.com";
            const SP_SITE = "/sites/BGP";
            const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE}`, { headers: { Authorization: `Bearer ${msToken}` } });
            if (!siteRes.ok) return JSON.stringify({ error: "Could not access SharePoint" });
            const site = await siteRes.json();
            const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${msToken}` } });
            const drives = await drivesRes.json();
            const bgpDrive = drives.value?.find((d: any) => d.name === "BGP share drive" || d.name === "Documents");
            if (!bgpDrive) return JSON.stringify({ error: "Drive not found" });

            const filePath = input.filePath.replace(/^\/+|\/+$/g, "");
            const encoded = encodeURIComponent(filePath).replace(/%2F/g, "/");
            const itemRes = await fetch(
              `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root:/${encoded}`,
              { headers: { Authorization: `Bearer ${msToken}` } }
            );
            if (!itemRes.ok) return JSON.stringify({ error: `File not found: ${filePath}` });
            const item = await itemRes.json();

            const ext = path.extname(item.name || "").toLowerCase();
            if (![".xlsx", ".xls"].includes(ext)) return JSON.stringify({ error: "Only Excel files can be imported as templates" });

            const downloadUrl = item["@microsoft.graph.downloadUrl"] ||
              `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root:/${encoded}:/content`;
            const fetchHeaders: Record<string, string> = {};
            if (downloadUrl.includes("graph.microsoft.com")) fetchHeaders["Authorization"] = `Bearer ${msToken}`;
            const fileRes = await fetch(downloadUrl, { headers: fetchHeaders });
            if (!fileRes.ok) return JSON.stringify({ error: `Download failed (${fileRes.status})` });

            const buffer = Buffer.from(await fileRes.arrayBuffer());
            const localName = `${Date.now()}-${(item.name || "import.xlsx").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
            const localPath = path.join(UPLOAD_DIR, localName);
            fs.writeFileSync(localPath, buffer);

            const wb = XLSX.readFile(localPath);
            const analysis = analyzeWorkbook(wb);
            const tplName = input.templateName || path.parse(item.name || "Import").name;

            const template = await storage.createExcelTemplate({
              name: tplName,
              description: `Imported from SharePoint: ${filePath}`,
              filePath: localPath,
              originalFileName: item.name || localName,
              inputMapping: "{}",
              outputMapping: "{}",
            });

            return JSON.stringify({
              success: true,
              templateId: template.id,
              name: template.name,
              sheets: analysis.sheets.map(s => s.name),
              source: filePath,
            });
          }

          case "search_crm": {
            const q = `%${input.query}%`;
            const entityType = input.entityType || "all";
            const results: any = {};
            if (entityType === "all" || entityType === "deals") {
              results.deals = await db.select({ id: crmDeals.id, name: crmDeals.name, groupName: crmDeals.groupName, status: crmDeals.status, dealType: crmDeals.dealType, fee: crmDeals.fee, pricing: crmDeals.pricing }).from(crmDeals).where(or(ilike(crmDeals.name, q), ilike(crmDeals.comments, q))).limit(10);
            }
            if (entityType === "all" || entityType === "contacts") {
              results.contacts = await db.select({ id: crmContacts.id, name: crmContacts.name, email: crmContacts.email, role: crmContacts.role, companyName: crmContacts.companyName }).from(crmContacts).where(or(ilike(crmContacts.name, q), ilike(crmContacts.email, q))).limit(10);
            }
            if (entityType === "all" || entityType === "companies") {
              results.companies = await db.select({ id: crmCompanies.id, name: crmCompanies.name, companyType: crmCompanies.companyType }).from(crmCompanies).where(ilike(crmCompanies.name, q)).limit(10);
            }
            if (entityType === "all" || entityType === "properties") {
              results.properties = await db.select({ id: crmProperties.id, name: crmProperties.name, status: crmProperties.status }).from(crmProperties).where(ilike(crmProperties.name, q)).limit(10);
            }
            const totalFound = Object.values(results).reduce((sum: number, arr: any) => sum + (arr?.length || 0), 0);
            return JSON.stringify({ success: true, query: input.query, totalFound, results });
          }

          case "create_deal": {
            const [created] = await db.insert(crmDeals).values({
              name: input.name,
              team: input.team || [],
              groupName: input.groupName || "New Instructions",
              dealType: input.dealType,
              status: input.status,
              pricing: input.pricing,
              fee: input.fee,
              rentPa: input.rentPa,
              totalAreaSqft: input.totalAreaSqft,
              comments: input.comments,
            }).returning();
            return JSON.stringify({ success: true, action: "created", entity: "deal", id: created.id, name: created.name });
          }

          case "update_deal": {
            const { id, ...updates } = input;
            const cleanUpdates: any = {};
            for (const [k, v] of Object.entries(updates)) {
              if (v !== undefined && v !== null) cleanUpdates[k] = v;
            }
            await db.update(crmDeals).set(cleanUpdates).where(eq(crmDeals.id, id));
            return JSON.stringify({ success: true, action: "updated", entity: "deal", id, fields: Object.keys(cleanUpdates) });
          }

          case "create_contact": {
            const [created] = await db.insert(crmContacts).values({
              name: input.name,
              email: input.email,
              phone: input.phone,
              role: input.role,
              companyName: input.companyName,
              contactType: input.contactType,
              notes: input.notes,
            }).returning();
            return JSON.stringify({ success: true, action: "created", entity: "contact", id: created.id, name: created.name });
          }

          case "update_contact": {
            const { id, ...updates } = input;
            const cleanUpdates: any = {};
            for (const [k, v] of Object.entries(updates)) {
              if (v !== undefined && v !== null) cleanUpdates[k] = v;
            }
            await db.update(crmContacts).set(cleanUpdates).where(eq(crmContacts.id, id));
            return JSON.stringify({ success: true, action: "updated", entity: "contact", id, fields: Object.keys(cleanUpdates) });
          }

          case "create_company": {
            const [created] = await db.insert(crmCompanies).values({
              name: input.name,
              companyType: input.companyType,
              description: input.description,
              domain: input.domain,
              groupName: input.groupName,
            }).returning();
            return JSON.stringify({ success: true, action: "created", entity: "company", id: created.id, name: created.name });
          }

          case "update_company": {
            const { id, ...updates } = input;
            const cleanUpdates: any = {};
            for (const [k, v] of Object.entries(updates)) {
              if (v !== undefined && v !== null) cleanUpdates[k] = v;
            }
            await db.update(crmCompanies).set(cleanUpdates).where(eq(crmCompanies.id, id));
            return JSON.stringify({ success: true, action: "updated", entity: "company", id, fields: Object.keys(cleanUpdates) });
          }

          case "delete_record": {
            const deleteMap: Record<string, (id: string) => Promise<void>> = {
              deal: (id) => storage.deleteCrmDeal(id),
              contact: (id) => storage.deleteCrmContact(id),
              company: (id) => storage.deleteCrmCompany(id),
              property: (id) => storage.deleteCrmProperty(id),
            };
            const deleteFn = deleteMap[input.entityType];
            if (!deleteFn) return JSON.stringify({ error: `Unknown entity type: ${input.entityType}` });
            await deleteFn(input.id);
            return JSON.stringify({ success: true, action: "deleted", entity: input.entityType, id: input.id, name: input.confirmName });
          }

          case "property_lookup": {
            try {
              let postcode = input.postcode;
              let address = input.address;
              if (!postcode && input.query) {
                const resp = await fetch(
                  `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input.query)}&format=json&countrycodes=gb&addressdetails=1&limit=1`,
                  { headers: { "User-Agent": "BGPDashboard/1.0 (chatbgp.app)" } }
                );
                if (resp.ok) {
                  const results = await resp.json();
                  if (results.length > 0 && results[0].address?.postcode) {
                    postcode = results[0].address.postcode;
                    if (!address) address = (results[0].display_name || "").split(",").slice(0, 3).join(",").trim();
                  }
                }
              }
              if (!postcode) return JSON.stringify({ error: "Could not find a UK postcode. Please provide a more specific address or the postcode directly." });
              const lookupResult = await performPropertyLookup({ ...input, postcode, address });
              const report = formatPropertyReport(lookupResult);
              return report.slice(0, 60000);
            } catch (err: any) {
              return JSON.stringify({ error: `Property lookup failed: ${err?.message}` });
            }
          }

          case "send_email": {
            try {
              const { sendSharedMailboxEmail } = await import("./shared-mailbox");
              await sendSharedMailboxEmail({
                to: input.to,
                subject: input.subject,
                body: input.body,
                cc: input.cc,
              });
              return JSON.stringify({ success: true, action: "email_sent", to: input.to, subject: input.subject });
            } catch (err: any) {
              return JSON.stringify({ error: `Failed to send email: ${err?.message}` });
            }
          }

          case "navigate_to": {
            const pageRoutes: Record<string, string> = {
              dashboard: "/", deals: "/deals", comps: "/comps", contacts: "/contacts",
              companies: "/companies", properties: "/properties", requirements: "/requirements",
              instructions: "/instructions", news: "/news", mail: "/mail", chatbgp: "/chatbgp",
              sharepoint: "/sharepoint", models: "/models", templates: "/templates",
              settings: "/settings", "land-registry": "/land-registry", "voa-rates": "/business-rates",
              "business-rates": "/business-rates", "intelligence-map": "/edozo", "leasing-units": "/available", "investment-tracker": "/investment-tracker",
            };
            const pagePath = pageRoutes[input.page] || "/";
            return JSON.stringify({ success: true, action: "navigate", path: pagePath, message: input.message || `Navigate to ${input.page}` });
          }

          case "save_learning": {
            const userId = (req as any).session?.userId || "unknown";
            let userName = "Claude Agent";
            try {
              const user = await storage.getUser(userId);
              if (user?.name) userName = user.name;
            } catch {}
            await db.insert(chatbgpLearnings).values({
              category: input.category || "general",
              learning: input.learning,
              sourceUser: userId,
              sourceUserName: userName,
              confidence: "confirmed",
              active: true,
            });
            return JSON.stringify({ success: true, message: "Learning saved to memory." });
          }

          case "log_app_feedback": {
            const userId = (req as any).session?.userId || "unknown";
            let userName = "Claude Agent";
            try {
              const user = await storage.getUser(userId);
              if (user?.name) userName = user.name;
            } catch {}
            await db.insert(appFeedbackLog).values({
              category: input.category || "suggestion",
              summary: input.summary,
              detail: input.detail || null,
              userId,
              userName,
              threadId: null,
              pageContext: input.pageContext || null,
              status: "new",
            });
            return JSON.stringify({ success: true, message: "Feedback logged for the development team." });
          }

          case "create_model": {
            // ─── Try Advanced ExcelJS builder first ───
            try {
              console.log("[claude-agent] Using ADVANCED ExcelJS builder for create_model");
              const extractPrompt = `You are an expert UK property investment analyst. Extract financial model assumptions from the description. Return ONLY valid JSON — no markdown.

Available keys (with defaults): purchasePrice (10000000), stampDutyRate (0.05), acquisitionCostsRate (0.018), agentFeeRate (0.01), currentRentPA (500000), totalAreaSqFt (5000), ervPerSqFt (120), rentGrowthPA (0.025), voidPeriodMonths (3), rentFreeMonths (6), managementFeeRate (0.03), vacancyRate (0.05), opexPerSqFt (5), capexReserveRate (0.05), costInflationPA (0.02), ltv (0.60), interestRate (0.055), loanTermYears (5), amortisationType ("Interest Only"), arrangementFeeRate (0.015), exitCapRate (0.055), disposalCostsRate (0.02), holdPeriodYears (5), acquisitionDate ("2025-07-01"), corporateTaxRate (0.25).

Also include: "modelName" (string), "quarters" (integer, default holdPeriodYears*4). Percentages as decimals (5% = 0.05).`;

              const extractResp = await anthropic.messages.create({
                model: "claude-sonnet-4-6",
                max_tokens: 4000,
                system: extractPrompt,
                messages: [{ role: "user", content: `Create an investment appraisal for: ${input.description}${input.modelType ? `\nType: ${input.modelType}` : ""}` }],
              });

              const extText = extractResp.content[0]?.type === "text" ? extractResp.content[0].text : "{}";
              const extCleaned = extText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
              let extParsed: any = {};
              try { extParsed = JSON.parse(extCleaned); } catch { const m = extCleaned.match(/\{[\s\S]*\}/); if (m) extParsed = JSON.parse(m[0]); }

              const advModelName = extParsed.modelName || input.description?.slice(0, 60) || "Investment Model";
              const advQuarters = extParsed.quarters || (extParsed.holdPeriodYears ? extParsed.holdPeriodYears * 4 : 20);
              delete extParsed.modelName;
              delete extParsed.quarters;

              const buffer = await buildInvestmentModel({ modelName: advModelName, assumptions: extParsed, quarters: advQuarters });

              const fileName = `${Date.now()}-${advModelName.replace(/[^a-zA-Z0-9._-]/g, "_")}.xlsx`;
              const filePath = path.join(UPLOAD_DIR, fileName);
              fs.writeFileSync(filePath, buffer);
              try { await saveFileFromDisk(`templates/${fileName}`, filePath, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName); } catch {}

              const template = await storage.createExcelTemplate({
                name: advModelName,
                description: `Professional investment appraisal: ${(input.description || "").slice(0, 200)}`,
                filePath,
                originalFileName: fileName,
                inputMapping: JSON.stringify({}),
                outputMapping: JSON.stringify({}),
              });

              return JSON.stringify({
                success: true,
                action: "model_created",
                templateId: template.id,
                name: template.name,
                description: template.description,
                sheetsCreated: ['Summary', 'Assumptions', 'Cash Flow', 'Debt Schedule', 'Sensitivity', 'Returns Analysis'],
                inputCount: 0,
                outputCount: 0,
                advancedModel: true,
                formulaCount: "~800 working formulas with named ranges",
              });
            } catch (advErr: any) {
              console.error("[claude-agent] Advanced builder failed, falling back to standard:", advErr?.message);
            }

            // ─── Fallback: Standard xlsx-js-style builder ───
            const createSystemPrompt = `Expert financial modeller for Bruce Gillingham Pollard (London property, Belgravia/Mayfair/Chelsea). Respond with valid JSON only — no markdown.

JSON: {"name":"...","description":"...","sheets":[{"name":"...","cells":{"B2":{"v":"Label","bold":true},"C2":{"v":100000,"nf":"#,##0;(#,##0);\\"-\\""}},"colWidths":{"A":5,"B":40},"merges":["B2:D2"],"expandQuarters":{"templateCols":["E","F"],"totalQuarters":20,"startRow":2,"endRow":50}}],"inputCells":{...},"outputCells":{...}}

Cell: "v"=value, "f"=formula (no =prefix), "pv"=pre-calculated result (REQUIRED for formula cells), "nf"=format, "bold"=true, "align"="right".
Formats: £#,##0;(£#,##0);"-" (GBP), #,##0;(#,##0);"-" (int), #,##0.0%;(#,##0.0%);"-" (%), dd-mmm-yy (dates).

2 sheets. Row 1 blank. Col A=spacer(5w). Labels in B(40w).

"Assumptions": B=labels, C=values, D=notes. Sections: ACQUISITION, DEBT, EXIT, INCOME, CLIENT LIABILITY.
"Cash Flow": ONLY define cols B-F (B=labels, C=Entry, D=Exit, E=Q1, F=Q2). Add "expandQuarters".

CRITICAL: For Cash Flow, ONLY define 2 quarter columns (E,F). Keep JSON under 30KB. Use numeric 0 for nil values.`;

            const createResponse = await anthropic.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 12000,
              system: createSystemPrompt,
              messages: [{
                role: "user",
                content: `Create a professional Excel financial model for: ${input.description}${input.modelType ? `\nModel type: ${input.modelType}` : ""}\n\nUse real formulas, quarterly cash flows, XIRR. Keep JSON compact — define 2 quarterly columns explicitly then use formula patterns. Short labels. No empty cells. Use 0 (numeric zero) for nil values, never "-".`,
              }],
            });

            let raw = createResponse.content[0]?.type === "text" ? createResponse.content[0].text : "";

            if (createResponse.stop_reason === "max_tokens") {
              const contResponse = await anthropic.messages.create({
                model: "claude-sonnet-4-6",
                max_tokens: 12000,
                system: createSystemPrompt,
                messages: [
                  { role: "user", content: `Create a professional Excel financial model for: ${input.description}` },
                  { role: "assistant", content: raw },
                  { role: "user", content: "Continue the JSON from exactly where you left off. Do not restart or repeat — just continue the output." },
                ],
              });
              raw += contResponse.content[0]?.type === "text" ? contResponse.content[0].text : "";
            }

            let modelDef: any;
            try {
              const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
              try {
                modelDef = JSON.parse(cleaned);
              } catch {
                const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  modelDef = JSON.parse(jsonMatch[0]);
                } else {
                  throw new Error("No JSON object found");
                }
              }
            } catch (parseErr: any) {
              return JSON.stringify({ error: "Failed to parse AI response. Please try again with a clearer description." });
            }

            if (!modelDef.sheets || !Array.isArray(modelDef.sheets) || modelDef.sheets.length === 0) {
              return JSON.stringify({ error: "AI generated an empty model. Please try again with more detail." });
            }

            normalizeFormulaCells(modelDef);
      expandQuarterColumns(modelDef);

            const wb = XLSX.utils.book_new();
            const usedSheetNames = new Set<string>();

            for (const sheetDef of modelDef.sheets) {
              let sheetName = (sheetDef.name || "Sheet1").slice(0, 31).replace(/[\\/*?:\[\]]/g, "");
              let suffix = 1;
              while (usedSheetNames.has(sheetName)) {
                sheetName = `${sheetName.slice(0, 28)}_${suffix++}`;
              }
              usedSheetNames.add(sheetName);

              const ws: XLSX.WorkSheet = {};
              let maxRow = 0;
              let maxCol = 0;

              for (const [cellRef, cellDef] of Object.entries(sheetDef.cells || {})) {
                try { XLSX.utils.decode_cell(cellRef); } catch { continue; }

                const cell = buildCell(cellDef as any);
                if (!cell) continue;

                ws[cellRef] = cell;

                const decoded = XLSX.utils.decode_cell(cellRef);
                if (decoded.r > maxRow) maxRow = decoded.r;
                if (decoded.c > maxCol) maxCol = decoded.c;
              }

              ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });

              if (sheetDef.colWidths && typeof sheetDef.colWidths === "object") {
                ws["!cols"] = [];
                for (const [colLetter, width] of Object.entries(sheetDef.colWidths)) {
                  try {
                    const colIdx = XLSX.utils.decode_col(colLetter);
                    const w = typeof width === "number" ? width : 12;
                    while ((ws["!cols"] as any[]).length <= colIdx) (ws["!cols"] as any[]).push({});
                    (ws["!cols"] as any[])[colIdx] = { wch: Math.min(Math.max(w, 5), 80) };
                  } catch {}
                }
              }

              if (sheetDef.merges && Array.isArray(sheetDef.merges)) {
                ws["!merges"] = [];
                for (const m of sheetDef.merges) {
                  try { (ws["!merges"] as any[]).push(XLSX.utils.decode_range(m)); } catch {}
                }
              }

              if (/assumptions/i.test(sheetName)) {
                applyInputCellFormatting(ws);
              }

              XLSX.utils.book_append_sheet(wb, ws, sheetName);
            }

            const fileName = `${Date.now()}-${(modelDef.name || "model").replace(/[^a-zA-Z0-9._-]/g, "_")}.xlsx`;
            const filePath = path.join(UPLOAD_DIR, fileName);
            XLSX.writeFile(wb, filePath);
            try { await saveFileFromDisk(`templates/${fileName}`, filePath, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName); } catch {}

            const template = await storage.createExcelTemplate({
              name: modelDef.name || input.description.slice(0, 50),
              description: modelDef.description || input.description,
              filePath,
              originalFileName: fileName,
              inputMapping: JSON.stringify(modelDef.inputCells || {}),
              outputMapping: JSON.stringify(modelDef.outputCells || {}),
            });

            return JSON.stringify({
              success: true,
              action: "model_created",
              templateId: template.id,
              name: template.name,
              description: template.description,
              sheetsCreated: (modelDef.sheets || []).map((s: any) => s.name),
              inputCount: Object.keys(modelDef.inputCells || {}).length,
              outputCount: Object.keys(modelDef.outputCells || {}).length,
            });
          }

          case "request_app_change": {
            const userId = (req as any).session?.userId || "unknown";
            let userName = "Claude Agent";
            try {
              const user = await storage.getUser(userId);
              if (user?.name) userName = user.name;
            } catch {}
            const [created] = await db.insert(appChangeRequests).values({
              description: input.description,
              requestedBy: userName,
              requestedByUserId: userId,
              category: input.category || "feature",
              priority: input.priority || "normal",
              status: "pending",
            }).returning();
            return JSON.stringify({ success: true, action: "change_request_created", id: created.id, description: input.description });
          }

          default:
            return JSON.stringify({ error: `Unknown tool: ${name}` });
        }
      }

      const systemPrompt = `You are Claude, an expert financial modelling assistant at BGP (Bruce Gillingham Pollard), a London property consultancy specialising in Belgravia, Mayfair, and Chelsea.

You have FULL ACCESS to the entire BGP operational platform. Your capabilities include:

**Excel Models:**
- CREATE brand new models from scratch (use create_model tool)
- List, read, modify, duplicate, rename templates and runs
- Update cell values, formulas, add/delete sheets
- Update input/output mappings

**BGP SharePoint Share Drive:**
- Browse, read, create, move, rename files and folders
- Upload templates to SharePoint
- Import Excel files from SharePoint as new templates

**CRM (Deals, Contacts, Companies, Properties):**
- Search across all CRM entities by keyword
- Create and update deals, contacts, companies
- Delete records (after confirming with the user)

**Property Intelligence:**
- Look up any UK property by name, address, or postcode
- EPC ratings, VOA rateable values, HMLR price history
- Flood risk, listed buildings, planning designations

**Email:**
- Send emails from chatbgp@brucegillinghampollard.com

**Navigation:**
- Navigate the user to any page in the BGP Dashboard

**System:**
- Save business learnings to persistent memory
- Log app feedback (bugs, suggestions)
- Submit app change requests

When the user asks you to do something, USE YOUR TOOLS to actually do it — don't just describe what you would do. For example:
- "Fix the IRR formula" → read the template, find the issue, update the cell
- "Add a sensitivity table" → add a new sheet with the calculations
- "What's in my models?" → list templates and read them
- "Look up 10 Eaton Place" → property_lookup with the address
- "Find deals for Cadogan Estate" → search_crm
- "What's on SharePoint?" → browse the share drive
- "Email Tom about the deal" → send_email
Always be proactive: read the relevant data first, then make changes. After making changes, confirm exactly what you did.

Use professional UK property investment language. Format currency as GBP (£).`;

      const messages: any[] = [];

      if (conversationHistory && Array.isArray(conversationHistory)) {
        for (const msg of conversationHistory) {
          if (msg.role === "user") {
            messages.push({ role: "user", content: msg.text });
          } else if (msg.role === "ai") {
            messages.push({ role: "assistant", content: msg.text });
          }
        }
      }

      messages.push({ role: "user", content: question });

      let currentMessages = [...messages];
      let finalAnswer = "";
      let toolsUsed: string[] = [];
      const maxIterations = 10;

      for (let i = 0; i < maxIterations; i++) {
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          system: systemPrompt,
          tools,
          messages: currentMessages,
        });

        if (response.stop_reason === "tool_use") {
          const toolBlocks = response.content.filter((b: any) => b.type === "tool_use");
          const textBlocks = response.content.filter((b: any) => b.type === "text");

          currentMessages.push({ role: "assistant", content: response.content });

          const toolResults: any[] = [];
          for (const block of toolBlocks) {
            try {
              console.log(`[claude-agent] Using tool: ${block.name}`);
              toolsUsed.push(block.name);
              const result = await executeTool(block.name, block.input);
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result,
              });
            } catch (err: any) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify({ error: err.message }),
                is_error: true,
              });
            }
          }

          currentMessages.push({ role: "user", content: toolResults });
        } else {
          const text = response.content.find((b: any) => b.type === "text");
          finalAnswer = text?.text || "I completed the request but have no additional comments.";
          break;
        }
      }

      res.json({
        answer: finalAnswer,
        question,
        toolsUsed,
      });
    } catch (err: any) {
      console.error("Claude agent error:", err?.message);
      res.status(500).json({ message: err?.message || "Claude agent failed" });
    }
  });

}
