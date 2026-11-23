// A Letting Tracker unit not on the tenancy schedule can be added to it
// (Woody, 2026-11-23). One door, server/tracker-to-schedule.ts; its "not on
// the schedule" test is the unit feed's and the schedule screen's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const door = read("server/tracker-to-schedule.ts");
const feed = read("server/property-units.ts");
const schedule = read("server/tenancy-schedule.ts");

test("the door's 'not on the schedule' test matches the unit feed and the schedule read", () => {
  const ties = ["tenancy_unit_id::text", "letting_tracker_unit_id =", "property_unit_id =", "coalesce(nullif(trim(ts.unit_number), ''), ts.premises)"];
  for (const tie of ties) {
    assert.ok(door.includes(tie), `door lacks ${tie}`);
    assert.ok(feed.includes(tie), `unit feed lacks ${tie}`);
    assert.ok(schedule.includes(tie), `schedule read lacks ${tie}`);
  }
});

test("the row is tied by id to the tracker unit and its transaction, under a lock", () => {
  assert.match(door, /FOR UPDATE OF au/);
  assert.match(door, /pg_advisory_xact_lock/);
  assert.match(door, /letting_tracker_unit_id, deal_id, property_unit_id/);
  assert.match(door, /UPDATE available_units SET tenancy_unit_id = \$1 WHERE id = \$2/);
  assert.match(door, /UPDATE crm_deals SET tenancy_unit_id = \$1 WHERE id = \$2 AND tenancy_unit_id IS NULL/);
});

test("the unit route checks the property for client logins; the bulk routes are admin and Preview-then-Apply", () => {
  assert.match(door, /\/api\/tenancy-schedule\/unit\/from-tracker\/:trackerId", requireAuth/);
  assert.match(door, /isPropertyInScope\(sc, propertyId\)/);
  assert.match(door, /tracker-schedule-gaps", requireAuth, requireAdmin/);
  assert.match(door, /tracker-schedule-gaps\/apply", requireAuth, requireAdmin/);
  assert.match(door, /preview\.by === by && preview\.at === req\.body\?\.previewedAt/);
  assert.doesNotMatch(read("server/index.ts").split("registerTrackerToScheduleRoutes")[0].slice(-200), /setInterval|cron/);
});

test("the screens offer it: the unit panel and the schedule's tracker row", () => {
  assert.match(read("client/src/components/property-page/unit-panel.tsx"), /AddTrackerToScheduleButton propertyId=\{propertyId\} trackerId=\{unit\.trackerId\}/);
  const sched = read("client/src/components/PropertyTenancySchedule.tsx");
  assert.match(sched, /addTrackerMutation\.mutate\(String\(unit\.available_unit_id\)\)/);
  assert.doesNotMatch(sched, /LETTING_REPAIR_TOOLS_ENABLED/);
  assert.match(read("client/src/pages/settings.tsx"), /<TrackerScheduleGapsPanel \/>/);
});
