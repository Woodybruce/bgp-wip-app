/**
 * r632 — the two server-built .xlsx doors r630 never reached: the Board
 * Report export and the PLA workbook writers.
 *
 * Three bugs this pins:
 *   1. The Board Report's "Fees by Agent" ignored `deal_fee_allocations` and
 *      always split the fee evenly across `internal_agent`. A 60/25/15 split
 *      saved through BGP's own fee-allocation editor left the board pack as
 *      50/50 with the BGP House slice missing. Now both that export and
 *      `/api/wip/agent-summary` go through `splitDealFee` — ONE derivation.
 *   2. Every PLA route read `req.user?.id`, which `requireAuth` never sets,
 *      so `POST /api/pla/matters` 500'd on `lead_user_id` NOT NULL and every
 *      workbook row was stamped with no author.
 *   3. The Comparables Schedule door 500'd on
 *      `sql\`id = ANY(${jsArray})\`` — "op ANY/ALL (array) requires array on
 *      right side" — so the comparables .xlsx could never be produced.
 *
 * (1) and (3) are behavioural. (2) is a source tripwire — the behavioural
 * proof needs a live server and is recorded in the r632 ROLLING-LOG entry.
 */
import { readFileSync } from "fs";
import { splitDealFee } from "../shared/deal-fee-split";
import { db, pool } from "../server/db";
import { crmComps } from "../shared/schema";
import { inArray } from "drizzle-orm";

let fails = 0;
let checks = 0;
function ok(name: string, pass: boolean, detail = "") {
  checks++;
  if (!pass) fails++;
  console.log(`    ${pass ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── 1. splitDealFee — the one fee-split derivation ───────────────────────
const ALLOCS = [
  { agentName: "Evie North", allocationType: "percentage", percentage: 60, fixedAmount: null },
  { agentName: "Harry Elliott", allocationType: "percentage", percentage: 25, fixedAmount: null },
  { agentName: "BGP House", allocationType: "percentage", percentage: 15, fixedAmount: null },
];
const byName = (rs: ReturnType<typeof splitDealFee>) =>
  Object.fromEntries(rs.map((r) => [r.agentName, r.amount]));

const split = byName(splitDealFee(250000, ALLOCS, ["Harry Elliott", "Evie North"]));
ok("a saved 60/25/15 split is the split, not an even one",
  split["Evie North"] === 150000 && split["Harry Elliott"] === 62500,
  `Evie=${split["Evie North"]} Harry=${split["Harry Elliott"]}`);
ok("the BGP House 15% firm slice reaches the report",
  split["BGP House"] === 37500, `BGP House=${split["BGP House"]}`);
ok("the even split is NOT used when allocations exist",
  split["Evie North"] !== 125000 && split["Harry Elliott"] !== 125000,
  "125000 each is the old symptom");
ok("the split accounts for the whole fee",
  Math.abs(Object.values(split).reduce((a, b) => a + b, 0) - 250000) < 0.01,
  `sum=${Object.values(split).reduce((a, b) => a + b, 0)}`);

const fixed = byName(splitDealFee(250000, [
  { agentName: "Evie North", allocationType: "fixed", percentage: null, fixedAmount: 90000 },
], null));
ok("a fixed-amount allocation is honoured over any percentage",
  fixed["Evie North"] === 90000, `Evie=${fixed["Evie North"]}`);

const fallback = byName(splitDealFee(250000, [], ["Harry Elliott", "Evie North"]));
ok("with NO allocations the even split over internal_agent still applies",
  fallback["Evie North"] === 125000 && fallback["Harry Elliott"] === 125000,
  `Evie=${fallback["Evie North"]} Harry=${fallback["Harry Elliott"]}`);

// A deal with allocations but an EMPTY internal_agent used to contribute
// nothing at all to the board pack.
const noNames = byName(splitDealFee(250000, ALLOCS, []));
ok("allocations still report when internal_agent is empty",
  Object.keys(noNames).length === 3 && noNames["Evie North"] === 150000,
  `agents=${Object.keys(noNames).length}`);

ok("no agents at all yields no rows (not a divide-by-zero)",
  splitDealFee(250000, [], []).length === 0);

// The gate goes in BEFORE the split, so a hidden agent also leaves the divisor.
const gated = byName(splitDealFee(250000, [], ["Harry Elliott", "Evie North"], (n) => n !== "Harry Elliott"));
ok("a gated-out agent leaves the even-split divisor, not just the output",
  Object.keys(gated).length === 1 && gated["Evie North"] === 250000,
  `Evie=${gated["Evie North"]}`);

// ── 2. the comps-by-id query the Comparables Schedule runs ───────────────
try {
  const all = await db.select({ id: crmComps.id }).from(crmComps).limit(3);
  const ids = all.map((r) => r.id);
  if (ids.length < 2) {
    ok("comps-by-id lookup: at least two comps to ask for", false, `only ${ids.length} comps in the DB — VACUOUS`);
  } else {
    const got = await db.select({ id: crmComps.id }).from(crmComps).where(inArray(crmComps.id, ids));
    ok("the Comparables Schedule's comps-by-id lookup runs and returns every id asked for",
      got.length === ids.length, `asked ${ids.length}, got ${got.length}`);
  }
} catch (e: any) {
  ok("the Comparables Schedule's comps-by-id lookup runs at all", false,
    `threw: ${e?.message} (the r632 symptom was "op ANY/ALL (array) requires array on right side")`);
}

// ── 3. source tripwires ──────────────────────────────────────────────────
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url).pathname, "utf8");
for (const f of ["server/pla-matters.ts", "server/pla-valuation.ts"]) {
  const s = src(f);
  const bad = (s.match(/\(req as any\)\.user\?\.id/g) || []).length;
  const good = (s.match(/actorId\(req\)/g) || []).length;
  ok(`${f}: reads the actor from the session/token, not req.user`,
    bad === 0 && good >= 3, `req.user reads=${bad}, actorId(req) call sites=${good}`);
}
{
  const s = src("server/pla-valuation.ts");
  ok("pla-valuation: actorId reads session.userId / tokenUserId",
    /function actorId[\s\S]{0,240}?session[\s\S]{0,120}?tokenUserId/.test(s));
}
{
  // The Board Report export block only — the screen handler above it is a
  // different door.
  const s = src("server/crm.ts");
  const i = s.indexOf('app.get("/api/board-report/export-excel"');
  ok("the board-report export handler is still there to check", i > 0);
  const block = s.slice(i, i + 12000);
  ok("the board-report export splits fees through splitDealFee",
    (block.match(/splitDealFee\(/g) || []).length >= 1);
  ok("the board-report KPIs are numbers, not pre-rendered £ strings",
    !/toLocaleString\(\)/.test(block) && !/\[\"Fees Billed YTD\", `£/.test(block),
    "a `£${n.toLocaleString()}` KPI is the old symptom");
}

console.log(`\n  ── r632 xlsx doors: ${fails === 0 ? "all green" : `${fails} FAILURES`} (${checks} assertions) ──`);
await pool.end();
process.exit(fails === 0 ? 0 : 1);
