/**
 * instagram-card-state.test.ts — Delivery 4 Task 4: explicit Instagram card
 * states + tenant-only feed eligibility.
 *
 * Pure helpers, no database. Covers the full state matrix
 * (not_configured / no_handle / feed_error / handle_only / feed-empty /
 * feed), lastSyncedAt passthrough, externalUrl whenever a handle exists, and
 * isFeedEligibleCompany: tenants eligible, landlord-shaped and other types
 * never eligible (Instagram removed from landlord boards, Woody 2026-09-21).
 *
 * Run with: node --import tsx --test server/instagram-card-state.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { instagramCardState, isFeedEligibleCompany } from "./instagram-card-state";

describe("instagramCardState", () => {
  it("no handle → no_handle, no externalUrl, regardless of everything else", () => {
    const s = instagramCardState({ configured: false, handle: null, hasFeedSource: false, lastSyncedAt: null, failure: null });
    assert.equal(s.status, "no_handle");
    assert.equal(s.externalUrl, null);
  });

  it("handle + unconfigured feed service → not_configured (never pretends quiet)", () => {
    const s = instagramCardState({ configured: false, handle: "hammersonplc", hasFeedSource: false, lastSyncedAt: null, failure: null });
    assert.equal(s.status, "not_configured");
    assert.equal(s.externalUrl, "https://instagram.com/hammersonplc");
  });

  it("unconfigured wins over a recorded failure — the provider was never reachable", () => {
    const s = instagramCardState({ configured: false, handle: "hammersonplc", hasFeedSource: false, lastSyncedAt: null, failure: { attempts: 3, lastError: "boom" } });
    assert.equal(s.status, "not_configured");
  });

  it("not_configured takes precedence even when a feed source exists — credentials were removed after creation", () => {
    const s = instagramCardState({ configured: false, handle: "hammersonplc", hasFeedSource: true, lastSyncedAt: "2026-09-01T10:00:00Z", failure: null });
    assert.equal(s.status, "not_configured");
  });

  it("no feed + recorded provider failure → feed_error with the specific reason", () => {
    const s = instagramCardState({ configured: true, handle: "deadaccount", hasFeedSource: false, lastSyncedAt: null, failure: { attempts: 3, lastError: "RSS.app: source URL not supported" } });
    assert.equal(s.status, "feed_error");
    assert.equal(s.error, "RSS.app: source URL not supported");
    assert.equal(s.attempts, 3);
    assert.equal(s.externalUrl, "https://instagram.com/deadaccount");
  });

  it("no feed, no failure → handle_only (not connected)", () => {
    const s = instagramCardState({ configured: true, handle: "hammersonplc", hasFeedSource: false, lastSyncedAt: null, failure: null });
    assert.equal(s.status, "handle_only");
    assert.equal(s.lastSyncedAt, null);
    assert.equal(s.error, null);
  });

  it("feed passes lastSyncedAt through; connected-but-empty keeps null", () => {
    const fed = instagramCardState({ configured: true, handle: "hammersonplc", hasFeedSource: true, lastSyncedAt: "2026-09-15T08:30:00Z", failure: null });
    assert.equal(fed.status, "feed");
    assert.equal(fed.lastSyncedAt, "2026-09-15T08:30:00Z");

    const empty = instagramCardState({ configured: true, handle: "hammersonplc", hasFeedSource: true, lastSyncedAt: null, failure: null });
    assert.equal(empty.status, "feed");
    assert.equal(empty.lastSyncedAt, null);
  });
});

describe("isFeedEligibleCompany", () => {
  it("tenant types stay eligible exactly as before, verified or not", () => {
    assert.equal(isFeedEligibleCompany("Tenant", false), true);
    assert.equal(isFeedEligibleCompany("tenant", false), true);
    assert.equal(isFeedEligibleCompany("Tenant (Retail)", false), true);
    assert.equal(isFeedEligibleCompany("Tenant", true), true);
  });

  it("landlord vocabulary is never eligible, verified or not", () => {
    for (const t of ["Landlord", "Landlord/Freeholder", "Investor", "REIT", "Developer", "Fund"]) {
      assert.equal(isFeedEligibleCompany(t, true), false, `${t} verified should not be eligible`);
      assert.equal(isFeedEligibleCompany(t, false), false, `${t} unverified should not be eligible`);
    }
  });

  it("tenant-typed rows are never treated as landlords (no verification needed)", () => {
    assert.equal(isFeedEligibleCompany("tenant", false), true);
  });

  it("other / empty types are never eligible", () => {
    assert.equal(isFeedEligibleCompany(null, true), false);
    assert.equal(isFeedEligibleCompany("", true), false);
    assert.equal(isFeedEligibleCompany("Agent", true), false);
    assert.equal(isFeedEligibleCompany("Supplier", true), false);
  });
});
