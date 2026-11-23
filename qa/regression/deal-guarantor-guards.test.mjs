// Guarantors (Woody, 23 November 2026, on Inception T2: "one is signing
// cornhill bar and the other is guaranteeing so should be able to allocate
// add as the guarantor") and the party box without its commentary ("we dont
// need this commnetry it should just wiork out what the contracting entity
// is"). Source guards: who may add one, what it may be, where its checks and
// people go, and what the party box sets by itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const parties = read('server/deal-parties.ts');
const guarantors = read('server/deal-guarantors.ts');
const index = read('server/index.ts');
const box = read('client/src/components/deal-parties.tsx');
const hots = read('client/src/components/deal-hots.tsx');
const amlBox = read('client/src/components/deal-aml-status.tsx');

const route = (start) => parties.slice(parties.indexOf(start), parties.indexOf('\nrouter.', parties.indexOf(start) + 10));

test('adding a guarantor: BGP staff, a company or person filed under the tenant or buyer, never the company that signs', () => {
  const add = route('router.post("/api/deals/:id/guarantors"');
  assert.match(add, /const me = await staffMe\(req\);\s*if \(!me\) return res\.status\(403\)/);
  assert.match(add, /if \(!isGuaranteedRole\(role\)\) return res\.status\(400\)/);
  assert.match(add, /entity\.parent_company_id !== brandId\) return res\.status\(400\)/);
  assert.match(add, /if \(entityId === text\(deal\[col\.company\]\)\) return res\.status\(400\)/);
  // One live row per guarantor; BGP's checks start on it at once; a history line.
  assert.match(add, /ON CONFLICT \(deal_id, role, entity_id\) WHERE removed_at IS NULL DO NOTHING/);
  assert.match(add, /startPrecheck\(brandId, \{ entityId, dealId: deal\.id, userId: me\.id \}\)/);
  assert.match(add, /audit\(pool, deal\.id, "guarantor"/);
  for (const r of ['router.delete("/api/deals/:id/guarantors/:guarantorId"', 'router.post("/api/deals/:id/guarantors/:guarantorId/checks"']) {
    assert.match(route(r), /const me = await staffMe\(req\);\s*if \(!me\) return res\.status\(403\)/);
  }
  // Taking one off keeps the row (removed_at), and says so on the history.
  assert.match(route('router.delete("/api/deals/:id/guarantors/:guarantorId"'), /SET removed_at = now\(\)/);
  // The table is a boot migration.
  assert.match(index, /CREATE TABLE IF NOT EXISTS deal_guarantors \(/);
  assert.match(index, /CREATE UNIQUE INDEX IF NOT EXISTS deal_guarantors_live_uq ON deal_guarantors \(deal_id, role, entity_id\) WHERE removed_at IS NULL/);
  // A merge repoints it.
  assert.match(read('server/brand-dedupe.ts'), /\{ table: "deal_guarantors",\s+column: "company_id" \}/);
});

test('a guarantor counts only while it is filed under the party and is not the company that signs', () => {
  assert.match(guarantors, /JOIN crm_trading_entities e ON e\.id = g\.entity_id AND e\.parent_company_id = g\.company_id/);
  assert.match(guarantors, /AND g\.company_id = \$\{brandCase\("d"\)\}/);
  assert.match(guarantors, /AND g\.entity_id IS DISTINCT FROM \$\{signerCase\("d"\)\}/);
  assert.match(guarantors, /g\.removed_at IS NULL/);
});

test('its flags join the party\'s on the transaction and the AML board; its people join the people to check; the sign-off waits for it', () => {
  assert.match(read('server/kyc-red-flags.ts'), /all\.push\(\.\.\.guarantorRedFlags\(\{ guarantor: \{ id: g\.entityId, name: g\.name \}/);
  assert.match(read('server/kyc-red-flags.ts'), /read\("the guarantors"/);
  assert.match(read('server/aml-dashboard.ts'), /withGuarantorFlags\(p, prechecks, withPayerFlags\(/);
  assert.match(read('server/kyc-people.ts'), /guarantorsForParty\(String\(party\.dealId\), party\.companyId\)/);
  assert.match(read('server/deal-party-aml.ts'), /guarantorChecks: await import\("\.\/deal-guarantors"\)/);
  // A guarantor that could not be read holds the sign-off, never lets it through.
  assert.match(read('server/deal-party-aml.ts'), /\.catch\(\(\) => \[\{ name: "the guarantors \(could not be read\)", state: "not_run" as const \}\]\)/);
  assert.match(read('server/aml-file.ts'), /guarantors: pv\?\.guarantors \|\| \[\]/);
});

test('the party box: a Guarantor button beside the brand\'s other companies, and no commentary', () => {
  assert.match(box, /data-testid=\{`deal-party-make-guarantor-\$\{c\.id\}`\}/);
  assert.match(box, /guarantor\.add\.mutate\(\{ role, companyId: c\.id \}\)/);
  // Find a guarantor at Companies House, or a person: never a Xero contact.
  assert.match(box, /\{party && guarantorFinding && \(\s*<CreateBillingEntityDialog[\s\S]*?xero=\{false\}/);
  // Woody, 23 November 2026: "we dont need this commnetry".
  assert.doesNotMatch(box, /a trust or a foundation, or acting as trustee\?/);
  assert.doesNotMatch(box, /The checks are about it, not/);
  assert.doesNotMatch(box, /Who signs, and who BGP asks for the checks/);
  assert.doesNotMatch(box, /often one of the people above/);
  assert.match(box, /if \(!party\.brand\.trustHint\) return null;/);
});

test('the contracting entity is worked out by itself: the lease company, or a certain heads of terms reading', () => {
  // The company on the unit's lease, once per transaction and party.
  assert.match(box, /if \(p\.company \|\| p\.offer\?\.why !== "lease" \|\| p\.brand\.recordTrust \|\| p\.brand\.recordIndividual\) continue;/);
  assert.match(box, /workedOut\.has\(key\)/);
  assert.match(amlBox, /useWorkOutSigningCompanies\(dealId, staffView \? parties : undefined\)/);
  // Heads of terms: only where certain, and never over a company that signs already.
  assert.match(hots, /if \(!p\.role \|\| !p\.brand \|\| p\.signing\) return false;/);
  assert.match(hots, /if \(p\.state === "filed"\) return !!p\.filed && hotsNamesClose\(p\.filed\.name, p\.read\.name\);/);
  assert.match(hots, /return p\.state === "register" && !!hit && hit\.agrees && !!p\.read\.number && !p\.numberIsAnother/);
  // A guarantor read from the heads of terms is a press, never set by itself.
  assert.match(hots, /data-testid="deal-hots-guarantor-set"/);
});
