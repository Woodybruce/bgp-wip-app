// Folders: one engine (Woody, 24 November 2026: "go ahead with the folder
// suggestion"; docs/folders-review-2026-11-20.md). The shared rules, the one
// door to Microsoft (with a stand-in for Graph: nothing here calls Microsoft),
// and the routes' gate: BGP staff signed in as themselves, on their own
// Microsoft 365. The SQL is run against a real database in
// server/folders-postgres.test.ts.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  FOLDER_COLOURS, FOLDER_RECORD_TYPES, PROPERTY_FOLDER_TEMPLATE, folderColourKey, folderDisplayPath, folderLabel,
  folderStatusFromGraph, folderTemplate, folderUrlKey, isFolderRecordType, isGraphId, itemNameProblem, legacyFolderKey,
  moveLinkTo, pathFromWebUrl, driveKindOf,
} from "../shared/folders";
import {
  GraphError, bgpLibrary, createFolderTree, driveEntry, forgetLibrary, graph, graphTarget, searchFolders, setGraphTransport,
  type GraphRequest, type GraphResponse,
} from "./folders/graph";
import { foldersRouter, sortEntries, STAFF_ONLY } from "./folders/routes";

const DRIVE = "b!TkfPTD5QkkaKK2ThhYzkbeZV8L-Ly5xIm6a79Utuotf_bKhaqTNzTLlcjCkAWwlf";
const ok = (body: any, extra: Partial<GraphResponse> = {}): GraphResponse => ({ status: 200, body, location: null, retryAfter: null, ...extra });

// ── The shared rules ────────────────────────────────────────────────────
test("the records a folder can hang on", () => {
  assert.deepEqual([...FOLDER_RECORD_TYPES], ["property", "deal", "company", "scheme", "pla_matter", "pathway_run"]);
  assert.equal(isFolderRecordType("deal"), true);
  assert.equal(isFolderRecordType("links"), false);
  assert.equal(isFolderRecordType(undefined), false);
});

test("Microsoft's ids, labels and the six colours", () => {
  assert.equal(isGraphId(DRIVE), true);
  assert.equal(isGraphId("01ABCDEFGHIJKL"), true);
  assert.equal(isGraphId("../../etc"), false);
  assert.equal(isGraphId("a b"), false);
  assert.equal(isGraphId(""), false);
  assert.equal(folderLabel("  Leases   2026 "), "Leases 2026");
  assert.equal(folderLabel(""), null);
  assert.equal(folderLabel("x".repeat(81)), null);
  assert.equal(FOLDER_COLOURS.length, 6);
  assert.equal(folderColourKey("sage"), "sage");
  assert.equal(folderColourKey("red"), null);
  assert.equal(folderColourKey(null), null);
  // The colour classes are the design tokens (Tailwind keeps whole class names only).
  for (const c of FOLDER_COLOURS) assert.equal(c.dot, `bg-folder-${c.key}`);
});

test("a name SharePoint takes, said in plain words when it does not", () => {
  assert.equal(itemNameProblem("Leases"), null);
  assert.equal(itemNameProblem("Heads of Terms & Leases 2026"), null);
  assert.equal(itemNameProblem("  "), "Give it a name.");
  assert.match(itemNameProblem("Rent: 2026")!, /does not take/);
  assert.match(itemNameProblem("a/b")!, /does not take/);
  assert.equal(itemNameProblem("Draft."), "A name cannot end with a full stop.");
  assert.match(itemNameProblem("CON")!, /that name/);
  assert.match(itemNameProblem("con.txt")!, /that name/);
  assert.match(itemNameProblem("~$lock")!, /that name/);
  assert.match(itemNameProblem("x".repeat(251))!, /at most 250/);
});

test("templates: an empty folder, or the client tree's five property folders (decision 3)", () => {
  assert.deepEqual(folderTemplate(undefined), []);
  assert.deepEqual(folderTemplate("empty"), []);
  assert.deepEqual([...folderTemplate("property")!], [
    "01 Instructions & appointments", "02 Letting & marketing", "03 Tenancy schedules & units", "04 Property media", "99 Archive",
  ]);
  assert.deepEqual([...PROPERTY_FOLDER_TEMPLATE], [...folderTemplate("property")!]);
  assert.equal(folderTemplate("London Retail"), null, "the templates keyed by retired team names are not offered");
});

test("where a folder sits, for showing", () => {
  const base = { parentReference: { driveId: DRIVE, driveType: "documentLibrary", path: `/drives/${DRIVE}/root:/BGP - Share Drive/National/National` } };
  assert.equal(folderDisplayPath({ ...base, name: "Landsec" }), "BGP - Share Drive / National / National / Landsec");
  assert.equal(folderDisplayPath({ name: "Bluewater", parentReference: { path: `/drives/${DRIVE}/root:/BGP%20-%20Share%20Drive` } }), "BGP - Share Drive / Bluewater");
  assert.equal(folderDisplayPath({ name: "Top", parentReference: { path: `/drives/${DRIVE}/root:` } }), "Top");
  assert.equal(folderDisplayPath({ name: "Notes", parentReference: { driveType: "business", path: `/drive/root:/Work` } }), "My OneDrive / Work / Notes");
  assert.equal(folderDisplayPath({ name: "root", root: {}, parentReference: { driveType: "business" } }), "My OneDrive");
  // No parent path (a search result): read from the address.
  assert.equal(folderDisplayPath({ name: "Bluewater", webUrl: "https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared%20Documents/BGP%20-%20Share%20Drive/National/Bluewater" }),
    "BGP - Share Drive / National / Bluewater");
  assert.deepEqual(pathFromWebUrl("https://brucegillinghampollardlimited-my.sharepoint.com/personal/woody_bgp/Documents/Deals/Fortis"), ["Deals", "Fortis"]);
  assert.equal(pathFromWebUrl("https://example.com/a/b"), null);
  assert.equal(driveKindOf("business"), "onedrive");
  assert.equal(driveKindOf("documentLibrary"), "library");
});

test("a link's status from Graph, an address however it is spelled, and an old column's key", () => {
  assert.equal(folderStatusFromGraph(404), "missing");
  assert.equal(folderStatusFromGraph(403), "no_access");
  assert.equal(folderStatusFromGraph(200), "ok");
  assert.equal(folderUrlKey("https://x.sharepoint.com/sites/BGP/Shared%20Documents/A/?web=1"), "https://x.sharepoint.com/sites/bgp/shared documents/a");
  assert.equal(legacyFolderKey("crm_deals.sharepoint_link", "d1", "", " https://x/y "), "crm_deals.sharepoint_link|d1||https://x/y");
});

test("moving a link up or down keeps the rest in their order", () => {
  assert.deepEqual(moveLinkTo(["a", "b", "c", "d"], "c", 0), ["c", "a", "b", "d"]);
  assert.deepEqual(moveLinkTo(["a", "b", "c", "d"], "a", 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveLinkTo(["a", "b", "c"], "b", 99), ["a", "c", "b"]);
  assert.deepEqual(moveLinkTo(["a", "b"], "z", 0), ["a", "b"]);
  assert.deepEqual(sortEntries([{ isFolder: false, name: "a.pdf" }, { isFolder: true, name: "Unit 10" }, { isFolder: true, name: "Unit 2" }]).map(e => e.name), ["Unit 2", "Unit 10", "a.pdf"]);
});

// ── The one door to Microsoft ───────────────────────────────────────────
const calls: GraphRequest[] = [];
let answer: (r: GraphRequest) => GraphResponse = () => ok({});
before(() => setGraphTransport(async r => { calls.push(r); return answer(r); }));
after(() => setGraphTransport(null));

test("Graph with the person's token; a SharePoint upload or monitor address with none; nothing else", async () => {
  assert.deepEqual(graphTarget("/me/drive"), { url: "https://graph.microsoft.com/v1.0/me/drive", withToken: true });
  assert.deepEqual(graphTarget("https://graph.microsoft.com/v1.0/drives/x/items/y/children?$skiptoken=1"), { url: "https://graph.microsoft.com/v1.0/drives/x/items/y/children?$skiptoken=1", withToken: true });
  assert.equal(graphTarget("https://brucegillinghampollardlimited.sharepoint.com/_api/v2.0/monitor/abc")!.withToken, false);
  assert.equal(graphTarget("https://brucegillinghampollardlimited-my.sharepoint.com/personal/x/_api/v2.0/uploadSession?guid=1")!.withToken, false);
  assert.equal(graphTarget("https://evil.sharepoint.com/_api/v2.0/monitor/abc"), null, "only BGP's own SharePoint");
  assert.equal(graphTarget("http://graph.microsoft.com/v1.0/me"), null);
  assert.equal(graphTarget("https://example.com/upload"), null);

  calls.length = 0;
  answer = () => ok({});
  await graph({ method: "PUT", url: "https://brucegillinghampollardlimited.sharepoint.com/_api/v2.0/uploadSession?guid=1", token: "person-token" });
  assert.equal(calls[0].token, null, "the person's token never goes to a signed SharePoint address");
  await assert.rejects(graph({ method: "GET", url: "https://example.com/x", token: "person-token" }), /Not a Microsoft address/);
  await assert.rejects(graph({ method: "GET", url: "/me/drive", token: null }), /own token/);
});

test("SharePoint's busy answer is waited out, then given back", async () => {
  calls.length = 0;
  let n = 0;
  answer = () => (++n < 3 ? ok(null, { status: 429, retryAfter: 0 }) : ok({ id: "x" }));
  const res = await graph({ method: "GET", url: "/me/drive", token: "t" });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 3);
  n = -10;
  answer = () => ok(null, { status: 503, retryAfter: 0 });
  assert.equal((await graph({ method: "GET", url: "/me/drive", token: "t" })).status, 503, "two waits, then the answer");
});

test("the BGP library is looked up once and kept", async () => {
  forgetLibrary();
  calls.length = 0;
  answer = r => r.url.includes("/sites/brucegillinghampollardlimited.sharepoint.com:/sites/BGP") ? ok({ id: "site-1" })
    : r.url.includes("/sites/site-1/drives") ? ok({ value: [{ id: "drive-x", name: "Site Assets" }, { id: DRIVE, name: "Documents", webUrl: "https://lib" }] })
    : r.url.includes(`/drives/${DRIVE}/root`) ? ok({ id: "root-1" }) : ok({}, { status: 404 });
  const lib = await bgpLibrary("t");
  assert.deepEqual(lib, { siteId: "site-1", driveId: DRIVE, itemId: "root-1", name: "Documents", webUrl: "https://lib" });
  const made = calls.length;
  await bgpLibrary("t");
  assert.equal(calls.length, made, "kept, not looked up again");
});

test("search finds folders only, in the library and the person's OneDrive, quotes made safe", async () => {
  calls.length = 0;
  answer = r => {
    if (r.url.includes(`/drives/${DRIVE}/root/search`)) return ok({ value: [
      { id: "f1", name: "Bluewater", folder: { childCount: 4 }, parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:/BGP - Share Drive/National` } },
      { id: "p1", name: "Bluewater plan.pdf", file: {}, parentReference: { driveId: DRIVE } },
    ] });
    if (r.url.startsWith("https://graph.microsoft.com/v1.0/me/drive/root/search")) return ok({ value: [
      { id: "o1", name: "Bluewater notes", folder: {}, parentReference: { driveId: "od-1", driveType: "business", path: "/drive/root:" } },
      { id: "f1", name: "Bluewater", folder: {}, parentReference: { driveId: DRIVE } },
    ] });
    return ok({}, { status: 404 });
  };
  const found = await searchFolders("t", "St James's", "all");
  assert.ok(calls.some(c => c.url.includes("search(q='St%20James''s')")), "a quote is doubled, the rest encoded");
  assert.deepEqual(found.map(f => [f.itemId, f.path, f.driveKind]), [
    ["f1", "BGP - Share Drive / National / Bluewater", "library"],
    ["o1", "My OneDrive / Bluewater notes", "onedrive"],
  ]);
});

test("a folder tree: the root, then each folder after its parent; one that fails is listed", async () => {
  calls.length = 0;
  let id = 0;
  answer = r => {
    const name = (r.json as any)?.name;
    if (name === "02 Letting & marketing") return ok({ error: {} }, { status: 409 });
    return ok({ id: `new-${++id}`, name, folder: {}, parentReference: { driveId: DRIVE } }, { status: 201 });
  };
  const out = await createFolderTree("t", DRIVE, "parent-1", "Bluewater", PROPERTY_FOLDER_TEMPLATE);
  assert.equal(out.root.itemId, "new-1");
  assert.equal(out.made, 5);
  assert.deepEqual(out.failed, ['02 Letting & marketing: A folder called "02 Letting & marketing" is already there.']);
  assert.equal(calls[0].url, `https://graph.microsoft.com/v1.0/drives/${DRIVE}/items/parent-1/children`);
  assert.equal((calls[0].json as any)["@microsoft.graph.conflictBehavior"], "fail", "never renamed behind the person's back");
  assert.ok(calls.slice(1).every(c => c.url.endsWith("/items/new-1/children")), "the five go inside the new folder");
});

test("a followed folder arrives as a remoteItem and is read from it", () => {
  const e = driveEntry({ id: "local", name: "Leases", remoteItem: { id: "remote-1", folder: { childCount: 2 }, webUrl: "https://w", parentReference: { driveId: DRIVE, driveType: "documentLibrary", path: `/drives/${DRIVE}/root:/BGP - Share Drive` } } });
  assert.deepEqual([e.driveId, e.itemId, e.name, e.isFolder, e.childCount, e.path], [DRIVE, "remote-1", "Leases", true, 2, "BGP - Share Drive / Leases"]);
  assert.equal(new GraphError(404).message, "That folder or file isn't in SharePoint any more: it may have been moved or deleted.");
});

// ── The routes' gate ────────────────────────────────────────────────────
test("every route is BGP staff's, checked before any token; folder actions need the person's own Microsoft 365", async () => {
  const asked: string[] = [];
  let staff: { userId: string; name: string; email: string } | null = null;
  let own: { token: string; account: string } | null = null;
  const db = { query: async () => { throw new Error("no database in this test"); } };
  const app = express();
  app.use(express.json());
  app.use(foldersRouter({
    db, auth: (_req, _res, next) => next(),
    staff: async () => staff,
    microsoft: async userId => { asked.push(userId); return own; },
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const routes: [string, string, unknown?][] = [
      ["GET", "/api/folders/places"], ["GET", `/api/folders/browse?driveId=${DRIVE}&itemId=x`], ["GET", "/api/folders/search?q=blue"],
      ["PATCH", "/api/folders/links/l1", { label: "x" }], ["DELETE", "/api/folders/links/l1"],
      ["GET", "/api/folders/property/p1"], ["POST", "/api/folders/property/p1/links", { driveId: DRIVE, itemId: "x" }],
      ["POST", "/api/folders/deal/d1/create", { driveId: DRIVE, parentId: "x", name: "New" }],
    ];
    for (const [method, path, body] of routes) {
      const r = await send(method, path, body);
      assert.equal(r.status, 403, `${method} ${path} refused`);
      assert.equal(r.body.message, STAFF_ONLY);
    }
    assert.deepEqual(asked, [], "no token was asked for anyone who is not staff");

    staff = { userId: "u1", name: "Victoria", email: "victoria@brucegillinghampollard.com" };
    for (const [method, path, body] of routes.filter(([m, p]) => !p.startsWith("/api/folders/links") && !(m === "GET" && p === "/api/folders/property/p1"))) {
      const r = await send(method, path, body);
      assert.equal(r.status, 428, `${method} ${path} asks them to connect`);
      assert.equal(r.body.connect, true);
    }
    assert.ok(asked.every(id => id === "u1"), "only the person's own Microsoft 365 is asked for");
  } finally {
    server.close();
  }
});
