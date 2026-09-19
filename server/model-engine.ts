/**
 * model-engine.ts — server-side spreadsheet calculation engine.
 *
 * Wraps HyperFormula so the rest of the server never touches the underlying
 * library directly: load an .xlsx workbook (via SheetJS, which keeps formulas
 * in `cell.f`), set input cells, read freshly computed outputs, dispose.
 *
 * Swap note: everything HyperFormula-specific lives in this file. Callers use
 * only the `ModelEngine` interface and `createEngineFromWorkbook` /
 * `createEngineFromFile`.
 */
import { HyperFormula, DetailedCellError } from "hyperformula";
import XLSX from "xlsx-js-style";

export type EngineScalar = number | string | boolean | null;

export type EngineReadResult =
  | { ok: true; value: EngineScalar }
  | { ok: false; error: string };

export interface EngineCellError {
  sheet: string;
  cell: string;
  error: string;
}

export interface ModelEngine {
  readonly sheetNames: string[];
  /** Non-fatal problems found while loading (e.g. named ranges that failed to register). */
  readonly warnings: string[];
  setCell(sheet: string, cellA1: string, value: EngineScalar): void;
  getCellValue(sheet: string, cellA1: string): EngineReadResult;
  /** True when the cell exists and holds a formula. */
  isFormula(sheet: string, cellA1: string): boolean;
  /** All cells currently evaluating to an Excel error (#NAME?, #CYCLE!, ...). Capped. */
  collectErrors(limit?: number): EngineCellError[];
  dispose(): void;
}

/** Thrown when a workbook cannot be turned into a runnable engine at all. */
export class EngineLoadError extends Error {}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30); // SheetJS / Excel 1900 date system
const MAX_CELLS_PER_SHEET = 1_000_000;

function dateToExcelSerial(d: Date): number {
  return (d.getTime() - EXCEL_EPOCH_MS) / 86400000;
}

type HFScalar = string | number | boolean | null;

function cellToHFValue(cell: XLSX.CellObject | undefined): HFScalar {
  if (!cell) return null;

  if (typeof cell.f === "string" && cell.f.length > 0) {
    const f = cell.f.startsWith("=") ? cell.f : `=${cell.f}`;
    return f;
  }

  const v = cell.v;
  if (v === undefined || v === null) return null;

  switch (cell.t) {
    case "n":
      return typeof v === "number" ? v : null;
    case "b":
      return typeof v === "boolean" ? v : Boolean(v);
    case "d":
      return v instanceof Date ? dateToExcelSerial(v) : null;
    case "e":
      // Error literal cached in the file (e.g. a stale #REF!). There is no
      // formula to recompute, so keep the text — it will not poison
      // downstream arithmetic any worse than the original error did.
      return typeof v === "string" ? v : null;
    case "s":
    default:
      return typeof v === "string" ? v : String(v);
  }
}

function worksheetToHFArray(ws: XLSX.WorkSheet): HFScalar[][] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rowCount = range.e.r + 1;
  const colCount = range.e.c + 1;
  if (rowCount * colCount > MAX_CELLS_PER_SHEET) {
    throw new EngineLoadError(
      `Sheet range ${ref} exceeds engine capacity (${rowCount} x ${colCount} cells)`,
    );
  }
  const rows: HFScalar[][] = new Array(rowCount);
  for (let r = 0; r <= range.e.r; r++) {
    const row: HFScalar[] = new Array(colCount).fill(null);
    for (let c = 0; c <= range.e.c; c++) {
      row[c] = cellToHFValue(ws[XLSX.utils.encode_cell({ r, c })]);
    }
    rows[r] = row;
  }
  return rows;
}

function describeError(err: unknown): string {
  if (err instanceof DetailedCellError) return err.value;
  if (err && typeof err === "object" && "value" in (err as any)) {
    return String((err as any).value);
  }
  return String(err);
}

class HyperFormulaEngine implements ModelEngine {
  private hf: HyperFormula;
  private disposed = false;
  readonly sheetNames: string[];
  readonly warnings: string[] = [];
  private sheetIdByName = new Map<string, number>();

  constructor(hf: HyperFormula, sheetNames: string[], warnings: string[]) {
    this.hf = hf;
    this.sheetNames = sheetNames;
    this.warnings = warnings;
    for (const name of sheetNames) {
      const id = hf.getSheetId(name);
      if (id !== undefined) this.sheetIdByName.set(name, id);
    }
  }

  private addressOf(sheet: string, cellA1: string): { sheet: number; row: number; col: number } {
    if (this.disposed) throw new EngineLoadError("Engine has been disposed");
    const sheetId = this.sheetIdByName.get(sheet);
    if (sheetId === undefined) {
      throw new EngineLoadError(`Sheet not found in workbook: "${sheet}"`);
    }
    const { row, col } = a1ToRowCol(cellA1);
    return { sheet: sheetId, row, col };
  }

  setCell(sheet: string, cellA1: string, value: EngineScalar): void {
    const address = this.addressOf(sheet, cellA1);
    this.hf.setCellContents(address, [[value === undefined ? null : value]]);
  }

  getCellValue(sheet: string, cellA1: string): EngineReadResult {
    try {
      const address = this.addressOf(sheet, cellA1);
      const value = this.hf.getCellValue(address);
      if (value instanceof DetailedCellError) {
        return { ok: false, error: value.value };
      }
      if (value === null || value === undefined) return { ok: true, value: null };
      if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
        return { ok: true, value };
      }
      return { ok: true, value: String(value) };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  }

  isFormula(sheet: string, cellA1: string): boolean {
    try {
      const address = this.addressOf(sheet, cellA1);
      return this.hf.doesCellHaveFormula(address);
    } catch {
      return false;
    }
  }

  collectErrors(limit = 50): EngineCellError[] {
    const errors: EngineCellError[] = [];
    if (this.disposed) return errors;
    for (const [name, sheetId] of this.sheetIdByName) {
      const dims = this.hf.getSheetDimensions(sheetId);
      for (let r = 0; r < dims.height; r++) {
        for (let c = 0; c < dims.width; c++) {
          const value = this.hf.getCellValue({ sheet: sheetId, row: r, col: c });
          if (value instanceof DetailedCellError) {
            errors.push({
              sheet: name,
              cell: XLSX.utils.encode_cell({ r, c }),
              error: value.value,
            });
            if (errors.length >= limit) return errors;
          }
        }
      }
    }
    return errors;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.hf.destroy();
    } catch {
      // already destroyed / partially built — nothing more to release
    }
  }
}

const A1_RE = /^([A-Za-z]{1,3})([0-9]+)$/;

function a1ToRowCol(a1: string): { row: number; col: number } {
  const m = A1_RE.exec(a1.trim());
  if (!m) throw new EngineLoadError(`Invalid cell reference: "${a1}"`);
  return {
    row: parseInt(m[2], 10) - 1,
    col: XLSX.utils.decode_col(m[1].toUpperCase()),
  };
}

const HF_OPTIONS = {
  licenseKey: "gpl-v3", // see licence note in project docs; swap for a commercial key if required
  // Excel 1900 date system; DATE() serials match SheetJS serials (verified).
  leapYear1900: false,
};

/** Shape of one entry in a template's inputMapping / outputMapping. */
export interface MappedCell {
  sheet: string;
  cell: string;
  type?: string;
  format?: string;
}

/**
 * Convert a UI input value to the raw scalar stored in the workbook.
 * Mirrors writeCellValue in models.ts: "percent" inputs arrive as e.g. 5.5
 * and are stored as 0.055. Returns undefined when the value should not be
 * written at all (empty / non-numeric for a numeric input).
 */
export function normalizeInputValue(value: unknown, type?: string): EngineScalar | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (type === "text") return String(value);
  const num = type === "percent" ? parseFloat(String(value)) / 100 : parseFloat(String(value));
  if (isNaN(num)) return undefined;
  return num;
}

/** Write every mapped input into the engine. Returns the keys actually set. */
export function applyMappedInputs(
  engine: ModelEngine,
  inputValues: Record<string, unknown>,
  inputMapping: Record<string, MappedCell>,
): string[] {
  const applied: string[] = [];
  for (const [key, value] of Object.entries(inputValues || {})) {
    const mapping = inputMapping[key];
    if (!mapping?.sheet || !mapping?.cell) continue;
    const normalized = normalizeInputValue(value, mapping.type);
    if (normalized === undefined) continue;
    engine.setCell(mapping.sheet, mapping.cell, normalized);
    applied.push(key);
  }
  return applied;
}

/**
 * Format a raw engine scalar the same way extractOutputs in models.ts does,
 * so engine-computed runs and any remaining file-based reads agree.
 */
export function formatOutputValue(raw: EngineScalar, format?: string): unknown {
  if (raw === null) return null;
  if (format === "percent") {
    return typeof raw === "number" ? (raw * 100).toFixed(2) + "%" : raw;
  }
  if (format === "number0") {
    return typeof raw === "number" ? Math.round(raw).toLocaleString() : raw;
  }
  if (format === "number2") {
    return typeof raw === "number" ? raw.toFixed(2) : raw;
  }
  return raw;
}

/**
 * Read every cell in an output mapping from the engine, formatted per its
 * `format` hint. Cells that evaluate to an Excel error come back as the
 * error string (e.g. "#CYCLE!") and are also listed in `errors`.
 */
export function readEngineOutputs(
  engine: ModelEngine,
  outputMapping: Record<string, MappedCell>,
): { outputs: Record<string, unknown>; errors: EngineCellError[] } {
  const outputs: Record<string, unknown> = {};
  const errors: EngineCellError[] = [];
  for (const [key, config] of Object.entries(outputMapping || {})) {
    if (!config?.sheet || !config?.cell) {
      outputs[key] = null;
      continue;
    }
    const result = engine.getCellValue(config.sheet, config.cell);
    if (result.ok) {
      outputs[key] = formatOutputValue(result.value, config.format);
    } else {
      outputs[key] = result.error;
      errors.push({ sheet: config.sheet, cell: config.cell, error: result.error });
    }
  }
  return { outputs, errors };
}

/**
 * Build a runnable engine from a SheetJS workbook. The workbook must have been
 * read with formulas retained (the SheetJS default, `cellFormula: true`).
 * Throws EngineLoadError when the workbook cannot be loaded at all; individual
 * unsupported functions surface as per-cell Excel errors instead.
 */
export function createEngineFromWorkbook(wb: XLSX.WorkBook): ModelEngine {
  const warnings: string[] = [];
  const sheets: Record<string, HFScalar[][]> = {};
  const sheetNames: string[] = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    if (sheetNames.includes(name)) {
      warnings.push(`Duplicate sheet name skipped: "${name}"`);
      continue;
    }
    sheets[name] = worksheetToHFArray(ws);
    sheetNames.push(name);
  }

  if (sheetNames.length === 0) {
    throw new EngineLoadError("Workbook has no sheets");
  }

  let hf: HyperFormula;
  try {
    hf = HyperFormula.buildFromSheets(sheets, HF_OPTIONS);
  } catch (err: any) {
    throw new EngineLoadError(`Failed to build calculation engine: ${err?.message || err}`);
  }

  // Register the workbook's defined names. Done after the build on purpose:
  // HyperFormula recalculates dependents when a previously-unknown name
  // appears, and a broken name must not abort the whole load.
  for (const nameDef of (wb.Workbook?.Names ?? []) as any[]) {
    const name = nameDef?.Name;
    const ref = nameDef?.Ref;
    if (!name || !ref || typeof name !== "string" || typeof ref !== "string") continue;
    if (name.startsWith("_xlnm") || name.startsWith("_")) continue; // print areas etc.
    try {
      hf.addNamedExpression(name, ref.startsWith("=") ? ref : `=${ref}`);
    } catch (err: any) {
      warnings.push(`Named range "${name}" could not be registered: ${err?.message || err}`);
    }
  }

  return new HyperFormulaEngine(hf, sheetNames, warnings);
}

/**
 * Build an engine from an .xlsx file on disk. Reads with `cellFormula: true`
 * so formulas (not just cached values) reach the engine, and `sheetStubs: true`
 * so formula cells written without a cached value (e.g. by ExcelJS) are not
 * dropped by SheetJS.
 */
export function createEngineFromFile(filePath: string): ModelEngine {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.readFile(filePath, { cellFormula: true, cellDates: false, sheetStubs: true });
  } catch (err: any) {
    throw new EngineLoadError(`Failed to read workbook "${filePath}": ${err?.message || err}`);
  }
  return createEngineFromWorkbook(wb);
}
