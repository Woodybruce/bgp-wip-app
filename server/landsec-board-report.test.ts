// The board report's market report: the store's key, a save that never loses
// someone else's words, and the draft's order of checks (the key, the day's
// allowance, one call, the reply made plain). The draft has not been run
// against Anthropic from a build machine: these tests hand it a stub.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import { parseReportPeriod } from "@shared/landsec-reports";
import { boardActivity, brandEngagement, dealSpeed, rentalGrowth, type BoardDeal, type MarketDraftInput } from "@shared/landsec-board-report";
import { BoardMarketError, boardDraftDailyCap, draftMarketSection, loadBoardMarket, marketKeyFor, marketSignals, saveBoardMarketSection, schemeDigest } from "./landsec-board-market";
import { boardBrandsIn, boardFacts, BOARD_COUNTED, type BoardData } from "./landsec-board-report";

const parsed = parseReportPeriod("2026-08", "2026-10");
if (!parsed.ok) throw new Error(parsed.error);
const Q = parsed.period;

// A stand-in for system_settings: one value per key.
function fakeStore() {
  const rows = new Map<string, any>();
  const query = async (sql: string, values: any[] = []) => {
    if (/INSERT INTO system_settings/.test(sql)) { if (!rows.has(values[0])) rows.set(values[0], JSON.parse(values[1])); return { rows: [] }; }
    if (/UPDATE system_settings/.test(sql)) { rows.set(values[0], JSON.parse(values[1])); return { rows: [] }; }
    if (/SELECT value FROM system_settings/.test(sql)) return { rows: rows.has(values[0]) ? [{ value: rows.get(values[0]) }] : [] };
    return { rows: [] };
  };
  return { rows, db: { query }, connect: async () => ({ query, release: () => {} }) };
}

test("the store's key: the same schemes give the same key in any order, another set or period another key", () => {
  assert.equal(schemeDigest(["trinity", "bluewater"]), schemeDigest(["bluewater", "trinity", "bluewater"]));
  assert.notEqual(schemeDigest(["bluewater"]), schemeDigest(["bluewater", "trinity"]));
  assert.match(marketKeyFor(Q, ["bluewater"]), /^landsec_board_report:2026-08:2026-10:[0-9a-f]{16}$/);
  assert.notEqual(marketKeyFor(Q, ["bluewater"]), marketKeyFor({ from: "2026-07", to: "2026-10" }, ["bluewater"]));
});

test("a section is saved with who saved it and when, read back, and cleared by empty text", async () => {
  const store = fakeStore();
  const base = { period: Q, schemeKeys: ["trinity", "bluewater"] };
  assert.deepEqual(await loadBoardMarket(Q, base.schemeKeys, store.db), {});
  const first = await saveBoardMarketSection({ ...base, key: "hospitality", text: "  Dining held up.\r\n\r\n\r\n\r\nQSR led.  ", loadedAt: "", who: { name: "Woody Bruce", firm: "BGP" }, now: new Date("2026-11-19T10:00:00Z") }, store.connect);
  assert.deepEqual(first.hospitality, { text: "Dining held up.\n\nQSR led.", savedBy: "Woody Bruce", savedByFirm: "BGP", savedAt: "2026-11-19T10:00:00.000Z" });
  // Read back under the same schemes in another order; another scheme set holds nothing.
  assert.equal((await loadBoardMarket(Q, ["bluewater", "trinity"], store.db)).hospitality?.text, "Dining held up.\n\nQSR led.");
  assert.deepEqual(await loadBoardMarket(Q, ["bluewater"], store.db), {});
  // A second person saves another section; the first stays.
  const second = await saveBoardMarketSection({ ...base, key: "overall", text: "A steady quarter.", loadedAt: "", who: { name: "Mark Warne", firm: "Landsec" }, now: new Date("2026-11-19T11:00:00Z") }, store.connect);
  assert.deepEqual(Object.keys(second).sort(), ["hospitality", "overall"]);
  assert.equal(second.overall?.savedByFirm, "Landsec");
  // Empty text clears the section.
  const cleared = await saveBoardMarketSection({ ...base, key: "hospitality", text: "   ", loadedAt: "2026-11-19T10:00:00.000Z", who: { name: "Woody Bruce", firm: "BGP" } }, store.connect);
  assert.deepEqual(Object.keys(cleared), ["overall"]);
});

test("a save over somebody else's newer text is refused, and nothing changes", async () => {
  const store = fakeStore();
  const base = { period: Q, schemeKeys: ["bluewater"], key: "overall" as const };
  await saveBoardMarketSection({ ...base, text: "Mark's words.", loadedAt: "", who: { name: "Mark Warne", firm: "Landsec" }, now: new Date("2026-11-19T11:00:00Z") }, store.connect);
  // Woody opened the editor before Mark saved: his copy has no saved time.
  await assert.rejects(saveBoardMarketSection({ ...base, text: "Woody's words.", loadedAt: "", who: { name: "Woody Bruce", firm: "BGP" } }, store.connect),
    (e: any) => e instanceof BoardMarketError && e.status === 409 && /Mark Warne saved this section after you opened it/.test(e.message));
  assert.equal((await loadBoardMarket(Q, ["bluewater"], store.db)).overall?.text, "Mark's words.");
  // With the time he then read, it saves.
  const ok = await saveBoardMarketSection({ ...base, text: "Agreed words.", loadedAt: "2026-11-19T11:00:00.000Z", who: { name: "Woody Bruce", firm: "BGP" } }, store.connect);
  assert.equal(ok.overall?.text, "Agreed words.");
});

const INPUT: MarketDraftInput = {
  section: { key: "hospitality", title: "Hospitality" }, periodLabel: "Aug to Oct 2026", schemes: ["Bluewater"],
  facts: ["Hospitality, all categories: lettings exchanged or completed 3, Heads of Terms agreed 2, new instructions 1, viewings held 12, offers received 4."],
  signals: [{ date: "2026-09-03", brand: "Wingstop", kind: "opening", headline: "Wingstop to open 20 UK sites", source: "https://www.propelinfo.com/a" }], research: [],
};

test("the draft: no key, no call; no allowance, no call; then one call and a reply made plain", async () => {
  let calls = 0;
  const ask = async () => { calls += 1; return { text: "## Hospitality\n\n**Demand** held with 3 lettings and 12 viewings in the period, and Wingstop plans 20 UK sites (propelinfo.com). Rents rose 7% on https://x.example/y.", model: "m" }; };
  await assert.rejects(draftMarketSection(INPUT, { ask, hasKey: () => false, claim: async () => true }), (e: any) => e instanceof BoardMarketError && e.status === 503);
  await assert.rejects(draftMarketSection(INPUT, { ask, hasKey: () => true, claim: async () => false }), (e: any) => e instanceof BoardMarketError && e.status === 429);
  assert.equal(calls, 0);
  let seen: { system: string; user: string } | null = null;
  const out = await draftMarketSection(INPUT, { ask: async (system, user) => { seen = { system, user }; return ask(); }, hasKey: () => true, claim: async () => true });
  assert.equal(calls, 1);
  assert.match(seen!.system, /Write nothing you were not sent/);
  assert.match(seen!.user, /Wingstop to open 20 UK sites \| source: propelinfo\.com/);
  assert.doesNotMatch(out.text, /[#*]|https?:/);
  assert.deepEqual(out.check, ["7%"], "a figure that was not in what it was sent is listed for the person to check");
  assert.deepEqual(out.sent, { facts: 1, signals: 1, research: 0 });
  await assert.rejects(draftMarketSection(INPUT, { ask: async () => ({ text: "  ", model: "m" }), hasKey: () => true, claim: async () => true }), (e: any) => e instanceof BoardMarketError && e.status === 502);
});

test("the day's allowance of drafts: a default, a figure from the environment, and 0 switches it off", () => {
  const held = process.env.LANDSEC_BOARD_DRAFT_DAILY_CAP;
  try {
    delete process.env.LANDSEC_BOARD_DRAFT_DAILY_CAP; assert.equal(boardDraftDailyCap(), 40);
    process.env.LANDSEC_BOARD_DRAFT_DAILY_CAP = "0"; assert.equal(boardDraftDailyCap(), 0);
    process.env.LANDSEC_BOARD_DRAFT_DAILY_CAP = "12"; assert.equal(boardDraftDailyCap(), 12);
    process.env.LANDSEC_BOARD_DRAFT_DAILY_CAP = "lots"; assert.equal(boardDraftDailyCap(), 40);
  } finally { if (held == null) delete process.env.LANDSEC_BOARD_DRAFT_DAILY_CAP; else process.env.LANDSEC_BOARD_DRAFT_DAILY_CAP = held; }
});

test("signals: one line per headline, named by brand, and none asked for with no brand", async () => {
  let asked = 0;
  const db = { query: async (_sql: string, values: any[] = []) => {
    asked += 1;
    assert.deepEqual(values.slice(1), [Q.start, Q.end]);
    return { rows: [
      { brand_company_id: "c1", signal_type: "opening", headline: "Wingstop to open 20 UK sites", source: "https://a.example/1", signal_date: "2026-09-03T00:00:00Z" },
      { brand_company_id: "c1", signal_type: "opening", headline: "wingstop to open 20 UK sites", source: "https://b.example/2", signal_date: "2026-09-02T00:00:00Z" },
      { brand_company_id: "c2", signal_type: null, headline: "Gail's signs at a centre", source: "https://c.example/3", signal_date: null },
    ] };
  } };
  const out = await marketSignals(new Map([["c1", "Wingstop"], ["c2", "Gail's"]]), Q, db);
  assert.deepEqual(out.map(s => [s.brand, s.kind, s.date]), [["Wingstop", "opening", "2026-09-03"], ["Gail's", "news", null]]);
  assert.deepEqual(await marketSignals(new Map(), Q, db), []);
  assert.equal(asked, 1);
});

test("the facts a draft is written from are the pack's own lines, cut to the section's category group", () => {
  const deal = (over: Partial<BoardDeal>): BoardDeal => ({
    id: "d", ref: 1, scheme: "bluewater", unit: "U1", brand: "Wingstop", category: "cafe_qsr", rentPa: 110000, instructed: "2026-08-01", created: null, marketing: null,
    hotsIssued: "2026-08-31", hotsMoved: null, exchangedOn: "2026-10-10", exchangeMoved: null, completedOn: null, completeMoved: null, passingRent: 100000, erv: 100000, scheduleShowsTenant: false, ...over,
  });
  const deals = [deal({}), deal({ id: "e", brand: "Hollywood Bowl", category: "competitive_socialising", unit: "U2", rentPa: 200000, passingRent: 250000, erv: null })];
  const lines = [
    { brand: "Wingstop", category: "cafe_qsr" as const, scheme: "bluewater", unit: "U1", stage: "solicitors" as const, firstSeen: "2026-08-05" },
    { brand: "Hollywood Bowl", category: "competitive_socialising" as const, scheme: "bluewater", unit: "U2", stage: "let" as const, firstSeen: "2026-01-05" },
  ];
  const data: BoardData = {
    today: "2026-11-19", deals, schemes: [{ key: "bluewater", name: "Bluewater", units: 10, occupied: 8, vacant: 2, unknown: 0, live: { NEG: 1 } }],
    activity: boardActivity({ deals, viewings: [], offers: [] }, Q, "2026-11-19"), growth: rentalGrowth(deals, Q), speed: dealSpeed(deals, Q),
    brandLines: lines, engagement: brandEngagement(lines, Q),
    brands: new Map([["c1", { name: "Wingstop", category: "cafe_qsr" }], ["c2", { name: "Hollywood Bowl", category: "competitive_socialising" }], ["c3", { name: "A landlord", category: null }]]),
  };
  const overall = boardFacts(data, null);
  assert.equal(overall[0], "All schemes in the period: lettings exchanged or completed 2, Heads of Terms agreed 2, new instructions 2, viewings held 0, offers received 0.");
  assert.ok(overall.includes("Today: 8 units occupied and 2 vacant."));
  assert.ok(overall.includes("Rental growth against previous passing rent: average -5.0% across 2 lettings."));
  assert.ok(overall.includes("Agreed rent against ERV: average +10.0% across 1 letting."));
  assert.ok(overall.includes("Instruction to Heads of Terms: median 30 days across 2 lettings."));
  assert.ok(overall.some(l => /^Wingstop came into play in the period \(first dated record 2026-08-05\) at Bluewater; furthest stage Solicitors\.$/.test(l)));
  const leisure = boardFacts(data, "Leisure");
  assert.ok(leisure.some(l => l.startsWith("Competitive Socialising: lettings exchanged or completed 1,")));
  assert.ok(leisure.includes("Hollywood Bowl at Bluewater exchanged or completed: agreed rent -20.0% against the previous passing rent."));
  assert.ok(leisure.includes("Hollywood Bowl is at Let at Bluewater."));
  assert.ok(!leisure.some(l => /Wingstop/.test(l)), "another group's brand is not in this section's facts");
  assert.deepEqual(Array.from(boardBrandsIn(data, "Hospitality").values()), ["Wingstop"]);
  assert.equal(boardBrandsIn(data, null).size, 3);
  // Every figure has its line saying how it is counted.
  for (const line of Object.values(BOARD_COUNTED)) assert.ok(line.length > 60 && line.endsWith("."));
});
