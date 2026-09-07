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
// A sixth shape, `assign`, is the WRITE side of the same class: a legacy
// LABEL stamped INTO a status column. r588 fixed three of these
// (routes.ts:6005, routes.ts:7673, unified-add-unit-dialog.tsx:142 all wrote
// the label "Available" into available_units.marketing_status) and the sweep
// could not find any of them, because it only ever looked for COMPARISONS —
// `marketingStatus: "Available"` has a colon, not an operator. A write is
// strictly worse than a dead read: a dead read matches nothing, a bad write
// puts a value in the table that every code predicate then misses.
//
// r597 adds the two shapes offered to (and declined by) three rounds running.
// Both are status predicates that carry no quoted CODE and no operator, so
// the six shapes above were structurally blind to them:
//   regex   lower(marketing_status) ~ '(neg|offer|sol|exc|hots|terms)'   (r594)
//   default text("marketing_status").default("Available")                (r595)
// `regex` scores each ALTERNATIVE against the column's own vocabulary: an
// alternative that matches no value the column can hold is DEAD, and a dead
// alternative is almost always a code the author meant to catch and missed
// (r594's `hots` could never match the code HOT, so the hottest stage was
// absent from the asset brief AND from the gap list built to catch that
// silence). It also names the codes no alternative reaches — informational,
// since selecting a subset is what a predicate is for.
// `default` reads shared/schema.ts and diffs each tracked status column's
// DEFAULT against that column's vocabulary. A default is a write nobody
// makes (lesson 13): omit the field and postgres supplies the literal,
// straight past every canonicaliser on the write path.
//
// Usage: node qa/r575-status-literal-sweep.mjs [--all] [--kind=keys,case,label,assign,regex,default]
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
// What each tracked column can actually hold — the set a regex alternative or
// a column DEFAULT has to hit to be alive. investment_tracker is mixed, so its
// vocabulary is the canonical set PLUS the labels the column really carries.
const COLUMN_VOCAB = {
  "crm_deals.status": CANON.DEAL_STATUS_CODES,
  "available_units.marketing_status": CANON.LETTING_STATUSES,
  "investment_tracker.status": [...CANON.INVESTMENT_STATUSES, "Live", "SPEC"],
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

  // Which column is this line writing/reading? Shared by assign + label.
  const columnAt = (i, win) => {
    const wide = lines.slice(Math.max(0, i - 25), i + 3).join("\n");
    if (/marketing_status|marketingStatus/.test(win)) return "available_units.marketing_status";
    if (/\binvestment_tracker\b/.test(wide)) return "investment_tracker.status";
    if (/\bcrm_deals\b|\bcrmDeals\b/.test(wide)) return "crm_deals.status";
    return "?";
  };

  // assign — a quoted LEGACY LABEL written INTO a status field: an object
  // property (`marketingStatus: "Available"`, incl. Drizzle .set()/.values())
  // or a SQL/JS assignment (`marketing_status = 'Available'`). This is the
  // r588 shape the comparison-only sweep was blind to.
  const ASSIGN = /\b(marketing_status|marketingStatus|deal_status|dealStatus|status)\s*(:|=(?!=))\s*(['"`])([A-Za-z][A-Za-z ]{1,24})\3/g;
  const assignedLines = new Set();
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(ASSIGN)) {
      const label = m[4];
      if (!LABELS.has(label.toLowerCase())) continue;
      const win = lines.slice(Math.max(0, i - 3), i + 2).join("\n");
      const column = columnAt(i, win);
      assignedLines.add(i);
      at(i + 1, [LABELS.get(label.toLowerCase())], "assign", {
        labels: [label], column, truth: COLUMN_TRUTH[column] || "?", field: m[1],
      });
    }
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
    // A line the assign pass already claimed is a WRITE, not a comparison —
    // reporting it twice would inflate the census.
    if (assignedLines.has(i)) continue;
    const column = columnAt(i, win);
    const truth = COLUMN_TRUTH[column] || "?";
    at(i + 1, quoted.map((v) => LABELS.get(v.toLowerCase())), "label", { labels: [...new Set(quoted)], column, truth });
  }

  const scoreAlternations = (line, lineNo, column, via) => {
    const vocab = COLUMN_VOCAB[column];
    if (!vocab) return; // undetermined column — a different enum, not our census
    for (const m of line.matchAll(ALTERNATION)) {
      const alts = m[1].split("|").map((a) => a.trim().toLowerCase()).filter(Boolean);
      if (alts.length < 2) continue;
      const lower = vocab.map((v) => v.toLowerCase());
      const dead = alts.filter((a) => !lower.some((v) => v.includes(a)));
      const unreachable = vocab.filter((v) => !alts.some((a) => v.toLowerCase().includes(a)));
      at(lineNo, vocab.filter((v) => !unreachable.includes(v)), "regex", {
        alts, dead, unreachable, column, truth: COLUMN_TRUTH[column] || "?", via,
      });
    }
  };

  // regex — an ALTERNATION over a status column. Carries no quoted code and no
  // comparison operator, so every shape above walks straight past it. Score
  // each alternative against the column's own vocabulary: one that matches
  // nothing the column can hold is DEAD (r594's `hots` vs the code HOT).
  const ALTERNATION = /\(\s*([A-Za-z][A-Za-z0-9_]{1,14}(?:\s*\|\s*[A-Za-z][A-Za-z0-9_]{1,14}){1,})\s*\)/g;
  const REGEXISH = /(~\*?\s*['"`]|\.test\s*\(|\.match\s*\(|\bRegExp\b|\bREGEXP\b|\bSIMILAR\s+TO\b|=\s*\/|:\s*\/)/;
  for (let i = 0; i < lines.length; i++) {
    if (!REGEXISH.test(lines[i])) continue;
    const win = lines.slice(Math.max(0, i - 3), i + 2).join("\n");
    if (!STATUSISH.test(win)) continue;
    const column = columnAt(i, win);
    scoreAlternations(lines[i], i + 1, column);
  }

  // The same alternation held in a CONSTANT — the idiom r594's fix left behind
  // (`const IN_PLAY_STATUS_RX = "'(neg|offer|hot|sol|exc|terms)'"`, read by
  // four queries). The declaration line names no column, so score it against
  // the column its USE sites read: one shared predicate is exactly the thing
  // whose next edit must not go unwatched.
  const CONST_ALT = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[`'"][^)\n]*\([A-Za-z][A-Za-z0-9_]*(?:\s*\|\s*[A-Za-z][A-Za-z0-9_]*)+\)/;
  for (let i = 0; i < lines.length; i++) {
    const d = lines[i].match(CONST_ALT);
    if (!d) continue;
    const name = d[1];
    let column = "?";
    for (let j = 0; j < lines.length && column === "?"; j++) {
      if (j === i || !lines[j].includes(name)) continue;
      if (!/~\*?\s*(\$\{|\+|\s*[A-Za-z_$])/.test(lines[j]) && !new RegExp(`~\\*?\\s*\\$\\{${name}`).test(lines[j])) continue;
      const w = lines.slice(Math.max(0, j - 3), j + 2).join("\n");
      if (!STATUSISH.test(w)) continue;
      column = columnAt(j, w);
    }
    scoreAlternations(lines[i], i + 1, column, name);
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

// default — a column DEFAULT is a write nobody makes (lesson 13, r595): omit
// the field and postgres supplies the literal, past every canonicaliser on the
// write path. Read the tracked status columns straight out of the schema.
{
  const schemaPath = path.join(ROOT, "shared", "schema.ts");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const schemaLines = schema.split("\n");
  let table = null;
  for (let i = 0; i < schemaLines.length; i++) {
    const t = schemaLines[i].match(/pgTable\(\s*["'`]([a-z0-9_]+)["'`]/);
    if (t) table = t[1];
    if (!table) continue;
    const c = schemaLines[i].match(/["'`]([a-z0-9_]*status)["'`]\s*[,)][^\n]*\.default\(\s*["'`]([^"'`]+)["'`]/);
    if (!c) continue;
    const column = `${table}.${c[1]}`;
    const vocab = COLUMN_VOCAB[column];
    if (!vocab) continue;
    const value = c[2];
    const alive = vocab.some((v) => v === value);
    push({
      file: path.relative(ROOT, schemaPath), line: i + 1, kind: "default",
      codes: LABELS.has(value.toLowerCase()) ? [LABELS.get(value.toLowerCase())] : [],
      raw: schemaLines[i].trim().slice(0, 160),
      column, truth: COLUMN_TRUTH[column] || "?", value, alive,
    });
  }
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
// regex: divergent when an alternative is DEAD (matches nothing the column can
// hold) — the r594 tell. default: divergent when the literal is not itself a
// value the column's vocabulary contains — the r595 tell.
const diverge = findings.filter((x) =>
  x.kind === "label" || x.kind === "assign" ? x.truth !== "?"
    : x.kind === "regex" ? x.dead.length > 0
      : x.kind === "default" ? !x.alive
        : x.matches.length === 0);
let shown = showAll ? findings : diverge;
if (kinds) shown = shown.filter((x) => kinds.includes(x.kind));

const tally = (rows) =>
  ["list", "keys", "union", "case", "label", "assign", "regex", "default"].map((k) => `${k} ${rows.filter((r) => r.kind === k).length}`).join(" · ");

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
  if (f.kind === "assign") {
    console.log(`  WRITES the label ${f.labels.join(" | ")} into \`${f.field}\`  (canonical: ${f.codes.join(",")})`);
    console.log(`  column: ${f.column}  [holds ${f.truth}]`);
    console.log(`  code:   ${f.raw}`);
    console.log(
      f.truth === "codes"
        ? `  BAD WRITE: this stamps a label into a codes column — every code predicate then misses the row`
        : f.truth === "mixed"
          ? `  MIXED column — decide the vocabulary before changing the write`
          : `  column undetermined — read it (may be a different enum entirely)`,
    );
  } else if (f.kind === "regex") {
    console.log(`  alternation: ${f.alts.join(" | ")}${f.via ? `   (const ${f.via}, column resolved from its use sites)` : ""}`);
    console.log(`  column: ${f.column}  [holds ${f.truth}]`);
    console.log(`  code:   ${f.raw}`);
    if (f.dead.length)
      console.log(`  DEAD alternative(s): ${f.dead.join(", ")} — match no value this column can hold`);
    console.log(`  not reached: ${f.unreachable.join(",") || "-"}${f.dead.length ? "  <- check these against the dead alternatives" : "  (selecting a subset is what a predicate is for)"}`);
  } else if (f.kind === "default") {
    console.log(`  DEFAULT ${JSON.stringify(f.value)} on ${f.column}  [holds ${f.truth}]`);
    console.log(`  code:   ${f.raw}`);
    console.log(
      f.alive
        ? `  in vocabulary — fine`
        : `  BAD DEFAULT: omit the field and postgres stamps this literal, past every write-path canonicaliser${f.codes.length ? ` (means ${f.codes.join(",")})` : ""}`,
    );
  } else if (f.kind === "label") {
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
