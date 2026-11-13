/**
 * brand-page-requests.test.ts — what a brand's page asks for when it opens.
 *
 * A brand page used to download the whole company list (62 MB on the live
 * data), the whole deals list and the whole properties list on every open and
 * again every 30 seconds, and the saved-cache writer then tried, and failed,
 * to store them. The rules that stop that:
 *   - the profile panel reads company names from a five-field lookup, under
 *     its own key, never the whole list;
 *   - the company page asks for the firm-wide lists only when a block that
 *     reads them can be drawn;
 *   - a long list is never written to the saved cache.
 * Who may read which company is decided in the list route as before
 * (qa/regression/company-list-columns.test.mjs).
 *
 * Run with: node --import tsx --test server/brand-page-requests.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCompanyListFields } from "./company-list-columns";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("the saved cache", () => {
  it("leaves a long list out and keeps everything else", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, String(value)),
      removeItem: (key: string) => void values.delete(key),
    };
    Object.assign(globalThis, { window: { localStorage: storage } });
    const { persistOptions } = await import("../client/src/lib/query-persist");
    assert.ok(persistOptions);
    const keep = persistOptions.dehydrateOptions!.shouldDehydrateQuery!;
    const query = (queryKey: unknown[], data: unknown, meta?: Record<string, unknown>) =>
      ({ queryKey, meta, state: { status: "success", data } }) as any;
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }));

    assert.equal(keep(query(["/api/crm/companies"], rows(5541))), false);
    assert.equal(keep(query(["/api/crm/deals"], rows(501))), false);
    assert.equal(keep(query(["/api/crm/properties"], rows(500))), true);
    assert.equal(keep(query(["/api/brand", "id", "profile"], { company: { id: "id" }, stores: rows(900) })), true);
    assert.equal(keep(query(["/api/auth/me"], { id: "A" })), true);
    // The two rules that were already there.
    assert.equal(keep(query(["/api/auth/me"], null)), false);
    assert.equal(keep(query(["/api/plans", "id", "image"], {}, { persist: false })), false);
  });
});

describe("the brand profile panel's company lookup", () => {
  const panel = source("client/src/components/brand-profile-panel.tsx");

  it("names five real list fields", () => {
    const asked = panel.match(/\/api\/crm\/companies\?fields=([A-Za-z,]+)/);
    assert.ok(asked, "the panel asks the list for named fields");
    const fields = asked![1].split(",");
    assert.deepEqual(fields, ["id", "name", "companyType", "domain", "domainUrl"]);
    // A name the list does not know is dropped without a word: all five must be real.
    assert.deepEqual(parseCompanyListFields(asked![1]), fields);
  });

  it("never asks for the whole company list", () => {
    assert.doesNotMatch(panel, /useQuery[^;]*?queryKey: \["\/api\/crm\/companies"\]\s*,/s);
    assert.match(panel, /queryKey: \["\/api\/crm\/companies", "name-lookup"\]/);
  });

  it("waits, on a brand's page, for something that reads it", () => {
    assert.match(panel, /enabled: !landsecRestricted && \(pillLookup\("intel"\) \|\| aboutOpen \|\| !!addRep\)/);
    assert.match(panel, /queryKey: \["\/api\/investment-tracker"\], enabled: staffForSale && pillLookup\("relationship"\)/);
  });

  it("offers to create a company only once the lookup has answered", () => {
    assert.match(panel, /\{!crmRow && lookupReady && \(\s*<CreateCompetitorInCrmButton/);
    assert.match(panel, /\{!isClientViewer && companyLookupReady && \(\s*<button[\s\S]{0,120}?createBackerMutation\.mutate/);
  });

  it("tells the page it is a brand's page only once the profile is in", () => {
    assert.match(panel, /useEffect\(\(\) => \{ if \(profileIn\) reportBrandTop\?\.\(brandTop\); \}, \[profileIn, brandTop, reportBrandTop\]\)/);
  });
});

describe("the company page's firm-wide lists", () => {
  const page = source("client/src/pages/companies.tsx");
  const enabledFor = (key: string) => {
    const at = page.indexOf(`queryKey: ["${key}"],\n    enabled:`);
    assert.ok(at > 0, `${key} is asked for with a condition`);
    return page.slice(at, page.indexOf("\n", page.indexOf("enabled:", at)));
  };

  it("are asked for only when their block can be drawn", () => {
    assert.match(page, /const legacyBlocks = !isMobile && !!company && !usePropertiesBoard;/);
    assert.match(page, /const otherDealsDrawn = legacyBlocks && !brandHeader;/);
    assert.match(page, /const linkedPropertiesDrawn = legacyBlocks && companyPropertyLinks\.some\(l => l\.companyId === id\);/);
    assert.match(enabledFor("/api/crm/deals"), /enabled: !landsecRestricted && otherDealsDrawn,/);
    assert.match(enabledFor("/api/crm/properties"), /enabled: !landsecRestricted && \(otherDealsDrawn \|\| linkedPropertiesDrawn\),/);
    assert.match(enabledFor("/api/crm/company-deal-links"), /enabled: !isClientViewer && otherDealsDrawn,/);
    assert.match(enabledFor("/api/crm/property-agents"), /enabled: !landsecRestricted && linkedPropertiesDrawn,/);
    assert.match(enabledFor("/api/crm/company-property-links"), /enabled: !landsecRestricted && !isMobile,/);
  });

  it("draws Other deals under the same condition it asks for them under", () => {
    assert.match(page, /\{!usePropertiesBoard && !brandHeader && propertiesWithDeals\.unlinkedDeals\.length > 0 && \(/);
  });
});
