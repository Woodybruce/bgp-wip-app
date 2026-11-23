// Client checks (17 November 2026): the emails, the page's rules and the
// reminder timing. The email words live in shared/kyc-request.ts.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  clientChecksSwitchOn, KYC_CLIENT_CHECK_ROUTES,
  KYC_DATA_USE, KYC_DOCS, KYC_LETTING_SCOPE, KYC_LOGO_CID, KYC_PEP_QUESTION, KYC_PRIVACY_URL, KYC_TIMING, defaultKycDocs, isKycDocKey, isKycPepAnswer,
  kycFinishedEmail, kycIdCheckEmail, kycIdStateFor, kycRefFromSubject, kycReminderEmail, kycReplyAddresses, kycRequestEmail, kycSteps, kycUploadAllowed,
  kycPersonRoleWords, kycViaAgentIdWho, kycViaAgentReminderEmail, kycViaAgentRequestEmail, kycWhatsAppHref, kycWhatsAppText, type KycEmailContext,
} from "../shared/kyc-request";
import { readFileSync } from "node:fs";
import { reminderDue } from "./aml-portal";

const ctx = (over: Partial<KycEmailContext> = {}): KycEmailContext => ({
  recipientName: "Jane Smith", partyName: "Example Trading Ltd", kind: "company", dealName: "12 Example Street",
  ref: "7K2Q9M", link: "https://chatbgp.app/kyc-upload/abc", expiresAt: new Date("2026-12-01T12:00:00Z"),
  needsIdCheck: true, docs: ["ownership", "owner_ids", "authority"], note: null, askPep: true,
  agents: [{ name: "Jack Agent", email: "jack@brucegillinghampollard.com", phone: "07700 900123" }],
  sentFrom: "kyc@chatbgp.app", ...over,
});

test("the request carries the logo, one button to the client's own page and the reference in the subject", () => {
  const { subject, html } = kycRequestEmail(ctx());
  assert.match(subject, /12 Example Street \(ref 7K2Q9M\)$/);
  assert.equal(kycRefFromSubject(`RE: ${subject}`), "7K2Q9M");
  assert.ok(html.includes(`cid:${KYC_LOGO_CID}`), "the logo is the inline image");
  assert.equal((html.match(/Start your checks/g) || []).length, 1);
  assert.ok(html.includes('href="https://chatbgp.app/kyc-upload/abc"'));
  assert.match(html, /Sent from kyc@chatbgp\.app/);
  assert.match(html, /Jack Agent/);
  assert.doesNotMatch(html, /\[Test\]|Test email/);
});

test("every name and note is escaped, and a link that is not https is never written", () => {
  const { html } = kycRequestEmail(ctx({ recipientName: "<script>alert(1)</script>", partyName: "A & B <Ltd>", note: "Call me\n<b>now</b>", link: "javascript:alert(1)" }));
  assert.doesNotMatch(html, /<script>|<b>now<\/b>|javascript:/);
  assert.match(html, /A &amp; B &lt;Ltd&gt;/);
  assert.match(html, /href="#"/);
});

test("a company is told Companies House is read by us; a person is not", () => {
  assert.match(kycRequestEmail(ctx()).html, /Companies House/);
  assert.doesNotMatch(kycRequestEmail(ctx({ kind: "individual", docs: ["proof_of_address"] })).html, /Companies House/);
});

test("the steps follow the request: the identity check, each document, then the question", () => {
  assert.deepEqual(kycSteps({ needsIdCheck: true, docs: ["proof_of_address"], askPep: true, kind: "individual" }).map(s => s.title),
    ["A quick identity check", KYC_DOCS.proof_of_address.title, KYC_PEP_QUESTION.title]);
  assert.deepEqual(kycSteps({ needsIdCheck: false, docs: ["photo_id"] }).map(s => s.title), [KYC_DOCS.photo_id.title]);
});

test("what is asked for by default: photo ID only without the online check; ownership and authority for a company; the money from whoever pays", () => {
  // The person dealing with us for a company sends their own proof of address (19 November 2026).
  assert.deepEqual(defaultKycDocs("company", "tenant", true), ["proof_of_address", "ownership", "owner_ids", "authority", "source_of_funds"]);
  assert.deepEqual(defaultKycDocs("company", "tenant", false), ["photo_id", "proof_of_address", "ownership", "owner_ids", "authority", "source_of_funds"]);
  assert.deepEqual(defaultKycDocs("company", "landlord", true), ["proof_of_address", "ownership", "owner_ids", "authority"]);
  assert.deepEqual(defaultKycDocs("individual", "purchaser", true), ["proof_of_address", "source_of_funds"]);
  assert.ok(defaultKycDocs("individual", "landlord", false).includes("photo_id"));
  assert.ok(isKycDocKey("owner_ids") && isKycDocKey("authority") && !isKycDocKey("passport"));
});

test("HMRC: the documents asked for are the ones its guidance names", () => {
  // HMRC's documents and BGP's AML policy (Issue 2, appendix 4.10 and 3.9, 19 November 2026).
  assert.match(KYC_DOCS.photo_id.detail, /passport, photocard driving licence, national identity card, or firearms or shotgun certificate/);
  assert.match(KYC_DOCS.photo_id.detail, /I have met the person concerned and confirm the likeness to the photo ID provided/, "a copy, not the original, is certified (AMLG11400 14.4), in the policy's words");
  assert.match(KYC_DOCS.proof_of_address.detail, /utility bill, bank or building society statement, council tax bill or mortgage statement dated in the last three months/);
  assert.match(KYC_DOCS.ownership.detail, /more than 25%/);
  assert.doesNotMatch(KYC_DOCS.ownership.detail, /25% or more/);
  assert.match(KYC_DOCS.ownership.detail, /controls the company in another way/);
  assert.match(KYC_DOCS.authority.detail, /director/);
  assert.match(KYC_DOCS.company_documents.detail, /extract from its official company register/);
  assert.match(KYC_DOCS.source_of_funds.detail, /not only which bank/);
});

test("HMRC: when each party's checks are due, and which lettings are in scope", () => {
  assert.match(KYC_TIMING.landlord, /before you agree terms of engagement and before the unit is marketed/);
  assert.match(KYC_TIMING.tenant, /landlord accepts their offer, and before any agreement or contract/);
  assert.match(KYC_TIMING.tenant, /No deposit/);
  assert.match(KYC_TIMING.purchaser, /before exchange/);
  assert.match(KYC_TIMING.vendor, /before the property is marketed/);
  assert.match(KYC_LETTING_SCOPE, /£10,000 a month/);
  assert.match(KYC_LETTING_SCOPE, /turnover rent/);
  assert.match(KYC_LETTING_SCOPE, /OFSI/);
});

test("regulation 41 and record keeping: what the client is told about their data", () => {
  const { html } = kycRequestEmail(ctx());
  assert.match(KYC_DATA_USE, /only to prevent money laundering and terrorist financing/);
  assert.match(KYC_DATA_USE, /five years after our work with you ends/);
  assert.ok(html.includes(KYC_DATA_USE));
  assert.ok(html.includes(`href="${KYC_PRIVACY_URL}"`), "the privacy notice is linked");
});

test("FCA: the public-role question uses the legal definition, no wider", () => {
  assert.match(KYC_PEP_QUESTION.company, /last 12 months/);
  assert.match(KYC_PEP_QUESTION.company, /spouse or partner, child \(or child's spouse or partner\) or parent/);
  assert.doesNotMatch(KYC_PEP_QUESTION.company + KYC_PEP_QUESTION.individual + KYC_PEP_QUESTION.examples, /brother|sister|sibling|councillor/i);
  assert.match(KYC_PEP_QUESTION.examples, /Middle-ranking and junior officials are not included/);
  const step = kycSteps({ needsIdCheck: false, docs: [], askPep: true, kind: "company" })[0].detail;
  assert.doesNotMatch(step, /close family/, "the email's summary is no wider than the definition");
  assert.match(step, /spouse, partner, child or parent/);
  assert.ok(isKycPepAnswer("unsure") && !isKycPepAnswer("maybe"));
});

test("the reminder lists what is done and what is still needed", () => {
  const { subject, html } = kycReminderEmail({ ...ctx(), progress: { idDone: true, docsDone: ["ownership"] } });
  assert.match(subject, /^Reminder: /);
  const done = html.indexOf("Done, thank you"), left = html.indexOf("Still needed");
  assert.ok(done > 0 && left > done);
  const id = html.indexOf("Identity check", done);
  assert.ok(id > done && id < left);
  assert.ok(html.indexOf(KYC_DOCS.owner_ids.title, done) > left);
  assert.ok(html.indexOf(KYC_PEP_QUESTION.title, done) > left, "the unanswered question is still needed");
});

// Woody, 23 November 2026: "with the agent acting for the tenant or against us we need them to pass on the standard KYC
// requests for their clients to complete the agent should have the ability to help organise by uploading docs etc."
test("through the other side's agent: the standard checks to pass on, the documents uploadable by either of them", () => {
  const agentCtx = {
    ...ctx({ recipientName: "Sam Agent", partyName: "Bills Restaurants Ltd", dealName: "Southbank - Unit 5b" }),
    agentFirm: "Knight Frank", partyRole: "tenant", clientRole: "landlord", clientName: "Brucecap Ltd", personName: null,
  };
  const { subject, html } = kycViaAgentRequestEmail(agentCtx);
  assert.match(subject, /^Please pass on: our checks on Bills Restaurants Ltd for Southbank - Unit 5b \(ref 7K2Q9M\)$/);
  assert.equal(kycRefFromSubject(`RE: ${subject}`), "7K2Q9M", "a reply with the documents finds its request");
  assert.match(html, /Hello Sam,/);
  assert.match(html, /We act for <strong>Brucecap Ltd<\/strong>, the landlord, on <strong>Southbank - Unit 5b<\/strong>, and you act for <strong>Bills Restaurants Ltd<\/strong>, the tenant\./);
  assert.match(html, /Please pass our standard checks on to your client to complete\./);
  for (const step of kycSteps(agentCtx)) assert.ok(html.includes(step.title.replace(/'/g, "&#39;")) || html.includes(step.title), `lists ${step.title}`);
  assert.equal((html.match(/Open the checks/g) || []).length, 1);
  assert.match(html, /forward this email to your client, or send the link to them from the page\. You can upload any documents you hold for them on the same page\./);
  assert.match(html, /The identity check must be done by the person at Bills Restaurants Ltd dealing with us\./);
  assert.match(html, /the other side&#39;s agent receives|the other side's agent receives|Sent from kyc@chatbgp\.app/);
  assert.doesNotMatch(html, /AMLG|regulation \d|reg \d|reliance/);
  const named = kycViaAgentRequestEmail({ ...agentCtx, personName: "Daniel North", clientName: null });
  assert.match(named.html, /We act for the landlord on <strong>Southbank - Unit 5b<\/strong>/);
  assert.match(named.html, /forward this email to Daniel North/);
  assert.match(named.html, /The identity check must be done by Daniel North\./);
  assert.equal(kycViaAgentIdWho({ kind: "individual", partyName: "Jane Doe", personName: null }), "your client");
  const noId = kycViaAgentRequestEmail({ ...agentCtx, needsIdCheck: false });
  assert.doesNotMatch(noId.html, /The identity check must be done/);
  const reminder = kycViaAgentReminderEmail({ ...agentCtx, progress: { idDone: false, docsDone: ["ownership"] } });
  assert.match(reminder.subject, /^Reminder: our checks on Bills Restaurants Ltd for Southbank - Unit 5b \(ref 7K2Q9M\)$/);
  assert.match(reminder.html, /Please chase your client, or upload what you hold for them\./);
  assert.ok(reminder.html.indexOf("Done, thank you") < reminder.html.indexOf("Still needed"));
  // Passed on from the page: the client's email names the agent who asked.
  const passed = kycRequestEmail(ctx({ passedOnBy: { name: "Sam Agent", firm: "Knight Frank" } }));
  assert.match(passed.html, /Sam Agent of <strong>Knight Frank<\/strong>, your agent, asked us to send you this\./);
  assert.match(kycRequestEmail(ctx({ passedOnBy: { name: null, firm: "Knight Frank" } })).html, /Your agent, <strong>Knight Frank<\/strong>, asked us to send you this\./);
  assert.doesNotMatch(kycRequestEmail(ctx()).html, /asked us to send you this/);
});

test("a test email says so in its subject and at the top", () => {
  const { subject, html } = kycRequestEmail(ctx({ test: true }));
  assert.match(subject, /^\[Test\] /);
  assert.match(html, /Test email\./);
  assert.match(html, /Nothing has been sent to anyone else\./);
});

test("a test sent to a colleague names who sent it, and does not claim nobody else has it", () => {
  // Woody, 17 November 2026: a test for Jack to do KYC for Bruce Gillingham
  // Pollard Ltd, with Woody copied as the agent.
  const { subject, html } = kycRequestEmail(ctx({ test: true, testBy: "Woody Bruce", recipientName: "Jack Smith", partyName: "Bruce Gillingham Pollard Ltd" }));
  assert.match(subject, /^\[Test\] /);
  assert.match(html, /Test email\.<\/strong> Woody Bruce sent this to try the client checks: it is what a client receives\. No client has been sent anything\./);
  assert.doesNotMatch(html, /Nothing has been sent to anyone else/);
  assert.match(html, /Bruce Gillingham Pollard Ltd/);
  assert.match(html, /Jack/);
  // A name is written as words, never as markup.
  assert.match(kycRequestEmail(ctx({ test: true, testBy: "<b>x</b>" })).html, /&lt;b&gt;x&lt;\/b&gt; sent this/);
  // Not a test: no banner, whatever testBy holds.
  assert.doesNotMatch(kycRequestEmail(ctx({ testBy: "Woody Bruce" })).html, /Test email/);
});

test("who hears back: the copy list, never the client; a test sent to yourself comes back to you", () => {
  const cc = ["agent@brucegillinghampollard.com", "sender@brucegillinghampollard.com"];
  assert.deepEqual(kycReplyAddresses({ is_test: false, contact_email: "client@example.com" }, cc), cc);
  assert.deepEqual(kycReplyAddresses({ is_test: false, contact_email: "client@example.com" }, []), [], "a real request never writes back to the client");
  assert.deepEqual(kycReplyAddresses({ is_test: false, contact_email: "client@example.com" }, null), []);
  assert.deepEqual(kycReplyAddresses({ is_test: true, contact_email: "admin@brucegillinghampollard.com" }, []), ["admin@brucegillinghampollard.com"]);
  assert.deepEqual(kycReplyAddresses({ is_test: true, contact_email: "admin@brucegillinghampollard.com" }, undefined), ["admin@brucegillinghampollard.com"]);
  // Sent to a colleague: the admin, copied, hears back; the colleague does not.
  assert.deepEqual(kycReplyAddresses({ is_test: true, contact_email: "jack@brucegillinghampollard.com" }, ["woody@brucegillinghampollard.com"]), ["woody@brucegillinghampollard.com"]);
  assert.deepEqual(kycReplyAddresses({ is_test: true, contact_email: "jack@brucegillinghampollard.com" }, [42, "woody@brucegillinghampollard.com"]), ["woody@brucegillinghampollard.com"]);
});

test("the note to the agents names the files and what was not sent", () => {
  const { subject, html } = kycFinishedEmail({ recipientName: "Jane Smith", partyName: "Example Trading Ltd", dealName: "12 Example Street", ref: "7K2Q9M",
    dealLink: "https://chatbgp.app/deals/d1", idState: "submitted", files: [{ name: "chart.pdf", docKey: "ownership" }, { name: "scan.jpg", docKey: null }], missing: ["ID for each of those owners"], sentFrom: "kyc@chatbgp.app" });
  assert.match(subject, /Jane Smith has finished their identity checks for 12 Example Street/);
  assert.match(html, /chart\.pdf/);
  assert.match(html, /Sent by email/);
  assert.match(html, /Not sent/);
  assert.match(html, /waiting for Veriff/);
  assert.doesNotMatch(html, /Enhanced due diligence|PSC register/, "no answer or kind given, nothing said");
});

// Woody, 19 November 2026: "this is email about jack barrat but its actually after woody bruce did the check".
test("an identity check passed by someone else on the link is reported as theirs, never the client's", () => {
  const base = { recipientName: "jack Barrat", partyName: "BRUCE GILLINGHAM POLLARD LIMITED", dealName: "barrette does bruce cap", ref: "7MJEGT",
    dealLink: "https://chatbgp.app/deals/d1", idState: "approved" as const, files: [], missing: ["jack Barrat's own identity check"], sentFrom: "kyc@chatbgp.app" };
  const other = kycFinishedEmail({ ...base, idPerson: { verifiedName: "WOODY BRUCE", isThePerson: false } });
  assert.equal(other.subject, "The checks sent to jack Barrat were finished with WOODY BRUCE's identity check, for barrette does bruce cap (ref 7MJEGT)");
  assert.match(other.html, /The checks sent to jack Barrat were finished/);
  assert.match(other.html, /Identity check: passed by WOODY BRUCE, not jack Barrat, who this request was for\./);
  assert.match(other.html, /jack Barrat has not done their own identity check\./);
  assert.doesNotMatch(other.html, /jack Barrat has finished their checks/);
  const same = kycFinishedEmail({ ...base, missing: [], idPerson: { verifiedName: "JACK BARRATT", isThePerson: true } });
  assert.match(same.subject, /^jack Barrat has finished their identity checks/);
  assert.match(same.html, /Identity check: passed\./);
});

test("a yes or not sure to the question tells the agents what enhanced due diligence needs; a company gets the PSC check", () => {
  const base = { recipientName: "Jane Smith", partyName: "Example Trading Ltd", dealName: "12 Example Street", ref: "7K2Q9M",
    dealLink: "https://chatbgp.app/deals/d1", idState: "approved" as const, files: [], missing: [], sentFrom: "kyc@chatbgp.app", kind: "company" as const };
  const yes = kycFinishedEmail({ ...base, pep: "yes", pepDetail: "Father is an ambassador" }).html;
  assert.match(yes, /Enhanced due diligence/);
  assert.match(yes, /senior management approval/);
  assert.match(yes, /source of wealth and source of funds/);
  assert.match(yes, /A UK one starts as lower risk/);
  assert.match(yes, /Father is an ambassador/);
  assert.match(yes, /PSC register/);
  const no = kycFinishedEmail({ ...base, pep: "no" }).html;
  assert.doesNotMatch(no, /Enhanced due diligence/);
  assert.match(no, /Public roles/);
});

test("the identity check email links straight to the check", () => {
  const { html } = kycIdCheckEmail({ recipientName: "Jane Smith", partyName: "Jane Smith", kind: "individual", dealName: "", link: "https://magic.veriff.me/v/abc", agents: [], sentFrom: "kyc@chatbgp.app" });
  assert.ok(html.includes('href="https://magic.veriff.me/v/abc"'));
  assert.match(html, /reply to this email/);
});

test("Veriff's statuses read as the page's states", () => {
  assert.equal(kycIdStateFor(null), "not_started");
  assert.equal(kycIdStateFor("created"), "not_started");
  assert.equal(kycIdStateFor("started"), "started");
  assert.equal(kycIdStateFor("submitted"), "submitted");
  assert.equal(kycIdStateFor("approved"), "approved");
  assert.equal(kycIdStateFor("resubmission_requested"), "retry");
  for (const s of ["declined", "expired", "abandoned"]) assert.equal(kycIdStateFor(s), "restart");
});

test("the page takes documents and photos, nothing that runs", () => {
  assert.ok(kycUploadAllowed("passport.pdf", "application/pdf"));
  assert.ok(kycUploadAllowed("IMG_0001.HEIC", ""));
  assert.ok(kycUploadAllowed("photo.jpg", "image/jpeg"));
  assert.ok(!kycUploadAllowed("invoice.exe", "application/octet-stream"));
  assert.ok(!kycUploadAllowed("page.html", "text/html"));
  assert.ok(!kycUploadAllowed("passport.pdf", "text/html"), "a document type that does not match is refused");
});

test("the WhatsApp link opens the agent's own WhatsApp with the message written out", () => {
  const text = kycWhatsAppText({ recipientName: "Jane Smith", dealName: "12 Example Street", link: "https://chatbgp.app/kyc-upload/abc", expiresAt: "2026-12-01T12:00:00Z", senderName: "Jack Agent" });
  assert.match(text, /^Hello Jane, it's Jack at Bruce Gillingham Pollard\./);
  assert.ok(kycWhatsAppHref("07700 900123", text).startsWith("https://wa.me/447700900123?text="));
  assert.ok(kycWhatsAppHref("+44 7700 900123", text).startsWith("https://wa.me/447700900123?"));
  assert.ok(kycWhatsAppHref("0044 7700 900123", text).startsWith("https://wa.me/447700900123?"));
});

test("reminders: three days after sending, then seven; never for a finished, cancelled, expired, unsent or test request", () => {
  const sentAt = "2026-11-10T10:00:00.000Z";
  const base = { revoked_at: null, completed_at: null, expires_at: new Date("2026-11-24T10:00:00Z"), reminders_sent: 0, is_test: false, request: { sentAt } };
  assert.equal(reminderDue(base, new Date("2026-11-12T10:00:00Z")), false, "two days on");
  assert.equal(reminderDue(base, new Date("2026-11-13T10:00:00Z")), true, "three days on");
  assert.equal(reminderDue({ ...base, reminders_sent: 1 }, new Date("2026-11-15T10:00:00Z")), false, "five days on, after the first");
  assert.equal(reminderDue({ ...base, reminders_sent: 1 }, new Date("2026-11-17T10:00:00Z")), true, "seven days on");
  assert.equal(reminderDue({ ...base, reminders_sent: 2 }, new Date("2026-11-20T10:00:00Z")), false, "no third");
  assert.equal(reminderDue({ ...base, completed_at: new Date() }, new Date("2026-11-13T10:00:00Z")), false);
  assert.equal(reminderDue({ ...base, revoked_at: new Date() }, new Date("2026-11-13T10:00:00Z")), false);
  assert.equal(reminderDue({ ...base, is_test: true }, new Date("2026-11-13T10:00:00Z")), false);
  assert.equal(reminderDue({ ...base, request: { sentAt: null } }, new Date("2026-11-13T10:00:00Z")), false);
  assert.equal(reminderDue(base, new Date("2026-11-25T10:00:00Z")), false, "the link has run out");
});

test("the client checks' own switch: on unless KYC_CLIENT_CHECKS is off, and the staff addresses it lets through", () => {
  assert.equal(clientChecksSwitchOn(undefined), true);
  assert.equal(clientChecksSwitchOn(""), true);
  assert.equal(clientChecksSwitchOn("on"), true);
  assert.equal(clientChecksSwitchOn(" OFF "), false);
  assert.equal(clientChecksSwitchOn("off"), false);
  const through = (path: string) => KYC_CLIENT_CHECK_ROUTES.some(r => r.test(path));
  for (const path of ["/api/aml/deal/d1/client-checks", "/api/aml/deal/d1/client-checks/people", "/api/aml/deal/d1/client-checks/people/rename", "/api/aml/client-checks/tok", "/api/aml/client-checks/tok/remind", "/api/aml/poll-mailbox"]) assert.equal(through(path), true, path);
  for (const path of ["/api/aml/status", "/api/aml/deal/d1/cdd", "/api/aml/client-checks", "/api/aml/client-checks/tok/remind/x", "/api/kyc-upload/tok", "/api/aml/deal/d1/client-checks/people/x"]) assert.equal(through(path), false, path);
});

// ── 19 November 2026: each owner's own link ─────────────────────────────────

test("the person acting is asked to pass each owner their own link, by name", () => {
  const steps = kycSteps({ needsIdCheck: true, docs: ["proof_of_address", "authority"], askPep: true, kind: "company", ownLinksFor: ["Woody Bruce", "Huseyn Mirhadiyev"] });
  assert.deepEqual(steps.map(s => s.title), ["A quick identity check", "Pass each owner their own link", "Proof of address", "Confirmation you can act for the company", "One question about public roles"]);
  assert.match(steps[1].detail, /^Woody Bruce and Huseyn Mirhadiyev each do their own identity check and send a proof of address/);
  const reminder = kycReminderEmail({ ...ctx({ docs: ["proof_of_address"], ownLinksFor: ["Huseyn Mirhadiyev"] }), progress: { idDone: true, docsDone: [], ownersLinked: false } });
  const left = reminder.html.indexOf("Still needed");
  assert.ok(reminder.html.indexOf("Pass each owner their own link") > left);
});

test("an owner's own request says why they are asked, and the agents hear who still owes what", () => {
  const { html } = kycRequestEmail(ctx({ recipientName: "Huseyn Mirhadiyev", partyName: "BRUCE GILLINGHAM POLLARD LIMITED", kind: "individual",
    docs: ["proof_of_address"], person: { roles: ["owner"] } }));
  assert.match(html, /Companies House lists you as someone who owns or controls BRUCE GILLINGHAM POLLARD LIMITED/);
  assert.match(html, /about five minutes/);
  assert.doesNotMatch(html, /We're working with you on/);
  const finished = kycFinishedEmail({ recipientName: "Huseyn Mirhadiyev", partyName: "BRUCE GILLINGHAM POLLARD LIMITED", dealName: "12 Example Street", ref: "H2K9QP",
    dealLink: "https://chatbgp.app/deals/d1", idState: "approved", files: [], missing: [], sentFrom: "kyc@chatbgp.app", person: { roles: ["owner"] } });
  assert.match(finished.html, /as an owner of BRUCE GILLINGHAM POLLARD LIMITED/);
  const acting = kycFinishedEmail({ recipientName: "Jack Barratt", partyName: "BRUCE GILLINGHAM POLLARD LIMITED", dealName: "12 Example Street", ref: "7MJEGT",
    dealLink: "https://chatbgp.app/deals/d1", idState: "approved", files: [], missing: [], sentFrom: "kyc@chatbgp.app", kind: "company",
    peopleOutstanding: ["Huseyn Mirhadiyev: identity check and proof of address (link emailed)"] });
  assert.match(acting.html, /Still to come from the people to check for BRUCE GILLINGHAM POLLARD LIMITED/);
  assert.match(acting.html, /Huseyn Mirhadiyev: identity check and proof of address \(link emailed\)/);
});

test("clients read \"transaction\", never \"deal\" (Woody, 22 November 2026)", () => {
  const noDeal = (text: string) => assert.doesNotMatch(text, /\bdeals?\b(?!\s+with)/i);
  for (const e of [
    kycRequestEmail(ctx()), kycRequestEmail(ctx({ kind: "individual", docs: ["proof_of_address"] })),
    kycReminderEmail({ ...ctx(), progress: { idDone: false, docsDone: [] } }),
    kycIdCheckEmail({ recipientName: "Jane Smith", partyName: "Jane Smith", kind: "individual", dealName: "12 Example Street", link: "https://magic.veriff.me/v/abc", agents: [], sentFrom: "kyc@chatbgp.app" }),
  ]) noDeal(`${e.subject} ${e.html}`);
  noDeal(kycWhatsAppText({ recipientName: "Jane Smith", dealName: "12 Example Street", link: "https://chatbgp.app/kyc-upload/abc", expiresAt: "2026-12-01T12:00:00Z" }));
  assert.equal(kycPersonRoleWords(["joint"], "Jane Smith (private)"), "named on this transaction alongside Jane Smith");
  const page = readFileSync(new URL("../client/src/pages/kyc-upload.tsx", import.meta.url), "utf8")
    .split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.doesNotMatch(page, /\b(the|this|a|your|our) deal\b/i);
  assert.match(page, /Before the transaction can go ahead/);
});

test("the note is from whoever sent the request, never the first contact listed (Jack, 23 November 2026)", () => {
  const two = [{ name: "Charlotte Roberts", email: "charlotte@brucegillinghampollard.com", phone: null }, { name: "Jack Barratt", email: "jack@brucegillinghampollard.com", phone: null }];
  const html = kycRequestEmail(ctx({ note: "Hi Adam, as discussed. Thanks", noteFrom: "Jack Barratt", agents: two })).html;
  assert.match(html, /A note from Jack:/);
  assert.doesNotMatch(html, /A note from Charlotte/);
  assert.match(kycRequestEmail(ctx({ note: "Hello", agents: two })).html, /A note from Bruce Gillingham Pollard:/, "nobody named: never a guess");
});

test("clients are told to speak to the Nominated Officer alone, on every AML email and page", async () => {
  const { amlContact, resetAmlContactForTests } = await import("./aml-portal");
  const agents = [{ name: "Charlotte Roberts", email: "charlotte@brucegillinghampollard.com", phone: null }];
  resetAmlContactForTests({ name: "Jack Barratt", email: "jack@brucegillinghampollard.com", phone: "+44 (0)7788 215 044" });
  assert.deepEqual(amlContact(agents).map(a => a.name), ["Jack Barratt"]);
  const html = kycRequestEmail(ctx({ agents: amlContact(agents) })).html;
  assert.match(html, /Speak to <strong>Jack Barratt<\/strong>/);
  assert.doesNotMatch(html, /Charlotte/);
  resetAmlContactForTests(null);
  assert.deepEqual(amlContact(agents), agents, "no Nominated Officer set: the people the request holds");
  resetAmlContactForTests();
  const portal = readFileSync("server/aml-portal.ts", "utf8");
  const joint = readFileSync("server/joint-agent-checks.ts", "utf8");
  for (const [name, src] of [["aml-portal", portal], ["joint-agent-checks", joint]] as const) {
    assert.doesNotMatch(src, /agents: request\.agents|agents: agentList, askPep|agents, sentFrom/, name);
  }
  assert.match(portal, /export async function sendKycEmail\([\s\S]{0,200}?await primeAmlContact\(\);/);
  assert.match(portal, /export async function portalView\(row: TokenRow\): Promise<KycPortalView> \{\n  await primeAmlContact\(\);/);
});
