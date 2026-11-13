// Honest use of requirements outside the Requirements page: the dated reason
// and weight (shared/requirement-live.ts), the target engine's scoring and
// what it lets a landlord read, and the code-built news overlap list.
//   node --import tsx --test server/requirement-honest-use.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requirementReason, requirementClientVisible, REQUIREMENT_STATE_WEIGHT } from "@shared/requirement-live";
import { unitCandidates, type CentreEvidence } from "./target-tenant-engine";
import { groupOverlaps, reconfirmLine, overlapReportText, overlapSource } from "./requirement-overlaps";
import { clientScoreLabel, clientScoreView } from "./hunter-score";

const TODAY = new Date("2026-11-12T12:00:00Z");
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86400000);
const confirmed = (n: number, extra: Record<string, any> = {}) => ({ status: "Active", origin: "bgp", lastConfirmedAt: daysAgo(n), lastConfirmedBy: "u1", lastConfirmedByName: "Emily Stone", confirmedHow: "call", ...extra });
const pipnet = (extra: Record<string, any> = {}) => ({ status: "Active", origin: "pipnet", sources: ["PIPnet"], lastListedAt: new Date("2026-09-03T00:00:00Z"), lastListedSource: "PIPnet", ...extra });

describe("the dated reason other screens show", () => {
  it("names a requirement by what it is and its date, never as live", () => {
    const live = requirementReason(confirmed(9), TODAY);
    assert.deepEqual([live.state, live.weight, live.text, live.short, live.clientText], ["live", 1, "requirement confirmed 3 Nov", "confirmed 3 Nov", null]);
    const lapsed = requirementReason(confirmed(150), TODAY);
    assert.deepEqual([lapsed.state, lapsed.weight, lapsed.text], ["to_confirm", 0.5, "requirement last confirmed 15 Jun"]);
    const listing = requirementReason(pipnet(), TODAY);
    assert.deepEqual([listing.state, listing.weight, listing.text, listing.short, listing.clientText],
      ["background", 0.2, "PIPnet listing from Sep, not confirmed", "PIPnet listing from Sep, not confirmed", "PIPnet listing from Sep"]);
    assert.equal(requirementReason({ status: "Active", origin: "trl", sources: ["TRL"] }, TODAY).text, "The Requirement List listing, no date, not confirmed");
    assert.equal(requirementReason(pipnet({ lastListedAt: new Date("2025-03-01T00:00:00Z") }), TODAY).text, "PIPnet listing from Mar 2025, not confirmed");
    const own = requirementReason({ status: "Active", origin: "bgp", requirementDate: "2026-08-04" }, TODAY);
    assert.deepEqual([own.state, own.text, own.short], ["to_confirm", "BGP requirement dated 4 Aug, not confirmed", "dated 4 Aug, not confirmed"]);
    assert.equal(requirementReason({ status: "Draft", origin: "bgp", createdAt: daysAgo(2) }, TODAY).text, "draft requirement added 10 Nov, not confirmed");
    assert.equal(requirementReason({ status: "On hold", origin: "bgp" }, TODAY).text, "BGP requirement, no date, not confirmed, on hold");
    const press = requirementReason(confirmed(2, { confirmedHow: "press" }), TODAY);
    assert.deepEqual([press.text, press.short], ["press-reported requirement, logged 10 Nov", "press-reported, logged 10 Nov"]);
    for (const row of [confirmed(9), confirmed(150), pipnet(), { status: "Active", origin: "bgp" }, { status: "On hold", origin: "bgp" }, confirmed(2, { confirmedHow: "press" })]) {
      const r = requirementReason(row, TODAY);
      assert.ok(!/\blive\b/i.test(`${r.text} ${r.short} ${r.clientText || ""}`), r.text);
      assert.ok(!/emily/i.test(`${r.text} ${r.short} ${r.clientText || ""}`), "never names who confirmed");
    }
  });

  it("gives a client login the source and month of a PIPnet listing and nothing else", () => {
    // A PIPnet listing a BGP person has confirmed: staff read the confirmation, a client reads the listing.
    const both = requirementReason(confirmed(9, { origin: "pipnet", sources: ["PIPnet"], lastListedAt: new Date("2026-09-03T00:00:00Z") }), TODAY);
    assert.deepEqual([both.state, both.text, both.clientText], ["live", "requirement confirmed 3 Nov", "PIPnet listing from Sep"]);
    assert.equal(requirementReason({ status: "Active", sources: ["PIPnet"] }, TODAY).clientText, "PIPnet listing");
    assert.equal(requirementReason({ status: "Active", sources: ["PIPnet"], requirementDate: "03/09/2026" }, TODAY).clientText, "PIPnet listing from Sep");
    // BGP's hand-entered rows, Requirement List rows and chat-logged rows are not a client's to see.
    for (const row of [confirmed(9), { status: "Active", origin: "trl", sources: ["TRL"] }, { status: "Active", origin: "bgp", sources: ["ChatBGP"] }]) {
      assert.equal(requirementClientVisible(row), false);
      assert.equal(requirementReason(row, TODAY).clientText, null);
    }
    assert.deepEqual(REQUIREMENT_STATE_WEIGHT, { live: 1, to_confirm: 0.5, background: 0.2, closed: 0 });
  });
});

describe("target engine candidates", () => {
  const brand = (id: string, name: string, row: Record<string, any> | null, extra: Record<string, any> = {}) => ({
    key: id, companyId: id, name, category: "Tenant - Restaurant", stores: null, rollout: null, signals: [] as any[], bgpClient: false,
    requirements: row ? [{ size: ["1500 - 3000 sq ft"], use: ["Restaurant"], requirement_locations: ["Leeds"], reason: requirementReason(row, TODAY) }] : [], ...extra,
  });
  const evidence = (client: boolean, brands: any[]): CentreEvidence => ({
    propertyId: "p1", property: { id: "p1", name: "Trinity Leeds", postcode: "LS1 5AT", address: "Albion Street, Leeds" }, client, positioning: "mainstream",
    mix: [], hereKeys: new Set(), hereIds: new Set(), brands: new Map(brands.map(b => [b.key, b])), context: "",
  });
  const unit = { id: "u1", unit_name: "Unit 12 restaurant", sqft: 2000, use_class: "Restaurant" };

  it("scales the fitting requirement by state and keeps BGP's own requirements BGP-only", () => {
    const out = unitCandidates(evidence(false, [
      brand("live", "Live Brand", confirmed(9)),
      brand("stale", "Stale Brand", confirmed(150)),
      brand("listing", "Listing Brand", pipnet()),
      brand("both", "Both Brand", confirmed(9, { origin: "pipnet", sources: ["PIPnet"], lastListedAt: new Date("2026-09-03T00:00:00Z") })),
    ]), unit);
    const by = Object.fromEntries(out.map(c => [c.name, c]));
    assert.deepEqual([by["Live Brand"].score, by["Stale Brand"].score, by["Listing Brand"].score, by["Both Brand"].score], [35, 18, 7, 35]);
    // A hand-entered requirement is evidence the landlord never reads.
    assert.deepEqual([by["Live Brand"].evidence, by["Live Brand"].internal], [[], ["requirement confirmed 3 Nov, fits this unit (1500 - 3000 sq ft)"]]);
    assert.deepEqual(by["Stale Brand"].internal, ["requirement last confirmed 15 Jun, fits this unit (1500 - 3000 sq ft)"]);
    // A PIPnet listing is shareable by source and date; whether BGP confirmed it is not.
    assert.deepEqual([by["Listing Brand"].evidence, by["Listing Brand"].internal],
      [["PIPnet listing from Sep, fits this unit (1500 - 3000 sq ft)"], ["that listing: PIPnet listing from Sep, not confirmed"]]);
    assert.deepEqual([by["Both Brand"].evidence, by["Both Brand"].internal],
      [["PIPnet listing from Sep, fits this unit (1500 - 3000 sq ft)"], ["that listing: requirement confirmed 3 Nov"]]);
    assert.deepEqual(out.map(c => c.name).slice(0, 2).sort(), ["Both Brand", "Live Brand"]);
    for (const c of out) assert.ok(![...c.evidence, ...c.internal].some(e => /live requirement/i.test(e)), c.name);
  });

  it("a fitting requirement still lets a brand outside the hospitality slice through, by flag not by wording", () => {
    const retail = brand("r", "Retail Brand", confirmed(9), { category: "Tenant - Fashion" });
    const none = brand("n", "No Fit Brand", null, { category: "Tenant - Fashion", signals: [{ text: "trading 1.0km away", weight: 5 }] });
    const out = unitCandidates(evidence(false, [retail, none]), unit);
    assert.deepEqual(out.map(c => c.name), ["Retail Brand"]);
  });

  it("a client viewer reads a PIPnet listing by source and month, with nothing internal", () => {
    // The engine loads only PIPnet-labelled rows for a client; this is what it then says.
    const out = unitCandidates(evidence(true, [brand("listing", "Listing Brand", pipnet()),
      brand("both", "Both Brand", confirmed(9, { origin: "pipnet", sources: ["PIPnet"], lastListedAt: new Date("2026-09-03T00:00:00Z") }))]), unit);
    for (const c of out) {
      assert.deepEqual(c.evidence, ["PIPnet listing from Sep, fits this unit (1500 - 3000 sq ft)"]);
      assert.deepEqual(c.internal, []);
    }
    // Defence in depth: a hand-entered row that reached a client's evidence says nothing.
    assert.deepEqual(unitCandidates(evidence(true, [brand("own", "Own Brand", confirmed(9))]), unit), []);
  });

  it("a requirement that does not fit the unit's use or place is a weak, dated line", () => {
    const elsewhere = { ...brand("e", "Elsewhere Brand", pipnet()), requirements: [{ size: ["1500 - 3000 sq ft"], use: ["Gym"], requirement_locations: ["Bristol"], reason: requirementReason(pipnet(), TODAY) }] };
    const [c] = unitCandidates(evidence(false, [elsewhere]), unit);
    assert.deepEqual([c.evidence, c.internal, c.score], [["PIPnet listing from Sep for UK space"], [], 1]);
  });
});

describe("news joined to requirements by brand", () => {
  const reqs = [
    { id: "r1", company_id: "c1", brand: "Pret A Manger", name: "Pret", size: ["1,000 - 2,000 sq ft"], requirement_locations: ["Leeds", "York"], ...confirmed(9) },
    { id: "r2", company_id: "c2", brand: "Dishoom", name: "Dishoom", size: null, requirement_locations: null, ...pipnet() },
    { id: "r3", company_id: "c3", brand: "No News", name: "No News", ...confirmed(9) },
    { id: "r4", company_id: "c1", brand: "Pret A Manger", name: "Pret old", status: "Past", origin: "bgp" },
  ];
  const signals = [
    { brand_company_id: "c2", signal_type: "opening", headline: "Dishoom to open in Leeds", source: "newsletter:2026-11-10:Propel Morning Briefing", detail: "Via newsletter: Propel", at: daysAgo(1) },
    { brand_company_id: "c1", signal_type: "funding", headline: "Pret raises £100m", source: "https://www.thecaterer.com/news/pret", at: daysAgo(3) },
    { brand_company_id: "c1", signal_type: "funding", headline: "PRET RAISES £100M", source: "https://example.com/x", at: daysAgo(2) },
    { brand_company_id: "c9", signal_type: "opening", headline: "A brand with no requirement", source: null, at: daysAgo(1) },
  ];

  it("lists only brands that have both, live requirements first, and drops closed rows and repeats", () => {
    const out = groupOverlaps(signals, reqs, TODAY);
    assert.deepEqual(out.map(o => o.brand), ["Pret A Manger", "Dishoom"]);
    assert.deepEqual(out[0].requirements.map(r => [r.id, r.stateLabel, r.reason]), [["r1", "Live", "requirement confirmed 3 Nov"]]);
    assert.equal(out[0].signals.length, 1, "the same headline twice is one story");
    assert.deepEqual([out[1].requirements[0].stateLabel, out[1].requirements[0].reason, out[1].signals[0].source], ["Background", "PIPnet listing from Sep, not confirmed", "Propel"]);
    assert.equal(overlapSource("https://www.thecaterer.com/news/pret"), "thecaterer.com");
  });

  it("writes the two lists as plain text for the Friday report", () => {
    const counts = { toConfirm: 12, drafts: 2, lapsed: 5, goingStale: 1 };
    assert.equal(reconfirmLine(counts), "12 requirements need reconfirming (5 last confirmed more than 90 days ago; 2 drafts; 1 more lapse within 14 days)");
    assert.equal(reconfirmLine({ toConfirm: 1, drafts: 0, lapsed: 0, goingStale: 0 }), "1 requirement needs reconfirming");
    assert.equal(reconfirmLine({ toConfirm: 0, drafts: 0, lapsed: 0, goingStale: 3 }), null);
    const text = overlapReportText({ windowDays: 7, overlaps: groupOverlaps(signals, reqs, TODAY), unlinkedRequirements: 4 }, counts, "https://chatbgp.app");
    assert.match(text, /- Pret A Manger · Requirement: \[Live\] 1,000 - 2,000 sq ft, Leeds, York \(requirement confirmed 3 Nov\) · News: 9 Nov funding: "Pret raises £100m" \(thecaterer\.com\)/);
    assert.match(text, /- Dishoom · Requirement: \[Background\] Dishoom \(PIPnet listing from Sep, not confirmed\)/);
    assert.match(text, /4 open requirement rows have no brand link/);
    assert.match(text, /REQUIREMENTS TO RECONFIRM: 12 requirements need reconfirming .* Link: https:\/\/chatbgp\.app\/requirements\?list=to_confirm/);
    assert.match(overlapReportText({ windowDays: 7, overlaps: [], unlinkedRequirements: 0 }, null), /- None this week\./);
  });
});

describe("what leaves the staff side", () => {
  it("counts open suggestions in the line the digest and the Friday report show", () => {
    assert.equal(reconfirmLine({ toConfirm: 3, drafts: 0, lapsed: 0, goingStale: 0, suggestions: 6 }), "6 suggestions to answer and 3 requirements need reconfirming");
    assert.equal(reconfirmLine({ toConfirm: 1, drafts: 1, lapsed: 0, goingStale: 0, suggestions: 1 }), "1 suggestion to answer and 1 requirement needs reconfirming (1 draft)");
    assert.equal(reconfirmLine({ toConfirm: 0, drafts: 0, lapsed: 0, goingStale: 0, suggestions: 2 }), "2 suggestions to answer on the Requirements page");
    assert.equal(reconfirmLine({ toConfirm: 0, drafts: 0, lapsed: 0, goingStale: 0, suggestions: 0 }), null);
  });

  it("gives a client login no score line about BGP's own requirements, or whether BGP confirmed a listing", () => {
    assert.equal(clientScoreLabel("1 requirement on BGP's books, confirmed or logged by BGP in 12 months"), null);
    assert.equal(clientScoreLabel("2 requirements on BGP's books, co…"), null);
    assert.equal(clientScoreLabel("1 active requirement with BGP"), null);
    assert.equal(clientScoreLabel("2 market listings (PIPnet / The Requirement List), not confirmed by BGP"), "2 market listings");
    assert.equal(clientScoreLabel("1 market listing (PIPnet / The R…"), "1 market listing");
    assert.equal(clientScoreLabel("Funding: raises £100m"), "Funding: raises £100m");
    const result = { score: 20, lines: [
      { bucket: "intent", points: 8, label: "1 requirement on BGP's books, confirmed or logged by BGP in 12 months" },
      { bucket: "intent", points: 4, label: "1 market listing (PIPnet / The Requirement List), not confirmed by BGP" },
      { bucket: "capacity", points: 8, label: "Stock +40% YoY" },
    ], expansionFlags: ["1 requirement on BGP's books, co…", "Stock +40% YoY", "1 market listing (PIPnet / The R…"] };
    const shown = clientScoreView(result);
    assert.deepEqual(shown.lines.map(l => l.label), ["1 market listing", "Stock +40% YoY"]);
    assert.deepEqual(shown.expansionFlags, ["Stock +40% YoY", "1 market listing"]);
    assert.equal(shown.score, 20);
    assert.doesNotMatch(JSON.stringify(shown), /BGP|confirmed/);
    assert.equal(result.lines.length, 3, "the staff result is not changed");
  });
});

