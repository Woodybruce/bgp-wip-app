import assert from "node:assert/strict";
import test from "node:test";
import type { EngagementEvent } from "@shared/crm-engagement";
import { eventMatchesCompany, eventOccursOn, londonDateTimeInput, londonDay, londonInputToIso, monthDays, moveMonth } from "./helpers";

function event(overrides: Partial<EngagementEvent> = {}): EngagementEvent {
  return {id: "event", title: "Site visit", kind: "bgp", startsAt: "2026-10-28T10:00:00Z", endsAt: null,
    location: null, description: null, ownerId: null, ownerName: null, status: "planned", sourceUrl: null,
    dateConfirmed: true, outcome: null, updatedAt: "2026-10-28T09:00:00Z", strategyIds: [], companies: [], guests: [], ...overrides};
}

test("London form values preserve winter and summer time regardless of device timezone", () => {
  assert.equal(londonInputToIso("2026-10-28T10:30"), "2026-10-28T10:30:00.000Z");
  assert.equal(londonInputToIso("2026-07-15T10:30"), "2026-07-15T09:30:00.000Z");
  assert.equal(londonDateTimeInput("2026-07-15T09:30:00Z"), "2026-07-15T10:30");
  assert.equal(londonInputToIso(""), null);
});

test("clock-change gaps and invalid dates are rejected rather than silently moved", () => {
  assert.throws(() => londonInputToIso("2026-03-29T01:30"), /does not exist/);
  assert.throws(() => londonInputToIso("2026-02-30T10:00"), /does not exist/);
  assert.throws(() => londonInputToIso("not-a-date"), /valid date/);
  assert.equal(londonInputToIso("2026-10-25T01:30"), "2026-10-25T00:30:00.000Z");
});

test("calendar days use London dates and Monday-first month grids across year boundaries", () => {
  assert.equal(londonDay("2026-06-30T23:30:00Z"), "2026-07-01");
  assert.equal(moveMonth("2026-12", 1), "2027-01");
  assert.equal(moveMonth("2026-01", -1), "2025-12");
  const days = monthDays("2026-11");
  assert.equal(days.length, 42);
  assert.equal(days[0], "2026-10-26");
  assert.ok(days.includes("2026-11-30"));
});

test("unconfirmed and cancelled events never appear as confirmed calendar bookings", () => {
  assert.equal(eventOccursOn(event({dateConfirmed: false}), "2026-10-28"), false);
  assert.equal(eventOccursOn(event({status: "cancelled"}), "2026-10-28"), false);
  assert.equal(eventOccursOn(event({startsAt: null}), "2026-10-28"), false);
  assert.equal(eventOccursOn(event(), "2026-10-28"), true);
});

test("multi-day events span London dates without occupying their midnight checkout day", () => {
  const meeting = event({startsAt: "2026-07-14T23:30:00Z", endsAt: "2026-07-16T23:00:00Z"});
  assert.equal(eventOccursOn(meeting, "2026-07-14"), false);
  assert.equal(eventOccursOn(meeting, "2026-07-15"), true);
  assert.equal(eventOccursOn(meeting, "2026-07-16"), true);
  assert.equal(eventOccursOn(meeting, "2026-07-17"), false);
});

test("company filter includes explicit event links and linked guests without broad name matching", () => {
  assert.equal(eventMatchesCompany(event({companies: [{companyId: "landsec", companyName: "Landsec", reason: "Active scheme"}]}), "landsec"), true);
  assert.equal(eventMatchesCompany(event({guests: [{contactId: "person", name: "Person", companyId: "landsec", companyName: "Landsec", status: "suggested"}]}), "landsec"), true);
  assert.equal(eventMatchesCompany(event({title: "Landsec opportunity"}), "landsec"), false);
  assert.equal(eventMatchesCompany(event(), ""), true);
});
