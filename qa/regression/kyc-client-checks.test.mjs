// Client checks (17 November 2026; Woody: "check the whole system because it
// was built ages ago and wasnt working properly"). Source guards so the
// faults found then do not come back: the emails come from the KYC mailbox
// with the deal's agents copied, a client's files are kept and filed, the
// client's page is not switched off with in-app AML, the orchestrator does
// not start an identity check for every contact, and no WhatsApp goes from
// the server. Run with: node --import tsx --test qa/regression/kyc-client-checks.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const portal = read("server/aml-portal.ts");
const index = read("server/index.ts");
const veriff = read("server/veriff.ts");
const orchestrator = read("server/kyc-orchestrator.ts");
const compliance = read("server/aml-compliance.ts");
const app = read("client/src/App.tsx");
const page = read("client/src/pages/kyc-upload.tsx");

test("the emails go from the KYC mailbox (kyc@chatbgp.app unless set), falling back to the shared one", () => {
  assert.match(portal, /KYC_MAILBOX = \(process\.env\.KYC_MAILBOX \|\| process\.env\.BGP_AML_MAILBOX \|\| "kyc@chatbgp\.app"\)/);
  assert.match(portal, /await attempt\(KYC_MAILBOX\)/);
  assert.match(portal, /await attempt\(SHARED_MAILBOX\)/);
  assert.doesNotMatch(portal, /return \{ ok: false, error: "BGP_AML_MAILBOX env not configured" \}/, "an unset variable no longer stops every email");
});

test("the logo goes inline and the links point at the app's own address", () => {
  assert.match(portal, /isInline: true, contentId: KYC_LOGO_CID/);
  assert.match(portal, /process\.env\.PUBLIC_APP_URL \|\| "https:\/\/chatbgp\.app"/);
  assert.doesNotMatch(portal, /app\.brucegillinghampollard\.com/, "the old default address is gone");
});

test("the deal's agents and the sender are copied, BGP addresses only", () => {
  assert.match(portal, /export async function dealAgents/);
  assert.match(portal, /internal_agent_ids/);
  assert.match(portal, /deal_fee_allocations/);
  assert.match(portal, /is_bgp_house IS NOT TRUE/);
  assert.match(portal, /endsWith\(STAFF_DOMAIN\)/);
  assert.match(portal, /to: \[email\], cc,/);
});

test("a client's file is stored and filed on the KYC record, never only read and deleted", () => {
  const filing = portal.slice(portal.indexOf("async function fileClientDocument"), portal.indexOf("// ── Finishing"));
  assert.match(filing, /saveFile\(`chat-media\/\$\{safeName\}`/);
  assert.match(filing, /INSERT INTO kyc_documents/);
  assert.match(filing, /kyc_document_id/);
  assert.match(filing, /if \(row\.is_test\)/, "a test request keeps nothing");
  assert.match(portal, /path\.basename\(String\(name \|\| "file"\)\)/, "the temporary copy uses a name the app chose");
  assert.doesNotMatch(compliance, /\/api\/kyc-upload\/:token\/file/, "the old upload route that deleted the file is gone");
});

test("the client's page answers to its token, whether in-app AML is on or off, and whoever is signed in", () => {
  const retired = index.slice(index.indexOf("const RETIRED_AML = ["), index.indexOf("];", index.indexOf("const RETIRED_AML = [")));
  assert.doesNotMatch(retired, /kyc-upload/);
  assert.match(retired, /aml\|kyc-clouseau\|veriff/, "the rest of in-app AML is still switched off");
  assert.match(index, /if \(p\.startsWith\("\/api\/kyc-upload\/"\)\) return next\(\);/);
  assert.match(app, /<Route path="\/kyc-upload\/:token" component=\{KycUploadPage\} \/>/);
  assert.doesNotMatch(app, /This upload link is no longer in use/);
  assert.match(portal, /function closedReason/);
});

test("staff routes are staff only; the test send is admin only and goes to the admin alone", () => {
  for (const route of ['"/api/aml/deal/:id/client-checks"', '"/api/aml/client-checks/:token/remind"', '"/api/aml/client-checks/:token"']) {
    const at = portal.indexOf(route);
    assert.ok(at > 0, route);
    assert.match(portal.slice(at, at + 400), /staffMe\(req\)/, route);
  }
  const testRoute = portal.slice(portal.indexOf('"/api/admin/kyc-emails/test"'));
  assert.match(portal, /"\/api\/admin\/kyc-emails\/test", adminOnly/);
  const body = testRoute.slice(0, testRoute.indexOf("export default"));
  const sends = (body.match(/sendKycEmail\(\{/g) || []).length;
  const toAdminOnly = (body.match(/sendKycEmail\(\{\s*to: \[email\],\s*build:/g) || []).length;
  assert.ok(sends >= 3 && sends === toAdminOnly, "every test email goes to the admin who pressed it, copied to nobody");
});

test("replies are filed only from the address the request went to, with its reference", () => {
  const poll = portal.slice(portal.indexOf("export async function pollKycMailbox"), portal.indexOf("// ── Routes"));
  assert.match(poll, /kycRefFromSubject\(msg\.subject\)/);
  assert.match(poll, /from !== cleanEmail\(row\.contact_email\)/);
  assert.match(poll, /UNMATCHED/);
  assert.match(poll, /receivedDateTime ge \$\{since\} and hasAttachments eq true/, "Microsoft sorts only on a property the filter names first");
  assert.match(index, /pollKycMailbox\(\)/, "the reader runs on a timer");
  assert.match(index, /key: "kyc-client-reminders"/, "reminders run");
  assert.match(portal, /if \(!inAppAmlOn\(\)\) return \{ sent: 0/, "reminders do nothing while in-app AML is off");
});

test("the orchestrator no longer starts an identity check for every contact on a company", () => {
  assert.doesNotMatch(orchestrator, /createVeriffSession/);
  assert.doesNotMatch(orchestrator, /SELECT id, name, email FROM crm_contacts WHERE company_id = \$1/);
});

test("no WhatsApp is sent from the server (WhatsApp refuses a business's first message unless it is a template)", () => {
  assert.doesNotMatch(veriff, /sendWhatsAppText/);
  assert.match(veriff, /whatsappHref/);
  assert.match(veriff, /kycIdCheckEmail/);
});

test("Veriff's event webhook never blanks a decision", () => {
  assert.match(veriff, /typeof payload\?\.action === "string"/);
  assert.match(veriff, /NOT IN \('approved', 'declined', 'resubmission_requested', 'expired', 'abandoned', 'review'\)/);
});

test("the client is asked the question about public roles, and its answer reaches the MLRO's trail", () => {
  assert.match(portal, /"\/api\/kyc-upload\/:token\/answers"/);
  assert.match(portal, /'client_pep_declaration'/);
  assert.match(portal, /askPep: true, answers: null/);
  assert.match(page, /QuestionCard/);
  assert.match(page, /KYC_PRIVACY_URL/);
});
