// The other side's agent passes the standard client checks on to their client
// (Woody, 23 November 2026: "with the agent acting for the tenant or against
// us we need them to pass on the standard KYC requests for their clients to
// complete the agent should have the ability to help organise by uploading
// docs etc."). Source guards; the emails are tested in
// server/kyc-request.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("a request through the agent: the agent's address, never BGP's, never for BGP's own client, nothing typed into the CRM", () => {
  const s = read("server/aml-portal.ts");
  assert.match(s, /viaAgent: z\.object\(\{\s*firm: z\.string\(\)\.trim\(\)\.min\(2\)\.max\(160\),[\s\S]{0,300}\}\)\.strict\(\)\.nullish\(\)/);
  const create = s.slice(s.indexOf("export async function createClientCheck"), s.indexOf("// ── A person's own request"));
  assert.match(create, /const email = cleanEmail\(via \? via\.email : input\.email\)/);
  assert.match(create, /if \(email\.endsWith\(STAFF_DOMAIN\)\) throw Object\.assign\(new Error\("That is a BGP address: enter the agent's contact\."\)/);
  assert.match(create, /if \(party\.role === found\.deal\.clientRole\) throw/);
  assert.match(create, /if \(!contactId && !via\) \{/, "nothing typed for the agent's route goes into the party's CRM record");
  assert.match(create, /if \(needsIdCheck && !viaAgent\) \{/, "the identity check starts on the page, once the person doing it is named");
  assert.match(create, /kycViaAgentRequestEmail\(\{/);
});

test("the agent passes it on from the page: only on a request through the agent, a few times a day, never to a BGP address or into the CRM", () => {
  const s = read("server/aml-portal.ts");
  const start = s.indexOf('kycRequestRouter.post("/api/kyc-upload/:token/pass-on"');
  assert.ok(start > 0, "the route exists");
  const route = s.slice(start, s.indexOf("kycRequestRouter.post(", start + 10));
  assert.match(route, /if \(row\.is_test \|\| !via \|\| request\.person \|\| isJointRequest\(request\)\) return res\.status\(400\)/);
  assert.match(route, /CLIENT_SENDS_A_DAY/);
  assert.match(route, /CLIENT_SEND_GAP_MS/);
  assert.match(route, /email\.endsWith\(STAFF_DOMAIN\)/);
  assert.match(route, /passedOnBy: \{ name: via\.name, firm: via\.firm \}/);
  assert.match(route, /cc: \[cleanEmail\(row\.contact_email\), \.\.\.request\.cc\]/, "the agent and BGP's agents are copied");
  assert.doesNotMatch(route, /crm_contacts|findOrAddPartyPerson/);
});

test("replies by email: from the agent, a colleague at the agent's firm, or whoever the agent passed it on to", () => {
  const s = read("server/aml-portal.ts");
  assert.match(s, /const sameFirm = \(isJointRequest\(row\.request\) \|\| !!viaAgent\) && sameFirmDomain\(from, cleanEmail\(row\.contact_email\)\)/);
  assert.match(s, /const passedTo = !!viaAgent\?\.passedOn\?\.some\(x => cleanEmail\(x\.email\) === from\)/);
  assert.match(s, /from !== cleanEmail\(row\.contact_email\) && !sameFirm && !passedTo/);
});

test("the page: send it on to someone at the party, and the person doing the identity check names themselves first", () => {
  const page = read("client/src/pages/kyc-upload.tsx");
  assert.match(page, /\/api\/kyc-upload\/\$\{encodeURIComponent\(token\)\}\/pass-on/);
  assert.match(page, /data-testid="kyc-via-agent"/);
  assert.match(page, /const askIdName = !!view\.viaAgent && !view\.viaAgent\.personNamed/);
  assert.match(page, /JSON\.stringify\(askIdName \? \{ name: idName\.trim\(\) \} : \{\}\)/);
  const s = read("server/aml-portal.ts");
  assert.match(s, /if \(request\.viaAgent && !String\(row\.contact_name \|\| ""\)\.trim\(\)\) \{/);
});

test("the AML box: the joint agent and the other side's agent are separate routes", () => {
  const box = read("client/src/components/deal-aml-status.tsx");
  assert.match(box, /<AskJointAgentButton dealId=\{dealId\} view=\{jointQ\.data\} party=\{askParty\} label="Joint agent" quiet \/>/);
  assert.match(box, /label=\{askAgentLabel\(askParty\)\}[^\n]*agent=\{theirAgent\} viaAgent \/>/);
  const joint = read("client/src/components/joint-agent-checks.tsx");
  assert.doesNotMatch(joint, /data-testid="joint-relation"/, "the joint agent's dialog asks the joint agent only");
  assert.doesNotMatch(joint, /agree on their page to BGP relying on them/);
});
