import assert from "node:assert/strict";
import { test } from "node:test";
import type { PortfolioContactEntry, PortfolioContactRelationship } from "../../shared/portfolio-contacts";
import { filterPortfolioContacts, portfolioContactsPage, portfolioRelationships } from "../../client/src/lib/portfolio-contacts";

const relationship = (patch: Partial<PortfolioContactRelationship> = {}): PortfolioContactRelationship => ({
  group: "deals", source: "Named tenant contact on deal", property: { id: "bluewater", name: "Bluewater" }, confirmed: true, ...patch,
});
const person = (patch: Partial<PortfolioContactEntry> = {}): PortfolioContactEntry => ({
  id: "contact:1", kind: "person", name: "Zoë Agent", role: "Director", email: "zoe@example.test", phone: "020 7000 0000",
  contactId: "1", company: { id: "firm", name: "Example Agents" }, canOpenContact: true, canOpenCompany: true,
  relationships: [relationship()], ...patch,
});
const all = { group: "all" as const, propertyId: "all", search: "" };

test("search finds people through relationships beyond the preview and brings that context first", () => {
  const entry = person({ relationships: [relationship(), relationship({ property: { id: "two", name: "Second Centre" } }),
    relationship({ property: { id: "three", name: "Trinity Leeds" }, deal: { id: "deal", name: "Hidden restaurant letting" }, unitName: "North Arcade 27" })] });
  for (const search of ["trinity", "hidden restaurant", "north arcade", "zoe restaurant", "zoe@example.test", "example agents"]) {
    assert.deepEqual(filterPortfolioContacts([entry], { ...all, search }).map(item => item.id), [entry.id], search);
  }
  assert.equal(portfolioRelationships(entry, { ...all, search: "hidden restaurant" })[0].property?.id, "three");
  assert.equal(filterPortfolioContacts([entry], { ...all, search: "unknown contact" }).length, 0);
});

test("property and group filters must describe the same relationship", () => {
  const entry = person({ relationships: [relationship(), relationship({ group: "consultants", property: { id: "two", name: "Second Centre" } })] });
  assert.equal(filterPortfolioContacts([entry], { ...all, group: "consultants", propertyId: "bluewater" }).length, 0);
  assert.equal(filterPortfolioContacts([entry], { ...all, group: "consultants", propertyId: "two" }).length, 1);
  assert.equal(filterPortfolioContacts([entry], { ...all, propertyId: "two", search: "bluewater" }).length, 0);
});

test("company-wide team members stay in All but do not falsely match individual properties", () => {
  const entry = person({ side: "client", relationships: [relationship({ group: "internal", source: "Company contact", property: null })] });
  assert.equal(filterPortfolioContacts([entry], { ...all, group: "internal" }).length, 1);
  assert.equal(filterPortfolioContacts([entry], { ...all, propertyId: "bluewater" }).length, 0);
});

test("same-name people retain distinct records and sorted order is stable across input order", () => {
  const first = person({ id: "contact:1", name: "Alex Smith" });
  const second = person({ id: "contact:2", name: "Alex Smith" });
  assert.deepEqual(filterPortfolioContacts([second, first], all).map(entry => entry.id), [first.id, second.id]);
});

test("pagination reaches records beyond old caps and clamps pages after filtered results shrink", () => {
  const records = Array.from({ length: 257 }, (_, index) => person({ id: `contact:${index}`, name: `Person ${index}` }));
  const visited: string[] = [];
  const filtered = filterPortfolioContacts(records, all);
  for (let requested = 1; requested <= 22; requested++) visited.push(...portfolioContactsPage(filtered, requested, 12).entries.map(entry => entry.id));
  assert.equal(new Set(visited).size, 257);
  assert.equal(visited.length, 257);
  assert.equal(portfolioContactsPage(filtered.slice(0, 3), 22, 12).page, 1);
  assert.deepEqual(portfolioContactsPage([], 22, 12), { entries: [], page: 1, pageCount: 1, start: 0, end: 0 });
});
