/**
 * model-spill.ts — Excel 365 dynamic-array support for the model engine.
 *
 * Excel stores a spilled formula once, on the anchor cell, as
 * `<f t="array" ref="D52:D53">_xlfn._xlws.FILTER(...)</f>`; the covered cells
 * hold only cached values. SheetJS surfaces the anchor's spill extent as
 * `cell.F` (on anchor and covered cells alike) and strips `_xlfn.` but leaves
 * the `_xlws.` namespace prefix, and it renders the `D52#` spill operator as
 * `ANCHORARRAY(D52)`.
 *
 * HyperFormula evaluates FILTER/SORT/UNIQUE/SEQUENCE natively and spills them,
 * but only into empty cells. So at load time we:
 *   1. blank spill-covered cells (their cached values would block the spill),
 *   2. strip the `_xlws.` prefix so HF parses FILTER/SORT as built-ins,
 *   3. rewrite ANCHORARRAY(anchor) to the anchor's stored spill range,
 *   4. defer multi-cell anchors: HyperFormula sizes array vertices statically
 *      during buildFromSheets (FILTER predicts its full input height, which
 *      never fits an occupied grid), but sizes them from the actual result
 *      when the formula is set post-build via setCellContents.
 */

import XLSX from "xlsx-js-style";

export interface SpillInfo {
  /** Numeric cell keys (row * 16384 + col) covered by another cell's spill. */
  covered: Set<number>;
  /** Anchor A1 (no $) -> spill range ("F140:F141"). Same-sheet lookups only. */
  anchors: Map<string, string>;
  /**
   * Anchors whose spill range spans more than one cell, in row-major order.
   * These must be loaded AFTER the initial build with their formula wrapped
   * in ARRAY_CONSTRAIN(..., height, width): HyperFormula sizes array vertices
   * by static prediction, and FILTER's prediction is its full input height,
   * which never fits inside an occupied grid (#SPILL!). The stored ref tells
   * us the real spill extent, so we pin the prediction to it.
   */
  multiAnchors: Array<{ row: number; col: number; height: number; width: number }>;
}

export function cellKey(row: number, col: number): number {
  return row * 16384 + col;
}

/** Scan a worksheet for array-formula anchors and the cells their spills cover. */
export function analyzeSpills(ws: XLSX.WorkSheet): SpillInfo {
  const covered = new Set<number>();
  const anchors = new Map<string, string>();
  const multiAnchors: Array<{ row: number; col: number; height: number; width: number }> = [];
  for (const key of Object.keys(ws)) {
    if (key.startsWith("!")) continue;
    const cell = ws[key] as XLSX.CellObject | undefined;
    if (!cell || typeof cell.f !== "string" || typeof cell.F !== "string") continue;
    try {
      const range = XLSX.utils.decode_range(cell.F);
      const anchorA1 = XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c });
      anchors.set(anchorA1, cell.F);
      if (range.e.r > range.s.r || range.e.c > range.s.c) {
        multiAnchors.push({
          row: range.s.r,
          col: range.s.c,
          height: range.e.r - range.s.r + 1,
          width: range.e.c - range.s.c + 1,
        });
      }
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          if (r === range.s.r && c === range.s.c) continue; // the anchor keeps its formula
          covered.add(cellKey(r, c));
        }
      }
    } catch {
      // malformed range — leave the cells alone, worst case the anchor errors
    }
  }
  return { covered, anchors, multiAnchors };
}

const SPILL_GATE = /_xlws\.|ANCHORARRAY/i;
const ANCHORARRAY_RE = /ANCHORARRAY\(\s*(\$?[A-Za-z]{1,3}\$?\d+)\s*\)/g;

/**
 * Make Excel 365 dynamic-array syntax palatable to HyperFormula.
 * Returns the formula unchanged (fast path) when no spill syntax is present.
 */
export function rewriteDynamicArrays(f: string, anchors: ReadonlyMap<string, string>): string {
  if (!SPILL_GATE.test(f)) return f;
  let out = f.replace(/_xlfn\._xlws\./g, "").replace(/_xlws\./g, "");
  if (/ANCHORARRAY/i.test(out)) {
    out = out.replace(ANCHORARRAY_RE, (_m, ref: string) => {
      const norm = ref.replace(/\$/g, "").toUpperCase();
      return anchors.get(norm) ?? norm;
    });
  }
  return out;
}

const SPILL_FN_RE = /\b(INDEX|FILTER|SORT|UNIQUE)\s*\(/i;

/** Find the index of the closing paren matching the "(" at `open`, skipping strings. */
function matchingParen(s: string, open: number): number {
  let depth = 0;
  let inString = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === '"') {
        if (s[i + 1] === '"') i++; // escaped quote ""
        else inString = false;
      }
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Pin a deferred anchor's predicted array size to its stored spill extent.
 * Wraps the outermost INDEX/FILTER/SORT/UNIQUE call in ARRAY_CONSTRAIN(expr,
 * h, w) so HyperFormula's static size prediction (FILTER predicts its full
 * input height; INDEX has no size predictor at all) shrinks to the range the
 * workbook actually reserves for the spill.
 * Applied after rewriteDynamicArrays, so function names are prefix-free.
 */
export function constrainSpillToRef(f: string, height: number, width: number): string {
  const m = SPILL_FN_RE.exec(f);
  if (!m || m.index === undefined) return f;
  const open = f.indexOf("(", m.index);
  const close = matchingParen(f, open);
  if (close < 0) return f;
  return `${f.slice(0, m.index)}ARRAY_CONSTRAIN(${f.slice(m.index, close + 1)},${height},${width})${f.slice(close + 1)}`;
}
