// The deal's AML box, 19 November 2026. Woody: "both being red flag for KYC4U
// but we havent got the actual company info? We must have the company taking
// the lease or who owns the property to be able to do a check. in this box we
// need to see the company info. We also need to see the detail of the
// redflag and have the option to ignore with a comment as comply advantage is
// picking up things that are not really a massive problem. Also API a problem
// on companies house?"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('every Companies House call waits its turn in one queue, and the checks wait longer', () => {
  const ch = read('server/companies-house.ts');
  const start = ch.indexOf('export async function chFetch(');
  const body = ch.slice(start, ch.indexOf('\n}\n', start));
  assert.match(body, /chGate\.request\(\(\) => fetch\(/, 'chFetch sends through the queue');
  assert.match(body, /chMaxWait\(opts\.maxWaitMs\)/);
  assert.match(body, /AbortSignal\.timeout\(/);
  const gate = read('server/companies-house-gate.ts');
  assert.match(gate, /x-ratelimit-remain/);
  assert.match(gate, /x-ratelimit-reset/);
  assert.match(gate, /answer\.status === 429/);
  const checks = read('server/kyc-prechecks.ts');
  assert.match(checks, /withChPatience\(CH_PATIENCE_MS, \(\) => readCompaniesHouse\(/);
  assert.match(checks, /chGate\.request\(\(\) => fetch\(`\$\{DOC_API_BASE\}\/document\//, 'the document downloads wait their turn too');
});

test('a check Companies House was too busy for runs again, a few times a day at most', () => {
  const checks = read('server/kyc-prechecks.ts');
  assert.match(checks, /if \(precheckUnfinished\(stored\.result\)\) return age < PRECHECK_RETRY_MINUTES \* 60_000;/);
  assert.match(checks, /runsToday\(companyId, entityId\)\) >= PRECHECK_AUTO_RUNS_A_DAY\) return "waiting"/);
});

test('no check runs on a company party until the deal names the company that signs', () => {
  const rules = read('shared/deal-parties.ts');
  // A trust needs no company that signs: its trustees sign (Jack, 20 November 2026).
  assert.match(rules, /if \(input\.kind === "company" && !input\.companySet && !input\.trust\) \{/);
  assert.doesNotMatch(rules, /brandHasNumber/, 'the brand\'s own number never stands in for the company that signs');
  const status = read('server/aml-compliance.ts');
  // A private individual, and since 21 November 2026 a trust or foundation, is checked on its own record.
  assert.match(status, /needsCompany: !signs\[c\.id\] && !signsItself\.has\(String\(c\.id\)\)/);
  assert.match(status, /aml_subject_type, ''\)\) IN \('individual', 'trust'\)/);
  const checks = read('server/kyc-prechecks.ts');
  assert.match(checks, /if \(needsCompany && !entityId\) \{\s*out\[companyId\] = \{ state: "needs_company"/);
  assert.match(checks, /!signs\[id\] && !signsItself\.has\(id\) \? "needs_company"/, 'Run again waits for the company too');
  const flags = read('server/kyc-red-flags.ts');
  assert.match(flags, /const pre = needsCompany \? null : prechecks\.find/);
  const board = read('server/aml-dashboard.ts');
  assert.match(board, /const pre = needsCompany \? null : prechecks\.find/);
  const portal = read('server/aml-portal.ts');
  // A trust or foundation is checked on its own record (21 November 2026).
  assert.match(portal, /if \(input\.kind === "company" && !party\.entityId && !party\.trust\) \{/, 'the client checks refuse it');
  const kyc4u = read('server/kyc4u.ts');
  assert.match(kyc4u, /if \(deal && partyRole && !entity\) \{/, 'the KYC4U request refuses it');
  const card = read('client/src/components/deal-aml-status.tsx');
  assert.match(card, /companyMissing\s*\?\s*<p[^>]*>The client checks and a KYC4U request start once the company that signs is set\./);
});

test('the brand\'s own company is offered, saved without a Xero contact, never assumed', () => {
  const parties = read('server/deal-parties.ts');
  assert.match(parties, /const brandOwn = kind === "company" && !company && brandNumber/);
  const billing = read('server/billing-entity.ts');
  assert.match(billing, /if \(req\.body\?\.xero === false\) \{\s*return res\.status/);
  const lines = read('client/src/components/deal-parties.tsx');
  assert.match(lines, /apiRequest\("POST", "\/api\/billing-entities", \{ brandId: pick\.brandId, companyNumber: pick\.number, xero: false \}\)/);
  // The brand's name and number never read as the company that signs.
  assert.doesNotMatch(lines, /companyWords\(\{ name: party\.brand\.name, companiesHouseNumber: party\.brand\.companiesHouseNumber \}\)/);
});

test('a flag is set aside only by the MLRO, with a comment, on the flag the app read', () => {
  const routes = read('server/deal-party-aml.ts');
  for (const route of ['/api/deals/:id/red-flags/set-aside', '/api/deals/:id/red-flags/put-back']) {
    const at = routes.indexOf(`router.post("${route}"`);
    assert.ok(at > 0, route);
    assert.match(routes.slice(at, at + 400), /const me = await decider\(req\);\s*if \(!\("id" in me\)\) return res\.status\(me\.status\)/, `${route} is the MLRO's`);
  }
  const flags = read('server/kyc-red-flags.ts');
  const start = flags.indexOf('export async function setFlagAside(');
  const body = flags.slice(start, flags.indexOf('\n}\n', start));
  assert.match(body, /const flag = live\.find\(f => f\.key === input\.key\);/, 'the flag is read again, never taken from the request');
  assert.match(body, /flag\.label\.slice\(0, 500\), flag\.source\.slice\(0, 500\), JSON\.stringify\(flag\.evidence\)/);
  assert.match(body, /'red_flag_set_aside'/, 'it is on the KYC audit trail');
  assert.match(routes, /dealAudit\(String\(req\.params\.id\), "aml_red_flag"/, 'and on the deal history');
  assert.match(flags, /AND \(company_id = ANY\(\$4::varchar\[\]\) OR \(company_id IS NULL AND deal_id = \$5\)\)/, 'only a decision about the deal\'s own parties is put back');
  const shared = read('shared/kyc-red-flags.ts');
  assert.match(shared, /const review = reviews\.find\(r => r\.flagKey === flag\.key && flag\.evidence\.every\(e => r\.evidence\.includes\(e\)\)\);/, 'new evidence raises a flag again');
});

test('a flag set aside counts nowhere: the deal card, KYC4U, the sign-off, the dashboard', () => {
  const flags = read('server/kyc-red-flags.ts');
  assert.match(flags, /const split = applyFlagReviews\(all, reviewsForParty\(reviews, id, signs\[id\] \|\| null\)\);\s*parties\[id\] = split\.live;/);
  assert.match(flags, /const dealSplit = applyFlagReviews\(dealRedFlags\(deal\), reviewsForDeal\(reviews, dealId\)\);/);
  const board = read('server/aml-dashboard.ts');
  // The flags that count also decide the party's level (BGP's AML policy, 19 November 2026).
  assert.match(board, /reviewsForParty\(reviews, p\.brandId, p\.entityId\)\)\.live;\n    const flags = live\.map\(f => f\.label\);/);
  assert.match(board, /applyFlagReviews\(dealRedFlags\(deal\), reviewsForDeal\(reviews, String\(deal\.id\)\)\)\.live/);
  // A record field whose flag is set aside does not make the file higher risk.
  const aml = read('server/deal-party-aml.ts');
  assert.match(aml, /aml_risk_level: aside\.has\("record:high_risk"\) \? null : held\.aml_risk_level/);
  const boot = read('server/index.ts');
  assert.match(boot, /CREATE TABLE IF NOT EXISTS kyc_flag_reviews \(/);
});

test('the AML box shows the company checked and the detail behind each flag', () => {
  const card = read('client/src/components/deal-aml-status.tsx');
  assert.equal((card.match(/<PartyCompanyFacts data=\{data\} companyId=\{cp\.id\} \/>/g) || []).length, 1, 'one party box for every layout');
  assert.match(card, /data-testid=\{`kyc-flag-detail-\$\{f\.key\}`\}/);
  assert.match(card, /\{canDecide && \(\s*<button[^>]*onClick=\{\(\) => setDialog\(f\)\}/, 'Set aside only for the MLRO');
  assert.match(card, /disabled=\{short \|\| save\.isPending\}/, 'a comment is needed');
});
