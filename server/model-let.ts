/**
 * model-let.ts — load-time desugaring of Excel's LET() for HyperFormula.
 *
 * LET cannot be a HyperFormula function plugin: it needs lazy lexical binding
 * of names, which plugins don't get. Instead we rewrite LET formulas to plain
 * formulas before they reach the engine:
 *
 *   LET(x, A, body)            ->  body with x replaced by (A)
 *   LET(x, A, y, B(x), body)   ->  body, last name substituted first so that
 *                                  value expressions referencing earlier names
 *                                  are expanded when the earlier name is
 *                                  substituted
 *   LET(x,1,LET(x,2,x)+x)      ->  ((2)+(1))   (inner LET desugars first, so
 *                                  the inner x shadows the outer one in the
 *                                  inner body only)
 *
 * Parsing is paren-depth-aware and skips double-quoted string literals; a
 * formula that fails to parse is returned unchanged (it will surface as
 * #NAME? and be counted by the error census).
 */

const IDENT_CHARS = /[A-Za-z0-9_.$]/;
/** Excel LET names: identifier-ish, may carry the _xlpm. prefix SheetJS keeps. */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;
/** Names Excel would reject because they read as cell references — refuse to rewrite. */
const CELL_REF_LIKE_RE = /^[A-Za-z]{1,3}[0-9]+$/;

const MAX_REWRITES = 100;

/** Find the next `LET(` token at top level, skipping string literals. */
function findLetCall(f: string, from: number): { start: number; open: number } | null {
  let inString = false;
  for (let i = from; i < f.length; i++) {
    const ch = f[i];
    if (inString) {
      if (ch === '"') {
        if (f[i + 1] === '"') i++; // escaped quote
        else inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (
      (ch === "L" || ch === "l") &&
      f.slice(i, i + 4).toUpperCase() === "LET(" &&
      (i === 0 || !IDENT_CHARS.test(f[i - 1]))
    ) {
      return { start: i, open: i + 3 };
    }
  }
  return null;
}

/** Index of the paren matching f[open], or -1. Skips string literals. */
function matchingParen(f: string, open: number): number {
  let depth = 0;
  let inString = false;
  for (let i = open; i < f.length; i++) {
    const ch = f[i];
    if (inString) {
      if (ch === '"') {
        if (f[i + 1] === '"') i++;
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

/** Split a function argument list on top-level commas. */
function splitArgs(s: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === '"') {
        if (s[i + 1] === '"') i++;
        else inString = false;
      }
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      args.push(s.slice(start, i));
      start = i + 1;
    }
  }
  args.push(s.slice(start));
  return args.map((a) => a.trim());
}

/**
 * Replace whole-word occurrences of `name` in `body` with `(value)`.
 * Skips string literals, occurrences glued to longer identifiers (on either
 * side), occurrences followed by `(` (a function call, never a LET variable),
 * and occurrences followed by `!` (a sheet name in a reference).
 */
function substituteName(body: string, name: string, value: string): string {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (inString) {
      out += ch;
      if (ch === '"') {
        if (body[i + 1] === '"') {
          out += body[i + 1];
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
    if (body.startsWith(name, i)) {
      const before = i > 0 ? body[i - 1] : "";
      const after = body[i + name.length] ?? "";
      const boundaryOk =
        (i === 0 || !IDENT_CHARS.test(before)) &&
        after !== "(" &&
        after !== "!" &&
        (after === "" || !IDENT_CHARS.test(after));
      if (boundaryOk) {
        out += `(${value})`;
        i += name.length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/** Rewrite one LET(...) segment; returns null when the segment is not a valid LET. */
function rewriteLetSegment(inner: string): string | null {
  const args = splitArgs(inner);
  // LET(name, value, ..., body): at least one pair plus a body, odd count.
  if (args.length < 3 || args.length % 2 === 0) return null;
  const names: string[] = [];
  const values: string[] = [];
  for (let i = 0; i + 1 < args.length; i += 2) {
    const name = args[i];
    if (!NAME_RE.test(name) || CELL_REF_LIKE_RE.test(name)) return null;
    names.push(name);
    values.push(desugarLet(args[i + 1]));
  }
  let body = desugarLet(args[args.length - 1]);
  // Substitute from the last name backwards: a later name's value may use
  // earlier names, which are still substituted afterwards.
  for (let i = names.length - 1; i >= 0; i--) {
    body = substituteName(body, names[i], values[i]);
  }
  return `(${body})`;
}

/**
 * Replace every LET(...) call in `formula` with its inlined equivalent.
 * Innermost LETs desugar first (each rewrite only removes LET tokens), so
 * nested and shadowed names keep Excel semantics. Anything unparseable is
 * left untouched.
 */
export function desugarLet(formula: string): string {
  let f = formula;
  for (let n = 0; n < MAX_REWRITES; n++) {
    const hit = findLetCall(f, 0);
    if (!hit) return f;
    const close = matchingParen(f, hit.open);
    if (close < 0) return formula;
    const rewritten = rewriteLetSegment(f.slice(hit.open + 1, close));
    if (rewritten === null) return formula;
    f = f.slice(0, hit.start) + rewritten + f.slice(close + 1);
  }
  return f;
}
