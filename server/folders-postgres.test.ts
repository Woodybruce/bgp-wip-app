// Folders: one engine (Woody, 24 November 2026). The engine's SQL on a real
// PostgreSQL, in a throwaway schema: the two tables as server/index.ts makes
// them at boot, linking, the "From <property>" folders of a transaction,
// labels, colours and order, unlinking, the old columns read until they are
// moved over, and the refresh on read. Graph is a stand-in: nothing here calls
// Microsoft. Skipped unless FOLDERS_DATABASE_URL names a LOCAL database:
//   FOLDERS_DATABASE_URL=postgresql://postgres:qa-local-pg@127.0.0.1:5432/postgres \
//     node --import tsx --test server/folders-postgres.test.ts
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import express from "express";
import type { AddressInfo } from "node:net";
import { setGraphTransport, type GraphRequest, type GraphResponse } from "./folders/graph";
import { folderRecord } from "./folders/access";
import { MIGRATION_RUNS_KEY, addFolderLink, changeFolderLink, readRecordFolders, unlinkFolder } from "./folders/links";
import { foldersMigrationRouter } from "./folders/migration";

const databaseUrl = process.env.FOLDERS_DATABASE_URL;
const skip = !databaseUrl ? "set FOLDERS_DATABASE_URL to a local PostgreSQL database to run the folder engine's SQL"
  : !/@(localhost|127\.0\.0\.1)[:/]|host=%2F|@%2F/.test(databaseUrl) ? "FOLDERS_DATABASE_URL must be a local database" : false;

const DRIVE = "b!drive-1";
const SITE = "https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared%20Documents/BGP%20-%20Share%20Drive";
const schema = `folders_test_${process.pid}`;
let db: pg.Pool;
let admin: pg.Pool;

// The folders SharePoint holds in this test, by item id.
const items: Record<string, { name: string; folder?: boolean; root?: boolean; path: string; webUrl: string } | number> = {
  top: { name: "Documents", folder: true, root: true, path: "", webUrl: "https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared%20Documents" },
  bluewater: { name: "Bluewater", folder: true, path: "BGP - Share Drive/National", webUrl: `${SITE}/National/Bluewater` },
  leases: { name: "Leases", folder: true, path: "BGP - Share Drive/National/Bluewater", webUrl: `${SITE}/National/Bluewater/Leases` },
  hots: { name: "Heads of Terms", folder: true, path: "BGP - Share Drive/National/Bluewater", webUrl: `${SITE}/National/Bluewater/Heads%20of%20Terms` },
  plan: { name: "Plan.pdf", path: "BGP - Share Drive/National/Bluewater", webUrl: `${SITE}/National/Bluewater/Plan.pdf` },
  gone: 404,
};
const shares: Record<string, string> = {};
const answer = (r: GraphRequest): GraphResponse => {
  const m = r.url.match(/\/drives\/[^/]+\/items\/([^/?]+)\?/) || r.url.match(/\/shares\/([^/]+)\/driveItem/);
  const id = m ? (r.url.includes("/shares/") ? shares[m[1]] : m[1]) : null;
  const it = id ? items[id] : undefined;
  if (!it || typeof it === "number") return { status: typeof it === "number" ? it : 404, body: { error: {} }, location: null, retryAfter: null };
  return { status: 200, body: { id, name: it.name, webUrl: it.webUrl, folder: it.folder ? { childCount: 1 } : undefined, file: it.folder ? undefined : {}, root: it.root ? {} : undefined, parentReference: { driveId: DRIVE, driveType: "documentLibrary", path: `/drives/${DRIVE}/root:/${it.path}` } }, location: null, retryAfter: null };
};
const shareOf = (url: string) => `u!${Buffer.from(url, "utf8").toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-")}`;

const me = { userId: "u1", account: "victoria@brucegillinghampollard.com" };
const actor = { ...me, token: "victoria-token" };

before(async () => {
  if (skip) return;
  admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  db = new pg.Pool({ connectionString: databaseUrl, max: 2, options: `-c search_path=${schema},pg_catalog` });
  await db.query(`CREATE TABLE users (id varchar PRIMARY KEY, name text, email text)`);
  await db.query(`CREATE TABLE crm_properties (id varchar PRIMARY KEY, name text NOT NULL, sharepoint_folder_url text, sharepoint_team_folders jsonb)`);
  await db.query(`CREATE TABLE crm_deals (id varchar PRIMARY KEY, name text, property_id varchar, sharepoint_link text)`);
  await db.query(`CREATE TABLE crm_companies (id varchar PRIMARY KEY, name text)`);
  await db.query(`CREATE TABLE property_schemes (id varchar PRIMARY KEY, name text, property_id varchar)`);
  await db.query(`CREATE TABLE pla_matters (id varchar PRIMARY KEY, matter_type text, property_id varchar)`);
  await db.query(`CREATE TABLE property_pathway_runs (id varchar PRIMARY KEY, address text, property_id varchar)`);
  await db.query(`CREATE TABLE system_settings (key text PRIMARY KEY, value jsonb, updated_at timestamptz)`);
  // The two tables exactly as the app makes them at boot.
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const boot = [...index.matchAll(/`((?:CREATE TABLE IF NOT EXISTS (?:record_folders|folder_actions)|CREATE (?:UNIQUE )?INDEX IF NOT EXISTS record_folders_|ALTER TABLE record_folders ADD COLUMN IF NOT EXISTS )[^`]*)`/g)].map(m => m[1]);
  assert.equal(boot.length, 7, "record_folders, its two indexes, folder_actions and the three share columns");
  for (const sql of boot) await db.query(sql);
  await db.query(`INSERT INTO users VALUES ('u1', 'Victoria Broadhead', 'victoria@brucegillinghampollard.com')`);
  await db.query(`INSERT INTO crm_properties VALUES ('p1', 'Bluewater Shopping Centre', NULL, NULL), ('p2', 'Liverpool ONE', $1, $2)`,
    [`${SITE}/National/Liverpool`, JSON.stringify({ Leases: `${SITE}/National/Bluewater/Leases`, Investment: `${SITE}/National/Liverpool` })]);
  await db.query(`INSERT INTO crm_deals VALUES ('d1', 'Gail''s · Unit 12', 'p1', $1), ('d2', 'No property', NULL, 'see the folder')`, [`${SITE}/National/Bluewater`]);
  shares[shareOf(`${SITE}/National/Bluewater`)] = "bluewater";
  shares[shareOf(`${SITE}/National/Bluewater/Leases`)] = "leases";
  shares[shareOf(`${SITE}/National/Liverpool`)] = "gone";
  setGraphTransport(async r => answer(r));
});
after(async () => {
  setGraphTransport(null);
  if (skip) return;
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

const actions = async () => (await db.query(`SELECT action, user_id, ms_account, record_type, record_id, item_id, name_before, name_after FROM folder_actions ORDER BY at, id`)).rows;

test("linking: by ids or a pasted address, the folder's name as the label, one live link a folder, each logged", { skip }, async () => {
  const p1 = (await folderRecord(db, "property", "p1"))!;
  const first = await addFolderLink(db, p1, actor, { driveId: DRIVE, itemId: "hots" });
  assert.deepEqual([first.label, first.name, first.path, first.source, first.linkedBy], ["Heads of Terms", "Heads of Terms", "BGP - Share Drive / National / Bluewater / Heads of Terms", "picked", "Victoria Broadhead"]);
  const second = await addFolderLink(db, p1, actor, { url: `${SITE}/National/Bluewater/Leases`, label: "Leases 2026", colour: "sage" });
  assert.deepEqual([second.label, second.colour, second.source], ["Leases 2026", "sage", "pasted"]);
  await assert.rejects(addFolderLink(db, p1, actor, { driveId: DRIVE, itemId: "hots" }), (e: any) => e.status === 409);
  await assert.rejects(addFolderLink(db, p1, actor, { driveId: DRIVE, itemId: "plan" }), (e: any) => e.status === 400 && /file, not a folder/.test(e.message));
  await assert.rejects(addFolderLink(db, p1, actor, { url: "https://evil.example.com/x" }), (e: any) => e.status === 400);
  await assert.rejects(addFolderLink(db, p1, actor, { driveId: DRIVE, itemId: "gone" }), (e: any) => e.status === 404);
  await assert.rejects(addFolderLink(db, p1, actor, { driveId: "../x", itemId: "hots" }), (e: any) => e.status === 400);
  await assert.rejects(addFolderLink(db, p1, actor, { driveId: DRIVE, itemId: "top" }), (e: any) => e.status === 400 && /top of the library/.test(e.message));
  const positions = (await db.query(`SELECT label, position FROM record_folders WHERE record_id = 'p1' ORDER BY position`)).rows;
  assert.deepEqual(positions, [{ label: "Heads of Terms", position: 0 }, { label: "Leases 2026", position: 1 }]);
  const log = await actions();
  assert.deepEqual(log.map(a => [a.action, a.user_id, a.ms_account, a.record_id, a.item_id]), [
    ["link", "u1", "victoria@brucegillinghampollard.com", "p1", "hots"],
    ["link", "u1", "victoria@brucegillinghampollard.com", "p1", "leases"],
  ]);
});

test("a transaction shows its own folders, then its property's; a folder on both shows once, as the transaction's", { skip }, async () => {
  const d1 = (await folderRecord(db, "deal", "d1"))!;
  assert.deepEqual([d1.propertyId, d1.propertyName], ["p1", "Bluewater Shopping Centre"]);
  await addFolderLink(db, d1, actor, { driveId: DRIVE, itemId: "leases" });
  const view = await readRecordFolders(db, d1, { userId: "u1", token: "victoria-token" });
  // Its own: the link, and the old link the transaction held (read only, it opens Bluewater).
  assert.deepEqual(view.folders.map(f => [f.label, f.legacy, f.itemId]), [["Leases", false, "leases"], ["Transaction link", true, "bluewater"]]);
  assert.deepEqual(view.folders[0].alsoLinked, [{ type: "property", id: "p1", name: "Bluewater Shopping Centre" }]);
  assert.deepEqual(view.inherited.map(g => [g.from.name, g.folders.map(f => f.label)]), [["Bluewater Shopping Centre", ["Heads of Terms"]]]);
  assert.equal(view.connected, true);
  // With no Microsoft 365 of their own the stored links still show; nothing is refreshed or opened.
  const offline = await readRecordFolders(db, d1, { userId: "u1", token: null });
  assert.equal(offline.connected, false);
  assert.equal(offline.folders.find(f => f.legacy)!.status, "unknown");
  // A transaction with no property: its own only. Text that is not an address is not a folder.
  const d2 = (await folderRecord(db, "deal", "d2"))!;
  assert.deepEqual(await readRecordFolders(db, d2, { userId: "u1", token: null }).then(v => [v.folders.length, v.inherited.length]), [0, 0]);
});

test("a label, a colour, a place in the list; unlinking keeps the row and SharePoint is untouched", { skip }, async () => {
  const ids = (await db.query(`SELECT id FROM record_folders WHERE record_id = 'p1' AND removed_at IS NULL ORDER BY position`)).rows.map(r => r.id);
  const moved = await changeFolderLink(db, me, ids[1], { position: 0, colour: "rose" });
  assert.equal(moved.colour, "rose");
  assert.deepEqual((await db.query(`SELECT label FROM record_folders WHERE record_id = 'p1' AND removed_at IS NULL ORDER BY position`)).rows.map(r => r.label), ["Leases 2026", "Heads of Terms"]);
  const renamed = await changeFolderLink(db, me, ids[0], { label: "HOTs", colour: null });
  assert.deepEqual([renamed.label, renamed.colour, renamed.name], ["HOTs", null, "Heads of Terms"], "the label changes, the folder's name does not");
  await assert.rejects(changeFolderLink(db, me, ids[0], { colour: "red" }), (e: any) => e.status === 400);
  await assert.rejects(changeFolderLink(db, me, ids[0], { label: "" }), (e: any) => e.status === 400);
  await unlinkFolder(db, me, ids[0]);
  await assert.rejects(unlinkFolder(db, me, ids[0]), (e: any) => e.status === 404);
  const kept = (await db.query(`SELECT removed_at, removed_by FROM record_folders WHERE id = $1`, [ids[0]])).rows[0];
  assert.ok(kept.removed_at && kept.removed_by === "u1", "the row stays, for the record");
  // Linked again after unlinking: a new live link.
  const p1 = (await folderRecord(db, "property", "p1"))!;
  const again = await addFolderLink(db, p1, actor, { driveId: DRIVE, itemId: "hots" });
  assert.notEqual(again.id, ids[0]);
  assert.deepEqual((await actions()).slice(-4).map(a => [a.action, a.name_before, a.name_after]), [
    ["change", "Leases 2026", "Leases 2026"], ["change", "Heads of Terms", "HOTs"], ["unlink", "HOTs", null], ["link", null, "Heads of Terms"],
  ]);
});

test("the old columns show read only until moved over; the same address shows once; a moved one is hidden until its run is undone", { skip }, async () => {
  const p2 = (await folderRecord(db, "property", "p2"))!;
  let view = await readRecordFolders(db, p2, { userId: "u1", token: "victoria-token" });
  // The default, and two team folders, one of which is the default again.
  assert.deepEqual(view.folders.map(f => [f.label, f.legacy, f.status]), [["Linked folder", true, "missing"], ["Leases", true, "ok"]]);
  assert.ok(view.folders.every(f => f.source.startsWith("legacy:")));
  // Moved over by a migration run: hidden.
  const run = { kind: "apply", batch: "b1", rows: [{ column: "crm_properties.sharepoint_team_folders", recordId: "p2", key: "Leases", value: `${SITE}/National/Bluewater/Leases` }] };
  await db.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb)`, [MIGRATION_RUNS_KEY, JSON.stringify([run])]);
  view = await readRecordFolders(db, p2, { userId: "u1", token: "victoria-token" });
  assert.deepEqual(view.folders.map(f => f.label), ["Linked folder"]);
  // Undone: back.
  await db.query(`UPDATE system_settings SET value = $2::jsonb WHERE key = $1`, [MIGRATION_RUNS_KEY, JSON.stringify([{ ...run, undoneAt: new Date().toISOString() }])]);
  view = await readRecordFolders(db, p2, { userId: "u1", token: "victoria-token" });
  assert.deepEqual(view.folders.map(f => f.label), ["Linked folder", "Leases"]);
  // An old address of a folder the record now links shows as the link only.
  await addFolderLink(db, p2, actor, { driveId: DRIVE, itemId: "leases" });
  view = await readRecordFolders(db, p2, { userId: "u1", token: "victoria-token" });
  assert.deepEqual(view.folders.map(f => [f.label, f.legacy]), [["Leases", false], ["Linked folder", true]]);
});

test("read again after ten minutes: the shown name and path follow SharePoint; a folder that has gone says so", { skip }, async () => {
  await db.query(`UPDATE record_folders SET checked_at = now() - interval '1 hour'`);
  (items.leases as any).name = "Leases (signed)";
  const p1 = (await folderRecord(db, "property", "p1"))!;
  let view = await readRecordFolders(db, p1, { userId: "u1", token: "victoria-token" });
  assert.equal(view.folders.find(f => f.itemId === "leases")!.name, "Leases (signed)");
  assert.equal(view.folders.find(f => f.itemId === "leases")!.label, "Leases 2026", "a label a person set is kept");
  items.hots = 404;
  await db.query(`UPDATE record_folders SET checked_at = now() - interval '1 hour'`);
  view = await readRecordFolders(db, p1, { userId: "u1", token: "victoria-token" });
  assert.equal(view.folders.find(f => f.itemId === "hots")!.status, "missing");
});

test("the migration report: every old address and team path read as the admin, Apply on their own preview, Undo puts the old links back", { skip }, async () => {
  // The other old columns, as the app has them.
  await db.query(`ALTER TABLE crm_properties ADD COLUMN folder_teams text[]`);
  await db.query(`ALTER TABLE crm_companies ADD COLUMN sharepoint_folder_url text, ADD COLUMN folder_teams text[]`);
  await db.query(`ALTER TABLE property_schemes ADD COLUMN sharepoint_folder_url text`);
  await db.query(`ALTER TABLE pla_matters ADD COLUMN sharepoint_folder_url text`);
  await db.query(`ALTER TABLE property_pathway_runs ADD COLUMN sharepoint_folder_url text, ADD COLUMN sharepoint_folder_path text`);
  await db.query(`INSERT INTO crm_properties (id, name, sharepoint_folder_url, folder_teams) VALUES ('p3', 'Trinity Leeds', $1, ARRAY['National Leasing'])`, [`${SITE}/National/Trinity`]);
  await db.query(`INSERT INTO crm_companies (id, name, sharepoint_folder_url) VALUES ('c1', 'Landsec', 'https://example.com/landsec')`);
  await db.query(`INSERT INTO property_schemes (id, name, property_id, sharepoint_folder_url) VALUES ('s1', 'Gunwharf', 'p1', $1)`, [`${SITE}/National/Bluewater/Plan.pdf`]);
  items.trinity = { name: "Trinity", folder: true, path: "BGP - Share Drive/National", webUrl: `${SITE}/National/Trinity` };
  shares[shareOf(`${SITE}/National/Trinity`)] = "trinity";
  shares[shareOf(`${SITE}/National/Bluewater/Plan.pdf`)] = "plan";
  const asked: GraphRequest[] = [];
  setGraphTransport(async r => {
    asked.push(r);
    const reply = (status: number, body: any): GraphResponse => ({ status, body, location: null, retryAfter: null });
    if (r.url.includes("/sites/brucegillinghampollardlimited.sharepoint.com:/sites/BGP")) return reply(200, { id: "site-1" });
    if (r.url.includes("/sites/site-1/drives")) return reply(200, { value: [{ id: DRIVE, name: "Documents" }] });
    if (r.url.includes(`/drives/${DRIVE}/root?`)) return reply(200, { id: "root-1" });
    if (r.url.includes(`/drives/${DRIVE}/root:/`)) return reply(404, { error: {} });
    if (r.url.includes("/root/search(q='Landsec')")) return reply(200, { value: [
      { id: "landsec", name: "Landsec", folder: { childCount: 36 }, parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:/BGP - Share Drive/National/National` } },
      { id: "landsec-old", name: "Landsec", folder: {}, parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:/BGP share drive` } },
    ] });
    if (r.url.includes("/root/search(")) return reply(200, { value: [] });
    return answer(r);
  });
  let staff: { userId: string; name: string; email: string } | null = { userId: "u1", name: "Victoria Broadhead", email: "victoria@brucegillinghampollard.com" };
  const app = express();
  app.use(express.json());
  app.use(foldersMigrationRouter({
    db, auth: (_req, _res, next) => next(), admin: (_req, _res, next) => next(),
    staff: async () => staff, microsoft: async () => ({ token: "victoria-token", account: me.account }),
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const preview = (await send("GET", "/api/admin/folders/migration")).body;
    const rowOf = (column: string, recordId: string, key = "") => preview.rows.find((r: any) => r.column === column && r.recordId === recordId && r.key === key);
    assert.equal(rowOf("crm_properties.sharepoint_folder_url", "p3").status, "opens");
    assert.equal(rowOf("crm_properties.sharepoint_folder_url", "p3").entry.itemId, "trinity");
    assert.equal(rowOf("crm_properties.sharepoint_folder_url", "p2").status, "missing");
    assert.equal(rowOf("crm_properties.sharepoint_team_folders", "p2", "Leases").status, "linked", "already in Folders on that record");
    assert.equal(rowOf("crm_properties.sharepoint_team_folders", "p2", "Investment").status, "missing");
    const path = rowOf("crm_properties.folder_teams", "p3", "National Leasing");
    assert.deepEqual([path.value, path.kind, path.status], ["BGP share drive/National Leasing/Trinity Leeds", "path", "missing"]);
    assert.equal(rowOf("crm_companies.sharepoint_folder_url", "c1").status, "outside");
    assert.ok(!asked.some(r => r.url.includes("example.com") || r.url.includes(shareOf("https://example.com/landsec"))), "an address outside BGP's SharePoint is never opened");
    assert.equal(rowOf("crm_deals.sharepoint_link", "d1").status, "opens");
    assert.equal(rowOf("property_schemes.sharepoint_folder_url", "s1").status, "not_folder");
    assert.equal(preview.rows.filter((r: any) => r.recordId === "d2").length, 0, "text that is not an address is not a row");
    assert.ok(asked.every(r => r.token === "victoria-token"), "every address is opened as the admin");
    // A folder of the same name in BGP - Share Drive, for a record nothing of whose opens: a suggestion only.
    assert.deepEqual(preview.suggestions.map((s: any) => [s.recordId, s.entry.itemId, s.entry.path]), [["c1", "landsec", "BGP - Share Drive / National / National / Landsec"]]);
    assert.equal(preview.readers.length > 0, true);

    // Apply: the admin's own preview, within the hour, the ticked rows that open.
    const ids = [rowOf("crm_properties.sharepoint_folder_url", "p3").id, rowOf("crm_deals.sharepoint_link", "d1").id, rowOf("crm_properties.sharepoint_folder_url", "p2").id];
    staff = { userId: "u2", name: "Someone else", email: "someone@brucegillinghampollard.com" };
    assert.equal((await send("POST", "/api/admin/folders/migration/apply", { ids, previewedAt: preview.previewedAt })).status, 409);
    staff = { userId: "u1", name: "Victoria Broadhead", email: "victoria@brucegillinghampollard.com" };
    assert.equal((await send("POST", "/api/admin/folders/migration/apply", { ids, previewedAt: "2026-01-01T00:00:00.000Z" })).status, 409);
    const applied = (await send("POST", "/api/admin/folders/migration/apply", { ids, previewedAt: preview.previewedAt })).body;
    assert.deepEqual([applied.linked, applied.already, applied.skipped.map((s: any) => s.why)], [2, 0, ["It does not open to a folder."]]);
    const made = (await db.query(`SELECT record_type, record_id, item_id, label, source FROM record_folders WHERE source LIKE 'migrated:%' AND removed_at IS NULL ORDER BY record_id`)).rows;
    assert.deepEqual(made.map(r => [r.record_type, r.record_id, r.item_id, r.label, r.source]), [
      ["deal", "d1", "bluewater", "Bluewater", "migrated:crm_deals.sharepoint_link"],
      ["property", "p3", "trinity", "Trinity", "migrated:crm_properties.sharepoint_folder_url"],
    ]);
    const logged = (await db.query(`SELECT action, ms_account, detail FROM folder_actions WHERE detail->>'batch' = $1`, [applied.batch])).rows;
    assert.deepEqual(logged.map(l => [l.action, l.ms_account]), [["link", me.account], ["link", me.account]]);
    // The transaction's old link no longer shows beside its new one; the old column is untouched.
    const d1 = (await folderRecord(db, "deal", "d1"))!;
    let view = await readRecordFolders(db, d1, { userId: "u1", token: null });
    assert.deepEqual(view.folders.map(f => [f.label, f.legacy]), [["Leases", false], ["Bluewater", false]]);
    assert.equal((await db.query(`SELECT sharepoint_link FROM crm_deals WHERE id = 'd1'`)).rows[0].sharepoint_link, `${SITE}/National/Bluewater`);
    // Applied again: nothing new, and nothing recorded for an undo.
    assert.equal((await send("POST", "/api/admin/folders/migration/apply", { ids, previewedAt: preview.previewedAt })).body.already, 2);

    // Undo: the batch's links come out, and the old link shows again.
    const undone = (await send("POST", "/api/admin/folders/migration/undo", { batch: applied.batch })).body;
    assert.equal(undone.removed, 2);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM record_folders WHERE source LIKE 'migrated:%' AND removed_at IS NULL`)).rows[0].n, 0);
    view = await readRecordFolders(db, d1, { userId: "u1", token: null });
    assert.deepEqual(view.folders.map(f => [f.label, f.legacy]), [["Leases", false], ["Transaction link", true]]);
    assert.equal((await send("POST", "/api/admin/folders/migration/undo", { batch: applied.batch })).status, 409);
    const runs = (await send("GET", "/api/admin/folders/migration/runs")).body.runs;
    assert.deepEqual(runs.filter((r: any) => r.batch === applied.batch).map((r: any) => [r.rows.length, !!r.undoneAt]), [[2, true]]);

    // Not staff signed in as themselves: refused before anything is read.
    staff = null;
    assert.equal((await send("GET", "/api/admin/folders/migration")).status, 403);
  } finally {
    server.close();
    setGraphTransport(async r => answer(r));
  }
});
