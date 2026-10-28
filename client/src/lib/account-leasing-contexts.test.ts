import assert from "node:assert/strict";
import test from "node:test";
import type { AccountLeasingAgent } from "@shared/account-leasing";
import { groupLeasingContexts } from "./account-leasing-contexts";

type Context = AccountLeasingAgent["contexts"][number];
const context = (overrides: Partial<Context> = {}): Context => ({propertyId: "bluewater", propertyName: "Bluewater", role: "Leasing agent", basis: "deal_record", href: "/deals/one", label: "Letting one · INV", ...overrides});

test("repeated historical work becomes one property row with every deal link", () => {
  const groups = groupLeasingContexts([context(), context({href: "/deals/two", label: "Letting two · COM"}), context({href: "/deals/three", label: "Letting three · SOL"})]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].historyOnly, true);
  assert.equal(groups[0].dealEvidence.length, 3);
  assert.deepEqual(new Set(groups[0].evidence.map(e => e.href)), new Set(["/deals/one", "/deals/two", "/deals/three"]));
});

test("saved roles lead visually while property-team and historical evidence remain accessible", () => {
  const groups = groupLeasingContexts([
    context(), context({href: "/deals/two", label: "Letting two"}),
    context({role: "Leasing", basis: "property_team", href: "/properties/bluewater", label: "Saved property team"}),
    context({role: "Leasing", basis: "saved_role", href: "/properties/bluewater", label: "Confirmed account role"}),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary.basis, "saved_role");
  assert.equal(groups[0].historyOnly, false);
  assert.equal(groups[0].evidence.length, 4);
  assert.equal(groups[0].savedEvidence.length, 2);
  assert.equal(groups[0].dealEvidence.length, 2);
});

test("different properties, roles and account-wide assignments stay separate", () => {
  const groups = groupLeasingContexts([
    context(), context({propertyId: "onc", propertyName: "One New Change"}),
    context({role: "Tenant rep"}),
    context({propertyId: null, propertyName: null, role: "Leasing", basis: "saved_role", href: "/companies/landsec", label: "Confirmed account role"}),
  ]);
  assert.equal(groups.length, 4);
  assert.equal(groups[0].primary.propertyId, null);
  assert.equal(groups.filter(g => g.historyOnly).length, 3);
});

test("only identical evidence is deduplicated and input is unchanged", () => {
  const original = [context(), context(), context({label: "Different saved detail"})];
  const before = JSON.stringify(original);
  const groups = groupLeasingContexts(original);
  assert.equal(groups[0].evidence.length, 2);
  assert.equal(JSON.stringify(original), before);
});
