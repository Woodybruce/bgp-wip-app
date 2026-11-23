// What KYC4U do, brought into the app (Woody, 21 November 2026). Source
// guards; the rules are tested in server/kyc4u-result-pack.test.ts,
// server/web-page-copy.test.ts and server/aml-risk-assessment.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("KYC4U's pack is read by the officers alone, and reading it saves nothing", () => {
  const s = read("server/deal-party-aml.ts");
  const readRoute = s.slice(s.indexOf('router.post("/api/deals/:id/parties/:role/kyc4u-result/read"'), s.indexOf('router.post("/api/deals/:id/parties/:role/kyc4u-result", '));
  assert.match(readRoute, /deciderFirst, takeFiles/);
  assert.doesNotMatch(readRoute, /INSERT INTO|UPDATE |saveFile/);
  assert.match(s, /router\.post\("\/api\/deals\/:id\/parties\/:role\/kyc4u-result", deciderFirst, takeFiles/);
  // The report is read by rules, never sent to an AI provider.
  const rules = read("shared/kyc4u-result-pack.ts") + read("server/kyc4u-result-pack.ts");
  assert.doesNotMatch(rules, /anthropic|openai|askPerplexity|callClaude/i);
});

test("a person is verified from public sources by the officers only", () => {
  const s = read("server/deal-party-aml.ts");
  assert.match(s, /router\.post\("\/api\/deals\/:id\/parties\/:role\/public-figure", deciderFirst, takeFiles/);
  assert.match(s, /router\.post\("\/api\/deals\/:id\/parties\/:role\/public-figure\/:checkId\/withdraw"[\s\S]{0,120}const me = await decider\(req\);/);
  assert.match(read("server/index.ts"), /CREATE TABLE IF NOT EXISTS kyc_public_figure_checks/);
});

test("a web page is copied only from a public address, and the copies never hold BGP's checks up", () => {
  const r = read("server/render-page.ts");
  const fn = r.slice(r.indexOf("export async function renderPagePdf"));
  assert.match(fn, /await assertPublicHost\(target\)/);
  assert.match(fn, /setRequestInterception\(true\)/);
  assert.match(fn, /hostIsPublic\(u\.hostname\)\.then\(ok => \(ok \? r\.continue\(\) : r\.abort\(\)\)\)/);
  assert.match(fn, /Page\.setDownloadBehavior", \{ behavior: "deny" \}/);
  const pre = read("server/kyc-prechecks.ts");
  assert.match(pre, /void import\("\.\/web-page-copy"\)\.then\(/);
  assert.match(read("server/web-page-copy.ts"), /KYC_WEB_COPIES/);
});

test("the solicitors check and the risk assessment are BGP staff's, and the AML file still leaves out the AML register", () => {
  const sol = read("server/solicitor-aml.ts");
  assert.match(sol, /router\.get\("\/api\/deals\/:id\/solicitors-aml"[\s\S]{0,120}if \(!\(await staffMe\(req\)\)\) return res\.status\(403\)/);
  assert.match(sol, /router\.post\("\/api\/deals\/:id\/solicitors-aml\/check"[\s\S]{0,160}if \(!me\) return res\.status\(403\)/);
  assert.match(sol, /searchDomains: SOLICITOR_REGISTER_SITES/);
  assert.match(read("server/index.ts"), /app\.use\(solicitorAmlRouter\);/);
  const file = read("server/aml-file.ts");
  assert.match(file, /router\.get\("\/api\/deals\/:id\/aml-risk-assessment"[\s\S]{0,400}if \(!\(await contactViewer\(req\)\)\.staff\) return res\.status\(403\)/);
  assert.doesNotMatch(file, /aml_internal_reports/);
});

test("a party owned through a company abroad is enhanced due diligence by the officers (KYC4U is no longer used, 23 November 2026)", () => {
  const box = read("shared/aml-box.ts");
  assert.match(box, /const edd = !!f\.trust \|\| !!f\.ownersAbroad \|\| f\.redFlags > 0 \|\| f\.factors > 0;/);
  assert.doesNotMatch(box, /request_kyc4u|Not yet with KYC4U/);
  assert.match(read("shared/party-kyc.ts"), /export const signOffEnhanced = [\s\S]{0,200}!!f\.ownersAbroad\?\.length/);
  assert.doesNotMatch(read("client/src/pages/aml-dashboard.tsx"), /amlNeedsKyc4u/);
});
