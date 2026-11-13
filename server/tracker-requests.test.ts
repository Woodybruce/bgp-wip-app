/**
 * tracker-requests.test.ts — what the Letting Tracker asks for when it opens.
 *
 * On the live data the tracker downloaded the whole company list twice (about
 * 60 MB each), the whole contacts list (7 MB) and three count reads whose
 * numbers it already held, and drew its table again as each read landed. The
 * rules that stop that:
 *   - company names come from a five-field lookup under its own key, and the
 *     row pickers share a second five-field list: never the whole list;
 *   - the contacts list and the legacy unit list are asked for when the
 *     dialog that reads them opens;
 *   - the per-unit counts are counted from the three lists on the page;
 *   - the table is drawn once its four first reads have answered, and the
 *     Deals hub asks for those four while the tracker's code loads.
 * Who may read which company is decided in the list route as before
 * (qa/regression/company-list-columns.test.mjs runs both field lists through
 * it as a client login).
 *
 * Run with: node --import tsx --test server/tracker-requests.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPANY_LIST_HEAVY_COLUMNS, parseCompanyListFields } from "./company-list-columns";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tracker = source("client/src/pages/available-units.tsx");
const picker = source("client/src/components/brand-search-input.tsx");
const reads = source("client/src/lib/tracker-reads.ts");
const hub = source("client/src/pages/deals-hub.tsx");

// The field list a URL constant in a source file asks the company list for.
function fieldsOf(file: string, constant: string): string[] {
  const asked = file.match(new RegExp(`const ${constant} = "/api/crm/companies\\?fields=([A-Za-z,]+)"`));
  assert.ok(asked, `${constant} asks the list for named fields`);
  const fields = asked![1].split(",");
  // A name the list does not know is dropped without a word: every one must be real.
  assert.deepEqual(parseCompanyListFields(asked![1]), fields);
  for (const field of fields) assert.equal((COMPANY_LIST_HEAVY_COLUMNS as readonly string[]).includes(field), false, field);
  return fields;
}

describe("the tracker's company names", () => {
  it("come from five real list fields, under the tracker's own key", () => {
    assert.deepEqual(fieldsOf(reads, "TRACKER_COMPANIES_URL"), ["id", "name", "companyType", "ukEntityName", "domainUrl"]);
    // The key starts with the list's, so every "a company changed" refresh reaches it.
    assert.match(reads, /queryKey: \["\/api\/crm\/companies", "tracker-lookup"\] as const,\s*queryFn: async \(\) => \(await apiRequest\("GET", TRACKER_COMPANIES_URL\)\)\.json\(\),/);
    assert.match(tracker, /useQuery<TrackerCompany\[\]>\(trackerCompaniesQuery\)/);
    assert.match(tracker, /type TrackerCompany = Pick<CrmCompany, "id" \| "name" \| "companyType" \| "ukEntityName" \| "domainUrl">;/);
  });

  it("never ask for the whole company list", () => {
    assert.doesNotMatch(tracker, /queryKey: \["\/api\/crm\/companies"\]\s*,\s*\}\)/);
    assert.doesNotMatch(tracker, /useQuery<CrmCompany\[\]>/);
  });
});

describe("the basic company list the pickers share", () => {
  it("is five real fields, the ones its six readers map", () => {
    assert.deepEqual(fieldsOf(picker.replace("export const", "const"), "COMPANIES_BASIC_URL"), ["id", "name", "companyType", "ukEntityName", "tradingEntities"]);
  });

  it("is what every reader of that cache key fetches", () => {
    const readers = [
      "client/src/components/brand-search-input.tsx",
      "client/src/components/property-schemes-panel.tsx",
      "client/src/components/PropertyTenancySchedule.tsx",
      "client/src/pages/leasing-schedule.tsx",
    ];
    let fetches = 0;
    for (const path of readers) {
      const file = source(path);
      assert.doesNotMatch(file, /\/api\/crm\/companies\?limit=/, path);
      const keys = file.match(/queryKey: \["\/api\/crm\/companies-basic"\],\s*queryFn: async \(\) => \{\s*const \w+ = await fetch\(COMPANIES_BASIC_URL,/g) || [];
      assert.equal(keys.length, (file.match(/queryKey: \["\/api\/crm\/companies-basic"\],/g) || []).length, path);
      fetches += keys.length;
    }
    assert.equal(fetches, 6);
  });
});

describe("the lists only a dialog reads", () => {
  it("contacts wait for the Viewings or Offers dialog", () => {
    assert.match(tracker, /queryKey: \["\/api\/crm\/contacts"\],\s*enabled: !!viewingsUnit \|\| !!offersUnit,/);
  });

  it("the legacy unit list waits for the Add Unit or Edit Unit form, and is never asked for by a client", () => {
    assert.match(tracker, /queryKey: \["\/api\/property-units"\],\s*enabled: !isClientTracker && \(createOpen \|\| !!editItem\),/);
  });
});

describe("the per-unit counts", () => {
  it("are counted from the lists on the page, not asked for again", () => {
    assert.doesNotMatch(tracker, /useQuery[^;]*?queryKey: \["\/api\/available-units\/all-(interest|viewings|offers)-counts"\]/s);
    assert.match(tracker, /const interestCounts = useMemo\(\(\) => countsByUnit\(interestByUnit\), \[interestByUnit\]\);/);
    assert.match(tracker, /const viewingsCounts = useMemo\(\(\) => countsByUnit\(viewingsByUnit\), \[viewingsByUnit\]\);/);
    assert.match(tracker, /const offersCounts = useMemo\(\(\) => countsByUnit\(offersByUnit\), \[offersByUnit\]\);/);
  });

  it("count the rows the server's count reads count", () => {
    // The count reads and the lists must keep the same row rules, or a count
    // on the tracker would differ from the same count on the Properties page.
    const routes = source("server/routes.ts");
    const between = (from: string, to: string) => routes.slice(routes.indexOf(from), routes.indexOf(to, routes.indexOf(from) + from.length));
    const viewingCounts = between('app.get("/api/available-units/all-viewings-counts"', "app.get(");
    const viewingList = between('app.get("/api/available-units/all-viewings"', "app.get(");
    for (const block of [viewingCounts, viewingList]) {
      assert.match(block, /v\.deleted_at IS NULL AND v\.status IN \('scheduled','completed'\)/);
      assert.match(block, /p\.landlord_id = \$\{scope\} OR EXISTS \(SELECT 1 FROM crm_company_properties cp WHERE cp\.property_id = p\.id AND cp\.company_id = \$\{scope\}\)/);
    }
    assert.match(viewingCounts, /deleted_at IS NULL AND unit_id IS NOT NULL AND status IN \('scheduled','completed'\)/);
    assert.match(viewingList, /isNull\(unitViewings\.deletedAt\), sql`\$\{unitViewings\.unitId\} IS NOT NULL`, inArray\(unitViewings\.status, \["scheduled", "completed"\]\)/);
    const offerCounts = between('app.get("/api/available-units/all-offers-counts"', "app.get(");
    const offerList = between('app.get("/api/available-units/all-offers"', "app.get(");
    for (const block of [offerCounts, offerList]) {
      assert.match(block, /WHERE p\.landlord_id = \$\{scope\} OR EXISTS \(SELECT 1 FROM crm_company_properties cp WHERE cp\.property_id = p\.id AND cp\.company_id = \$\{scope\}\)/);
    }
    assert.match(offerCounts, /FROM unit_offers GROUP BY unit_id`/);
    assert.match(offerList, /db\.select\(\)\.from\(unitOffers\)\.orderBy\(unitOffers\.offerDate\)/);
    const interestCounts = between('app.get("/api/available-units/all-interest-counts"', "app.get(");
    const interestList = between('app.get("/api/available-units/all-interest"', "async function interestCaller");
    for (const block of [interestCounts, interestList]) {
      assert.match(block, /LEFT JOIN crm_company_properties cp ON cp\.property_id = p\.id AND cp\.company_id = \$\{scope\}\s+WHERE p\.landlord_id = \$\{scope\} OR cp\.company_id IS NOT NULL/);
    }
    assert.match(interestCounts, /FROM unit_interest GROUP BY unit_id`/);
    assert.match(interestList, /db\.select\(\)\.from\(unitInterest\)\.orderBy\(unitInterest\.interestDate\)/);
  });
});

describe("the first draw of the table", () => {
  it("waits for units, properties, deals and briefs, and for nothing else", () => {
    assert.match(tracker, /const firstLoad = isLoading \|\| propertiesLoading \|\| dealsLoading \|\| briefsLoading;/);
    assert.match(tracker, /if \(firstLoad\) \{\s*return \(\s*<div className="p-6 space-y-4">\s*<Skeleton/);
  });

  it("is fed by reads the Deals hub starts, under the tracker's own keys", () => {
    const listed = (name: string) => {
      const block = reads.match(new RegExp(`export const ${name} = \\[([^\\]]+)\\] as const;`));
      assert.ok(block, name);
      return Array.from(block![1].matchAll(/"([^"]+)"/g), m => m[1]);
    };
    assert.deepEqual(listed("TRACKER_TABLE_READS"), ["/api/available-units", "/api/crm/deals", "/api/crm/properties", "/api/unit-briefs"]);
    const cells = listed("TRACKER_CELL_READS");
    assert.equal(cells.length, 6);
    // Every one is a read the tracker itself makes, for every login, when it
    // opens: the hub asks for nothing more.
    for (const key of [...listed("TRACKER_TABLE_READS"), ...cells]) {
      const asked = tracker.match(new RegExp(`queryKey: \\["${key}"\\](,|\\s*\\})[^;]{0,120}`));
      assert.ok(asked, `${key} is asked for by the tracker`);
      assert.doesNotMatch(asked![0], /enabled:/, `${key} is asked for unconditionally`);
    }
    assert.match(hub, /for \(const key of \[\.\.\.TRACKER_TABLE_READS, \.\.\.TRACKER_CELL_READS\]\) \{\s*void queryClient\.prefetchQuery\(\{ queryKey: \[key\] \}\);\s*\}\s*void queryClient\.prefetchQuery\(trackerCompaniesQuery\);/);
    // Only on the tracker's tab, once signed in, never for a login with no tracker here.
    assert.match(hub, /if \(tab !== "letting" \|\| isProfile \|\| !signedIn \|\| noTrackerHere\) return;/);
    assert.match(hub, /const noTrackerHere = useLandsecRestricted\(\);/);
    // The hub must not pull the tracker's page into its own download.
    assert.doesNotMatch(hub, /import [^;]*from "@\/pages\/available-units"/);
  });
});

describe("the row pick lists", () => {
  it("are built once per list, not once per row", () => {
    assert.match(tracker, /const propertyOptions = useMemo\(\(\) => properties\.map\(p => \(\{ id: p\.id, name: p\.name \}\)\), \[properties\]\);/);
    assert.match(tracker, /const companyOptions = useMemo\(\(\) => crmCompanies\.map\(c => \(\{ id: c\.id, name: c\.name \}\)\), \[crmCompanies\]\);/);
    assert.doesNotMatch(tracker, /(options|items)=\{(crmCompanies|properties)\.map\(\w+ => \(\{ id: \w+\.id, name: \w+\.name \}\)\)\}/);
  });
});
