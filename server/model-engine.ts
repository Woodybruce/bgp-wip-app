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
import { registerExcelCompatFunctions } from "./model-functions";
import { desugarLet } from "./model-let";
import { boundFullRowColRefs, type SheetDims } from "./model-ranges";
import { foldPositionGuards, rewriteBooleanLiterals } from "./model-guards";

export { desugarLet };
export { boundFullRowColRefs, foldPositionGuards, rewriteBooleanLiterals };
export type { SheetDims };

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

/** Where a cell lives, so load-time rewrites can use sheet bounds and position. */
interface CellContext {
  sheetName: string;
  dimsBySheet: ReadonlyMap<string, SheetDims>;
  row: number; // 0-based
  col: number; // 0-based
}

function cellToHFValue(cell: XLSX.CellObject | undefined, ctx?: CellContext): HFScalar {
  if (!cell) return null;

  if (typeof cell.f === "string" && cell.f.length > 0) {
    let f = cell.f.startsWith("=") ? cell.f : `=${cell.f}`;
    if (ctx) {
      // Bound full-row/full-column refs (CF!$8:$8 -> CF!$A$8:$GG$8) to the used
      // range of the referenced sheet: keeps HyperFormula's static dependency
      // ranges at real cells instead of 16,384 phantom columns (model-ranges.ts).
      f = boundFullRowColRefs(f, ctx.sheetName, ctx.dimsBySheet);
      // Fold IF(COLUMN()=k,...) / IF(ROW()=k,...) guards whose outcome is fixed
      // by the host cell's position. Removes the dead edge that closes false
      // circular references in running-total rows (model-guards.ts).
      f = foldPositionGuards(f, ctx.row, ctx.col);
    }
    // Excel's bare TRUE/FALSE literals are 0-arg calls to HyperFormula
    // (model-guards.ts).
    f = rewriteBooleanLiterals(f);
    // HyperFormula has no LET: inline it away (see model-let.ts). Cheap gate
    // first so the 99% of formulas without LET skip the parser.
    return /\bLET\s*\(/i.test(f) ? desugarLet(f) : f;
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

function worksheetToHFArray(
  ws: XLSX.WorkSheet,
  sheetName?: string,
  dimsBySheet?: ReadonlyMap<string, SheetDims>,
): HFScalar[][] {
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
      const ctx: CellContext | undefined =
        sheetName && dimsBySheet ? { sheetName, dimsBySheet, row: r, col: c } : undefined;
      row[c] = cellToHFValue(ws[XLSX.utils.encode_cell({ r, c })], ctx);
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

interface HFAddress {
  sheet: number;
  row: number;
  col: number;
}

function isCycleError(v: unknown): boolean {
  return v instanceof DetailedCellError && v.value === "#CYCLE!";
}

function findFirstCycle(hf: HyperFormula, sheetIdByName: Map<string, number>): HFAddress | null {
  for (const [, sheetId] of sheetIdByName) {
    const dims = hf.getSheetDimensions(sheetId);
    for (let r = 0; r < dims.height; r++) {
      for (let c = 0; c < dims.width; c++) {
        if (isCycleError(hf.getCellValue({ sheet: sheetId, row: r, col: c }))) {
          return { sheet: sheetId, row: r, col: c };
        }
      }
    }
  }
  return null;
}

/**
 * Follow #CYCLE! precedents until the walk repeats a cell. Any closed walk in
 * the static dependency graph is a genuine circular reference, so the repeated
 * cell is guaranteed to be a member of a cycle. Returns null if the walk
 * dead-ends (then the caller should freeze the start cell itself).
 */
function walkToCycleMember(hf: HyperFormula, start: HFAddress): HFAddress | null {
  const seen = new Set<string>();
  let cur = start;
  for (let step = 0; step < 500; step++) {
    const key = `${cur.sheet}:${cur.row}:${cur.col}`;
    if (seen.has(key)) return cur;
    seen.add(key);
    const preds = hf.getCellPrecedents(cur) as any[];
    let next: HFAddress | null = null;
    for (const p of preds) {
      if (p.start) {
        // Range precedent: scan for a cyclic cell inside (bounded for safety).
        let scanned = 0;
        for (let r = p.start.row; r <= p.end.row && !next; r++) {
          for (let c = p.start.col; c <= p.end.col && !next; c++) {
            if (++scanned > 100_000) break;
            if (isCycleError(hf.getCellValue({ sheet: p.start.sheet, row: r, col: c }))) {
              next = { sheet: p.start.sheet, row: r, col: c };
            }
          }
        }
        if (next) break;
      } else if (isCycleError(hf.getCellValue(p))) {
        next = p;
        break;
      }
    }
    if (!next) return null;
    cur = next;
  }
  return null;
}

/**
 * Excel with iterative calculation OFF resolves circular references to 0 (and
 * shows a warning); HyperFormula instead marks the whole SCC #CYCLE! and the
 * error poisons every downstream cell. To reproduce the workbook's observable
 * state we freeze one member of each genuine cycle at the value Excel cached
 * in the file (0 when there is none), which breaks the SCC, and repeat until
 * the graph is acyclic. This is only reachable after the load-time transforms
 * (model-ranges / model-guards) have already removed FALSE cycles, so what
 * remains is circular in Excel too.
 */
function breakCircularReferences(
  hf: HyperFormula,
  wb: XLSX.WorkBook,
  sheetIdByName: Map<string, number>,
  warnings: string[],
): void {
  const MAX_FREEZES = 200;
  const frozen: string[] = [];
  for (let i = 0; i < MAX_FREEZES; i++) {
    const start = findFirstCycle(hf, sheetIdByName);
    if (!start) break;
    const member = walkToCycleMember(hf, start) ?? start;
    const sheet = hf.getSheetName(member.sheet) ?? String(member.sheet);
    const a1 = XLSX.utils.encode_cell({ r: member.row, c: member.col });
    const cached = wb.Sheets[sheet]?.[a1]?.v;
    const value =
      typeof cached === "number" || typeof cached === "string" || typeof cached === "boolean"
        ? cached
        : 0;
    hf.setCellContents(member, [[value]]);
    frozen.push(`${sheet}!${a1}`);
  }
  if (frozen.length > 0) {
    warnings.push(
      `Circular reference(s) with iterative calculation off; froze ${frozen.length} cell(s) at Excel-cached values: ${frozen.join(", ")}`,
    );
  }
  if (findFirstCycle(hf, sheetIdByName)) {
    warnings.push("Some circular references could not be resolved");
  }
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
  // Excel 365 semantics: range arithmetic evaluates elementwise. Required by
  // workbooks whose named expressions are array formulas (e.g.
  // Import_Key = TRIM(CLEAN(range)) & "|" & TRIM(CLEAN(range))); without it
  // those evaluate to #VALUE! and poison every dependent cell.
  useArrayArithmetic: true,
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
  registerExcelCompatFunctions(); // static, once per process; must precede buildFromSheets
  const warnings: string[] = [];
  const sheets: Record<string, HFScalar[][]> = {};
  const sheetNames: string[] = [];

  // Used-range dimensions per sheet, from SheetJS !ref. Needed up front so
  // full-row/column refs in any sheet can be bounded against the sheet they
  // point at (which may be parsed later in the loop).
  const dimsBySheet = new Map<string, SheetDims>();
  for (const name of wb.SheetNames) {
    const ref = wb.Sheets[name]?.["!ref"];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    dimsBySheet.set(name, {
      firstRow: range.s.r,
      firstCol: range.s.c,
      lastRow: range.e.r,
      lastCol: range.e.c,
    });
  }

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    if (sheetNames.includes(name)) {
      warnings.push(`Duplicate sheet name skipped: "${name}"`);
      continue;
    }
    sheets[name] = worksheetToHFArray(ws, name, dimsBySheet);
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

  // Genuine circular references (still present after the false-cycle
  // transforms): emulate Excel's no-iterative-calc behaviour by freezing one
  // member of each cycle at its Excel-cached value.
  {
    const ids = new Map<string, number>();
    for (const name of sheetNames) {
      const id = hf.getSheetId(name);
      if (id !== undefined) ids.set(name, id);
    }
    breakCircularReferences(hf, wb, ids, warnings);
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
