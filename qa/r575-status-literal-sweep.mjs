#!/usr/bin/env node
// r575 — census every hardcoded deal-status literal list in client/ + server/
// and diff it against the canonical sets in shared/deal-status.ts.
//
// The recurring bug shape (r573, r574): a filter compares crm_deals.status to
// a list of codes typed out by hand. When a code is added to the shared enum
// (HOT, 2026-08-12) every hand-typed list silently stops matching it.
//
// Usage: node qa/r575-status-literal-sweep.mjs [--all]
//   default: only lists that DIVERGE from every canonical set
//   --all:   every literal list found

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

const findings = [];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const lines = text.split("\n");
  for (const m of text.matchAll(LIST)) {
    const codes = [...m[0].matchAll(/['"`]([A-Z]{2,5})['"`]/g)].map((x) => x[1]);
    // every member must be a canonical code — otherwise it's some other enum
    if (!codes.every((c) => ALL.has(c))) continue;
    if (codes.length < 2) continue;
    const line = text.slice(0, m.index).split("\n").length;
    const set = [...new Set(codes)].sort();
    const matches = Object.entries(CANON)
      .filter(([, v]) => v.length === set.length && [...v].sort().join() === set.join())
      .map(([k]) => k);
    findings.push({
      file: path.relative(ROOT, f),
      line,
      codes: set,
      raw: lines[line - 1].trim().slice(0, 160),
      matches,
    });
  }
}

const showAll = process.argv.includes("--all");
const shown = showAll ? findings : findings.filter((x) => x.matches.length === 0);

console.log(`canonical: ${CANON.DEAL_STATUS_CODES.join(",")}`);
console.log(`${findings.length} hardcoded status-literal list(s) in client/ + server/ + shared/`);
console.log(`${findings.length - findings.filter((x) => x.matches.length === 0).length} match a canonical set exactly; ${findings.filter((x) => x.matches.length === 0).length} diverge\n`);

for (const f of shown) {
  const near = Object.entries(CANON)
    .map(([k, v]) => {
      const missing = v.filter((c) => !f.codes.includes(c));
      const extra = f.codes.filter((c) => !v.includes(c));
      return { k, missing, extra, dist: missing.length + extra.length };
    })
    .sort((a, b) => a.dist - b.dist)[0];
  console.log(`${f.file}:${f.line}`);
  console.log(`  codes:  ${f.codes.join(",")}`);
  console.log(`  code:   ${f.raw}`);
  if (f.matches.length) console.log(`  == ${f.matches.join(" / ")}`);
  else console.log(`  nearest ${near.k}: missing ${near.missing.join(",") || "-"} | extra ${near.extra.join(",") || "-"}`);
  console.log("");
}
