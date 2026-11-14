// Comments not yet logged (shared/letting-suggestions.ts): which words read
// as an offer or a viewing that should have been logged, what counts as
// already logged, the dedupe key and who may see a suggestion. No test here
// touches a database or an AI provider.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLOSED_ALREADY_LOGGED, LOGGED_WINDOW_DAYS, SUGGESTION_SOURCE_LABELS, SUGGESTION_VISIBILITY,
  alreadyLogged, brandNamedIn, candidatesForUnit, describeSuggestion, detectFromViewing, detectInText, ownViewingNote, parseSourceRef,
  sameBrand, sourceRefText, suggestionDedupeKey, suggestionVisibleTo,
  type SuggestionViewer, type UnitSources,
} from "../shared/letting-suggestions";

const TODAY = "2026-11-13";
const OWNER = "Offered: 15 year lease. Rent £120kpax and 9% t/o. 6 MRF";   // Ben Sykes, 9 Nov, on KLG07's target Sushidog
const detect = (text: string, extra: Record<string, unknown> = {}) => detectInText({ text, today: TODAY, writtenOn: "2026-11-09", ...extra });
const kinds = (text: string, extra: Record<string, unknown> = {}) => detect(text, extra).map(d => d.kind);

// ── The detection rule ─────────────────────────────────────────────────────

test("the owner's example reads as an offer, with its terms, and not as a viewing", () => {
  const found = detect(OWNER, { author: "Ben Sykes", staffNames: ["Ben Sykes"] });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "offer");
  assert.equal(found[0].excerpt, OWNER);
  assert.deepEqual(found[0].details, { rentPa: 120000, termYears: 15, rentFreeMonths: 6, turnoverRentPct: 9 });
  assert.equal(found[0].date, null);
  assert.equal(describeSuggestion("offer", found[0].details), "Offer: 15 years, £120,000 a year, 9% turnover, 6 months rent free");
});

test("a comment that only discusses the quoting rent raises nothing", () => {
  for (const text of [
    "Quoting rent is £150k pax, they think that is too high",
    "They felt the quoting rent of £150,000 pa was toppy. Will revert.",
    "Asking £150k. Keen but need board approval",
    "Rent £150k pax is too much for them",                       // one term, no word that says terms were proposed
  ]) assert.deepEqual(kinds(text), [], text);
  // Two terms that only repeat the unit's quoting rent, with no word of an offer.
  assert.deepEqual(kinds("Rent £150k pax on a 10 year lease", { quotingRentPa: 150000 }), []);
  // The same words on a unit quoting something else are two terms: an offer.
  assert.deepEqual(kinds("Rent £150k pax on a 10 year lease", { quotingRentPa: 175000 }), ["offer"]);
  // An offer at the quoting rent is still an offer.
  assert.deepEqual(kinds("Offered £150k pax on a 10 year lease", { quotingRentPa: 150000 }), ["offer"]);
});

// Review, 2026-11-13: BGP's own note of the quoting terms came up as a
// brand's offer at the quoting rent because it held "terms" or "proposed".
test("the quoting rent alone raises nothing, even with a word of an offer", () => {
  assert.deepEqual(kinds("Quoting terms: £125k pa", { quotingRentPa: 125000 }), []);
  assert.deepEqual(kinds("We proposed £125k pa", { quotingRentPa: 125000 }), []);
  assert.deepEqual(kinds("Offer is £125k pa", { quotingRentPa: 125000 }), []);
});

test("a rent away from the quoting rent, or the quoting rent with a second term, is still an offer", () => {
  assert.deepEqual(kinds("We proposed £110k pa", { quotingRentPa: 125000 }), ["offer"]);
  assert.deepEqual(kinds("We proposed £125k pa", {}), ["offer"]);                      // no quoting rent known
  assert.deepEqual(kinds("They proposed £125k pa and 6 months rent free", { quotingRentPa: 125000 }), ["offer"]);
});

test("an offer needs a money or lease term, and a word of an offer or two terms", () => {
  assert.deepEqual(kinds("Offer expected next week"), []);                             // no term
  assert.deepEqual(kinds("Spoke to their agent, will come back next week"), []);
  assert.deepEqual(kinds("Counter at £110k pax"), ["offer"]);                          // one term and a word of an offer
  assert.deepEqual(kinds("Proposed terms: 10 years, £95,000 pa, 9 months rent free, TBO yr 5"), ["offer"]);
  assert.deepEqual(kinds("£95,000 pa, 9 months rent free"), ["offer"]);                // two terms, no word needed
  assert.deepEqual(kinds("10 year lease would suit them"), []);                        // one term, no word
  assert.deepEqual(kinds("They sell hot food, 10 year lease would suit"), [], "hot is not HOTs");
});

test("what the reader refuses as ambiguous makes no suggestion", () => {
  assert.deepEqual(kinds("Rent £80k or £90k, tbc"), []);
  assert.deepEqual(kinds("Offered £45 psf"), [], "a rent per square foot is never set, so no term is left");
  assert.deepEqual(kinds(""), []);
  assert.deepEqual(kinds("   \n  "), []);
});

test("a viewing needs words of a viewing and a date or an outcome", () => {
  const viewed = detect("Viewed 9 Nov with Sam. Liked the unit, second viewing wanted");
  assert.deepEqual(viewed.map(d => d.kind), ["viewing"]);
  assert.equal(viewed[0].date, "2026-11-09");
  assert.equal(viewed[0].details.outcome, "Second Viewing");
  assert.equal(describeSuggestion("viewing", viewed[0].details), "Viewing: 9 Nov 2026, outcome Second Viewing");

  const booked = detect("Viewing booked for 20 Nov at 10am", { writtenOn: "2026-11-12" });
  assert.deepEqual(booked.map(d => d.kind), ["viewing"]);
  assert.deepEqual(booked[0].details, { date: "2026-11-20", time: "10:00" });

  assert.deepEqual(kinds("Walked the unit yesterday, not keen on the frontage"), ["viewing"]);
  assert.deepEqual(kinds("Second viewing wanted"), [], "asking for a viewing is not a viewing");
  assert.deepEqual(kinds("They would like a viewing, keen on the unit"), []);
  assert.deepEqual(kinds("Keen but need board approval"), [], "an outcome with no word of a viewing");
  assert.deepEqual(kinds("Viewing to be arranged"), []);
});

test("one comment can be both a viewing and an offer", () => {
  assert.deepEqual(kinds("Viewed 9 Nov. Offered £120k pax on a 15 year lease"), ["offer", "viewing"]);
  assert.deepEqual(kinds("Viewed 9 Nov. Offered £120k pax on a 15 year lease", { kinds: ["offer"] }), ["offer"]);
});

test("a viewing points at an offer by its outcome or by its note, and never suggests a viewing", () => {
  const base = { today: TODAY };
  const expected = detectFromViewing({ outcome: "Offer Expected", notes: null, viewingDate: "2026-11-10" }, base);
  assert.deepEqual(expected, { kind: "offer", excerpt: "", date: null, details: { viewingOutcome: "Offer Expected" }, brandName: null });
  assert.equal(describeSuggestion("offer", expected!.details), "The viewing says an offer is expected. None is logged for this brand.");
  assert.equal(describeSuggestion("offer", { viewingOutcome: "Offer Received" }), "The viewing says an offer was received. None is logged for this brand.");

  const noted = detectFromViewing({ outcome: "Interested", notes: "Liked it. Offered £90k pax, 10 yrs", viewingDate: "2026-11-10" }, base);
  assert.equal(noted?.kind, "offer");
  assert.deepEqual(noted?.details, { rentPa: 90000, termYears: 10 });

  const both = detectFromViewing({ outcome: "Offer Received", notes: "Offered £90k pax, 10 yrs", viewingDate: "2026-11-10" }, base);
  assert.deepEqual(both?.details, { rentPa: 90000, termYears: 10, viewingOutcome: "Offer Received" });

  assert.equal(detectFromViewing({ outcome: "Interested", notes: "Viewed, liked the frontage", viewingDate: "2026-11-10" }, base), null);
  assert.equal(detectFromViewing({ outcome: null, notes: null, viewingDate: "2026-11-10" }, base), null);
});

test("a diary viewing's invitation subject is never read or shown", () => {
  assert.equal(ownViewingNote('Synced from Outlook: "Offer £500k pax meeting"\nLiked it', "diary"), "Liked it");
  assert.equal(ownViewingNote('Synced from Outlook: "Offer £500k pax, 10 yrs"', "diary"), "");
  assert.equal(ownViewingNote("Offer £500k pax, 10 yrs", "diary"), "", "a diary note with no known first line is left alone");
  assert.equal(ownViewingNote("Offered £90k pax, 10 yrs", null), "Offered £90k pax, 10 yrs");
  const v = detectFromViewing({ outcome: null, notes: 'Synced from Outlook: "Offer £500k pax, 10 yrs"', viewingDate: "2026-11-10", source: "diary" }, { today: TODAY });
  assert.equal(v, null);
});

// ── The dedupe key ─────────────────────────────────────────────────────────

test("the dedupe key is the source, the kind and the words", () => {
  const ref = sourceRefText({ type: "target_comment", targetId: "t1", at: "2026-11-09T10:15:00.000Z" });
  assert.equal(ref, "t1|2026-11-09T10:15:00.000Z");
  const key = suggestionDedupeKey("target_comment", ref, "offer", OWNER);
  assert.equal(key, suggestionDedupeKey("target_comment", ref, "offer", `  ${OWNER}  `), "white space round the words does not make new evidence");
  assert.notEqual(key, suggestionDedupeKey("target_comment", ref, "offer", OWNER.replace("120k", "125k")), "an edited comment is new evidence");
  assert.notEqual(key, suggestionDedupeKey("target_comment", ref, "viewing", OWNER));
  assert.notEqual(key, suggestionDedupeKey("target_comment", "t2|2026-11-09T10:15:00.000Z", "offer", OWNER));
  assert.match(key, /^target_comment:t1\|2026-11-09T10:15:00\.000Z:offer:[0-9a-f]{14}$/);
});

test("a source reference finds its source again", () => {
  assert.deepEqual(parseSourceRef("target_comment", "t1|2026-11-09T10:15:00.000Z"), { type: "target_comment", targetId: "t1", at: "2026-11-09T10:15:00.000Z" });
  assert.deepEqual(parseSourceRef("viewing", "v1"), { type: "viewing", viewingId: "v1" });
  assert.deepEqual(parseSourceRef("interest_note", "i1"), { type: "interest_note", interestId: "i1" });
  assert.deepEqual(parseSourceRef("brief_comment", "c1"), { type: "brief_comment", commentId: "c1" });
  assert.equal(parseSourceRef("target_comment", "no-timestamp"), null);
  assert.equal(parseSourceRef("email", "x"), null);
  assert.equal(parseSourceRef("viewing", ""), null);
});

// ── Already logged ─────────────────────────────────────────────────────────

test("the same brand is the same id, or else the same name ignoring case", () => {
  assert.equal(sameBrand({ companyId: "a" }, { companyId: "a", brandName: "Other" }), true);
  assert.equal(sameBrand({ companyId: "a", brandName: "Sushidog" }, { companyId: "b", brandName: "Sushidog" }), false);
  assert.equal(sameBrand({ companyId: "a", brandName: "Sushidog" }, { brandName: "  sushiDOG " }), true);
  assert.equal(sameBrand({ brandName: "" }, { brandName: "" }), false);
  assert.equal(sameBrand({}, { companyId: "a" }), false);
});

test("an offer for the same unit and brand within 14 days either side is already logged", () => {
  const s = { companyId: "sushi", brandName: "Sushidog", evidenceDate: "2026-11-09" };
  assert.equal(LOGGED_WINDOW_DAYS, 14);
  assert.equal(alreadyLogged(s, []), false);
  assert.equal(alreadyLogged(s, [{ companyId: "sushi", date: "2026-11-23" }]), true);
  assert.equal(alreadyLogged(s, [{ companyId: "sushi", date: "2026-10-26" }]), true);
  assert.equal(alreadyLogged(s, [{ companyId: "sushi", date: "2026-11-24" }]), false);
  assert.equal(alreadyLogged(s, [{ companyId: "sushi", date: "2026-10-25" }]), false);
  assert.equal(alreadyLogged(s, [{ companyId: "other", date: "2026-11-09" }]), false);
  assert.equal(alreadyLogged(s, [{ brandName: "SUSHIDOG", date: "2026-11-10" }]), true);
  assert.equal(alreadyLogged(s, [{ companyId: "sushi", date: null }]), true, "an undated record for the brand counts");
  assert.equal(alreadyLogged({ evidenceDate: "2026-11-09" }, [{ companyId: "sushi", date: "2026-11-09" }]), false, "no brand, no match");
});

test("a viewing that expects an offer looks forward: any later offer from the brand, or one recorded from it", () => {
  const s = { companyId: "sushi", brandName: "Sushidog", evidenceDate: "2026-09-01", fromViewingId: "v1" };
  assert.equal(alreadyLogged(s, [{ companyId: "sushi", date: "2026-11-01" }]), true, "an offer two months after the viewing");
  assert.equal(alreadyLogged(s, [{ companyId: "sushi", date: "2026-08-20" }]), true, "within 14 days before");
  assert.equal(alreadyLogged(s, [{ companyId: "sushi", date: "2026-08-01" }]), false, "an offer from an earlier round");
  assert.equal(alreadyLogged(s, [{ companyId: "other", brandName: "Typed", date: "2020-01-01", viewingId: "v1" }]), true, "recorded from this viewing");
  assert.equal(alreadyLogged(s, [{ companyId: "other", date: "2026-11-01", viewingId: "v2" }]), false);
});

// ── Who sees a suggestion ──────────────────────────────────────────────────

test("BGP's notes are for BGP staff; the rest for BGP staff and the scheme's joint agent; nobody else", () => {
  const staff: SuggestionViewer = { isStaff: true, seesBgpNotes: true, agentControl: true, landsecRole: null };
  const jointAgent: SuggestionViewer = { isStaff: false, seesBgpNotes: false, agentControl: true, landsecRole: "joint_agent" };
  const assetManager: SuggestionViewer = { isStaff: false, seesBgpNotes: true, agentControl: false, landsecRole: "asset_manager" };
  const leasingManager: SuggestionViewer = { isStaff: false, seesBgpNotes: true, agentControl: false, landsecRole: null };
  const otherClient: SuggestionViewer = { isStaff: false, seesBgpNotes: true, agentControl: false, landsecRole: null };
  const oddLogin: SuggestionViewer = { isStaff: false, seesBgpNotes: true, agentControl: true, landsecRole: null };   // no client scope, not a BGP address
  const table: [string, SuggestionViewer | null, boolean, boolean][] = [
    ["BGP staff", staff, true, true],
    ["joint agent", jointAgent, false, true],
    ["asset manager", assetManager, false, false],
    ["Landsec leasing manager", leasingManager, false, false],
    ["another client", otherClient, false, false],
    ["a login that is neither BGP nor a client", oddLogin, false, false],
    ["no access to the unit", null, false, false],
  ];
  for (const [who, viewer, bgp, brief] of table) {
    assert.equal(suggestionVisibleTo("bgp", viewer), bgp, `${who}: bgp`);
    assert.equal(suggestionVisibleTo("brief", viewer), brief, `${who}: brief`);
    assert.equal(suggestionVisibleTo("anything else", viewer), false, `${who}: unknown`);
  }
  // An asset manager is refused even if a later change gave the role agent
  // control, exactly as a full Landsec login is (oddLogin above): only BGP
  // staff and a joint agent are ever shown a 'brief' line.
  assert.equal(suggestionVisibleTo("brief", { ...assetManager, agentControl: true }), false);
  assert.deepEqual(SUGGESTION_VISIBILITY, { target_comment: "bgp", viewing: "brief", interest_note: "brief", brief_comment: "brief" });
  assert.deepEqual(SUGGESTION_SOURCE_LABELS, { target_comment: "Target comment", viewing: "Viewing note", interest_note: "Interest note", brief_comment: "Brief comment" });
});

// ── A brand named in the words ─────────────────────────────────────────────

test("a brief comment's brand is the one brand on the unit it names", () => {
  const brands = [{ id: "1", name: "Sushidog" }, { id: "2", name: "Leon" }, { id: "3", name: "Pho" }];
  assert.equal(brandNamedIn("Sushidog offered £120k pax", brands)?.id, "1");
  assert.equal(brandNamedIn("SUSHIDOG's agent called", brands)?.id, "1");
  assert.equal(brandNamedIn("Sushidog and Leon both viewed", brands), null, "two brands: the reader does not pick");
  assert.equal(brandNamedIn("Leonards offered £120k", brands), null, "part of a longer word is not the brand");
  assert.equal(brandNamedIn("Photos sent to the agent", brands), null);
  assert.equal(brandNamedIn("No brand here", brands), null);
});

// ── One unit's sources into candidates ─────────────────────────────────────

const AT = "2026-11-09T10:15:00.000Z";
const unit = (over: Partial<UnitSources> = {}): UnitSources => ({
  unitId: "u1", today: TODAY, quotingRentPa: 150000, staffNames: ["Ben Sykes"],
  brands: [{ companyId: "sushi", name: "Sushidog" }, { companyId: "leon", name: "Leon" }, { companyId: "pho", name: "Pho" }, { companyId: null, name: "Typed Brand" }],
  targets: [], viewings: [], interest: [], briefComments: [], offersLogged: [], viewingsLogged: [],
  ...over,
});
const sushidog = { id: "t1", operatorName: "Sushidog", companyId: "sushi", companyName: "Sushidog", comments: [{ text: OWNER, at: AT, day: "2026-11-09", userName: "Ben Sykes" }] };

test("the owner's comment on a target becomes one offer suggestion, for BGP only", () => {
  const found = candidatesForUnit(unit({ targets: [sushidog] }));
  assert.equal(found.length, 1);
  const s = found[0];
  assert.deepEqual({ unitId: s.unitId, kind: s.kind, companyId: s.companyId, brandName: s.brandName, sourceKind: s.sourceKind, sourceRef: s.sourceRef, visibility: s.visibility, logged: s.logged },
    { unitId: "u1", kind: "offer", companyId: "sushi", brandName: "Sushidog", sourceKind: "target_comment", sourceRef: `t1|${AT}`, visibility: "bgp", logged: false });
  assert.equal(s.excerpt, OWNER);
  assert.equal(s.saidBy, "Ben Sykes");
  assert.equal(s.evidenceDate, "2026-11-09", "the day the comment was written, when the words give no date");
  assert.deepEqual(s.details, { rentPa: 120000, termYears: 15, rentFreeMonths: 6, turnoverRentPct: 9 });
  assert.equal(s.dedupeKey, suggestionDedupeKey("target_comment", `t1|${AT}`, "offer", `${OWNER}\n`));
});

test("the right suggestions and no others, each source in turn", () => {
  const found = candidatesForUnit(unit({
    targets: [
      sushidog,
      { id: "t2", operatorName: "Leon", companyId: "leon", companyName: "Leon", comments: [
        { text: "Quoting rent is £150k pax, they think that is too high", at: "2026-11-08T09:00:00.000Z", day: "2026-11-08", userName: "Ben Sykes" },
        { text: "Chased their agent again", at: "2026-11-10T09:00:00.000Z", day: "2026-11-10", userName: "Ben Sykes" },
      ] },
      { id: "t3", operatorName: "", companyId: null, companyName: null, comments: [{ text: OWNER, at: AT, day: "2026-11-09", userName: null }] },   // no brand at all
    ],
    viewings: [
      { id: "v1", companyId: "leon", companyName: "Leon", viewingDate: "2026-11-10", outcome: "Offer Expected", notes: null, status: "completed", saidBy: "Victoria" },
      { id: "v2", companyId: "pho", companyName: "Pho", viewingDate: "2026-11-10", outcome: "Interested", notes: "Liked it", status: "completed", saidBy: "Victoria" },
      { id: "v3", companyId: "pho", companyName: "Pho", viewingDate: "2026-11-11", outcome: "Offer Received", notes: null, status: "cancelled", saidBy: null },
      { id: "v4", companyId: null, companyName: null, viewingDate: "2026-11-11", outcome: "Offer Received", notes: null, status: "completed", saidBy: null },   // no brand
    ],
    interest: [
      { id: "i1", companyId: "pho", companyName: "Pho", notes: "Agent rang: offered £95k pax, 10 yr lease, 9 months rent free", interestDate: "2026-11-11" },
      { id: "i2", companyId: "pho", companyName: "Pho", notes: "Asked for the brochure", interestDate: "2026-11-11" },
      { id: "i3", companyId: null, companyName: null, notes: "Typed Brand offered £80k pax on a 10 year lease", interestDate: "2026-11-12" },         // an agent's line: the note names the brand
      { id: "i4", companyId: null, companyName: null, notes: "Someone offered £80k pax on a 10 year lease", interestDate: "2026-11-12" },             // names no brand on the unit
    ],
    briefComments: [
      { id: "c1", body: "Sushidog viewed 6 Nov and liked the frontage", userName: "Mark Warne", day: "2026-11-07" },
      { id: "c2", body: "We should push the rent to £160k pax on a 10 year lease", userName: "Mark Warne", day: "2026-11-07" },                      // names no brand
      { id: "c3", body: "Agreed the brief looks right", userName: "Mark Warne", day: "2026-11-07" },
    ],
  }));
  assert.deepEqual(found.map(s => `${s.sourceKind}:${s.sourceRef}:${s.kind}:${s.brandName}:${s.visibility}`), [
    `target_comment:t1|${AT}:offer:Sushidog:bgp`,
    "viewing:v1:offer:Leon:brief",
    "interest_note:i1:offer:Pho:brief",
    "interest_note:i3:offer:Typed Brand:brief",
    "brief_comment:c1:viewing:Sushidog:brief",
  ]);
  assert.ok(found.every(s => !s.logged));
  const viewing = found[1];
  assert.deepEqual(viewing.details, { viewingOutcome: "Offer Expected" });
  assert.equal(viewing.evidenceDate, "2026-11-10");
  assert.equal(viewing.saidBy, "Victoria");
  assert.equal(found[3].companyId, null);
  assert.equal(found[4].evidenceDate, "2026-11-06", "the date the words give wins over the day they were written");
});

test("an offer already logged for that brand within 14 days is marked logged, and another brand's is not", () => {
  const logged = candidatesForUnit(unit({ targets: [sushidog], offersLogged: [{ companyId: "sushi", brandName: "Sushidog", date: "2026-11-12" }] }));
  assert.deepEqual(logged.map(s => s.logged), [true]);
  const other = candidatesForUnit(unit({ targets: [sushidog], offersLogged: [{ companyId: "leon", brandName: "Leon", date: "2026-11-12" }] }));
  assert.deepEqual(other.map(s => s.logged), [false]);
  const old = candidatesForUnit(unit({ targets: [sushidog], offersLogged: [{ companyId: "sushi", brandName: "Sushidog", date: "2026-09-01" }] }));
  assert.deepEqual(old.map(s => s.logged), [false]);
  // A viewing already on the unit does not hide an offer, and the other way round.
  const viewed = candidatesForUnit(unit({ targets: [sushidog], viewingsLogged: [{ companyId: "sushi", brandName: "Sushidog", date: "2026-11-09" }] }));
  assert.deepEqual(viewed.map(s => s.logged), [false]);
  const seen = candidatesForUnit(unit({
    briefComments: [{ id: "c1", body: "Sushidog viewed 6 Nov and liked the frontage", userName: null, day: "2026-11-07" }],
    viewingsLogged: [{ companyId: "sushi", brandName: "Sushidog", date: "2026-11-06" }],
  }));
  assert.deepEqual(seen.map(s => `${s.kind}:${s.logged}`), ["viewing:true"]);
});

test("a viewing with an offer recorded from it is logged, whatever brand the offer row carries", () => {
  const v = { id: "v1", companyId: "leon", companyName: "Leon", viewingDate: "2026-11-10", outcome: "Offer Received", notes: null, status: "completed", saidBy: null };
  assert.deepEqual(candidatesForUnit(unit({ viewings: [v] })).map(s => s.logged), [false]);
  assert.deepEqual(candidatesForUnit(unit({ viewings: [v], offersLogged: [{ companyId: null, brandName: "Leon Restaurants", date: "2026-11-12", viewingId: "v1" }] })).map(s => s.logged), [true]);
});

test("an edited comment is new evidence; the same words are the same evidence", () => {
  const before = candidatesForUnit(unit({ targets: [sushidog] }))[0];
  const again = candidatesForUnit(unit({ targets: [sushidog] }))[0];
  assert.equal(before.dedupeKey, again.dedupeKey);
  const edited = candidatesForUnit(unit({ targets: [{ ...sushidog, comments: [{ ...sushidog.comments[0], text: OWNER.replace("6 MRF", "9 MRF") }] }] }))[0];
  assert.notEqual(edited.dedupeKey, before.dedupeKey);
  assert.equal(edited.sourceRef, before.sourceRef);
  // A viewing's outcome is part of its evidence.
  const v = { id: "v1", companyId: "leon", companyName: "Leon", viewingDate: "2026-11-10", outcome: "Offer Expected", notes: null, status: "completed", saidBy: null };
  const expected = candidatesForUnit(unit({ viewings: [v] }))[0];
  const received = candidatesForUnit(unit({ viewings: [{ ...v, outcome: "Offer Received" }] }))[0];
  assert.notEqual(expected.dedupeKey, received.dedupeKey);
});

test("a name typed on a target and the same CRM brand are one brand, not two", () => {
  const found = candidatesForUnit(unit({
    brands: [{ companyId: null, name: "sushidog" }, { companyId: "sushi", name: "Sushidog" }],
    briefComments: [{ id: "c1", body: "Sushidog offered £120k pax on a 15 year lease", userName: null, day: "2026-11-09" }],
  }));
  assert.deepEqual(found.map(s => `${s.kind}:${s.companyId}:${s.brandName}`), ["offer:sushi:Sushidog"]);
});

// ── The server file keeps to the rules ─────────────────────────────────────

const serverSource = readFileSync(new URL("./letting-suggestions.ts", import.meta.url), "utf8");
const serverCode = serverSource.replace(/\/\/.*$/gm, "");
const sharedCode = readFileSync(new URL("../shared/letting-suggestions.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");

test("detection makes no AI call and sends nothing anywhere", () => {
  for (const code of [serverCode, sharedCode]) {
    assert.doesNotMatch(code, /anthropic|openai|callClaude|ai-provider|models["']|fetch\(/i);
    assert.doesNotMatch(code, /unit-note-reader|readLettingNote/);
  }
});

test("nothing here writes an offer or a viewing, and nothing runs at boot or on a timer", () => {
  assert.doesNotMatch(serverCode, /INSERT INTO unit_(offers|viewings|interest|offer_rounds)/i);
  assert.doesNotMatch(serverCode, /UPDATE unit_(offers|viewings|interest)/i);
  assert.doesNotMatch(serverCode, /DELETE FROM/i);
  assert.doesNotMatch(serverCode, /setInterval|setTimeout|node-cron|cron\./);
  assert.match(serverCode, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
  // The only statuses the app itself sets are the two closing reasons.
  assert.equal(CLOSED_ALREADY_LOGGED, "already_logged");
});

test("it never reads inbox-swept rows, emails, chat, deal comments or CRM interactions", () => {
  assert.match(serverCode, /i\.source IS NULL AND i\.email_conversation_id IS NULL/);
  assert.doesNotMatch(serverCode, /FROM (emails?|email_|chat_|messages|crm_interactions|deal_comments|crm_deal_comments|interactions)\b/i);
});

test("every route is behind a sign-in, the backlog behind an admin, and every answer goes through the visibility rule", () => {
  const routes = [...serverCode.matchAll(/app\.(get|post)\("([^"]+)",\s*([^)]*?)async/g)].map(m => ({ method: m[1], path: m[2], guards: m[3] }));
  assert.deepEqual(routes.map(r => `${r.method} ${r.path}`).sort(), [
    "get /api/admin/letting-suggestions/preview", "get /api/letting-suggestions", "get /api/letting-suggestions/count",
    "post /api/admin/letting-suggestions/apply", "post /api/letting-suggestions/:id/confirm", "post /api/letting-suggestions/:id/dismiss",
  ]);
  for (const r of routes) {
    assert.match(r.guards, /signedIn/, r.path);
    assert.equal(/admin,/.test(r.guards), r.path.startsWith("/api/admin/"), r.path);
  }
  assert.ok((serverCode.match(/suggestionVisibleTo\(/g) || []).length >= 2, "the list and the single-suggestion check both use the rule");
  assert.match(serverCode, /briefAccess\(req, /);
});
