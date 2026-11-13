// The doors a deal can reach Solicitors through, and who may put the MLRO's
// sign-off on a deal. Review of 13 November 2026: the older Promote box, a
// deal saved with a new party and a new status together, and a deal made
// straight at Solicitors all got past the MLRO's block; a client login could
// start a deal already signed off. Checked against the source so a later
// change that reopens one fails here.
//   node --import tsx --test qa/regression/aml-gate-doors.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { route, source } = require('./source-harness.cjs');

process.env.DATABASE_URL ||= 'postgres://aml-test:aml-test@127.0.0.1:1/aml-test';
const { AML_HELD_FOR_CLIENT, amlGateOutcome } = await import('../../server/deal-gates.ts');

const before = (text, first, second, why) => {
  const a = text.indexOf(first), b = text.indexOf(second);
  assert.ok(a >= 0, `missing: ${first}`);
  assert.ok(b >= 0, `missing: ${second}`);
  assert.ok(a < b, why);
};

test('what a client is told when the block stops a deal names no party and no reason', () => {
  const blocked = amlGateOutcome({ hasCounterparties: true, notReady: [{ name: 'X Ltd', reason: 'rejected', role: 'tenant' }] }).block;
  assert.match(blocked, /X Ltd/);
  assert.doesNotMatch(AML_HELD_FOR_CLIENT, /X Ltd|reject|MLRO|tenant|landlord/i);
  assert.match(AML_HELD_FOR_CLIENT, /ask BGP/);
});

test('the Promote to Solicitors box: BGP staff only, gated before anything is written', () => {
  const promote = route('server/routes.ts', 'post', '/api/available-units/:id/create-deal');
  before(promote, 'isClientRequestUser(req)', 'storage.getAvailableUnit(', 'a client login must be refused before the unit is read');
  assert.match(promote, /if \(await isClientRequestUser\(req\)\) return res\.status\(403\)/);
  for (const write of ['storage.updateCrmDeal(', 'storage.createCrmDeal(', 'storage.updateAvailableUnit(']) {
    before(promote, 'checkCounterpartyAml(partiesToBe)', write, `the gate must run before ${write}`);
  }
  // The gate judges the parties the request will leave on the deal, and runs
  // for a move to Solicitors or for a party the deal does not already carry.
  assert.match(promote, /tenantId: body\.tenantId \|\| \(existingDeal as any\)\?\.tenantId \|\| null/);
  assert.match(promote, /if \(\(movingToSol \|\| namesNewParty\) && !mlroSignedOff\)/);
  assert.match(promote, /if \(outcome\.block\) \{\s*return res\.status\(409\)/);
});

test('the Promote box keeps an AML answer only from the MLRO, and records it', () => {
  const promote = route('server/routes.ts', 'post', '/api/available-units/:id/create-deal');
  assert.match(promote, /const signOffFromForm: string \| undefined = actor\.isMlro \? \(body\.amlChecked \|\| undefined\) : undefined;/);
  assert.match(promote, /amlCheckCompleted: signOffFromForm,/);
  assert.doesNotMatch(promote, /amlCheckCompleted: body\.amlChecked/, 'the form answer is written for anyone again');
  // The sign-off the deal will hold decides: the MLRO's answer here, else the stored one.
  assert.match(promote, /const mlroSignedOff = \(signOffFromForm \?\? signOffStored\) === "YES";/);
  assert.match(promote, /INSERT INTO deal_audit_log[^`]*'amlCheckCompleted'/);
  assert.match(promote, /INSERT INTO deal_audit_log[^`]*'status'/);
});

test('a new deal: no sign-off from a client, no KYC approval from anyone, and the gate before the deal is made', () => {
  const create = route('server/crm.ts', 'post', '/api/crm/deals');
  for (const field of ['kycApproved', 'kycApprovedAt', 'kycApprovedBy']) {
    before(create, `delete (req.body as any).${field};`, 'createDeal(req.body', `${field} must be dropped before the deal is made`);
  }
  before(create, 'if (dealScope) delete (req.body as any).amlCheckCompleted;', 'createDeal(req.body', 'a client login must not start a deal with AML check set');
  before(create, 'checkCounterpartyAml(', 'createDeal(req.body', 'the gate must run before the deal is made');
  // Only the MLRO's own YES lifts it.
  assert.match(create, /const signedOffByMlro = \(req\.body as any\)\.amlCheckCompleted === "YES" && \(await amlActor\(req\)\)\.isMlro;/);
  // The parties judged are the ones the deal will carry: a client's own
  // company as landlord, otherwise the form's. Not the property's landlord,
  // which a new deal is not given.
  assert.match(create, /landlordId: dealScope \|\| \(req\.body as any\)\.landlordId \|\| null/);
  assert.doesNotMatch(create, /landlord_id FROM crm_properties/);
  assert.match(create, /if \(dealScope\) return res\.status\(409\)\.json\(\{ error: AML_HELD_FOR_CLIENT, code: "AML_GATE_FAILED" \}\);/);
});

test('a deal save: the parties after the save are judged, before the save, and a client is not told who', () => {
  const save = route('server/crm.ts', 'put', '/api/crm/deals/:id');
  assert.match(save, /\(req\.body as any\)\[key\] !== undefined \? \(req\.body as any\)\[key\] : \(oldDeal as any\)\?\.\[key\]/);
  before(save, 'const amlResult = await checkCounterpartyAml(parties);', 'await updateDeal(req.params.id, req.body', 'the gate must run before the save');
  assert.match(save, /if \(editScope\) return res\.status\(409\)\.json\(\{ error: AML_HELD_FOR_CLIENT, code: "AML_GATE_FAILED" \}\);/);
  // Any change to the sign-off is the MLRO's.
  assert.match(save, /if \(!\(await amlActor\(req\)\)\.isMlro\) \{\s*return res\.status\(403\)\.json\(\{ error: "Only the MLRO can sign off a deal's AML \/ KYC", code: "MLRO_ONLY" \}\);/);
});

test('every other door a client can reach gives the same neutral line', () => {
  const patch = route('server/routes.ts', 'patch', '/api/available-units/:id');
  assert.match(patch, /heldForClient \? AML_HELD_FOR_CLIENT : denial\.error/);
  const bulk = route('server/crm.ts', 'post', '/api/crm/deals/bulk-update');
  assert.match(bulk, /reason: scope \? AML_HELD_FOR_CLIENT : outcome\.block/);
  assert.match(source('server/leasing-schedule.ts'), /error: heldForClient \? AML_HELD_FOR_CLIENT : denial\.error/);
});

test('the reply to a client\'s deal save or new deal goes through the one strip', () => {
  // Both used to answer with the whole stored row: fee terms and BGP's AML
  // working on the deal, in what the browser received.
  const save = route('server/crm.ts', 'put', '/api/crm/deals/:id');
  assert.match(save, /const saved = editScope \? stripDealFees\(deal as any\) : deal;/);
  assert.match(save, /res\.json\(mirrorWarning \|\| poWarning \? \{ \.\.\.saved, /);
  assert.doesNotMatch(save, /res\.json\([^\n]*\.\.\.deal\b/, 'the save reply spreads the unstripped deal again');
  assert.doesNotMatch(save, /res\.json\(deal\)/, 'the save reply sends the unstripped deal again');
  const create = route('server/crm.ts', 'post', '/api/crm/deals');
  assert.match(create, /res\.status\(201\)\.json\(dealScope \? stripDealFees\(deal as any\) : deal\);/);
});
