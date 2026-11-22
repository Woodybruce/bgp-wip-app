// Companies owned from abroad, traced in the app (Woody, 21 November 2026:
// "let's make sure all of that is built"). Source guards; the rules are
// tested in server/foreign-owners.test.ts and server/kyc-abroad.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("every route about a company abroad is BGP staff's, signed in as themselves", () => {
  const s = read("server/kyc-abroad.ts");
  const routes = s.match(/router\.(get|post)\("[^"]+"/g) || [];
  assert.equal(routes.length, 6);
  for (const r of routes) assert.match(s, new RegExp(`${r.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}, staffFirst`), `${r} must start with staffFirst`);
  assert.match(s, /contactViewer\(req\)/);
  // /api/deals/ is on no client gateway list.
  assert.doesNotMatch(read("server/index.ts").split("CLIENT_ALLOWED_WRITES")[1]?.slice(0, 4000) || "", /\/api\/deals\//);
});

test("the readers call Anthropic directly, once a file, under their own daily allowance, and never on a timer", () => {
  const abroad = read("server/kyc-abroad.ts");
  const chart = read("server/kyc-structure-chart.ts");
  for (const [src, cap] of [[abroad, "ACCOUNTS_PARENT_READER_DAILY_CAP"], [chart, "STRUCTURE_CHART_READER_DAILY_CAP"]]) {
    assert.match(src, new RegExp(cap));
    assert.match(src, /claimDailyRead\(/);
    assert.match(src, /getAnthropicClient\(true\)/);
    assert.match(src, /tool_choice: \{ type: "tool"/);
    assert.doesNotMatch(src, /setInterval|cron|schedule\(/);
  }
  // A scanned filing is read only when the register names no owner.
  assert.match(abroad, /mayScan: !namesOwners && !ch\.listing/);
  // The same filing is not read twice.
  assert.match(abroad, /prev\.documentId === input\.documentId/);
});

test("GLEIF is paced, time-limited and never throws; it can be switched off", () => {
  const g = read("server/gleif.ts");
  assert.match(g, /GAP_MS/);
  assert.match(g, /AbortSignal\.timeout\(15_000\)/);
  assert.match(g, /String\(process\.env\.GLEIF \|\| ""\)\.trim\(\)\.toLowerCase\(\) !== "off"/);
  assert.match(g, /return empty\("error", message\)/);
});

test("the trace runs inside BGP's checks before asking and is stored on the run; recorded people are screened as owners", () => {
  const pre = read("server/kyc-prechecks.ts");
  assert.match(pre, /traceAbroad\(companiesHouse, previous\)/);
  assert.match(pre, /\.\.\.\(abroad \? \{ abroad \} : \{\}\)/);
  assert.match(pre, /abroadPeopleFor\(companyId, entityId\)[\s\S]{0,200}owner: true/);
});

test("the records table is in the boot migrations, five-year deletion and company merges", () => {
  assert.match(read("server/index.ts"), /CREATE TABLE IF NOT EXISTS kyc_abroad_records/);
  const ret = read("server/aml-records-retention.ts");
  assert.match(ret, /\{ table: "kyc_abroad_records", party: "company_id"/);
  assert.match(ret, /DELETE FROM kyc_abroad_records WHERE company_id = \$1/);
  assert.match(read("server/brand-dedupe.ts"), /\{ table: "kyc_abroad_records",\s+column: "company_id" \}/);
});

test("a party owned from abroad still goes to KYC4U: the trace gathers, it does not decide", () => {
  const box = read("shared/aml-box.ts");
  assert.match(box, /ownersAbroad/);
  assert.match(read("shared/party-kyc.ts"), /ownersAbroad/);
  const ui = read("client/src/components/aml-abroad.tsx");
  // Off, the trace goes into KYC4U's note; in-house (22 November 2026), only the AML file.
  assert.match(ui, /What is traced and recorded here goes into the AML file\{inHouse \? "" : " and KYC4U's note"\}/);
});
