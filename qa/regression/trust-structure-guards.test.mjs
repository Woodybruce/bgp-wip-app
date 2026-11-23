// A trust checked by BGP from its structure, never KYC4U (Jack, 23 November
// 2026: "Remove KYC4u on trusts. We need you to build the trust
// structuring"). Source guards; the rules are tested in server/trust-structure.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("the structure is BGP staff's, kept per trust record, and a save screens everyone again", () => {
  const s = read("server/trust-structure.ts");
  assert.match(s, /router\.get\("\/api\/trust-structure\/:companyId"[\s\S]{0,120}if \(!\(await staffMe\(req\)\)\) return res\.status\(403\)/);
  assert.match(s, /router\.put\("\/api\/trust-structure\/:companyId"[\s\S]{0,160}const me = await staffMe\(req\);\s*if \(!me\) return res\.status\(403\)/);
  assert.match(s, /if \(!\(await isTrustRecord\(companyId\)\)\) return res\.status\(409\)/);
  assert.match(s, /checkTrustStructure\(req\.body\?\.structure\)/);
  assert.match(s, /startPrecheck\(companyId, \{ dealId, userId: me\.id, force: true, entityId: null \}\)/);
  const index = read("server/index.ts");
  assert.match(index, /CREATE TABLE IF NOT EXISTS kyc_trust_structures \(\s*company_id varchar PRIMARY KEY/);
  assert.match(index, /app\.use\(trustStructureRouter\);/);
});

test("a trust never goes to KYC4U: the Next line, the sign-off, the board and the Kick off AML step", () => {
  assert.match(read("shared/aml-box.ts"), /const f: AmlBoxFacts = input\.trust \? \{ \.\.\.input, inHouseEdd: true \} : input;/);
  assert.match(read("shared/party-kyc.ts"), /const f: SignOffFacts = input\.trust \? \{ \.\.\.input, inHouseEdd: true \} : input;/);
  const party = read("server/deal-party-aml.ts");
  assert.match(party, /signOffEnhanced\(facts\) && signOffInHouse\(facts\)/);
  assert.match(party, /trustGaps: trust \? \(await import\("\.\/trust-structure"\)/);
  assert.doesNotMatch(party, /signOffEnhanced\(facts\) && !!facts\.inHouseEdd/);
  const dash = read("server/aml-dashboard.ts");
  assert.match(dash, /const partyInHouse = inHouse \|\| isTrust;/);
  assert.match(dash, /inHouse: partyInHouse, jointAskedAt/);
  assert.match(read("client/src/pages/aml-dashboard.tsx"), /!inHouseEdd && !row\.trust && amlNeedsKyc4u\(/);
  assert.match(read("client/src/pages/deals.tsx"), /const inHouse = !!amlStepStatus\?\.decisions\?\.inHouseEdd \|\| flags\.some\(f => f\.kind === "policy_trust"\);/);
  const box = read("client/src/components/deal-aml-status.tsx");
  assert.match(box, /\{!kyc4uActive && !isTrust && <Kyc4uRequestButton/);
  assert.match(box, /<TrustStructurePanel companyId=\{cp\.id\} dealId=\{dealId\}/);
});

test("the trust's people are the ones to check and to screen, read from its structure", () => {
  assert.match(read("server/kyc-people.ts"), /m\.trustStructureFor\(party\.companyId\)/);
  const pre = read("server/kyc-prechecks.ts");
  assert.match(pre, /if \(isTrust\) \{\s*const \{ trustStructureFor \} = await import\("\.\/trust-structure"\);/);
  assert.match(pre, /trustPerson: true/);
  const portal = read("server/aml-portal.ts");
  assert.match(portal, /trust: trustAsk \}\);/);
  // The person acting may pass the trust's people their links, as they do an owner's.
  assert.match(portal, /TRUST_PERSON_ROLES as readonly string\[\]\)\.includes\(r\)/);
});

test("the dialog holds no form: it opens over the deal form", () => {
  assert.doesNotMatch(read("client/src/components/trust-structure.tsx"), /<form[\s>]/);
});

test("the second read and the AML file carry the structure", () => {
  assert.match(read("server/aml-second-read.ts"), /for \(const t of p\.trustStructure \|\| \[\]\) lines\.push\(`Trust structure: \$\{t\}`\);/);
  const file = read("server/aml-file.ts");
  assert.match(file, /trustStructure,\n\s*\}\);/);
  assert.match(file, /inHouse: !!data\.inHouse \|\| p\.trust,/);
});

test("reading the deed is BGP staff's, checked before the file is taken, and saves no structure", () => {
  const s = read("server/trust-structure.ts");
  assert.match(s, /router\.post\("\/api\/trust-structure\/:companyId\/read-deed", async \(req: Request, res: Response, next\) => \{\s*if \(!\(await staffMe\(req\)\.catch\(\(\) => null\)\)\) return res\.status\(403\)[\s\S]{0,40}next\(\);\s*\}, deedUpload\.single\("file"\)/);
  assert.match(s, /claimDailyRead\(DEED_USAGE_KEY, trustDeedReaderDailyCap\(\)\)/);
  assert.match(s, /return checkTrustDeedRead\(reply\.input, text\);/);
  const route = s.slice(s.indexOf('"/api/trust-structure/:companyId/read-deed"'));
  assert.doesNotMatch(route.slice(0, route.indexOf("\nrouter.", 10)), /INSERT INTO kyc_trust_structures|UPDATE kyc_trust_structures/);
  assert.match(read("client/src/components/trust-structure.tsx"), /<DeedReadBack reading=\{reading\} \/>/);
});
