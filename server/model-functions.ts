/**
 * model-functions.ts — Excel-compatibility shims for functions that
 * HyperFormula 3.4 does not provide (or provides with incompatible semantics).
 *
 * - LOOKUP: not implemented in HyperFormula at all (parses to #NAME?).
 * - IFS:    implemented natively, but the native version treats an error in a
 *           condition as truthy (a JS object is always truthy) and would not
 *           preserve laziness; this override follows Excel semantics.
 * - DATEDIF: implemented natively but case-sensitive — the built-in rejects
 *           lowercase units ("m") with #NUM!, while Excel accepts any case.
 * - INDEX:  implemented natively, but the built-in rejects a zero row/column
 *           with #VALUE!, while Excel returns the whole column/row vector
 *           (INDEX(range, 0, col) / INDEX(range, row, 0)) — and the built-in
 *           reads INDEX(1×N range, n) as a row index (#NUM!), while Excel's
 *           two-argument vector form selects the nth column — and the
 *           built-in's NUMBER selectors reject array selectors like
 *           SEQUENCE(10) or {1,2,3,4}. This override keeps the built-in
 *           scalar path byte-identical and adds the vector paths.
 * - MOD:    implemented natively, but the built-in uses JS truncated
 *           remainder (MOD(-7,3) = -1), while Excel floors (MOD(-7,3) = 2).
 *           Quarter-end snapping formulas (EOMONTH(d, MOD(3-MONTH(d),3)))
 *           break without Excel's sign convention.
 * - TRIM / CLEAN: implemented natively, but the built-ins type the argument
 *           STRING, which rejects a range with #VALUE! ("Cell range not
 *           allowed"), while Excel vectorizes them elementwise. These
 *           overrides take ANY and map over a SimpleRangeValue, keeping the
 *           scalar path byte-identical. (Named-range key builders like
 *           TRIM(CLEAN(D14:D200))&"|"&TRIM(CLEAN(E14:E200)) need this.)
 * - CHOOSE: implemented natively, but the built-in coerces an array selector
 *           ({1,2,3,4}) to its top-left scalar, returning only the first
 *           candidate. Excel tiles the picked candidates in the selector's
 *           grid arrangement (1×k selector → horizontal stacking). The scalar
 *           path replicates the built-in exactly.
 * - FILTER: implemented natively with NON-Excel semantics: the built-in
 *           demands a same-shape boolean mask and rejects 2-D data, while
 *           Excel keeps whole rows for a column-vector include (and whole
 *           columns for a row-vector include). This override follows Excel.
 * - MONTH / YEAR / DAY: implemented natively, but the built-ins type the
 *           argument NUMBER(minValue: 0), which rejects date TEXT ("Nov-2022")
 *           with #VALUE!; Excel coerces date text to a serial first. These
 *           overrides run HyperFormula's own scalar coercion unchanged and only
 *           add the extra date-text parse when that coercion fails.
 *
 * Registration is global and static on the HyperFormula class, so it is
 * guarded by a module-level flag: createEngineFromWorkbook calls
 * registerExcelCompatFunctions() before every buildFromSheets, and registering
 * the same plugin class twice would throw.
 */
import {
  HyperFormula,
  FunctionPlugin,
  FunctionArgumentType,
  CellError,
  ErrorType,
  SimpleRangeValue,
  EmptyValue,
  ArraySize,
} from "hyperformula";

/** HyperFormula scalar as seen by a plugin implementation. */
type HFAny = number | string | boolean | CellError | SimpleRangeValue | symbol | null;

interface RichNumberLike {
  val: number;
}

function isRichNumber(v: unknown): v is RichNumberLike {
  return (
    typeof v === "object" &&
    v !== null &&
    "val" in v &&
    typeof (v as RichNumberLike).val === "number"
  );
}

/** Unwrap HyperFormula's RichNumber (formatted numbers) to a raw number. */
function rawNumber(v: unknown): unknown {
  return isRichNumber(v) ? v.val : v;
}

/** Reduce a SimpleRangeValue-or-scalar to its top-left scalar (Excel implicit intersection fallback). */
function topLeft(v: HFAny): HFAny {
  if (v instanceof SimpleRangeValue) {
    const data = v.data;
    return data.length > 0 && data[0].length > 0 ? (data[0][0] as HFAny) : null;
  }
  return v;
}

/** Excel comparison order: numbers < text (case-insensitive) < FALSE < TRUE. */
function excelCompare(a: unknown, b: unknown): number {
  const av = rawNumber(a);
  const bv = rawNumber(b);
  const rank = (x: unknown) =>
    typeof x === "number" ? 0 : typeof x === "string" ? 1 : 2;
  const ra = rank(av);
  const rb = rank(bv);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return (av as number) - (bv as number);
  if (ra === 1) {
    const sa = (av as string).toLowerCase();
    const sb = (bv as string).toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  return (av as boolean ? 1 : 0) - (bv as boolean ? 1 : 0);
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30); // matches HF_OPTIONS leapYear1900:false

function serialToYMD(serial: number): { y: number; m: number; d: number } {
  const date = new Date(EXCEL_EPOCH_MS + Math.floor(serial) * 86400000);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

function ymdToSerial(y: number, m: number, d: number): number {
  // Date.UTC rolls overflows forward (Feb 29 on a non-leap year -> Mar 1),
  // which matches Excel's DATE() behaviour DATEDIF relies on.
  return Math.round((Date.UTC(y, m - 1, d) - EXCEL_EPOCH_MS) / 86400000);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const MONTH_BY_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function monthFromName(name: string): number | undefined {
  return MONTH_BY_ABBR[name.slice(0, 3).toLowerCase()];
}

/** Excel's 2-digit-year window: 00-29 -> 2000s, 30-99 -> 1900s. */
function normalizeYear(y: number): number {
  return y < 100 ? (y < 30 ? 2000 + y : 1900 + y) : y;
}

/**
 * Parse the date text Excel coerces in numeric context ("Nov-2022",
 * "1 Nov 2022", "November 5, 2022", "2022-11-15") to a serial number.
 * Month-year text without a day means the first of the month — Excel reads
 * "Nov-2022" typed into a cell as 1-Nov-2022. Returns undefined for text that
 * is not recognisable as a date (callers then surface the coercion error).
 */
export function parseDateTextToSerial(text: string): number | undefined {
  const t = text.trim();
  let m = /^([A-Za-z]{3,9})\s*-\s*(\d{2,4})$/.exec(t) ?? /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(t);
  if (m) {
    const month = monthFromName(m[1]);
    if (month === undefined) return undefined;
    return ymdToSerial(normalizeYear(parseInt(m[2], 10)), month, 1);
  }
  m = /^(\d{1,2})\s*[-\s]\s*([A-Za-z]{3,9})\s*[-\s,]\s*(\d{2,4})$/.exec(t);
  if (m) {
    const month = monthFromName(m[2]);
    if (month === undefined) return undefined;
    const y = normalizeYear(parseInt(m[3], 10));
    const d = parseInt(m[1], 10);
    if (d < 1 || d > daysInMonth(y, month)) return undefined;
    return ymdToSerial(y, month, d);
  }
  m = /^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{2,4})$/.exec(t);
  if (m) {
    const month = monthFromName(m[1]);
    if (month === undefined) return undefined;
    const y = normalizeYear(parseInt(m[3], 10));
    const d = parseInt(m[2], 10);
    if (d < 1 || d > daysInMonth(y, month)) return undefined;
    return ymdToSerial(y, month, d);
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) {
    const y = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    if (month < 1 || month > 12 || d < 1 || d > daysInMonth(y, month)) return undefined;
    return ymdToSerial(y, month, d);
  }
  return undefined;
}

/** Excel/HyperFormula STRING-arg coercion, replicated for ANY-typed args. */
function coerceToStringValue(arg: unknown): string | CellError {
  if (arg instanceof CellError || typeof arg === "string") return arg;
  if (arg === EmptyValue || arg === null || arg === undefined) return "";
  const raw = rawNumber(arg);
  if (typeof raw === "number") return raw.toString();
  return raw ? "TRUE" : "FALSE";
}

class ExcelCompatPlugin extends FunctionPlugin {
  /**
   * LOOKUP(lookupValue, lookupVector, [resultVector]) — vector form, and
   * LOOKUP(lookupValue, array) — array form.
   *
   * Approximate match: the largest value <= lookupValue. Implemented as a
   * linear scan from the end of the vector backwards, which reproduces
   * Excel's result on the sorted (ascending) spines this is used with and on
   * typical unsorted data. Values that are empty or errors are skipped as
   * candidates. If every value is greater than lookupValue: #N/A.
   */
  lookup(ast: any, state: any): unknown {
    return this.runFunction(ast.args, state, this.metadata("LOOKUP"), (keyArg: any, vecArg: any, resArg: any): any => {
      const key = topLeft(keyArg as HFAny);
      if (key instanceof CellError) return key;

      const vecGrid =
        vecArg instanceof SimpleRangeValue ? vecArg.data : [[vecArg === EmptyValue ? null : vecArg]];
      const vecRows = vecGrid.length;
      const vecCols = vecRows > 0 ? vecGrid[0].length : 0;
      if (vecRows === 0 || vecCols === 0) return new CellError(ErrorType.NA);

      if (resArg === undefined) {
        // Array form: search the first row (or column, when taller than wide),
        // return from the last row (or column).
        if (vecRows > vecCols) {
          return this.lookupInVector(
            key,
            vecGrid.map((row) => row[0]),
            vecGrid.map((row) => row[vecCols - 1]),
          );
        }
        return this.lookupInVector(
          key,
          vecGrid[0] as unknown[],
          vecGrid[vecRows - 1] as unknown[],
        );
      }

      // Vector form.
      const resGrid =
        resArg instanceof SimpleRangeValue ? resArg.data : [[resArg === EmptyValue ? null : resArg]];
      const horizontal = vecRows === 1;
      if (!horizontal && vecCols !== 1) return new CellError(ErrorType.NA);
      const searchVec: unknown[] = horizontal
        ? (vecGrid[0] as unknown[])
        : vecGrid.map((row) => row[0]);
      const resRows = resGrid.length;
      const resCols = resRows > 0 ? resGrid[0].length : 0;
      let resultVec: unknown[];
      if (horizontal) {
        resultVec = resRows === 1 ? (resGrid[0] as unknown[]) : resGrid.map((row) => row[0]);
      } else {
        resultVec = resCols === 1 ? resGrid.map((row) => row[0]) : (resGrid[0] as unknown[]);
      }
      return this.lookupInVector(key, searchVec, resultVec);
    });
  }

  private lookupInVector(key: unknown, searchVec: unknown[], resultVec: unknown[]): unknown {
    for (let i = searchVec.length - 1; i >= 0; i--) {
      const candidate = searchVec[i];
      if (candidate === EmptyValue || candidate === null || candidate === undefined) continue;
      if (candidate instanceof CellError) continue;
      if (excelCompare(candidate, key) <= 0) {
        if (i >= resultVec.length) return new CellError(ErrorType.NA);
        const result = resultVec[i];
        if (result instanceof CellError) return result;
        if (result === EmptyValue || result === null || result === undefined) return 0;
        return rawNumber(result);
      }
    }
    return new CellError(ErrorType.NA);
  }

  /**
   * IFS(cond1, val1, cond2, val2, ...) — value of the first truthy condition,
   * #N/A when none match. All arguments arrive eagerly evaluated, but a value
   * or condition that errored only propagates when Excel would have evaluated
   * it: conditions up to the first match, and the matched value itself.
   */
  ifs(ast: any, state: any): unknown {
    return this.runFunction(ast.args, state, this.metadata("IFS"), (...args: HFAny[]): any => {
      for (let i = 0; i + 1 < args.length; i += 2) {
        const cond = args[i];
        if (cond instanceof CellError) return cond;
        let truthy: boolean;
        if (cond === EmptyValue || cond === null || cond === undefined) {
          truthy = false;
        } else if (typeof cond === "boolean") {
          truthy = cond;
        } else if (typeof rawNumber(cond) === "number") {
          truthy = (rawNumber(cond) as number) !== 0;
        } else if (typeof cond === "string") {
          if (/^true$/i.test(cond)) truthy = true;
          else if (/^false$/i.test(cond)) truthy = false;
          else return new CellError(ErrorType.VALUE);
        } else {
          truthy = false;
        }
        if (truthy) {
          const value = args[i + 1];
          if (value instanceof CellError) return value;
          return value === EmptyValue || value === null || value === undefined
            ? 0
            : rawNumber(value);
        }
      }
      return new CellError(ErrorType.NA);
    });
  }

  /**
   * DATEDIF(start, end, unit) — case-insensitive units "Y", "M", "D", "YM",
   * "YD", "MD" with Excel semantics. Dates arrive as Excel serial numbers.
   * end < start or an unrecognised unit gives #NUM!.
   */
  datedif(ast: any, state: any): unknown {
    return this.runFunction(ast.args, state, this.metadata("DATEDIF"), (start: any, end: any, unitArg: any): any => {
      const unit = String(unitArg).toUpperCase();
      if (!["Y", "M", "D", "YM", "YD", "MD"].includes(unit)) {
        return new CellError(ErrorType.NUM);
      }
      const s = Math.floor(start as number);
      const e = Math.floor(end as number);
      if (e < s) return new CellError(ErrorType.NUM);
      if (unit === "D") return e - s;

      const sd = serialToYMD(s);
      const ed = serialToYMD(e);
      switch (unit) {
        case "M":
          return (ed.y - sd.y) * 12 + (ed.m - sd.m) - (ed.d < sd.d ? 1 : 0);
        case "Y":
          return ed.y - sd.y - (ed.m < sd.m || (ed.m === sd.m && ed.d < sd.d) ? 1 : 0);
        case "YM":
          return (((ed.m - sd.m) - (ed.d < sd.d ? 1 : 0)) % 12 + 12) % 12;
        case "YD": {
          let diff = e - ymdToSerial(ed.y, sd.m, sd.d);
          if (diff < 0) diff = e - ymdToSerial(ed.y - 1, sd.m, sd.d);
          return diff;
        }
        case "MD":
          return ed.d >= sd.d
            ? ed.d - sd.d
            : daysInMonth(ed.m === 1 ? ed.y - 1 : ed.y, ed.m === 1 ? 12 : ed.m - 1) - sd.d + ed.d;
        default:
          return new CellError(ErrorType.NUM);
      }
    });
  }

  /**
   * INDEX(range, row, [col]) — the built-in HyperFormula INDEX plus Excel's
   * whole-row/whole-column selection: a zero row or column returns that
   * column/row as a vector instead of #VALUE!. The scalar path (row >= 1,
   * col >= 1) replicates the built-in body exactly, including its top-left
   * fallback and error messages. Metadata is identical to the built-in
   * (RANGE, NUMBER, NUMBER default 1), so dependency-graph sizing is
   * unchanged; a vector only materialises at runtime, where aggregating
   * consumers (SUM, XLOOKUP, array arithmetic) absorb it.
   */
  /**
   * INDEX(range, row, [col]) — the built-in HyperFormula INDEX plus Excel's
   * whole-row/whole-column selection (zero row/column returns a vector), the
   * two-argument 1×N vector form (nth column), and array selectors
   * (INDEX(grid, SEQUENCE(10), {1,2,3,4}) → a 10×4 cross product). The scalar
   * path replicates the built-in body exactly, including its top-left
   * fallback and error messages.
   */
  index(ast: any, state: any): unknown {
    const twoArgs = ast.args.length === 2;
    return this.runFunction(ast.args, state, this.metadata("INDEX"), (rangeValue: any, row: any, col: any): any => {
      const data = rangeValue?.data as any[][] | undefined;
      const height = typeof rangeValue?.height === "function" ? rangeValue.height() : (data?.length ?? 0);
      const width = typeof rangeValue?.width === "function" ? rangeValue.width() : (data?.[0]?.length ?? 0);

      // Coerce one selector position: EmptyValue/omitted -> 0 (Excel's
      // whole-axis marker), numeric text -> number, else undefined.
      const toIdx = (v: any): number | undefined => {
        if (v === EmptyValue || v === null || v === undefined) return 0;
        const raw = rawNumber(v);
        if (typeof raw === "number") return Math.trunc(raw);
        if (typeof raw === "string" && raw.trim() !== "" && !isNaN(Number(raw))) {
          return Math.trunc(Number(raw));
        }
        if (typeof raw === "boolean") return raw ? 1 : 0;
        return undefined;
      };
      type Sel = { kind: "scalar"; n: number } | { kind: "vec"; ns: number[]; horizontal: boolean };
      const normSel = (v: any): Sel | CellError => {
        if (v instanceof CellError) return v;
        if (v instanceof SimpleRangeValue) {
          const d = v.data as any[][];
          const vRows = d.length;
          const vCols = vRows > 0 ? d[0].length : 0;
          const ns: number[] = [];
          for (const r of d) {
            for (const x of r) {
              if (x instanceof CellError) return x;
              const n = toIdx(x);
              if (n === undefined) return new CellError(ErrorType.VALUE, "Argument cannot be less than 1.");
              ns.push(n);
            }
          }
          return { kind: "vec", ns, horizontal: vRows === 1 && vCols > 1 };
        }
        const n = toIdx(v);
        if (n === undefined) return new CellError(ErrorType.VALUE, "Argument cannot be less than 1.");
        return { kind: "scalar", n };
      };

      const rowSel = normSel(row);
      if (process.env.BGP_DEBUG_INDEX) {
        // eslint-disable-next-line no-console
        console.error("INDEX args:", {
          range: rangeValue instanceof SimpleRangeValue ? `${rangeValue.height()}x${rangeValue.width()}` : typeof rangeValue,
          row: row instanceof SimpleRangeValue ? `SRV ${row.height()}x${row.width()}` : String(row),
          col: col instanceof SimpleRangeValue ? `SRV ${col.height()}x${col.width()}` : String(col),
          rowSel: rowSel instanceof CellError ? "ERR" : rowSel.kind,
        });
      }
      if (rowSel instanceof CellError) return rowSel;
      const colSel = normSel(col);
      if (colSel instanceof CellError) return colSel;

      if (twoArgs && data && height === 1 && width > 1 && rowSel.kind === "scalar") {
        // Excel vector semantics: INDEX(1×N range, n) selects the nth COLUMN.
        // (The built-in always reads n as a row and returns #NUM!.)
        if (rowSel.n < 1) return new CellError(ErrorType.VALUE, "Argument cannot be less than 1.");
        if (rowSel.n > width) return new CellError(ErrorType.NUM, "Value too large.");
        return data[0][rowSel.n - 1] ?? EmptyValue;
      }

      if (rowSel.kind === "scalar" && colSel.kind === "scalar") {
        const r = rowSel.n;
        const c = colSel.n;
        if ((r === 0 || c === 0) && r >= 0 && c >= 0) {
          if (!data) return new CellError(ErrorType.VALUE, "Cell range expected.");
          if (r === 0 && c === 0) {
            return SimpleRangeValue.onlyValues(data.map((rw) => rw.slice()));
          }
          if (r === 0) {
            if (c > width) return new CellError(ErrorType.NUM, "Value too large.");
            return SimpleRangeValue.onlyValues(data.map((rw) => [rw[c - 1] ?? EmptyValue]));
          }
          if (r > height) return new CellError(ErrorType.NUM, "Value too large.");
          const selected = data[r - 1] ?? [];
          return SimpleRangeValue.onlyValues([selected.map((v: any) => v ?? EmptyValue)]);
        }
        if (c < 1 || r < 1) {
          return new CellError(ErrorType.VALUE, "Argument cannot be less than 1.");
        }
        if (c > width || r > height) {
          return new CellError(ErrorType.NUM, "Value too large.");
        }
        return data?.[r - 1]?.[c - 1] ??
          data?.[0]?.[0] ??
          new CellError(ErrorType.VALUE, "Cell range expected.");
      }

      // Array selectors: cross product of picked rows and columns. With one
      // vector and one scalar, the selector's orientation is preserved
      // (INDEX(range, {1;2}, 1) → 2×1, INDEX(range, {1,2}, 1) → 1×2).
      if (!data) return new CellError(ErrorType.VALUE, "Cell range expected.");
      const pickRows = rowSel.kind === "vec" ? rowSel.ns : [rowSel.n];
      const pickCols = colSel.kind === "vec" ? colSel.ns : [colSel.n];
      for (const r of pickRows) {
        if (r < 1) return new CellError(ErrorType.VALUE, "Argument cannot be less than 1.");
        if (r > height) return new CellError(ErrorType.NUM, "Value too large.");
      }
      for (const c of pickCols) {
        if (c < 1) return new CellError(ErrorType.VALUE, "Argument cannot be less than 1.");
        if (c > width) return new CellError(ErrorType.NUM, "Value too large.");
      }
      const grid: any[][] = pickRows.map((r) => pickCols.map((c) => data[r - 1]?.[c - 1] ?? EmptyValue));
      if (rowSel.kind === "vec" && colSel.kind === "scalar" && rowSel.horizontal) {
        return SimpleRangeValue.onlyValues([grid.map((rw) => rw[0])]);
      }
      if (rowSel.kind === "scalar" && colSel.kind === "vec" && !colSel.horizontal) {
        return SimpleRangeValue.onlyValues(grid.map((rw) => [rw[0]]));
      }
      return SimpleRangeValue.onlyValues(grid);
    });
  }

  /**
   * INDEX with array selectors returns rows×cols (cross product); with one
   * vector selector and one scalar, the vector's orientation is preserved.
   * Scalar-scalar INDEX stays 1×1 — the zero-row/column whole-axis vector is
   * a runtime-only extension, same as the built-in.
   */
  indexArraySize(ast: any, state: any): unknown {
    const count = (s: any) => s.width * s.height;
    const isVec = (s: any) => count(s) > 1;
    const horizontal = (s: any) => s.height === 1 && s.width > 1;
    const rowSize = ast.args[1] ? (this.arraySizeForAst(ast.args[1], state) as any) : null;
    const colSize = ast.args[2] ? (this.arraySizeForAst(ast.args[2], state) as any) : null;
    const rowVec = rowSize !== null && isVec(rowSize);
    const colVec = colSize !== null && isVec(colSize);
    if (!rowVec && !colVec) return ArraySize.scalar();
    if (rowVec && colVec) return new ArraySize(count(colSize), count(rowSize));
    if (rowVec) {
      return horizontal(rowSize)
        ? new ArraySize(count(rowSize), 1)
        : new ArraySize(1, count(rowSize));
    }
    return horizontal(colSize)
      ? new ArraySize(count(colSize), 1)
      : new ArraySize(1, count(colSize));
  }

  /**
   * MOD(n, d) — Excel semantics: the result takes the divisor's sign, i.e.
   * n - d * FLOOR(n/d). HyperFormula's built-in MOD uses JS remainder
   * (truncated division), so MOD(-7, 3) yields -1 where Excel yields 2 — which
   * breaks quarter-end snapping formulas like EOMONTH(d, MOD(3-MONTH(d),3)).
   */
  mod(ast: any, state: any): unknown {
    return this.runFunction(ast.args, state, this.metadata("MOD"), (n: any, d: any): any => {
      n = rawNumber(n);
      d = rawNumber(d);
      if (d === 0) return new CellError(ErrorType.DIV_BY_ZERO);
      return (n as number) - (d as number) * Math.floor((n as number) / (d as number));
    });
  }

  /**
   * TRIM(text) — the built-in body (strip leading/trailing spaces, collapse
   * inner runs to one) plus Excel's elementwise vectorization over a range.
   */
  trim(ast: any, state: any): unknown {
    return this.runFunction(ast.args, state, this.metadata("TRIM"), (arg: any): any => {
      const trimOne = (v: any): any => {
        const s = coerceToStringValue(v);
        if (s instanceof CellError) return s;
        return s.replace(/^ +/g, "").replace(/ +$/g, "").replace(/ +/g, " ");
      };
      if (arg instanceof SimpleRangeValue) {
        return SimpleRangeValue.onlyValues(arg.data.map((row: any[]) => row.map(trimOne)));
      }
      return trimOne(arg);
    });
  }

  /** TRIM's array result has exactly the shape of its argument. */
  trimArraySize(ast: any, state: any): unknown {
    const s = this.arraySizeForAst(ast.args[0], state) as any;
    // Drop isRef: a passthrough keeps it set, and isRef forces isScalar() ->
    // the vertex would be built as a scalar formula and the range arg would
    // never reach the body ("Cell range not allowed").
    return new ArraySize(s.width, s.height);
  }

  /**
   * CLEAN(text) — the built-in body (strip control chars U+0000–U+001F) plus
   * Excel's elementwise vectorization over a range.
   */
  clean(ast: any, state: any): unknown {
    return this.runFunction(ast.args, state, this.metadata("CLEAN"), (arg: any): any => {
      const cleanOne = (v: any): any => {
        const s = coerceToStringValue(v);
        if (s instanceof CellError) return s;
        // eslint-disable-next-line no-control-regex
        return s.replace(/[ -]/g, "");
      };
      if (arg instanceof SimpleRangeValue) {
        return SimpleRangeValue.onlyValues(arg.data.map((row: any[]) => row.map(cleanOne)));
      }
      return cleanOne(arg);
    });
  }

  /** CLEAN's array result has exactly the shape of its argument. */
  cleanArraySize(ast: any, state: any): unknown {
    const s = this.arraySizeForAst(ast.args[0], state) as any;
    return new ArraySize(s.width, s.height); // see trimArraySize re isRef
  }

  /**
   * CHOOSE(selector, cand1, cand2, ...) — scalar selector replicates the
   * built-in exactly. An array selector ({1,2,3,4}) tiles the picked
   * candidates in the selector's grid arrangement: a 1×k selector stacks the
   * candidates horizontally, k×1 stacks them vertically (this is how Excel
   * assembles multi-column report tables in one spill formula). All picked
   * candidates must share one block shape; a mismatch is #VALUE!.
   */
  choose(ast: any, state: any): unknown {
    return this.runFunction(ast.args, state, this.metadata("CHOOSE"), (selector: any, ...candidates: any[]): any => {
      if (!(selector instanceof SimpleRangeValue)) {
        const idx = Math.trunc(rawNumber(selector) as number);
        if (isNaN(idx) || idx < 1 || idx > candidates.length) {
          return new CellError(ErrorType.NUM, "Selector cannot exceed the number of arguments.");
        }
        return candidates[idx - 1];
      }
      const sData = selector.data as any[][];
      const sRows = sData.length;
      const sCols = sRows > 0 ? sData[0].length : 0;
      const blocks: any[][][][] = [];
      let blockRows = -1;
      let blockCols = -1;
      for (let r = 0; r < sRows; r++) {
        const rowBlocks: any[][][] = [];
        for (let c = 0; c < sCols; c++) {
          const raw = sData[r][c];
          if (raw instanceof CellError) return raw;
          const idx = Math.trunc(rawNumber(raw) as number);
          if (isNaN(idx) || idx < 1 || idx > candidates.length) {
            return new CellError(ErrorType.NUM, "Selector cannot exceed the number of arguments.");
          }
          const chosen = candidates[idx - 1];
          if (chosen instanceof CellError) return chosen;
          const grid: any[][] = chosen instanceof SimpleRangeValue ? (chosen.data as any[][]) : [[chosen]];
          const gRows = grid.length;
          const gCols = gRows > 0 ? grid[0].length : 0;
          if (blockRows === -1) {
            blockRows = gRows;
            blockCols = gCols;
          } else if (gRows !== blockRows || gCols !== blockCols) {
            return new CellError(ErrorType.VALUE, "Array arguments to CHOOSE are of different size.");
          }
          rowBlocks.push(grid);
        }
        blocks.push(rowBlocks);
      }
      if (blockRows === -1) return new CellError(ErrorType.VALUE, "Selector cannot be empty.");
      const out: any[][] = [];
      for (let r = 0; r < sRows; r++) {
        for (let br = 0; br < blockRows; br++) {
          const outRow: any[] = [];
          for (let c = 0; c < sCols; c++) {
            outRow.push(...blocks[r][c][br]);
          }
          out.push(outRow);
        }
      }
      return SimpleRangeValue.onlyValues(out);
    });
  }

  /**
   * CHOOSE's array result: scalar selector → the picked candidate's size when
   * the selector is a numeric literal, else scalar (prediction must not widen
   * an ordinary scalar CHOOSE). Array selector → selector grid × candidate
   * block (candidates are assumed uniform; Excel errors when they are not).
   */
  chooseArraySize(ast: any, state: any): unknown {
    const selectorSize = this.arraySizeForAst(ast.args[0], state) as any;
    const candidateSizes = ast.args
      .slice(1)
      .map((a: any) => this.arraySizeForAst(a, state) as any);
    const blockW = Math.max(...candidateSizes.map((s: any) => s.width), 1);
    const blockH = Math.max(...candidateSizes.map((s: any) => s.height), 1);
    if (selectorSize.width > 1 || selectorSize.height > 1) {
      return new ArraySize(selectorSize.width * blockW, selectorSize.height * blockH);
    }
    const sel = ast.args[0];
    if (sel?.type === "NUMBER") {
      const idx = Math.trunc(sel.value as number);
      if (idx >= 1 && idx <= candidateSizes.length) {
        const s = candidateSizes[idx - 1];
        return new ArraySize(s.width, s.height); // strip isRef (see trimArraySize)
      }
    }
    return ArraySize.scalar();
  }

  /**
   * Shared argument coercion for MONTH / YEAR / DAY: HyperFormula's own
   * scalar-to-number coercion first (identical to the built-ins, including
   * numeric strings, booleans, EmptyValue -> 0 and error passthrough); when
   * that fails on a string, Excel's date-text forms are parsed as a fallback.
   * The built-ins' NUMBER(minValue: 0) bound is reproduced for numbers.
   */
  private coerceDateArgument(arg: any): number | CellError {
    const coerced = this.arithmeticHelper.coerceScalarToNumberOrError(arg);
    if (!(coerced instanceof CellError)) {
      const n = rawNumber(coerced);
      if (typeof n === "number") {
        return n >= 0 ? n : new CellError(ErrorType.NUM, "Value too small.");
      }
    }
    if (typeof arg === "string") {
      const serial = parseDateTextToSerial(arg);
      if (serial !== undefined) return serial;
    }
    return coerced instanceof CellError
      ? coerced
      : new CellError(ErrorType.VALUE, "Value cannot be coerced to number.");
  }

  /**
   * FILTER(array, include, [if_empty]) — Excel semantics. HyperFormula's
   * built-in FILTER requires a same-shape boolean mask, rejects 2-D data, and
   * compacts cells row-wise; Excel keeps whole ROWS when include is a column
   * vector of the array's height (and whole columns for a row vector). For
   * 1-column data with a 1-column mask the two semantics coincide. Empty
   * result → if_empty, else #N/A (HF has no #CALC! error type).
   */
  filterExcel(ast: any, state: any): unknown {
    return this.runFunction(ast.args, state, this.metadata("FILTER"), (arrayArg: any, includeArg: any, ifEmpty: any): any => {
      const data: any[][] = arrayArg instanceof SimpleRangeValue ? (arrayArg.data as any[][]) : [[arrayArg]];
      const rows = data.length;
      const cols = rows > 0 ? data[0].length : 0;
      const mask: any[][] = includeArg instanceof SimpleRangeValue ? (includeArg.data as any[][]) : [[includeArg]];
      const mRows = mask.length;
      const mCols = mRows > 0 ? mask[0].length : 0;

      const toBool = (v: any): boolean | CellError => {
        if (v instanceof CellError) return v;
        const raw = rawNumber(v);
        if (typeof raw === "boolean") return raw;
        if (typeof raw === "number") return raw !== 0;
        if (raw === EmptyValue || raw === null || raw === undefined) return false;
        if (typeof raw === "string") {
          if (/^true$/i.test(raw)) return true;
          if (/^false$/i.test(raw)) return false;
        }
        return new CellError(ErrorType.VALUE, "Unsupported type in FILTER criterion");
      };

      let out: any[][];
      if (mRows === rows && mCols === 1) {
        // Column-vector mask: keep whole rows.
        out = [];
        for (let i = 0; i < rows; i++) {
          const b = toBool(mask[i][0]);
          if (b instanceof CellError) return b;
          if (b) out.push(data[i].slice());
        }
      } else if (mCols === cols && mRows === 1 && cols > 1) {
        // Row-vector mask: keep whole columns.
        const keep: number[] = [];
        for (let j = 0; j < cols; j++) {
          const b = toBool(mask[0][j]);
          if (b instanceof CellError) return b;
          if (b) keep.push(j);
        }
        out = data.map((row) => keep.map((j) => row[j]));
      } else if (mRows === rows && mCols === cols) {
        // Same-shape 1-column edge (mCols === cols === 1): identical to the
        // row filter above; 2-D same-shape masks are not valid Excel FILTER.
        if (cols === 1) {
          out = [];
          for (let i = 0; i < rows; i++) {
            const b = toBool(mask[i][0]);
            if (b instanceof CellError) return b;
            if (b) out.push([data[i][0]]);
          }
        } else {
          return new CellError(ErrorType.VALUE, "Array arguments to FILTER are of different size.");
        }
      } else {
        return new CellError(ErrorType.VALUE, "Array arguments to FILTER are of different size.");
      }

      if (out.length === 0) {
        if (ifEmpty !== undefined && ifEmpty !== EmptyValue) return ifEmpty;
        return new CellError(ErrorType.NA, "No matches found in FILTER");
      }
      return SimpleRangeValue.onlyValues(out);
    });
  }

  /**
   * FILTER's worst-case size: the input array's own size (every row could
   * match). Same predictor as the built-in.
   */
  filterExcelArraySize(ast: any, state: any): unknown {
    if (ast.args.length < 2) return ArraySize.error();
    const s = this.arraySizeForAst(ast.args[0], state) as any;
    return new ArraySize(s.width, s.height); // strip isRef (see trimArraySize)
  }

  /** MONTH(serialOrDateText) — built-in behaviour plus date-text coercion. */
  month(ast: any, state: any): unknown {
    return this.runFunction(ast.args, state, this.metadata("MONTH"), (arg: any): any => {
      const serial = this.coerceDateArgument(arg);
      if (serial instanceof CellError) return serial;
      return this.dateTimeHelper.numberToSimpleDate(serial).month;
    });
  }

  /** YEAR(serialOrDateText) — built-in behaviour plus date-text coercion. */
  year(ast: any, state: any): unknown {
    return this.runFunction(ast.args, state, this.metadata("YEAR"), (arg: any): any => {
      const serial = this.coerceDateArgument(arg);
      if (serial instanceof CellError) return serial;
      return this.dateTimeHelper.numberToSimpleDate(serial).year;
    });
  }

  /** DAY(serialOrDateText) — built-in behaviour plus date-text coercion. */
  day(ast: any, state: any): unknown {
    return this.runFunction(ast.args, state, this.metadata("DAY"), (arg: any): any => {
      const serial = this.coerceDateArgument(arg);
      if (serial instanceof CellError) return serial;
      return this.dateTimeHelper.numberToSimpleDate(serial).day;
    });
  }
}

(ExcelCompatPlugin as any).implementedFunctions = {
  LOOKUP: {
    method: "lookup",
    parameters: [
      // SCALAR (not ANY) so a range lookup_value vectorizes elementwise in
      // array context (e.g. SUMPRODUCT(ABS(x - LOOKUP(dates, from, to)))),
      // and gets Excel-style implicit intersection outside array context.
      { argumentType: FunctionArgumentType.SCALAR },
      { argumentType: FunctionArgumentType.ANY },
      { argumentType: FunctionArgumentType.ANY, optionalArg: true },
    ],
  },
  IFS: {
    method: "ifs",
    parameters: [
      { argumentType: FunctionArgumentType.SCALAR },
      { argumentType: FunctionArgumentType.SCALAR },
    ],
    repeatLastArgs: 2,
  },
  DATEDIF: {
    method: "datedif",
    parameters: [
      { argumentType: FunctionArgumentType.NUMBER },
      { argumentType: FunctionArgumentType.NUMBER },
      { argumentType: FunctionArgumentType.STRING },
    ],
  },
  INDEX: {
    // RANGE for the array, ANY for the selectors so array selectors
    // (SEQUENCE(10), {1,2,3,4}) reach the body uncoerced. indexArraySize sizes
    // the vertex for array selectors; scalar INDEX stays 1×1, same as the
    // built-in.
    method: "index",
    sizeOfResultArrayMethod: "indexArraySize",
    parameters: [
      { argumentType: FunctionArgumentType.RANGE },
      { argumentType: FunctionArgumentType.ANY },
      { argumentType: FunctionArgumentType.ANY, defaultValue: 1 },
    ],
  },
  MONTH: {
    method: "month",
    parameters: [{ argumentType: FunctionArgumentType.SCALAR }],
  },
  YEAR: {
    method: "year",
    parameters: [{ argumentType: FunctionArgumentType.SCALAR }],
  },
  DAY: {
    method: "day",
    parameters: [{ argumentType: FunctionArgumentType.SCALAR }],
  },
  MOD: {
    // Identical to the built-in MOD metadata; only the arithmetic changes.
    method: "mod",
    parameters: [
      { argumentType: FunctionArgumentType.NUMBER },
      { argumentType: FunctionArgumentType.NUMBER },
    ],
  },
  TRIM: {
    // ANY (not the built-in's STRING) so a range reaches the body and is
    // mapped elementwise; sizeOfResultArrayMethod keeps graph sizing exact
    // (the generic fallback ignores ANY-typed args and would predict 1×1).
    method: "trim",
    sizeOfResultArrayMethod: "trimArraySize",
    parameters: [{ argumentType: FunctionArgumentType.ANY }],
  },
  CLEAN: {
    method: "clean",
    sizeOfResultArrayMethod: "cleanArraySize",
    parameters: [{ argumentType: FunctionArgumentType.ANY }],
  },
  CHOOSE: {
    // ANY for selector and candidates so ranges/array constants reach the
    // body uncoerced (the built-in's INTEGER/SCALAR params would reduce them
    // to top-left scalars before the override could tile them).
    method: "choose",
    sizeOfResultArrayMethod: "chooseArraySize",
    parameters: [
      { argumentType: FunctionArgumentType.ANY },
      { argumentType: FunctionArgumentType.ANY },
    ],
    repeatLastArgs: 1,
  },
  FILTER: {
    // RANGE args so CHOOSE/array results pass through; array arithmetic for
    // arguments so the predicate ($H$200:$H$253>0) vectorizes.
    method: "filterExcel",
    sizeOfResultArrayMethod: "filterExcelArraySize",
    enableArrayArithmeticForArguments: true,
    parameters: [
      { argumentType: FunctionArgumentType.RANGE },
      { argumentType: FunctionArgumentType.RANGE },
      { argumentType: FunctionArgumentType.SCALAR, optionalArg: true },
    ],
  },
};

let registered = false;

/**
 * Register the compatibility functions on the HyperFormula class. Static and
 * global, so this runs once per process no matter how many engines are built;
 * must be called before any HyperFormula.buildFromSheets.
 *
 * The translations argument is load-bearing: FunctionRegistry.getFunction
 * refuses to serve a function the language pack has no translation for
 * (isFunctionTranslated), and enGB has no entry for LOOKUP — without this,
 * every custom function parses to #NAME? despite being registered.
 */
export function registerExcelCompatFunctions(): void {
  if (registered) return;
  HyperFormula.registerFunctionPlugin(ExcelCompatPlugin, {
    enGB: {
      LOOKUP: "LOOKUP",
      IFS: "IFS",
      DATEDIF: "DATEDIF",
      INDEX: "INDEX",
      MONTH: "MONTH",
      YEAR: "YEAR",
      DAY: "DAY",
      MOD: "MOD",
      TRIM: "TRIM",
      CLEAN: "CLEAN",
      CHOOSE: "CHOOSE",
      FILTER: "FILTER",
    },
  });
  registered = true;
}
