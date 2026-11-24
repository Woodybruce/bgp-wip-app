// Filing the documents the app makes into a record's Folders (Woody, 24
// November 2026: "go ahead with the folder suggestion"; docs/folders-review-
// 2026-11-20.md). The shared rules, the folder a document goes in, the
// sub-folders made where missing, the upload in one go or in pieces, and the
// folder log. Microsoft is a stand-in: nothing here calls it. The SQL also
// runs against a real PostgreSQL in a throwaway schema when
// FOLDERS_DATABASE_URL names a LOCAL database:
//   FOLDERS_DATABASE_URL=postgresql://postgres:qa-local-pg@127.0.0.1:5432/postgres \
//     node --import tsx --test server/folders-filing.test.ts
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { UPLOAD_PIECE, UPLOAD_SESSION_ABOVE, folderTreePaths, graphRefusalWords } from "../shared/folders";
import {
  DD_PROJECT_MAX_FOLDERS, NOT_FILED_NO_RECORD, NOT_FILED_NO_SIGN_IN, NOT_FILED_UNREAD, ddProjectPaths, filingSubfolder, notFiledBecause,
  notFiledWords, safeFileName,
} from "../shared/folders-filing";
import { setGraphTransport, type GraphRequest, type GraphResponse } from "./folders/graph";
import { APP_ACCOUNT, fileRecordDocument, filingPlace, uploadToFolder } from "./folders/filing";

const DRIVE = "b!drive-1";
const SITE = "https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared%20Documents/BGP%20-%20Share%20Drive";
const res = (status: number, body: any = null, extra: Partial<GraphResponse> = {}): GraphResponse => ({ status, body, location: null, retryAfter: null, ...extra });
const item = (id: string, name: string, kind: "folder" | "file", path: string) => ({
  id, name, webUrl: `${SITE}/${path}/${encodeURIComponent(name)}`, ...(kind === "folder" ? { folder: { childCount: 0 } } : { file: { mimeType: "application/pdf" } }),
  parentReference: { driveId: DRIVE, driveType: "documentLibrary", path: `/drives/${DRIVE}/root:/BGP - Share Drive/${path}` },
});

// ── The shared rules ────────────────────────────────────────────────────
test("a sub-folder as the folders to walk: names SharePoint takes, at most four deep", () => {
  assert.deepEqual(filingSubfolder("Rent Review/Valuation"), ["Rent Review", "Valuation"]);
  assert.deepEqual(filingSubfolder(" Targeting Briefs "), ["Targeting Briefs"]);
  assert.deepEqual(filingSubfolder("a//b/"), ["a", "b"]);
  assert.deepEqual(filingSubfolder("Title: Register/Leases?"), ["Title Register", "Leases"]);
  assert.deepEqual(filingSubfolder("1/2/3/4/5"), ["1", "2", "3", "4"]);
  assert.deepEqual(filingSubfolder(""), []);
  assert.deepEqual(filingSubfolder(undefined), []);
  // A long name cut at a dot loses the dot, so the engine's tree check takes it.
  const cut = filingSubfolder(`${"x".repeat(119)}.yz`)[0];
  assert.ok(!cut.endsWith("."), cut);
  assert.ok(!("problem" in folderTreePaths([cut])));
});

test("a file name SharePoint takes, its extension kept", () => {
  assert.equal(safeFileName("Net Effective — Bluewater — 2026-11-24.xlsx"), "Net Effective — Bluewater — 2026-11-24.xlsx");
  assert.equal(safeFileName("Rent: review?.pdf"), "Rent- review-.pdf");
  assert.equal(safeFileName("  Brief  notes. "), "Brief notes");
  const long = safeFileName(`${"a".repeat(300)}.pdf`);
  assert.ok(long.endsWith(".pdf") && long.length <= 204, long);
  assert.equal(safeFileName("CON.pdf"), "Document.pdf");
  assert.equal(safeFileName(""), "Document");
  assert.equal(safeFileName(null, "Workbook"), "Workbook");
});

test("not filed: the words name the property for a transaction, matter, run or scheme, else the record", () => {
  assert.equal(notFiledWords({ type: "deal", name: "Gail's · Unit 12" }, "Bluewater Shopping Centre"), "Not filed in SharePoint: link a folder to Bluewater Shopping Centre first.");
  assert.equal(notFiledWords({ type: "pla_matter", name: "Rent Review · Bluewater" }, "Bluewater"), "Not filed in SharePoint: link a folder to Bluewater first.");
  assert.equal(notFiledWords({ type: "pathway_run", name: "1 High Street" }, null), "Not filed in SharePoint: link a folder to 1 High Street first.");
  assert.equal(notFiledWords({ type: "property", name: "Liverpool ONE" }, "ignored"), "Not filed in SharePoint: link a folder to Liverpool ONE first.");
  assert.equal(notFiledWords({ type: "deal", name: " " }, " "), "Not filed in SharePoint: link a folder to its record first.");
  assert.equal(notFiledBecause(graphRefusalWords(429)), "Not filed in SharePoint. SharePoint is busy. Try again in a minute.");
  assert.equal(notFiledBecause(""), "Not filed in SharePoint. SharePoint did not take it.");
});

test("a DD project's folders: cleaned, once each whatever the case, four deep, at most 80", () => {
  const { paths, dropped } = ddProjectPaths([
    { fileName: "a.pdf", targetFolder: "01 Legal/Title: Register" },
    { fileName: "b.pdf", targetFolder: "01 legal/title  register" },
    { fileName: "c.pdf", targetFolder: "02 Leases/A/B/C/D" },
    { fileName: "d.pdf", targetFolder: "  " },
    { fileName: "e.pdf" },
    null,
  ]);
  assert.deepEqual(paths, ["01 Legal/Title Register", "02 Leases/A/B/C"]);
  assert.deepEqual(dropped, []);
  assert.ok(!("problem" in folderTreePaths(paths)), "the engine's tree takes them");
  const many = ddProjectPaths(Array.from({ length: 85 }, (_, i) => ({ targetFolder: `Folder ${i}` })));
  assert.equal(many.paths.length, DD_PROJECT_MAX_FOLDERS);
  assert.deepEqual(many.dropped, ["Folder 80", "Folder 81", "Folder 82", "Folder 83", "Folder 84"]);
  assert.ok(!("problem" in folderTreePaths(many.paths)));
  assert.deepEqual(ddProjectPaths("nope"), { paths: [], dropped: [] });
});

// ── The upload, through the one door to Microsoft ───────────────────────
let calls: GraphRequest[] = [];
let answer: (r: GraphRequest) => GraphResponse = () => res(500);
before(() => setGraphTransport(async r => { calls.push(r); return answer(r); }));
after(() => setGraphTransport(null));

test("a file of up to 10 MB goes up in one go, as the token given; a name already there gets a number", async () => {
  calls = [];
  answer = r => (r.method === "PUT" && r.url.includes(`/drives/${DRIVE}/items/folder-1:/Brief.pdf:/content?@microsoft.graph.conflictBehavior=rename`)
    ? res(201, item("file-1", "Brief.pdf", "file", "National"))
    : res(500));
  const e = await uploadToFolder("app-token", DRIVE, "folder-1", "Brief.pdf", new Uint8Array([1, 2, 3]));
  assert.equal(e.itemId, "file-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, "app-token");
});

test("a larger file goes up in pieces to Microsoft's own address, with no token; a failure ends the session", async () => {
  const size = UPLOAD_SESSION_ABOVE + 1;
  const uploadUrl = "https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/_api/v2.0/uploadSession?guid=abc";
  calls = [];
  answer = r => {
    if (r.method === "POST" && r.url.endsWith(`/drives/${DRIVE}/items/folder-1:/Deck.pdf:/createUploadSession`)) return res(200, { uploadUrl });
    if (r.method === "PUT" && r.url === uploadUrl) {
      const [, start, end] = /bytes (\d+)-(\d+)\//.exec(r.headers!["Content-Range"])!.map(Number);
      return end === size - 1 ? res(201, item("file-2", "Deck.pdf", "file", "National")) : res(202, { nextExpectedRanges: [`${end + 1}-`] });
    }
    return res(500);
  };
  const e = await uploadToFolder("app-token", DRIVE, "folder-1", "Deck.pdf", new Uint8Array(size));
  assert.equal(e.itemId, "file-2");
  const pieces = calls.filter(c => c.url === uploadUrl);
  assert.equal(pieces.length, Math.ceil(size / UPLOAD_PIECE));
  assert.ok(pieces.every(p => p.token === null), "Microsoft's signed address never gets a token");
  assert.deepEqual(pieces.map(p => p.headers!["Content-Range"]), [`bytes 0-${UPLOAD_PIECE - 1}/${size}`, `bytes ${UPLOAD_PIECE}-${2 * UPLOAD_PIECE - 1}/${size}`, `bytes ${2 * UPLOAD_PIECE}-${size - 1}/${size}`]);

  calls = [];
  answer = r => (r.method === "POST" ? res(200, { uploadUrl }) : r.method === "PUT" ? res(507) : res(204));
  await assert.rejects(uploadToFolder("app-token", DRIVE, "folder-1", "Deck.pdf", new Uint8Array(size)), (e: any) => e.status === 507);
  assert.ok(calls.some(c => c.method === "DELETE" && c.url === uploadUrl), "the session is ended");
});

// ── The folder a document goes in, and the filing (a stand-in database) ──
type Row = Record<string, any>;
function fakeDb(data: { properties?: Row[]; deals?: Row[]; runs?: Row[]; links?: Row[] }) {
  const actions: any[][] = [];
  return {
    actions,
    query: async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO folder_actions/.test(sql)) { actions.push(params as any[]); return { rows: [] as any[] }; }
      if (/FROM record_folders/.test(sql)) {
        const [type, id] = params;
        return { rows: (data.links || []).filter(l => l.record_type === type && l.record_id === id && !l.removed_at).sort((a, b) => a.position - b.position).slice(0, 1) };
      }
      const id = params[0];
      if (/FROM crm_deals/.test(sql)) return { rows: (data.deals || []).filter(r => r.id === id) };
      if (/FROM property_pathway_runs/.test(sql)) return { rows: (data.runs || []).filter(r => r.id === id).map(r => ({ id: r.id, name: r.address, property_id: r.property_id })) };
      if (/FROM crm_properties/.test(sql)) return { rows: (data.properties || []).filter(r => r.id === id).map(r => ({ ...r, property_id: null })) };
      throw new Error(`not expected: ${sql}`);
    },
  };
}
const link = (record_type: string, record_id: string, id: string, item_id: string, position: number, extra: Row = {}) =>
  ({ id, record_type, record_id, drive_id: DRIVE, item_id, label: item_id, cached_path: `BGP - Share Drive / ${item_id}`, position, ...extra });
const BLUEWATER = { id: "p1", name: "Bluewater Shopping Centre" };
const GAILS = { id: "d1", name: "Gail's · Unit 12", property_id: "p1" };
const doc = (record: { type: any; id: string }, extra: Partial<Parameters<typeof fileRecordDocument>[2]> = {}) =>
  ({ record, subfolder: "Targeting Briefs", name: "Brief.pdf", bytes: new Uint8Array([1, 2, 3]), userId: "u1", what: "Targeting Brief", ...extra });

test("a transaction with no folder of its own files in its property's first folder, under a sub-folder made for it, and both are logged as the app", async () => {
  const db = fakeDb({ properties: [BLUEWATER], deals: [GAILS], links: [link("property", "p1", "l2", "second", 1), link("property", "p1", "l1", "bluewater", 0), link("property", "p1", "l0", "gone", 0, { removed_at: new Date() })] });
  let asked = 0;
  calls = [];
  answer = r => {
    if (r.method === "GET" && r.url.includes(`/drives/${DRIVE}/items/bluewater:/Targeting%20Briefs?`)) return res(404, { error: {} });
    if (r.method === "POST" && r.url.endsWith(`/drives/${DRIVE}/items/bluewater/children`)) return res(201, item("briefs", "Targeting Briefs", "folder", "National/Bluewater"));
    if (r.method === "PUT" && r.url.includes(`/drives/${DRIVE}/items/briefs:/Brief.pdf:/content`)) return res(201, item("file-1", "Brief.pdf", "file", "National/Bluewater/Targeting Briefs"));
    return res(500);
  };
  const out = await fileRecordDocument(db, async () => { asked++; return "app-token"; }, doc({ type: "deal", id: "d1" }));
  assert.equal(out.filed, true);
  if (!out.filed) return;
  assert.equal(out.itemId, "file-1");
  assert.match(out.webUrl!, /Brief\.pdf$/);
  assert.equal(out.folder.linkId, "l1", "the first link by position, not one unlinked");
  assert.deepEqual(out.folder.on, { type: "property", id: "p1", name: "Bluewater Shopping Centre" });
  assert.equal(asked, 1);
  assert.ok(calls.every(c => c.token === "app-token"));
  assert.deepEqual(db.actions.map(a => [a[0], a[1], a[2], a[3], a[4], a[8], a[11]]), [
    ["u1", APP_ACCOUNT, "create", "deal", "d1", "Targeting Briefs", true],
    ["u1", APP_ACCOUNT, "upload", "deal", "d1", "Brief.pdf", true],
  ]);
  assert.deepEqual(JSON.parse(db.actions[1][13]), { filing: "Targeting Brief", subfolder: "Targeting Briefs", link: "l1", folderOn: { type: "property", id: "p1" }, size: 3 });
});

test("a record's own folder comes first, a sub-folder already there is used, and nobody behind it logs as no one", async () => {
  const db = fakeDb({ properties: [BLUEWATER], deals: [GAILS], links: [link("property", "p1", "l1", "bluewater", 0), link("deal", "d1", "l3", "gails", 3)] });
  calls = [];
  answer = r => {
    if (r.method === "GET" && r.url.includes(`/drives/${DRIVE}/items/gails:/Rent%20Review?`)) return res(200, item("rr", "Rent Review", "folder", "Gails"));
    if (r.method === "GET" && r.url.includes(`/drives/${DRIVE}/items/rr:/Valuation?`)) return res(200, item("val", "Valuation", "folder", "Gails/Rent Review"));
    if (r.method === "PUT" && r.url.includes(`/drives/${DRIVE}/items/val:/NE.xlsx:/content`)) return res(201, item("file-3", "NE.xlsx", "file", "Gails/Rent Review/Valuation"));
    return res(500);
  };
  const out = await fileRecordDocument(db, async () => "app-token", doc({ type: "deal", id: "d1" }, { subfolder: "Rent Review/Valuation", name: "NE.xlsx", userId: null }));
  assert.equal(out.filed, true);
  assert.equal(calls.filter(c => c.method === "POST").length, 0, "nothing made");
  assert.deepEqual(db.actions.map(a => [a[0], a[2]]), [[null, "upload"]]);
  assert.equal(JSON.parse(db.actions[0][13]).folderOn, undefined);
});

test("with no folder linked nothing goes to Microsoft and no token is asked for; the words name the property", async () => {
  const db = fakeDb({ properties: [BLUEWATER], deals: [GAILS], runs: [{ id: "r1", address: "1 High Street", property_id: null }] });
  calls = [];
  let asked = 0;
  const token = async () => { asked++; return "app-token"; };
  assert.deepEqual(await fileRecordDocument(db, token, doc({ type: "deal", id: "d1" })), { filed: false, note: "Not filed in SharePoint: link a folder to Bluewater Shopping Centre first." });
  assert.deepEqual(await fileRecordDocument(db, token, doc({ type: "pathway_run", id: "r1" })), { filed: false, note: "Not filed in SharePoint: link a folder to 1 High Street first." });
  assert.deepEqual(await fileRecordDocument(db, token, doc({ type: "deal", id: "gone" })), { filed: false, note: NOT_FILED_NO_RECORD });
  assert.equal(asked, 0);
  assert.equal(calls.length, 0);
  assert.equal(db.actions.length, 0);
  const place = await filingPlace(db, { type: "property", id: "p1" });
  assert.equal(place.link, null);
});

test("no sign-in, a file in the way, a folder gone or the folders unread: not filed, said plainly, the failure logged", async () => {
  const db = fakeDb({ properties: [BLUEWATER], links: [link("property", "p1", "l1", "bluewater", 0)] });
  calls = [];
  assert.deepEqual(await fileRecordDocument(db, async () => null, doc({ type: "property", id: "p1" })), { filed: false, note: NOT_FILED_NO_SIGN_IN });
  assert.equal(calls.length, 0);

  answer = r => (r.method === "GET" ? res(200, item("x", "Targeting Briefs", "file", "National")) : res(500));
  const inTheWay = await fileRecordDocument(db, async () => "app-token", doc({ type: "property", id: "p1" }));
  assert.deepEqual(inTheWay, { filed: false, note: 'Not filed in SharePoint. A file called "Targeting Briefs" is where its folder would go.' });

  answer = r => (r.method === "PUT" ? res(404, { error: {} }) : res(500));
  const gone = await fileRecordDocument(db, async () => "app-token", doc({ type: "property", id: "p1" }, { subfolder: "" }));
  assert.deepEqual(gone, { filed: false, note: notFiledBecause(graphRefusalWords(404)) });
  const failed = db.actions.filter(a => a[11] === false);
  assert.equal(failed.length, 2);
  assert.deepEqual([failed[1][2], failed[1][8], failed[1][10]], ["upload", "Brief.pdf", "bluewater"]);

  const broken = { query: async () => { throw new Error("relation \"record_folders\" does not exist"); } };
  assert.deepEqual(await fileRecordDocument(broken, async () => "app-token", doc({ type: "property", id: "p1" })), { filed: false, note: NOT_FILED_UNREAD });
});

test("a sub-folder made a moment ago by another filing is used, never a second", async () => {
  const db = fakeDb({ properties: [BLUEWATER], links: [link("property", "p1", "l1", "bluewater", 0)] });
  let looked = 0;
  answer = r => {
    if (r.method === "GET") return ++looked === 1 ? res(404, { error: {} }) : res(200, item("briefs", "Targeting Briefs", "folder", "National"));
    if (r.method === "POST") return res(409, { error: {} });
    if (r.method === "PUT" && r.url.includes("/items/briefs:/Brief.pdf:/content")) return res(201, item("file-9", "Brief.pdf", "file", "National/Targeting Briefs"));
    return res(500);
  };
  const out = await fileRecordDocument(db, async () => "app-token", doc({ type: "property", id: "p1" }));
  assert.equal(out.filed, true);
  assert.deepEqual(db.actions.map(a => a[2]), ["upload"], "nothing logged as made");
});

// ── The SQL, on a real PostgreSQL ───────────────────────────────────────
const databaseUrl = process.env.FOLDERS_DATABASE_URL;
const skip = !databaseUrl ? "set FOLDERS_DATABASE_URL to a local PostgreSQL database to run the filing's SQL"
  : !/@(localhost|127\.0\.0\.1)[:/]|host=%2F|@%2F/.test(databaseUrl) ? "FOLDERS_DATABASE_URL must be a local database" : false;
const schema = `folders_filing_test_${process.pid}`;
let pool: pg.Pool;
let admin: pg.Pool;

test("on PostgreSQL: the first live link by position, a property's for a transaction, matter or run, and the log as the app", { skip }, async () => {
  admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new pg.Pool({ connectionString: databaseUrl, max: 2, options: `-c search_path=${schema},pg_catalog` });
  try {
    await pool.query(`CREATE TABLE crm_properties (id varchar PRIMARY KEY, name text NOT NULL)`);
    await pool.query(`CREATE TABLE crm_deals (id varchar PRIMARY KEY, name text, property_id varchar)`);
    await pool.query(`CREATE TABLE pla_matters (id varchar PRIMARY KEY, matter_type text, property_id varchar)`);
    await pool.query(`CREATE TABLE property_pathway_runs (id varchar PRIMARY KEY, address text, property_id varchar)`);
    // The two tables exactly as the app makes them at boot.
    const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const boot = [...index.matchAll(/`((?:CREATE TABLE IF NOT EXISTS (?:record_folders|folder_actions)|CREATE (?:UNIQUE )?INDEX IF NOT EXISTS record_folders_|ALTER TABLE record_folders ADD COLUMN IF NOT EXISTS )[^`]*)`/g)].map(m => m[1]);
    assert.equal(boot.length, 7, "record_folders, its two indexes, folder_actions and the three share columns");
    for (const sql of boot) await pool.query(sql);
    await pool.query(`INSERT INTO crm_properties VALUES ('p1', 'Bluewater Shopping Centre'), ('p2', 'Liverpool ONE')`);
    await pool.query(`INSERT INTO crm_deals VALUES ('d1', 'Gail''s · Unit 12', 'p1'), ('d2', 'No property', NULL)`);
    await pool.query(`INSERT INTO pla_matters VALUES ('m1', 'rent_review', 'p1')`);
    await pool.query(`INSERT INTO property_pathway_runs VALUES ('r1', '1 High Street', 'p2')`);
    const add = (type: string, id: string, itemId: string, position: number, removed = false) => pool.query(
      `INSERT INTO record_folders (record_type, record_id, drive_id, item_id, label, position, source, removed_at) VALUES ($1, $2, $3, $4, $4, $5, 'picked', $6)`,
      [type, id, DRIVE, itemId, position, removed ? new Date() : null]);
    await add("property", "p1", "unlinked", 0, true);
    await add("property", "p1", "later", 2);
    await add("property", "p1", "first", 1);
    await add("pathway_run", "r1", "run-own", 0);

    const p = await filingPlace(pool, { type: "property", id: "p1" });
    assert.equal(p.link?.itemId, "first");
    for (const ref of [{ type: "deal", id: "d1" }, { type: "pla_matter", id: "m1" }] as const) {
      const inherited = await filingPlace(pool, ref);
      assert.equal(inherited.link?.itemId, "first", ref.type);
      assert.deepEqual(inherited.link?.on, { type: "property", id: "p1", name: "Bluewater Shopping Centre" });
    }
    assert.equal((await filingPlace(pool, { type: "pathway_run", id: "r1" })).link?.itemId, "run-own");
    const none = await filingPlace(pool, { type: "deal", id: "d2" });
    assert.deepEqual([none.link, none.link ? "" : none.note], [null, "Not filed in SharePoint: link a folder to No property first."]);
    assert.deepEqual((await filingPlace(pool, { type: "property", id: "p2" })).link, null);

    answer = r => (r.method === "PUT" && r.url.includes("/items/first:/Brief.pdf:/content") ? res(201, item("file-1", "Brief.pdf", "file", "National")) : res(500));
    const out = await fileRecordDocument(pool, async () => "app-token", doc({ type: "pla_matter", id: "m1" }, { subfolder: "", userId: null }));
    assert.equal(out.filed, true);
    const logged = (await pool.query(`SELECT user_id, ms_account, action, record_type, record_id, drive_id, item_id, parent_after, name_after, ok, detail FROM folder_actions`)).rows;
    assert.deepEqual(logged.map(r => [r.user_id, r.ms_account, r.action, r.record_type, r.record_id, r.item_id, r.parent_after, r.name_after, r.ok]), [
      [null, "app", "upload", "pla_matter", "m1", "file-1", "first", "Brief.pdf", true],
    ]);
    assert.deepEqual(logged[0].detail.folderOn, { type: "property", id: "p1" });

    // A folder shared with a client, or one inside it, is never filed into (24 November 2026).
    await pool.query(`UPDATE record_folders SET shared_with_company_id = 'landsec', cached_path = 'BGP - Share Drive / National / Bluewater' WHERE item_id = 'first'`);
    await pool.query(`UPDATE record_folders SET cached_path = 'BGP - Share Drive / National / Bluewater / Leases' WHERE item_id = 'later'`);
    const shared = await filingPlace(pool, { type: "deal", id: "d1" });
    assert.deepEqual([shared.link, shared.link ? "" : shared.note],
      [null, "Not filed in SharePoint: the folders linked to Bluewater Shopping Centre are shared with a client. Link a folder only BGP uses first."]);
    await pool.query(`UPDATE record_folders SET cached_path = 'BGP - Share Drive / Internal / Bluewater' WHERE item_id = 'later'`);
    assert.equal((await filingPlace(pool, { type: "deal", id: "d1" })).link?.itemId, "later");
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

test("the app's own documents stay out of a folder shared with a client, and out of any folder inside one", async () => {
  const { filingBlockedByShare } = await import("../shared/folders-filing");
  const shared = [{ driveId: "b!lib", path: "BGP - Share Drive / National / Bluewater" }];
  assert.equal(filingBlockedByShare({ driveId: "b!lib", path: "BGP - Share Drive / Internal", shared: true }, []), true);
  assert.equal(filingBlockedByShare({ driveId: "b!lib", path: "BGP - Share Drive / National / Bluewater", shared: false }, shared), true);
  assert.equal(filingBlockedByShare({ driveId: "b!lib", path: "bgp - share drive / national / bluewater / Leases", shared: false }, shared), true);
  // A name that only starts the same way is another folder.
  assert.equal(filingBlockedByShare({ driveId: "b!lib", path: "BGP - Share Drive / National / Bluewater Annex", shared: false }, shared), false);
  assert.equal(filingBlockedByShare({ driveId: "b!other", path: "BGP - Share Drive / National / Bluewater", shared: false }, shared), false);
  // No path to compare on a drive that holds a shared folder: kept out.
  assert.equal(filingBlockedByShare({ driveId: "b!lib", path: null, shared: false }, shared), true);
  assert.equal(filingBlockedByShare({ driveId: "b!lib", path: null, shared: false }, []), false);
});
