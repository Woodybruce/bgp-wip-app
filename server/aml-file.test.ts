// The officers' AML file (Woody, 20 November 2026: "an option for the AML
// officers to generate a report to include all the documents etc which we can
// then send to HMRC if asked? Also we can send to KYC4U"). Rules:
// shared/aml-file.ts; the file: server/aml-file.ts.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import { amlFileDocWords, amlFileName, amlFileSafeName, amlFileStateWords } from "../shared/aml-file";
import { renderAmlReport, type AmlFileData } from "./aml-file";

test("documents are named in words, and any name is safe for a file or folder", () => {
  assert.equal(amlFileDocWords("proof_of_address"), "Proof of address");
  assert.equal(amlFileDocWords("company_cert"), "Certificate of incorporation");
  assert.equal(amlFileDocWords("onfido_report"), "Identity check result");
  assert.equal(amlFileDocWords("bank_reference"), "Bank reference");
  assert.equal(amlFileDocWords(null), "Document");
  assert.equal(amlFileSafeName('BGP / "Ltd": a*b?c<d>e|f'), "BGP - -Ltd- a-b-c-d-e-f");
  assert.equal(amlFileSafeName("name. "), "name");
  assert.equal(amlFileSafeName(""), "file");
  // Plain ASCII: a browser drops a download name it does not like (20 November 2026).
  assert.equal(amlFileSafeName("Café Rouge – Əliyev’s “Ltd”"), "Cafe Rouge - Eliyev's -Ltd-");
  assert.equal(amlFileSafeName("Westgate Test Centre – RU10 Test"), "Westgate Test Centre - RU10 Test");
  assert.ok(amlFileSafeName("x".repeat(500)).length <= 110);
});

test("the file is named for the party, the deal's Ref and the London day", () => {
  const data = { deal: { name: "55 Wells Street", ref: "4507" }, parties: [{ brand: { name: "brucecap" }, company: { name: "BRUCE CAP LTD" } }], madeAt: "2026-11-20T23:30:00Z" };
  assert.equal(amlFileName(data, "folder"), "AML file - BRUCE CAP LTD - Ref 4507 - 2026-11-20");
  assert.equal(amlFileName(data, "report"), "AML report - BRUCE CAP LTD - Ref 4507 - 2026-11-20");
  // Every party: the deal names it.
  const both = { ...data, parties: [...data.parties, { brand: { name: "bruce gillingham pollard" }, company: null }] };
  assert.equal(amlFileName(both, "folder"), "AML file - 55 Wells Street - Ref 4507 - 2026-11-20");
  // Late in the London evening of a summer day is still that day.
  assert.equal(amlFileName({ ...data, madeAt: "2026-07-01T23:30:00Z" }, "folder"), "AML file - BRUCE CAP LTD - Ref 4507 - 2026-07-02");
});

test("where a party stands, in words", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const approved = amlFileStateWords({ status: "approved", expiresAt: "2029-11-20T00:00:00Z", approvedBy: "Jack Barratt", approvedAt: "2026-11-20T10:00:00Z", name: "BRUCE CAP LTD", source: "company" }, null, now);
  assert.equal(approved.tone, "done");
  assert.equal(approved.words, "Approved by Jack Barratt on 20 Nov 2026 (on BRUCE CAP LTD), valid until 20 Nov 2029");
  assert.equal(amlFileStateWords({ status: "approved", expiresAt: "2026-01-01T00:00:00Z", approvedBy: null }, null, now).tone, "flag");
  assert.equal(amlFileStateWords({ status: "rejected", expiresAt: null, approvedBy: null }, { reasonWords: "x", by: null, at: null }, now).words, "Rejected", "a rejection is never hidden by Not required");
  assert.match(amlFileStateWords(null, { reasonWords: "The other side of a deal a joint agent negotiated", by: "Jack Barratt", at: "2026-11-19T10:00:00Z" }, now).words, /^Not required: The other side/);
  assert.equal(amlFileStateWords({ status: null, expiresAt: null, approvedBy: null }, null, now).words, "Not approved yet");
});

const sample: AmlFileData = {
  deal: { id: "d1", name: "55 Wells Street", ref: "4507", type: "New Letting", status: "SOL", property: "55 Wells Street, W1T 3PT", agents: ["Woody Bruce"], rentPa: 300000 },
  regime: { regime: "full", why: "A letting at £10,000 a month or more: full checks on every party (MLR 2017)." },
  agents: [{ roleWords: "Joint agent", name: "Savills", words: "On HMRC's register (checked 20 Nov 2026)." }],
  dealFlags: [], dealAside: [], unchecked: [],
  parties: [{
    role: "landlord",
    brand: { id: "b1", name: "brucecap", number: null },
    company: { id: "e1", name: "BRUCE CAP LTD", number: "10832027" },
    person: { name: "Woody Bruce", email: "woody@example.com" },
    individual: false,
    state: { status: "in_review", expiresAt: null, approvedBy: null, name: "BRUCE CAP LTD", source: "company" },
    notRequired: null,
    precheck: {
      state: "done", ranAt: "2026-11-20T09:00:00Z", errors: [],
      lines: [{ label: "Companies House: active, 1 owner", state: "ok", detail: null, links: [] }, { label: "Possible namesakes to check: 2", state: "info", detail: "Mehmet Əliyev (no date of birth on the profile)", links: [{ label: "Profile", url: "https://example.com/p" }] }],
      company: { name: "BRUCE CAP LTD", number: "10832027", status: "active", type: "Private limited company", incorporatedOn: "22 Jun 2017", registeredOffice: "101 New Cavendish Street, London W1W 6XH", business: ["Management of real estate"], listing: null, listingNote: null, directors: ["BRUCE, Woody"], owners: [{ name: "Mr Woody Bruce", control: "more than 75% of the shares" }], ownerNote: null, chain: [], accounts: "Made up to 30 June 2025", warnings: [], documents: [], registerUrl: "https://find-and-update.company-information.service.gov.uk/company/10832027" },
    },
    flags: [{ kind: "provider_screen", label: "Adverse media: Woody Bruce", detail: null, source: "ComplyAdvantage", at: "2026-11-20T09:00:00Z", key: "ca:woody", evidence: ["x"], facts: [{ label: "Profile", value: "Woody Bruce", url: "https://example.com" }] } as any],
    aside: [],
    level: { level: "enhanced", why: ["Adverse media: Woody Bruce"], toWeigh: [], recheckYears: 1 },
    people: null,
    requests: [{ ref: "4YTTES", status: "finished", recipientName: "Woody Bruce", recipientEmail: "woody@example.com", sentAt: "2026-11-19T17:22:00Z", sentBy: "Jack Barratt", sentFrom: "kyc@brucegillinghampollard.com", openedAt: null, finishedAt: "2026-11-19T18:00:00Z", remindersSent: 0, needsIdCheck: true, idState: "approved", docs: [{ key: "proof_of_address", title: "Proof of address", done: true }], askPep: true, pep: "no", files: [{ name: "bill.pdf", uploadedAt: "2026-11-19T17:50:00Z" }], notAsked: [] }],
    kyc4u: { drafts: [], records: [] },
    history: [{ at: "2026-11-19T17:22:00Z", who: "Jack Barratt", what: "client checks sent", detail: "Sent to Woody Bruce" }],
    documents: [{ id: "k1", type: "company_accounts", name: "Accounts.pdf", at: "2026-11-20T09:00:00Z", note: null, url: "/api/chat-media/x.pdf", mime: "application/pdf", size: 1000, onCompany: true }],
    unread: ["KYC4U's records"],
  }],
  madeBy: "Jack Barratt",
  madeAt: "2026-11-20T10:00:00Z",
};

test("the report renders as a PDF, names outside Latin-1 included", async () => {
  const pdf = await renderAmlReport(sample, new Map([["landlord:k1", "documents/01 Accounts - Accounts.pdf"]]));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 3000, `a real report, not an empty page (${pdf.length} bytes)`);
});
