// The joint agent's checks (Woody, 22 November 2026: "We have to do what HMRC
// say", then "Let's get the app to follow HMRC rules and also send them an
// email so they can load everything up or email the aml? If they email or
// upload it can we then upload it and check it in the app?"). The rules are
// shared/aml-policy.ts (HMRC's joint agent route, Not required),
// shared/joint-agent-checks.ts (the reading and what it covers),
// shared/kyc-request.ts (the emails), shared/aml-box.ts and
// shared/aml-dashboard.ts (where the party stands); the reader is
// server/joint-agent-checks.ts.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  JOINT_AGENT_RULE_WORDS, jointAgentNotRequiredRefusal, jointAgentRule, jointAskWords, notRequiredInput, notRequiredLapse,
} from "../shared/aml-policy";
import {
  JOINT_CHASE_MAX, agentWords, bornAgrees, bornKey, checkJointReading, jointChaseDue, jointCoverage, jointGapLines, jointLine, jointNextChaseDay, jointRelianceInput, jointRelianceTerms, jointWorkingDay, londonDayNumber, sameJointCompany,
  type JointChase, type JointFileReading,
} from "../shared/joint-agent-checks";
import { jointAgentAsks, jointAgentChaseStoppedEmail, jointAgentFinishedEmail, jointAgentMissingEmail, jointAgentRequestEmail, jointlyInstructed } from "../shared/kyc-request";
import { amlNextStep, type AmlBoxFacts } from "../shared/aml-box";
import { amlBucket, amlStage, amlWaitingOn } from "../shared/aml-dashboard";
import { agentAmlState } from "../shared/agent-aml";
import { jointAskRefusal, jointRelationFor, readJointFile, registerHeld } from "./joint-agent-checks";
import { sameFirmDomain } from "./aml-portal";

const today = new Date("2026-11-22T10:00:00Z");

// ── HMRC's route for the deal ───────────────────────────────────────────────

test("a sale or purchase takes HMRC's ask-and-record route; a letting at £10,000 a month or more does not", () => {
  assert.equal(jointAgentRule({ dealType: "Sale" }), "sale");
  assert.equal(jointAgentRule({ dealType: "Purchase" }), "sale");
  assert.equal(jointAgentRule({ dealType: "New Letting", rentPa: 150_000 }), "letting");
  assert.equal(jointAgentRule({ dealType: "New Letting", rentPa: 120_000 }), "letting", "£10,000 a month exactly is in scope");
  assert.equal(jointAgentRule({ dealType: "New Letting", rentPa: 60_000 }), "letting_under");
  // Rent not recorded reads as full checks (BGP's AML policy, A).
  assert.equal(jointAgentRule({ dealType: "New Letting" }), "letting");
  assert.equal(jointAgentRule({ dealType: "Rent Review" }), "advisory");
  assert.equal(jointAgentRule({ dealType: "" }), "other");
  for (const rule of ["sale", "letting", "letting_under", "advisory", "other"] as const) assert.ok(JOINT_AGENT_RULE_WORDS[rule].length > 10);
});

test("the joint agent reason is refused on every transaction since Issue 4 of BGP's policy", () => {
  // BGP's policy, Issue 4 (23 November 2026): the counterparty on a joint
  // instruction is always checked, sales included, which goes further than HMRC.
  for (const rule of ["sale", "letting", "letting_under", "advisory", "other"] as const) {
    assert.match(jointAgentNotRequiredRefusal(rule) || "", /checks the counterparty on every joint instruction/, rule);
  }
});

// ── Not required ────────────────────────────────────────────────────────────

const comment = "Savills found the buyer and ran the negotiation; BGP acted for the seller only.";

test("Not required takes no joint agent reason, with a record of asking or without; no transaction still does", () => {
  for (const body of [{}, { outcome: "received", jointRef: "7K2Q9M" }, { outcome: "not_provided", askedOn: "2026-11-18", askedHow: "phone", askedWhom: "Savills (Jane Smith)" }]) {
    const r = notRequiredInput({ reason: "joint_agent", comment, ...body }, { rule: "sale" });
    assert.ok("problem" in r && /every joint instruction/.test(r.problem), JSON.stringify(body));
  }
  const noDeal = notRequiredInput({ reason: "no_deal", comment: "The buyer withdrew before an offer was accepted." }, { rule: "sale" });
  assert.ok(!("problem" in noDeal) && noDeal.reason === "no_deal");
});

test("a joint agent mark made before Issue 4 lapses on every transaction, with or without its record; a no-deal mark holds", () => {
  const asked = { askedOn: "2026-11-20", how: "app" as const, whom: "Savills", outcome: "received" as const, ref: "7K2Q9M" };
  for (const rule of ["sale", "letting", "letting_under"] as const) {
    assert.match(notRequiredLapse({ reason: "joint_agent", asked: null }, rule) || "", /every joint instruction/, rule);
  }
  assert.match(notRequiredLapse({ reason: "joint_agent", asked }, "sale") || "", /every joint instruction/);
  assert.equal(notRequiredLapse({ reason: "no_deal", asked: null }, "letting"), null);
  // Its record still reads, so the lapsed mark says what it was.
  assert.equal(jointAskWords({ ...asked, how: "phone", whom: "Savills (Jane Smith)", outcome: "not_provided", askedOn: "2026-11-18", ref: null }),
    "Asked Savills (Jane Smith) for their checks on 18 Nov 2026, by phone: they did not provide them");
});

// ── Asking ──────────────────────────────────────────────────────────────────

test("the joint agent is not asked about BGP's own client, or on a deal that needs no checks of the other side", () => {
  assert.match(jointAskRefusal({ rule: "sale", clientRole: "vendor" }, "vendor") || "", /BGP's own client/);
  assert.equal(jointAskRefusal({ rule: "sale", clientRole: "vendor" }, "purchaser"), null);
  assert.equal(jointAskRefusal({ rule: "letting", clientRole: "landlord" }, "tenant"), null);
  assert.match(jointAskRefusal({ rule: "letting_under", clientRole: "landlord" }, "tenant") || "", /nothing to ask/);
  assert.match(jointAskRefusal({ rule: "advisory", clientRole: "landlord" }, "tenant") || "", /nothing to ask/);
});

test("every joint agent's HMRC registration is checked: a record is needed whether or not the fee is shared", () => {
  const none = agentAmlState({ role: "joint_agent", feeShared: false, record: null });
  assert.equal(none.required, true);
  assert.notEqual(none.tone, "ok");
  assert.equal(agentAmlState({ role: "buyers_agent", feeShared: false, record: null }).required, false);
});

test("the email to the joint agent: finalising our KYC, every document asked for, upload or reply, and it escapes what it is given", () => {
  const base = {
    recipientName: "Jane <b>Smith</b>", firm: "Savills", partyName: "Acme <script>alert(1)</script> Ltd", partyRole: "purchaser", kind: "company" as const,
    dealName: "12 Example Street", ref: "7K2Q9M", link: "https://chatbgp.app/kyc-upload/abc", expiresAt: "2026-12-06T10:00:00Z",
    agents: [{ name: "Woody Bruce", email: "woody@example.com", phone: null }], sentFrom: "kyc@chatbgp.app",
  };
  const sale = jointAgentRequestEmail({ ...base, letting: false });
  assert.match(sale.subject, /\[7K2Q9M\]$/);
  // Woody, 23 November 2026: "an email ... saying we are finalising the KYC on this joint agent transaction and need you to
  // upload or email back the following files ... all the docs including their proof of identity and any further AML they have done".
  // Woody, 23 November 2026: "the intro changing to reflect the fact that we are jointly instructed by xxx client and you have
  // undertaken the negotiations of this transaction".
  assert.match(sale.html, /We are jointly instructed by our client on <strong>12 Example Street<\/strong>, and you have undertaken the negotiations of this transaction with <strong>/);
  assert.match(sale.html, /We are finalising our KYC on them and need the documents below\./);
  const named = jointAgentRequestEmail({ ...base, letting: false, clientName: "Brucecap Ltd", clientRole: "landlord", partyRole: "tenant" });
  assert.match(named.html, /We are jointly instructed by <strong>Brucecap Ltd<\/strong> on <strong>12 Example Street<\/strong>, and you have undertaken the negotiations of this transaction with <strong>Acme .*? Ltd<\/strong>, the tenant\./);
  assert.equal(jointlyInstructed({ clientName: null, clientRole: "landlord" }), "We are jointly instructed by the landlord");
  assert.equal(jointlyInstructed({ clientName: null, clientRole: null }), "We are jointly instructed by our client");
  assert.match(sale.subject, /^Finalising our KYC on /);
  assert.match(sale.html, /Proof of identity/);
  assert.match(sale.html, /Any further AML you have done/);
  assert.match(sale.html, /Or reply to this email with the documents attached/);
  assert.doesNotMatch(sale.html, /AMLG|regulation \d|reg \d/, "no regulation numbers in the email");
  assert.match(sale.html, /https:\/\/chatbgp\.app\/kyc-upload\/abc/);
  assert.doesNotMatch(sale.html, /<script>/);
  assert.doesNotMatch(sale.html, /<b>Smith<\/b>/);
  const letting = jointAgentRequestEmail({ ...base, partyRole: "tenant", letting: true });
  // No reliance terms (Woody, 23 November 2026: "we cant agree reliance").
  assert.doesNotMatch(letting.html, /rely on your checks|reliance/i);
  assert.doesNotMatch(letting.html, /AMLG|regulation \d|reg \d/);
  assert.ok(!jointAgentAsks({ kind: "company", letting: true }).some(a => /reliance/i.test(a.title)));
  assert.deepEqual(jointAgentAsks({ kind: "company", letting: true }).map(a => a.title), ["Proof of identity", "Proof of address", "The company", "Any further AML you have done"]);
  assert.ok(!jointAgentAsks({ kind: "individual", letting: false }).some(a => a.title === "The company"));
  const nudge = jointAgentMissingEmail({ ...base, letting: true, missing: [], nothingYet: true, chase: 1 });
  assert.match(nudge.subject, /^Reminder/);
  assert.match(nudge.html, /Upload the documents/);
  const still = jointAgentMissingEmail({ ...base, letting: false, missing: ["Daniel North: a proof of address <b>x</b>", "Your sanctions and PEP screening"], nothingYet: false, chase: 2 });
  assert.match(still.subject, /^Still needed: our KYC on/);
  assert.match(still.html, /Daniel North: a proof of address/);
  assert.doesNotMatch(still.html, /<b>x<\/b>/);
  assert.match(still.html, /HMRC asks us to record what was and wasn't provided/);
  // Outside parties read "transaction", never "deal" (Woody, 22 November 2026).
  for (const e of [sale, letting, nudge, still]) assert.doesNotMatch(`${e.subject} ${e.html}`, /\bdeals?\b(?!\s+with)/i);
  const stopped = jointAgentChaseStoppedEmail({ firm: "Savills", partyName: "Acme Ltd", dealName: "12 Example Street", ref: "7K2Q9M", dealLink: "https://chatbgp.app/deals/1",
    missing: ["their sanctions and PEP screening"], chases: 10, letting: false, sentFrom: "kyc@chatbgp.app" });
  assert.match(stopped.subject, /has not sent what is missing/);
  assert.match(stopped.html, /Still missing after 10 reminders/);
  assert.match(stopped.html, /they sent part of their checks/);
  const done = jointAgentFinishedEmail({ firm: "Savills", recipientName: "Jane Smith", partyName: "Acme Ltd", dealName: "12 Example Street", ref: "7K2Q9M",
    dealLink: "https://chatbgp.app/deals/1", files: ["passport.pdf"], letting: true, reliance: null, missing: ["Jane Owner: address"], sentFrom: "kyc@chatbgp.app" });
  assert.match(done.html, /signs the party off/);
  assert.match(done.html, /Jane Owner: address/);
});

test("the reliance terms are the regulation's conditions, agreed with a full name and a supervisor", () => {
  const terms = jointRelianceTerms("Acme Ltd");
  assert.equal(terms.length, 6);
  assert.match(terms.join(" "), /not simplified due diligence/);
  assert.match(terms[0], /regulation 39/);
  assert.match(terms.join(" "), /immediately on request/);
  assert.match(terms.join(" "), /five years/);
  const ok = jointRelianceInput({ agree: true, name: "Jane Smith", position: "Director", supervisor: "HMRC", registration: "XLML00000123456" }, "Savills", today);
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { name: "Jane Smith", position: "Director", firm: "Savills", supervisor: "HMRC", registration: "XLML00000123456", agreedAt: today.toISOString() });
  const no = (raw: Record<string, unknown>) => { const r = jointRelianceInput(raw, "Savills", today); assert.equal(r.ok, false); return r.ok ? "" : r.message; };
  assert.match(no({ name: "Jane Smith", supervisor: "HMRC" }), /Tick/);
  assert.match(no({ agree: true, name: "Jane", supervisor: "HMRC" }), /full name/);
  assert.match(no({ agree: true, name: "Jane Smith", supervisor: "" }), /supervisor/);
});

// ── Reading what they send ──────────────────────────────────────────────────

test("a reading is kept only in its own shape: unknown kinds, results and dates are dropped", () => {
  const r = checkJointReading({
    kind: "passport", title: "UK passport", date: "2024-02-30", expiry: "2034-02-01", result: "maybe",
    people: [{ name: "Jane Smith", born: "1980-05-12" }, { name: "  " }, { name: "12345" }],
    companies: ["Acme Ltd", 42], summary: "  A passport.  ", extra: "ignored",
  }, "passport.pdf", today);
  assert.equal(r.state, "read");
  assert.equal(r.kind, "other");
  assert.equal(r.date, null, "30 February is no date");
  assert.equal(r.expiry, "2034-02-01");
  assert.equal(r.result, null);
  assert.deepEqual(r.people, [{ name: "Jane Smith", born: "1980-05", idVerified: null, addressVerified: null }]);
  assert.deepEqual(r.companies, ["Acme Ltd", "42"]);
  assert.equal(r.summary, "A passport.");
  assert.equal((r as any).extra, undefined);
});

test("dates of birth are read as the people to check give them, and unknown on either side agrees", () => {
  assert.equal(bornKey("May 1980"), "1980-05");
  assert.equal(bornKey("1980"), "1980");
  assert.equal(bornKey("1980-05"), "1980-05");
  assert.equal(bornKey("sometime"), null);
  assert.equal(bornAgrees("1980-05", "1980-05"), true);
  assert.equal(bornAgrees("1980-05", "1980-06"), false);
  assert.equal(bornAgrees("1980", "1980-06"), true);
  assert.equal(bornAgrees("1981-05", "1980-05"), false);
  assert.equal(bornAgrees(null, "1980-05"), true);
  assert.equal(sameJointCompany("Acme Trading Limited", "ACME TRADING LTD"), true);
  assert.equal(sameJointCompany("Acme Trading Limited", "Acme Holdings Ltd"), false);
});

const read = (over: Partial<JointFileReading>): JointFileReading => ({ state: "read", file: "file.pdf", readAt: today.toISOString(), people: [], companies: [], owners: [], ...over });

test("what their files cover is set against the people the checks need, each by name and date of birth", () => {
  const c = jointCoverage({
    partyName: "Acme Trading Ltd", kind: "company", now: today,
    people: [
      { name: "SMITH, Jane Elizabeth", roles: ["owner"], born: "1980-05" },
      { name: "Bob Jones", roles: ["owner"], born: null },
      { name: "Carol White", roles: ["acting"] },
      { name: "Dan Director", roles: ["director"] },
    ],
    readings: [
      read({ file: "passport-jane.pdf", kind: "photo_id", title: "UK passport", date: "2024-01-10", expiry: "2034-01-09", people: [{ name: "Jane Smith", born: "1980-05" }] }),
      read({ file: "bob-check.pdf", kind: "electronic_id", result: "pass", addressVerified: true, people: [{ name: "Robert Jones", born: null }, { name: "Bob Jones", born: "1975-02" }] }),
      read({ file: "register.pdf", kind: "company_register", companies: ["ACME TRADING LIMITED"], owners: ["Jane Smith", "Bob Jones"] }),
      read({ file: "screening.pdf", kind: "screening", result: "clear", date: "2026-11-19" }),
      { state: "failed", why: "not read yet", file: "later.pdf", readAt: "" },
    ],
  });
  const jane = c.people.find(p => p.name.includes("Jane"))!;
  assert.match(jane.id || "", /UK passport/);
  assert.deepEqual(jane.missing, ["address"]);
  const bob = c.people.find(p => p.name === "Bob Jones")!;
  assert.deepEqual(bob.missing, []);
  assert.match(bob.address || "", /address verified/);
  assert.deepEqual(c.people.find(p => p.name === "Carol White")!.missing, ["identity", "address"]);
  assert.ok(!c.people.some(p => p.name === "Dan Director"), "a director who owns nothing is screened, not identified");
  assert.ok(c.company?.register && c.company.ownership);
  assert.match(c.screening || "", /clear/);
  assert.equal(c.unread, 1);
  assert.deepEqual(c.others, ["Robert Jones"]);
  assert.equal(c.complete, false);
  assert.ok(c.missing.some(m => m.startsWith("Carol White")));
});

test("an expired ID, a failed check, a screening match and another date of birth are listed to look at", () => {
  const c = jointCoverage({
    partyName: "Jane Smith", kind: "individual", now: today,
    people: [{ name: "Jane Smith", roles: ["acting"], born: "1980-05" }],
    readings: [
      read({ file: "old.pdf", kind: "photo_id", title: "UK passport", date: "2026-11-01", expiry: "2025-01-01", people: [{ name: "Jane Smith", born: null }] }),
      read({ file: "e.pdf", kind: "electronic_id", result: "refer", issuer: "SmartSearch", people: [{ name: "Jane Smith", born: null }] }),
      read({ file: "other.pdf", kind: "photo_id", people: [{ name: "Jane Smith", born: "1990-01" }] }),
      read({ file: "s.pdf", kind: "screening", result: "match", summary: "Matched to a PEP list entry" }),
    ],
  });
  assert.ok(c.flags.some(f => /had expired/.test(f)));
  assert.ok(c.flags.some(f => /was referred \(SmartSearch\)/.test(f)));
  assert.ok(c.flags.some(f => /another date of birth/.test(f)));
  assert.ok(c.flags.some(f => /possible match/.test(f)));
  assert.equal(c.screening, null);
  assert.deepEqual(c.people[0].missing, ["identity", "address"]);
  assert.equal(c.complete, false);
});

test("with no people read by BGP, the owners their own register names are the people; a private individual is the party", () => {
  const company = jointCoverage({
    partyName: "Acme Trading Ltd", kind: "company", people: [], now: today,
    readings: [
      read({ kind: "company_register", companies: ["Acme Trading Ltd"], owners: ["Jane Smith", "Acme Holdings Limited", "JANE SMITH"] }),
      read({ kind: "photo_id", people: [{ name: "Jane Smith", born: null }] }),
      read({ kind: "proof_of_address", people: [{ name: "Jane Smith", born: null }] }),
      read({ kind: "screening", result: "clear" }),
    ],
  });
  assert.deepEqual(company.people.map(p => p.name), ["Jane Smith"], "a company owner is not a person; one person once");
  assert.equal(company.complete, true);
  const person = jointCoverage({ partyName: "John Buyer", kind: "individual", people: [], readings: [], now: today });
  assert.deepEqual(person.people.map(p => p.name), ["John Buyer"]);
  assert.ok(person.missing.includes("their sanctions and PEP screening"));
});

// Found by playing the agent on live on 23 November 2026: a CDD summary that
// said the owner's address was not verified asked for nothing about her, and
// a complete summary was asked for the owners and the screening again.
test("their CDD summary: its owners are the people, what it says was verified counts, and so does its screening", () => {
  const tenant = jointCoverage({
    partyName: "AML Test Tenant Ltd", kind: "company", people: [], now: today,
    readings: [read({ file: "cdd.pdf", kind: "risk_assessment", title: "CDD summary", owners: ["Jane Testperson"], result: "clear",
      people: [{ name: "Jane Testperson", born: "1980-05", idVerified: true, addressVerified: false }] })],
  });
  assert.deepEqual(tenant.people.map(p => [p.name, p.missing]), [["Jane Testperson", ["address"]]]);
  assert.match(tenant.company?.ownership || "", /cdd\.pdf|CDD summary/);
  assert.match(tenant.screening || "", /screening clear/);
  assert.deepEqual(tenant.missing, ["Jane Testperson: address", "the company's register entry"]);
  const lines = jointGapLines(tenant, { you: true, reliance: true, agreed: true, nothingYet: false, partyName: "AML Test Tenant Ltd" });
  assert.ok(lines.some(l => /^Jane Testperson: a proof of address/.test(l)), lines.join(" | "));
  assert.ok(!lines.some(l => /screening|Who owns/.test(l)), lines.join(" | "));
  // A summary reporting a match is a flag, never a clear screen; one that says nothing of screening leaves it asked for.
  const matched = jointCoverage({ partyName: "X Ltd", kind: "company", people: [], now: today, readings: [read({ kind: "risk_assessment", result: "match", summary: "The owner matched a PEP list" })] });
  assert.equal(matched.screening, null);
  assert.ok(matched.flagItems.some(f => f.kind === "match"));
  const silent = jointCoverage({ partyName: "X Ltd", kind: "company", people: [], now: today, readings: [read({ kind: "risk_assessment", result: null })] });
  assert.ok(silent.missing.includes("their sanctions and PEP screening"));
});

test("what BGP's own checks read from the register is not asked of the agent again", () => {
  assert.equal(registerHeld("not_read"), null);
  assert.equal(registerHeld("individual"), null);
  assert.equal(registerHeld("abroad_company"), null);
  assert.match(registerHeld("owners")!.ownership || "", /read by BGP's checks/);
  assert.equal(registerHeld("owners_abroad")!.ownership, null, "the people behind a company abroad are still asked for");
  const done = jointCoverage({
    partyName: "Acme Ltd", kind: "company", now: today, held: registerHeld("owners"),
    people: [{ name: "Jane Smith", roles: ["owner"], born: "1980-05" }],
    readings: [read({ kind: "risk_assessment", result: "clear", people: [{ name: "Jane Smith", born: "1980-05", idVerified: true, addressVerified: true }] })],
  });
  assert.equal(done.complete, true, done.missing.join(" | "));
  assert.match(done.company!.register!, /Companies House, read by BGP's checks/);
  const abroad = jointCoverage({ partyName: "Acme Ltd", kind: "company", now: today, held: registerHeld("owners_abroad"), people: [], readings: [read({ kind: "screening", result: "clear" })] });
  assert.deepEqual(abroad.missing, ["who owns the company"]);
});

test("the line under the party says where the joint agent's checks are, in HMRC's route", () => {
  assert.equal(jointLine({ rule: "letting", firm: "Savills", status: null, files: 0, reliance: false }), "Not asked: ask Savills for the documents");
  assert.match(jointLine({ rule: "sale", firm: "Savills", status: null, files: 0, reliance: false }), /^Not asked: ask Savills/);
  assert.match(jointLine({ rule: "sale", firm: "Savills", status: "sent", files: 0, reliance: false }), /waiting/);
  assert.equal(jointLine({ rule: "sale", firm: "Savills", status: "in", files: 3, reliance: false }), "Savills sent 3 files");
  assert.equal(jointLine({ rule: "letting", firm: "Savills", status: "in", files: 1, reliance: false }), "Savills sent 1 file", "no reliance terms asked for");
  assert.match(jointLine({ rule: "letting", firm: "Savills", status: "finished", files: 1, reliance: true }), /agreed to the reliance terms/);
});

test("the reader is sent the file and nothing else, and a file it cannot read says why", async () => {
  const pdf = { buffer: Buffer.from("%PDF-1.4\n% joint agent pack\n"), mime: "application/pdf", name: "pack.pdf" };
  const off = await readJointFile(pdf, { hasKey: () => false, now: () => today });
  assert.equal(off.state, "off");
  const capped = await readJointFile(pdf, { hasKey: () => true, claim: async () => false, now: () => today });
  assert.equal(capped.state, "off");
  assert.match(capped.why || "", /allowance/);
  let seen: unknown[] = [];
  const ok = await readJointFile(pdf, {
    hasKey: () => true, claim: async () => true, now: () => today,
    ask: async (_system, parts) => { seen = parts; return { input: { kind: "screening", result: "clear", people: [{ name: "Jane Smith" }] }, model: "test" }; },
  });
  assert.equal(ok.state, "read");
  assert.equal(ok.kind, "screening");
  assert.equal(seen.length, 1, "only the file");
  const empty = await readJointFile({ buffer: Buffer.alloc(0), mime: "application/pdf", name: "empty.pdf" }, { hasKey: () => true, claim: async () => true, now: () => today });
  assert.equal(empty.state, "failed");
  assert.equal(empty.unreadable, true, "a file that could not be opened is theirs to send again");
  assert.ok(!off.unreadable && !capped.unreadable, "the reader off or its allowance used is BGP's to read again");
  const thrown = await readJointFile(pdf, { hasKey: () => true, claim: async () => true, now: () => today, ask: async () => { throw new Error("overloaded"); } });
  assert.equal(thrown.state, "failed");
  assert.match(thrown.why || "", /read it again later/);
  assert.ok(!thrown.unreadable);
});

test("a file not read yet: the joint agent is asked for nothing it may hold; a file that could not be opened is asked for again", () => {
  const people = [{ name: "Jane Smith", roles: ["owner"] }];
  const pending = jointCoverage({ partyName: "Acme Trading Ltd", kind: "company", people, now: today, readings: [
    { state: "off", why: "today's allowance of reads is used up; read it again tomorrow", file: "pack.pdf", readAt: "2026-11-21T10:00:00Z" },
  ] });
  assert.equal(pending.unread, 1);
  assert.deepEqual(pending.unopened, []);
  const opts = { reliance: true, agreed: false, nothingYet: false, partyName: "Acme Trading Ltd" };
  assert.deepEqual(jointGapLines(pending, { ...opts, you: true }), ["Your agreement to the reliance terms, on the page"], "nothing their file may hold is asked for");
  const ours = jointGapLines(pending, { ...opts, you: false });
  assert.equal(ours[0], "1 file from them not read yet: press Read again, or check it by eye");
  assert.ok(ours.some(l => /^Jane Smith: an ID document/.test(l)), "BGP still sees what is not covered");
  const broken = jointCoverage({ partyName: "Acme Trading Ltd", kind: "company", people, now: today, readings: [
    { state: "failed", why: "the file is empty", unreadable: true, file: "scan.pdf", readAt: "2026-11-21T10:00:00Z" },
  ] });
  assert.equal(broken.unread, 0);
  assert.deepEqual(broken.unopened, ["scan.pdf"]);
  assert.equal(broken.complete, false);
  const theirs = jointGapLines(broken, { ...opts, you: true });
  assert.equal(theirs[0], "scan.pdf could not be opened: please send it again, as a PDF or a photo");
  assert.ok(theirs.some(l => /^Jane Smith: an ID document/.test(l)));
  // The Next line: read their file first.
  const next = amlNextStep(facts({ stage: "joint_in", joint: { firm: "Savills", rule: "letting", reliance: true, missing: 3, unread: 1, status: "in" } }));
  assert.equal(next.who, "bgp");
  assert.equal(`${next.lead} · ${next.words}`, "To do · read the file from Savills");
  assert.equal(next.action, "joint");
});

// ── Where the party stands ──────────────────────────────────────────────────

test("the AML board reads the joint agent asked, then their checks in, as in progress", () => {
  const base = { role: "purchaser", dealStatus: "SOL", kyc: { status: null, expiresAt: null }, precheckAt: null, clientSentAt: null, clientFinishedAt: null, kyc4uOpen: false, kyc4uInReview: false };
  assert.equal(amlStage({ ...base, jointAskedAt: "2026-11-20T10:00:00Z" }, today), "joint_asked");
  assert.equal(amlStage({ ...base, jointAskedAt: "2026-11-20T10:00:00Z", jointInAt: "2026-11-21T10:00:00Z" }, today), "joint_in");
  // The client's own checks finished come first; the joint agent's checks in come before client checks only sent.
  assert.equal(amlStage({ ...base, clientSentAt: "2026-11-19T10:00:00Z", jointInAt: "2026-11-21T10:00:00Z" }, today), "joint_in");
  assert.equal(amlStage({ ...base, clientFinishedAt: "2026-11-21T12:00:00Z", jointInAt: "2026-11-21T10:00:00Z" }, today), "client_finished");
  assert.equal(amlStage({ ...base, notRequired: true, jointInAt: "2026-11-21T10:00:00Z" }, today), "not_required");
  assert.equal(amlBucket("joint_asked", true), "in_progress");
  assert.equal(amlBucket("joint_in", true), "in_progress");
  assert.equal(amlWaitingOn("joint_asked", 0), "The joint agent");
  assert.equal(amlWaitingOn("joint_in", 0), "BGP: sign off", "Issue 4: their documents in, BGP signs off");
  assert.match(amlWaitingOn("joint_in", 1), /Officers/);
});

const facts = (over: Partial<AmlBoxFacts> = {}): AmlBoxFacts => ({
  role: "purchaser", stage: "joint_asked", due: true, approvedBy: null, expiresAt: null, notRequiredWords: null,
  company: true, companyMissing: false, gaps: [], askName: null, precheckRunning: false, redFlags: 0, factors: 0,
  sanctionsOnly: false, clientChecks: true, request: null, people: [], kyc4u: "none", canSignOff: true, canDecide: true,
  signOffBlocked: null, needsNote: false, ...over,
});

test("the Next line follows the joint agent: waiting on them, then BGP signs the party off on its documents", () => {
  const sale = { firm: "Savills", rule: "sale" as const, reliance: false, missing: 0 };
  const waiting = amlNextStep(facts({ joint: { ...sale, status: "sent" } }));
  assert.equal(waiting.who, "joint_agent");
  assert.equal(waiting.action, "joint");
  assert.equal(`${waiting.lead} · ${waiting.words}`, "Waiting on Savills · for the documents");
  // Issue 4 of BGP's policy: a sale's counterparty is checked as a letting's is, never marked Not required.
  const inSale = amlNextStep(facts({ stage: "joint_in", joint: { ...sale, status: "in", missing: 0 } }));
  assert.equal(inSale.action, "sign_off");
  assert.equal(`${inSale.lead} · ${inSale.words}`, "Ready to sign off · Savills' documents are in: add a note");
  const gapsSale = amlNextStep(facts({ stage: "joint_in", joint: { ...sale, status: "in", missing: 2 } }));
  assert.equal(gapsSale.who, "bgp");
  assert.equal(gapsSale.action, "joint_remind");
  assert.equal(`${gapsSale.lead} · ${gapsSale.words}`, "To do · ask Savills for 2 missing documents");
  const letting = { firm: "Savills (UK) Limited", rule: "letting" as const, missing: 0 };
  // No reliance terms (23 November 2026): with their documents in, BGP signs the party off on its own check of them.
  const docsIn = amlNextStep(facts({ joint: { ...letting, status: "in", reliance: false }, signOffBlocked: null, canSignOff: true }));
  assert.equal(docsIn.action, "sign_off");
  assert.equal(`${docsIn.lead} · ${docsIn.words}`, "Ready to sign off · Savills' documents are in: add a note", "the firm without its legal form");
  assert.equal(amlNextStep(facts({ joint: { ...letting, status: "sent" } })).words, "for the documents");
  assert.equal(amlNextStep(facts({ joint: { ...letting, status: "finished", reliance: true } })).words, "Savills' checks are in: record the reliance");
  // A link that ran out goes back to the client checks.
  assert.equal(amlNextStep(facts({ stage: "not_started", joint: { ...sale, status: "expired" } })).action, "send_client_checks");
  // A red flag: the joint agent's route still runs; the officers sign off with a note (KYC4U is no longer used).
  const flagged = amlNextStep(facts({ redFlags: 1, joint: { ...sale, status: "in" } }));
  assert.equal(flagged.action, "sign_off");
  assert.equal(flagged.who, "officers");
  // With their route running, BGP's own step of setting the company that signs waits.
  assert.equal(amlNextStep(facts({ companyMissing: true, joint: { ...sale, status: "sent" } })).action, "joint");
  assert.equal(amlNextStep(facts({ companyMissing: true, joint: { ...sale, status: "in" } })).action, "sign_off");
  assert.equal(amlNextStep(facts({ companyMissing: true, stage: "not_started", joint: { ...sale, status: "not_sent" } })).action, "fill_in");
  assert.equal(amlNextStep(facts({ companyMissing: true, stage: "not_started" })).action, "fill_in");
});

test("a reply by email counts from the address asked or a colleague at the same firm, never a free mail service", () => {
  assert.equal(sameFirmDomain("tom@savills-example.com", "jane@savills-example.com"), true);
  assert.equal(sameFirmDomain("TOM@Savills-Example.com", "jane@savills-example.com"), true);
  assert.equal(sameFirmDomain("tom@gmail.com", "jane@gmail.com"), false);
  assert.equal(sameFirmDomain("tom@savills-example.co.uk", "jane@savills-example.com"), false);
  assert.equal(sameFirmDomain("", "jane@savills-example.com"), false);
});

// ── What is missing, and chasing it (Woody, 22 November 2026: "we need to
// explain whats missing and keep emailing") ─────────────────────────────────

test("a CDD summary that says what they verified counts, without the documents themselves", () => {
  const c = jointCoverage({
    partyName: "Acme Trading Ltd", kind: "company", now: today,
    people: [{ name: "Jane Smith", roles: ["owner"], born: "1980-05" }, { name: "Bob Jones", roles: ["owner"] }],
    readings: [
      read({ file: "cdd.pdf", kind: "risk_assessment", title: "CDD summary", people: [{ name: "Jane Smith", born: "1980-05", idVerified: true, addressVerified: true }, { name: "Bob Jones", born: null, idVerified: true, addressVerified: false }] }),
    ],
  });
  assert.deepEqual(c.people.find(p => p.name === "Jane Smith")!.missing, []);
  assert.deepEqual(c.people.find(p => p.name === "Bob Jones")!.missing, ["address"]);
});

test("simplified checks are a flag only when BGP would rely on them", () => {
  const readings = [read({ file: "ra.pdf", kind: "risk_assessment", simplified: true })];
  assert.equal(jointCoverage({ partyName: "Acme Ltd", kind: "company", people: [], readings, now: today }).flagItems.length, 0);
  const relied = jointCoverage({ partyName: "Acme Ltd", kind: "company", people: [], readings, now: today, reliance: true });
  assert.equal(relied.flagItems[0].kind, "simplified");
  assert.match(relied.flags[0], /cannot rely on/);
});

test("what is missing is worded for the joint agent, and for BGP, one plain line each", () => {
  const c = jointCoverage({
    partyName: "Acme Trading Ltd", kind: "company", now: today,
    people: [{ name: "Jane Smith", roles: ["owner"], born: "1980-05" }],
    readings: [
      read({ file: "old.pdf", kind: "photo_id", title: "UK passport", date: "2026-11-01", expiry: "2025-01-01", people: [{ name: "Jane Smith", born: null }] }),
      read({ file: "s.pdf", kind: "screening", result: "match", summary: "PEP list" }),
    ],
  });
  const theirs = jointGapLines(c, { you: true, reliance: true, agreed: false, nothingYet: false, partyName: "Acme Trading Ltd" });
  assert.ok(theirs.some(l => /^Jane Smith: an ID document/.test(l) && /your electronic identity check/.test(l)));
  assert.ok(theirs.some(l => /^Jane Smith: a proof of address/.test(l)));
  assert.ok(theirs.includes("The company's register entry (Companies House, or its register abroad)"));
  assert.ok(theirs.some(l => /UK passport had expired \(1 Jan 2025\): please send one in date/.test(l)));
  assert.ok(theirs.some(l => /s\.pdf shows a possible screening match: please send how it was resolved/.test(l)));
  assert.ok(theirs.includes("Your sanctions and PEP screening on the company and the people"));
  assert.equal(theirs[theirs.length - 1], "Your agreement to the reliance terms, on the page");
  const ours = jointGapLines(c, { you: false, reliance: false, agreed: false, nothingYet: false, partyName: "Acme Trading Ltd" });
  assert.ok(ours.some(l => /their electronic identity check/.test(l)));
  assert.ok(!ours.some(l => /reliance terms/.test(l)));
  assert.deepEqual(jointGapLines(null, { you: true, reliance: false, agreed: false, nothingYet: true, partyName: "Acme Ltd" }), ["Your checks on Acme Ltd: nothing has come yet"]);
  // A file not read yet is BGP's to read, never theirs to send.
  const unread = jointCoverage({ partyName: "John Buyer", kind: "individual", people: [], now: today,
    readings: [read({ kind: "photo_id", people: [{ name: "John Buyer", born: null }] }), read({ kind: "proof_of_address", people: [{ name: "John Buyer", born: null }] }), read({ kind: "screening", result: "clear" }),
      { state: "failed", why: "not read yet", file: "x.pdf", readAt: "" }] });
  assert.deepEqual(jointGapLines(unread, { you: true, reliance: false, agreed: false, nothingYet: false, partyName: "John Buyer" }), []);
});

test("the app chases what is missing every three days on weekdays, and stops after its last reminder", () => {
  const sentAt = "2026-11-16T10:00:00.000Z";
  const base = { sentAt, chases: [] as JointChase[], stoppedAt: null, settled: false, cancelled: false, gaps: 2, weekday: true };
  assert.equal(jointChaseDue({ ...base, now: new Date("2026-11-18T10:00:00Z") }), null, "two days on");
  assert.equal(jointChaseDue({ ...base, now: new Date("2026-11-19T10:00:00Z") }), "chase", "three days on");
  assert.equal(jointChaseDue({ ...base, now: new Date("2026-11-19T10:00:00Z"), weekday: false }), null);
  assert.equal(jointChaseDue({ ...base, now: new Date("2026-11-19T10:00:00Z"), gaps: 0 }), null, "nothing missing");
  assert.equal(jointChaseDue({ ...base, now: new Date("2026-11-19T10:00:00Z"), settled: true }), null, "the party is decided");
  assert.equal(jointChaseDue({ ...base, now: new Date("2026-11-19T10:00:00Z"), sentAt: null }), null, "never asked");
  const chase = (at: string, auto = true): JointChase => ({ at, by: "the app", auto, missing: ["x"] });
  assert.equal(jointChaseDue({ ...base, chases: [chase("2026-11-19T10:00:00Z")], now: new Date("2026-11-21T10:00:00Z") }), null, "counts from the last chase");
  const many = Array.from({ length: JOINT_CHASE_MAX }, (_, i) => chase(new Date(Date.parse(sentAt) + (i + 1) * 3 * 86400000).toISOString()));
  const after = new Date(Date.parse(many[many.length - 1].at) + 3 * 86400000);
  assert.equal(jointChaseDue({ ...base, chases: many, now: after }), "stop");
  // A chase BGP sends by hand does not use up the app's own.
  assert.equal(jointChaseDue({ ...base, chases: [...many.slice(1), chase(many[0].at, false)], now: after }), "chase");
  assert.equal(jointChaseDue({ ...base, chases: many, now: after, stoppedAt: after.toISOString() }), null);
  // After the stop, BGP asking again by hand starts the app's chasing again.
  const askedAgain = [...many, chase(after.toISOString(), false)];
  assert.equal(jointChaseDue({ ...base, chases: askedAgain, now: new Date(after.getTime() + 3 * 86400000) }), "chase");
});

test("the next chase is three days after the last email, moved off a weekend", () => {
  // Thursday 19 November 2026 + 3 days is Sunday: Monday.
  assert.equal(jointNextChaseDay(["2026-11-19T10:00:00.000Z"])?.slice(0, 10), "2026-11-23");
  assert.equal(jointNextChaseDay(["2026-11-16T10:00:00.000Z"])?.slice(0, 10), "2026-11-19");
  assert.equal(jointNextChaseDay([null, "2026-11-16T10:00:00.000Z", "2026-11-17T09:00:00.000Z"])?.slice(0, 10), "2026-11-20", "from the last email");
  assert.equal(jointNextChaseDay([]), null);
});

test("chasing counts London calendar days, so the date shown is the day the morning run sends it", () => {
  // Sent on Sunday 22 November 2026 at 16:55: the 10:00 run on Wednesday 25th chases (not Thursday).
  const base = { sentAt: "2026-11-22T16:55:00.000Z", chases: [] as JointChase[], stoppedAt: null, settled: false, cancelled: false, gaps: 1, weekday: true };
  assert.equal(jointChaseDue({ ...base, now: new Date("2026-11-24T10:00:00Z") }), null);
  assert.equal(jointChaseDue({ ...base, now: new Date("2026-11-25T10:00:00Z") }), "chase");
  assert.equal(jointNextChaseDay([base.sentAt])?.slice(0, 10), "2026-11-25");
  // British Summer Time: 23:30 UTC on 30 June is 00:30 on 1 July in London.
  assert.equal(londonDayNumber("2026-06-30T23:30:00Z"), londonDayNumber("2026-07-01T12:00:00Z"));
  assert.equal(londonDayNumber("not a date"), null);
  // Bank holidays: no chase on Christmas Day; the next one is the next working day.
  assert.equal(jointWorkingDay(new Date("2026-12-25T10:00:00Z")), false);
  assert.equal(jointWorkingDay(new Date("2026-12-24T10:00:00Z")), true);
  assert.equal(jointWorkingDay(new Date("2026-11-22T10:00:00Z")), false, "a Sunday");
  // Tuesday 22 December + 3 is Christmas Day; Saturday, Sunday and Monday 28th (a bank holiday) follow.
  assert.equal(jointNextChaseDay(["2026-12-22T09:00:00Z"])?.slice(0, 10), "2026-12-29");
});

test("the Next line says what is still missing and that the app is chasing", () => {
  const f = facts({ stage: "joint_in", joint: { firm: "Savills", rule: "sale", reliance: false, missing: 2, status: "in", chasing: true } });
  const step = amlNextStep(f);
  assert.equal(step.who, "joint_agent");
  assert.equal(`${step.lead} · ${step.words}`, "Waiting on Savills · 2 documents missing");
  assert.equal(step.action, "joint_remind", "Remind now");
  const notChasing = amlNextStep(facts({ stage: "joint_in", joint: { firm: "Savills", rule: "letting", reliance: true, missing: 1, status: "finished", chasing: false } }));
  assert.equal(notChasing.who, "bgp");
  assert.equal(`${notChasing.lead} · ${notChasing.words}`, "To do · ask Savills for the missing document");
});

// ── The other side's own agent (Woody, 22 November 2026: "we also need to AML
// the Landlord if we are acting for a tenant.. which might be via their agent
// in this way") ─────────────────────────────────────────────────────────────

test("who is asked: what BGP chose, else the firm named, else the joint agent unless only the party's own agent is recorded", () => {
  assert.equal(jointRelationFor({ relation: "own" }, { firmId: "j" }, { agentId: null }), "own");
  assert.equal(jointRelationFor({ relation: "joint" }, { firmId: null }, { agentId: "a" }), "joint");
  assert.equal(jointRelationFor({ firmCompanyId: "a" }, { firmId: "j" }, { agentId: "a" }), "own");
  assert.equal(jointRelationFor({ firmCompanyId: "j" }, { firmId: "j" }, { agentId: "a" }), "joint");
  // Woody, 23 November 2026: "you are getting confused with the agents".
  assert.equal(jointRelationFor({}, { firmId: null }, { agentId: null }), "joint", "nothing recorded: the joint agent");
  assert.equal(jointRelationFor({}, { firmId: null }, { agentId: "a" }), "own", "only the party's own agent recorded");
  assert.equal(jointRelationFor({}, { firmId: "j" }, { agentId: null }), "joint");
  assert.equal(jointRelationFor({ relation: "boss" }, { firmId: "j" }, { agentId: "a" }), "joint", "an unknown relation is not taken");
  assert.equal(agentWords("own", "landlord"), "landlord's agent");
  assert.equal(agentWords("own", "vendor"), "seller's agent");
  assert.equal(agentWords("own", null), "their agent");
  assert.equal(agentWords(undefined, "landlord"), "joint agent", "a request from before is the joint agent's");
});

test("the landlord's agent's email: BGP acts for the tenant, they act for the landlord", () => {
  const base = {
    recipientName: "Sam Agent", firm: "Knight Frank", partyName: "Riverside Holdings Ltd", partyRole: "landlord", kind: "company" as const,
    dealName: "Unit 4 Riverside Walk", ref: "R2848W", link: "https://chatbgp.app/kyc-upload/abc", expiresAt: "2026-12-06T10:00:00Z",
    agents: [{ name: "Woody Bruce", email: "woody@example.com", phone: null }], sentFrom: "kyc@chatbgp.app",
    relation: "own" as const, clientRole: "tenant",
  };
  const letting = jointAgentRequestEmail({ ...base, letting: true });
  assert.match(letting.html, /We act for the tenant on <strong>Unit 4 Riverside Walk<\/strong>, and you act for <strong>Riverside Holdings Ltd<\/strong>, the landlord\./);
  assert.match(letting.html, /We are finalising our KYC on them and need the documents below\./);
  assert.doesNotMatch(letting.html, /joint agents|reliance/);
  assert.match(jointAgentRequestEmail({ ...base, letting: true, test: true }).html, /the other side&#39;s agent receives|the other side's agent receives/);
  const sale = jointAgentRequestEmail({ ...base, partyRole: "vendor", clientRole: "purchaser", letting: false });
  assert.match(sale.html, /We act for the buyer on <strong>Unit 4 Riverside Walk<\/strong>, and you act for <strong>Riverside Holdings Ltd<\/strong>, the seller\. We are finalising our KYC on them/);
  assert.doesNotMatch(sale.html, /as the joint agent/);
  const joint = jointAgentRequestEmail({ ...base, relation: null, letting: false, partyRole: "purchaser", clientRole: "vendor" });
  assert.match(joint.html, /We are jointly instructed by the seller on <strong>Unit 4 Riverside Walk<\/strong>, and you have undertaken the negotiations of this transaction with <strong>Riverside Holdings Ltd<\/strong>, the buyer\./);
  const chase = jointAgentMissingEmail({ ...base, letting: true, missing: [], nothingYet: true, chase: 1, test: true });
  assert.match(chase.html, /the other side&#39;s agent receives|the other side's agent receives/);
  assert.equal(jointLine({ rule: "letting", firm: null, status: null, files: 0, reliance: false, who: "landlord's agent" }), "Not asked: ask the landlord's agent for the documents");
  assert.equal(jointLine({ rule: "sale", firm: "Knight Frank", status: "not_sent", files: 0, reliance: false, who: "seller's agent" }), "The email to Knight Frank did not go: send it again");
});
