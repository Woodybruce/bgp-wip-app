// BGP's AML policy and risk assessment, Issue 2, in the app (Woody, 19
// November 2026: "can you consider these and add into the AML as required",
// "can we have that as a download", and his four answers the same day).
// Source guards; the rules are tested in server/aml-policy.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

test('the documents are kept with the app and served to BGP staff, outside the retired /api/aml/', () => {
  // Issue 5 of the policy and Issue 4 of the risk assessment (23 November 2026, the source of truth); earlier issues kept (policy M).
  for (const f of ['bgp-aml-policy-issue-5.docx', 'bgp-firm-wide-aml-risk-assessment-issue-4.docx', 'bgp-aml-policy-issue-4.docx', 'bgp-firm-wide-aml-risk-assessment-issue-3.docx', 'bgp-aml-policy-issue-3.docx', 'bgp-aml-policy-issue-2.docx', 'bgp-firm-wide-aml-risk-assessment-issue-2.docx']) {
    assert.ok(existsSync(`server/assets/aml-policy/${f}`), f);
  }
  const routes = read('server/aml-policy.ts');
  assert.match(routes, /router\.get\("\/api\/aml-policy\/documents\/:key"/);
  assert.match(routes, /const me = await staffMe\(req\)\.catch\(\(\) => null\);\n  if \(!me\) return res\.status\(403\)/);
  assert.match(routes, /if \(!me\.isAdmin\) return res\.status\(403\)\.json\(\{ message: "Only an admin sets the AML officers\." \}\);/);
  // The retired switch matches /api/aml/ and /api/aml exactly, never /api/aml-policy.
  const retired = /^\/api\/(aml|kyc-clouseau|sanctions|comply-advantage)(\/|$)/;
  assert.equal(retired.test('/api/aml-policy'), false);
  assert.equal(retired.test('/api/aml-policy/documents/policy-issue-2'), false);
  assert.match(read('server/index.ts'), /app\.use\(amlPolicyRouter\);/);
  assert.match(read('script/build.ts'), /server\/assets\/aml-policy/);
  // Saving the officers over an existing settings row: $1 is cast both times
  // ("inconsistent types deduced for parameter $1" without it, found in a
  // browser check on 19 November 2026).
  assert.match(routes, /nominated_officer_id = \$1::varchar,[\s\S]{0,200}IS DISTINCT FROM \$1::varchar THEN NOW\(\)/);
});

test('the Nominated Officer and the Deputy decide; the deal\'s agents sign off a standard party', () => {
  const aml = read('server/deal-party-aml.ts');
  // Sign-off: the officers or an agent on the deal (signOffActor); everything else: the officers (decider).
  const signOff = aml.slice(aml.indexOf('router.post("/api/deals/:id/parties/:role/sign-off"'), aml.indexOf('// A red flag set aside with a comment'));
  assert.match(signOff, /const me = await signOffActor\(req, party\);/);
  for (const route of ['red-flags/set-aside"', 'red-flags/put-back"', 'parties/:role/not-required"', 'parties/:role/not-required/undo"']) {
    const at = aml.indexOf(`router.post("/api/deals/:id/${route}`);
    assert.ok(at > 0, route);
    assert.match(aml.slice(at, at + 400), /const me = await decider\(req\);/, route);
  }
  assert.match(aml, /router\.post\("\/api\/deals\/:id\/parties\/:role\/kyc4u-result", deciderFirst, takeFiles/);
  const authority = read('server/aml-authority.ts');
  assert.match(authority, /export const DEPUTY_SETTING_KEY = "aml_deputy_officer";/);
  assert.match(read('shared/aml-policy.ts'), /if \(officers\.deputies\.some\(d => isOfficer\(d, user\)\)\) return \{ role: "deputy", appointed \};/);
  // More than one Deputy (Woody, 20 November 2026): saved as a list, the
  // escalation emails go to each, and Use the policy's officers is first
  // set-up only (it would put back the one Deputy the policy names).
  assert.match(authority, /const list = \[o\.nominated, \.\.\.o\.deputies\]/);
  const policyRoutes = read('server/aml-policy.ts');
  assert.match(policyRoutes, /const deputies = \{ deputies: ds\.map\(/);
  assert.match(policyRoutes, /if \(\(await amlOfficers\(\)\)\.nominated\) return res\.status\(409\)/);
});

test('approvals last the policy\'s years by level', () => {
  const aml = read('server/deal-party-aml.ts');
  assert.match(aml, /const years = RECHECK_YEARS\[level\];/);
  assert.match(aml, /"Re-check years": recheckYears/);
  assert.match(read('server/kyc4u.ts'), /recheckYears: kyc4uRecheckYears\(r\.fields\)/);
  assert.match(read('server/account-entities.ts'), /expiresAt\.setUTCFullYear\(expiresAt\.getUTCFullYear\(\) \+ years\);/);
});

test('Not required: stored per deal and party, read by the gate, the deal\'s approval and the dashboard', () => {
  assert.match(read('server/index.ts'), /CREATE TABLE IF NOT EXISTS kyc_party_exemptions \(/);
  const gate = read('server/deal-gates.ts');
  assert.match(gate, /const exempt = deal\.dealId \? await notRequiredOn\(String\(deal\.dealId\), deal\) : new Set<string>\(\);/);
  assert.match(gate, /if \(exempt\.has\(p\.role\) && state\.status !== "rejected"\) continue;/);
  assert.match(gate, /dealId: d\.id,\n      landlordId: d\.landlord_id,/);
  assert.match(read('server/aml-dashboard.ts'), /notRequired: markHolds,/);
  assert.match(read('server/aml-compliance.ts'), /const settled = \(c: any\) => \(c\.isApproved && !c\.isExpired\) \|\| !!c\.notRequired;/);
  // The marker holds only for the party it was set for.
  assert.match(read('server/aml-policy.ts'), /if \(partyByRole\[role\] && String\(partyByRole\[role\]\) === mark\.companyId\) roles\.add\(role\);/);
});

test('a deal that exchanges or completes with checks outstanding moves, and the officers are emailed once', () => {
  const gate = read('server/deal-gates.ts');
  assert.match(gate, /if \(code === "EXC" \|\| code === "COM"\) \{\n    await alertOfficersOfOutstandingChecks/);
  assert.match(gate, /event_type = 'aml_officer_alert' AND payload::jsonb ->> 'code' = \$2 LIMIT 1/);
  assert.doesNotMatch(gate.slice(gate.indexOf('async function alertOfficersOfOutstandingChecks'), gate.indexOf('export function formatAmlWarning')), /status: 409|throw /);
  // The red-flag alert copies the officers too, never on a test.
  assert.match(read('server/kyc-red-flags.ts'), /const officers = row\.is_test \? \[\] : await/);
});

test('heads of terms and marketing carry the AML notice', () => {
  assert.match(read('shared/unit-hots.ts'), /38\. Anti-money laundering\\n\$\{AML_HOTS_CLAUSE\}/);
  assert.match(read('server/unit-hots.ts'), /const isBgp37 = current === STANDARD_HOTS_TEMPLATE_37;/);
  assert.match(read('server/unit-info-sheet.ts'), /wrapText\(AML_MARKETING_NOTICE, font, 8\.5, pw - MARGIN \* 2\)/);
  assert.match(read('server/unit-share.ts'), /wrapText\(AML_MARKETING_NOTICE, font, 8\.5, contentW\)/);
  assert.match(read('marketing/src/lib/particulars-pdf.ts'), /Anti-money laundering: under the Money Laundering Regulations 2017/);
});

test('KYC4U is no longer used (23 November 2026), and never called BGP\'s MLRO on a screen or to ChatBGP', () => {
  for (const f of ['client/src/components/account-entities-panel.tsx', 'client/src/components/deal-party-aml.tsx',
    'client/src/components/deal-aml-status.tsx', 'shared/kyc-request.ts', 'server/chatbgp-app-map.ts']) {
    const userText = read(f).split('\n').filter(l => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(userText, /KYC4U[^.\n]{0,20}BGP's MLRO|BGP's MLRO[^.\n]{0,10}KYC4U|KYC4U are BGP's MLRO/, f);
  }
  assert.match(read('server/chatbgp.ts'), /KYC4U is no longer used \(since 23 November 2026\): enhanced due diligence is done in-house by the Nominated Officer or a Deputy/);
  assert.doesNotMatch(read('server/chatbgp.ts'), /name: "prepare_kyc4u_request"/, 'ChatBGP has no KYC4U request tool');
});

test('the client checks ask for the documents the policy lists, certified as it says', () => {
  const req = read('shared/kyc-request.ts');
  assert.match(req, /I have met the person concerned and confirm the likeness to the photo ID provided/);
  assert.match(req, /firearms or shotgun certificate/);
  assert.match(req, /council tax bill or mortgage statement dated in the last three months/);
  assert.match(req, /A structure chart up to the people at the top/);
});

// Risk assessment Issue 3: a super-prime price is weighed, never a red flag by itself.
// The transaction save still marked every sale or purchase of £1m or more for
// enhanced due diligence until 24 November 2026; a PEP still marks it.
test('the transaction save marks enhanced due diligence for a PEP, never for its price', () => {
  const crm = readFileSync(new URL('../../server/crm.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(crm, /eddReasons\.push\("super_prime"\)|superPrimeThreshold/);
  assert.match(crm, /if \(pepStatus && pepStatus !== "clear" && !oldDeal\?\.amlEddRequired\) \{\s*req\.body\.amlEddRequired = true;\s*req\.body\.amlEddReason = "pep";/);
  const flags = readFileSync(new URL('../../shared/kyc-red-flags.ts', import.meta.url), 'utf8');
  assert.match(flags, /if \(deal\.aml_edd_required && !deal\.aml_edd_completed_at && !eddMarkIsSuperPrimeOnly\(deal\.aml_edd_reason\)\) \{/);
});
