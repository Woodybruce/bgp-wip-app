/**
 * model-ranges.ts — load-time bounding of full-row / full-column references.
 *
 * HyperFormula's dependency graph is static and range-granular: a full-row
 * reference like `CF!$8:$8` makes the cell depend on all 16,384 columns of
 * that row. When another cell in the referenced row points back (even at an
 * unrelated column), the two end up in one static strongly-connected
 * component and HyperFormula reports #CYCLE! — while Excel, which evaluates
 * the actual cell-level DAG, computes fine (this workbook has no iterative
 * calculation enabled).
 *
 * Rewriting `$8:$8` to the referenced sheet's used columns (e.g.
 * `$A$8:$GG$8` on a sheet whose !ref is A1:GG227) keeps the computed values
 * identical (cells outside the used range are empty either way) but shrinks
 * the static dependency set to real cells, dissolving the false SCCs.
 *
 * Only whole-row (`$8:$8`, `10:10`) and whole-column (`A:A`, `$A:$A`) pairs
 * are rewritten, optionally sheet-qualified (`Sheet!$8:$8`,
 * `'Sheet Name'!A:A`). Double-quoted string literals are never touched, and
 * matches require non-identifier boundaries on both sides so tokens like
 * `LOG10(` or longer names are never mangled.
 */

/** Used dimensions of one sheet (0-based, inclusive), from SheetJS `!ref`. */
export interface SheetDims {
  firstRow: number;
  firstCol: number;
  lastRow: number;
  lastCol: number;
}

const BOUNDARY_BEFORE = /[A-Za-z0-9_.$!]/;
const BOUNDARY_AFTER = /[A-Za-z0-9_.$(]/;

function colLetter(col0: number): string {
  let result = "";
  let n = col0 + 1;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

const ROW_PAIR_RE = /^\$?([0-9]{1,7}):\$?([0-9]{1,7})/;
const COL_PAIR_RE = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})/;
const QUOTED_SHEET_RE = /^'((?:[^']|'')*)'!/;
const BARE_SHEET_RE = /^([A-Za-z_][A-Za-z0-9_.]*)!/;

/**
 * Rewrite full-row/full-column references in `formula` to the used bounds of
 * the referenced sheet (or of `hostSheet` when unqualified). Unknown sheet
 * names and anything ambiguous are left untouched.
 */
export function boundFullRowColRefs(
  formula: string,
  hostSheet: string,
  dimsBySheet: ReadonlyMap<string, SheetDims>,
): string {
  if (!formula.includes(":")) return formula;
  let out = "";
  let inString = false;
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (inString) {
      out += ch;
      if (ch === '"') {
        if (formula[i + 1] === '"') {
          out += '"';
          i += 2;
          continue;
        }
        inString = false;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }

    // Candidate start: boundary before the token (sheet prefix counts as part
    // of the token, so the boundary precedes it).
    const prev = out.length > 0 ? out[out.length - 1] : "";
    if (prev !== "" && BOUNDARY_BEFORE.test(prev)) {
      out += ch;
      i++;
      continue;
    }

    // Optional sheet qualifier.
    let rest = formula.slice(i);
    let sheetName: string | null = null;
    let prefixLen = 0;
    const quoted = QUOTED_SHEET_RE.exec(rest);
    const bare = quoted ? null : BARE_SHEET_RE.exec(rest);
    if (quoted) {
      sheetName = quoted[1].replace(/''/g, "'");
      prefixLen = quoted[0].length;
    } else if (bare) {
      sheetName = bare[1];
      prefixLen = bare[0].length;
    }
    if (sheetName !== null && !dimsBySheet.has(sheetName)) {
      sheetName = null;
      prefixLen = 0;
    }

    const afterPrefix = rest.slice(prefixLen);
    const rowPair = ROW_PAIR_RE.exec(afterPrefix);
    const colPair = rowPair ? null : COL_PAIR_RE.exec(afterPrefix);
    const match = rowPair ?? colPair;
    if (!match) {
      out += ch;
      i++;
      continue;
    }
    const after = afterPrefix[match[0].length] ?? "";
    if (after !== "" && BOUNDARY_AFTER.test(after)) {
      out += ch;
      i++;
      continue;
    }

    const dims = dimsBySheet.get(sheetName ?? hostSheet);
    if (!dims) {
      out += ch;
      i++;
      continue;
    }
    const prefix = rest.slice(0, prefixLen);
    if (rowPair) {
      const [, r1, r2] = rowPair;
      out += `${prefix}$${colLetter(dims.firstCol)}$${r1}:$${colLetter(dims.lastCol)}$${r2}`;
    } else if (colPair) {
      const [, c1, c2] = colPair;
      out += `${prefix}$${c1.replace(/\$/g, "").toUpperCase()}$${dims.firstRow + 1}:$${c2.replace(/\$/g, "").toUpperCase()}$${dims.lastRow + 1}`;
    }
    i += prefixLen + match[0].length;
  }
  return out;
}
