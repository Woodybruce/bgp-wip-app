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
 *           (INDEX(range, 0, col) / INDEX(range, row, 0)). This override keeps
 *           the built-in scalar path byte-identical and adds the vector path.
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
  index(ast: any, state: any): unknown {
    return this.runFunction(ast.args, state, this.metadata("INDEX"), (rangeValue: any, row: any, col: any): any => {
      if ((row === 0 || col === 0) && row >= 0 && col >= 0) {
        const data = rangeValue?.data as any[][] | undefined;
        if (!data) return new CellError(ErrorType.VALUE, "Cell range expected.");
        if (row === 0 && col === 0) {
          return SimpleRangeValue.onlyValues(data.map((r) => r.slice()));
        }
        if (row === 0) {
          if (col > rangeValue.width()) return new CellError(ErrorType.NUM, "Value too large.");
          return SimpleRangeValue.onlyValues(data.map((r) => [r[col - 1] ?? EmptyValue]));
        }
        if (row > rangeValue.height()) return new CellError(ErrorType.NUM, "Value too large.");
        const selected = data[row - 1] ?? [];
        return SimpleRangeValue.onlyValues([selected.map((v: any) => v ?? EmptyValue)]);
      }
      if (col < 1 || row < 1) {
        return new CellError(ErrorType.VALUE, "Argument cannot be less than 1.");
      }
      if (col > rangeValue.width() || row > rangeValue.height()) {
        return new CellError(ErrorType.NUM, "Value too large.");
      }
      return rangeValue?.data?.[row - 1]?.[col - 1] ??
        rangeValue?.data?.[0]?.[0] ??
        new CellError(ErrorType.VALUE, "Cell range expected.");
    });
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
    // Identical to the built-in INDEX metadata on purpose: the graph-size
    // predictor keys off this, and the vector extension is runtime-only.
    method: "index",
    parameters: [
      { argumentType: FunctionArgumentType.RANGE },
      { argumentType: FunctionArgumentType.NUMBER },
      { argumentType: FunctionArgumentType.NUMBER, defaultValue: 1 },
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
    },
  });
  registered = true;
}
