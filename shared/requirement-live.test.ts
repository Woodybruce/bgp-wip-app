/**
 * requirement-live.test.ts: the one rule for what counts as a live
 * requirement (shared/requirement-live.ts).
 *
 * Run with: node --import tsx --test shared/requirement-live.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  requirementLive, requirementStateSql, requirementIsLiveSql, parseRequirementDate, requirementIsImportOnly,
  REQUIREMENT_LIVE_DAYS, REQUIREMENT_TO_CONFIRM_DAYS,
  requirementListingUpdates, importMayLabel, bgpCreatedStamp, stripRequirementProvenance,
  requirementGoingStale, requirementDaysLeft, requirementListKey, requirementSourceLabels, REQUIREMENT_GOING_STALE_DAYS, requirementOwnerColumns,
  requirementClientCopy, requirementReason,
} from "./requirement-live";

const TODAY = new Date("2026-11-12T12:00:00Z");
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86400000);
const confirmedBy = (n: number, extra: Record<string, any> = {}) => ({
  status: "Active", origin: "bgp", lastConfirmedAt: daysAgo(n), lastConfirmedBy: "u1", lastConfirmedByName: "Emily Carter", confirmedHow: "created", ...extra,
});

describe("requirementLive: states", () => {
  it("is live when a named person confirmed it within 90 days", () => {
    const r = requirementLive(confirmedBy(0), TODAY);
    assert.equal(r.state, "live");
    assert.equal(r.confirmed, true);
    assert.equal(r.dateLabel, "confirmed 12 Nov by Emily");
    assert.equal(r.days, 0);
    assert.equal(requirementLive(confirmedBy(REQUIREMENT_LIVE_DAYS), TODAY).state, "live");
  });

  it("drops to To confirm after 90 days and to Background after 12 months", () => {
    assert.equal(requirementLive(confirmedBy(REQUIREMENT_LIVE_DAYS + 1), TODAY).state, "to_confirm");
    assert.equal(requirementLive(confirmedBy(REQUIREMENT_TO_CONFIRM_DAYS), TODAY).state, "to_confirm");
    const old = requirementLive(confirmedBy(REQUIREMENT_TO_CONFIRM_DAYS + 1), TODAY);
    assert.equal(old.state, "background");
    assert.equal(old.dateLabel, "confirmed 11 Nov 2025 by Emily");
  });

  it("treats a blank status as open and a snake_case row the same as a camelCase one", () => {
    const r = requirementLive({ status: null, origin: "bgp", last_confirmed_at: daysAgo(3).toISOString(), last_confirmed_by: "u1", last_confirmed_by_name: "Tom" }, TODAY);
    assert.equal(r.state, "live");
    assert.equal(r.dateLabel, "confirmed 9 Nov by Tom");
    assert.equal(r.days, 3);
  });

  it("does not count a confirmation date with no person behind it", () => {
    const r = requirementLive({ status: "Active", origin: "bgp", lastConfirmedAt: daysAgo(1), requirementDate: "2026-11-01" }, TODAY);
    assert.equal(r.confirmed, false);
    assert.equal(r.state, "to_confirm");
    assert.equal(r.dateLabel, "dated 1 Nov");
  });

  it("keeps an import-only listing in Background however recent, and never calls it confirmed", () => {
    const pipnet = requirementLive({ status: "Active", origin: "pipnet", sources: ["PIPnet"], lastListedAt: new Date("2026-09-03T00:00:00Z"), lastListedSource: "PIPnet", requirementDate: "2026-09-03", updatedAt: daysAgo(0) }, TODAY);
    assert.equal(pipnet.state, "background");
    assert.equal(pipnet.importOnly, true);
    assert.equal(pipnet.confirmed, false);
    assert.equal(pipnet.dateLabel, "listed on PIPnet 3 Sep");
    assert.equal(pipnet.days, 70);
    assert.ok(!/confirmed/.test(pipnet.dateLabel));
  });

  it("reads an older import row (no origin) from its source labels and its listing date", () => {
    const legacy = requirementLive({ status: "Active", sources: ["PIPnet"], requirementDate: "2026-10-30", createdAt: daysAgo(2) }, TODAY);
    assert.equal(legacy.state, "background");
    assert.equal(legacy.dateLabel, "listed on PIPnet 30 Oct");
    const trl = requirementLive({ status: "Active", sources: ["TRL"], createdAt: daysAgo(2), updatedAt: daysAgo(2) }, TODAY);
    assert.equal(trl.state, "background");
    assert.equal(trl.dateLabel, "listed on The Requirement List, no date");
    assert.equal(trl.days, null);
  });

  it("makes an import live once a person confirms it", () => {
    const r = requirementLive({ status: "Active", origin: "pipnet", sources: ["PIPnet"], lastListedAt: daysAgo(200), lastConfirmedAt: daysAgo(5), lastConfirmedBy: "u2", lastConfirmedByName: "Woody Bruce", confirmedHow: "call" }, TODAY);
    assert.equal(r.state, "live");
    assert.equal(r.importOnly, true);
    assert.equal(r.dateLabel, "confirmed 7 Nov by Woody");
  });

  it("puts BGP's own unconfirmed rows in To confirm for 12 months, then Background, and never Live", () => {
    const recent = requirementLive({ status: "Active", sources: null, requirementDate: "2026-11-10", createdAt: daysAgo(2), updatedAt: daysAgo(2) }, TODAY);
    assert.equal(recent.state, "to_confirm");
    assert.equal(recent.dateLabel, "dated 10 Nov");
    const edited = requirementLive({ status: "Active", sources: [], updatedAt: new Date("2026-08-04T09:00:00Z"), createdAt: new Date("2024-01-01T00:00:00Z") }, TODAY);
    assert.equal(edited.state, "to_confirm");
    assert.equal(edited.dateLabel, "last edited 4 Aug");
    const old = requirementLive({ status: "Active", requirementDate: "03/02/2024", updatedAt: daysAgo(1) }, TODAY);
    assert.equal(old.state, "background");
    assert.equal(old.dateLabel, "dated 3 Feb 2024");
    const undated = requirementLive({ status: "Active", requirementDate: "soon" }, TODAY);
    assert.equal(undated.state, "to_confirm");
    assert.equal(undated.dateLabel, "no date");
    assert.equal(undated.days, null);
  });

  it("a hand-made row PIPnet has also listed is not import-only", () => {
    assert.equal(requirementIsImportOnly({ origin: "bgp", sources: ["PIPnet"] }), false);
    assert.equal(requirementIsImportOnly({ sources: ["Viewing"] }), false);
    assert.equal(requirementIsImportOnly({ sources: ["PIPnet", "TRL"] }), true);
    assert.equal(requirementIsImportOnly({ sources: ["PIPnet", "Viewing"] }), false);
    assert.equal(requirementIsImportOnly({ sources: [] }), false);
  });

  it("handles every status the table holds today", () => {
    assert.equal(requirementLive(confirmedBy(1, { status: "Past" }), TODAY).state, "closed");
    assert.equal(requirementLive(confirmedBy(1, { status: "Archived" }), TODAY).state, "closed");
    assert.equal(requirementLive(confirmedBy(1, { status: "Completed" }), TODAY).state, "closed");
    assert.equal(requirementLive(confirmedBy(1, { status: "Cancelled" }), TODAY).state, "closed");
    assert.equal(requirementLive(confirmedBy(1, { status: "On Hold" }), TODAY).state, "background");
    assert.equal(requirementLive(confirmedBy(1, { status: "Draft" }), TODAY).state, "to_confirm");
    assert.equal(requirementLive({ status: "Draft", sources: ["Viewing"], requirementDate: "2020-01-01" }, TODAY).state, "to_confirm");
    assert.equal(requirementLive(confirmedBy(1, { status: " active " }), TODAY).state, "live");
  });

  it("labels a press story a person confirmed as press-reported", () => {
    const r = requirementLive(confirmedBy(2, { confirmedHow: "press" }), TODAY);
    assert.equal(r.state, "live");
    assert.equal(r.pressReported, true);
    assert.equal(r.dateKind, "press");
    assert.equal(r.dateLabel, "press-reported, logged 10 Nov by Emily");
  });
});

describe("parseRequirementDate", () => {
  it("reads ISO and UK dates and nothing else", () => {
    assert.equal(parseRequirementDate("2026-09-03")?.toISOString(), "2026-09-03T00:00:00.000Z");
    assert.equal(parseRequirementDate("2026-09-03T10:00:00Z")?.toISOString(), "2026-09-03T00:00:00.000Z");
    assert.equal(parseRequirementDate("3/9/2026")?.toISOString(), "2026-09-03T00:00:00.000Z");
    assert.equal(parseRequirementDate("03/09/2026")?.toISOString(), "2026-09-03T00:00:00.000Z");
    assert.equal(parseRequirementDate("2026-02-31")?.toISOString(), "2026-03-03T00:00:00.000Z");
    assert.equal(parseRequirementDate("Q3 2026"), null);
    assert.equal(parseRequirementDate("September 2026"), null);
    assert.equal(parseRequirementDate(""), null);
    assert.equal(parseRequirementDate(null), null);
  });
});

describe("requirementStateSql", () => {
  it("carries the same windows, statuses and import labels as the function", () => {
    const sql = requirementStateSql("r");
    assert.ok(sql.includes(`interval '${REQUIREMENT_LIVE_DAYS} days'`));
    assert.ok(sql.includes(`interval '${REQUIREMENT_TO_CONFIRM_DAYS} days'`));
    for (const s of ["'past'", "'archived'", "'draft'", "'on hold'", "'pipnet'", "'trl'", "'the requirement list'"]) assert.ok(sql.includes(s), s);
    assert.ok(sql.includes("r.last_confirmed_at") && sql.includes("r.last_confirmed_by") && sql.includes("r.requirement_date"));
    assert.equal((sql.match(/\(/g) || []).length, (sql.match(/\)/g) || []).length);
    assert.equal((sql.match(/\bCASE\b/g) || []).length, (sql.match(/\bEND\b/g) || []).length);
  });

  it("takes any alias, or none, and a placeholder for today", () => {
    assert.ok(requirementStateSql("rl").includes("rl.status"));
    assert.ok(!requirementStateSql("").includes(".status"));
    assert.ok(requirementStateSql("r", "$1").includes("($1)::timestamp"));
    assert.ok(requirementIsLiveSql("r").endsWith("= 'live'"));
  });
});

describe("imports and hand-made rows", () => {
  const sighting = (listedAt: Date | null, seenAt = TODAY) => ({ source: "PIPnet" as const, externalId: "ext-1", listedAt, seenAt });

  it("stamps a new import row as that import's, listed, and never confirmed", () => {
    const u = requirementListingUpdates(null, sighting(new Date("2026-09-03T00:00:00Z")));
    assert.deepEqual(u, { origin: "pipnet", externalRequirementId: "ext-1", lastListedAt: new Date("2026-09-03T00:00:00Z"), lastListedSource: "PIPnet" });
    assert.equal(requirementListingUpdates(null, { source: "TRL", externalId: "e", listedAt: null, seenAt: TODAY }).origin, "trl");
    const r = requirementLive({ status: "Active", sources: ["PIPnet"], ...u }, TODAY);
    assert.equal(r.state, "background");
    assert.equal(r.confirmed, false);
  });

  it("dates a listing that carries no date by the day the import saw it", () => {
    assert.deepEqual(requirementListingUpdates(null, sighting(null)).lastListedAt, TODAY);
  });

  it("moves the last-listed date forward only, and links the import row", () => {
    const row = { status: "Active", origin: "pipnet", externalRequirementId: "ext-1", lastListedAt: new Date("2026-09-03T00:00:00Z") };
    assert.deepEqual(requirementListingUpdates(row, sighting(new Date("2026-08-01T00:00:00Z"))), {});
    assert.deepEqual(requirementListingUpdates(row, sighting(new Date("2026-09-03T00:00:00Z"))), {});
    assert.deepEqual(requirementListingUpdates(row, sighting(new Date("2026-10-20T00:00:00Z"))), { lastListedAt: new Date("2026-10-20T00:00:00Z"), lastListedSource: "PIPnet" });
    assert.deepEqual(requirementListingUpdates({ status: "Active" }, sighting(new Date("2026-10-20T00:00:00Z"))),
      { externalRequirementId: "ext-1", lastListedAt: new Date("2026-10-20T00:00:00Z"), lastListedSource: "PIPnet" });
  });

  it("leaves a closed row alone, and never writes a confirmation or changes whose record it is", () => {
    assert.deepEqual(requirementListingUpdates({ status: "Past" }, sighting(daysAgo(1))), {});
    assert.deepEqual(requirementListingUpdates({ status: "Archived" }, sighting(daysAgo(1))), {});
    const u = requirementListingUpdates({ status: "Active", origin: "bgp" }, sighting(daysAgo(1)));
    for (const k of ["origin", "lastConfirmedAt", "lastConfirmedBy", "lastConfirmedByName", "confirmedHow"]) assert.ok(!(k in u), k);
  });

  it("does not label BGP's own row with an import's name", () => {
    assert.equal(importMayLabel({ origin: "bgp" }), false);
    assert.equal(importMayLabel({ origin: null }), true);
    assert.equal(importMayLabel({ origin: "trl" }), true);
  });

  it("a hand-made row is BGP's own, confirmed by its creator, and live", () => {
    const stamp = bgpCreatedStamp({ id: "u9", name: "Emily Carter" }, "created", TODAY);
    assert.deepEqual(stamp, { origin: "bgp", lastConfirmedAt: TODAY, lastConfirmedBy: "u9", lastConfirmedByName: "Emily Carter", confirmedHow: "created" });
    const r = requirementLive({ status: "Active", ...stamp }, TODAY);
    assert.equal(r.state, "live");
    assert.equal(r.dateLabel, "confirmed 12 Nov by Emily");
  });

  it("a request body cannot set who confirmed a requirement or where it came from", () => {
    const body = { name: "Pret", status: "Active", lastConfirmedAt: "2026-11-12", lastConfirmedBy: "x", lastConfirmedByName: "X", confirmedHow: "call", origin: "bgp", externalRequirementId: "e", lastListedAt: "2026-01-01", lastListedSource: "PIPnet" };
    assert.deepEqual(stripRequirementProvenance(body), { name: "Pret", status: "Active" });
    assert.equal(body.origin, "bgp");
  });
});

describe("the Requirements page's lists", () => {
  it("is going stale only in the last 14 days of the 90", () => {
    const edge = REQUIREMENT_LIVE_DAYS - REQUIREMENT_GOING_STALE_DAYS;
    assert.equal(requirementGoingStale(requirementLive(confirmedBy(edge - 1), TODAY)), false);
    assert.equal(requirementGoingStale(requirementLive(confirmedBy(edge), TODAY)), true);
    assert.equal(requirementDaysLeft(requirementLive(confirmedBy(edge), TODAY)), REQUIREMENT_GOING_STALE_DAYS);
    assert.equal(requirementGoingStale(requirementLive(confirmedBy(REQUIREMENT_LIVE_DAYS), TODAY)), true);
    assert.equal(requirementDaysLeft(requirementLive(confirmedBy(REQUIREMENT_LIVE_DAYS), TODAY)), 0);
    const lapsed = requirementLive(confirmedBy(REQUIREMENT_LIVE_DAYS + 1), TODAY);
    assert.equal(requirementGoingStale(lapsed), false);
    assert.equal(requirementDaysLeft(lapsed), null);
    assert.equal(requirementGoingStale(requirementLive({ status: "Draft", origin: "bgp" }, TODAY)), false);
  });

  it("puts every row on exactly one list", () => {
    const list = (row: Record<string, any>) => requirementListKey(requirementLive(row, TODAY));
    assert.equal(list(confirmedBy(1)), "live");
    assert.equal(list(confirmedBy(120)), "to_confirm");
    assert.equal(list({ status: "Draft", origin: "bgp" }), "to_confirm");
    assert.equal(list({ status: "Active", origin: "bgp", createdAt: daysAgo(10) }), "to_confirm");
    assert.equal(list({ status: "Active", origin: "pipnet", lastListedAt: daysAgo(5) }), "market");
    assert.equal(list({ status: "Active", sources: ["TRL"] }), "market");
    assert.equal(list({ status: "Active", origin: "bgp", createdAt: daysAgo(500), updatedAt: daysAgo(500) }), "older");
    assert.equal(list({ status: "On hold", origin: "bgp" }), "older");
    assert.equal(list(confirmedBy(1, { origin: "pipnet" })), "live");
    assert.equal(list(confirmedBy(1, { status: "Past" })), "closed");
    assert.equal(list({ status: "Archived", origin: "trl" }), "closed");
  });

  it("keeps the owner list and the single owner id in step", () => {
    assert.deepEqual(requirementOwnerColumns({ name: "Pret", bgpContactUserIds: ["u2", "u1", "u2", ""] }), { name: "Pret", bgpContactUserIds: ["u2", "u1"], bgpContactUserId: "u2" });
    assert.deepEqual(requirementOwnerColumns({ bgpContactUserIds: [], bgpContactUserId: "stale" }), { bgpContactUserIds: null, bgpContactUserId: null });
    assert.deepEqual(requirementOwnerColumns({ bgpContactUserIds: null }), { bgpContactUserIds: null, bgpContactUserId: null });
    assert.deepEqual(requirementOwnerColumns({ bgpContactUserId: "u7" }), { bgpContactUserId: "u7", bgpContactUserIds: ["u7"] });
    assert.deepEqual(requirementOwnerColumns({ bgpContactUserId: null }), { bgpContactUserId: null, bgpContactUserIds: null });
    assert.deepEqual(requirementOwnerColumns({ comments: "x" }), { comments: "x" });
  });

  it("names where a row came from, whose record first", () => {
    assert.deepEqual(requirementSourceLabels({ origin: "bgp", sources: ["ChatBGP"] }), ["BGP", "ChatBGP"]);
    assert.deepEqual(requirementSourceLabels({ origin: "pipnet", sources: ["PIPnet"] }), ["PIPnet"]);
    assert.deepEqual(requirementSourceLabels({ origin: "trl", sources: ["TRL", "PIPnet"] }), ["The Requirement List", "PIPnet"]);
    assert.deepEqual(requirementSourceLabels({ origin: null, sources: ["Monday", "TRL"] }), ["Monday", "The Requirement List"]);
    assert.deepEqual(requirementSourceLabels({ origin: "bgp", sources: null }), ["BGP"]);
    assert.deepEqual(requirementSourceLabels({ sources: [] }), ["Not recorded"]);
  });
});

describe("what a client login is sent", () => {
  it("drops who confirmed, the BGP owner and the last-edit time, and keeps the listing", () => {
    const row = {
      id: "r1", name: "Pret", sources: ["PIPnet"], requirementDate: "2026-09-03", size: ["1,000 - 2,000 sq ft"],
      lastConfirmedAt: TODAY, lastConfirmedBy: "u1", lastConfirmedByName: "Emily Carter", confirmedHow: "call", origin: "pipnet",
      externalRequirementId: "x1", lastListedAt: daysAgo(70), lastListedSource: "PIPnet",
      bgpContactUserId: "u1", bgpContactUserIds: ["u1"], updatedAt: TODAY,
      last_confirmed_at: TODAY, bgp_contact_user_id: "u1", bgp_contact_user_ids: ["u1"], updated_at: TODAY,
    };
    assert.deepEqual(requirementClientCopy(row), { id: "r1", name: "Pret", sources: ["PIPnet"], requirementDate: "2026-09-03", size: ["1,000 - 2,000 sq ft"] });
    assert.equal(row.bgpContactUserId, "u1", "the row itself is not changed");
  });

  it("marks a press-only requirement so no screen badges it as confirmed", () => {
    assert.equal(requirementReason(confirmedBy(1, { confirmedHow: "press" }), TODAY).pressReported, true);
    assert.equal(requirementReason(confirmedBy(1, { confirmedHow: "call" }), TODAY).pressReported, false);
    assert.equal(requirementReason({ status: "Active", origin: "pipnet" }, TODAY).pressReported, false);
  });
});

