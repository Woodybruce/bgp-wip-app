// The AML dashboard's rules (Woody, 18 November 2026: step 6 of
// docs/deal-page-review-2026-11-18.md): where a party has got to, whether
// HMRC expects its checks yet, which pill it is on and who it waits on.
import test from "node:test";
import assert from "node:assert/strict";
import {
  amlBucket, amlDeadline, amlDealClosed, amlDue, amlLate, amlStage, amlWaitingOn, bucketCounts, daysSince, rowMatches,
  type AmlDashboardRow, type AmlPartyFacts,
} from "../shared/aml-dashboard";

const now = new Date("2026-11-18T12:00:00Z");
const facts = (over: Partial<AmlPartyFacts> = {}): AmlPartyFacts => ({
  role: "tenant", dealStatus: "NEG", kyc: { status: null, expiresAt: null },
  precheckAt: null, clientSentAt: null, clientFinishedAt: null, kyc4uOpen: false, kyc4uInReview: false, ...over,
});

test("a party's stage: a decision first, then the furthest step on the way", () => {
  assert.equal(amlStage(facts(), now), "not_started");
  assert.equal(amlStage(facts({ precheckAt: "2026-11-10T09:00:00Z" }), now), "bgp_checked");
  // Checks before asking older than 30 days do not count as done.
  assert.equal(amlStage(facts({ precheckAt: "2026-09-01T09:00:00Z" }), now), "not_started");
  assert.equal(amlStage(facts({ precheckAt: "2026-11-10", clientSentAt: "2026-11-12" }), now), "client_sent");
  assert.equal(amlStage(facts({ clientSentAt: "2026-11-12", clientFinishedAt: "2026-11-14" }), now), "client_finished");
  // KYC4U is no longer used (23 November 2026): a request or status of theirs holds no party.
  assert.equal(amlStage(facts({ clientFinishedAt: "2026-11-14", kyc4uOpen: true }), now), "client_finished");
  assert.equal(amlStage(facts({ kyc: { status: "in_review", expiresAt: null }, kyc4uInReview: true }), now), "not_started");
  // Read as the board stood before then, it was with KYC4U.
  assert.equal(amlStage(facts({ clientFinishedAt: "2026-11-14", kyc4uOpen: true, inHouse: false }), now), "with_kyc4u");
  // An "in review" with nothing at KYC4U (left by the in-app AML retired in
  // October 2026) is not with KYC4U: the party falls to its furthest real step.
  assert.equal(amlStage(facts({ kyc: { status: "in_review", expiresAt: null } }), now), "not_started");
  assert.equal(amlStage(facts({ kyc: { status: "in_review", expiresAt: null }, precheckAt: "2026-11-10" }), now), "bgp_checked");
  assert.equal(amlStage(facts({ kyc4uOpen: true, kyc: { status: "approved", expiresAt: "2027-05-01" } }), now), "approved");
  assert.equal(amlStage(facts({ kyc: { status: "approved", expiresAt: "2026-12-01" } }), now), "expiring");
  assert.equal(amlStage(facts({ kyc: { status: "approved", expiresAt: "2026-11-01" } }), now), "expired");
  assert.equal(amlStage(facts({ kyc: { status: "rejected", expiresAt: "2027-05-01" }, clientFinishedAt: "2026-11-14" }), now), "rejected");
  // An approval with no re-check date stays approved.
  assert.equal(amlStage(facts({ kyc: { status: "approved", expiresAt: null } }), now), "approved");
});

test("HMRC's timing: landlord and seller on any live deal, tenant and buyer from Heads of Terms", () => {
  assert.ok(amlDue("landlord", "AVA"));
  assert.ok(amlDue("vendor", null));
  assert.ok(!amlDue("tenant", "NEG"));
  assert.ok(!amlDue("tenant", "Marketing"));
  assert.ok(amlDue("tenant", "HOT"));
  assert.ok(amlDue("tenant", "SOL"));
  assert.ok(!amlDue("purchaser", "NEG"));
  assert.ok(amlDue("purchaser", "EXC"));
});

test("Issue 4's timing: BGP's client who lets or sells from engagement; everyone else from agreed heads of terms", () => {
  // BGP acts for the landlord (a letting) or the seller (a sale): due at once.
  assert.ok(amlDue("landlord", "AVA", "landlord"));
  assert.ok(amlDue("vendor", "LIVE", "vendor"), "an investment sale at Live is instructed");
  // BGP acts for the tenant (tenant rep) or the buyer (a purchase): the landlord or seller is the other side.
  assert.ok(!amlDue("landlord", "NEG", "tenant"));
  assert.ok(amlDue("landlord", "HOT", "tenant"));
  assert.ok(!amlDue("vendor", "AVA", "purchaser"));
  assert.ok(amlDue("vendor", "SOL", "purchaser"));
  // BGP's own client who buys or takes a lease: from heads of terms too.
  assert.ok(!amlDue("tenant", "NEG", "tenant"));
  assert.ok(amlDue("purchaser", "HOT", "purchaser"));
});

test("Issue 4's deadlines: before marketing for BGP's client who lets or sells, before exchange or completion for the rest", () => {
  assert.deepEqual(amlDeadline("landlord", "REP", "landlord"), { words: "before the property is marketed", passed: false });
  assert.equal(amlDeadline("landlord", "Available", "landlord").passed, true, "on the market");
  assert.equal(amlDeadline("vendor", "LIVE", "vendor").passed, false, "Live on the Investment Tracker is not yet marketed");
  assert.deepEqual(amlDeadline("purchaser", "SOL", "vendor"), { words: "before exchange of contracts", passed: false });
  assert.equal(amlDeadline("purchaser", "EXC", "vendor").passed, true);
  assert.equal(amlDeadline("tenant", "HOT", "landlord").words, "before any agreement is signed (identity) and before the lease completes (the rest)");
  assert.equal(amlDeadline("tenant", "COM", "landlord").passed, true);
  assert.deepEqual(amlDeadline("landlord", "SOL", "tenant"), { words: "before the lease completes", passed: false });
  // Late only while the party is not decided.
  const passed = amlDeadline("landlord", "SOL", "landlord");
  assert.equal(amlLate("not_started", passed), true);
  assert.equal(amlLate("client_sent", passed), true);
  assert.equal(amlLate("approved", passed), false);
  assert.equal(amlLate("not_required", passed), false);
  assert.equal(amlLate("not_started", amlDeadline("tenant", "SOL", "landlord")), false);
});

test("the pills", () => {
  assert.equal(amlBucket("not_started", true), "todo");
  assert.equal(amlBucket("bgp_checked", true), "todo");
  assert.equal(amlBucket("not_started", false), "not_due");
  assert.equal(amlBucket("client_sent", false), "in_progress");
  assert.equal(amlBucket("client_finished", true), "in_progress");
  assert.equal(amlBucket("with_kyc4u", true), "in_progress");
  assert.equal(amlBucket("approved", true), "done");
  assert.equal(amlBucket("rejected", false), "done");
  assert.equal(amlBucket("expiring", true), "expiring");
  assert.equal(amlBucket("expired", true), "expiring");
  assert.deepEqual(bucketCounts([{ bucket: "todo" }, { bucket: "todo" }, { bucket: "done" }, { bucket: "closed" }]), { todo: 2, in_progress: 0, done: 1, expiring: 0, not_due: 0, closed: 1 });
  // A completed or invoiced deal: a party never decided is Closed, not checked;
  // one approved at the time stays Done, even with the approval since run out.
  assert.ok(amlDealClosed("COM") && amlDealClosed("INV") && amlDealClosed("Invoiced"));
  assert.ok(!amlDealClosed("SOL") && !amlDealClosed("EXC") && !amlDealClosed(null));
  assert.equal(amlBucket("not_started", true, true), "closed");
  assert.equal(amlBucket("client_sent", true, true), "closed");
  assert.equal(amlBucket("with_kyc4u", true, true), "closed");
  assert.equal(amlBucket("approved", true, true), "done");
  assert.equal(amlBucket("expired", true, true), "done");
  assert.equal(amlBucket("rejected", true, true), "done");
});

test("who a party waits on", () => {
  assert.equal(amlWaitingOn("not_started", 0), "BGP: start the checks");
  assert.equal(amlWaitingOn("bgp_checked", 0), "BGP: send the client checks or sign off");
  assert.equal(amlWaitingOn("bgp_checked", 1), "BGP: send the client checks");
  // A letting under £10,000 a month asks nobody for anything: screened, it waits on the sign-off.
  assert.equal(amlWaitingOn("bgp_checked", 0, true), "BGP: sign off");
  assert.equal(amlWaitingOn("bgp_checked", 1, true), "Officers: sign off");
  assert.equal(amlWaitingOn("not_started", 0, true), "BGP: start the checks");
  assert.equal(amlWaitingOn("client_sent", 2), "The client");
  assert.equal(amlWaitingOn("client_finished", 0), "BGP: sign off");
  assert.equal(amlWaitingOn("client_finished", 1), "Officers: sign off");
  assert.equal(amlWaitingOn("with_kyc4u", 1), "Officers: sign off", "KYC4U is no longer used");
  assert.equal(amlWaitingOn("approved", 0), "Nobody");
  assert.equal(amlWaitingOn("rejected", 0), "The Nominated Officer");
  assert.equal(amlWaitingOn("not_required", 0), "Nobody");
  assert.equal(amlWaitingOn("expired", 0), "BGP: check it again");
});

test("days since anything moved, and the search", () => {
  assert.equal(daysSince([null, undefined, "2026-11-15T09:00:00Z", "2026-11-01"], now), 3);
  assert.equal(daysSince(["2026-11-18T11:00:00Z"], now), 0);
  assert.equal(daysSince([null, "not a date"], now), null);
  const row = {
    brandName: "The Test Bakery", signsAs: "The Test Bakery Operations Limited", dealName: "Unit 9", propertyName: "Westgate",
    dealRef: 1234, agents: ["Victoria Broadhead"],
  } as AmlDashboardRow;
  for (const q of ["bakery", "OPERATIONS", "unit 9", "westgate", "#1234", "victoria", ""]) assert.ok(rowMatches(row, q), q);
  assert.ok(!rowMatches(row, "pret"));
  // The transaction's status is searchable in its words (23 November 2026).
  assert.ok(rowMatches({ ...row, dealStatus: "SOL", dealType: "New Letting" }, "solicitors"));
  assert.ok(!rowMatches({ ...row, dealStatus: "SOL", dealType: "New Letting" }, "completed"));
});

test("the transaction's status in the Transactions board's words (Woody, 23 November 2026)", async () => {
  const { amlDealStatusWords } = await import("../shared/aml-dashboard");
  assert.deepEqual(amlDealStatusWords({ dealStatus: "AVA", dealType: "New Letting" }), { code: "AVA", words: "Marketing" });
  assert.deepEqual(amlDealStatusWords({ dealStatus: "AVA", dealType: "Sale" }), { code: "AVA", words: "Available" });
  assert.deepEqual(amlDealStatusWords({ dealStatus: "REP", dealType: "Sale" }), { code: "REP", words: "Reporting" });
  assert.deepEqual(amlDealStatusWords({ dealStatus: "SOL", dealType: null }), { code: "SOL", words: "Solicitors" });
  assert.deepEqual(amlDealStatusWords({ dealStatus: "Completed", dealType: "New Letting" }), { code: "COM", words: "Completed" });
  assert.deepEqual(amlDealStatusWords({ dealStatus: null, dealType: null }), { code: null, words: null });
});

test("no Not with KYC4U mark: KYC4U is no longer used (23 November 2026)", async () => {
  const board = await import("../shared/aml-dashboard");
  assert.equal((board as any).amlNeedsKyc4u, undefined);
});

test("one line per transaction with its parties inside (Woody, 24 November 2026)", async () => {
  const { groupAmlByTransaction, transactionBuckets, transactionBucketCounts, transactionMatches, leadParty } = await import("../shared/aml-dashboard");
  const party = (dealId: string, role: string, over: Partial<AmlDashboardRow> = {}): AmlDashboardRow => ({
    key: `${dealId}:${role}`, dealId, dealName: `Unit ${dealId}`, dealRef: 100, dealStatus: "HOT", dealType: "New Letting", propertyName: "Westgate",
    role, brandId: `${dealId}-${role}`, brandName: `${role} brand`, signsAs: null, level: "standard", levelWhy: [], stage: "not_started",
    bucket: "todo", due: true, deadline: "before the lease completes", late: false, redFlags: [], waitingOn: "BGP: start the checks",
    movedDays: null, approvedBy: null, expiresAt: null, agents: ["Victoria Broadhead"], mine: false, ...over,
  });
  // The tenant comes back before the landlord; the line reads landlord then tenant.
  const rows = [
    party("a", "tenant", { bucket: "in_progress", redFlags: ["Possible match"], late: true }),
    party("a", "landlord", { bucket: "todo", agents: ["Victoria Broadhead", "Jack Barratt"] }),
    party("b", "vendor", { bucket: "done" }),
    party("b", "purchaser", { bucket: "done", mine: true }),
    party("c", "landlord", { bucket: "done", brandName: "Hammerson" }),
    party("c", "tenant", { bucket: "not_due" }),
  ];
  const lines = groupAmlByTransaction(rows);
  assert.deepEqual(lines.map(l => l.dealId), ["a", "b", "c"]);
  assert.deepEqual(lines[0].parties.map(p => p.role), ["landlord", "tenant"]);
  assert.deepEqual(lines[0].buckets, ["todo", "in_progress"]);
  assert.equal(lines[0].late, true);
  assert.equal(lines[0].redFlags, 1);
  assert.deepEqual(lines[0].agents, ["Victoria Broadhead", "Jack Barratt"]);
  assert.deepEqual(lines[1].buckets, ["done"]);
  assert.equal(lines[1].mine, true);
  // Landlord cleared, tenant not due yet: nothing to do now.
  assert.deepEqual(lines[2].buckets, ["not_due"]);
  assert.deepEqual(transactionBucketCounts(lines), { todo: 1, in_progress: 1, done: 1, expiring: 0, not_due: 1, closed: 0 });
  // Done only when every party is done; a party still to do keeps the transaction off Done.
  assert.deepEqual(transactionBuckets(["done", "todo"]), ["todo"]);
  assert.deepEqual(transactionBuckets(["expiring", "done"]), ["expiring"]);
  assert.deepEqual(transactionBuckets(["closed", "done"]), ["closed"]);
  assert.deepEqual(transactionBuckets(["not_due", "todo"]), ["todo"]);
  assert.deepEqual(transactionBuckets([]), []);
  // The search finds the transaction through any party, and it opens on the party on the pill.
  assert.ok(transactionMatches(lines[2], "hammerson"));
  assert.ok(!transactionMatches(lines[2], "pret"));
  assert.equal(leadParty(lines[0], "in_progress").role, "tenant");
  assert.equal(leadParty(lines[0], "todo").role, "landlord");
  assert.equal(leadParty(lines[0], "done").role, "landlord");
});

// What a transaction is known by (Woody, 25 November 2026: "transactions which
// should lead with the building or brand depending on if we are acting on the
// building or then acting on the brand"). Cases from the live board.
test("a transaction leads with the building, or with the brand when BGP acts for the tenant", async () => {
  const { transactionLead, nameWithout } = await import("../shared/aml-dashboard");
  const p = (role: string, brandName: string, clientRole: string) => ({ role, brandName, clientRole });
  const lead = (dealName: string, propertyName: string | null, parties: ReturnType<typeof p>[]) => transactionLead({ dealName, propertyName, parties });
  // BGP acts for the landlord: the building, with the tenant under it.
  assert.deepEqual(lead("Tunsgate Quarter", "Tunsgate Quarter", [p("landlord", "Wirral Metropolitan Borough Council", "landlord"), p("tenant", "Rodd & Gunn", "landlord")]),
    { lead: "Tunsgate Quarter", sub: "Rodd & Gunn", actingFor: "building" });
  // The rest of the name is what tells it apart: the tenant, or the unit.
  assert.equal(lead("Bird House Brewery – Brixton Village", "Brixton Village", [p("landlord", "Hondo Enterprises", "landlord"), p("tenant", "Bird House Brewery", "landlord")]).sub, "Bird House Brewery");
  assert.deepEqual(lead("Bluewater Shopping Centre – U063", "Bluewater Shopping Centre", [p("landlord", "Landsec", "landlord")]),
    { lead: "Bluewater Shopping Centre", sub: "U063", actingFor: "building" });
  assert.equal(lead("King's Road Park – Anytime Fitness", "Kings Road Park", [p("landlord", "Berkeley Group", "landlord")]).sub, "Anytime Fitness", "an apostrophe aside");
  assert.equal(lead("Lego – Unit 3, Canada Place", "Canary Wharf Estate", [p("landlord", "Canary Wharf Group", "landlord")]).sub, "Lego – Unit 3, Canada Place", "a name that is not the building's is kept whole");
  // A sale: the building, with the buyer under it.
  assert.deepEqual(lead("One Clapham", "One Clapham", [p("vendor", "Mount Anvil", "vendor"), p("purchaser", "Inovalis", "vendor")]),
    { lead: "One Clapham", sub: "Inovalis", actingFor: "building" });
  // BGP acts for the tenant: the brand, with the building under it.
  assert.deepEqual(lead("Google - Positive Retail", "Google Kings Cross", [p("landlord", "Google", "tenant"), p("tenant", "Positive Retail", "tenant")]),
    { lead: "Positive Retail", sub: "Google Kings Cross", actingFor: "brand" });
  assert.deepEqual(lead("Vodafone", "The Arndale Shopping Centre", [p("landlord", "tam family", "tenant"), p("tenant", "Vodafone", "tenant")]),
    { lead: "Vodafone", sub: "The Arndale Shopping Centre", actingFor: "brand" });
  // No building: the transaction's own name.
  assert.equal(lead("[TEST AML] 3", null, [p("landlord", "AML Test Landlord Ltd", "landlord"), p("tenant", "AML Test Tenant Ltd", "landlord")]).lead, "[TEST AML] 3");
  // Taking a name off the start or the end, never the middle of a word.
  assert.equal(nameWithout("Grand Central Shopping Centre – Unit 16B", "Grand Central Shopping Centre"), "Unit 16B");
  assert.equal(nameWithout("Grand Centrality – Unit 1", "Grand Central"), "Grand Centrality – Unit 1");
  assert.equal(nameWithout("Elephant Park - Mikos Mikos", "Elephant Park"), "Mikos Mikos");
});

// Woody, 25 November 2026: "the search box in the AML dash board page needs to have a
// slightly wider search function as its not picking up".
test("the AML search reads words in any order, across the transaction's parties, punctuation aside", async () => {
  const { transactionMatches, rowMatches } = await import("../shared/aml-dashboard");
  const party = (over: Record<string, unknown>) => ({
    key: "d:landlord", dealId: "d", dealName: "Lewisham Shopping Centre · Unit 12", dealRef: 4664, dealStatus: "NEG", dealType: "New Letting",
    propertyName: "Lewisham Shopping Centre", role: "landlord", brandId: "b", brandName: "Landsec", signsAs: "LS LEWISHAM LIMITED",
    level: "standard", levelWhy: [], stage: "not_started", bucket: "todo", due: true, deadline: "", late: false, redFlags: [],
    waitingOn: "BGP", movedDays: 2, approvedBy: null, expiresAt: null, agents: ["Woody Bruce"], mine: true, ...over,
  }) as any;
  const tx = { lead: "Lewisham Shopping Centre", parties: [party({}), party({ role: "tenant", brandName: "Marks & Spencer", signsAs: "MARKS AND SPENCER PLC" })] };
  assert.equal(transactionMatches(tx, "lewisham marks"), true);
  assert.equal(transactionMatches(tx, "marks & spencer"), true);
  assert.equal(transactionMatches(tx, "spencer lewisham"), true);
  assert.equal(transactionMatches(tx, "4664"), true);
  assert.equal(transactionMatches(tx, "#4664"), true);
  assert.equal(transactionMatches(tx, "ls lewisham ltd"), false);
  assert.equal(rowMatches(party({ brandName: "St George's Estates" }), "st georges"), true);
  assert.equal(transactionMatches(tx, "nothing like it"), false);
});
