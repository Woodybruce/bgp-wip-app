// Client KYC with no transaction (Woody, 24 November 2026: "Yes build it
// within companies and show in the CRM boards and we will want to be able to
// aml all the sub companies within each company ... and use those for xero
// invoicing too"). Source guards; the rules are tested in
// server/client-kyc.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("the client file's routes are BGP staff only, and outside the retired AML addresses", () => {
  const s = read("server/client-kyc.ts");
  const routes = [...s.matchAll(/clientKycRouter\.(get|post)\("([^"]+)"/g)].map(m => m[2]);
  assert.ok(routes.length >= 8, "the file, open, checks, bulk checks, sign-off and red flags");
  for (const r of routes) assert.match(r, /^\/api\/client-kyc\//, r);
  // Never under /api/kyc/ or /api/aml/: those answer 410 while the old in-app AML is off.
  const index = read("server/index.ts");
  assert.match(index, /\/\^\\\/api\\\/kyc\\\/\(\?!deal/, "the retired /api/kyc/ pattern still stands");
  assert.doesNotMatch(s, /"\/api\/(kyc|aml)\//);
  // Every route reads who is asking first: staff, or the officers.
  for (const block of s.split("clientKycRouter.").slice(1)) {
    assert.match(block.slice(0, 600), /staffMe\(req\)|decider\(req\)|signOffActor\(req|clientSubjectFor\(req, res\);\s*if \(!subject\) return;\s*const me = await signOffActor|=> clientFlagDecision\(req, res, (true|false)\)\);/, block.slice(0, 120));
  }
  // Confirm and set aside share one handler, which reads the officers first (25 November 2026).
  const decision = s.slice(s.indexOf("async function clientFlagDecision"));
  assert.match(decision.slice(0, 400), /const me = await decider\(req\);/);
  assert.match(index, /app\.use\(clientKycRouter\);/);
});

test("the sign-off writes the approval every transaction reads, for the policy's period, and closes the file", () => {
  const s = read("server/client-kyc.ts");
  const signOff = s.slice(s.indexOf('"/api/client-kyc/:companyId/subjects/:entity/sign-off"'));
  assert.match(signOff, /const denial = signOffDenial\(\{ \.\.\.facts, note \}\);/);
  assert.match(signOff, /Enhanced due diligence is signed off by the Nominated Officer or a Deputy/);
  assert.match(signOff, /const years = RECHECK_YEARS\[level\];/);
  assert.match(signOff, /approveEntityKyc\("trading_entity", subject\.entityId, me\.name, \{[\s\S]{0,200}recheckYears: years/);
  assert.match(signOff, /recomputeDealsForTradingEntity\(subject\.entityId/);
  assert.match(signOff, /await approveBrand\(subject, me, line, years\);/);
  assert.match(signOff, /UPDATE kyc_client_files SET closed_at = now\(\)/);
  // Only an ordinary company's checks need a sub company: a person, trust or public body is checked on its own record.
  assert.match(s, /if \(!e && !recordIsOwnSubject\(c\.aml_subject_type\)\) return null;/);
  // Full checks unless the company is set to sanctions checks only (the Companies view's switch, 24 November 2026).
  assert.match(s, /regime: \(await companySanctionsOnly\(db, companyId\)\.catch\(\(\) => \(\{ on: false \}\)\)\)\.on \? "sanctions_only" : "full"/);
});

test("the client checks, people, documents, translation and owners abroad answer for a client file too", () => {
  const portal = read("server/aml-portal.ts");
  for (const sub of ["", "/people", "/people/rename", "/address-proof/read", "/address-proof/accept"]) {
    assert.ok(portal.includes(`"/api/client-kyc/:companyId/subjects/:entity/client-checks${sub}"`), sub || "client-checks");
  }
  assert.match(portal, /if \(scope\.client && parsed\.data\.viaAgent\) return res\.status\(400\)/, "BGP's own client is never asked through an agent");
  assert.match(portal, /export async function clientFileParties\(companyId: string, entityId: string \| null\)/);
  // A client file's request copies the account's own BGP people.
  assert.match(portal, /const agentsFor = \(dealId: string \| null, companyId: string\) => \(dealId \? dealAgents\(dealId\) : clientFileAgents\(companyId\)\);/);
  // Reminders chase a client file as they chase a live transaction.
  assert.match(portal, /AND \(kyc_upload_tokens\.deal_id IS NULL\s+OR EXISTS \(SELECT 1 FROM crm_deals d WHERE d\.id = kyc_upload_tokens\.deal_id/);
  const docs = read("server/kyc-documents.ts");
  assert.match(docs, /"\/api\/client-kyc\/:companyId\/subjects\/:entity\/documents"/);
  assert.match(read("server/kyc-translation.ts"), /"\/api\/client-kyc\/:companyId\/subjects\/:entity\/documents\/:docId\/translate"/);
  assert.match(read("server/kyc-abroad.ts"), /"\/api\/client-kyc\/:companyId\/subjects\/:entity\/abroad\/person"/);
  assert.match(read("server/deal-party-aml.ts"), /"\/api\/client-kyc\/:companyId\/subjects\/:entity\/public-figure"/);
});

test("a client file's requests are its own: no transaction, that company and sub company", () => {
  const people = read("server/kyc-people.ts");
  assert.match(people, /WHERE deal_id IS NULL AND company_id = \$1 AND \(\$2::boolean OR trading_entity_id IS NOT DISTINCT FROM \$3::varchar\)/);
  const flags = read("server/kyc-red-flags.ts");
  // A transaction also reads its contracting entities' client file requests (25 November 2026).
  assert.match(flags, /WHERE \(deal_id IS NOT DISTINCT FROM \$1::varchar OR deal_id IS NULL\) AND company_id = ANY\(\$2::varchar\[\]\)/);
  assert.match(flags, /const deal = !dealId \? null :/);
  const sign = read("server/deal-party-aml.ts");
  assert.match(sign, /guarantorChecks: !party\.dealId \? \[\] :/);
  assert.match(sign, /WHERE \(\(\(deal_id IS NOT DISTINCT FROM \$1::varchar OR deal_id IS NULL\) AND company_id = \$2 AND trading_entity_id IS NOT DISTINCT FROM \$3\)/);
});

test("the schema: a client file table, and requests that need no transaction", () => {
  const index = read("server/index.ts");
  assert.match(index, /CREATE TABLE IF NOT EXISTS kyc_client_files \(/);
  assert.match(index, /CREATE UNIQUE INDEX IF NOT EXISTS kyc_client_files_open_idx ON kyc_client_files \(company_id, COALESCE\(trading_entity_id, ''\)\) WHERE closed_at IS NULL/);
  assert.match(index, /ALTER TABLE kyc_upload_tokens ALTER COLUMN deal_id DROP NOT NULL/);
  assert.match(index, /ALTER TABLE kyc_upload_files ALTER COLUMN deal_id DROP NOT NULL/);
});

test("a sub company is linked to Xero once, by BGP staff, and invoices follow it", () => {
  const b = read("server/billing-entity.ts");
  const route = b.slice(b.indexOf('app.post("/api/billing-entities/:entityId/xero"'));
  assert.ok(route.length > 0);
  assert.match(route.slice(0, 600), /isClientRequestUser\(req\)\)\s*\|\|\s*\(await resolveCompanyScope\(req\)\)\) return res\.status\(403\)/);
  assert.match(route, /UPDATE crm_trading_entities SET xero_contact_id = \$2, xero_contact_name = \$3 WHERE id = \$1/);
});

test("the company page: a KYC box per company, several checked at once, a company added", () => {
  const panel = read("client/src/components/account-entities-panel.tsx");
  assert.match(panel, /data-testid=\{`entity-kyc-\$\{e\.entityId\}`\}/);
  assert.match(panel, /data-testid="entities-run-checks"/);
  assert.match(panel, /data-testid="entities-link-xero"/);
  assert.match(panel, /data-testid="entities-add-company"/);
  assert.match(panel, /<ClientKycDialog companyId=\{kycFor\.client\.companyId\}/);
  const dialog = read("client/src/components/client-kyc/client-kyc-dialog.tsx");
  assert.match(dialog, /<AmlUrlsProvider urls=\{urls\}>/, "the transaction screens, pointed at the client file");
  assert.doesNotMatch(dialog, /<form[\s>]/, "no form element in a dialog");
  // Not behind Show more: its own card on a landlord's People & checks, and on the phone pages too (staff only).
  assert.match(read("client/src/components/brand-profile-panel.tsx"), /\{!isClientViewer && <AccountEntitiesPanel companyId=\{companyId\} \/>\}/);
  const phone = read("client/src/components/mobile-brand-view.tsx");
  assert.match(phone, /\{!isClientViewer && <AccountEntitiesPanel companyId=\{companyId\} \/>\}/);
  assert.match(phone, /\{brandPage && !isClientViewer && <AccountEntitiesPanel companyId=\{companyId\} hideSingleEntity \/>\}/);
  for (const f of ["client/src/components/kyc-client-checks.tsx", "client/src/components/kyc-documents.tsx"]) {
    const s = read(f);
    assert.doesNotMatch(s, /`\/api\/aml\/deal\/\$\{dealId\}|`\/api\/deals\/\$\{dealId\}\/parties/, `${f} reads its addresses from the context`);
  }
});

test("the CRM boards show each company's KYC and filter what is still to do", () => {
  const hub = read("server/crm-hub.ts");
  assert.match(hub, /side\(q, "KYC",/);
  assert.match(hub, /\.\.\.kycChip\(kycByCompany\.get\(id\) \|\| \[\], new Date\(now\)\),/);
  const shared = read("shared/crm-hub.ts");
  assert.match(shared, /\{ key: "kyc", label: "KYC to do" \}/);
  // The shared KYC chip (aml-frame.tsx): one chip everywhere (24 November 2026).
  assert.match(read("client/src/components/crm-hub/company-row.tsx"), /<KycStatusChip label=\{row\.kyc\.label\} tone=\{row\.kyc\.tone\} title=\{row\.kyc\.title\} testId=\{`crm-hub-kyc-\$\{row\.id\}`\} \/>/);
});
