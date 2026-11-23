// A trust checked by BGP, never KYC4U (Jack, 23 November 2026: "Remove KYC4u
// on trusts. We need you to build the trust structuring").
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkTrustStructure, trustPersonOwesChecks, trustStructureGaps, trustStructureLines, trustRoleWords, type TrustStructure,
} from "../shared/trust-structure";
import { partyPeople } from "../shared/kyc-people";
import { chooseScreened, precheckAsks } from "../shared/kyc-prechecks";
import { TRUST_REQUEST_DOCS, defaultKycDocs, kycPersonRoleWords, kycReminderEmail, kycRequestEmail, trustDocsReadyEmail } from "../shared/kyc-request";
import { signOffDenial, signOffEnhanced, type SignOffFacts } from "../shared/party-kyc";
import { amlNextStep, type AmlBoxFacts } from "../shared/aml-box";

const structure = (over: Partial<TrustStructure> = {}): TrustStructure => {
  const checked = checkTrustStructure({
    kind: "discretionary", trsStatus: "registered", trsReference: "XATRUST80000001", settlorWealth: "Sale of the family business in 2003.",
    beneficiaryClass: "The settlor's children and remoter issue",
    people: [
      { name: "Margaret Ellis", roles: ["settlor"], dob: { month: 4, year: 1951 } },
      { name: "David Ellis", roles: ["trustee", "beneficiary"] },
      { name: "Sarah Ellis", roles: ["beneficiary"] },
      { name: "Ellis Trustees Limited", roles: ["trustee"], corporate: true, companyNumber: "01234567" },
    ],
    ...over,
  });
  if ("error" in checked) throw new Error(checked.error);
  return checked;
};

test("a structure is checked field by field: full names, a role each, the same person once", () => {
  assert.match((checkTrustStructure({ people: [{ name: "Margaret", roles: ["settlor"] }] }) as any).error, /full name/);
  assert.match((checkTrustStructure({ people: [{ name: "Margaret Ellis", roles: [] }] }) as any).error, /what Margaret Ellis is to the trust/);
  const s = checkTrustStructure({ kind: "nonsense", people: [{ name: "Margaret Ellis", roles: ["settlor"] }, { name: "ELLIS, Margaret", roles: ["trustee"] }] }) as TrustStructure;
  assert.equal(s.kind, "unknown");
  assert.equal(s.people.length, 1);
  assert.deepEqual(s.people[0].roles, ["settlor", "trustee"]);
  assert.equal(trustRoleWords(["trustee", "settlor", "beneficiary"]), "settlor, trustee and beneficiary");
});

test("who is verified: settlor, trustees, protector and control; beneficiaries only when not discretionary; a company never", () => {
  assert.equal(trustPersonOwesChecks({ roles: ["settlor"], corporate: false }, "discretionary"), true);
  assert.equal(trustPersonOwesChecks({ roles: ["beneficiary"], corporate: false }, "discretionary"), false);
  assert.equal(trustPersonOwesChecks({ roles: ["beneficiary"], corporate: false }, "fixed"), true);
  assert.equal(trustPersonOwesChecks({ roles: ["trustee"], corporate: true }, "fixed"), false);
});

test("what the file still needs: the structure recorded, then the deed and HMRC's registration", () => {
  assert.deepEqual(trustStructureGaps(null, { deed: false, trs: false }).map(g => g.key), ["structure", "deed", "trs_excerpt"]);
  assert.deepEqual(trustStructureGaps(structure(), { deed: true, trs: true }), []);
  const thin = checkTrustStructure({ kind: "fixed", trsStatus: "not_required", people: [{ name: "Margaret Ellis", roles: ["settlor"] }] }) as TrustStructure;
  assert.deepEqual(trustStructureGaps(thin, { deed: true, trs: false }).map(g => g.key), ["trustee", "beneficiaries", "wealth"]);
  assert.ok(trustStructureLines(structure(), "The Ellis Settlement").some(l => /Margaret Ellis: settlor, born 4\/1951/.test(l)));
});

test("People to check on a trust: the ones to verify each get a link; the rest are screened only", () => {
  const people = partyPeople({ companyId: "t1", kind: "company", precheck: null, requests: [], trust: structure() });
  assert.equal(people.basis, "trust");
  assert.deepEqual(people.people.map(p => [p.name, p.roles]), [["Margaret Ellis", ["settlor"]], ["David Ellis", ["trustee", "beneficiary"]]]);
  assert.equal(people.people[0].born, "April 1951");
  assert.deepEqual(people.people[0].outstanding, ["identity check", "proof of address"]);
  assert.deepEqual(people.trustNamed?.map(t => t.name), ["Sarah Ellis", "Ellis Trustees Limited"]);
  assert.ok(people.outstanding.some(o => o.startsWith("Margaret Ellis")));
  assert.equal(partyPeople({ companyId: "t1", kind: "company", precheck: null, requests: [], trust: null }).basis, "trust_unrecorded");
  assert.equal(kycPersonRoleWords(["settlor"], "The Ellis Settlement"), "the settlor of The Ellis Settlement");
});

test("the client checks for a trust ask for its own documents, and skip what the file holds", () => {
  assert.deepEqual(defaultKycDocs("company", "vendor", true, true), ["proof_of_address", "trust_deed", "trs_excerpt", "trust_authority", "trust_wealth"]);
  const asks = precheckAsks(null, { kind: "company", role: "purchaser", idCheck: true, contactName: "David Ellis", trust: { deed: true, trs: false, trsNotRequired: false, trustees: ["David Ellis"] } });
  assert.deepEqual(asks.docs, ["proof_of_address", "trs_excerpt", "trust_wealth", "source_of_funds"]);
  assert.deepEqual(asks.notAsked.map(n => n.key), ["trust_deed", "trust_authority"]);
});

test("screening a trust: the people on its structure in full, under reg 6", () => {
  const s = chooseScreened([
    { name: "The Ellis Settlement", role: "the company", person: false },
    { name: "Margaret Ellis", role: "settlor of the trust", person: true, trustPerson: true },
    { name: "Ellis Trustees Limited", role: "company on the trust (trustee)", person: false },
    { name: "Adam Harvey", role: "the deal's contact", person: true },
  ], { individual: false, listed: false, maxPeople: 10 });
  assert.equal(s.basis, "trust");
  assert.deepEqual(s.full.map(x => x.name), ["The Ellis Settlement", "Ellis Trustees Limited", "Margaret Ellis"]);
  assert.deepEqual(s.sanctionsOnly.map(x => x.name), ["Adam Harvey"]);
});

const facts = (over: Partial<SignOffFacts> = {}): SignOffFacts => ({
  rejected: false, current: null, withKyc4u: false, redFlags: 0, dealRedFlags: 0, unchecked: [], higherRisk: false,
  precheck: { ranAt: "2026-11-22T10:00:00Z" }, precheckRunning: false, clientChecksFinished: true, note: "", now: new Date("2026-11-23T10:00:00Z"),
  trust: true, trustGaps: [], ...over,
});
const note = "Deed and HMRC excerpt seen; settlor's wealth from a 2003 business sale, accountant's letter on file; all five screened clear.";

test("a trust is signed off by the officers in-house, whatever the switch, once its file is complete", () => {
  assert.ok(signOffEnhanced(facts()));
  // No KYC4U: a request raised earlier holds nothing up, and the switch need not be on.
  assert.equal(signOffDenial(facts({ withKyc4u: true, note })), null);
  assert.match(signOffDenial(facts({ trustGaps: ["Record the settlor"], note })) || "", /trust's file is not complete: Record the settlor/);
  assert.match(signOffDenial(facts({ clientChecksOutstanding: ["Margaret Ellis: identity check"], note })) || "", /still owe their checks/);
  assert.match(signOffDenial(facts({ note: "ok" })) || "", /say what was checked/);
});

test("the Next line for a trust: the structure first, never KYC4U", () => {
  const box: AmlBoxFacts = {
    role: "vendor", stage: "bgp_checked", due: true, approvedBy: null, expiresAt: null, notRequiredWords: null,
    company: true, companyMissing: false, gaps: [], askName: "David Ellis", precheckRunning: false, redFlags: 0, factors: 1,
    sanctionsOnly: false, clientChecks: false, request: null, people: [], kyc4u: "none", canSignOff: true, canDecide: true,
    signOffBlocked: null, needsNote: true, trust: true, trustGaps: ["Record the trustees"],
  };
  assert.equal(amlNextStep(box).action, "trust");
  assert.equal(amlNextStep({ ...box, trustGaps: [] }).action, "sign_off");
  assert.notEqual(amlNextStep({ ...box, trustGaps: [], kyc4u: "queued" }).action, "kyc4u_form");
});

// ── Reading the trust deed into the structure (23 November 2026) ─────────────
import { checkTrustDeedRead, mergeDeedReading } from "../shared/trust-deed-read";

const DEED = "THIS SETTLEMENT is made on 12 March 2004 BETWEEN Margaret Ellis (the Settlor) and David Ellis and Ellis Trustees Limited (the Original Trustees). " +
  "The Trustees shall hold the Trust Fund for such of the Beneficiaries as the Trustees in their absolute discretion think fit. " +
  "The Beneficiaries means the children and remoter issue of the Settlor. This Settlement shall be governed by the law of England and Wales.";

test("the deed reading keeps only what the deed's own words say", () => {
  const r = checkTrustDeedRead({
    kind: "discretionary", kindQuote: "as the Trustees in their absolute discretion think fit",
    established: "12 March 2004", establishedQuote: "made on 12 March 2004",
    governingLaw: "England and Wales", governingLawQuote: "governed by the law of England and Wales",
    beneficiaryClass: "The children and remoter issue of the Settlor", beneficiaryClassQuote: "the children and remoter issue of the Settlor",
    people: [
      { name: "Margaret Ellis", roles: ["settlor"], quote: "Margaret Ellis (the Settlor)" },
      { name: "David Ellis", roles: ["trustee"], quote: "David Ellis and Ellis Trustees Limited (the Original Trustees)" },
      { name: "Ellis Trustees Limited", roles: ["trustee"], corporate: true, quote: "Ellis Trustees Limited (the Original Trustees)" },
      { name: "Peter Ellis", roles: ["protector"], quote: "Peter Ellis shall be the Protector" },
      { name: "Sarah Ellis", roles: ["beneficiary"], quote: "Margaret Ellis (the Settlor)" },
    ],
  }, DEED);
  assert.equal(r.read, true);
  assert.equal(r.fields.kind, "discretionary");
  assert.equal(r.fields.established, "12 March 2004");
  assert.deepEqual(r.people.map(p => p.name), ["Margaret Ellis", "David Ellis", "Ellis Trustees Limited"]);
  assert.deepEqual(r.dropped.map(d => d.why), ["its words are not in the deed", "the deed's words given do not say it"]);
  // A scan: nothing to check against, so kept to check by eye.
  const scan = checkTrustDeedRead({ kind: "fixed", kindQuote: "in equal shares absolutely", people: [] }, null);
  assert.equal(scan.scanned, true);
  assert.equal(scan.lines[0].checked, null);
  assert.equal(checkTrustDeedRead({ kind: "fixed", kindQuote: "not in it at all", people: [] }, DEED).read, false);
});

test("the deed fills what is blank and adds people, never overwriting what a person recorded", () => {
  const read = checkTrustDeedRead({
    kind: "discretionary", kindQuote: "in their absolute discretion think fit",
    governingLaw: "England and Wales", governingLawQuote: "governed by the law of England and Wales",
    people: [
      { name: "Margaret Ellis", roles: ["settlor", "beneficiary"], quote: "Margaret Ellis (the Settlor)" },
      { name: "David Ellis", roles: ["trustee"], quote: "David Ellis and Ellis Trustees Limited" },
    ],
  }, DEED);
  const merged = mergeDeedReading(structure({ kind: "fixed", governingLaw: null, people: [{ name: "ELLIS, Margaret", roles: ["settlor"], dob: { month: 4, year: 1951 } }] }), read);
  assert.equal(merged.kind, "fixed");
  assert.equal(merged.governingLaw, "England and Wales");
  assert.equal(merged.trsStatus, "registered");
  assert.deepEqual(merged.people.map(p => [p.name, p.roles]), [["ELLIS, Margaret", ["settlor", "beneficiary"]], ["David Ellis", ["trustee"]]]);
  assert.equal(merged.people[0].dob?.year, 1951);
});

test("readTrustDeed sends the deed alone and checks the answer against its text", async () => {
  const { readTrustDeed } = await import("./trust-structure");
  let sent = "";
  const r = await readTrustDeed({ data: Buffer.from(DEED), name: "deed.txt", mime: "text/plain" }, "The Ellis Settlement", {
    hasKey: () => true, claim: async () => true,
    ask: async (_system, parts) => { sent = JSON.stringify(parts); return { input: { kind: "discretionary", kindQuote: "absolute discretion think fit", people: [] }, model: "test" }; },
  });
  assert.equal(r.read, true);
  assert.match(sent, /THIS SETTLEMENT/);
  assert.equal((await readTrustDeed({ data: Buffer.from(DEED), name: "deed.txt", mime: "text/plain" }, "X", { hasKey: () => true, claim: async () => false })).read, false);
  assert.match((await readTrustDeed({ data: Buffer.from(DEED), name: "deed.txt", mime: "text/plain" }, "X", { hasKey: () => false })).why || "", /not switched on/);
});

// Request trust structure (Jack, 23 November 2026: "Request Trust Structure and
// it then emails the trust's representative ... Once they upload, we need the
// documents to go somewhere and then be notified that are ready to undertake
// due diligence on").
const trustReq = (over: any = {}): any => ({
  token: "t", ref: "TR1", companyId: "t1", recipientName: "Adam Harvey", person: null, trustDocs: true, cancelled: false, expired: false,
  finished: false, sentAt: "2026-11-23T10:00:00Z", needsIdCheck: false, docs: TRUST_REQUEST_DOCS, ownerNames: [], idChecks: [], files: [], ...over,
});

test("the trust's representative is not a person to check, and a request for documents is never their own link", () => {
  const people = partyPeople({ companyId: "t1", kind: "company", precheck: null, requests: [trustReq()], trust: structure() });
  assert.ok(!people.people.some(p => p.name === "Adam Harvey"));
  // Even when the representative is a trustee, the request is not their identity check link.
  const asTrustee = partyPeople({ companyId: "t1", kind: "company", precheck: null, requests: [trustReq({ recipientName: "David Ellis" })], trust: structure() });
  const david = asTrustee.people.find(p => p.name === "David Ellis")!;
  assert.equal(david.own, null);
  assert.deepEqual(david.outstanding, ["identity check", "proof of address"]);
  // An ordinary request to the person acting still names them.
  const acting = partyPeople({ companyId: "t1", kind: "company", precheck: null, requests: [trustReq({ trustDocs: false })], trust: structure() });
  assert.ok(acting.people.some(p => p.name === "Adam Harvey" && p.roles.includes("acting")));
});

test("the request asks for the trust's documents in plain words, and the ready note goes to due diligence", () => {
  assert.deepEqual(TRUST_REQUEST_DOCS, ["trust_deed", "trust_people", "trs_excerpt", "trust_wealth", "trust_authority"]);
  const base = {
    recipientName: "Adam Harvey", partyName: "URC Thames North Trust", kind: "company" as const, dealName: "Fortis Green Tennis Club", ref: "7K2Q9M",
    link: "https://chatbgp.app/kyc-upload/x", expiresAt: new Date("2026-12-23"), needsIdCheck: false, docs: TRUST_REQUEST_DOCS, agents: [], sentFrom: "kyc@chatbgp.app",
    askPep: false, purpose: "trust_structure" as const,
  };
  const ask = kycRequestEmail(base);
  assert.equal(ask.subject, "Documents about URC Thames North Trust for Fortis Green Tennis Club [7K2Q9M]");
  assert.match(ask.html, /Who is who in the trust/);
  assert.match(ask.html, /Upload the documents/);
  assert.doesNotMatch(ask.html, /identity checks|public role/i);
  assert.match(kycReminderEmail({ ...base, progress: { idDone: false, docsDone: ["trust_deed"] } }).subject, /^Reminder: documents about URC Thames North Trust/);
  const ready = trustDocsReadyEmail({
    recipientName: "Adam Harvey", partyName: "URC Thames North Trust", dealName: "Fortis Green Tennis Club", ref: "7K2Q9M", dealLink: "https://chatbgp.app/deals/1",
    sentFrom: "kyc@chatbgp.app", files: [{ name: "deed.pdf", docKey: "trust_deed" }], missing: ["HMRC's proof of registration"],
    deed: { read: true, values: 6, people: 4, why: null },
  });
  assert.match(ready.subject, /^Ready for due diligence: URC Thames North Trust's trust documents/);
  assert.match(ready.html, /read into a draft structure: 4 people named/);
  assert.match(ready.html, /HMRC&#39;s proof of registration|HMRC's proof of registration/);
});

test("every request email offers certified copies with both lists (Jack, 23 November 2026)", () => {
  const base = {
    recipientName: "Adam Harvey", partyName: "Acme Ltd", dealName: "1 High Street", ref: "7K2Q9M", link: "https://chatbgp.app/kyc-upload/x",
    expiresAt: new Date("2026-12-07"), needsIdCheck: true, docs: ["proof_of_address"] as any, agents: [], sentFrom: "kyc@chatbgp.app", askPep: true,
  };
  const company = kycRequestEmail({ ...base, kind: "company" as any }).html;
  assert.match(company, /Or send certified copies/);
  assert.match(company, /anyone who owns more than 25% of the company/);
  assert.match(company, /List A<\/strong> \(one, certified\)/);
  assert.match(company, /Who can certify: a solicitor, lawyer or notary public, a chartered accountant, or a bank or building society official/);
  assert.match(company, /sign and date it, and print their name, occupation, address and telephone number/);
  assert.match(company, /residence permit issued by the Home Office/);
  assert.match(company, /council tax bill less than 3 months old/);
  const person = kycRequestEmail({ ...base, kind: "individual" as any }).html;
  assert.match(person, /upload certified copies instead/);
  assert.doesNotMatch(person, /25%/);
  const trust = kycRequestEmail({ ...base, kind: "company" as any, needsIdCheck: false, askPep: false, docs: [...TRUST_REQUEST_DOCS], purpose: "trust_structure" }).html;
  assert.match(trust, /What happens next/);
  assert.match(trust, /gets an email from us with their own secure link/);
  assert.match(trust, /List B<\/strong> \(one\)/);
  // Optional: not one of the trust request's own documents.
  assert.equal(TRUST_REQUEST_DOCS.includes("certified_ids" as any), false);
});

test("an officer's acceptance of certified documents clears what a person owes", () => {
  const people = partyPeople({
    companyId: "c1", kind: "individual", precheck: null,
    requests: [{ token: "t", ref: "R1", companyId: "c1", recipientName: "Jane Doe", person: null, cancelled: false, expired: false, finished: false, sentAt: null, needsIdCheck: true, docs: ["proof_of_address"], ownerNames: [], idChecks: [], files: [] }],
    publicFigures: [{ id: "1", name: "Jane Doe", note: "passport certified by a solicitor", by: "Jack Barratt", at: "2026-11-23T10:00:00Z", links: [], documents: 2, method: "certified" }],
  } as any);
  const jane = people.people.find(p => /jane/i.test(p.name))!;
  assert.deepEqual(jane.outstanding, []);
  assert.equal(jane.publicFigure?.method, "certified");
});
