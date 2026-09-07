#!/usr/bin/env node
// r575 — census every hardcoded deal-status set in client/ + server/ and diff
// it against the canonical sets in shared/deal-status.ts.
//
// The recurring bug shape (r573-r580): some code enumerates crm_deals.status
// by hand. When a code is added to the shared enum (HOT, 2026-08-12) every
// hand-typed set silently stops covering it, and a deal at that stage is
// dropped — from a list, or from the money.
//
// r581: the sweep originally recognised ONE shape — a comma-separated ARRAY of
// quoted codes. r580's bug (three stage-weight tables that silently zeroed a
// HOT deal's value) hid in a shape the sweep could not see: an object KEYED by
// status codes. Three more shapes are now recognised:
//   list   ["SOL","EXC"]              — array / SQL IN (...)
//   keys   { NEG: 0.5, SOL: 0.75 }    — lookup table keyed by status  (r580)
//   union  'NEG' | 'SOL'              — TS string-literal union type   (r580)
//   case   case "NEG": ... case "SOL" — switch dispatch on status
//
// r585: the four shapes above all census CODE sets, and only ever over
// crm_deals.status. r584 found four dead predicates over
// available_units.marketing_status by hand-grep in a minute — the census was
// blind to that column AND to the shape that hides there, a comparison
// against a legacy LABEL:
//   label  marketing_status = 'Available' | (s||"").toLowerCase() === "available"
// A label predicate over a column the boot canonicaliser guarantees holds
// CODES (server/index.ts:1463 deals, :1479 units) is DEAD — it matches
// nothing, silently. So `label` findings carry the column they read and its
// ground truth: `codes` (dead), `mixed` (investment_tracker.status — half
// alive, needs a vocabulary decision first), or `?` (undetermined — read it).
//
// Usage: node qa/r575-status-literal-sweep.mjs [--all] [--kind=keys,case,label]
//   default: only sets that DIVERGE from every canonical set (label: all)
//   --all:   every set found

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHARED = path.join(ROOT, "shared", "deal-status.ts");
const src = fs.readFileSync(SHARED, "utf8");

function arrayOf(name) {
  const m = src.match(new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`cannot find ${name} in shared/deal-status.ts`);
  return [...m[1].matchAll(/"([A-Z]{2,5})"/g)].map((x) => x[1]);
}

const CANON = {
  DEAL_STATUS_CODES: arrayOf("DEAL_STATUS_CODES"),
  LETTING_STATUSES: arrayOf("LETTING_STATUSES"),
  INVESTMENT_STATUSES: arrayOf("INVESTMENT_STATUSES"),
  WIP_STATUSES: arrayOf("WIP_STATUSES"),
  CLOSED_STATUSES: arrayOf("CLOSED_STATUSES"),
  TERMINAL_STATUSES: arrayOf("TERMINAL_STATUSES"),
};
const ALL = new Set(CANON.DEAL_STATUS_CODES);

// Legacy LABEL vocabulary: every LEGACY_MAP key plus every DEAL_STATUS_LABELS
// value that is not itself a canonical code. A quoted literal from this set,
// compared against a status column, is the r584 bug shape.
const legacyKeys = [...src.matchAll(/^\s*"([^"]+)":\s*"([A-Z]{2,5})",/gm)].map((m) => [m[1].toLowerCase(), m[2]]);
const labelValues = [...src.matchAll(/^\s*([A-Z]{2,5}):\s*"([A-Za-z][^"]*)",/gm)].map((m) => [m[2].toLowerCase(), m[1]]);
const LABELS = new Map([...legacyKeys, ...labelValues].filter(([k]) => !ALL.has(k.toUpperCase())));
// Real stored values, not legacy labels — crm_deals still carries these.
for (const k of ["leasing comps", "investment comps"]) LABELS.delete(k);
if (LABELS.size < 8) throw new Error("label vocabulary looks wrong — parse of shared/deal-status.ts drifted");

// Ground truth per column, established r583/r584 against the fixture AND
// guaranteed forward by the boot auto-migrate canonicalisers.
const COLUMN_TRUTH = {
  "crm_deals.status": "codes",
  "available_units.marketing_status": "codes",
  "investment_tracker.status": "mixed",
};

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
};

const files = [...walk(path.join(ROOT, "client", "src")), ...walk(path.join(ROOT, "server")), ...walk(path.join(ROOT, "shared"))]
  .filter((f) => f !== SHARED);

// A "literal list" = 2+ quoted canonical codes separated only by , / whitespace,
// optionally inside [ ] or ( ). Covers JS arrays and SQL `IN ('SOL','EXC')`.
const LIST = /(['"`])([A-Z]{2,5})\1(\s*,\s*(['"`])[A-Z]{2,5}\4)+/g;
// A TS string-literal union: 'NEG' | 'SOL' | 'EXC'.
const UNION = /(['"`])([A-Z]{2,5})\1(\s*\|\s*(['"`])[A-Z]{2,5}\4)+/g;
// A flat object literal — no nested braces, which is every lookup table of the
// weight/label/colour kind. Keys may be bare or quoted.
const FLAT_OBJ = /\{[^{}]*\}/g;
const OBJ_KEY = /(?:^|[{,;\n])\s*(?:(['"`])([A-Za-z_$][\w$]*)\1|([A-Za-z_$][\w$]*))\s*:/g;
// switch dispatch: case "NEG":
const CASE = /\bcase\s+(['"`])([A-Z]{2,5})\1\s*:/g;
// how many lines apart two `case` labels may be and still count as one switch
const CASE_WINDOW = 40;

const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

const findings = [];
const seen = new Set();
const push = (f) => {
  const key = `${f.file}:${f.line}:${f.kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push(f);
};

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  const rel = path.relative(ROOT, file);
  const at = (line, codes, kind, extra = {}) =>
    push({ file: rel, line, kind, codes: [...new Set(codes)].sort(), raw: (lines[line - 1] || "").trim().slice(0, 160), ...extra });

  for (const [kind, re] of [["list", LIST], ["union", UNION]]) {
    for (const m of text.matchAll(re)) {
      const codes = [...m[0].matchAll(/['"`]([A-Z]{2,5})['"`]/g)].map((x) => x[1]);
      // every member must be a canonical code — otherwise it's some other enum
      if (codes.length < 2 || !codes.every((c) => ALL.has(c))) continue;
      at(lineOf(text, m.index), codes, kind);
    }
  }

  // keys — an object literal whose keys are ALL canonical status codes is a
  // lookup table keyed by status: weights, labels, colours, buckets.
  for (const m of text.matchAll(FLAT_OBJ)) {
    const body = m[0];
    const keys = [...body.matchAll(OBJ_KEY)].map((k) => k[2] || k[3]);
    if (keys.length < 2 || !keys.every((k) => ALL.has(k))) continue;
    at(lineOf(text, m.index), keys, "keys");
  }

  // label — a quoted LEGACY LABEL used as a value in a comparison or a
  // membership test against a status-ish column. This is the shape that hid
  // four dead predicates from r575-r583.
  const STATUSISH = /\b(marketing_status|marketingStatus|[A-Za-z_]*[Ss]tatus)\b/;
  const OPERATOR = /(===|!==|==|!=|=\s*['"`]|\bIN\s*\(|\bNOT\s+IN\s*\(|\.includes\s*\(|\bANY\s*\()/;
  for (let i = 0; i < lines.length; i++) {
    const quoted = [...lines[i].matchAll(/(['"`])([A-Za-z][A-Za-z ]{1,24})\1/g)]
      .map((m) => m[2])
      .filter((v) => LABELS.has(v.toLowerCase()));
    if (!quoted.length) continue;
    // context window — a multi-line SQL template puts the column on an
    // earlier line than the literal.
    const win = lines.slice(Math.max(0, i - 3), i + 2).join("\n");
    if (!STATUSISH.test(win) || !OPERATOR.test(lines[i])) continue;
    // A SQL CASE arm (`WHEN LOWER(TRIM(status)) IN (...) THEN 'NEG'`) is the
    // canonicaliser itself — mapping labels to codes is exactly where labels
    // belong. Comparing against one is the bug; translating one is not.
    if (/\bTHEN\s+'/.test(lines[i])) continue;
    // Which column? the identifier itself first, then the nearest table name.
    const wide = lines.slice(Math.max(0, i - 25), i + 3).join("\n");
    let column = "?";
    if (/marketing_status|marketingStatus/.test(win)) column = "available_units.marketing_status";
    else if (/\binvestment_tracker\b/.test(wide)) column = "investment_tracker.status";
    else if (/\bcrm_deals\b|\bcrmDeals\b/.test(wide)) column = "crm_deals.status";
    const truth = COLUMN_TRUTH[column] || "?";
    at(i + 1, quoted.map((v) => LABELS.get(v.toLowerCase())), "label", { labels: [...new Set(quoted)], column, truth });
  }

  // case — a run of `case "CODE":` labels close together is one switch on status
  const cases = [...text.matchAll(CASE)]
    .filter((m) => ALL.has(m[2]))
    .map((m) => ({ line: lineOf(text, m.index), code: m[2] }));
  let run = [];
  const flush = () => {
    if (run.length >= 2) at(run[0].line, run.map((r) => r.code), "case");
    run = [];
  };
  for (const c of cases) {
    if (run.length && c.line - run[run.length - 1].line > CASE_WINDOW) flush();
    run.push(c);
  }
  flush();
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
for (const f of findings) {
  f.matches = Object.entries(CANON)
    .filter(([, v]) => v.length === f.codes.length && [...v].sort().join() === f.codes.join())
    .map(([k]) => k);
}

const kindArg = process.argv.find((a) => a.startsWith("--kind="));
const kinds = kindArg ? kindArg.slice(7).split(",") : null;
const showAll = process.argv.includes("--all");
// A label predicate is never "canonical" — the whole point is that it reads a
// vocabulary the column does not hold. Always report it.
// A label predicate is never "canonical" — the whole point is that it reads a
// vocabulary the column does not hold. But a label literal whose column we
// could NOT determine is usually a DIFFERENT enum (leasing-schedule
// Occupied/Vacant, AML complete/incomplete), so it is noise by default and
// only shows under --all. Determined-column hits are the candidate list.
const diverge = findings.filter((x) => (x.kind === "label" ? x.truth !== "?" : x.matches.length === 0));
let shown = showAll ? findings : diverge;
if (kinds) shown = shown.filter((x) => kinds.includes(x.kind));

const tally = (rows) =>
  ["list", "keys", "union", "case", "label"].map((k) => `${k} ${rows.filter((r) => r.kind === k).length}`).join(" · ");

console.log(`canonical: ${CANON.DEAL_STATUS_CODES.join(",")}`);
console.log(`${findings.length} hardcoded status set(s) in client/ + server/ + shared/  [${tally(findings)}]`);
console.log(`${findings.length - diverge.length} match a canonical set exactly; ${diverge.length} diverge  [${tally(diverge)}]\n`);

for (const f of shown) {
  const near = Object.entries(CANON)
    .map(([k, v]) => {
      const missing = v.filter((c) => !f.codes.includes(c));
      const extra = f.codes.filter((c) => !v.includes(c));
      return { k, missing, extra, dist: missing.length + extra.length };
    })
    .sort((a, b) => a.dist - b.dist)[0];
  console.log(`${f.file}:${f.line}  [${f.kind}]`);
  if (f.kind === "label") {
    console.log(`  labels: ${f.labels.join(" | ")}  ->  ${f.codes.join(",")}`);
    console.log(`  column: ${f.column}  [holds ${f.truth}]`);
    console.log(`  code:   ${f.raw}`);
    console.log(
      f.truth === "codes"
        ? `  DEAD: the column is canonicalised to codes at boot — this matches nothing`
        : f.truth === "mixed"
          ? `  MIXED column — may be half-alive; needs a vocabulary decision, not a blind fix`
          : `  column undetermined — read it`,
    );
  } else {
    console.log(`  codes:  ${f.codes.join(",")}`);
    console.log(`  code:   ${f.raw}`);
    if (f.matches.length) console.log(`  == ${f.matches.join(" / ")}`);
    else console.log(`  nearest ${near.k}: missing ${near.missing.join(",") || "-"} | extra ${near.extra.join(",") || "-"}`);
  }
  console.log("");
}
