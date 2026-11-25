// Documents BGP uploads on a party (Woody, 23 November 2026: "upload
// documents ... drag and drop ... so can upload certified documents, the app
// must read these and check they are acceptable"). The rules are
// shared/kyc-documents.ts; the reader is server/kyc-documents.ts.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  certificationGaps, certifierGroup, certifierRefusal, checkKycDocument, cleanKycDocumentReading, unreadableKycDocument, uploadCountsFor,
  type KycDocumentReading, type KycUploadEvidence,
} from "../shared/kyc-documents";
import { partyPeople, type PartyPeopleInput } from "../shared/kyc-people";
import { readKycDocument } from "./kyc-documents";

const TODAY = new Date("2026-11-23T12:00:00Z");
const passport = (over: Partial<KycDocumentReading> = {}): KycDocumentReading => ({
  readAt: "2026-11-23T10:00:00Z", read: true, unreadable: null, kind: "passport", kindWords: "British passport", issuer: "HM Passport Office",
  names: ["HUSEYN MIRHADIYEV"], dob: "1982-02-14", issued: "2022-04-01", expires: "2032-04-01", date: null, address: null,
  certified: true, certification: { words: "Certified to be a true copy of the original seen by me", name: "Sarah Price", profession: "Solicitor", firm: "Price & Co", date: "2026-11-20", address: "1 High Street, London N10 1AA", phone: "020 7946 0000", signed: true },
  ...over,
});
const people = [{ name: "Huseyn Mirhadiyev", dob: { year: 1982, month: 2 } }, { name: "Woody Bruce", dob: { year: 1976, month: 5 } }];
const opts = { uploadedAt: "2026-11-23T10:00:00Z", seenOriginal: false, today: TODAY };

test("a reader's answer is cleaned: known kinds only, real dates, a certification only when certified", () => {
  const r = cleanKycDocumentReading({
    kind: "passport", kindWords: "  British   passport ", names: ["HUSEYN MIRHADIYEV", 7, ""], dob: "1982-02-14", expires: "2032-13-40",
    certified: true, certification: { name: "Sarah Price", profession: "Solicitor", date: "2026-11-20", words: "true copy" },
  }, "2026-11-23T10:00:00Z");
  assert.equal(r.kind, "passport");
  assert.equal(r.kindWords, "British passport");
  assert.deepEqual(r.names, ["HUSEYN MIRHADIYEV"]);
  assert.equal(r.dob, "1982-02-14");
  assert.equal(r.expires, null, "not a real date");
  assert.equal(r.certification?.name, "Sarah Price");
  assert.equal(cleanKycDocumentReading({ kind: "spaceship", names: [], certified: false, certification: { name: "x" } }, "t").kind, null);
  assert.equal(cleanKycDocumentReading({ kind: "passport", names: [], certified: false, certification: { name: "x" } }, "t").certification, null);
});

test("a certified passport in date names one person to check: it counts for their identity", () => {
  const c = checkKycDocument(passport(), people, opts);
  assert.equal(c.use, "identity");
  assert.equal(c.person, "Huseyn Mirhadiyev");
  assert.equal(c.ok, true, c.reasons.join("; "));
  assert.match(c.summary, /British passport, Huseyn Mirhadiyev, expires 1 Apr 2032, certified by Sarah Price/);
});

test("an identity document is held back: expired, not certified, a certification short of what the policy asks, someone else, another date of birth", () => {
  assert.match(checkKycDocument(passport({ expires: "2025-01-01" }), people, opts).reasons.join(" "), /It expired on 1 Jan 2025/);
  assert.match(checkKycDocument(passport({ certified: false, certification: null }), people, opts).reasons.join(" "), /Not a certified copy/);
  assert.equal(checkKycDocument(passport({ certified: false, certification: null }), people, { ...opts, seenOriginal: true }).ok, true, "an agent saw the original");
  assert.deepEqual(certificationGaps({ words: null, name: "Sarah Price", profession: null, firm: null, date: null }),
    ["the words that it is a true copy of the original", "their occupation", "the date", "their address", "their telephone number"]);
  assert.match(checkKycDocument(passport({ certification: { words: "Certified true copy of the original", name: null, profession: "Solicitor", firm: null, date: "2026-11-20", address: "1 High St", phone: "020 7946 0000", signed: true } }), people, opts).reasons.join(" "), /does not give the certifier's name$/);
  assert.match(checkKycDocument(passport({ names: ["JANE DOE"] }), people, opts).reasons.join(" "), /not one of the people to check/);
  const wrongDob = checkKycDocument(passport({ dob: "1990-01-01" }), people, opts);
  assert.equal(wrongDob.ok, false);
  assert.match(wrongDob.reasons.join(" "), /does not match Huseyn Mirhadiyev's at Companies House/);
  assert.match(checkKycDocument(passport({ expires: null }), people, opts).reasons.join(" "), /No expiry date found/);
});

test("a proof of address is set against the person it names by the proof of address rules", () => {
  const bill: KycDocumentReading = { ...passport(), kind: "utility_bill", kindWords: "Thames Water bill", names: ["MR H MIRHADIYEV"], dob: null, expires: null, date: "2026-10-30", address: "1 Example Road", certified: false, certification: null };
  const c = checkKycDocument(bill, people, opts);
  assert.equal(c.use, "address");
  assert.equal(c.person, "Huseyn Mirhadiyev");
  assert.equal(c.ok, true, c.reasons.join("; "));
  const old = checkKycDocument({ ...bill, date: "2026-01-01" }, people, opts);
  assert.equal(old.ok, false);
  assert.match(old.reasons.join(" "), /more than three months before it was sent/);
});

test("company documents are kept on the record; a file not read says why", () => {
  const cert = checkKycDocument({ ...passport(), kind: "certificate_of_incorporation", kindWords: "Certificate of incorporation", names: ["BILL'S RESTAURANTS LIMITED"] }, people, opts);
  assert.equal(cert.use, "company");
  assert.equal(cert.ok, true);
  const none = checkKycDocument(unreadableKycDocument("the file is empty", "t"), people, opts);
  assert.equal(none.ok, false);
  assert.match(none.reasons[0], /Could not be read: the file is empty/);
});

test("an upload that passes, or that an officer accepted, counts for the person on the people to check", () => {
  const up = (reading: KycDocumentReading, accepted: KycUploadEvidence["accepted"] = null): KycUploadEvidence => ({
    documentId: "d1", fileName: "passport.pdf", uploadedAt: "2026-11-23T10:00:00Z", seenOriginal: false, reading, accepted,
  });
  assert.deepEqual(uploadCountsFor(up(passport()), people[0], TODAY), ["identity"]);
  assert.deepEqual(uploadCountsFor(up(passport()), people[1], TODAY), [], "not their passport");
  assert.deepEqual(uploadCountsFor(up(passport({ certified: false, certification: null })), people[0], TODAY), []);
  assert.deepEqual(uploadCountsFor(up(passport({ certified: false, certification: null }), { by: "Jack Barratt", at: "t", note: "Original seen at the meeting" }), people[0], TODAY), ["identity"]);
  // A photocard driving licence that shows an address verifies both (HMRC AMLG11400 14.2; 25 November 2026).
  const licence = passport({ kind: "driving_licence", kindWords: "UK photocard driving licence", address: "12 High Street, Guildford GU1 3AA" });
  assert.deepEqual(uploadCountsFor(up(licence), people[0], TODAY), ["identity", "address"]);
  assert.deepEqual(uploadCountsFor(up({ ...licence, address: null }), people[0], TODAY), ["identity"], "no address read on it");

  const input: PartyPeopleInput = {
    companyId: "brand", kind: "individual", precheck: null,
    requests: [{ token: "t", ref: "ABC123", companyId: "brand", recipientName: "Huseyn Mirhadiyev", person: null, cancelled: false, expired: false, finished: false,
      sentAt: "2026-11-20T10:00:00Z", needsIdCheck: false, docs: ["photo_id", "proof_of_address"], ownerNames: [], idChecks: [], files: [] }],
    uploads: [up(passport()), { ...up({ ...passport(), kind: "utility_bill", kindWords: "Thames Water bill", names: ["MR H MIRHADIYEV"], dob: null, expires: null, date: "2026-10-30", certified: false, certification: null }), documentId: "d2" }],
    today: TODAY,
  };
  const person = partyPeople(input).people.find(p => p.name === "Huseyn Mirhadiyev");
  assert.ok(person);
  assert.equal(person!.id.state, "document");
  assert.equal(person!.id.ref, "upload");
  assert.equal(person!.address.done, true);
  assert.deepEqual(person!.outstanding, []);
});

test("the reader is sent the file, keeps its own shape, and says why it could not read", async () => {
  const file = { buffer: Buffer.from("%PDF-1.4 test"), mime: "application/pdf", name: "passport.pdf" };
  const off = await readKycDocument(file, { hasKey: () => false });
  assert.equal(off.read, false);
  assert.match(off.unreadable || "", /not switched on/);
  const spent = await readKycDocument(file, { hasKey: () => true, claim: async () => false });
  assert.match(spent.unreadable || "", /allowance/);
  let sent: unknown[] = [];
  const read = await readKycDocument(file, {
    hasKey: () => true, claim: async () => true,
    ask: async (_system, parts) => { sent = parts; return { input: { kind: "passport", names: ["HUSEYN MIRHADIYEV"], certified: false }, model: "m" }; },
  });
  assert.equal(read.read, true);
  assert.equal(read.kind, "passport");
  assert.equal((sent[0] as any)?.type, "document", "the PDF itself, nothing else");
});

test("who may certify: solicitors, lawyers and notaries, chartered accountants, bank and building society officials; HMRC's details are all needed", () => {
  const full = passport().certification!;
  const by = (profession: string | null, firm: string | null = null) => checkKycDocument(passport({ certification: { ...full, profession, firm } }), people, opts);
  for (const p of ["Solicitor", "Notary Public", "Lawyer", "Barrister", "Chartered Accountant", "Chartered Certified Accountant", "FCA", "Bank official", "Branch manager, Nationwide Building Society"]) {
    assert.equal(by(p).ok, true, p);
  }
  assert.equal(by(null, "Price & Co Solicitors").ok, true, "the firm says it");
  assert.equal(by("Manager", "Barclays Bank plc").ok, true);
  for (const p of ["Accountant", "Teacher", "Councillor", "Dentist", "Estate agent"]) {
    const c = by(p);
    assert.equal(c.ok, false, p);
    assert.match(c.reasons.join(" "), /BGP accepts a solicitor, lawyer or notary public, a chartered accountant, or a bank or building society official/);
  }
  assert.equal(certifierGroup("chartered accountant"), "accountant");
  assert.equal(certifierGroup("financial adviser"), null);
  assert.equal(certifierRefusal({ ...full, profession: null, firm: null }), null, "no occupation is a gap, said once");
  const gaps = (over: object) => checkKycDocument(passport({ certification: { ...full, ...over } }), people, opts).reasons.join(" ");
  assert.match(gaps({ address: null }), /does not give their address/);
  assert.match(gaps({ phone: null }), /their telephone number/);
  assert.match(gaps({ signed: false }), /the certifier's signature/);
  assert.match(gaps({ words: "Seen by me" }), /the words that it is a true copy/);
  const old = { words: "true copy", name: "Sarah Price", profession: "Solicitor", firm: null, date: "2026-11-20" };
  assert.match(checkKycDocument(passport({ certification: old }), people, opts).reasons.join(" "), /their address, their telephone number/, "a reading from before the rule is read again");
  const r = cleanKycDocumentReading({ kind: "passport", names: [], certified: true, certification: { name: "S", address: " 1 High St ", phone: "020", signed: true } }, "t");
  assert.deepEqual([r.certification?.address, r.certification?.phone, r.certification?.signed], ["1 High St", "020", true]);
});

// Our signed terms of engagement show the authority to act (Woody, 25 November
// 2026: "make them count"; HMRC AMLG11400 14.7: "Legal or contractual documentation").
test("signed terms of engagement count as the authority to act; unsigned ones wait for an officer", async () => {
  const { authorityFromTerms } = await import("../shared/kyc-documents");
  const { precheckAsks } = await import("../shared/kyc-prechecks");
  const terms = (over: Partial<KycDocumentReading> = {}): KycDocumentReading => ({
    ...passport(), kind: "terms_of_engagement", kindWords: "Terms of engagement", names: ["Acme Holdings Limited"], dob: null, expires: null,
    issued: null, date: "2026-11-01", certified: false, certification: null, signed: true, ...over,
  });
  const signed = checkKycDocument(terms(), people, { uploadedAt: "2026-11-23T10:00:00Z", seenOriginal: false, today: TODAY });
  assert.equal(signed.use, "authority");
  assert.equal(signed.ok, true);
  assert.equal(signed.summary, "Terms of engagement, Acme Holdings Limited, 1 Nov 2026, signed");
  assert.deepEqual(checkKycDocument(terms({ signed: false }), people, { uploadedAt: "2026-11-23T10:00:00Z", seenOriginal: false, today: TODAY }).reasons, ["Not signed"]);
  assert.deepEqual(checkKycDocument(terms({ signed: null }), people, { uploadedAt: "2026-11-23T10:00:00Z", seenOriginal: false, today: TODAY }).reasons, ["No signature found on it: check it is signed"]);
  const up = (reading: KycDocumentReading, accepted: KycUploadEvidence["accepted"] = null, id = "t1"): KycUploadEvidence => ({
    documentId: id, fileName: "terms.pdf", uploadedAt: "2026-11-23T10:00:00Z", seenOriginal: false, reading, accepted,
  });
  assert.equal(authorityFromTerms([up(terms())], TODAY)?.documentId, "t1");
  assert.equal(authorityFromTerms([up(terms({ signed: null }))], TODAY), null, "not seen to be signed");
  assert.equal(authorityFromTerms([up(terms({ signed: null }), { by: "Jack Barratt", at: "t", note: "DocuSign certificate seen" })], TODAY)?.documentId, "t1", "an officer accepted it");
  assert.equal(authorityFromTerms([up(passport())], TODAY), null, "not terms of engagement");
  // An upload never counts for a person's identity or address.
  assert.deepEqual(uploadCountsFor(up(terms()), people[0], TODAY), []);
  // With them on file, the client checks do not ask for a director's confirmation.
  const asks = precheckAsks(null, { kind: "company", role: "landlord", idCheck: true, contactName: "Sam Lee", termsOfEngagement: signed.summary });
  assert.ok(!asks.docs.includes("authority"));
  assert.match(asks.notAsked.find(n => n.key === "authority")!.reason, /Our signed terms of engagement are on file \(Terms of engagement, Acme Holdings Limited, 1 Nov 2026, signed\): HMRC accepts them as evidence of authority to act\./);
  const trust = precheckAsks(null, { kind: "company", role: "vendor", idCheck: true, contactName: "Sam Lee", trust: { deed: false, trs: false, trsNotRequired: false, trustees: [] }, termsOfEngagement: "Terms of engagement, signed" });
  assert.ok(!trust.docs.includes("trust_authority"));
  const body = precheckAsks(null, { kind: "company", role: "landlord", idCheck: true, contactName: "Sam Lee", publicBody: true, termsOfEngagement: "Terms of engagement, signed" });
  assert.deepEqual(body.docs, []);
  assert.ok(precheckAsks(null, { kind: "company", role: "landlord", idCheck: true, contactName: "Sam Lee" }).docs.includes("authority"), "without them, still asked");
});
