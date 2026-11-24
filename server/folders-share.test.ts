// Folders shared with a client, following a folder, and a company merge's
// folders (Woody, 24 November 2026: decisions 6 and 7 of
// docs/folders-review-2026-11-20.md). The shared rules; the client data
// room's read of a shared folder, held below it (a stand-in for Graph); the
// routes' gate; and, on a real PostgreSQL in a throwaway schema, who a folder
// may be shared with, sharing and stopping, what a client login is shown, and
// a company merge. Nothing here calls Microsoft. The SQL part is skipped unless
// FOLDERS_DATABASE_URL names a LOCAL database:
//   FOLDERS_DATABASE_URL=postgresql://postgres:qa-local-pg@127.0.0.1:5432/postgres \
//     node --import tsx --test server/folders-share.test.ts
import "./test-database-url";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
import pg from "pg";
import {
  SHAREABLE_RECORD_TYPES, driveItemPath, insideSharedFolder, isShareableRecordType, sharedLinkVisible, sharedPathParts, sharedRootProblem,
} from "../shared/folder-share";
import { FOLDER_ACTIONS } from "../shared/folders";
import { forgetLibrary, setGraphTransport, type GraphRequest, type GraphResponse, type GraphTransport } from "./folders/graph";
import { foldersRouter, STAFF_ONLY } from "./folders/routes";
import { clientSharedFolders, shareFolderLink, shareOptions, withSharing, type ClientShareChecks } from "./folders/share";
import { moveCompanyFolders } from "./folders/merge";

const DRIVE = "b!library-1";
const ok = (body: any, extra: Partial<GraphResponse> = {}): GraphResponse => ({ status: 200, body, location: null, retryAfter: null, ...extra });
// Microsoft is never called from a test: each test that needs Graph stands in for it, and anything else fails.
const refuse: GraphTransport = async r => { throw new Error(`Microsoft was called: ${r.url}`); };
setGraphTransport(refuse);

// ── The shared rules ────────────────────────────────────────────────────
test("only a property's, a transaction's or a company's folder is shared", () => {
  assert.deepEqual([...SHAREABLE_RECORD_TYPES], ["property", "deal", "company"]);
  for (const t of ["scheme", "pla_matter", "pathway_run", "links", undefined]) assert.equal(isShareableRecordType(t), false);
  for (const a of ["follow", "unfollow", "share_client", "unshare_client"]) assert.ok((FOLDER_ACTIONS as readonly string[]).includes(a), `${a} is a folder action`);
});

test("a path below a shared folder: names only, never . or .., nothing SharePoint does not take", () => {
  assert.deepEqual(sharedPathParts(undefined), []);
  assert.deepEqual(sharedPathParts(""), []);
  assert.deepEqual(sharedPathParts("Leases/2026 renewals"), ["Leases", "2026 renewals"]);
  assert.deepEqual(sharedPathParts("Rent #3 (100%).pdf"), ["Rent #3 (100%).pdf"]);
  assert.deepEqual(sharedPathParts("%2E%2E"), ["%2E%2E"], "an encoded name is a name, read as itself");
  for (const bad of ["..", "a/../b", "./a", "a//b", "/a", "a/", "a\\b", "a:b", "a?b", "a\u0000b", " a", "a ", "x".repeat(401)]) {
    assert.equal(sharedPathParts(bad), null, JSON.stringify(bad));
  }
  assert.equal(sharedPathParts(["a", "b"]), null, "an address with the path twice");
  assert.equal(sharedPathParts(Array.from({ length: 31 }, () => "a").join("/")), null, "too deep");
});

test("the shared folder is read again: a folder, never a drive's top or the whole of BGP - Share Drive; an item is held below it", () => {
  const folder = { id: "bw", name: "Bluewater", folder: {}, parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:/BGP - Share Drive/National` } };
  assert.equal(sharedRootProblem(folder, DRIVE), null);
  assert.equal(driveItemPath(folder), `/drives/${DRIVE.toLowerCase()}/root:/bgp - share drive/national/bluewater`);
  assert.match(sharedRootProblem({ ...folder, folder: undefined, file: {} }, DRIVE)!, /not a folder/);
  assert.match(sharedRootProblem({ ...folder, root: {} }, DRIVE)!, /top/);
  assert.match(sharedRootProblem(folder, "b!another")!, /another drive/);
  assert.match(sharedRootProblem({ id: "sd", name: "BGP - Share Drive", folder: {}, parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:` } }, DRIVE)!, /whole of BGP - Share Drive/);
  const root = { driveId: DRIVE, path: driveItemPath(folder)! };
  const child = (path: string, name: string, driveId = DRIVE) => ({ id: "c", name, parentReference: { driveId, path: `/drives/${DRIVE}/root:/${path}` } });
  assert.equal(insideSharedFolder(root, child("BGP - Share Drive/National/Bluewater", "Leases")), true);
  assert.equal(insideSharedFolder(root, child("BGP - Share Drive/National/Bluewater/Leases", "Lease.pdf")), true);
  assert.equal(insideSharedFolder(root, child("BGP - Share Drive/National", "Bluewater")), false, "the folder itself is not below it");
  assert.equal(insideSharedFolder(root, child("BGP - Share Drive/National", "Bluewater Old")), false, "a sibling whose name starts the same");
  assert.equal(insideSharedFolder(root, child("BGP - Share Drive/National/Bluewater2", "x")), false);
  assert.equal(insideSharedFolder(root, child("BGP - Share Drive/National", "Landsec Fee Agreement.pdf")), false);
  assert.equal(insideSharedFolder(root, child("BGP - Share Drive/National/Bluewater", "Leases", "b!another")), false, "another drive");
  assert.equal(insideSharedFolder(root, { id: "c", name: "x" }), false, "no place: no");
});

test("what a client login is shown: its company's shares, on records it can open, a company's own never to a login held to schemes", () => {
  const viewer = { scope: "landsec", limited: false };
  const yes = { propertyInScope: true, dealInScope: true };
  const p = { recordType: "property", recordId: "p1", sharedWith: "landsec", removed: false, propertyId: "p1" };
  assert.equal(sharedLinkVisible(p, viewer, yes), true);
  assert.equal(sharedLinkVisible(p, viewer, { ...yes, propertyInScope: false }), false);
  assert.equal(sharedLinkVisible({ ...p, sharedWith: "hammerson" }, viewer, yes), false, "shared with another company");
  assert.equal(sharedLinkVisible({ ...p, sharedWith: null }, viewer, yes), false);
  assert.equal(sharedLinkVisible({ ...p, removed: true }, viewer, yes), false);
  assert.equal(sharedLinkVisible(p, { scope: null, limited: false }, yes), false);
  const d = { recordType: "deal", recordId: "d1", sharedWith: "landsec", removed: false, propertyId: "p1" };
  assert.equal(sharedLinkVisible(d, viewer, yes), true);
  assert.equal(sharedLinkVisible(d, viewer, { ...yes, dealInScope: false }), false);
  assert.equal(sharedLinkVisible({ ...d, propertyId: null }, viewer, yes), false, "a transaction with no property");
  const c = { recordType: "company", recordId: "landsec", sharedWith: "landsec", removed: false, propertyId: null };
  assert.equal(sharedLinkVisible(c, viewer, yes), true);
  assert.equal(sharedLinkVisible(c, { scope: "landsec", limited: true }, yes), false, "a joint agent never sees a company's");
  assert.equal(sharedLinkVisible({ ...c, recordId: "other" }, viewer, yes), false);
  assert.equal(sharedLinkVisible({ ...p, recordType: "scheme" }, viewer, yes), false);
});

// ── The client data room's read of a shared folder ──────────────────────
test("a shared folder is read by its stored ids on the app's token, and only below it", async () => {
  const { sharedFolderItem } = await import("./client-sharepoint");
  const asked: string[] = [];
  const items: Record<string, any> = {
    [`/drives/${DRIVE}/items/bw`]: { id: "bw", name: "Bluewater", folder: {}, parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:/BGP - Share Drive/National` } },
    [`/drives/${DRIVE}/items/bw:/Leases`]: { id: "leases", name: "Leases", folder: {}, parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:/BGP - Share Drive/National/Bluewater` } },
    [`/drives/${DRIVE}/items/bw:/Leases/Lease%201.pdf`]: { id: "lease1", name: "Lease 1.pdf", file: {}, parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:/BGP - Share Drive/National/Bluewater/Leases` } },
    // What Graph would answer if it ever resolved a path out of the folder: refused all the same.
    [`/drives/${DRIVE}/items/bw:/Sneaky`]: { id: "fee", name: "Landsec Fee Agreement.pdf", file: {}, parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:/BGP - Share Drive/National` } },
    [`/drives/${DRIVE}/items/sd`]: { id: "sd", name: "BGP - Share Drive", folder: {}, parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:` } },
  };
  const graphGet = async (path: string) => {
    asked.push(path);
    const key = path.split("?")[0];
    if (key.endsWith("/boom")) throw new Error("Graph API 500: busy");
    if (!items[key]) throw new Error("Graph API 404: itemNotFound");
    return items[key];
  };
  const deps = { graphGet, sharedCache: new Map(), now: () => 1000 };
  const link = { id: "l1", driveId: DRIVE, itemId: "bw" };
  assert.deepEqual(await sharedFolderItem(link, [], deps), { itemId: "bw", name: "Bluewater", isFolder: true });
  assert.deepEqual(await sharedFolderItem(link, ["Leases"], deps), { itemId: "leases", name: "Leases", isFolder: true });
  assert.deepEqual(await sharedFolderItem(link, ["Leases", "Lease 1.pdf"], deps), { itemId: "lease1", name: "Lease 1.pdf", isFolder: false });
  assert.equal(await sharedFolderItem(link, ["Sneaky"], deps), null, "an item outside the folder is never shown");
  assert.equal(await sharedFolderItem(link, ["Missing"], deps), null);
  assert.equal(asked.filter(a => a.startsWith(`/drives/${DRIVE}/items/bw?`)).length, 1, "the folder itself is read once, then kept");
  assert.ok(asked.every(a => a.startsWith(`/drives/${DRIVE}/items/bw`)), "only the stored drive and item, and below it");
  assert.equal(await sharedFolderItem({ id: "l2", driveId: DRIVE, itemId: "sd" }, [], deps), null, "the whole of BGP - Share Drive is never shown");
  assert.equal(await sharedFolderItem({ id: "l3", driveId: DRIVE, itemId: "gone" }, [], deps), null);
  await assert.rejects(sharedFolderItem({ id: "l4", driveId: DRIVE, itemId: "boom" }, [], deps), /500/, "a passing failure is an error, not an empty folder");
});

// ── The routes' gate ────────────────────────────────────────────────────
test("sharing and following are BGP staff's, checked before any token; following needs their own Microsoft 365, sharing too, stopping does not", async () => {
  let staff: { userId: string; name: string; email: string } | null = null;
  let own: { token: string; account: string } | null = null;
  const asked: string[] = [];
  const logged: any[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO folder_actions/.test(sql)) { logged.push(params); return { rows: [] }; }
      throw new Error("no database in this test");
    },
  };
  const calls: GraphRequest[] = [];
  setGraphTransport(async r => { calls.push(r); return r.url.endsWith("/follow") ? ok({ id: "f1" }) : ok(null, { status: 204 }); });
  const app = express();
  app.use(express.json());
  app.use(foldersRouter({ db, auth: (_req, _res, next) => next(), staff: async () => staff, microsoft: async u => { asked.push(u); return own; } }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const routes: [string, string, unknown?][] = [
      ["GET", "/api/folders/links/l1/share"], ["POST", "/api/folders/links/l1/share", { companyId: "c1" }], ["POST", "/api/folders/links/l1/share", { companyId: null }],
      ["POST", `/api/folders/items/${DRIVE}/i1/follow`], ["POST", `/api/folders/items/${DRIVE}/i1/unfollow`],
    ];
    for (const [method, path, body] of routes) {
      const r = await send(method, path, body);
      assert.equal(r.status, 403, `${method} ${path}`);
      assert.equal(r.body.message, STAFF_ONLY);
    }
    assert.deepEqual(asked, [], "no token was asked for anyone who is not staff");
    staff = { userId: "u1", name: "Victoria", email: "victoria@brucegillinghampollard.com" };
    for (const [method, path, body] of [routes[1], routes[3], routes[4]]) {
      const r = await send(method, path, body);
      assert.equal(r.status, 428, `${method} ${path} asks them to connect`);
      assert.equal(r.body.connect, true);
    }
    assert.ok(asked.every(u => u === "u1"), "only their own Microsoft 365");
    // Stopping needs no Microsoft 365: it reaches the database.
    assert.equal((await send("POST", "/api/folders/links/l1/share", { companyId: null })).status, 500);
    own = { token: "own-token", account: "victoria@brucegillinghampollard.com" };
    assert.deepEqual((await send("POST", `/api/folders/items/${DRIVE}/i1/follow`)).body, { following: true });
    assert.deepEqual((await send("POST", `/api/folders/items/${DRIVE}/i1/unfollow`)).body, { following: false });
    assert.deepEqual(calls.map(c => [c.method, c.url, c.token]), [
      ["POST", `https://graph.microsoft.com/v1.0/drives/${DRIVE}/items/i1/follow`, "own-token"],
      ["POST", `https://graph.microsoft.com/v1.0/drives/${DRIVE}/items/i1/unfollow`, "own-token"],
    ]);
    assert.deepEqual(logged.map(l => [l[0], l[1], l[2], l[6]]), [
      ["u1", "victoria@brucegillinghampollard.com", "follow", "i1"], ["u1", "victoria@brucegillinghampollard.com", "unfollow", "i1"],
    ]);
    assert.equal((await send("POST", "/api/folders/items/..%2Fx/i1/follow")).status, 400, "Microsoft's ids only");
  } finally {
    server.close();
    setGraphTransport(refuse);
  }
});

// ── On a real database ──────────────────────────────────────────────────
const databaseUrl = process.env.FOLDERS_DATABASE_URL;
const skip = !databaseUrl ? "set FOLDERS_DATABASE_URL to a local PostgreSQL database to run the sharing SQL"
  : !/@(localhost|127\.0\.0\.1)[:/]|host=%2F|@%2F/.test(databaseUrl) ? "FOLDERS_DATABASE_URL must be a local database" : false;
const schema = `folders_share_test_${process.pid}`;
let db: pg.Pool;
let admin: pg.Pool;
const teamCompany = async (team: string) => ({ landsec: "c-landsec", "gail's": "c-gails" } as Record<string, string>)[team.toLowerCase()] || null;
const me = { userId: "u1", account: "victoria@brucegillinghampollard.com" };

// What SharePoint holds here, by item id, on the staff member's own token.
const shareItems: Record<string, any> = {
  root: { id: "root", name: "root", root: {}, folder: {}, parentReference: { driveId: DRIVE } },
  sd: { id: "sd", name: "BGP - Share Drive", folder: {}, parentReference: { driveId: DRIVE, id: "root", path: `/drives/${DRIVE}/root:` } },
  bw: { id: "bw", name: "Bluewater", folder: {}, parentReference: { driveId: DRIVE, id: "nat", path: `/drives/${DRIVE}/root:/BGP - Share Drive/National` } },
  od: { id: "od", name: "My notes", folder: {}, parentReference: { driveId: "b!onedrive", driveType: "business", id: "odroot", path: "/drives/b!onedrive/root:" } },
};
const sharepoint = async (r: GraphRequest): Promise<GraphResponse> => {
  if (r.url.includes("/sites/brucegillinghampollardlimited.sharepoint.com:/sites/BGP")) return ok({ id: "site-1" });
  if (r.url.includes("/sites/site-1/drives")) return ok({ value: [{ id: DRIVE, name: "Documents" }] });
  if (r.url.includes(`/drives/${DRIVE}/root?`)) return ok({ id: "root" });
  const m = r.url.match(/\/drives\/[^/]+\/items\/([^/?]+)\?/);
  const it = m ? shareItems[m[1]] : null;
  return it ? ok(it) : { status: 404, body: { error: {} }, location: null, retryAfter: null };
};

before(async () => {
  if (skip) return;
  admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  db = new pg.Pool({ connectionString: databaseUrl, max: 2, options: `-c search_path=${schema},pg_catalog` });
  await db.query(`CREATE TABLE users (id varchar PRIMARY KEY, name text, email text, role text, team text, is_active boolean)`);
  await db.query(`CREATE TABLE crm_companies (id varchar PRIMARY KEY, name text, merged_into_id varchar)`);
  await db.query(`CREATE TABLE crm_properties (id varchar PRIMARY KEY, name text NOT NULL, landlord_id varchar)`);
  await db.query(`CREATE TABLE crm_company_properties (company_id varchar, property_id varchar)`);
  await db.query(`CREATE TABLE crm_deals (id varchar PRIMARY KEY, name text, property_id varchar)`);
  // record_folders and folder_actions exactly as the app makes them at boot, with the share columns.
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const boot = [...index.matchAll(/`((?:CREATE TABLE IF NOT EXISTS (?:record_folders|folder_actions)|CREATE (?:UNIQUE )?INDEX IF NOT EXISTS record_folders_|ALTER TABLE record_folders ADD COLUMN IF NOT EXISTS )[^`]*)`/g)].map(m => m[1]);
  assert.equal(boot.filter(s => s.startsWith("ALTER TABLE record_folders")).length, 3, "the three share columns");
  for (const sql of boot) await db.query(sql);
  await db.query(`INSERT INTO users VALUES
    ('u1', 'Victoria Broadhead', 'victoria@brucegillinghampollard.com', 'Admin', 'Investment', true),
    ('u2', 'Mark Warne', 'mark@landsec.com', 'Client', 'Landsec', true),
    ('u3', 'Joint agent', 'ja@cbre.com', 'Client', 'Landsec', true),
    ('u4', 'Gone', 'old@gails.com', 'Client', 'Gail''s', false)`);
  await db.query(`INSERT INTO crm_companies VALUES ('c-landsec', 'Landsec', NULL), ('c-hammerson', 'Hammerson', NULL), ('c-gails', 'Gail''s', NULL),
    ('c-landsec-dup', 'Landsec', 'c-landsec')`);
  await db.query(`INSERT INTO crm_properties VALUES ('p1', 'Bluewater', 'c-landsec'), ('p2', 'Brent Cross', 'c-hammerson'), ('p3', 'Trinity Leeds', NULL)`);
  await db.query(`INSERT INTO crm_company_properties VALUES ('c-landsec-dup', 'p1'), ('c-hammerson', 'p1'), ('c-landsec', 'p3')`);
  await db.query(`INSERT INTO crm_deals VALUES ('d1', 'Gail''s · Unit 12', 'p1'), ('d2', 'No property yet', NULL)`);
  const link = (id: string, type: string, record: string, item: string, label: string) =>
    db.query(`INSERT INTO record_folders (id, record_type, record_id, drive_id, item_id, label, source) VALUES ($1, $2, $3, $4, $5, $6, 'picked')`,
      [id, type, record, item === "od" ? "b!onedrive" : DRIVE, item, label]);
  await link("l-bw", "property", "p1", "bw", "Bluewater docs");
  await link("l-sd", "property", "p1", "sd", "Everything");
  await link("l-od", "property", "p1", "od", "My notes");
  await link("l-deal", "deal", "d1", "bw", "Unit 12");
  await link("l-nodeal", "deal", "d2", "bw", "Loose");
  await link("l-co", "company", "c-landsec", "bw", "Landsec account");
  await link("l-gails", "company", "c-gails", "bw", "Gail's account");
  await link("l-scheme", "scheme", "s1", "bw", "Scheme folder");
  await link("l-brent", "property", "p2", "bw", "Brent Cross docs");
});
after(async () => {
  setGraphTransport(refuse);
  if (skip) return;
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

test("who a folder may be shared with: the companies with client logins that can open its property, or the company itself", { skip }, async () => {
  const p1 = await shareOptions(db, "l-bw", { teamCompany });
  assert.deepEqual(p1, { sharedWith: null, candidates: [{ id: "c-landsec", name: "Landsec" }], why: null },
    "the landlord with logins; not a company with no logins, nor one merged away");
  assert.deepEqual((await shareOptions(db, "l-deal", { teamCompany })).candidates, [{ id: "c-landsec", name: "Landsec" }], "a transaction, through its property");
  assert.match((await shareOptions(db, "l-nodeal", { teamCompany })).why!, /Link this transaction to a property first/);
  assert.deepEqual((await shareOptions(db, "l-co", { teamCompany })).candidates, [{ id: "c-landsec", name: "Landsec" }], "a company, with itself");
  assert.match((await shareOptions(db, "l-gails", { teamCompany })).why!, /no client logins/, "its only login is inactive");
  assert.match((await shareOptions(db, "l-scheme", { teamCompany })).why!, /Only folders on a property, a transaction or a company/);
  assert.match((await shareOptions(db, "l-brent", { teamCompany })).why!, /No client with logins/);
  await assert.rejects(shareOptions(db, "nope", { teamCompany }), (e: any) => e.status === 404);
});

test("sharing: the record's client only, the folder read again as the person, never a OneDrive or BGP - Share Drive itself; each change logged", { skip }, async () => {
  setGraphTransport(sharepoint);
  forgetLibrary();
  const actor = { ...me, token: "victoria-token" };
  await assert.rejects(shareFolderLink(db, actor, "l-bw", "c-hammerson", { teamCompany }), (e: any) => e.status === 400, "a company that can't open it");
  await assert.rejects(shareFolderLink(db, { ...me, token: null }, "l-bw", "c-landsec", { teamCompany }), (e: any) => e.status === 428);
  await assert.rejects(shareFolderLink(db, actor, "l-od", "c-landsec", { teamCompany }), (e: any) => e.status === 400 && /BGP's SharePoint library/.test(e.message));
  await assert.rejects(shareFolderLink(db, actor, "l-sd", "c-landsec", { teamCompany }), (e: any) => e.status === 400 && /whole of BGP - Share Drive/.test(e.message));
  const shared = await shareFolderLink(db, actor, "l-bw", "c-landsec", { teamCompany });
  assert.deepEqual(shared.sharedWith, { id: "c-landsec", name: "Landsec" });
  const row = (await db.query(`SELECT shared_with_company_id, shared_by, shared_at FROM record_folders WHERE id = 'l-bw'`)).rows[0];
  assert.deepEqual([row.shared_with_company_id, row.shared_by, !!row.shared_at], ["c-landsec", "u1", true]);
  await shareFolderLink(db, actor, "l-deal", "c-landsec", { teamCompany });
  await shareFolderLink(db, actor, "l-co", "c-landsec", { teamCompany });
  // The record's view says who each is shared with.
  const view = await withSharing(db, {
    record: { type: "property", id: "p1", name: "Bluewater" }, connected: true,
    folders: [{ id: "l-bw", legacy: false } as any, { id: "l-sd", legacy: false } as any, { id: "legacy:x", legacy: true } as any], inherited: [],
  });
  assert.deepEqual(view.folders.map(f => f.sharedWith), [{ id: "c-landsec", name: "Landsec" }, null, undefined]);
  // Stopping needs no Microsoft 365.
  const stopped = await shareFolderLink(db, { ...me, token: null }, "l-deal", null, { teamCompany });
  assert.equal(stopped.sharedWith, null);
  const log = (await db.query(`SELECT action, ok, ms_account, record_id, item_id, detail FROM folder_actions ORDER BY at, id`)).rows;
  assert.deepEqual(log.map(l => [l.action, l.ok, l.record_id]), [
    ["share_client", false, "p1"], ["share_client", false, "p1"], ["share_client", true, "p1"], ["share_client", true, "d1"], ["share_client", true, "c-landsec"], ["unshare_client", true, "d1"],
  ]);
  assert.equal(log[2].detail.companyName, "Landsec");
  assert.equal(log[2].ms_account, me.account);
});

test("what a client login is shown: its company's shared folders on records it can open; a joint agent only at its schemes, never a company's", { skip }, async () => {
  setGraphTransport(sharepoint);
  const actor = { ...me, token: "victoria-token" };
  await shareFolderLink(db, actor, "l-deal", "c-landsec", { teamCompany });
  const ownsProperty = async (id: string) => (await db.query(
    `SELECT 1 FROM crm_properties WHERE id = $1 AND landlord_id = 'c-landsec' UNION ALL SELECT 1 FROM crm_company_properties WHERE company_id = 'c-landsec' AND property_id = $1`, [id])).rows.length > 0;
  const checks = (limit: string[] | null): ClientShareChecks => ({
    limited: limit !== null,
    propertyInScope: async id => (limit === null || limit.includes(id)) && ownsProperty(id),
    dealInScope: async id => id === "d1",
  });
  const labels = (rows: { shown: { label: string } }[]) => rows.map(r => r.shown.label);
  assert.deepEqual(labels(await clientSharedFolders(db, "c-landsec", checks(null))), ["Landsec account", "Bluewater docs", "Unit 12"]);
  const all = await clientSharedFolders(db, "c-landsec", checks(null));
  assert.deepEqual(all[2].shown, { id: "l-deal", label: "Unit 12", recordType: "deal", recordName: "Gail's · Unit 12", propertyId: "p1", propertyName: "Bluewater" });
  assert.ok(!("driveId" in all[0].shown) && !("itemId" in all[0].shown), "a client is never sent the ids");
  assert.deepEqual(labels(await clientSharedFolders(db, "c-landsec", checks(null), { propertyId: "p1" })), ["Bluewater docs", "Unit 12"]);
  assert.deepEqual(labels(await clientSharedFolders(db, "c-landsec", checks(null), { companyOnly: true })), ["Landsec account"]);
  assert.deepEqual(labels(await clientSharedFolders(db, "c-landsec", checks(["p1"]))), ["Bluewater docs", "Unit 12"], "a joint agent at Bluewater: not the company's");
  assert.deepEqual(labels(await clientSharedFolders(db, "c-landsec", checks(["p3"]))), [], "a joint agent elsewhere: nothing");
  assert.deepEqual(labels(await clientSharedFolders(db, "c-hammerson", checks(null))), [], "another company: nothing");
  assert.deepEqual(labels(await clientSharedFolders(db, "c-landsec", checks(null), { linkId: "l-bw" })), ["Bluewater docs"]);
  // A transaction moved off the property, a link unlinked: gone at once.
  await db.query(`UPDATE crm_deals SET property_id = 'p2' WHERE id = 'd1'`);
  assert.deepEqual(labels(await clientSharedFolders(db, "c-landsec", checks(null))), ["Landsec account", "Bluewater docs"]);
  await db.query(`UPDATE crm_deals SET property_id = 'p1' WHERE id = 'd1'`);
  await db.query(`UPDATE record_folders SET removed_at = now() WHERE id = 'l-co'`);
  assert.deepEqual(labels(await clientSharedFolders(db, "c-landsec", checks(null))), ["Bluewater docs", "Unit 12"]);
  await db.query(`UPDATE record_folders SET removed_at = NULL WHERE id = 'l-co'`);
});

test("a company merge moves its folder links and the folders shared with it; a folder both link is not doubled", { skip }, async () => {
  await db.query(`INSERT INTO crm_companies VALUES ('c-ls2', 'Land Securities', NULL)`);
  await db.query(`INSERT INTO record_folders (id, record_type, record_id, drive_id, item_id, label, source, shared_with_company_id) VALUES
    ('m-both', 'company', 'c-ls2', $1, 'bw', 'Same folder', 'picked', 'c-ls2'),
    ('m-own', 'company', 'c-ls2', $1, 'hots', 'Heads of terms', 'picked', NULL),
    ('m-prop', 'property', 'p3', $1, 'tl', 'Trinity', 'picked', 'c-ls2')`, [DRIVE]);
  await db.query(`UPDATE record_folders SET shared_with_company_id = NULL WHERE id = 'l-co'`);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const moved = await moveCompanyFolders(client, "c-ls2", "c-landsec");
    await client.query("COMMIT");
    assert.deepEqual(moved, { "record_folders.record_id": 1, "record_folders.shared_with_company_id": 2 });
  } finally { client.release(); }
  const rows = (await db.query(`SELECT id, record_id, removed_at IS NULL AS live, shared_with_company_id FROM record_folders WHERE id IN ('m-both', 'm-own', 'm-prop', 'l-co') ORDER BY id`)).rows;
  assert.deepEqual(rows.map(r => [r.id, r.record_id, r.live, r.shared_with_company_id]), [
    ["l-co", "c-landsec", true, "c-landsec"], ["m-both", "c-landsec", false, "c-landsec"], ["m-own", "c-landsec", true, null], ["m-prop", "p3", true, "c-landsec"],
  ], "the keeper's own link takes the share; the merged one's copy is unlinked; its own link moves; a property folder shared with it is shared with the keeper");
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM record_folders WHERE record_type = 'company' AND record_id = 'c-ls2'`)).rows[0].n, 0);
  // A database without the share columns: nothing moves and the merge goes on.
  const fake = { query: async (sql: string) => { if (/^(SAVEPOINT|ROLLBACK)/.test(sql)) return { rows: [] }; throw Object.assign(new Error("column does not exist"), { code: "42703" }); } };
  assert.deepEqual(await moveCompanyFolders(fake, "a", "b"), {});
});
