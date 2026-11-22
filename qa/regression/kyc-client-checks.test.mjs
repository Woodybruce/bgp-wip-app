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

test("the emails go from the KYC mailbox (kyc@chatbgp.app unless set), then the app's address, then the shared one", () => {
  assert.match(portal, /KYC_MAILBOX = \(process\.env\.KYC_MAILBOX \|\| process\.env\.BGP_AML_MAILBOX \|\| "kyc@chatbgp\.app"\)/);
  assert.match(portal, /sendFromFirstMailbox\(\{ mailboxes: \[KYC_MAILBOX\], to, cc:/);
  const mailbox = readFileSync(new URL('../../server/shared-mailbox.ts', import.meta.url), 'utf8');
  assert.match(mailbox, /for \(const m of \[\.\.\.first, APP_MAILBOX, SHARED_MAILBOX\]\)/);
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
  assert.match(retired, /aml\|kyc-clouseau\|sanctions\|comply-advantage/, "the rest of in-app AML is still switched off");
  // Veriff too, but for its signed webhook and the admin diagnostic (2026-11-17).
  assert.match(retired, /\/\^\\\/api\\\/veriff\(\?!\\\/\(webhook\|diagnostic\)\$\)\(\\\/\|\$\)\//);
  assert.match(index, /if \(p\.startsWith\("\/api\/kyc-upload\/"\)\) return next\(\);/);
  assert.match(app, /<Route path="\/kyc-upload\/:token" component=\{KycUploadPage\} \/>/);
  assert.doesNotMatch(app, /This upload link is no longer in use/);
  assert.match(portal, /function closedReason/);
});

test("staff routes are staff only; the test send is admin only and goes to the admin, or the request to one BGP colleague", () => {
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
  const toRecipient = (body.match(/sendKycEmail\(\{\s*to: \[recipient\.email\],\s*cc,\s*build:/g) || []).length;
  assert.ok(sends >= 4 && toRecipient === 1 && sends === toAdminOnly + toRecipient, "every test email goes to the admin who pressed it, except the request, which may go to a colleague");
  // The colleague (Woody, 17 November 2026: a test for Jack): only the
  // request, only an active login with a BGP address, copied to the admin.
  assert.match(body, /if \(kind !== "request"\) return res\.status\(400\)/);
  assert.match(body, /SELECT name, email FROM users WHERE id = \$1 AND is_active IS NOT FALSE/);
  assert.match(body, /!address\.endsWith\(STAFF_DOMAIN\)\) return res\.status\(400\)/);
  assert.match(portal, /const STAFF_DOMAIN = "@brucegillinghampollard\.com";/);
  assert.match(body, /const recipient = colleague \|\| \{ name: me\.name, email \};/);
  assert.match(body, /cc = colleague \? \[email\] : \[\];/);
  assert.match(body, /VALUES \(\$1, 'test', \$2, \$3, \$4, \$5, \$6, true\)/, "it is still a test request");
  // Its Finish note and any red-flag alert come back to the admin.
  const finish = portal.slice(portal.indexOf("async function finishRequest"), portal.indexOf("// ── Replies with documents"));
  assert.match(finish, /const to = kycReplyAddresses\(row, request\.cc\);/);
  const admin = read("client/src/components/kyc-emails-admin.tsx");
  assert.match(admin, /endsWith\(BGP_DOMAIN\)/);
  assert.match(admin, /test\.mutate\(\{ kind: "request", toUserId: colleague\.id/);
});

test("replies are filed only from the address the request went to, with its reference", () => {
  const poll = portal.slice(portal.indexOf("export async function pollKycMailbox"), portal.indexOf("// ── Routes"));
  assert.match(poll, /kycRefFromSubject\(msg\.subject\)/);
  assert.match(poll, /from !== cleanEmail\(row\.contact_email\)/);
  assert.match(poll, /UNMATCHED/);
  assert.match(poll, /receivedDateTime ge \$\{since\} and hasAttachments eq true/, "Microsoft sorts only on a property the filter names first");
  assert.match(index, /pollKycMailbox\(\)/, "the reader runs on a timer");
  assert.match(index, /key: "kyc-client-reminders"/, "reminders run");
  assert.match(portal, /if \(!clientChecksOn\(\)\) return \{ sent: 0/, "reminders do nothing while the client checks are switched off");
  // Woody, 19 and 20 November 2026: only a live deal is chased, never one
  // deleted, withdrawn, completed, invoiced or archived.
  // The joint agent's requests are chased by their own rule (22 November 2026).
  assert.match(portal, /AND expires_at > now\(\) AND COALESCE\(reminders_sent, 0\) < \$1 AND \$\{NOT_JOINT_SQL\(\)\}\s*AND EXISTS \(SELECT 1 FROM crm_deals d WHERE d\.id = kyc_upload_tokens\.deal_id\s*AND NOT \(lower\(btrim\(coalesce\(d\.status, ''\)\)\) = ANY\(\$2::text\[\]\)\)\)`,\s*\[REMINDER_DAYS\.length, statusSpellingsFor\(CLOSED_STATUSES\)\]/, "reminders only for a live deal");
  assert.match(index, /if \(!clientChecksSwitchOn\(process\.env\.KYC_CLIENT_CHECKS\)\) return;\s*import\("\.\/aml-portal"\)\.then\(m => m\.pollKycMailbox\(\)\)/, "the reply reader follows the client checks' own switch");
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

test("a test page runs a real Veriff check when Veriff is set up, capped as a client's, and writes nothing to any party", () => {
  // Woody, 17 November 2026: "can you do the test page a real identity check with veriff".
  const start = portal.slice(portal.indexOf('"/api/kyc-upload/:token/id-check"'));
  const route = start.slice(0, start.indexOf("kycRequestRouter.post(", 10));
  assert.match(route, /if \(row\.is_test && !veriffConfigured\(\)\) return res\.json\(\{ url: null, test: true \}\);/);
  assert.match(route, /request\.veriffSessionIds\.length >= MAX_ID_SESSIONS/, "the same three-session cap");
  const view = portal.slice(portal.indexOf("export async function portalView"), portal.indexOf("const requested = new Set(request.docs);"));
  assert.match(view, /const real = !row\.is_test \|\| veriffConfigured\(\);/);
  assert.match(view, /const canStart = !real \? true/);
  assert.match(view, /idCheck = \{ state, canStart, real, \.\.\.\(otherPerson \? \{ verifiedName: progress\.idPerson!\.verifiedName, otherPerson: true \} : \{\}\) \};/);
  // A test request has no company or contact, so an approval writes no party
  // record: the decision handler files a document only for one or the other.
  const veriff = read("server/veriff.ts");
  assert.match(veriff, /if \(s && \(s\.company_id \|\| s\.contact_id\)\) \{/);
  // Its own checks feed its red flags: a decline alerts the admin who sent it
  // and is listed in the Finished note.
  const flags = read("server/kyc-red-flags.ts");
  assert.match(flags, /export async function requestIdChecks\(sessionIds: unknown\)/);
  assert.match(flags, /idChecks: await requestIdChecks\(request\.veriffSessionIds\) \}\);/);
  const finish = portal.slice(portal.indexOf("async function finishRequest"), portal.indexOf("// ── Replies with documents"));
  assert.match(finish, /idChecks: await requestIdChecks\(request\.veriffSessionIds\) \}\)/);
  assert.match(read("client/src/pages/kyc-upload.tsx"), /view\.idCheck\?\.real \? " The identity check is a real one, run by Veriff\." : ""/);
  // A tester sees what Veriff said when it does not start; a client the plain line.
  assert.match(route, /message: isTest\s*\? `Test page: Veriff did not start the check/);
  assert.match(route, /: "The identity check couldn't be started just now\. Please try again in a few minutes\." \}\);/);
  // The diagnostic asks Veriff for a real session: admins only.
  assert.match(veriff, /veriffRouter\.get\("\/api\/veriff\/diagnostic", requireAuth, requireAdmin,/);
});

test("the client checks run on their own switch, not the old in-app AML one (Woody, 18 November 2026: \"client checks only\")", () => {
  const rules = readFileSync(new URL("../../shared/kyc-request.ts", import.meta.url), "utf8");
  const compliance = readFileSync(new URL("../../server/aml-compliance.ts", import.meta.url), "utf8");
  const card = readFileSync(new URL("../../client/src/components/deal-aml-status.tsx", import.meta.url), "utf8");
  const deals = readFileSync(new URL("../../client/src/pages/deals.tsx", import.meta.url), "utf8");
  assert.match(rules, /export const clientChecksSwitchOn = \(value: string \| null \| undefined\): boolean => String\(value \?\? ""\)\.trim\(\)\.toLowerCase\(\) !== "off";/);
  assert.match(portal, /export const clientChecksOn = \(\) => clientChecksSwitchOn\(process\.env\.KYC_CLIENT_CHECKS\);/);
  assert.doesNotMatch(portal, /inAppAmlOn|IN_APP_AML_ENABLED/, "nothing in the client checks waits on the old switch");
  // Sending and reminding stop when the switch is off; reading what was sent does not.
  for (const route of ['"/api/aml/deal/:id/client-checks", signedIn, async (req: Request, res: Response) => {\n  try {\n    const me', '"/api/aml/client-checks/:token/remind"']) {
    const at = portal.indexOf(route);
    assert.ok(at > 0, route);
    assert.match(portal.slice(at, at + 400), /if \(!clientChecksOn\(\)\) return res\.status\(410\)/, route);
  }
  assert.match(compliance, /clientChecks: clientChecksSwitchOn\(process\.env\.KYC_CLIENT_CHECKS\),/);
  // One place offers them: the Client checks line of the one party box (20 November 2026), shown only while the switch is on.
  // The Documents step (22 November 2026) offers them only while the switch is on.
  assert.match(card, /\{data\.clientChecks && clientRoute && !people\?\.reliance && \(/, "Send client checks follows the client checks' switch");
  assert.match(card, /\{!clientRoute && data\.clientChecks && !sanctionsOnly && <SendClientChecksButton/, "and so do Other ways");
  assert.match(card, /clientChecks: !!data\.clientChecks,/, "and so does the Next line");
  assert.equal((card.match(/<SendClientChecksButton dealId=\{dealId\} companyId=\{cp\.id\} partyName=\{partyName\}/g) || []).length, 4, "the Next line, the Documents step (send, send again) and Other ways");
  assert.doesNotMatch(card, /data\.inAppAml/);
  assert.match(deals, /const clientChecks = !!amlStepStatus\?\.clientChecks;/);
  assert.doesNotMatch(deals, /amlInApp|inAppAml/);
});
