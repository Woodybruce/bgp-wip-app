// Trusts to KYC4U in full, the red mark until KYC4U has it, and the officers'
// second read (Jack, 20 November 2026). Source guards; the rules are tested in
// server/aml-second-read.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("the second read is the officers' alone, decides nothing and saves no reading", () => {
  const s = read("server/aml-second-read.ts");
  assert.match(s, /router\.post\("\/api\/deals\/:id\/parties\/:role\/second-read"[\s\S]{0,200}const me = await decider\(req\);\s*if \(!\("id" in me\)\) return res\.status\(me\.status\)/);
  assert.match(s, /if \(p\.level\?\.level !== "enhanced"\) return res\.status\(409\)/);
  assert.match(s, /claimDailyRead\(USAGE_KEY, secondReadDailyCap\(\)\)/);
  assert.doesNotMatch(s, /UPDATE crm_companies|approveEntityKyc|kyc_status\s*=/);
  assert.match(read("server/index.ts"), /app\.use\(amlSecondReadRouter\);/);
});

test("a trust is recorded by BGP staff, and a name is only a suggestion", () => {
  const s = read("server/deal-parties.ts");
  assert.match(s, /router\.put\("\/api\/deals\/:id\/parties\/:role\/trust"[\s\S]{0,120}const me = await staffMe\(req\);\s*if \(!me\) return res\.status\(403\)/);
  assert.match(s, /trustHint: trustMarkInName\(brandRow\.name\) \|\| trustMarkInName\(company\?\.name\)/);
  // The trust's checklist leads KYC4U's note; a reliance on another firm (21 November 2026) follows it.
  assert.match(read("server/kyc4u.ts"), /trustNote, relianceNote, flagNote, checkedNote\]/);
});

test("no Not with KYC4U mark on the box or the board: KYC4U is no longer used (23 November 2026)", () => {
  const box = read("client/src/components/deal-aml-status.tsx");
  assert.doesNotMatch(box, /aml-kyc4u-needed-/);
  assert.match(box, /<SecondReadPanel dealId=\{dealId\} role=\{cp\.role\} partyName=\{partyName\} trust=\{isTrust\} \/>/);
  assert.doesNotMatch(read("client/src/pages/aml-dashboard.tsx"), /amlNeedsKyc4u|Not with KYC4U/);
});
