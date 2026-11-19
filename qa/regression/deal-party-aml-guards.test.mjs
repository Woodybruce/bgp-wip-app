// Step 2 of docs/deal-page-review-2026-11-18.md (Woody, 18 November 2026:
// "Ok go ahead with your suggestions I will do the requests"). Source guards:
// the AML gate reads the company that signs; BGP's sign-off and KYC4U's
// result are the MLRO's (admins while none is appointed) and checked before
// any file is read; a result about another legal company never touches the
// brand; the approval link asks for the sync's own permissions only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const gates = read('server/deal-gates.ts');
const aml = read('server/deal-party-aml.ts');
const kyc4u = read('server/kyc4u.ts');
const index = read('server/index.ts');
const compliance = read('server/aml-compliance.ts');
const crm = read('server/crm.ts');
const routes = read('server/routes.ts');

test('the gate reads the company that signs, and never the shadow table', () => {
  assert.match(gates, /FROM crm_entity_kyc/);
  assert.match(gates, /_trading_entity_id/);
  assert.doesNotMatch(gates, /crm_deal_entities/);
  // A company counts only when filed under the party's brand.
  assert.match(gates, /r\.parent_company_id === p\.brandId/);
  // A failed read of the companies' own checks is "no checks run", never approved.
  assert.match(gates, /FROM crm_entity_kyc[\s\S]{0,200}\.catch\(\(\) => \(\{ rows: \[\] as any\[\] \}\)\)/);
});

test('every place that runs the gate passes the deal or the companies in the save', () => {
  const callers = [...crm.matchAll(/checkCounterpartyAml\(\{[\s\S]*?\}\)/g)].map(m => m[0]);
  for (const c of callers) assert.match(c, /TradingEntityId|dealId/, c.slice(0, 120));
  assert.match(crm, /partyAfter\("tenantTradingEntityId"\)/);
  assert.match(crm, /dealId:\s+\(oldDeal as any\)\.id/);
  assert.match(routes, /dealId: \(existingDeal as any\)\?\.id \|\| null/);
  assert.match(routes, /dealId: \(deal as any\)\.id,/);
  assert.match(read('server/unit-hots.ts'), /dealId: deal\.id \}\)/);
  assert.match(read('server/deal-stages.ts'), /dealId:\s+c\.id/);
  assert.match(read('server/investment-tracker-service.ts'), /dealId: before\.dealId/);
});

test('sign-off and KYC4U\'s result are the MLRO\'s, BGP staff signed in as themselves', () => {
  assert.match(aml, /contactViewer\(req\)\)\.staff/);
  assert.match(aml, /amlActor\(req\)[\s\S]{0,120}if \(!actor\.isMlro\)/);
  const signOff = aml.slice(aml.indexOf('router.post("/api/deals/:id/parties/:role/sign-off"'), aml.indexOf('// KYC4U\'s result: who may add it'));
  assert.match(signOff, /const me = await decider\(req\);\s*if \(!\("id" in me\)\)/);
  assert.match(signOff, /signOffDenial\(\{ \.\.\.facts, note \}\)/);
  // Who may add KYC4U's result is checked before multer reads a file.
  assert.match(aml, /router\.post\("\/api\/deals\/:id\/parties\/:role\/kyc4u-result", deciderFirst, takeFiles,/);
  assert.match(index, /import dealPartyAmlRouter from "\.\/deal-party-aml";/);
  assert.match(index, /app\.use\(dealPartyAmlRouter\);/);
  const allowed = index.slice(index.indexOf('const CLIENT_ALLOWED_API = ['), index.indexOf('const CLIENT_ALLOWED_WRITES = ['));
  assert.doesNotMatch(allowed, /"\/api\/deals/);
  // The card is told who may decide, for BGP staff only.
  assert.match(compliance, /let decisions[\s\S]{0,200}if \(staff\)/);
});

test('a result about another legal company is filed on that company, never the brand', () => {
  assert.match(aml, /party\.entityId && !party\.sameCompany \? null : party\.brandId, party\.brandId, party\.entityId/);
  // The mirror's company pass writes the company's own record, not crm_companies.
  const pass = kyc4u.slice(kyc4u.indexOf('async function mirrorKyc4uCompanyStatuses'), kyc4u.indexOf('// ── KYC4U\'s documents'));
  assert.ok(pass.length > 200);
  assert.doesNotMatch(pass, /UPDATE crm_companies/);
  assert.match(pass, /approveEntityKyc\("trading_entity"/);
  assert.match(pass, /recomputeDealsForTradingEntity/);
  // The brand pass reads only rows matched to a brand.
  assert.match(kyc4u, /WHERE q\.company_id IS NOT NULL/);
  // The latest recorded result wins a tie on its date.
  assert.equal((kyc4u.match(/DESC NULLS LAST, q\.synced_at DESC NULLS LAST/g) || []).length, 2);
});

test('the approval link asks for the sync\'s permissions only, and the copy is read only and bounded', () => {
  const link = kyc4u.slice(kyc4u.indexOf('app.get("/api/kyc4u/admin-consent-link"'), kyc4u.indexOf('app.get("/api/kyc4u/callback"'));
  assert.match(link, /requireAuth, requireAdmin/);
  assert.doesNotMatch(link, /\.default/);
  assert.match(link, /\[\.\.\.SCOPES, "offline_access"\]/);
  assert.match(kyc4u, /const SCOPES = \["https:\/\/graph\.microsoft\.com\/Sites\.Read\.All", "https:\/\/graph\.microsoft\.com\/User\.Read"\]/);
  const copy = kyc4u.slice(kyc4u.indexOf('export async function copyKyc4uDocuments'), kyc4u.indexOf('export async function syncKyc4u'));
  assert.match(copy, /KYC4U_COPY_MAX_BYTES/);
  assert.match(copy, /budget <= 0/);
  assert.match(copy, /file_url LIKE \$1/);
  assert.doesNotMatch(copy, /method: "(POST|PUT|PATCH|DELETE)"/);
});
