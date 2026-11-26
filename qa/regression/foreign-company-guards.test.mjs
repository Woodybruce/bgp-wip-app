// Companies registered abroad, all in the app (Woody, 23 November 2026:
// Creditsafe said no and there is no Dun & Bradstreet, "No external ... to all
// happen in the app including translation"). Source guards; the rules are
// tested in server/foreign-company.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("a company registered abroad is saved through the billing entity route, BGP staff only, never a Companies House look-up", () => {
  const s = read("server/billing-entity.ts");
  const route = s.slice(s.indexOf('app.post("/api/billing-entities"'));
  const clientCheck = route.indexOf("isClientRequestUser(req)");
  const abroad = route.indexOf("req.body.abroad != null");
  assert.ok(clientCheck > 0 && abroad > clientCheck, "a client login is refused before the abroad branch reads anything");
  assert.match(route, /const abroadIn = abroadCompanyInput\(req\.body\);\s*if \("problem" in abroadIn\) return res\.status\(400\)/);
  assert.match(route, /saveAbroadEntity\(pool as unknown as Pool, brand\.id, abroadIn\.abroad, actorName, insertTradingEntity\)/);
  const save = s.slice(s.indexOf("export async function saveAbroadEntity"), s.indexOf("export async function saveAbroadEntity") + 2500);
  assert.match(save, /companiesHouseNumber: null/);
  assert.doesNotMatch(save, /chFetch|companies-house/);
  const index = read("server/index.ts");
  for (const col of ["country", "registration_number", "register_url"]) {
    assert.match(index, new RegExp(`ALTER TABLE crm_trading_entities ADD COLUMN IF NOT EXISTS ${col} TEXT`));
  }
});

test("the party box and the Who signs dialog offer Registered abroad", () => {
  assert.match(read("client/src/components/deal-parties.tsx"), /onClick=\{\(\) => setFinding\("abroad"\)\} data-testid="deal-party-add-abroad"/);
  const dialog = read("client/src/components/billing-entity-create.tsx");
  assert.match(dialog, /startAs\?: "company" \| "person" \| "abroad"/);
  assert.match(dialog, /data-testid=\{`\$\{testIdPrefix\}-mode-abroad`\}/);
  assert.doesNotMatch(dialog, /<form[\s>]/, "no form element in a dialog the deal form opens");
});

test("translation is Anthropic, called directly, under a daily allowance, for BGP staff only, and labelled as not certified", () => {
  const s = read("server/kyc-translation.ts");
  assert.match(s, /getAnthropicClient\(true\)\.messages\.create\(/);
  assert.match(s, /tool_choice: \{ type: "tool", name: KYC_TRANSLATION_TOOL\.name \}/);
  assert.match(s, /claimDailyRead\(USAGE_KEY, kycTranslationDailyCap\(\)\)/);
  assert.match(s, /process\.env\.KYC_TRANSLATION_DAILY_CAP/);
  assert.doesNotMatch(s, /callClaude\(/);
  assert.match(s, /export const TRANSLATION_NOTE = "[^"]*Not a certified translation[^"]*regulation 66/);
  // Each route's first address (the transaction's); a client file's sits beside it (24 November 2026).
  const routes = [...s.matchAll(/kycTranslationRouter\.(get|post)\(\[?"([^"]+)"/g)].map(m => `${m[1]} ${m[2]}`);
  assert.deepEqual(routes.sort(), [
    "get /api/deals/:id/parties/:role/documents/:docId/translation",
    "post /api/deals/:id/parties/:role/documents/:docId/translate",
  ]);
  assert.match(s, /if \(!\(await contactViewer\(req\)\)\.staff\) return null;/);
  assert.match(s, /translation"\]?, async \(req: Request, res: Response\) => \{\s*try \{\s*if \(!\(await staff\(req\)\)\) return res\.status\(403\)/);
  assert.match(s, /translate"\]?, async \(req: Request, res: Response\) => \{\s*try \{\s*const me = await staff\(req\);/);
  const index = read("server/index.ts");
  assert.match(index, /app\.use\(kycTranslationRouter\);/);
  assert.match(index, /CREATE TABLE IF NOT EXISTS kyc_document_translations \(/);
});

test("a document read as not in English is translated in the background, and every way an extract arrives is read", () => {
  assert.match(read("server/kyc-documents.ts"), /m\.translateIfForeign\(db, documentId, reading\)/);
  const portal = read("server/aml-portal.ts");
  assert.match(portal, /if \(docKey === "company_documents" && row\.company_id\) \{[\s\S]{0,600}INSERT INTO kyc_document_readings/);
  const abroad = read("server/kyc-abroad.ts");
  assert.match(abroad, /INSERT INTO kyc_document_readings \(document_id, deal_id, company_id, trading_entity_id, seen_original, uploaded_by, uploaded_by_name, about\)/);
  assert.match(read("server/index.ts"), /ALTER TABLE kyc_document_readings ADD COLUMN IF NOT EXISTS about JSONB/);
});

test("no sign-off on the full checks without the extract, and the AML file carries the translation beside the original", () => {
  const kyc = read("shared/party-kyc.ts");
  const deny = kyc.slice(kyc.indexOf("export function signOffDenial"));
  const extract = deny.indexOf("registerExtractDenial(f.registerExtract)");
  const sanctionsOnly = deny.indexOf("return guarantorChecksDenial(f.guarantorChecks) || signerChecksDenial(f.signerChecks);");
  const kyc4u = deny.indexOf("This party was raised with KYC4U");
  assert.ok(sanctionsOnly > 0 && extract > sanctionsOnly && kyc4u > extract, "after the sanctions-only branch, before the rest of the full checks");
  assert.match(read("server/deal-party-aml.ts"), /registerExtract/);
  const file = read("server/aml-file.ts");
  assert.match(file, /\(English translation\)\.txt/);
  assert.match(file, /\$\{TRANSLATION_NOTE\}/);
});

test("translations are deleted at five years and follow a merge", () => {
  assert.match(read("server/aml-records-retention.ts"), /\{ table: "kyc_document_translations", party: "company_id", at: "made_at" \}/);
  assert.match(read("server/aml-records-retention.ts"), /DELETE FROM kyc_document_translations WHERE company_id = \$1/);
  assert.match(read("server/brand-dedupe.ts"), /\{ table: "kyc_document_translations", column: "company_id" \}/);
});

test("the client checks ask for a register extract in any language, and the app map no longer sends anyone to Dun & Bradstreet", () => {
  assert.match(read("shared/kyc-request.ts"), /It can be in any language: we translate it/);
  const map = read("server/chatbgp-app-map.ts");
  assert.doesNotMatch(map, /drops? the D&B report|Dun & Bradstreet report on the party/i);
  assert.match(map, /Registered abroad/);
});

test("a foreign company on Companies House: its home register is read, and its extract is checked against that number, never the OE or FC number", () => {
  const pre = read("server/kyc-prechecks.ts");
  assert.match(pre, /home: homeRegisterFrom\(profile\.foreign_company_details\),/);
  assert.match(pre, /traceGleif\(\{ name: companiesHouse\.name, country: home\.country, registrationNumber: home\.registrationNumber \}\)/);
  const docs = read("server/kyc-documents.ts");
  assert.match(docs, /if \(!foreignOnCompaniesHouse\(chNumber\)\) return undefined;/);
  assert.match(docs, /homeAbroad: !!home/);
  // A number abroad is never taken from GLEIF without the name agreeing (German HRB numbers repeat).
  assert.match(read("shared/foreign-owners.ts"), /const sure = query\.authorities\?\.length \? byNumber : byNumber\.filter\(r => gleifNamesAgree\(r\.name, query\.name\)\);/);
});

test("policy Issue 5 is in the app and nothing sends anyone to Dun & Bradstreet", () => {
  assert.match(read("shared/aml-policy.ts"), /\{ key: "policy-issue-5", title: "Anti-Money Laundering Policy", issue: 5,/);
  // Issue 6 (25 November 2026) keeps Issue 5's rules on companies abroad.
  assert.match(read("shared/aml-policy.ts"), /export const POLICY_SOURCE = "BGP's AML policy \(Issue 8\) and risk assessment \(Issue 4\)";/);
  for (const f of ["server/chatbgp.ts", "client/src/pages/subscriptions.tsx", "client/src/components/aml-policy-panel.tsx", "shared/aml-rules.ts", "shared/kyc-request.ts"]) {
    assert.doesNotMatch(read(f).replace(/\/\/[^\n]*/g, ""), /download from D&B|D&B Direct|name: "Dun & Bradstreet"|asks for a Dun & Bradstreet report/, f);
  }
});
