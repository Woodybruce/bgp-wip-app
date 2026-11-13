// The feeds' plain rules, the staff-only-thread guard and the reader's
// checks. No database and no AI call.
//   node --import tsx --test server/requirement-feeds.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  viewingsToSuggest, dealSatisfiedQuestion, reachedSolicitors, threadIsStaffOnly, companyTags,
  readStatedRequirements, parseReaderReply, readerDailyCap,
  type RuleViewing, type ThreadPerson, type ReaderDeps, type ReaderInput,
} from "./requirement-feeds";

const TODAY = "2026-11-12";
const viewing = (id: string, viewingDate: string, extra: Partial<RuleViewing> = {}): RuleViewing =>
  ({ id, viewingDate, status: "completed", confirmed: true, hasUnit: true, linked: false, line: null, ...extra });

// ── Rule 1 ─────────────────────────────────────────────────────────────────

test("two viewings in 90 days by a brand with no requirement raise both, oldest first", () => {
  const out = viewingsToSuggest([viewing("b", "2026-11-10"), viewing("a", "2026-09-01")], 0, TODAY);
  assert.deepEqual(out.map(v => v.id), ["a", "b"]);
});

test("one viewing is not enough, and a brand with a requirement is never raised", () => {
  assert.deepEqual(viewingsToSuggest([viewing("a", "2026-11-10")], 0, TODAY), []);
  // With a requirement on the books the viewings show on it as evidence instead.
  assert.deepEqual(viewingsToSuggest([viewing("a", "2026-11-10"), viewing("b", "2026-11-11")], 1, TODAY), []);
});

test("only completed, confirmed viewings of a unit inside the 90 days count", () => {
  const one = viewing("ok", "2026-11-10");
  const never = [
    viewing("booked", "2026-11-11", { status: "scheduled" }),
    viewing("cancelled", "2026-11-09", { status: "cancelled" }),
    viewing("no-show", "2026-11-08", { status: "no_show" }),
    viewing("unconfirmed", "2026-11-07", { confirmed: false }),
    viewing("no-unit", "2026-11-06", { hasUnit: false }),
    viewing("already-linked", "2026-11-05", { linked: true }),
    viewing("too-old", "2026-08-14"),
    viewing("future", "2026-11-13"),
    viewing("bad-date", "12/11/2026"),
  ];
  for (const other of never) assert.deepEqual(viewingsToSuggest([one, other], 0, TODAY), [], other.id);
  // The window is today and the 89 days before it, as on the Requirements page.
  assert.equal(viewingsToSuggest([one, viewing("first-day", "2026-08-15")], 0, TODAY).length, 2);
});

test("a dismissed suggestion does not come back until there are two new viewings", () => {
  const dismissed = [viewing("a", "2026-10-01", { line: "dismissed" }), viewing("b", "2026-10-08", { line: "dismissed" })];
  assert.deepEqual(viewingsToSuggest([...dismissed, viewing("c", "2026-11-01")], 0, TODAY), []);
  assert.deepEqual(viewingsToSuggest([...dismissed, viewing("c", "2026-11-01"), viewing("d", "2026-11-10")], 0, TODAY).map(v => v.id), ["c", "d"]);
  // Viewings a person already confirmed or attached belonged to a requirement that has since closed.
  assert.deepEqual(viewingsToSuggest([viewing("a", "2026-10-01", { line: "confirmed" }), viewing("b", "2026-10-08", { line: "attached" }), viewing("c", "2026-11-01")], 0, TODAY), []);
});

test("a new viewing joins the suggestion that is already open; one already in it is not raised twice", () => {
  const open = [viewing("a", "2026-10-01", { line: "open" }), viewing("b", "2026-10-08", { line: "open" })];
  assert.deepEqual(viewingsToSuggest(open, 0, TODAY), []);
  assert.deepEqual(viewingsToSuggest([...open, viewing("c", "2026-11-10")], 0, TODAY).map(v => v.id), ["c"]);
});

// ── Rule 2 ─────────────────────────────────────────────────────────────────

test("reaching solicitors: from before Solicitors to Solicitors or straight past it, once", () => {
  assert.equal(reachedSolicitors("HOT", "SOL"), true);
  assert.equal(reachedSolicitors("Negotiating", "Solicitors"), true);
  assert.equal(reachedSolicitors("NEG", "EXC"), true);
  assert.equal(reachedSolicitors(null, "COM"), true);
  assert.equal(reachedSolicitors("SOL", "EXC"), false);
  assert.equal(reachedSolicitors("SOL", "SOL"), false);
  assert.equal(reachedSolicitors("COM", "INV"), false);
  assert.equal(reachedSolicitors("AVA", "INV"), false);
  assert.equal(reachedSolicitors("NEG", "HOT"), false);
  assert.equal(reachedSolicitors("SOL", "NEG"), false);
  assert.equal(reachedSolicitors("NEG", "WIT"), false);
  assert.equal(reachedSolicitors("NEG", "nonsense"), false);
});

test("a letting for the brand reaching solicitors asks about its one open requirement", () => {
  const base = { dealId: "d1", dealType: "New Letting", oldStatus: "HOT", newStatus: "SOL", tenantId: "c-gails", openRequirements: [{ id: "r1" }] };
  assert.deepEqual(dealSatisfiedQuestion(base), { ask: true, requirementId: "r1", why: "a letting for the brand reached solicitors" });
  for (const dealType of ["Temp Lease", "Licence", "Letting", "Lease Acquisition", "Tenant Acquisition"]) {
    assert.equal(dealSatisfiedQuestion({ ...base, dealType }).ask, true, dealType);
  }
});

test("no question without a brand, an open requirement, or a deal in which the brand takes space", () => {
  const base = { dealId: "d1", dealType: "New Letting", oldStatus: "HOT", newStatus: "SOL", tenantId: "c-gails", openRequirements: [{ id: "r1" }] };
  assert.equal(dealSatisfiedQuestion({ ...base, tenantId: null }).ask, false);
  assert.equal(dealSatisfiedQuestion({ ...base, openRequirements: [] }).ask, false);
  assert.equal(dealSatisfiedQuestion({ ...base, oldStatus: "SOL", newStatus: "EXC" }).ask, false);
  assert.equal(dealSatisfiedQuestion({ ...base, newStatus: "NEG" }).ask, false);
  // The tenant on a disposal can be the party leaving; investment and advisory deals are not lettings to the brand.
  for (const dealType of ["Lease Disposal", "Sub-Letting", "Sale", "Purchase", "Rent Review", "Lease Renewal", "", null]) {
    assert.equal(dealSatisfiedQuestion({ ...base, dealType }).ask, false, String(dealType));
  }
});

test("several open requirements: the reviewer chooses, unless one is linked to the deal", () => {
  const base = { dealId: "d1", dealType: "New Letting", oldStatus: "NEG", newStatus: "SOL", tenantId: "c-pret" };
  assert.deepEqual(dealSatisfiedQuestion({ ...base, openRequirements: [{ id: "r1" }, { id: "r2" }] }), { ask: true, requirementId: null, why: "a letting for the brand reached solicitors" });
  assert.equal(dealSatisfiedQuestion({ ...base, openRequirements: [{ id: "r1" }, { id: "r2", dealId: "d1" }] }).requirementId, "r2");
  assert.equal(dealSatisfiedQuestion({ ...base, openRequirements: [{ id: "r1", dealId: "other" }, { id: "r2" }] }).requirementId, null);
});

// ── The staff-only-thread guard ────────────────────────────────────────────

const EMILY: ThreadPerson = { id: "u-emily", email: "emily@brucegillinghampollard.com", role: "Agent" };
const TOM: ThreadPerson = { id: "u-tom", email: "Tom@BruceGillinghamPollard.com ", role: null };
const LANDSEC: ThreadPerson = { id: "u-landsec", email: "leasing@landsec.com", role: "Client" };

test("a team thread whose creator and every member is BGP staff may be read", () => {
  assert.equal(threadIsStaffOnly({ isAiChat: false }, ["u-emily", "u-tom"], [EMILY, TOM]), true);
  assert.equal(threadIsStaffOnly({}, ["u-emily", "u-emily", null, "u-tom"], [EMILY, TOM]), true);
});

test("one client member and the thread is never read", () => {
  assert.equal(threadIsStaffOnly({}, ["u-emily", "u-tom", "u-landsec"], [EMILY, TOM, LANDSEC]), false);
  // A client login on a BGP address, and an outside address with a staff role.
  assert.equal(threadIsStaffOnly({}, ["u-emily", "x"], [EMILY, { id: "x", email: "demo@brucegillinghampollard.com", role: "Client" }]), false);
  assert.equal(threadIsStaffOnly({}, ["u-emily", "x"], [EMILY, { id: "x", email: "someone@gmail.com", role: "Agent" }]), false);
  assert.equal(threadIsStaffOnly({}, ["u-emily", "x"], [EMILY, { id: "x", email: "x@brucegillinghampollard.com.evil.com", role: null }]), false);
  assert.equal(threadIsStaffOnly({}, ["u-emily", "x"], [EMILY, { id: "x", email: null, role: null }]), false);
});

test("a member who cannot be found, an empty thread and a one-to-one ChatBGP thread are left alone", () => {
  assert.equal(threadIsStaffOnly({}, ["u-emily", "u-gone"], [EMILY]), false);
  assert.equal(threadIsStaffOnly({}, [], []), false);
  assert.equal(threadIsStaffOnly({ isAiChat: true }, ["u-emily"], [EMILY]), false);
  assert.equal(threadIsStaffOnly({ is_ai_chat: true }, ["u-emily"], [EMILY]), false);
});

test("the chat feed checks the poster and the thread before anything is read, and reads through the reader only", () => {
  const source = readFileSync(new URL("./requirement-feeds.ts", import.meta.url), "utf8");
  const feed = source.slice(source.indexOf("export async function chatMessagePosted"), source.indexOf("// ── Teams meeting transcripts"));
  const at = (needle: string) => { const i = feed.indexOf(needle); assert.ok(i >= 0, needle); return i; };
  assert.ok(at("staffActor(req)") < at("readStatedRequirements("), "the poster is checked first");
  assert.ok(at("threadIsStaffOnly(thread, memberIds, people)") < at("readStatedRequirements("), "the thread is checked first");
  // Anthropic directly: the switchable helper is never imported, and email is never fetched.
  assert.ok(!/\bcallClaude\s*\(|ai-provider|openai-client|graph\.microsoft\.com|\/messages\/\$\{/.test(source));
  assert.ok(source.includes("getAnthropicClient(true)"));
});

test("company tags are read from the post's tag tokens", () => {
  const post = "Hearing @[Pret A Manger](tag:company/c-pret) want 10 more in the north. cc @[Tom](tag:user/u-tom), see @[Trinity Leeds](tag:property/p1) and @[Pret A Manger](tag:company/c-pret)";
  assert.deepEqual(companyTags(post), [{ id: "c-pret", name: "Pret A Manger" }]);
  assert.deepEqual(companyTags("no tags here"), []);
  assert.deepEqual(companyTags(null), []);
});

// ── The reader ─────────────────────────────────────────────────────────────

const POST = "Spoke to their agent: Pret A Manger want 2,000 to 3,000 sq ft in Leeds and York next year. Gail's Bakery have a new property director.";
const input: ReaderInput = { text: POST, what: "team chat post by Emily Stone, 2026-11-12", brands: ["Pret A Manger", "Gail's Bakery"] };
const reply = (items: unknown) => JSON.stringify(items);
const good = { brand: "Pret A Manger", quote: "Pret A Manger want 2,000 to 3,000 sq ft in Leeds and York next year", sites: null, size: "2,000 to 3,000 sq ft", locations: ["Leeds", "York"], use: null, timing: "next year", confidence: "high" };

function deps(over: Partial<ReaderDeps> & { text?: string } = {}) {
  const seen = { calls: 0, claims: 0, logged: [] as any[], user: "" };
  const d: ReaderDeps = {
    hasKey: () => true,
    claim: async () => { seen.claims++; return true; },
    call: async (_system, user) => { seen.calls++; seen.user = user; return { text: over.text ?? reply([good]), model: "test-model", usage: { input_tokens: 400, output_tokens: 60 } }; },
    log: (model, usage) => { seen.logged.push({ model, usage }); },
    ...over,
  };
  return { d, seen };
}

test("the reader returns what the post states, with the writer's own words, and logs its spend", async () => {
  const { d, seen } = deps();
  const out = await readStatedRequirements(input, d);
  assert.deepEqual(out, [{ brand: "Pret A Manger", quote: good.quote, sites: null, size: "2,000 to 3,000 sq ft", locations: ["Leeds", "York"], use: null, timing: "next year", confidence: "high" }]);
  assert.deepEqual([seen.claims, seen.calls], [1, 1]);
  assert.deepEqual(seen.logged, [{ model: "test-model", usage: { input_tokens: 400, output_tokens: 60 } }]);
  assert.ok(seen.user.includes("Pret A Manger; Gail's Bakery") && seen.user.includes(POST));
});

test("with no key the reader does nothing: no allowance taken, no call", async () => {
  const { d, seen } = deps({ hasKey: () => false });
  assert.equal(await readStatedRequirements(input, d), null);
  assert.deepEqual([seen.claims, seen.calls, seen.logged.length], [0, 0, 0]);
});

test("when today's allowance is used up, or the call fails, nothing is read and nothing throws", async () => {
  const capped = deps({ claim: async () => false });
  assert.equal(await readStatedRequirements(input, capped.d), null);
  assert.equal(capped.seen.calls, 0);
  const broken = deps({ call: async () => { throw new Error("529 overloaded"); } });
  assert.equal(await readStatedRequirements(input, broken.d), null);
  const refused = deps({ call: async () => ({ text: reply([good]), model: "test-model", refused: true }) });
  assert.equal(await readStatedRequirements(input, refused.d), null);
  assert.equal(await readStatedRequirements({ ...input, text: "   " }, deps().d), null);
  assert.equal(await readStatedRequirements({ ...input, brands: [] }, deps().d), null);
});

test("a result is dropped when its quote is not in the post, its brand was not tagged, or it is unsure", () => {
  const parse = (items: unknown) => parseReaderReply(reply(items), input);
  assert.equal(parse([good]).length, 1);
  assert.deepEqual(parse([{ ...good, quote: "Pret want 5,000 sq ft in Manchester" }]), [], "an invented quote");
  assert.deepEqual(parse([{ ...good, brand: "Starbucks" }]), [], "a brand that was not tagged");
  assert.deepEqual(parse([{ ...good, confidence: "low" }]), []);
  assert.deepEqual(parse([{ ...good, quote: "" }]), []);
  assert.deepEqual(parse([]), []);
  assert.deepEqual(parseReaderReply("I could not find a requirement.", input), []);
  assert.deepEqual(parseReaderReply("[{ not json", input), []);
  // Spacing, case and a trailing ellipsis in the quote are forgiven; the brand is named as it was tagged.
  const loose = parse([{ ...good, brand: "pret a manger ltd", quote: "pret a manger  want 2,000 to 3,000 sq ft in Leeds..." }]);
  assert.deepEqual([loose.length, loose[0]?.brand], [1, "Pret A Manger"]);
  // One result a brand.
  assert.equal(parse([good, good]).length, 1);
  // Fenced or wrapped replies still parse.
  assert.equal(parseReaderReply("```json\n" + reply([good]) + "\n```", input).length, 1);
});

test("a meeting summary has no tagged brands: the reader names them and the quote must still be in the summary", () => {
  const summary: ReaderInput = { text: "- Wagamama are looking for six sites in the South East in 2027.\n- Rent review at Unit 4 discussed.", what: "summary of a meeting, 2026-11-12", brands: null };
  const out = parseReaderReply(reply([{ brand: "Wagamama", quote: "Wagamama are looking for six sites in the South East in 2027", sites: 6, size: null, locations: ["South East"], use: null, timing: "2027", confidence: "high" }]), summary);
  assert.deepEqual([out[0].brand, out[0].sites, out[0].locations], ["Wagamama", 6, ["South East"]]);
});

test("the daily cap: a default, an override, and 0 to switch the reader off", () => {
  const before = process.env.REQUIREMENT_READER_DAILY_CAP;
  try {
    delete process.env.REQUIREMENT_READER_DAILY_CAP;
    assert.equal(readerDailyCap(), 200);
    process.env.REQUIREMENT_READER_DAILY_CAP = "50";
    assert.equal(readerDailyCap(), 50);
    process.env.REQUIREMENT_READER_DAILY_CAP = "0";
    assert.equal(readerDailyCap(), 0);
    process.env.REQUIREMENT_READER_DAILY_CAP = "lots";
    assert.equal(readerDailyCap(), 200);
  } finally {
    if (before === undefined) delete process.env.REQUIREMENT_READER_DAILY_CAP; else process.env.REQUIREMENT_READER_DAILY_CAP = before;
  }
});
