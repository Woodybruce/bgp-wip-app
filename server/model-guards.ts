/**
 * model-guards.ts — load-time folding of statically-decidable position guards.
 *
 * Real-estate models commonly keep a running total across a row and park the
 * row total in the column immediately left of the first period:
 *
 *   F11 = SUM(G11:GE11)
 *   G11 = MAX(IF(COLUMN()=7,0,F11), <this period>)   <- first period
 *   H11 = MAX(IF(COLUMN()=7,0,G11), <this period>)
 *
 * `COLUMN()` with no argument is the host cell's own column, so the guard is
 * a constant: in G11 it is always TRUE (never reads F11), in every later
 * column always FALSE (reads the left neighbour, forming a plain left-to-right
 * chain). Excel's cached values follow exactly that acyclic reading.
 *
 * HyperFormula builds its dependency graph from the raw parse, so it keeps the
 * dead G11->F11 edge; together with F11=SUM(G11:GE11) that closes a static
 * strongly-connected component and the whole row (plus everything downstream)
 * reports #CYCLE!.
 *
 * The fix is compiler-style dead-branch elimination at load time: when an
 * IF's condition is a comparison of two operands that are each a numeric
 * literal, `COLUMN()`, or `ROW()`, the result is known while loading, so the
 * IF is replaced by the branch that will actually run. Anything that does not
 * match that narrow shape is left byte-for-byte unchanged.
 */

const COND_RE =
  /^\s*(COLUMN\s*\(\s*\)|ROW\s*\(\s*\)|-?\d+(?:\.\d+)?)\s*(=|<>|<=|>=|<|>)\s*(COLUMN\s*\(\s*\)|ROW\s*\(\s*\)|-?\d+(?:\.\d+)?)\s*$/i;

const BOUNDARY_BEFORE = /[A-Za-z0-9_.$]/;
const MAX_FOLDS = 50; // safety bound; each fold strictly shortens the formula

function evalOperand(token: string, hostRow0: number, hostCol0: number): number {
  if (/^COLUMN/i.test(token)) return hostCol0 + 1;
  if (/^ROW/i.test(token)) return hostRow0 + 1;
  return parseFloat(token);
}

function compare(op: string, a: number, b: number): boolean {
  switch (op) {
    case "=": return a === b;
    case "<>": return a !== b;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
    default: return false;
  }
}

/**
 * Replace `IF(<static comparison>, a, b)` calls whose condition is decidable
 * from the host cell's position with the taken branch. `hostRow0`/`hostCol0`
 * are the cell's 0-based coordinates (as iterated by worksheetToHFArray).
 */
export function foldPositionGuards(formula: string, hostRow0: number, hostCol0: number): string {
  if (!/IF\s*\(/i.test(formula)) return formula;
  if (!/(COLUMN|ROW)\s*\(\s*\)/i.test(formula)) return formula;

  let f = formula;
  for (let fold = 0; fold < MAX_FOLDS; fold++) {
    let changed = false;
    let inString = false;
    let i = 0;
    while (i < f.length) {
      const ch = f[i];
      if (inString) {
        if (ch === '"') {
          if (f[i + 1] === '"') { i += 2; continue; }
          inString = false;
        }
        i++;
        continue;
      }
      if (ch === '"') { inString = true; i++; continue; }

      const prev = i > 0 ? f[i - 1] : "";
      if (
        (ch === "I" || ch === "i") &&
        (f[i + 1] === "F" || f[i + 1] === "f") &&
        f[i + 2] === "(" &&
        (prev === "" || !BOUNDARY_BEFORE.test(prev))
      ) {
        // Split the IF(...) call into top-level arguments.
        let depth = 0;
        let argString = false;
        const args: string[] = [];
        let argStart = i + 3;
        let end = -1;
        for (let j = i + 2; j < f.length; j++) {
          const cj = f[j];
          if (argString) {
            if (cj === '"') {
              if (f[j + 1] === '"') { j++; continue; }
              argString = false;
            }
            continue;
          }
          if (cj === '"') { argString = true; continue; }
          if (cj === "(") depth++;
          else if (cj === ")") {
            depth--;
            if (depth === 0) {
              args.push(f.slice(argStart, j));
              end = j;
              break;
            }
          } else if (cj === "," && depth === 1) {
            args.push(f.slice(argStart, j));
            argStart = j + 1;
          }
        }
        if (end !== -1 && (args.length === 2 || args.length === 3)) {
          const cond = COND_RE.exec(args[0]);
          if (cond) {
            const a = evalOperand(cond[1], hostRow0, hostCol0);
            const b = evalOperand(cond[3], hostRow0, hostCol0);
            const taken = compare(cond[2], a, b) ? args[1] : (args[2] ?? "FALSE");
            f = f.slice(0, i) + taken + f.slice(end + 1);
            changed = true;
            break; // restart the scan from the top
          }
        }
        i += 3; // not foldable here — keep scanning for nested IFs inside
        continue;
      }
      i++;
    }
    if (!changed) break;
  }
  return f;
}

/**
 * Excel accepts TRUE / FALSE as bare boolean literals; HyperFormula only knows
 * the 0-argument functions TRUE() / FALSE() and parses a bare token as a
 * (missing) named expression, so `=IF(D23=TRUE,"OK","ERROR")` comes out #NAME?.
 * Rewrite bare tokens to their function form. A token qualifies only with
 * identifier boundaries on both sides (so ISTRUE, TRUE1, A.TRUE and
 * Sheet!TRUE are untouched), not immediately followed by "(" (already a call),
 * and never inside a string literal.
 */
export function rewriteBooleanLiterals(formula: string): string {
  if (!/true|false/i.test(formula)) return formula;

  const BOUNDARY = /[A-Za-z0-9_.$!]/;
  let out = "";
  let i = 0;
  let inString = false;
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
    const m = /^(TRUE|FALSE)\b/i.exec(formula.slice(i));
    if (m) {
      const prev = i > 0 ? formula[i - 1] : "";
      const next = formula[i + m[1].length];
      const boundaryBefore = prev === "" || !BOUNDARY.test(prev);
      const boundaryAfter = next === undefined || (!BOUNDARY.test(next) && next !== "(");
      if (boundaryBefore && boundaryAfter) {
        out += m[1].toUpperCase() + "()";
        i += m[1].length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}
