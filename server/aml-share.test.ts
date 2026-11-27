import test from "node:test";
import assert from "node:assert/strict";
import { SHARE_NOT_RELIANCE, shareCoverLines, shareOffered, sharePackInput, shareStatement, shareTicked } from "../shared/aml-share";
import { amlSharePackEmail } from "../shared/kyc-request";

const facts = { type: "proof_of_address", name: "bill.pdf", at: "2026-11-20T10:00:00Z", veriff: false, seenOriginal: false, uploadedBy: null, certifiedBy: null };

test("BGP's own working is never offered for a pack", () => {
  for (const t of ["aml_file", "screening_report", "web_source", "kyc4u_report", "credit_report", "reliance_letter"]) assert.equal(shareOffered(t), false, t);
  for (const t of ["passport", "proof_of_address", "ch_register_excerpt", "certified_id", "structure_chart"]) assert.equal(shareOffered(t), true, t);
});

test("identity, address and the register are ticked to start with", () => {
  assert.equal(shareTicked({ type: "proof_of_address", veriff: false }), true);
  assert.equal(shareTicked({ type: "onfido_report", veriff: true }), true);
  assert.equal(shareTicked({ type: "structure_chart", veriff: false }), false);
});

test("each statement says only what BGP can say", () => {
  assert.match(shareStatement(facts), /Copy supplied to BGP on 20 Nov 2026 and checked by BGP\. BGP has not seen the original\./);
  assert.match(shareStatement({ ...facts, seenOriginal: true, uploadedBy: "Jack Barratt" }), /Original seen by Jack Barratt of BGP/);
  assert.match(shareStatement({ ...facts, type: "onfido_report", veriff: true }), /verified electronically by Veriff/);
  assert.match(shareStatement({ ...facts, type: "ch_register_excerpt" }), /From Companies House/);
  assert.match(shareStatement({ ...facts, certifiedBy: "A Smith, solicitor" }), /certified by A Smith, solicitor/);
});

test("the cover sheet lists the documents and says it is not reliance", () => {
  const lines = shareCoverLines({
    partyName: "ACME LIMITED", partyRole: "Purchaser", companyNumber: "01234567", transaction: "1 High Street", toName: "Sam Jones", firm: "Savills",
    sentBy: "Jack Barratt", sentOn: "27 November 2026", documents: [{ file: "02 Proof of address - bill.pdf", type: "proof_of_address", statement: shareStatement(facts) }], note: null,
  });
  const all = lines.map(l => [l.head, l.label, l.value, l.para].filter(Boolean).join(" ")).join("\n");
  assert.match(all, /ACME LIMITED/);
  assert.match(all, /1\. Proof of address/);
  assert.ok(all.includes(SHARE_NOT_RELIANCE));
});

test("a pack needs an address and a document", () => {
  assert.equal(sharePackInput({ toEmail: "nope", documentIds: ["1"] }).ok, false);
  assert.equal(sharePackInput({ toEmail: "a@b.co.uk", documentIds: [] }).ok, false);
  const ok = sharePackInput({ toEmail: " A@B.co.uk ", documentIds: ["1", "1", "2"], toName: " Sam " });
  assert.ok(ok.ok && ok.toEmail === "a@b.co.uk" && ok.documentIds.length === 2 && ok.toName === "Sam");
});

test("the email names the party, carries the link and says it is not reliance", () => {
  const e = amlSharePackEmail({
    toName: "Sam Jones", partyName: "ACME LIMITED", partyRoleWords: "the purchaser", place: "1 High Street", senderName: "Jack Barratt", sentFrom: "kyc@brucegillinghampollard.com",
    files: ["01 Cover sheet.pdf"], attached: false, link: "https://chatbgp.app/api/kyc-upload/pack/abc", expiresAt: "2026-12-11T10:00:00Z", note: null, notReliance: SHARE_NOT_RELIANCE, dataUse: "x",
  });
  assert.match(e.subject, /KYC documents for ACME LIMITED: 1 High Street/);
  assert.ok(e.html.includes("https://chatbgp.app/api/kyc-upload/pack/abc"));
  assert.match(e.html, /too large to attach/);
  assert.match(e.html, /not agreeing that you may rely/);
  assert.ok(!/\bdeal\b/i.test(e.html));
});
