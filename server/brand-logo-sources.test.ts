/**
 * brand-logo-sources.test.ts — Delivery 4 Task 1: the official-logo fallback.
 *
 * Pure decision logic only (no database, no network): the candidate plan
 * ordering — existing/manual logo always wins; the scraper's official
 * finding is preferred over logo.dev; the website scrape is the tail —
 * and the "checked official logo" download contract.
 *
 * Run with: node --import tsx --test server/brand-logo-sources.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planLogoSources, isCheckedLogoDownload, LOGO_MIN_BYTES, LOGO_MAX_BYTES } from "./brand-logo-sources";

describe("planLogoSources", () => {
  it("an existing publishable logo short-circuits everything (manual choice preserved)", () => {
    assert.deepEqual(planLogoSources({
      hasExistingPublishable: true,
      findingsLogoUrl: "https://example.com/logo.png",
      logoDevConfigured: true,
      domain: "example.com",
    }), ["existing"]);
  });

  it("prefers the scraper's official finding over logo.dev", () => {
    assert.deepEqual(planLogoSources({
      hasExistingPublishable: false,
      findingsLogoUrl: "https://example.com/logo.png",
      logoDevConfigured: true,
      domain: "example.com",
    }), ["findings", "logo_dev", "website_scrape"]);
  });

  it("falls back to the website scrape when logo.dev is not configured", () => {
    assert.deepEqual(planLogoSources({
      hasExistingPublishable: false,
      findingsLogoUrl: null,
      logoDevConfigured: false,
      domain: "example.com",
    }), ["website_scrape"]);
  });

  it("keeps the website scrape as the tail behind logo.dev (the logo.dev-miss fallback)", () => {
    assert.deepEqual(planLogoSources({
      hasExistingPublishable: false,
      findingsLogoUrl: "",
      logoDevConfigured: true,
      domain: "example.com",
    }), ["logo_dev", "website_scrape"]);
  });

  it("drops every step whose input is absent", () => {
    assert.deepEqual(planLogoSources({
      hasExistingPublishable: false,
      findingsLogoUrl: "  ",
      logoDevConfigured: false,
      domain: null,
    }), []);
  });
});

describe("isCheckedLogoDownload", () => {
  it("accepts a real image download", () => {
    assert.deepEqual(isCheckedLogoDownload({ status: 200, mime: "image/png", bytes: 4096 }), { ok: true });
  });

  it("rejects non-200 responses (incl. the 404-while-preparing case)", () => {
    assert.equal(isCheckedLogoDownload({ status: 404, mime: "image/png", bytes: 4096 }).ok, false);
    assert.equal(isCheckedLogoDownload({ status: 502, mime: "image/png", bytes: 4096 }).ok, false);
  });

  it("rejects non-image content types", () => {
    assert.equal(isCheckedLogoDownload({ status: 200, mime: "text/html", bytes: 4096 }).ok, false);
    assert.equal(isCheckedLogoDownload({ status: 200, mime: null, bytes: 4096 }).ok, false);
  });

  it("rejects tracker-sized and oversized payloads", () => {
    assert.equal(isCheckedLogoDownload({ status: 200, mime: "image/png", bytes: LOGO_MIN_BYTES - 1 }).ok, false);
    assert.equal(isCheckedLogoDownload({ status: 200, mime: "image/png", bytes: LOGO_MIN_BYTES }).ok, true);
    assert.equal(isCheckedLogoDownload({ status: 200, mime: "image/png", bytes: LOGO_MAX_BYTES + 1 }).ok, false);
  });
});
