// The Landsec menu rule (shared/landsec-menu.ts): which entry is lit where,
// and where the old scheme page sends a full login.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANDSEC_MENU, LANDSEC_RESTRICTED_MENU, landsecMenuActive, landsecRestrictedRole, landsecSchemeRedirect, dealListSeed, type DealListSaved } from "../shared/landsec-menu";

const FULL = [LANDSEC_MENU.properties, LANDSEC_MENU.deals, LANDSEC_MENU.tracker, LANDSEC_MENU.brands, LANDSEC_MENU.chat];
const lit = (location: string) => FULL.filter(url => landsecMenuActive(url, location));

test("each address lights exactly one entry of the full menu", () => {
  const cases: [string, string][] = [
    ["/deals/properties", LANDSEC_MENU.properties],
    ["/properties", LANDSEC_MENU.properties],
    ["/properties/p-1", LANDSEC_MENU.properties],
    ["/landsec/unit/u-1", LANDSEC_MENU.properties],
    ["/deals/letting", LANDSEC_MENU.tracker],
    ["/available", LANDSEC_MENU.tracker],
    ["/deals", LANDSEC_MENU.deals],
    ["/deals/list", LANDSEC_MENU.deals],
    ["/deals/3f2c9a", LANDSEC_MENU.deals],
    ["/brands", LANDSEC_MENU.brands],
    ["/brands/b-1", LANDSEC_MENU.brands],
    ["/landsec/brand-cases", LANDSEC_MENU.brands],
    ["/landsec/brand-case/b-1", LANDSEC_MENU.brands],
    ["/messages", LANDSEC_MENU.chat],
    ["/chatbgp", LANDSEC_MENU.chat],
  ];
  for (const [location, entry] of cases) assert.deepEqual(lit(location), [entry], location);
});

test("Deals is not lit on the Properties or Letting Tracker addresses", () => {
  for (const location of ["/deals/properties", "/deals/letting", "/properties/p-1", "/available"]) {
    assert.equal(landsecMenuActive(LANDSEC_MENU.deals, location), false, location);
  }
});

test("a query string on the address or the entry does not change the answer", () => {
  assert.equal(landsecMenuActive(LANDSEC_MENU.deals, "/deals/list?status=NEG"), true);
  assert.equal(landsecMenuActive(LANDSEC_MENU.tracker, "/available?workspace=viewings"), true);
  assert.equal(landsecMenuActive(LANDSEC_MENU.brands, "/brands?tab=crm"), true);
  assert.equal(landsecMenuActive("/brands?tab=crm", "/brands"), true);
});

test("an address that only looks alike lights nothing", () => {
  for (const location of ["/dealsroom", "/available-units", "/propertiesx", "/landsec/brand-crm", "/landsec/tracker", "/companies/c-1"]) {
    assert.deepEqual(lit(location), [], location);
  }
});

test("a joint agent's two entries keep their own addresses", () => {
  assert.equal(landsecMenuActive(LANDSEC_RESTRICTED_MENU.properties, "/"), true);
  assert.equal(landsecMenuActive(LANDSEC_RESTRICTED_MENU.properties, "/home"), true);
  assert.equal(landsecMenuActive(LANDSEC_RESTRICTED_MENU.properties, "/landsec/deals"), false);
  assert.equal(landsecMenuActive(LANDSEC_RESTRICTED_MENU.deals, "/landsec/deals"), true);
  assert.equal(landsecMenuActive(LANDSEC_RESTRICTED_MENU.deals, "/"), false);
  // Their other entries are left to the menu's ordinary rule.
  for (const url of ["/landsec/tracker", "/landsec/viewings", "/landsec/tasks", "/landsec/brand-crm"]) {
    assert.equal(landsecMenuActive(url, url), null, url);
  }
});

test("only a joint agent is restricted: an asset manager has the full Landsec menu", () => {
  assert.equal(landsecRestrictedRole("joint_agent"), true);
  for (const role of ["asset_manager", "leasing_manager", "", null, undefined]) assert.equal(landsecRestrictedRole(role), false, String(role));
});

test("the old scheme page goes to the property's Units section, or to Properties", () => {
  assert.equal(landsecSchemeRedirect("p-blue"), "/properties/p-blue?section=units");
  assert.equal(landsecSchemeRedirect(null), "/deals/properties");
  assert.equal(landsecSchemeRedirect(undefined), "/deals/properties");
});

// The Properties stage pills open Deals at "?status=<code>" and
// "?clock=stuck". Deals keeps its filters in the session between visits, so
// each pill has to be the whole filter, not one more filter on top.
test("a stage or clock link is the whole Deals filter: Negotiating, then Stuck, then Marketing", () => {
  // What Deals saves to the session once it has opened with a seed.
  const visit = (query: string, saved: DealListSaved | null) => {
    const seed = dealListSeed(new URLSearchParams(query), saved);
    const snapshot: DealListSaved = {
      search: seed.search, activeGroup: seed.status, columnFilters: seed.columnFilters,
      propertyId: seed.propertyId, scheme: seed.scheme, location: seed.location,
      clock: seed.clock !== "all" ? seed.clock : undefined,
    };
    return { seed, snapshot };
  };
  const neg = visit("status=NEG", null);
  assert.equal(neg.seed.status, "NEG");
  assert.equal(neg.seed.clock, "all");
  const stuck = visit("clock=stuck", neg.snapshot);
  assert.equal(stuck.seed.status, "all", "Stuck must not inherit Negotiating");
  assert.equal(stuck.seed.clock, "stuck");
  const marketing = visit("status=AVA", stuck.snapshot);
  assert.equal(marketing.seed.status, "AVA");
  assert.equal(marketing.seed.clock, "all", "Marketing must not inherit Stuck");
  // The Deals menu entry carries no filter: the last view comes back whole.
  const menu = visit("", marketing.snapshot);
  assert.equal(menu.seed.status, "AVA");
  assert.equal(menu.seed.clock, "all");
});

test("a stage or clock link drops the saved search, property, region and status column filter", () => {
  const saved: DealListSaved = {
    search: "nando", activeGroup: "SOL", propertyId: "p-1", scheme: "East", location: "London", clock: "Landsec",
    columnFilters: { status: ["SOL"], team: ["Leasing"], type: ["New Letting"] },
  };
  const seed = dealListSeed(new URLSearchParams("status=HOT"), saved);
  assert.deepEqual(
    { search: seed.search, status: seed.status, propertyId: seed.propertyId, scheme: seed.scheme, location: seed.location, clock: seed.clock },
    { search: "", status: "HOT", propertyId: null, scheme: "", location: "all", clock: "all" });
  // The team has its own rule; every other saved column filter would fight
  // the link (a saved Deal Type left no deal at the stage).
  assert.deepEqual(seed.columnFilters, { team: ["Leasing"] });
  assert.deepEqual(dealListSeed(new URLSearchParams("clock=stuck"), { columnFilters: { type: ["Lease Renewal"], agent: ["a"], status: ["SOL"] } }).columnFilters, {});
  // A link may still carry more than one filter of its own.
  const both = dealListSeed(new URLSearchParams("status=NEG&clock=stuck&propertyId=p-9&q=pret"), saved);
  assert.deepEqual([both.status, both.clock, both.propertyId, both.search], ["NEG", "stuck", "p-9", "pret"]);
});

test("a link with no stage or clock still restores the saved view", () => {
  const saved: DealListSaved = { search: "nando", activeGroup: "SOL", propertyId: "p-1", location: "London", clock: "stuck", columnFilters: { status: ["SOL"] } };
  const bare = dealListSeed(new URLSearchParams(""), saved);
  assert.deepEqual([bare.search, bare.status, bare.propertyId, bare.location, bare.clock], ["nando", "SOL", "p-1", "London", "stuck"]);
  assert.deepEqual(bare.columnFilters, { status: ["SOL"] });
  // "?propertyId=" alone (the Properties summary's link) keeps today's rule.
  const byProperty = dealListSeed(new URLSearchParams("propertyId=p-2"), saved);
  assert.deepEqual([byProperty.propertyId, byProperty.status, byProperty.search], ["p-2", "SOL", "nando"]);
  assert.deepEqual(dealListSeed(new URLSearchParams(""), null), { search: "", status: "all", propertyId: null, scheme: "", location: "all", clock: "all", columnFilters: {} });
});
