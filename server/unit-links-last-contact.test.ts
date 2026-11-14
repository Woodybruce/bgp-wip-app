import test from "node:test";
import assert from "node:assert/strict";
import { trackerUnitHref, propertyUnitHref } from "../client/src/lib/unit-links";
import { daysSinceContact, lastContactShort, latestPastContact } from "../shared/last-contact";

const NOW = Date.parse("2026-11-14T12:00:00Z");

test("tracker links carry the unit, by login", () => {
  assert.equal(trackerUnitHref(null, "p1", { staff: true, landsecView: false, restricted: false }), null);
  assert.equal(trackerUnitHref("u 1", "p1", { staff: true, landsecView: false, restricted: false }), "/available?unitId=u%201&propertyId=p1");
  assert.equal(trackerUnitHref("u1", "p1", { staff: true, landsecView: true, restricted: false }), "/deals/letting?unitId=u1&propertyId=p1");
  assert.equal(trackerUnitHref("u1", null, { staff: false, landsecView: true, restricted: false }), "/deals/letting?unitId=u1");
  assert.equal(trackerUnitHref("u1", "p1", { staff: false, landsecView: true, restricted: true }), "/landsec/tracker?unit=u1");
});

test("a schedule row opens on its property page", () => {
  assert.equal(propertyUnitHref("p1", "t1"), "/properties/p1#tenancy-unit-t1");
  assert.equal(propertyUnitHref("p1", null), null);
});

test("a date ahead is never a last touch", () => {
  assert.equal(latestPastContact(["2026-11-20T00:00:00Z", "2026-11-10T00:00:00Z", null, "nonsense"], NOW), "2026-11-10T00:00:00Z");
  assert.equal(latestPastContact(["2026-12-01T00:00:00Z"], NOW), null);
  assert.equal(daysSinceContact("2026-11-20T00:00:00Z", NOW), null);
  assert.equal(daysSinceContact("2026-11-10T12:00:00Z", NOW), 4);
});

test("short labels", () => {
  assert.equal(lastContactShort("2026-11-14T09:00:00Z", NOW), "today");
  assert.equal(lastContactShort("2026-11-10T12:00:00Z", NOW), "4d");
  assert.equal(lastContactShort("2026-10-24T12:00:00Z", NOW), "3w");
  assert.equal(lastContactShort("2026-06-14T12:00:00Z", NOW), "5mo");
  assert.equal(lastContactShort("2024-11-14T12:00:00Z", NOW), "2y");
  assert.equal(lastContactShort("2026-11-20T12:00:00Z", NOW), "Next: 20 Nov");
  assert.equal(lastContactShort(null, NOW), null);
});
