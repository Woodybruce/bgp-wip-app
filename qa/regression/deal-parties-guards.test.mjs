// Each deal party's company that signs and the person to ask (Woody,
// 18 November 2026: "most importantly adding the billing entities so can
// AML"). Source guards: who may reach it, every deal save keeps the company
// under its party, the checks before asking, the client checks and the
// KYC4U request read it, and the brand's own screens stay on the brand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const parties = read('server/deal-parties.ts');
const index = read('server/index.ts');
const letting = read('server/letting-service.ts');
const crm = read('server/crm.ts');
const landsec = read('shared/landsec.ts');
const prechecks = read('server/kyc-prechecks.ts');
const flags = read('server/kyc-red-flags.ts');
const portal = read('server/aml-portal.ts');
const kyc4u = read('server/kyc4u.ts');
const compliance = read('server/aml-compliance.ts');

test('the party routes are BGP staff only and mounted', () => {
  assert.match(parties, /async function staffMe\(req: Request\)[\s\S]*contactViewer\(req\)\)\.staff/);
  for (const route of ['router.get("/api/deals/:id/parties"', 'router.put("/api/deals/:id/parties/:role"', 'router.post("/api/deals/:id/parties/:role/person"', 'router.post("/api/deals/:id/parties/:role/owner"']) {
    const body = parties.slice(parties.indexOf(route), parties.indexOf('});', parties.indexOf(route)));
    assert.ok(parties.includes(route), route);
    assert.match(body, /await staffMe\(req\)/, `${route} checks for staff first`);
  }
  assert.match(index, /import dealPartiesRouter from "\.\/deal-parties";/);
  assert.match(index, /app\.use\(dealPartiesRouter\);/);
  // Not on the client gateway's list: a client login is refused before the route.
  const allowed = index.slice(index.indexOf('const CLIENT_ALLOWED_API = ['), index.indexOf('const CLIENT_ALLOWED_WRITES = ['));
  assert.doesNotMatch(allowed, /"\/api\/deals/);
});

test('a company and a person are set only from under the party\'s own brand', () => {
  const put = parties.slice(parties.indexOf('router.put("/api/deals/:id/parties/:role"'), parties.indexOf('router.post("/api/deals/:id/parties/:role/person"'));
  assert.match(put, /row\.parent_company_id !== brandId/);
  assert.match(put, /row\.company_id !== brandId/);
  assert.match(put, /isDealPartyRole\(role\)/);
  // Every change is a line on the deal's history.
  assert.match(put, /await audit\(pool, deal\.id, field/);
  const post = parties.slice(parties.indexOf('router.post("/api/deals/:id/parties/:role/person"'));
  assert.match(post, /newPartyPerson\(req\.body\)/);
  assert.match(post, /findOrAddPartyPerson\(pool, brandId/);
  // A CRM contact gains blank fields only.
  const find = parties.slice(parties.indexOf('export async function findOrAddPartyPerson'), parties.indexOf('async function audit('));
  assert.match(find, /personFill\(held, typed\)/);
  assert.match(find, /WHERE company_id = \$1 AND lower\(email\) = \$2/);
});

test('every deal save keeps the company that signs under its party', () => {
  const create = letting.slice(letting.indexOf('export async function createDeal'), letting.indexOf('export async function updateDeal'));
  assert.match(create, /checkPartyCompanies\(db, parsed as Record<string, any>, body\)/);
  const update = letting.slice(letting.indexOf('export async function updateDeal'));
  assert.match(update, /checkPartyCompanies\(db, \{ \.\.\.\(before \|\| \{\}\), \.\.\.body \}, changed\)/);
  assert.ok(update.indexOf('checkPartyCompanies') < update.indexOf('storage.updateCrmDeal'), 'checked before the write');
  // A refusal reads as a 400 on the deal save.
  assert.match(crm, /res\.status\(e\?\.name === "PartyCompanyRefusal" \? 400 : 500\)/);
});

test('clients and joint agents neither read nor write the company that signs', () => {
  const hidden = crm.slice(crm.indexOf('const CLIENT_HIDDEN_DEAL_AML = ['), crm.indexOf('] as const;', crm.indexOf('const CLIENT_HIDDEN_DEAL_AML = [')));
  for (const f of ['landlordTradingEntityId', 'tenantTradingEntityId', 'vendorTradingEntityId', 'purchaserTradingEntityId']) assert.ok(hidden.includes(`"${f}"`), f);
  const ja = landsec.slice(landsec.indexOf('export const JOINT_AGENT_HIDDEN_DEAL_FIELDS = ['), landsec.indexOf('] as const;', landsec.indexOf('export const JOINT_AGENT_HIDDEN_DEAL_FIELDS = [')));
  for (const f of ['landlord_trading_entity_id', 'tenant_trading_entity_id', 'tenant_entity_id', 'tenant_entity_name', 'purchaser_entity_name']) assert.ok(ja.includes(`"${f}"`), f);
});

test('the columns are added at boot, nullable', () => {
  for (const sql of [
    'ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS landlord_trading_entity_id VARCHAR',
    'ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS tenant_trading_entity_id VARCHAR',
    'ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS vendor_trading_entity_id VARCHAR',
    'ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS purchaser_trading_entity_id VARCHAR',
    'ALTER TABLE kyc_investigations ADD COLUMN IF NOT EXISTS trading_entity_id VARCHAR',
    'ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS trading_entity_id VARCHAR',
    'ALTER TABLE kyc_upload_tokens ADD COLUMN IF NOT EXISTS trading_entity_id VARCHAR',
  ]) assert.ok(index.includes(sql), sql);
});

test('the checks before asking read the company that signs, never writing to the brand', () => {
  assert.match(prechecks, /AND trading_entity_id IS NOT DISTINCT FROM \$2/);
  assert.match(prechecks, /const partyKey = \(companyId: string, entityId\?: string \| null\)/);
  // The brand-page lookup (which writes the brand's number) is never run for the company that signs.
  assert.match(prechecks, /if \(!number && !entity && subjectKind === "company" && process\.env\.COMPANIES_HOUSE_API_KEY\)/);
  assert.match(prechecks, /WHERE id = \$1 AND parent_company_id = \$2/);
  // Its run and its documents say which company they are about.
  assert.match(prechecks, /INSERT INTO kyc_investigations \(subject_type, subject_name, company_number, crm_company_id, trading_entity_id,/);
  assert.match(prechecks, /INSERT INTO kyc_documents \(company_id, trading_entity_id, deal_id,/);
  // Its accounts come from its own filing history, not the brand's stored ones.
  assert.match(prechecks, /pickLatestAccountsFiling\(history\?\.items \|\| \[\]/);
  assert.match(prechecks, /fetchLatestAccountsForCompany\(companyId\)/);
  // The status route and Run again pass the deal's companies.
  assert.match(compliance, /dealPartyCompanies\(pool, d\.id\)/);
  assert.match(compliance, /entityId: signs\[c\.id\] \|\| null/);
  assert.match(prechecks, /entityId: signs\[id\] \|\| null/);
});

test('the brand\'s own screens stay on the brand\'s own checks', () => {
  const cdd = read('server/aml-cdd-form.ts');
  assert.equal((cdd.match(/FROM kyc_investigations WHERE crm_company_id=\$1 AND trading_entity_id IS NULL/g) || []).length, 4);
  assert.match(read('server/kyc-orchestrator.ts'), /crm_company_id = \$1 AND trading_entity_id IS NULL/);
  assert.match(read('server/brand-profile.ts'), /WHERE crm_company_id = \$1 AND trading_entity_id IS NULL/);
  // Red flags take the party's own row.
  assert.match(flags, /DISTINCT ON \(crm_company_id, trading_entity_id\)/);
  assert.match(flags, /\(r\.trading_entity_id \|\| null\) === \(signs\[id\] \|\| null\)/);
});

test('the client checks and the KYC4U request name the company and the person', () => {
  const parties2 = portal.slice(portal.indexOf('async function dealParties'), portal.indexOf('export async function createClientCheck'));
  assert.match(parties2, /name: entity\?\.name \|\| c\.name/);
  assert.match(parties2, /client\?\.company_id === companyId \? d\.client_contact_id : null/);
  const create = portal.slice(portal.indexOf('export async function createClientCheck'), portal.indexOf('// ── What the agents see on the deal'));
  assert.match(create, /partyAskInput\(party\.companyId, party\.entityId\)/);
  // Someone typed is saved to the CRM, and made the person to ask when nobody is.
  assert.match(create, /findOrAddPartyPerson\(pool, party\.companyId/);
  assert.match(create, /WHERE id = \$1 AND \$\{party\.personField\} IS NULL RETURNING id/);
  assert.match(create, /request, is_test, trading_entity_id\)/);
  // The client's own uploads are filed on the same company.
  assert.match(portal, /INSERT INTO kyc_documents \(company_id, trading_entity_id, contact_id, deal_id,/);
  // KYC4U: the company that signs as the party, its documents only, its checks.
  assert.match(kyc4u, /partyName: entity\?\.name \|\| company\.uk_entity_name \|\| company\.name/);
  assert.match(kyc4u, /\$2::varchar IS NULL OR trading_entity_id IS NULL OR trading_entity_id = \$2/);
  assert.match(kyc4u, /startPrecheck\(companyId, \{ dealId: dealId \|\| null, userId, entityId \}\)/);
  assert.match(kyc4u, /Contracting company: \$\{entity\.name\}/);
});

test('the deal page and the deal form carry it', () => {
  const page = read('client/src/components/deal-detail.tsx');
  // One block per party (19 November 2026), each with its lines.
  assert.ok(page.includes('{slot.value && <DealPartyLines dealId={id} role={slot.role} aml={partyAmlFacts(amlStatus, slot.value)} />}'));
  for (const role of ['landlord', 'tenant', 'vendor', 'purchaser']) assert.ok(page.includes(`role: "${role}" as const`), role);
  const card = read('client/src/components/deal-aml-status.tsx');
  // On both layouts of the card, hidden once the party is approved (step 2, 18 November 2026)
  // or marked Not required (BGP's AML policy, 19 November 2026).
  assert.ok(card.includes('{staffView && !(cp.isApproved && !cp.isExpired) && !cp.notRequired && <PartyReadyToStart dealId={dealId} companyId={cp.id} aml={partyAmlFacts(data, cp.id)} />}'));
  assert.ok(card.includes('{staffView && status !== "approved" && status !== "not_required" && <PartyReadyToStart dealId={dealId} companyId={cp.id} aml={partyAmlFacts(data, cp.id)} />}'));
  const form = read('client/src/pages/deals.tsx');
  for (const role of ['landlord', 'tenant', 'vendor', 'purchaser']) {
    assert.ok(form.includes(`...(company ? { ${role}TradingEntityId: company.id } : {}),`), `${role} billing box sets the company`);
    assert.ok(form.includes(`set("${role}TradingEntityId", "");`), `${role} change clears it`);
    assert.ok(form.includes(`${role}TradingEntityId: form.${role}TradingEntityId || null,`), `${role} saved`);
  }
  assert.match(form, /<PartyReadyToStart dealId=\{amlStep\.dealId\} companyId=\{p\.id\} aml=\{partyAmlFacts\(amlStepStatus, p\.id\)\} \/>/);
});

// Woody, 20 November 2026: "here where it says who to ask it should really
// say these owners need to AML and prompt for contact details at that stage
// ... make sure this form is consistant where dealks are added or converted".
test('the owners the checks need are named in the party box, with their contact details asked for', () => {
  const route = parties.slice(parties.indexOf('router.post("/api/deals/:id/parties/:role/owner"'), parties.indexOf('export default router'));
  assert.ok(route.length > 100, 'the owner route exists');
  // The person is one of the party's people to check, found by their key: never a name the request types.
  assert.match(route, /partyPeopleFor\(/);
  assert.match(route, /people\?\.people\.find\(p => p\.key === key\)/);
  assert.match(route, /const name = personDisplayName\(who\.name\)/);
  assert.doesNotMatch(route, /req\.body\?\.name/);
  // Saved on the contact that is them, blank fields only; else a new contact under the brand.
  assert.match(route, /ownerContactMatch\(/);
  assert.match(route, /personFill\(held, typed\.person\)/);
  assert.match(route, /findOrAddPartyPerson\(pool, brandId,/);
  assert.match(route, /FROM crm_contacts WHERE company_id = \$1/);
  // It does not change who to ask, and it is on the deal's history.
  assert.doesNotMatch(route, /UPDATE crm_deals/);
  assert.match(route, /await audit\(pool, deal\.id, "aml_person_contact"/);

  const box = read('client/src/components/deal-parties.tsx');
  // One box everywhere: the Parties card, the AML box and the Kick off AML step all draw the line and open the same editor.
  for (const fn of ['export function DealPartyLines', 'export function PartyReadyToStart']) {
    const body = box.slice(box.indexOf(fn), box.indexOf('\nexport function', box.indexOf(fn) + 10));
    assert.match(body, /usePartyPeople\(dealId, party\)/, `${fn} reads the people`);
    assert.match(body, /<PeopleToReachLine party=\{party\} people=\{people\} aml=\{aml\}/, `${fn} names who to reach`);
    assert.match(body, /<DealPartyEditor [^>]*aml=\{aml\}/, `${fn} opens the editor with the facts`);
  }
  const editor = box.slice(box.indexOf('export function DealPartyEditor'));
  assert.ok(editor.indexOf('deal-party-people-section') < editor.indexOf('deal-party-person-section'), 'the people the checks need come before who to ask');
  assert.match(editor, /<PartyPeopleToCheck [^>]*aml=\{aml\}/);
  // Nothing is asked of anyone once a party is approved, marked Not required, or on a letting that asks no one.
  assert.match(box, /if \(!aml \|\| quietWords\(aml\) \|\| !people/);
  assert.match(box, /const needs = !quiet && person\.outstanding\.length > 0 && !person\.own;/);

  // Each caller passes what the deal's AML status says about the party.
  const amlBox = read('client/src/components/deal-aml-status.tsx');
  assert.equal((amlBox.match(/<PartyReadyToStart dealId=\{dealId\} companyId=\{cp\.id\} aml=\{partyAmlFacts\(data, cp\.id\)\} \/>/g) || []).length, 2);
  const dealForm = read('client/src/pages/deals.tsx');
  assert.match(dealForm, /<PartyReadyToStart dealId=\{amlStep\.dealId\} companyId=\{p\.id\} aml=\{partyAmlFacts\(amlStepStatus, p\.id\)\} \/>/);
  const dealPage = read('client/src/components/deal-detail.tsx');
  assert.match(dealPage, /useDealAmlStatus\(dealId, !isClientDeal\)/);
  assert.match(dealPage, /<DealPartyLines dealId=\{id\} role=\{slot\.role\} aml=\{partyAmlFacts\(amlStatus, slot\.value\)\} \/>/);
});
