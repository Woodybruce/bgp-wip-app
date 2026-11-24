// The Companies view on Transactions → AML (Woody, 24 November 2026) and its
// suggested sub companies. Source guards; the rules are tested in
// server/kyc-companies.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("the companies routes are BGP staff only, and outside the retired AML addresses", () => {
  const s = read("server/kyc-companies.ts");
  const routes = [...s.matchAll(/kycCompaniesRouter\.(get|post|put)\("([^"]+)"/g)].map(m => m[2]);
  assert.deepEqual(routes.sort(), [
    "/api/aml-dashboard/companies", "/api/aml-dashboard/companies/:id/sanctions-only",
    "/api/aml-dashboard/companies/list", "/api/aml-dashboard/companies/search",
  ]);
  for (const block of s.split("kycCompaniesRouter.").slice(1)) {
    assert.match(block.slice(0, 400), /const me = await staffMe\(req\);\s*if \(!me\) return res\.status\(403\)/, block.slice(0, 80));
  }
  const g = read("server/kyc-suggestions.ts");
  assert.match(g, /kycSuggestionsRouter\.get\("\/api\/client-kyc\/:companyId\/suggestions"/);
  assert.match(g, /if \(!\(await contactViewer\(req\)\)\.staff\) return res\.status\(403\)/);
  // Read only when asked: no timer, and it files nothing.
  assert.doesNotMatch(g, /setInterval|cron|schedule\(/);
  assert.doesNotMatch(g, /INSERT INTO|UPDATE crm_|DELETE FROM/);
  const index = read("server/index.ts");
  assert.match(index, /app\.use\(kycCompaniesRouter\);\s*app\.use\(kycSuggestionsRouter\);/);
  assert.match(index, /ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS kyc_listed_at timestamp/);
  assert.match(index, /ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS kyc_sanctions_only boolean/);
});

test("every company on a transaction the AML board covers is on the view, with its KYC read the CRM chip's way", () => {
  const s = read("server/kyc-companies.ts");
  assert.match(s, /const board = await loadAmlDashboard\(me, now\);/);
  assert.match(s, /FROM crm_companies WHERE kyc_listed_at IS NOT NULL\s+UNION SELECT company_id FROM kyc_client_files WHERE closed_at IS NULL/);
  assert.match(s, /AND merged_into_id IS NULL AND archived_at IS NULL/);
  assert.match(s, /side\("KYC4U's past checks"/);
  // A transaction still decides its own checks from its rent: the switch is the company's client files only.
  const ck = read("server/client-kyc.ts");
  assert.match(ck, /regime: \(await companySanctionsOnly\(db, companyId\)\.catch\(\(\) => \(\{ on: false \}\)\)\)\.on \? "sanctions_only" : "full"/);
});

test("deleting a sub company: never one that signs, pays, guarantees or holds AML records", () => {
  const s = read("server/crm.ts");
  const route = s.slice(s.indexOf('app.delete("/api/crm/trading-entities/:id"'));
  assert.match(route, /landlord_trading_entity_id = \$1 OR tenant_trading_entity_id = \$1 OR vendor_trading_entity_id = \$1 OR purchaser_trading_entity_id = \$1/);
  assert.match(route, /FROM crm_deals WHERE invoice_payer_entity_id = \$1/);
  assert.match(route, /FROM deal_guarantors WHERE trading_entity_id = \$1 AND removed_at IS NULL/);
  for (const t of ["kyc_documents", "kyc_investigations", "kyc_client_files", "kyc_upload_tokens"]) {
    assert.ok(route.slice(0, 4000).includes(`FROM ${t} WHERE trading_entity_id = $1`), t);
  }
});

test("the screen: one row per company, the company page's own card inside, each transaction's own AML box", () => {
  const v = read("client/src/components/kyc-companies/companies-view.tsx");
  assert.match(v, /data-testid="kyc-companies"/);
  assert.match(v, /<AccountEntitiesPanel companyId=\{row\.id\} \/>/, "one version of the Companies and KYC card");
  assert.match(v, /<DealAmlDialog deal=\{aml\}/, "a transaction's AML box, not a copy");
  assert.match(v, /<Kyc4uStatusStrip companyId=\{row\.id\} \/>/);
  assert.match(v, /<CrmSelectBar kind="kyc"/, "select and delete follow the CRM lists' rules");
  assert.match(v, /\/deals\?new=1&\$\{row\.kind === "brand" \? "tenantId" : "landlordId"\}=/);
  assert.doesNotMatch(v, /<form[\s>]/, "no form element in a dialog");
  const page = read("client/src/pages/aml-dashboard.tsx");
  assert.match(page, /\{ key: "checks", label: "Transactions" \}/);
  assert.match(page, /\{ key: "companies", label: "Companies" \}/);
  assert.match(page, /shownSection === "companies" && <KycCompaniesView/);
  // New Transaction opened from a company starts with it filled in.
  const deals = read("client/src/pages/deals.tsx");
  assert.match(deals, /for \(const k of \["landlordId", "tenantId", "vendorId", "purchaserId"\] as const\)/);
  assert.match(deals, /\{ \.\.\.freshForm\(\), \.\.\.\(prefill \|\| \{\}\) \}/);
});

test("the Companies and KYC card: suggestions on request, and select and delete of sub companies", () => {
  const panel = read("client/src/components/account-entities-panel.tsx");
  assert.match(panel, /<SuggestedCompanies companyId=\{companyId\} onAdded=\{invalidate\} \/>/);
  assert.match(panel, /data-testid="entities-delete"/);
  assert.match(panel, /apiRequest\("DELETE", `\/api\/crm\/trading-entities\//);
  const sug = read("client/src/components/kyc-companies/suggested-companies.tsx");
  assert.match(sug, /enabled: asked,/, "read only when someone asks");
  assert.match(sug, /\{ brandId: companyId, companyNumber: s\.number, xero: false \}/);
});

test("KYC4U's folders no company holds can be matched from the request grid", () => {
  const p = read("client/src/components/kyc4u-panel.tsx");
  assert.match(p, /data-testid=\{`kyc4u-request-match-\$\{r\.itemId\}`\}/);
  assert.match(p, /<MatchToCompany folder=\{\{ listId: r\.listId, ref: r\.itemId, entity: r\.entityName/);
  assert.match(p, /data-testid="kyc4u-requests-unmatched"/);
  assert.match(read("client/src/components/kyc4u-archive-card.tsx"), /export function MatchToCompany/);
});

test("one version everywhere: the chip's words, the card's header, the list's AML dot, the phone landlord card", () => {
  // The CRM chip, the Companies view and the company card say Sanctions only the same way.
  const words = read("shared/client-kyc.ts");
  assert.match(words, /label: done \? "Cleared, some sanctions only" : "Sanctions only"/);
  assert.match(read("shared/kyc-companies.ts"), /return clientKycWords\(clientKycSummary\(kycEntityRows\(entities, false\), now\)\);/);
  const panel = read("client/src/components/account-entities-panel.tsx");
  assert.match(panel, /const chipWords = subjects\.length \? clientKycWords\(clientKycSummary\(/);
  assert.match(panel, /<CheckCircle2 className="w-3 h-3" \/>Cleared<\/span>/);
  // The Transactions list's dot follows the transaction's own flag, kept with the AML gate's rule.
  assert.match(read("client/src/components/deal-aml-badge.tsx"), /if \(deal\.kycApproved && !missing\.some\(m => m\.reason === "expired"\)\) return \{ status: "complete", missing: \[\] \};/);
  // The phone landlord page has the desktop's company checks card, not the older compliance board.
  const phone = read("client/src/components/mobile-brand-view.tsx");
  assert.match(phone, /\{isLandlord && <LandlordCompanyChecksCard key=\{companyId\} companyId=\{companyId\} company=\{c\} isClientViewer=\{isClientViewer\} \/>\}/);
  assert.match(phone, /\{!isLandlord && <BrandComplianceCard companyId=\{companyId\} company=\{c\} \/>\}/);
});
