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
  FOLDER_COLOURS, FOLDER_RECORD_TYPES, MIGRATION_COLUMNS, OLD_FOLDER_READERS, PROPERTY_FOLDER_TEMPLATE, UPLOAD_MAX_BYTES, UPLOAD_PIECE,
  UPLOAD_SESSION_ABOVE, contentRange, copyState, folderColourKey, folderDisplayPath, folderLabel, folderStatusFromGraph, folderTemplate,
  folderUrlKey, inviteEmails, isFolderRecordType, isGraphId, itemNameProblem, legacyFolderKey, migrationApplyRefusal, migrationRowId,
  migrationStatus, moveLinkTo, needsUploadSession, parseContentRange, pathFromWebUrl, pieceProblem, driveKindOf, teamFolderPath, uploadPieces,
  uploadProblem,
} from "../shared/folders";
import { suggestionFits } from "./folders/migration";
import {
  GraphError, bgpLibrary, copyProgress, createFolderTree, deleteItem, driveEntry, forgetLibrary, graph, graphTarget, moveItem, previewUrl,
  renameItem, searchFolders, setGraphTransport, shareLink, startCopy, startUploadSession, uploadPiece, uploadSmall,
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
      ["POST", `/api/folders/items/${DRIVE}/i1/rename`, { name: "New" }], ["POST", `/api/folders/items/${DRIVE}/i1/move`, { parentId: "p2" }],
      ["POST", `/api/folders/items/${DRIVE}/i1/copy`, { toDriveId: DRIVE, toParentId: "p2" }], ["DELETE", `/api/folders/items/${DRIVE}/i1`],
      ["POST", `/api/folders/items/${DRIVE}/i1/folders`, { name: "New" }], ["POST", `/api/folders/items/${DRIVE}/i1/upload-session`, { name: "big.pdf", size: 20_000_000 }],
      ["POST", `/api/folders/items/${DRIVE}/i1/share`, { scope: "organization" }], ["POST", `/api/folders/items/${DRIVE}/i1/invite`, { emails: "a@b.com" }],
      ["POST", `/api/folders/items/${DRIVE}/i1/preview`],
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

// ── Inside a folder (step 3) ────────────────────────────────────────────
test("uploads: one go up to 10 MB, then pieces of whole 320 KB blocks, in order", () => {
  assert.equal(needsUploadSession(UPLOAD_SESSION_ABOVE), false);
  assert.equal(needsUploadSession(UPLOAD_SESSION_ABOVE + 1), true);
  assert.equal(UPLOAD_PIECE % (320 * 1024), 0);
  assert.deepEqual(uploadPieces(12 * 1024 * 1024), [[0, UPLOAD_PIECE - 1], [UPLOAD_PIECE, 2 * UPLOAD_PIECE - 1], [2 * UPLOAD_PIECE, 12 * 1024 * 1024 - 1]]);
  assert.deepEqual(uploadPieces(0), []);
  assert.equal(contentRange(0, 10, 25), "bytes 0-9/25");
  assert.deepEqual(parseContentRange("bytes 0-9/25"), { start: 0, end: 9, total: 25 });
  assert.equal(parseContentRange("bytes 9-0/25"), null);
  assert.equal(parseContentRange("bytes 0-25/25"), null);
  assert.equal(parseContentRange("bytes=0-9/25"), null);
  const session = { next: 0, size: 12 * 1024 * 1024 };
  assert.equal(pieceProblem(parseContentRange(`bytes 0-${UPLOAD_PIECE - 1}/${session.size}`), UPLOAD_PIECE, session), null);
  assert.match(pieceProblem(parseContentRange(`bytes ${UPLOAD_PIECE}-${2 * UPLOAD_PIECE - 1}/${session.size}`), UPLOAD_PIECE, session)!, /starts at byte 0/);
  assert.match(pieceProblem(parseContentRange(`bytes 0-999/${session.size}`), 1000, session)!, /320 KB/);
  assert.match(pieceProblem(parseContentRange(`bytes 0-9/26`), 10, session)!, /different file/);
  assert.match(pieceProblem(parseContentRange(`bytes 0-9/${session.size}`), 9, session)!, /not the size it says/);
  assert.equal(pieceProblem(parseContentRange("bytes 0-999/1000"), 1000, { next: 0, size: 1000 }), null, "the last piece may be any size");
  assert.equal(uploadProblem("Lease.pdf", 100), null);
  assert.match(uploadProblem("Lease.pdf", UPLOAD_MAX_BYTES + 1)!, /1 GB/);
  assert.match(uploadProblem("a:b.pdf", 1)!, /does not take/);
  assert.match(uploadProblem("Lease.pdf", -1)!, /could not be read/);
});

test("a copy's progress, as Microsoft's monitor tells it", () => {
  assert.deepEqual(copyState(202, { status: "inProgress", percentageComplete: 41.6 }), { state: "running", percent: 42, itemId: null, error: null });
  assert.deepEqual(copyState(200, { status: "completed", resourceId: "new-1" }), { state: "done", percent: 100, itemId: "new-1", error: null });
  assert.equal(copyState(303, null, `https://graph.microsoft.com/v1.0/drives/${DRIVE}/items/new-2`).itemId, "new-2");
  assert.equal(copyState(200, { status: "failed", error: { message: "Name conflict" } }).error, "SharePoint could not copy it: Name conflict");
  assert.equal(copyState(404, null).state, "failed");
  assert.equal(copyState(200, { status: "notStarted" }).state, "running");
});

test("people to invite: plain addresses, at most 20", () => {
  assert.deepEqual(inviteEmails("Jo@Example.com, sam@example.co.uk;sam@example.co.uk"), ["jo@example.com", "sam@example.co.uk"]);
  assert.deepEqual(inviteEmails(["a@b.com"]), ["a@b.com"]);
  assert.equal(inviteEmails(""), null);
  assert.equal(inviteEmails("not an address"), null);
  assert.equal(inviteEmails(Array.from({ length: 21 }, (_, i) => `p${i}@b.com`)), null);
});

test("rename, move, copy, delete, upload, share and preview: Graph asked as the person, signed addresses with no token", async () => {
  calls.length = 0;
  answer = r => (r.method === "PATCH" ? ok({ error: {} }, { status: 409 }) : ok({}));
  await assert.rejects(renameItem("t", DRIVE, "i1", "Leases"), /Something called "Leases" is already there/);
  assert.equal(calls[0].url, `https://graph.microsoft.com/v1.0/drives/${DRIVE}/items/i1?@microsoft.graph.conflictBehavior=fail`);
  assert.deepEqual(calls[0].json, { name: "Leases" });

  calls.length = 0;
  answer = () => ok({ id: "i1", name: "Leases", folder: {}, parentReference: { driveId: DRIVE } });
  const moved = await moveItem("t", DRIVE, "i1", "p2");
  assert.equal(moved.itemId, "i1");
  assert.deepEqual(calls[0].json, { parentReference: { id: "p2" } });

  calls.length = 0;
  const monitor = "https://brucegillinghampollardlimited.sharepoint.com/_api/v2.0/monitor/m1";
  answer = r => (r.url.endsWith("/copy?@microsoft.graph.conflictBehavior=rename") ? ok(null, { status: 202, location: monitor }) : ok({ status: "inProgress", percentageComplete: 10 }, { status: 202 }));
  assert.equal(await startCopy("t", DRIVE, "i1", "other-drive", "p9"), monitor);
  assert.deepEqual(calls[0].json, { parentReference: { driveId: "other-drive", id: "p9" } });
  assert.deepEqual(await copyProgress(monitor), { state: "running", percent: 10, itemId: null, error: null });
  assert.equal(calls[1].token, null, "the monitor is asked with no token");
  answer = () => ok(null, { status: 202, location: "https://graph.microsoft.com/v1.0/monitor/elsewhere" });
  assert.equal(await startCopy("t", DRIVE, "i1", DRIVE, "p9"), null, "a monitor the engine may not call is not followed");
  await assert.rejects(copyProgress("https://example.com/monitor"), /Not a copy/);

  calls.length = 0;
  answer = () => ok(null, { status: 204 });
  await deleteItem("t", DRIVE, "i1");
  assert.equal(calls[0].method, "DELETE");

  calls.length = 0;
  answer = () => ok({ id: "f1", name: "Lease 1.pdf", file: {}, parentReference: { driveId: DRIVE } }, { status: 201 });
  const up = await uploadSmall("t", DRIVE, "p1", "Lease.pdf", new Uint8Array(5));
  assert.equal(up.name, "Lease 1.pdf");
  assert.equal(calls[0].url, `https://graph.microsoft.com/v1.0/drives/${DRIVE}/items/p1:/Lease.pdf:/content?@microsoft.graph.conflictBehavior=rename`, "a name already there gets a number, never replaced");
  await assert.rejects(uploadSmall("t", DRIVE, "p1", "Big.pdf", new Uint8Array(UPLOAD_SESSION_ABOVE + 1)), /pieces/);

  calls.length = 0;
  const uploadUrl = "https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/_api/v2.0/drives/x/items/y/uploadSession?guid=1";
  answer = () => ok({ uploadUrl, expirationDateTime: "2026-11-25T10:00:00Z" });
  assert.equal((await startUploadSession("t", DRIVE, "p1", "Big plan.pdf")).uploadUrl, uploadUrl);
  assert.ok(calls[0].url.endsWith("/items/p1:/Big%20plan.pdf:/createUploadSession"));
  answer = () => ok({ uploadUrl: "https://example.com/upload" });
  await assert.rejects(startUploadSession("t", DRIVE, "p1", "Big.pdf"), /no upload address/);

  calls.length = 0;
  answer = r => (r.headers?.["Content-Range"] === "bytes 0-9/20" ? ok({ nextExpectedRanges: ["10-19"] }, { status: 202 }) : ok({ id: "big-1", name: "Big.pdf", file: {}, parentReference: { driveId: DRIVE } }, { status: 201 }));
  assert.deepEqual(await uploadPiece(uploadUrl, new Uint8Array(10), 0, 20), { done: null, next: 10 });
  assert.equal((await uploadPiece(uploadUrl, new Uint8Array(10), 10, 20)).done!.itemId, "big-1");
  assert.ok(calls.every(c => c.token === null), "pieces go to Microsoft's signed address with no token");

  calls.length = 0;
  answer = r => ((r.json as any)?.scope === "anonymous" ? ok({ error: {} }, { status: 403 }) : ok({ link: { webUrl: "https://brucegillinghampollardlimited.sharepoint.com/:f:/s/BGP/abc", scope: "organization" } }, { status: 201 }));
  const link = await shareLink("t", DRIVE, "i1", { scope: "anonymous", edit: false });
  assert.deepEqual([link.scope, link.fellBack, (calls[0].json as any).type], ["organization", true, "view"], "anyone with the link falls back to people in BGP, and says so");

  calls.length = 0;
  answer = () => ok({ getUrl: "https://brucegillinghampollardlimited.sharepoint.com/_layouts/15/embed.aspx?x=1" });
  assert.match(await previewUrl("t", DRIVE, "f1"), /^https:\/\//);
  answer = () => ok({});
  await assert.rejects(previewUrl("t", DRIVE, "f1"), /no preview/);
});

test("the routes inside a folder: the top of a library and linked folders are kept safe, pieces come in order, each action is logged", async () => {
  const logged: any[] = [];
  let linkedCount = 0;
  const db = {
    query: async (sql: string, params: unknown[]) => {
      if (/INSERT INTO folder_actions/.test(sql)) { logged.push(params); return { rows: [] }; }
      if (/FROM record_folders WHERE drive_id = \$1 AND item_id = \$2/.test(sql)) return { rows: [{ n: linkedCount }] };
      return { rows: [] };
    },
  };
  let me = "u1";
  const app = express();
  app.use(express.json());
  app.use(foldersRouter({
    db, auth: (_req, _res, next) => next(),
    staff: async () => ({ userId: me, name: me, email: `${me}@brucegillinghampollard.com` }),
    microsoft: async () => ({ token: "own-token", account: "victoria@brucegillinghampollard.com" }),
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const raw = body instanceof Uint8Array;
    const res = await fetch(base + path, { method, headers: raw ? headers : { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const uploadUrl = "https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/_api/v2.0/uploadSession?guid=2";
  try {
    // The top of a library is never renamed.
    answer = r => (r.method === "GET" ? ok({ id: "root", name: "root", root: {}, folder: {}, parentReference: { driveId: DRIVE } }) : ok({}));
    let r = await send("POST", `/api/folders/items/${DRIVE}/root/rename`, { name: "Renamed" });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /top of a library/);

    // A folder linked to a record is unlinked first, never deleted from under it.
    linkedCount = 2;
    answer = r => (r.method === "GET" ? ok({ id: "i1", name: "Leases", folder: {}, parentReference: { driveId: DRIVE, id: "p1" } }) : ok(null, { status: 204 }));
    calls.length = 0;
    r = await send("DELETE", `/api/folders/items/${DRIVE}/i1`);
    assert.equal(r.status, 409);
    assert.match(r.body.message, /linked to 2 records/);
    assert.ok(!calls.some(c => c.method === "DELETE"), "nothing was deleted");
    linkedCount = 0;
    logged.length = 0;
    r = await send("DELETE", `/api/folders/items/${DRIVE}/i1`);
    assert.equal(r.status, 200);
    assert.deepEqual([logged[0][0], logged[0][1], logged[0][2], logged[0][7]], ["u1", "victoria@brucegillinghampollard.com", "delete", "Leases"], "who, which Microsoft account, what, and the name it had");

    // A move stays in its library.
    r = await send("POST", `/api/folders/items/${DRIVE}/i1/move`, { toDriveId: "other-drive", parentId: "p2" });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /copy it there/);

    // An upload in pieces: in order, only by the person who started it, then the file.
    answer = r => r.url.endsWith(":/createUploadSession") ? ok({ uploadUrl })
      : r.url === uploadUrl && r.headers?.["Content-Range"]?.endsWith(`/${UPLOAD_SESSION_ABOVE + 10}`) && r.headers["Content-Range"].startsWith("bytes 0-") ? ok({ nextExpectedRanges: [`${UPLOAD_PIECE}-`] }, { status: 202 })
      : r.url === uploadUrl ? ok({ id: "big-1", name: "Big.pdf", file: {}, parentReference: { driveId: DRIVE } }, { status: 201 }) : ok({});
    r = await send("POST", `/api/folders/items/${DRIVE}/p1/upload-session`, { name: "Big.pdf", size: 1000 });
    assert.equal(r.status, 400, "10 MB or less goes up in one go");
    r = await send("POST", `/api/folders/items/${DRIVE}/p1/upload-session`, { name: "Big.pdf", size: UPLOAD_SESSION_ABOVE + 10 });
    assert.equal(r.status, 200);
    const { sessionId, pieceSize } = r.body;
    assert.equal(pieceSize, UPLOAD_PIECE);
    const total = UPLOAD_SESSION_ABOVE + 10;
    r = await send("PUT", `/api/folders/uploads/${sessionId}`, new Uint8Array(UPLOAD_PIECE), { "Content-Type": "application/octet-stream", "Content-Range": `bytes ${UPLOAD_PIECE}-${2 * UPLOAD_PIECE - 1}/${total}` });
    assert.equal(r.status, 400, "out of order");
    me = "u2";
    r = await send("PUT", `/api/folders/uploads/${sessionId}`, new Uint8Array(UPLOAD_PIECE), { "Content-Type": "application/octet-stream", "Content-Range": `bytes 0-${UPLOAD_PIECE - 1}/${total}` });
    assert.equal(r.status, 404, "someone else's upload is not theirs to add to");
    me = "u1";
    r = await send("PUT", `/api/folders/uploads/${sessionId}`, new Uint8Array(UPLOAD_PIECE), { "Content-Type": "application/octet-stream", "Content-Range": `bytes 0-${UPLOAD_PIECE - 1}/${total}` });
    assert.deepEqual(r.body, { next: UPLOAD_PIECE });
    logged.length = 0;
    const rest = total - UPLOAD_PIECE;
    r = await send("PUT", `/api/folders/uploads/${sessionId}`, new Uint8Array(rest), { "Content-Type": "application/octet-stream", "Content-Range": `bytes ${UPLOAD_PIECE}-${total - 1}/${total}` });
    assert.equal(r.body.item.itemId, "big-1");
    assert.equal(logged[0][2], "upload");
    r = await send("PUT", `/api/folders/uploads/${sessionId}`, new Uint8Array(1), { "Content-Type": "application/octet-stream", "Content-Range": `bytes 0-0/${total}` });
    assert.equal(r.status, 404, "a finished upload takes no more");
  } finally {
    server.close();
  }
});

// ── Moving the old links over (4.7) ─────────────────────────────────────
test("the migration report's rules: the old team path, a row's status and id, Apply on the admin's own fresh preview, suggestions by name", () => {
  assert.equal(teamFolderPath("National Leasing", "Bluewater Shopping Centre"), "BGP share drive/National Leasing/Bluewater Shopping Centre");
  assert.deepEqual([migrationStatus(404), migrationStatus(410), migrationStatus(403), migrationStatus(401), migrationStatus(500)], ["missing", "missing", "no_access", "no_access", "error"]);
  const a = migrationRowId("crm_properties.sharepoint_folder_url", "p1", "", "https://x/a");
  assert.equal(a, migrationRowId("crm_properties.sharepoint_folder_url", "p1", "", " https://x/a "), "the same stored address, the same row");
  assert.notEqual(a, migrationRowId("crm_properties.sharepoint_folder_url", "p2", "", "https://x/a"));
  assert.notEqual(a, migrationRowId("crm_properties.sharepoint_team_folders", "p1", "", "https://x/a"));
  assert.match(a, /^m[0-9a-f]{16}$/);
  const at = new Date("2026-11-24T10:00:00Z");
  const preview = { previewedAt: at.toISOString(), previewedBy: "u1" };
  assert.equal(migrationApplyRefusal(preview, "u1", at.toISOString(), at.getTime() + 59 * 60_000), null);
  assert.match(migrationApplyRefusal(preview, "u1", at.toISOString(), at.getTime() + 61 * 60_000)!, /more than an hour/);
  assert.match(migrationApplyRefusal(preview, "u2", at.toISOString(), at.getTime())!, /made yourself/);
  assert.match(migrationApplyRefusal(preview, "u1", "2026-11-23T10:00:00.000Z", at.getTime())!, /replaced/);
  assert.match(migrationApplyRefusal(null, "u1", at.toISOString())!, /Preview first/);
  assert.equal(suggestionFits("Bluewater", "Bluewater"), true);
  assert.equal(suggestionFits("The Royal Exchange", "Royal Exchange"), true);
  assert.equal(suggestionFits("Bluewater", "Bluewater Shopping Centre"), true);
  assert.equal(suggestionFits("Blue", "Bluewater Shopping Centre"), false);
  assert.equal(suggestionFits("Leases", "Bluewater Shopping Centre"), false);
  assert.ok(OLD_FOLDER_READERS.length > 0 && OLD_FOLDER_READERS.every(r => MIGRATION_COLUMNS.some(c => c.column === r.column)), "every reader names a column the report moves");
});
