// The code that works with SharePoint by path, on the folder engine (Woody,
// 24 November 2026: "go ahead with the folder suggestion";
// docs/folders-review-2026-11-20.md, step 5): ChatBGP's folder tools, the
// email attachment and MLRO report saves, Pathway's folders and the client
// tree job. A path starts inside BGP - Share Drive, the person's own
// Microsoft 365 is used and never a colleague's, nothing runs from an
// automated run, nothing is replaced, and every change is logged. Microsoft
// is a stand-in here: nothing in this file calls it.
//   node --import tsx --test server/folders-tools.test.ts
import "./test-database-url";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import {
  GraphError, bgpLibrary, downloadFile, forgetLibrary, setGraphTransport, type GraphRequest, type GraphResponse,
} from "./folders/graph";
import { OLD_TREE_REFUSAL, entryFolderPath, folderAtPath, libraryPath, shareDrivePath, type FolderLog } from "./folders/by-path";
import {
  AUTOMATED_REFUSAL, FOLDER_TOOLS, FOLDER_TOOL_DEFINITIONS, chatMediaName, readFileFor, recordTypeOf, runFolderTool, saveToShareDrive,
  type FolderToolDeps,
} from "./chatbgp-folder-tools";
import { CONNECT_FIRST, STAFF_ONLY } from "./folders/routes";
import { extractTenancyUnitsFromSharePointHits } from "./pathway-tenancy-extractor";

const DRIVE = "b!TkfPTD5QkkaKK2ThhYzkbeZV8L-Ly5xIm6a79Utuotf_bKhaqTNzTLlcjCkAWwlf";
const HOST = "https://brucegillinghampollardlimited.sharepoint.com";
const ACCOUNT = "victoria@brucegillinghampollard.com";

// ── A small SharePoint, answered by the stand-in for Graph ──────────────
interface Node { id: string; name: string; parent: string | null; folder: boolean; bytes?: Uint8Array }
let nodes = new Map<string, Node>();
let seq = 0;
const calls: GraphRequest[] = [];
let downloadAt = (id: string) => `${HOST}/sites/BGP/_layouts/15/download.aspx?id=${id}`;

function reset(): void {
  nodes = new Map();
  seq = 0;
  calls.length = 0;
  downloadAt = id => `${HOST}/sites/BGP/_layouts/15/download.aspx?id=${id}`;
  const add = (id: string, name: string, parent: string | null, bytes?: Uint8Array) => nodes.set(id, { id, name, parent, folder: !bytes, bytes });
  add("root-1", "root", null);
  add("sd", "BGP - Share Drive", "root-1");
  add("inv", "Investment", "sd");
  add("deal-files", "Deal Files", "inv");
  add("rent-roll", "Rent roll.xlsx", "deal-files", new TextEncoder().encode("rent roll"));
  add("old", "BGP share drive", "root-1");
  add("old-inv", "Investment", "old");
  add("run", "1 High Street", "old-inv");
  forgetLibrary();
  logged.length = 0;
  links.length = 0;
}

const pathOf = (n: Node): string[] => (n.parent ? [...pathOf(nodes.get(n.parent)!), n.name] : []);
const childrenOf = (id: string) => [...nodes.values()].filter(n => n.parent === id);
const asGraph = (n: Node) => ({
  id: n.id,
  name: n.name,
  webUrl: `${HOST}/sites/BGP/Shared%20Documents/${pathOf(n).map(encodeURIComponent).join("/")}`,
  ...(n.parent === null ? { root: {} } : {}),
  ...(n.folder ? { folder: { childCount: childrenOf(n.id).length } } : { file: { mimeType: "application/octet-stream" }, size: n.bytes!.length }),
  parentReference: {
    driveId: DRIVE, driveType: "documentLibrary",
    ...(n.parent ? { id: n.parent, path: `/drives/${DRIVE}/root:/${pathOf(nodes.get(n.parent)!).join("/")}` } : {}),
  },
});
const ok = (body: any, status = 200): GraphResponse => ({ status, body, location: null, retryAfter: null });
const nope = (status: number): GraphResponse => ({ status, body: { error: { code: String(status) } }, location: null, retryAfter: null });
const freeName = (parent: string, name: string) => {
  const taken = (x: string) => childrenOf(parent).some(c => c.name === x);
  if (!taken(name)) return name;
  const dot = name.lastIndexOf(".");
  for (let i = 1; ; i++) {
    const candidate = dot > 0 ? `${name.slice(0, dot)} ${i}${name.slice(dot)}` : `${name} ${i}`;
    if (!taken(candidate)) return candidate;
  }
};

function answer(r: GraphRequest): GraphResponse {
  if (r.url.startsWith(`${HOST}/sites/BGP/_layouts/15/download.aspx`)) {
    assert.equal(r.token, null, "a download address is asked with no token");
    const n = nodes.get(new URL(r.url).searchParams.get("id") || "");
    return n?.bytes ? ok(n.bytes) : nope(404);
  }
  assert.equal(r.token, "own-token", `Graph is asked with the person's own token (${r.method} ${r.url})`);
  const [path] = r.url.replace("https://graph.microsoft.com/v1.0", "").split("?");
  if (path === "/sites/brucegillinghampollardlimited.sharepoint.com:/sites/BGP") return ok({ id: "site-1" });
  if (path === "/sites/site-1/drives") return ok({ value: [{ id: DRIVE, name: "Documents", webUrl: `${HOST}/sites/BGP/Shared%20Documents` }] });
  if (path === `/drives/${DRIVE}/root`) return ok({ id: "root-1" });
  let m = /^\/drives\/[^/]+\/root:\/(.+)$/.exec(path);
  if (m) {
    let at = nodes.get("root-1")!;
    for (const name of m[1].split("/").map(decodeURIComponent)) {
      const next = childrenOf(at.id).find(c => c.name === name);
      if (!next) return nope(404);
      at = next;
    }
    return ok(asGraph(at));
  }
  m = /^\/drives\/[^/]+\/items\/([^/:]+):\/(.+):\/content$/.exec(path);
  if (m && r.method === "PUT") {
    assert.match(r.url, /conflictBehavior=rename/, "a name already there gets a number, never replaced");
    const id = `new-${++seq}`;
    nodes.set(id, { id, name: freeName(m[1], decodeURIComponent(m[2])), parent: m[1], folder: false, bytes: r.bytes });
    return ok(asGraph(nodes.get(id)!), 201);
  }
  m = /^\/drives\/[^/]+\/items\/([^/]+)\/children$/.exec(path);
  if (m && r.method === "GET") return ok({ value: childrenOf(m[1]).map(asGraph) });
  if (m && r.method === "POST") {
    const body = r.json as any;
    assert.equal(body["@microsoft.graph.conflictBehavior"], "fail", "a new folder never replaces one");
    if (childrenOf(m[1]).some(c => c.name === body.name)) return nope(409);
    const id = `new-${++seq}`;
    nodes.set(id, { id, name: body.name, parent: m[1], folder: true });
    return ok(asGraph(nodes.get(id)!), 201);
  }
  m = /^\/drives\/[^/]+\/items\/([^/]+)$/.exec(path);
  const n = m ? nodes.get(m[1]) : null;
  if (m && !n) return nope(404);
  if (n && r.method === "GET") return ok({ ...asGraph(n), ...(n.folder ? {} : { "@microsoft.graph.downloadUrl": downloadAt(n.id) }) });
  if (n && r.method === "PATCH") {
    const body = r.json as any;
    if (body.parentReference?.id) {
      if (childrenOf(body.parentReference.id).some(c => c.name === n.name)) return nope(409);
      n.parent = body.parentReference.id;
    }
    if (body.name) n.name = body.name;
    return ok(asGraph(n));
  }
  return nope(404);
}

before(() => setGraphTransport(async r => { calls.push(r); return answer(r); }));
after(() => setGraphTransport(null));
beforeEach(reset);

// ── The database and the person, stood in for ──────────────────────────
const logged: any[][] = [];
const links: any[] = [];
const db = {
  query: async (sql: string, params: any[] = []) => {
    if (/INSERT INTO folder_actions/.test(sql)) { logged.push(params); return { rows: [] }; }
    if (/SELECT id, name, NULL::text AS property_id FROM crm_properties WHERE id = \$1/.test(sql)) {
      return { rows: params[0] === "p1" ? [{ id: "p1", name: "1 High Street", property_id: null }] : [] };
    }
    if (/INSERT INTO record_folders/.test(sql)) {
      const [type, id, driveId, itemId, label, colour, kind, webUrl, name, path, source, by] = params;
      links.push({ id: `link-${links.length + 1}`, record_type: type, record_id: id, drive_id: driveId, item_id: itemId, label, colour, position: 0, drive_kind: kind,
        web_url: webUrl, cached_name: name, cached_path: path, status: "ok", source, linked_by: by, linked_by_name: null, linked_at: new Date(), checked_at: new Date() });
      return { rows: [{ id: links[links.length - 1].id }] };
    }
    if (/WHERE rf\.id = \$1 AND rf\.removed_at IS NULL/.test(sql)) return { rows: links.filter(l => l.id === params[0]) };
    if (/WHERE rf\.record_type = \$1 AND rf\.record_id = \$2 AND rf\.removed_at IS NULL/.test(sql)) return { rows: links.filter(l => l.record_type === params[0] && l.record_id === params[1]) };
    return { rows: [] };
  },
};
const req = {} as Request;
let microsoftAsked: string[] = [];
function deps(over: Partial<FolderToolDeps> = {}): FolderToolDeps {
  microsoftAsked = [];
  return {
    db,
    internal: () => false,
    staff: async () => ({ userId: "u1", name: "Victoria", email: ACCOUNT }),
    microsoft: async userId => { microsoftAsked.push(userId); return { token: "own-token", account: ACCOUNT }; },
    extractText: async (_file, name) => `the text of ${name}`,
    chatMedia: async name => (name === "1774348793476-f3ddbf080ba7fd73-Comps.xlsx" ? { data: Buffer.from("comps"), originalName: "Comps.xlsx" } : null),
    dropbox: async dropboxPath => {
      if (dropboxPath.endsWith("missing.pdf")) throw new Error("Dropbox has no file at /Deals/missing.pdf");
      return Buffer.from("pdf");
    },
    ...over,
  };
}
const actionsLogged = () => logged.map(p => p[2]);

// ── Paths ───────────────────────────────────────────────────────────────
test("a path a person gives starts inside BGP - Share Drive; the old tree is refused", () => {
  assert.deepEqual(shareDrivePath("Investment/Deal Files"), { parts: ["Investment", "Deal Files"] });
  assert.deepEqual(shareDrivePath("BGP - Share Drive/Investment"), { parts: ["Investment"] });
  assert.deepEqual(shareDrivePath("Shared Documents/BGP - Share Drive/Investment"), { parts: ["Investment"] });
  assert.deepEqual(shareDrivePath(`/drives/${DRIVE}/root:/BGP - Share Drive/Investment`), { parts: ["Investment"] });
  assert.deepEqual(shareDrivePath(" BGP - Share Drive / Investment \\ Deal  Files "), { parts: ["Investment", "Deal Files"] });
  assert.deepEqual(shareDrivePath(""), { parts: [] });
  assert.deepEqual(shareDrivePath("/"), { parts: [] });
  assert.deepEqual(shareDrivePath("BGP share drive/Investment"), { problem: OLD_TREE_REFUSAL });
  assert.match((shareDrivePath("Investment/../HR") as any).problem, /step up/);
  assert.match((shareDrivePath("Investment/Rent: 2026") as any).problem, /does not take/);
  // A record's stored folder is a path from the top of the library, the old tree included.
  assert.deepEqual(libraryPath("BGP share drive/Investment/1 High Street"), { parts: ["BGP share drive", "Investment", "1 High Street"] });
  assert.deepEqual(libraryPath("BGP - Share Drive / Investment / Deal Files/Rent roll.xlsx"), { parts: ["BGP - Share Drive", "Investment", "Deal Files", "Rent roll.xlsx"] });
  assert.deepEqual(libraryPath("Documents/Islington Square/TS.xlsx"), { parts: ["Islington Square", "TS.xlsx"] });
  assert.equal(entryFolderPath({ path: "BGP - Share Drive / Investment / report.xlsx" } as any), "BGP - Share Drive / Investment");
});

test("a file from the chat, and the record a tool means", () => {
  assert.equal(chatMediaName("1774348793476-f3ddbf080ba7fd73-Comps.xlsx"), "1774348793476-f3ddbf080ba7fd73-Comps.xlsx");
  assert.equal(chatMediaName("https://chatbgp.app/api/chat-media/1774-ab-Comps.xlsx?x=1"), "1774-ab-Comps.xlsx");
  assert.equal(chatMediaName("../secrets.txt"), null);
  assert.equal(chatMediaName("a/b.txt"), null);
  assert.equal(chatMediaName("a%2Fb.txt"), null);
  assert.equal(chatMediaName(""), null);
  assert.equal(recordTypeOf("Transaction"), "deal");
  assert.equal(recordTypeOf("deal"), "deal");
  assert.equal(recordTypeOf("property"), "property");
  assert.equal(recordTypeOf("company"), "company");
  assert.equal(recordTypeOf("scheme"), null);
});

test("the eight tools are defined once, for BGP - Share Drive, with no retired team folder", () => {
  assert.deepEqual(FOLDER_TOOL_DEFINITIONS.map(d => d.function.name).sort(), [...FOLDER_TOOLS].sort());
  for (const d of FOLDER_TOOL_DEFINITIONS) {
    const text = JSON.stringify(d);
    assert.doesNotMatch(text, /London F&B|London Retail|National Leasing|Office - Corporate|Development & Re-purposing/, `${d.function.name} names a retired team folder`);
    assert.doesNotMatch(text.replace(/the old \\"BGP share drive\\"|the old "BGP share drive"/g, ""), /BGP share drive/, `${d.function.name} sends people to the old tree`);
  }
});

// ── Who may use them ────────────────────────────────────────────────────
test("nothing runs from an automated run; reading a record's folders asks Microsoft nothing", async () => {
  const d = deps({ internal: () => true });
  for (const tool of FOLDER_TOOLS.filter(t => t !== "get_record_folders")) {
    const r = await runFolderTool(tool, { url: "Investment", folderName: "X", parentPath: "Investment" }, req, d);
    assert.equal(r.data.error, AUTOMATED_REFUSAL, tool);
  }
  const read = await runFolderTool("get_record_folders", { recordType: "property", recordId: "p1" }, req, d);
  assert.equal(read.data.success, true);
  assert.match(read.data.message, /No folders are linked to 1 High Street yet/);
  assert.deepEqual(microsoftAsked, [], "no Microsoft token was asked for");
  assert.equal(calls.length, 0, "nothing was asked of Microsoft");
  const saved = await saveToShareDrive(req, { folderPath: "Investment", name: "a.pdf", bytes: new Uint8Array(1), from: "email" }, d);
  assert.deepEqual(saved, { success: false, error: AUTOMATED_REFUSAL });
  assert.deepEqual(await readFileFor(req, { url: "Investment/Deal Files/Rent roll.xlsx" }, d), { error: AUTOMATED_REFUSAL });
});

test("BGP staff only, each on their own Microsoft 365", async () => {
  let r = await runFolderTool("browse_sharepoint_folder", {}, req, deps({ staff: async () => null }));
  assert.equal(r.data.error, STAFF_ONLY);
  assert.deepEqual(microsoftAsked, [], "the staff check comes before any token");
  r = await runFolderTool("browse_sharepoint_folder", {}, req, deps({ microsoft: async () => null }));
  assert.equal(r.data.error, CONNECT_FIRST);
  assert.equal(r.data.connect, true);
  const saved = await saveToShareDrive(req, { folderPath: "Investment", name: "a.pdf", bytes: new Uint8Array(1), from: "email" }, deps({ microsoft: async () => null }));
  assert.deepEqual(saved, { success: false, error: CONNECT_FIRST });
  assert.equal(calls.length, 0);
});

// ── Reading ─────────────────────────────────────────────────────────────
test("looking in a folder and reading a file, as the person; a download address with no token", async () => {
  let r = await runFolderTool("browse_sharepoint_folder", {}, req, deps());
  assert.equal(r.data.success, true);
  assert.equal(r.data.folder.name, "BGP - Share Drive");
  assert.deepEqual(r.data.items.map((i: any) => i.name), ["Investment"]);
  r = await runFolderTool("browse_sharepoint_folder", { url: "Investment/Deal Files" }, req, deps());
  assert.deepEqual(r.data.items.map((i: any) => [i.name, i.type]), [["Rent roll.xlsx", "file"]]);
  r = await runFolderTool("browse_sharepoint_folder", { url: "BGP share drive/Investment" }, req, deps());
  assert.equal(r.data.error, OLD_TREE_REFUSAL);
  r = await runFolderTool("browse_sharepoint_folder", { url: "https://evil.example.com/sites/BGP" }, req, deps());
  assert.match(r.data.error, /isn't to BGP's SharePoint/);
  r = await runFolderTool("browse_sharepoint_folder", { url: "Investment/Nowhere" }, req, deps());
  assert.match(r.data.error, /Nothing is at "BGP - Share Drive \/ Investment \/ Nowhere"/);

  r = await runFolderTool("read_sharepoint_file", { url: "Investment/Deal Files/Rent roll.xlsx" }, req, deps());
  assert.equal(r.data.content, "the text of Rent roll.xlsx");
  assert.ok(calls.some(c => c.url.includes("download.aspx") && c.token === null), "the file came from BGP's SharePoint with no token");
  r = await runFolderTool("read_sharepoint_file", { url: "/api/chat-media/1774348793476-f3ddbf080ba7fd73-Comps.xlsx" }, req, deps());
  assert.equal(r.data.content, "the text of Comps.xlsx");
  const file = await readFileFor(req, { url: "Investment/Deal Files/Rent roll.xlsx" }, deps());
  assert.ok(!("error" in file));
  assert.equal(new TextDecoder().decode((file as any).bytes), "rent roll");
  assert.deepEqual(logged, [], "reading logs nothing");
});

test("a download comes only from BGP's own SharePoint, and only up to the limit", async () => {
  const token = "own-token";
  downloadAt = () => "https://evil.example.com/steal";
  await assert.rejects(downloadFile(token, DRIVE, "rent-roll"), (e: any) => e instanceof GraphError && e.status === 502);
  downloadAt = id => `${HOST}/sites/BGP/_layouts/15/download.aspx?id=${id}`;
  await assert.rejects(downloadFile(token, DRIVE, "rent-roll", 4), (e: any) => e instanceof GraphError && e.status === 413);
  await assert.rejects(downloadFile(token, DRIVE, "deal-files"), /folder, not a file/);
  assert.equal(new TextDecoder().decode((await downloadFile(token, DRIVE, "rent-roll")).bytes), "rent roll");
});

// ── Changing things ─────────────────────────────────────────────────────
test("a folder is made inside one that is there; one of that name already there is used", async () => {
  let r = await runFolderTool("create_sharepoint_folder", { folderName: "Leases", parentPath: "Investment/Deal Files" }, req, deps());
  assert.equal(r.data.success, true);
  assert.equal(r.data.existed, false);
  assert.equal(r.data.path, "BGP - Share Drive / Investment / Deal Files / Leases");
  assert.deepEqual([logged[0][0], logged[0][1], logged[0][2], logged[0][8]], ["u1", ACCOUNT, "create", "Leases"], "who, which Microsoft account, what");
  assert.deepEqual(JSON.parse(logged[0][13]), { via: "chatbgp" });
  r = await runFolderTool("create_sharepoint_folder", { folderName: "Leases", parentPath: "Investment/Deal Files" }, req, deps());
  assert.equal(r.data.existed, true);
  assert.match(r.data.message, /was already there: nothing new was made/);
  r = await runFolderTool("create_sharepoint_folder", { folderName: "Leases", parentPath: "Marketing" }, req, deps());
  assert.match(r.data.error, /There is no folder at "BGP - Share Drive \/ Marketing"/);
  r = await runFolderTool("create_sharepoint_folder", { folderName: "Rent: 2026", parentPath: "Investment" }, req, deps());
  assert.match(r.data.error, /does not take/);
  r = await runFolderTool("create_sharepoint_folder", { folderName: "X", parentPath: "BGP share drive/Investment" }, req, deps());
  assert.equal(r.data.error, OLD_TREE_REFUSAL);
});

test("a file from the chat goes in below a top-level folder; a name already there gets a number", async () => {
  const args = { chatMediaFilename: "1774348793476-f3ddbf080ba7fd73-Comps.xlsx", destinationFolderPath: "Investment/Deal Files/2026" };
  let r = await runFolderTool("upload_to_sharepoint", args, req, deps());
  assert.equal(r.data.success, true);
  assert.equal(r.data.fileName, "Comps.xlsx");
  assert.equal(r.data.folder, "BGP - Share Drive / Investment / Deal Files / 2026");
  assert.deepEqual(actionsLogged(), ["create", "upload"], "the missing folder made, then the file, each logged");
  r = await runFolderTool("upload_to_sharepoint", args, req, deps());
  assert.equal(r.data.fileName, "Comps 1.xlsx");
  assert.match(r.data.message, /a file called Comps\.xlsx was already there, so this one has a number added/);
  assert.equal(childrenOf([...nodes.values()].find(n => n.name === "2026")!.id).length, 2, "nothing was replaced");

  const before = nodes.size;
  r = await runFolderTool("upload_to_sharepoint", { ...args, destinationFolderPath: "Marketing/Photos" }, req, deps());
  assert.match(r.data.error, /There is no folder called "Marketing" in "BGP - Share Drive": check the path\. Nothing was made/);
  assert.equal(nodes.size, before, "no new top-level folder");
  r = await runFolderTool("upload_to_sharepoint", { ...args, chatMediaFilename: "../../etc/passwd" }, req, deps());
  assert.match(r.data.error, /chat-media name/);
  r = await runFolderTool("upload_to_sharepoint", { ...args, chatMediaFilename: "1774348793476-ab12-Gone.xlsx" }, req, deps());
  assert.match(r.data.error, /File not found in chat-media/);
});

test("an email attachment or a report saved by path; Dropbox files copied one by one", async () => {
  const saved = await saveToShareDrive(req, { folderPath: "Investment/Deal Files", name: "HoTs.pdf", bytes: new Uint8Array([1, 2]), from: "email" }, deps(), "aml");
  assert.equal(saved.success, true);
  assert.equal((saved as any).path, "BGP - Share Drive / Investment / Deal Files");
  assert.deepEqual(JSON.parse(logged[logged.length - 1][13]), { via: "aml", from: "email", size: 2 });
  assert.deepEqual(await saveToShareDrive(req, { folderPath: "BGP share drive/Investment", name: "a.pdf", bytes: new Uint8Array(1), from: "email" }, deps()),
    { success: false, error: `${OLD_TREE_REFUSAL.replace(/\.$/, "")}. Nothing was saved.` });

  const r = await runFolderTool("copy_dropbox_to_sharepoint", {
    destinationFolderPath: "Investment/Deal Files",
    files: [{ dropboxPath: "/Deals/brochure.pdf" }, { dropboxPath: "/Deals/missing.pdf" }],
  }, req, deps());
  assert.equal(r.data.uploaded, 1);
  assert.equal(r.data.failed, 1);
  assert.equal(r.data.failures[0].error, "Dropbox has no file at /Deals/missing.pdf", "Dropbox's own words");
});

test("a move stays in its library; the top and BGP - Share Drive itself never move", async () => {
  let r = await runFolderTool("move_sharepoint_item", { sourcePath: "Investment/Deal Files/Rent roll.xlsx", destinationFolderPath: "Investment" }, req, deps());
  assert.equal(r.data.success, true);
  assert.equal(nodes.get("rent-roll")!.parent, "inv");
  const move = logged.find(p => p[2] === "move")!;
  assert.deepEqual([move[6], move[9], move[10]], ["rent-roll", "deal-files", "inv"], "the item, where it was and where it went");
  r = await runFolderTool("move_sharepoint_item", { sourcePath: "", destinationFolderPath: "Investment" }, req, deps());
  assert.equal(r.data.error, "BGP - Share Drive itself can't be moved.");
  r = await runFolderTool("move_sharepoint_item", { sourcePath: "Investment/Rent roll.xlsx", destinationFolderPath: "Investment/Deal Files", newName: "Rent roll 2026.xlsx" }, req, deps());
  assert.equal(nodes.get("rent-roll")!.name, "Rent roll 2026.xlsx");
  assert.deepEqual(logged.slice(-2).map(p => p[2]), ["move", "rename"]);
});

test("a record's folders are read, and a folder linked to a record, as the person", async () => {
  let r = await runFolderTool("link_record_folder", { recordType: "property", recordId: "p1", folderPath: "Investment/Deal Files" }, req, deps());
  assert.equal(r.data.success, true);
  assert.match(r.data.message, /Linked BGP - Share Drive \/ Investment \/ Deal Files to the property 1 High Street/);
  assert.deepEqual([links[0].drive_id, links[0].item_id, links[0].linked_by], [DRIVE, "deal-files", "u1"]);
  assert.equal(logged.find(p => p[2] === "link")?.[4], "p1");
  r = await runFolderTool("link_record_folder", { recordType: "property", recordId: "p1", folderPath: "/" }, req, deps());
  assert.match(r.data.error, /whole of BGP - Share Drive/, "never the whole of BGP - Share Drive");
  r = await runFolderTool("link_record_folder", { recordType: "property", recordId: "nope", folderPath: "Investment" }, req, deps());
  assert.match(r.data.error, /isn't in the CRM/);
  r = await runFolderTool("get_record_folders", { recordType: "property", recordId: "p1" }, req, deps());
  assert.deepEqual(r.data.folders.map((f: any) => f.path), ["BGP - Share Drive / Investment / Deal Files"]);
  r = await runFolderTool("get_record_folders", { recordType: "scheme", recordId: "s1" }, req, deps());
  assert.match(r.data.error, /Say which record/);
});

// ── By a record's stored path: Pathway ──────────────────────────────────
test("a record's own folder in the old tree gains its subfolders; nothing else is made there", async () => {
  const lib = await bgpLibrary("own-token");
  const log: FolderLog = { db, actor: { userId: "u1", account: ACCOUNT }, detail: { via: "pathway" } };
  const run = ["BGP share drive", "Investment", "1 High Street"];
  const drawings = await folderAtPath("own-token", lib, [...run, "05 Planning", "Drawings"], { make: log, keep: run.length });
  assert.equal(drawings.path, "BGP share drive / Investment / 1 High Street / 05 Planning / Drawings");
  assert.deepEqual(actionsLogged(), ["create", "create"]);
  await assert.rejects(folderAtPath("own-token", lib, ["BGP share drive", "Leasing", "New"], { make: log }), /Nothing new is made in the old "BGP share drive" folder/);
  await assert.rejects(folderAtPath("own-token", lib, ["BGP share drive", "Investment", "2 Low Street", "05 Planning"], { make: log, keep: 3 }), /There is no folder called "2 Low Street"/);
  await assert.rejects(folderAtPath("own-token", lib, ["BGP - Share Drive", "Investment", "Deal Files", "Rent roll.xlsx"]), /is a file, not a folder/);
});

test("with no Microsoft 365 of their own, Pathway's look-ups ask Microsoft nothing", async () => {
  assert.deepEqual(await extractTenancyUnitsFromSharePointHits([{ name: "Tenancy schedule.xlsx", path: "BGP - Share Drive / Investment" }], req), []);
  assert.equal(calls.length, 0);
});

// ── The client tree job ─────────────────────────────────────────────────
test("the client tree job makes folders through the engine: one already there is a success, each made is logged", async () => {
  const { engineClientFolderGraph } = await import("./client-folder-jobs");
  const g = engineClientFolderGraph("own-token", { companyId: "c1", companyName: "Landsec", userId: "u1", pool: db as any });
  let r = await g.createFolder(DRIVE, "inv", "Landsec");
  assert.equal(r.success, true);
  const made = r.item!.id;
  r = await g.createFolder(DRIVE, "inv", "Landsec");
  assert.deepEqual(r, { success: true, item: { id: made, webUrl: `${HOST}/sites/BGP/Shared%20Documents/BGP%20-%20Share%20Drive/Investment/Landsec` } });
  assert.deepEqual(actionsLogged(), ["create"], "the folder made is logged once");
  assert.deepEqual(JSON.parse(logged[0][13]), { via: "client_folder_job", companyId: "c1" });
  const root = await g.ensureRoot("Landsec");
  assert.equal(root.name, "Landsec");
  assert.equal(nodes.get(root.itemId)!.parent, "old", "the data room's root stays where the data room reads it");
  const listed = await g.listChildren(DRIVE, "deal-files");
  assert.deepEqual(listed.items.map(i => i.name), ["Rent roll.xlsx"]);
});
