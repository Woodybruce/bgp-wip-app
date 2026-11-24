// Folders on the remaining pages (Woody, 24 November 2026: "go ahead with the
// folder suggestion"; docs/folders-review-2026-11-20.md, step 5): a landlord's
// and a brand's company, each scheme, a Lease Advisory matter and a Pathway
// run show their Folders. The rules they share: the Lease Advisory template,
// which a new folder for a matter starts as; the one old address each of those
// records holds, shown read only until it is moved over; and the brand page's
// old place, BGP share drive/Companies, offered to the migration by name. Graph
// is a stand-in: nothing here calls Microsoft.
//   node --import tsx --test server/folders-pages.test.ts
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  COMPANIES_FOLDER_PATH, FOLDER_RECORD_TYPES, FOLDER_TEMPLATES, LEASE_ADVISORY_FOLDER_TEMPLATE, LEGACY_FOLDER_COLUMNS, LEGACY_RECORD_FOLDER,
  MIGRATION_COLUMNS, OLD_FOLDER_READERS, companyFolderKey, defaultFolderTemplate, folderTemplate, folderTemplatesInOrder, folderTreeOrder,
  folderTreePaths, legacyFolderKey, migrationRowId, safeFolderName, templateInsideWords,
} from "../shared/folders";
import { forgetLibrary, setGraphTransport, type GraphRequest, type GraphResponse } from "./folders/graph";
import { legacyFolders } from "./folders/links";
import { companiesPlaceRows } from "./folders/migration";

const DRIVE = "b!drive-1";
const SITE = "https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared%20Documents/BGP%20-%20Share%20Drive";
const ok = (body: any, extra: Partial<GraphResponse> = {}): GraphResponse => ({ status: 200, body, location: null, retryAfter: null, ...extra });

// ── The Lease Advisory template ─────────────────────────────────────────
test("the Lease Advisory folders are a template SharePoint takes, offered first for a Lease Advisory matter", () => {
  assert.deepEqual([...folderTemplate("lease_advisory")!], [...LEASE_ADVISORY_FOLDER_TEMPLATE]);
  const checked = folderTreePaths([...LEASE_ADVISORY_FOLDER_TEMPLATE]);
  assert.ok(!("problem" in checked), "every path is a name SharePoint takes, at most four deep, at most 80");
  if ("paths" in checked) {
    assert.equal(checked.paths.length, 20);
    assert.ok(checked.paths.every(parts => parts.length <= 2 && parts.every(p => safeFolderName(p) === p)));
    assert.equal(folderTreeOrder(checked.paths).length, 20, "every parent is in the list itself");
  }
  assert.deepEqual(LEASE_ADVISORY_FOLDER_TEMPLATE.filter(p => !p.includes("/")), ["Lease Documents", "Rent Review", "Lease Renewal", "Dilapidations", "Service Charge", "Correspondence", "Legal"]);
  // What a new folder for each record starts as.
  assert.deepEqual(FOLDER_RECORD_TYPES.map(t => [t, defaultFolderTemplate(t)]), [
    ["property", "property"], ["deal", "empty"], ["company", "empty"], ["scheme", "empty"], ["pla_matter", "lease_advisory"], ["pathway_run", "empty"],
  ]);
  // The picker lists the one it starts on first; the rest keep their order.
  assert.deepEqual(folderTemplatesInOrder("lease_advisory").map(t => t.key), ["lease_advisory", "empty", "property"]);
  assert.deepEqual(folderTemplatesInOrder("property").map(t => t.key), ["property", "empty", "lease_advisory"]);
  assert.deepEqual(folderTemplatesInOrder().map(t => t.key), FOLDER_TEMPLATES.map(t => t.key));
  assert.equal(templateInsideWords("empty"), "");
  assert.equal(templateInsideWords("property"), "01 Instructions & appointments, 02 Letting & marketing, 03 Tenancy schedules & units, 04 Property media, 99 Archive");
  assert.equal(templateInsideWords("lease_advisory"), "Lease Documents, Rent Review, Lease Renewal, Dilapidations, Service Charge, Correspondence, Legal, and the folders within them");
  // The templates keyed by retired team names stay retired.
  assert.equal(folderTemplate("Lease Advisory"), null);
});

// ── The one old address of a company, scheme, matter or run ─────────────
test("a company, scheme, Lease Advisory matter and Pathway run each show the one old address they hold, read only", async () => {
  const holds: Record<string, string | null> = {
    crm_companies: `${SITE}/Clients/Landsec`,
    property_schemes: `${SITE}/National/Canary%20Wharf/Jubilee%20Place`,
    pla_matters: "  https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared%20Documents/BGP%20share%20drive/Lease%20Advisory/Bluewater  ",
    property_pathway_runs: "BGP share drive/Investment/1 High Street",
  };
  const asked: string[] = [];
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      asked.push(sql);
      const table = /FROM (\w+) WHERE id = \$1/.exec(sql)?.[1];
      if (!table || params?.[0] !== "r1") return { rows: [] };
      return { rows: [{ url: holds[table] }] };
    },
  };
  for (const type of ["company", "scheme", "pla_matter", "pathway_run"] as const) {
    const old = LEGACY_RECORD_FOLDER[type]!;
    assert.ok(MIGRATION_COLUMNS.some(c => c.column === old.column && c.recordType === type), `${old.column} is a column the migration moves`);
    const shown = await legacyFolders(db, { type, id: "r1", name: "x" }, new Set());
    const [table] = old.column.split(".");
    if (type === "pathway_run") assert.deepEqual(shown, [], "a stored path is not an address: the migration reads it, Folders does not");
    else assert.deepEqual(shown, [{ column: old.column, key: "", label: "Linked folder", url: String(holds[table]).trim() }]);
  }
  assert.ok(asked.every(sql => /^SELECT sharepoint_folder_url AS url FROM (crm_companies|property_schemes|pla_matters|property_pathway_runs) WHERE id = \$1$/.test(sql)));
  // Moved over by a migration run: hidden.
  const moved = new Set([legacyFolderKey(LEGACY_FOLDER_COLUMNS.schemeFolder, "r1", "", holds.property_schemes!)]);
  assert.deepEqual(await legacyFolders(db, { type: "scheme", id: "r1", name: "Jubilee Place" }, moved), []);
  // A read that fails shows nothing old rather than failing the record's folders.
  const broken = { query: async () => { throw new Error("no such column"); } };
  assert.deepEqual(await legacyFolders(broken, { type: "company", id: "r1", name: "x" }, new Set()), []);
  // A property and a transaction keep their own old columns.
  assert.equal(LEGACY_RECORD_FOLDER.property, undefined);
  assert.equal(LEGACY_RECORD_FOLDER.deal, undefined);
});

test("every place the app still reads an old folder column is a file that exists, and the deleted readers are gone", async () => {
  const { existsSync } = await import("node:fs");
  for (const r of OLD_FOLDER_READERS) {
    assert.ok(MIGRATION_COLUMNS.some(c => c.column === r.column), r.column);
    for (const file of r.where.match(/[\w./-]+\.tsx?/g) || []) assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} (${r.column})`);
  }
  const where = OLD_FOLDER_READERS.map(r => r.where).join(" ");
  assert.doesNotMatch(where, /pla-folder-template|PropertyFoldersPanel|server\/crm\.ts|brand-profile-panel|property-schemes/);
});

// ── The brand page's old place, BGP share drive/Companies ───────────────
const calls: GraphRequest[] = [];
let answer: (r: GraphRequest) => GraphResponse = () => ok({});
before(() => setGraphTransport(async r => { calls.push(r); return answer(r); }));
after(() => { setGraphTransport(null); forgetLibrary(); });

const library = (r: GraphRequest): GraphResponse | null =>
  r.url.includes("/sites/brucegillinghampollardlimited.sharepoint.com:/sites/BGP") ? ok({ id: "site-1" })
    : r.url.includes("/sites/site-1/drives") ? ok({ value: [{ id: DRIVE, name: "Documents" }] })
    : r.url.includes(`/drives/${DRIVE}/root?`) ? ok({ id: "root-1" }) : null;
const folderAt = (id: string, name: string) => ({ id, name, folder: { childCount: 2 }, webUrl: `${SITE}/x/${id}`, parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:/BGP share drive/Companies` } });

test("the folders in BGP share drive/Companies are listed once, every page, and each offered to the company of exactly that name", async () => {
  forgetLibrary();
  calls.length = 0;
  answer = r => library(r)
    || (r.url.includes(`/drives/${DRIVE}/root:/BGP%20share%20drive/Companies?`) ? ok({ id: "companies", name: "Companies", folder: { childCount: 4 }, parentReference: { driveId: DRIVE } })
    : r.url.includes("$skiptoken=2") ? ok({ value: [folderAt("unknown", "Nobody We Know"), { id: "f1", name: "Gail's.pdf", file: {}, parentReference: { driveId: DRIVE } }] })
    : r.url.includes(`/drives/${DRIVE}/items/companies/children?`) ? ok({ value: [folderAt("gails", "Gail's"), folderAt("nandos", "NANDO'S  ")], "@odata.nextLink": "https://graph.microsoft.com/v1.0/drives/b!drive-1/items/companies/children?$skiptoken=2" })
    : ok({ error: {} }, { status: 404 }));
  const queries: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return { rows: [{ id: "c1", name: "Gail's" }, { id: "c2", name: "Nando's" }] };
    },
  };
  const live = new Set([`company|c2|${DRIVE}|nandos`]);
  const out = await companiesPlaceRows(db, "admin-token", live);
  assert.deepEqual(out.unread, []);
  assert.ok(calls.every(c => c.token === "admin-token"), "read as the admin");
  assert.equal(calls.filter(c => c.url.includes("/items/companies/children")).length, 2, "the listing once, both pages");
  // One query for the names the folders carry, merged-away companies left out.
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /merged_into_id IS NULL/);
  assert.deepEqual([...(queries[0].params[0] as string[])].sort(), ["gail's", "nando's", "nobody we know"]);
  assert.deepEqual(out.rows.map(r => [r.column, r.recordType, r.recordId, r.kind, r.value, r.status, r.entry?.itemId]), [
    ["crm_companies.name", "company", "c1", "path", `${COMPANIES_FOLDER_PATH}/Gail's`, "opens", "gails"],
    ["crm_companies.name", "company", "c2", "path", `${COMPANIES_FOLDER_PATH}/NANDO'S  `, "linked", "nandos"],
  ]);
  assert.equal(out.rows[0].id, migrationRowId("crm_companies.name", "c1", "", `${COMPANIES_FOLDER_PATH}/Gail's`), "the same row id in every preview");
  assert.equal(companyFolderKey("  NANDO'S \t "), "nando's");
});

test("no Companies folder offers nothing; one SharePoint will not list is said, never hidden", async () => {
  forgetLibrary();
  const db = { query: async () => { throw new Error("not asked"); } };
  answer = r => library(r) || ok({ error: {} }, { status: 404 });
  assert.deepEqual(await companiesPlaceRows(db, "t", new Set()), { rows: [], unread: [] });
  forgetLibrary();
  answer = r => library(r)
    || (r.url.includes("/root:/BGP%20share%20drive/Companies?") ? ok({ id: "companies", name: "Companies", folder: {}, parentReference: { driveId: DRIVE } })
    : ok({ error: {} }, { status: 403 }));
  const out = await companiesPlaceRows(db, "t", new Set());
  assert.deepEqual(out.rows, []);
  assert.equal(out.unread.length, 1);
  assert.match(out.unread[0], /^BGP share drive\/Companies: SharePoint says you can't open that/);
});
