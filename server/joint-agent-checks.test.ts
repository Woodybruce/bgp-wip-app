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
  type JointRequestForRecord,
} from "../shared/aml-policy";
import {
  JOINT_CHASE_MAX, bornAgrees, bornKey, checkJointReading, jointChaseDue, jointCoverage, jointGapLines, jointLine, jointNextChaseDay, jointRelianceInput, jointRelianceTerms, jointWorkingDay, londonDayNumber, sameJointCompany,
  type JointChase, type JointFileReading,
} from "../shared/joint-agent-checks";
import { jointAgentAsks, jointAgentChaseStoppedEmail, jointAgentFinishedEmail, jointAgentMissingEmail, jointAgentRequestEmail } from "../shared/kyc-request";
import { amlNextStep, type AmlBoxFacts } from "../shared/aml-box";
import { amlBucket, amlNeedsKyc4u, amlStage, amlWaitingOn } from "../shared/aml-dashboard";
import { agentAmlState } from "../shared/agent-aml";
import { jointAskRefusal, readJointFile } from "./joint-agent-checks";
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

test("the joint agent reason is refused on a letting in scope and on anything but a sale, in HMRC's terms", () => {
  assert.match(jointAgentNotRequiredRefusal("letting") || "", /no joint agent exception/);
  assert.match(jointAgentNotRequiredRefusal("other") || "", /Only a sale/);
  assert.equal(jointAgentNotRequiredRefusal("sale"), null);
  assert.equal(jointAgentNotRequiredRefusal("letting_under"), null);
  assert.equal(jointAgentNotRequiredRefusal("advisory"), null);
});

// ── Not required: the record of asking ──────────────────────────────────────

const comment = "Savills found the buyer and ran the negotiation; BGP acted for the seller only.";
const sent: JointRequestForRecord[] = [
  { ref: "7K2Q9M", sentAt: "2026-11-20T09:15:00.000Z", whom: "Savills (Jane Smith)", how: "app", files: 3 },
  { ref: "ABCD12", sentAt: "2026-11-21T09:15:00.000Z", whom: "Savills", how: "email", files: 0 },
  { ref: "NOSEND", sentAt: null, whom: "Savills", how: "app", files: 0 },
];
const problem = (body: Record<string, unknown>, rule: Parameters<typeof notRequiredInput>[1]["rule"] = "sale") => {
  const r = notRequiredInput({ reason: "joint_agent", comment, ...body }, { rule, today, requests: sent });
  assert.ok("problem" in r, JSON.stringify(body));
  return (r as { problem: string }).problem;
};

test("on a sale the joint agent reason needs what came back and how BGP asked", () => {
  assert.match(problem({}), /what came back/);
  assert.match(problem({ outcome: "received" }), /date you asked/);
  assert.match(problem({ outcome: "received", askedOn: "2026-11-25", askedHow: "email", askedWhom: "Savills" }), /future/);
  assert.match(problem({ outcome: "received", askedOn: "2026-11-20", askedHow: "app", askedWhom: "Savills" }), /how you asked/);
  assert.match(problem({ outcome: "received", askedOn: "2026-11-20", askedHow: "phone", askedWhom: "" }), /who you asked/);
  const typed = notRequiredInput({ reason: "joint_agent", comment, outcome: "not_provided", askedOn: "2026-11-18", askedHow: "phone", askedWhom: "Savills (Jane Smith)" }, { rule: "sale", today, requests: sent });
  assert.ok(!("problem" in typed));
  assert.deepEqual(typed.asked, { askedOn: "2026-11-18", how: "phone", whom: "Savills (Jane Smith)", outcome: "not_provided", ref: null, missing: null, note: null });
  assert.equal(jointAskWords(typed.asked!), "Asked Savills (Jane Smith) for their checks on 18 Nov 2026, by phone: they did not provide them");
});

test("a request made in the app is the record: sent, on this party, and with files when they sent their checks", () => {
  const app = notRequiredInput({ reason: "joint_agent", comment, outcome: "received", jointRef: "7k2q9m" }, { rule: "sale", today, requests: sent });
  assert.ok(!("problem" in app));
  assert.deepEqual(app.asked, { askedOn: "2026-11-20", how: "app", whom: "Savills (Jane Smith)", outcome: "received", ref: "7K2Q9M", missing: null, note: null });
  // Files the joint agent emailed to someone at BGP: asked by email.
  const emailed = notRequiredInput({ reason: "joint_agent", comment, outcome: "not_provided", jointRef: "ABCD12" }, { rule: "sale", today, requests: sent });
  assert.ok(!("problem" in emailed));
  assert.equal(emailed.asked?.how, "email");
  assert.match(problem({ outcome: "received", jointRef: "ABCD12" }), /Nothing has come back/);
  assert.match(problem({ outcome: "received", jointRef: "NOSEND" }), /not sent/);
  assert.match(problem({ outcome: "received", jointRef: "ZZZZZZ" }), /not on this party/);
});

test("the joint agent reason is refused on a letting in scope; a letting under £10,000 a month and no deal need no record", () => {
  assert.match(problem({ outcome: "received", jointRef: "7K2Q9M" }, "letting"), /no joint agent exception/);
  const under = notRequiredInput({ reason: "joint_agent", comment }, { rule: "letting_under", today });
  assert.ok(!("problem" in under) && under.asked === null);
  const noDeal = notRequiredInput({ reason: "no_deal", comment }, { rule: "letting", today });
  assert.ok(!("problem" in noDeal) && noDeal.reason === "no_deal");
});

test("a mark made before the rule lapses on a letting, and on a sale with no record of asking", () => {
  assert.match(notRequiredLapse({ reason: "joint_agent", asked: null }, "letting") || "", /no joint agent exception/);
  assert.match(notRequiredLapse({ reason: "joint_agent", asked: null }, "sale") || "", /record that the joint agent was asked/);
  assert.equal(notRequiredLapse({ reason: "joint_agent", asked: { askedOn: "2026-11-20", how: "app", whom: "Savills", outcome: "received", ref: "7K2Q9M" } }, "sale"), null);
  assert.equal(notRequiredLapse({ reason: "joint_agent", asked: null }, "letting_under"), null);
  assert.equal(notRequiredLapse({ reason: "no_deal", asked: null }, "letting"), null);
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

test("the email to the joint agent names the party, the reference and HMRC's reason, and escapes what it is given", () => {
  const base = {
    recipientName: "Jane <b>Smith</b>", firm: "Savills", partyName: "Acme <script>alert(1)</script> Ltd", partyRole: "purchaser", kind: "company" as const,
    dealName: "12 Example Street", ref: "7K2Q9M", link: "https://chatbgp.app/kyc-upload/abc", expiresAt: "2026-12-06T10:00:00Z",
    agents: [{ name: "Woody Bruce", email: "woody@example.com", phone: null }], sentFrom: "kyc@chatbgp.app",
  };
  const sale = jointAgentRequestEmail({ ...base, letting: false });
  assert.match(sale.subject, /\(ref 7K2Q9M\)/);
  assert.match(sale.html, /AMLG2200, section 21/);
  assert.match(sale.html, /https:\/\/chatbgp\.app\/kyc-upload\/abc/);
  assert.doesNotMatch(sale.html, /<script>/);
  assert.doesNotMatch(sale.html, /<b>Smith<\/b>/);
  const letting = jointAgentRequestEmail({ ...base, partyRole: "tenant", letting: true });
  assert.match(letting.html, /regulation 39/);
  assert.ok(jointAgentAsks({ kind: "company", letting: true }).some(a => a.title === "The reliance terms"));
  assert.ok(!jointAgentAsks({ kind: "company", letting: false }).some(a => a.title === "The reliance terms"));
  assert.ok(!jointAgentAsks({ kind: "individual", letting: false }).some(a => a.title === "The company"));
  const nudge = jointAgentMissingEmail({ ...base, letting: true, missing: [], nothingYet: true, chase: 1 });
  assert.match(nudge.subject, /^Reminder/);
  assert.match(nudge.html, /Send your checks/);
  const still = jointAgentMissingEmail({ ...base, letting: false, missing: ["Daniel North: a proof of address <b>x</b>", "Your sanctions and PEP screening"], nothingYet: false, chase: 2 });
  assert.match(still.subject, /^Still needed: your AML checks on/);
  assert.match(still.html, /Daniel North: a proof of address/);
  assert.doesNotMatch(still.html, /<b>x<\/b>/);
  assert.match(still.html, /HMRC asks us to record what was and wasn't provided/);
  const stopped = jointAgentChaseStoppedEmail({ firm: "Savills", partyName: "Acme Ltd", dealName: "12 Example Street", ref: "7K2Q9M", dealLink: "https://chatbgp.app/deals/1",
    missing: ["their sanctions and PEP screening"], chases: 10, letting: false, sentFrom: "kyc@chatbgp.app" });
  assert.match(stopped.subject, /has not sent what is missing/);
  assert.match(stopped.html, /Still missing after 10 reminders/);
  assert.match(stopped.html, /they sent part of their checks/);
  const done = jointAgentFinishedEmail({ firm: "Savills", recipientName: "Jane Smith", partyName: "Acme Ltd", dealName: "12 Example Street", ref: "7K2Q9M",
    dealLink: "https://chatbgp.app/deals/1", files: ["passport.pdf"], letting: true, reliance: null, missing: ["Jane Owner: address"], sentFrom: "kyc@chatbgp.app" });
  assert.match(done.html, /not agreed yet/);
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

test("the line under the party says where the joint agent's checks are, in HMRC's route", () => {
  assert.match(jointLine({ rule: "letting", firm: "Savills", status: null, files: 0, reliance: false }), /reliance agreement/);
  assert.match(jointLine({ rule: "sale", firm: "Savills", status: null, files: 0, reliance: false }), /^Not asked: ask Savills/);
  assert.match(jointLine({ rule: "sale", firm: "Savills", status: "sent", files: 0, reliance: false }), /waiting/);
  assert.equal(jointLine({ rule: "sale", firm: "Savills", status: "in", files: 3, reliance: false }), "Savills sent 3 files");
  assert.match(jointLine({ rule: "letting", firm: "Savills", status: "in", files: 1, reliance: false }), /reliance terms not agreed/);
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
  assert.match(next.words, /^1 file from Savills is not read yet\. Press Read again, or check it by eye, before asking them for anything else\.$/);
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
  assert.match(amlWaitingOn("joint_in", 0), /Officers/);
  assert.equal(amlNeedsKyc4u("enhanced", "joint_in"), true);
});

const facts = (over: Partial<AmlBoxFacts> = {}): AmlBoxFacts => ({
  role: "purchaser", stage: "joint_asked", due: true, approvedBy: null, expiresAt: null, notRequiredWords: null,
  company: true, companyMissing: false, gaps: [], askName: null, precheckRunning: false, redFlags: 0, factors: 0,
  sanctionsOnly: false, clientChecks: true, request: null, people: [], kyc4u: "none", canSignOff: true, canDecide: true,
  signOffBlocked: null, needsNote: false, ...over,
});

test("the Next line follows the joint agent: waiting on them, then the officers decide in HMRC's terms", () => {
  const sale = { firm: "Savills", rule: "sale" as const, reliance: false, missing: 0 };
  const waiting = amlNextStep(facts({ joint: { ...sale, status: "sent" } }));
  assert.equal(waiting.who, "joint_agent");
  assert.equal(waiting.action, "joint");
  assert.match(waiting.words, /records that you asked/);
  const inSale = amlNextStep(facts({ stage: "joint_in", joint: { ...sale, status: "in", missing: 0 } }));
  assert.equal(inSale.who, "officers");
  assert.match(inSale.words, /Not required/);
  const gapsSale = amlNextStep(facts({ stage: "joint_in", joint: { ...sale, status: "in", missing: 2 } }));
  assert.equal(gapsSale.who, "bgp");
  assert.match(gapsSale.words, /2 things are still missing\. Ask them for what's missing\. An officer can also record what came/);
  const letting = { firm: "Savills", rule: "letting" as const, missing: 0 };
  assert.equal(amlNextStep(facts({ joint: { ...letting, status: "in", reliance: false } })).who, "joint_agent");
  assert.match(amlNextStep(facts({ joint: { ...letting, status: "finished", reliance: true } })).words, /records the reliance/);
  // A link that ran out goes back to the client checks.
  assert.equal(amlNextStep(facts({ stage: "not_started", joint: { ...sale, status: "expired" } })).action, "send_client_checks");
  // Red flags still come first.
  assert.equal(amlNextStep(facts({ redFlags: 1, joint: { ...sale, status: "in" } })).action, "request_kyc4u");
  // With their route running, BGP's own step of setting the company that signs waits.
  assert.equal(amlNextStep(facts({ companyMissing: true, joint: { ...sale, status: "in" } })).action, "joint");
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

test("on a sale the record says what did not come, and what their files showed is answered first", () => {
  const withGaps: JointRequestForRecord[] = [{ ref: "7K2Q9M", sentAt: "2026-11-20T09:15:00.000Z", whom: "Savills", how: "app", files: 2,
    missing: ["Daniel North: address", "their sanctions and PEP screening"], flags: ["s.pdf: the screening found a possible match"] }];
  const ask = (b: Record<string, unknown>) => notRequiredInput({ reason: "joint_agent", comment, jointRef: "7K2Q9M", ...b }, { rule: "sale", today, requests: withGaps });
  const flagged = ask({ outcome: "partly" });
  assert.ok("problem" in flagged && /show something to look at/.test(flagged.problem));
  const partly = ask({ outcome: "partly", flagNote: "The match is a namesake: different date of birth." });
  assert.ok(!("problem" in partly));
  assert.deepEqual(partly.asked?.missing, ["Daniel North: address", "their sanctions and PEP screening"]);
  assert.match(jointAskWords(partly.asked!), /they sent part of their checks \(not sent: Daniel North: address; their sanctions and PEP screening\)/);
  assert.match(partly.asked?.note || "", /namesake/);
  const typedList = ask({ outcome: "partly", flagNote: "The match is a namesake.", missing: "Their screening\nThe register entry" });
  assert.deepEqual(!("problem" in typedList) && typedList.asked?.missing, ["Their screening", "The register entry"]);
  const received = ask({ outcome: "received", flagNote: "The match is a namesake." });
  assert.ok("problem" in received && /say how you checked these by hand/.test(received.problem));
  const byHand = ask({ outcome: "received", flagNote: "The match is a namesake.", checkedByHand: "Their CDD summary shows both, seen in their file." });
  assert.ok(!("problem" in byHand) && /Checked by hand/.test(byHand.asked?.note || ""));
  // Nothing came: the flags and gaps do not apply.
  assert.ok(!("problem" in ask({ outcome: "not_provided" })));
  // Asked another way: "part of them" needs what did not come.
  const typed = notRequiredInput({ reason: "joint_agent", comment, outcome: "partly", askedOn: "2026-11-18", askedHow: "phone", askedWhom: "Savills" }, { rule: "sale", today });
  assert.ok("problem" in typed && /did not send/.test(typed.problem));
});

test("the Next line says what is still missing and that the app is chasing", () => {
  const f = facts({ stage: "joint_in", joint: { firm: "Savills", rule: "sale", reliance: false, missing: 2, status: "in", chasing: true } });
  const step = amlNextStep(f);
  assert.equal(step.who, "joint_agent");
  assert.match(step.words, /2 things are still missing/);
  assert.match(step.words, /chasing them every three days/);
  const notChasing = amlNextStep(facts({ stage: "joint_in", joint: { firm: "Savills", rule: "letting", reliance: true, missing: 1, status: "finished", chasing: false } }));
  assert.equal(notChasing.who, "bgp");
  assert.match(notChasing.words, /1 thing is still missing\. Ask them for what's missing\. BGP can't rely on their checks until everything is in, unless an officer checked the rest by hand\.$/);
});
