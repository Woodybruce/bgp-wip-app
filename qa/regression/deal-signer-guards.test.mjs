// Another company that signs for the same party (Woody, 24 November 2026:
// "can we add 2 entities? maybe should disappear with just clear left and also
// add another entity"; then "yes"). Source guards: who may add one, what it
// may be, that guarantor and signer rows never mix, that the party reads
// cleared only once each signer is, and that the sign-off approves each one.
// Rules: server/deal-signer.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const parties = read('server/deal-parties.ts');
const guarantors = read('server/deal-guarantors.ts');
const gates = read('server/deal-gates.ts');
const box = read('client/src/components/deal-parties.tsx');

const route = (start) => parties.slice(parties.indexOf(start), parties.indexOf('\nrouter.', parties.indexOf(start) + 10) > 0
  ? parties.indexOf('\nrouter.', parties.indexOf(start) + 10) : parties.indexOf('export default router'));

test('adding another contracting entity: BGP staff, filed under the party, beside a contracting entity, never a guarantor', () => {
  const add = route('router.post("/api/deals/:id/signers"');
  assert.match(add, /const me = await staffMe\(req\);\s*if \(!me\) return res\.status\(403\)/);
  assert.match(add, /if \(!isSignerRole\(role\)\) return res\.status\(400\)/);
  assert.match(add, /if \(!text\(deal\[col\.company\]\)\) return res\.status\(400\)/, 'only beside a contracting entity');
  assert.match(add, /entity\.parent_company_id !== brandId\) return res\.status\(400\)/);
  assert.match(add, /if \(entityId === text\(deal\[col\.company\]\)\) return res\.status\(400\)/);
  assert.match(add, /if \(held\?\.kind === "guarantor"\) return res\.status\(409\)/);
  assert.match(add, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, 'signer'\)/);
  assert.match(add, /startPrecheck\(brandId, \{ entityId, dealId: deal\.id, userId: me\.id \}\)/);
  assert.match(add, /audit\(pool, deal\.id, "signer"/);
  for (const r of ['router.delete("/api/deals/:id/signers/:signerId"', 'router.post("/api/deals/:id/signers/:signerId/checks"']) {
    assert.match(route(r), /const me = await staffMe\(req\);\s*if \(!me\) return res\.status\(403\)/);
  }
  // Each route touches its own kind of row only.
  assert.match(route('router.delete("/api/deals/:id/signers/:signerId"'), /COALESCE\(g\.kind, 'guarantor'\) = 'signer'/);
  assert.match(route('router.delete("/api/deals/:id/guarantors/:guarantorId"'), /COALESCE\(g\.kind, 'guarantor'\) = 'guarantor'/);
  assert.match(route('router.post("/api/deals/:id/guarantors"'), /if \(held\?\.kind === "signer"\) return res\.status\(409\)/);
  assert.match(guarantors, /AND COALESCE\(g\.kind, 'guarantor'\) = \$2/);
  assert.match(read('server/index.ts'), /ALTER TABLE deal_guarantors ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'guarantor'/);
});

test('the party reads cleared only once each other contracting entity is, and the sign-off approves each one', () => {
  assert.match(gates, /m\.signerApprovals\(dealIds, q as any\)\)\.catch\(\(\) => null\)/);
  assert.match(gates, /signers === null \? \["the other contracting entities \(could not be read\)"\]/, 'a failed read is never read as approved');
  assert.match(gates, /out\[p\.role\] = applySigners\(applyCheckScope\(partyKycState\(/);
  assert.match(gates, /checkCounterpartyAml[\s\S]{0,900}dealId: deal\.dealId \|\| null/);
  assert.match(gates, /OR id IN \(SELECT deal_id FROM deal_guarantors WHERE entity_id = \$1 AND removed_at IS NULL AND COALESCE\(kind, 'guarantor'\) = 'signer'\)/);
  for (const f of ['server/aml-dashboard.ts', 'server/aml-file.ts', 'server/aml-compliance.ts', 'server/deal-party-aml.ts']) {
    assert.match(read(f), /loadPartyKyc\([\s\S]{0,400}dealId/, `${f} passes the transaction`);
  }
  const signOff = read('server/deal-party-aml.ts');
  assert.match(signOff, /signerChecks: !party\.dealId \? \[\]/);
  assert.match(signOff, /for \(const g of others\) \{\s*await approveEntityKyc\("trading_entity", g\.entityId/);
});

test('its red flags join the party on the transaction and the AML board', () => {
  assert.match(read('server/kyc-red-flags.ts'), /all\.push\(\.\.\.signerRedFlags\(\{ signer: \{ id: g\.entityId, name: g\.name \}/);
  assert.match(read('server/aml-dashboard.ts'), /applyFlagReviews\(withSignerFlags\(p, prechecks, withGuarantorFlags/);
  assert.match(read('server/kyc-people.ts'), /m\.signersForParty\(String\(party\.dealId\), party\.companyId\)/);
});

test('a filed contracting entity or guarantees a transaction is not deleted (the guard read the wrong column until 24 November 2026)', () => {
  const crm = read('server/crm.ts');
  assert.match(crm, /FROM deal_guarantors WHERE entity_id = \$1 AND removed_at IS NULL AND COALESCE\(kind, 'guarantor'\) = 'guarantor'/);
  assert.match(crm, /FROM deal_guarantors WHERE entity_id = \$1 AND removed_at IS NULL AND kind = 'signer'/);
  assert.doesNotMatch(crm, /FROM deal_guarantors WHERE trading_entity_id/);
});

test('the party box: Another company signs too beside the chosen company, with its own finder', () => {
  assert.match(box, /data-testid="deal-party-add-signer">\s*<Plus className="w-3\.5 h-3\.5 mr-1" \/>Another company signs too/);
  assert.match(box, /\{party\.company && !changingCompany && !hotsOpen && \(\s*<div className="space-y-1\.5" data-testid=\{`deal-party-signers-\$\{role\}`\}>/);
  assert.match(box, /if \(!o && !finding && !hotsOpen && !guarantorFinding && !signerFinding\) onClose\(\);/, 'the finder never closes the party box');
  assert.match(box, /const base = `\/api\/deals\/\$\{dealId\}\/\$\{kind === "signer" \? "signers" : "guarantors"\}`;/);
  assert.match(box, /<PartyRow label="Also signs" testId=\{`deal-party-row-signers-\$\{role\}`\}>/);
  assert.doesNotMatch(box, /<form/);
});
