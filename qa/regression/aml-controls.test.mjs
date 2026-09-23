import test from 'node:test';
import assert from 'node:assert/strict';
import { outstandingAmlItems, requiredAmlItems } from '../../shared/aml-checklist.ts';

process.env.DATABASE_URL ||= 'postgres://aml-test:aml-test@127.0.0.1:1/aml-test';
const { isNominatedOfficer } = await import('../../server/aml-authority.ts');
const { amlGateOutcome } = await import('../../server/deal-gates.ts');

test('only the nominated officer is the MLRO once one is appointed; admins act until then', () => {
  const settings = { nominated_officer_email: 'mlro@brucegillinghampollard.com' };
  assert.equal(isNominatedOfficer({ id: 'u1', email: 'MLRO@brucegillinghampollard.com' }, settings).isMlro, true);
  assert.equal(isNominatedOfficer({ id: 'u2', email: 'woody@brucegillinghampollard.com', is_admin: true }, settings).isMlro, false);
  assert.deepEqual(isNominatedOfficer({ id: 'u2', email: 'someone@brucegillinghampollard.com', is_admin: true }, {}), { isMlro: true, mlroAppointed: false });
  assert.equal(isNominatedOfficer({ id: 'u3', email: 'agent@brucegillinghampollard.com', is_admin: false }, {}).isMlro, false);
});

test('an individual does not need company items; EDD items only when EDD applies', () => {
  const ids = (xs) => xs.map(i => i.id);
  assert.ok(!ids(requiredAmlItems('individual', false)).includes('ubo_verified'));
  assert.ok(ids(requiredAmlItems('company', false)).includes('ubo_verified'));
  assert.ok(!ids(requiredAmlItems('company', false)).includes('sow_evidenced'));
  assert.ok(ids(requiredAmlItems('company', true)).includes('edd_complete'));
  const done = Object.fromEntries(requiredAmlItems('individual', false).map(i => [i.id, { ticked: true }]));
  assert.deepEqual(outstandingAmlItems(done, 'individual', false), []);
  assert.equal(outstandingAmlItems(done, 'company', false).length, 4);
});

test('incomplete CDD warns but never blocks a deal; a rejected counterparty blocks', () => {
  const pending = amlGateOutcome({ hasCounterparties: true, notReady: [{ name: 'Honest Greens', reason: 'in_review', role: 'tenant' }] });
  assert.equal(pending.block, null); assert.match(pending.warning, /Honest Greens/);
  assert.deepEqual(amlGateOutcome({ hasCounterparties: false, notReady: [] }).block, null);
  assert.match(amlGateOutcome({ hasCounterparties: true, notReady: [{ name: 'X Ltd', reason: 'rejected', role: 'landlord' }] }).block, /rejected by the MLRO/);
  assert.deepEqual(amlGateOutcome({ hasCounterparties: true, notReady: [] }), { block: null, warning: null });
});

test('a KYC4U-style high factor makes the client higher risk (Nominated Officer needed)', async () => {
  const { isHigherRisk, requiredAmlItems } = await import('../../shared/aml-checklist.ts');
  assert.equal(isHigherRisk({ aml_cdd_form: { riskFactors: { client: 'low', geographic: 'high', other: 'low' } } }), true);
  assert.equal(isHigherRisk({ aml_risk_level: 'low', aml_cdd_form: { riskFactors: { client: 'low', geographic: 'low' } } }), false);
  assert.ok(requiredAmlItems('company', false, true).some(i => i.id === 'mlro_review'));
  assert.ok(!requiredAmlItems('company', false, false).some(i => i.id === 'mlro_review'));
});

test('KYC4U form rows import into the KYC form, and the recommendation follows the file', async () => {
  const { parseKyc4uRows, recommend, overallRisk } = await import('../../server/aml-cdd-form.ts');
  const r = (row, A, B, C) => ({ row, cells: Object.fromEntries(Object.entries({ A, B, C }).filter(([, v]) => v !== undefined)) });
  const form = parseKyc4uRows([
    r(3, 'Party or counter-party checks', 'Party / Billing entity'), r(4, 'Work type', 'Letting'),
    r(7, 'Client risk indicators', undefined, 'Low'), r(8, 'Geographic risk indicators', undefined, 'High'), r(9, 'Other risk indicators', undefined, 'Low'),
    r(12, 'Authority to instruct', undefined, 'Instructed by company director'), r(13, 'Client background', undefined, 'Known 2 months, met face to face'),
    r(19, 'Details of client structure, ownership and evidence'), r(20, 'Name', 'Location', 'Org type'),
    r(21, 'Sample UK Ltd', 'UK', 'Limited company'), r(22, 'Sample Holdings LP', 'Canada', 'Limited Partnership'),
    r(26, "Details of Ultimate Beneficial Owners (UBO's)- Where required"), r(27, 'Name', 'Location', 'ID verification method'),
    r(28, 'Sample Owner', 'Mexico', 'ID Documents'),
    r(34, 'Detailed risk assessment'), r(35, 'Sample narrative.'), r(36, 'Recommendation '),
  ]);
  assert.equal(form.role, 'party'); assert.equal(form.workType, 'Letting');
  assert.deepEqual(form.riskFactors, { client: 'low', geographic: 'high', other: 'low' });
  assert.equal(form.ownershipChain.length, 2); assert.equal(form.ubos[0].idMethod, 'ID Documents');
  assert.equal(form.metFaceToFace, true); assert.equal(form.riskNarrative, 'Sample narrative.');
  assert.equal(overallRisk(form), 'high');
  assert.equal(recommend({ sanctionsMatch: false, rejected: false, outstanding: [], higherRisk: true, form }).verdict, 'recommend_with_conditions');
  assert.equal(recommend({ sanctionsMatch: true, rejected: false, outstanding: [], higherRisk: false, form }).verdict, 'do_not_recommend');
  assert.equal(recommend({ sanctionsMatch: false, rejected: false, outstanding: [], higherRisk: false, form: { ...form, ubos: [] } }).verdict, 'recommend');
});

test('pack files are sorted by type from their names', async () => {
  const { classifyPackFile, packEvidence } = await import('../../server/kyc-pack-intake.ts');
  assert.equal(classifyPackFile('Sample_-_Passport.pdf'), 'passport');
  assert.equal(classifyPackFile('Proof_of_Domicile.pdf'), 'proof_of_address');
  assert.equal(classifyPackFile('Delaware_Registry_Extract.pdf'), 'company_cert');
  assert.equal(classifyPackFile('Holdings_Public_Deed.pdf'), 'ubo_declaration');
  assert.equal(classifyPackFile('Source_of_Fund_Newly_Incorporated_Company.pdf'), 'source_of_funds');
  assert.equal(classifyPackFile('Sample_-_KYC_verification_form_Standard_1_1.xlsx'), 'kyc_form');
  assert.deepEqual(Object.keys(packEvidence(['passport', 'ubo_declaration'])).sort(), ['id_verified', 'ubo_identified', 'ubo_verified']);
});
