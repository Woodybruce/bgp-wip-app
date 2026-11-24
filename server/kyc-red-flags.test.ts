// Red flags (17 November 2026): what in BGP's own checks sends a party to
// KYC4U. Woody: "basically we do the normal checks expected and if there is a
// red flag then we get KYC4U". The rules are shared/kyc-red-flags.ts.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import { FLAG_REVIEW_COMMENT_MIN, applyFlagReviews, dealRedFlags, flagReviewComment, partyRedFlags, pepStatusLabel, redFlagAlertKey, redFlagNote, type PartyRedFlagFacts } from "../shared/kyc-red-flags";
import { KYC_LOGO_CID, kycFinishedEmail, kycRedFlagEmail } from "../shared/kyc-request";

const facts = (over: Partial<PartyRedFlagFacts> = {}): PartyRedFlagFacts => ({
  company: null, latestInvestigation: null, requests: [], idChecks: [], ...over,
});

test("a clean party has no red flags", () => {
  assert.deepEqual(partyRedFlags(facts()), []);
  assert.deepEqual(partyRedFlags(facts({
    company: { aml_pep_status: "clear", aml_risk_level: "low", aml_edd_required: false },
    latestInvestigation: { sanctions_match: false, conducted_at: "2026-11-01" },
    requests: [{ ref: "7K2Q9M", answers: { pep: "no", pepDetail: null, answeredAt: "2026-11-17T10:00:00Z" } }],
    idChecks: [{ status: "approved" }, { status: "resubmission_requested" }, { status: "expired" }],
  })), []);
  assert.deepEqual(dealRedFlags(null), []);
  assert.deepEqual(dealRedFlags({ aml_pep_status: "clear", aml_risk_level: "medium" }), []);
});

test("the client's yes or not sure is a red flag, with their words; a no is not", () => {
  const yes = partyRedFlags(facts({ requests: [{ ref: "7K2Q9M", answers: { pep: "yes", pepDetail: "My father is an MP.", answeredAt: "2026-11-17T10:00:00Z" } }] }));
  assert.equal(yes.length, 1);
  assert.equal(yes[0].kind, "client_pep");
  assert.equal(yes[0].label, "Said yes to the question about public roles");
  assert.equal(yes[0].detail, "My father is an MP.");
  assert.equal(yes[0].source, "Client checks, ref 7K2Q9M");
  const unsure = partyRedFlags(facts({ requests: [{ ref: "AB2345", answers: { pep: "unsure", pepDetail: null, answeredAt: null } }] }));
  assert.equal(unsure[0].label, "Not sure about the question about public roles");
  // One flag for the party however many requests said so: the latest.
  const two = partyRedFlags(facts({ requests: [
    { ref: "NEWER2", answers: { pep: "yes", pepDetail: null, answeredAt: null } },
    { ref: "OLDER3", answers: { pep: "unsure", pepDetail: null, answeredAt: null } },
  ] }));
  assert.equal(two.filter(f => f.kind === "client_pep").length, 1);
  assert.match(two[0].source, /NEWER2/);
  // A later no does not wipe an earlier yes: the yes was said.
  const changed = partyRedFlags(facts({ requests: [
    { ref: "LATER4", answers: { pep: "no", pepDetail: null, answeredAt: null } },
    { ref: "FIRST5", answers: { pep: "yes", pepDetail: null, answeredAt: null } },
  ] }));
  assert.equal(changed.length, 1);
  assert.match(changed[0].source, /FIRST5/);
});

test("a declined identity check is a red flag; a retry or an expiry is not", () => {
  const flags = partyRedFlags(facts({ idChecks: [
    { status: "declined", decision_reason: "Document not valid", received_at: "2026-11-17T12:00:00Z", name: "John Smith" },
    { status: "resubmission_requested" }, { status: "abandoned" },
  ] }));
  assert.equal(flags.length, 1);
  assert.equal(flags[0].kind, "id_declined");
  assert.equal(flags[0].label, "Identity check declined for John Smith");
  assert.equal(flags[0].detail, "Document not valid");
  assert.equal(flags[0].source, "Veriff");
});

test("screening, sanctions, risk and enhanced due diligence on the party's record", () => {
  const flags = partyRedFlags(facts({
    company: { aml_pep_status: "review_required", aml_risk_level: "High", aml_edd_required: true, aml_edd_reason: "Capital.bg reported its owner is under a UK asset freeze; unconfirmed" },
    latestInvestigation: { sanctions_match: true, conducted_at: "2026-11-10T09:00:00Z" },
  }));
  // Only the old in-app screening wrote review_required, and nobody at BGP set this risk: neither is a red flag
  // (Woody, 24 November 2026: "Only sign off counts remove the old bit"). A screening from November and an
  // enhanced due diligence reason in a person's own words still are.
  assert.deepEqual(flags.map(f => f.kind), ["sanctions", "edd"]);
  assert.equal(flags[0].label, "Possible match on the UK Sanctions List");
  assert.match(flags[1].detail || "", /asset freeze/);
  // A risk the MLRO set on the record is theirs.
  const mlro = partyRedFlags(facts({ company: { aml_risk_level: "High" }, recordHistory: [{ at: "2026-10-01T10:00:00Z", what: "risk=high", who: "Jack Barratt", action: "cdd_checklist_updated" }] }));
  assert.equal(mlro[0].label, "Risk rated high");
  // The PEP status words still read for a status a person recorded.
  assert.equal(pepStatusLabel("review_required"), "Screening found a possible PEP or sanctions match to review");
  assert.equal(pepStatusLabel("pep_foreign"), "Recorded as a politically exposed person outside the UK");
  assert.equal(pepStatusLabel("rca"), "Recorded as a close associate of a politically exposed person");
  assert.equal(pepStatusLabel("pep"), "Recorded as a politically exposed person");
  assert.equal(pepStatusLabel("clear"), null);
  assert.equal(pepStatusLabel(""), null);
  assert.equal(pepStatusLabel("something_else"), null);
});

test("the deal record: PEP, risk, open enhanced due diligence and a source of funds mismatch", () => {
  const flags = dealRedFlags({
    aml_pep_status: "pep_domestic", aml_risk_level: "critical", aml_edd_required: true, aml_edd_reason: "high_risk_country",
    aml_sof_analysis: { items: [
      { documentType: "Bank statement", declaredSourceMatchesDocument: false, generatedAt: "2026-11-15T10:00:00Z" },
      { documentType: "Payslip", declaredSourceMatchesDocument: true },
      { documentType: "Bank statement", declaredSourceMatchesDocument: null },
    ] },
  });
  assert.deepEqual(flags.map(f => f.kind), ["screening", "high_risk", "edd", "sof_mismatch"]);
  assert.equal(flags[0].label, "Recorded as a UK politically exposed person");
  assert.equal(flags[1].label, "Risk rated critical");
  assert.equal(flags[2].detail, "Reason: a high-risk country");
  assert.equal(flags[3].label, "A source of funds document does not match what was declared");
  assert.equal(flags[3].detail, "Bank statement");
  // Enhanced due diligence already completed is not a flag.
  assert.deepEqual(dealRedFlags({ aml_edd_required: true, aml_edd_completed_at: "2026-11-01" }), []);
});

test("KYC4U's note lists the party's flags, then the deal record's", () => {
  assert.equal(redFlagNote([], []), "");
  const party = partyRedFlags(facts({ requests: [{ ref: "7K2Q9M", answers: { pep: "yes", pepDetail: "Minister", answeredAt: null } }] }));
  const deal = dealRedFlags({ aml_risk_level: "high" });
  const note = redFlagNote(party, deal);
  assert.equal(note, [
    "Red flags from BGP's checks:",
    "- Said yes to the question about public roles (Minister). Source: Client checks, ref 7K2Q9M.",
    "- On the transaction record: Risk rated high. Source: Transaction record.",
  ].join("\n"));
  // One alert per flag: the key holds the kind and the words.
  assert.equal(redFlagAlertKey(party[0]), "client_pep:Said yes to the question about public roles");
});

test("the alert to the agents: what was found, what to do, nothing sent to the client", () => {
  const flags = partyRedFlags(facts({ requests: [{ ref: "7K2Q9M", answers: { pep: "yes", pepDetail: "<b>MP</b>", answeredAt: null } }] }));
  const email = kycRedFlagEmail({
    partyName: "Example & Co Ltd", recipientName: "Jane Smith", dealName: "12 Example Street", ref: "7K2Q9M",
    dealLink: "https://chatbgp.app/deals/abc", flags, sentFrom: "kyc@chatbgp.app",
  });
  // KYC4U is no longer used (23 November 2026): the officers do the enhanced checks.
  assert.equal(email.subject, "Red flag on 12 Example Street: Example & Co Ltd needs enhanced checks [7K2Q9M]");
  assert.match(email.html, /Red flag: Example &amp; Co Ltd needs enhanced checks/);
  assert.match(email.html, /Said yes to the question about public roles: &lt;b&gt;MP&lt;\/b&gt; <span style="color:#6b6b6b">\(Client checks, ref 7K2Q9M\)<\/span>/);
  assert.doesNotMatch(email.html, /<b>MP<\/b>/);
  assert.match(email.html, /A red flag needs enhanced checks, and an officer signs the party off/);
  assert.doesNotMatch(email.html, /KYC4U/);
  assert.match(email.html, /href="https:\/\/chatbgp\.app\/deals\/abc"/);
  assert.match(email.html, /Nothing has been sent to the client\./);
  assert.match(email.html, new RegExp(`cid:${KYC_LOGO_CID}`));
  const test = kycRedFlagEmail({ partyName: "X", recipientName: null, dealName: "Y", ref: "7K2Q9M", dealLink: "https://chatbgp.app", flags, sentFrom: "kyc@chatbgp.app", test: true });
  assert.match(test.subject, /^\[Test\] /);
  assert.match(test.html, /This is what the transaction&#39;s agents receive\. Nothing has been sent to anyone else/);
});

test("the finished note carries the red flags when there are any", () => {
  const base = {
    recipientName: "Jane Smith", partyName: "Example Trading Ltd", dealName: "12 Example Street", ref: "7K2Q9M",
    dealLink: "https://chatbgp.app/deals/abc", idState: "approved" as const, files: [], missing: [], sentFrom: "kyc@chatbgp.app",
  };
  assert.doesNotMatch(kycFinishedEmail(base).html, /Red flag/);
  assert.doesNotMatch(kycFinishedEmail({ ...base, redFlags: [] }).html, /Red flag/);
  const flagged = kycFinishedEmail({ ...base, redFlags: dealRedFlags({ aml_risk_level: "high" }) }).html;
  assert.match(flagged, /Red flag: for the Nominated Officer/);
  assert.match(flagged, /Risk rated high/);
});

// ── Setting a flag aside (Woody, 19 November 2026: "have the option to ignore
// with a comment as comply advantage is picking up things that are not
// really a massive problem") ────────────────────────────────────────────────

test("a flag set aside no longer counts; new evidence raises it again", () => {
  // Marks a person set on the record (the MLRO's form), so they are red flags.
  const flags = partyRedFlags(facts({
    company: { aml_pep_status: "review_required", aml_risk_level: "high", aml_edd_required: true, aml_edd_reason: "Owner's source of wealth unclear" },
    recordHistory: [{ at: "2026-10-05T10:00:00Z", what: "risk=high, pep=review_required, edd=true", who: "Jack Barratt", action: "cdd_checklist_updated" }],
  }));
  assert.deepEqual(flags.map(f => f.key).sort(), ["record:edd", "record:high_risk", "record:screening"]);
  // What is behind a record flag: the record's own history.
  assert.ok(flags.every(f => (f.facts || []).some(x => /risk=high/.test(x.value) && /Jack Barratt/.test(x.value))));
  const risk = flags.find(f => f.key === "record:high_risk")!;
  const review = { id: 1, flagKey: risk.key, evidence: risk.evidence, comment: "The risk was reviewed and accepted by the MLRO.", by: "Woody Bruce", at: "2026-11-19T12:00:00Z" };
  const split = applyFlagReviews(flags, [review]);
  assert.deepEqual(split.live.map(f => f.key).sort(), ["record:edd", "record:screening"]);
  assert.equal(split.setAside.length, 1);
  assert.equal(split.setAside[0].review.comment, "The risk was reviewed and accepted by the MLRO.");
  // The record moves to "critical": not what was set aside.
  const critical = partyRedFlags(facts({
    company: { aml_risk_level: "critical" },
    recordHistory: [{ at: "2026-11-20T10:00:00Z", what: "risk=critical", who: "Jack Barratt", action: "cdd_checklist_updated" }],
  }));
  assert.equal(applyFlagReviews(critical, [review]).live.length, 1);
});

test("setting a flag aside needs a reason worth keeping", () => {
  assert.ok("problem" in flagReviewComment("ok"));
  assert.ok("problem" in flagReviewComment("   "));
  assert.deepEqual(flagReviewComment("  The CMA merger review   was cleared in 2016.  "), { comment: "The CMA merger review was cleared in 2016." });
  assert.equal(FLAG_REVIEW_COMMENT_MIN, 10);
});

test("every flag carries a key and its evidence", () => {
  const all = [
    ...partyRedFlags(facts({
      company: { aml_pep_status: "pep_domestic", aml_risk_level: "high", aml_edd_required: true },
      latestInvestigation: { sanctions_match: true, conducted_at: "2026-11-01" },
      requests: [{ ref: "7K2Q9M", answers: { pep: "yes", pepDetail: "MP", answeredAt: "2026-11-17T10:00:00Z" }, ownersAnswer: { answer: "no", detail: "Sold in 2025", answeredAt: "2026-11-17T10:00:00Z" } as any }],
      idChecks: [{ status: "declined", decision_reason: "Document expired", received_at: "2026-11-17T10:00:00Z", name: "Jane Doe" }],
    })),
    ...dealRedFlags({ aml_pep_status: "pep", aml_risk_level: "critical", aml_edd_required: true, aml_sof_analysis: { items: [{ documentType: "bank statement", declaredSourceMatchesDocument: false, generatedAt: "2026-11-01" }] } }),
  ];
  assert.ok(all.length >= 9);
  for (const f of all) {
    assert.ok(f.key && typeof f.key === "string", `${f.label} has no key`);
    assert.ok(Array.isArray(f.evidence), `${f.label} has no evidence list`);
  }
  // A deal record flag never shares a key with a party's.
  assert.ok(all.filter(f => f.source === "Deal record").every(f => f.key.startsWith("deal:")));
});

test("each person's own yes is a red flag of its own, with their name (19 November 2026)", () => {
  const flags = partyRedFlags(facts({ requests: [
    { ref: "H2K9QP", answers: { pep: "yes", pepDetail: "Minister in Azerbaijan until 2024", answeredAt: null }, person: "Huseyn Mirhadiyev" },
    { ref: "D4VB7C", answers: { pep: "unsure", pepDetail: null, answeredAt: null }, person: "David Bruce" },
    { ref: "7MJEGT", answers: { pep: "no", pepDetail: null, answeredAt: null } },
  ] }));
  assert.deepEqual(flags.filter(f => f.kind === "client_pep").map(f => f.label), [
    "Huseyn Mirhadiyev said yes to the question about public roles",
    "David Bruce was not sure about the question about public roles",
  ]);
});
