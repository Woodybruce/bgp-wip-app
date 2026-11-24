// The folder engine's one door to Microsoft (Woody, 24 November 2026: "go
// ahead with the folder suggestion"; docs/folders-review-2026-11-20.md, 4.4).
// Every Graph call the engine makes goes through graph() below, so a test can
// stand in for Microsoft there. It calls graph.microsoft.com with the
// person's OWN token (decision 7: never a colleague's, never the app's), and a
// SharePoint upload or copy-monitor address, which Microsoft signs itself, with
// no token at all. The BGP library is looked up once here and kept.
import { listAllChildren } from "../microsoft-graph-pagination";
import { SHAREPOINT_HOST, SHAREPOINT_SITE_PATH, sharesId } from "../sharepoint-graph";
import {
  SHARE_DRIVE_NAME, UPLOAD_PIECE, UPLOAD_SESSION_ABOVE, contentRange, copyState, driveKindOf, folderDisplayPath, folderTreeOrder, folderTreePaths,
  graphRefusalWords, type DriveEntry, type FolderPlaces,
} from "@shared/folders";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface GraphRequest {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** A Graph path ("/drives/…"), or a full Microsoft address. */
  url: string;
  token: string | null;
  json?: unknown;
  bytes?: Uint8Array;
  headers?: Record<string, string>;
  /** A file's content: the answer comes back as bytes, not text. */
  binary?: boolean;
}
export interface GraphResponse { status: number; body: any; location: string | null; retryAfter: number | null }
export type GraphTransport = (r: GraphRequest) => Promise<GraphResponse>;

const fetchTransport: GraphTransport = async (r) => {
  const headers: Record<string, string> = { ...(r.headers || {}) };
  if (r.token) headers.Authorization = `Bearer ${r.token}`;
  let body: any;
  if (r.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(r.json); }
  else if (r.bytes) body = r.bytes;
  // A signed SharePoint address (no token) is never followed somewhere else.
  const res = await fetch(r.url, { method: r.method, headers, body, redirect: r.token ? "follow" : "manual", signal: AbortSignal.timeout(90_000) });
  if (r.binary && res.ok) return { status: res.status, body: new Uint8Array(await res.arrayBuffer()), location: res.headers.get("Location"), retryAfter: null };
  const text = await res.text();
  let parsed: any = null;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
  const retryAfter = Number(res.headers.get("Retry-After"));
  return { status: res.status, body: parsed, location: res.headers.get("Location"), retryAfter: Number.isFinite(retryAfter) ? retryAfter : null };
};

let transport: GraphTransport = fetchTransport;
/** Tests stand in for Microsoft here; null puts the real one back. */
export function setGraphTransport(t: GraphTransport | null): void {
  transport = t || fetchTransport;
}

const TENANT_HOST = /^brucegillinghampollardlimited(-my)?\.sharepoint\.com$/i;
/** Where a request may go, and whether it may carry the person's token. */
export function graphTarget(url: string): { url: string; withToken: boolean } | null {
  if (url.startsWith("/")) return { url: GRAPH_BASE + url, withToken: true };
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.hostname === "graph.microsoft.com") return { url, withToken: true };
  // An upload session or a copy's monitor on BGP's own SharePoint: Microsoft
  // signs these addresses, and a token must never be sent to them.
  if (TENANT_HOST.test(u.hostname)) return { url, withToken: false };
  return null;
}

/** The one Graph call. SharePoint's busy answers (429, 503) are waited out twice. */
export async function graph(r: GraphRequest): Promise<GraphResponse> {
  const target = graphTarget(r.url);
  if (!target) throw new Error("Not a Microsoft address the folder engine may call.");
  if (target.withToken && !r.token) throw new Error("A Graph call needs the person's own token.");
  for (let attempt = 0; ; attempt++) {
    const res = await transport({ ...r, url: target.url, token: target.withToken ? r.token : null });
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      const wait = Math.min(10, res.retryAfter ?? 2);
      if (wait > 0) await new Promise(done => setTimeout(done, wait * 1000));
      continue;
    }
    return res;
  }
}

/** A refusal from Graph, in plain words. */
export class GraphError extends Error {
  constructor(readonly status: number, message?: string) {
    super(message || graphRefusalWords(status));
  }
}

async function call(token: string, method: GraphRequest["method"], url: string, json?: unknown): Promise<any> {
  const res = await graph({ method, url, token, json });
  if (res.status >= 400) throw new GraphError(res.status);
  return res.body;
}

const ITEM_SELECT = "id,name,size,webUrl,folder,file,root,parentReference,lastModifiedDateTime,remoteItem";

/** A file or folder as the screens are sent it. Followed items arrive as a remoteItem. */
export function driveEntry(item: any, fallbackDriveId?: string | null): DriveEntry {
  const remote = item?.remoteItem?.id ? item.remoteItem : null;
  const it = remote ? { ...remote, name: item?.name || remote.name } : item;
  return {
    driveId: String(it?.parentReference?.driveId || fallbackDriveId || ""),
    itemId: String(it?.id || ""),
    name: String(it?.name || ""),
    isFolder: !!it?.folder,
    childCount: typeof it?.folder?.childCount === "number" ? it.folder.childCount : null,
    size: typeof it?.size === "number" ? it.size : null,
    modified: it?.lastModifiedDateTime || null,
    webUrl: it?.webUrl || null,
    path: folderDisplayPath(it),
    driveKind: driveKindOf(it?.parentReference?.driveType),
    mimeType: it?.file?.mimeType || null,
  };
}

// ── The BGP library, looked up once ─────────────────────────────────────
export interface LibraryRef { siteId: string; driveId: string; itemId: string; name: string; webUrl: string | null }
const LIBRARY_TTL_MS = 6 * 60 * 60_000;
let library: { value: LibraryRef; at: number } | null = null;
/** The BGP site's document library ("Documents", else the site's default library). */
export async function bgpLibrary(token: string): Promise<LibraryRef> {
  if (library && Date.now() - library.at < LIBRARY_TTL_MS) return library.value;
  const site = await call(token, "GET", `/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}?$select=id,webUrl`);
  const drives = await call(token, "GET", `/sites/${site.id}/drives?$select=id,name,webUrl`);
  const drive = (drives?.value || []).find((d: any) => d?.name === "Documents" || d?.name === "Shared Documents")
    || await call(token, "GET", `/sites/${site.id}/drive?$select=id,name,webUrl`);
  const root = await call(token, "GET", `/drives/${drive.id}/root?$select=id`);
  const value: LibraryRef = { siteId: String(site.id), driveId: String(drive.id), itemId: String(root.id), name: String(drive.name || "Documents"), webUrl: drive.webUrl || null };
  library = { value, at: Date.now() };
  return value;
}
/** Tests start from no library. */
export function forgetLibrary(): void { library = null; }

/** "BGP - Share Drive" at the top of the library, where the picker opens (decision 2); null when it is not there. */
export async function shareDriveFolder(token: string): Promise<DriveEntry | null> {
  const lib = await bgpLibrary(token);
  const res = await graph({ method: "GET", url: `/drives/${lib.driveId}/root:/${encodeURIComponent(SHARE_DRIVE_NAME)}?$select=${ITEM_SELECT}`, token });
  if (res.status === 404) return null;
  if (res.status >= 400) throw new GraphError(res.status);
  return driveEntry(res.body, lib.driveId);
}

/** Where the picker starts: the BGP library with "BGP - Share Drive", the person's OneDrive, and the folders they follow. */
export async function folderPlaces(token: string): Promise<FolderPlaces> {
  const [lib, share, oneDrive, followed] = await Promise.allSettled([
    bgpLibrary(token),
    shareDriveFolder(token),
    call(token, "GET", `/me/drive/root?$select=${ITEM_SELECT}`),
    call(token, "GET", `/me/drive/following?$top=100&$select=${ITEM_SELECT}`),
  ]);
  if (lib.status === "rejected" && oneDrive.status === "rejected") throw lib.reason;
  return {
    library: lib.status === "fulfilled" ? { driveId: lib.value.driveId, itemId: lib.value.itemId, name: lib.value.name, webUrl: lib.value.webUrl } : null,
    shareDrive: share.status === "fulfilled" ? share.value : null,
    oneDrive: oneDrive.status === "fulfilled" && oneDrive.value?.id ? { ...driveEntry(oneDrive.value), name: "My OneDrive", path: "My OneDrive" } : null,
    followed: followed.status === "fulfilled" ? (followed.value?.value || []).map((i: any) => driveEntry(i)).filter((e: DriveEntry) => e.isFolder && e.driveId && e.itemId) : [],
  };
}

// ── Reading ─────────────────────────────────────────────────────────────
/** One file or folder by its ids. */
export async function getEntry(token: string, driveId: string, itemId: string): Promise<DriveEntry> {
  return driveEntry(await call(token, "GET", `/drives/${driveId}/items/${itemId}?$select=${ITEM_SELECT}`), driveId);
}

/** What sits at a path in a library ("BGP share drive/London Retail/Bluewater"), or null when nothing does. */
export async function entryByPath(token: string, driveId: string, path: string): Promise<DriveEntry | null> {
  const encoded = path.split("/").map(p => p.trim()).filter(Boolean).map(encodeURIComponent).join("/");
  if (!encoded) return null;
  const res = await graph({ method: "GET", url: `/drives/${driveId}/root:/${encoded}?$select=${ITEM_SELECT}`, token });
  if (res.status === 404) return null;
  if (res.status >= 400) throw new GraphError(res.status);
  return driveEntry(res.body, driveId);
}

/** The folder a pasted SharePoint or OneDrive address opens. */
export async function openLink(token: string, url: string): Promise<DriveEntry> {
  return (await openLinkItem(token, url)).entry;
}
/** The same, with its folder and whether it is a drive's top (linking refuses a top). */
export async function openLinkItem(token: string, url: string): Promise<{ entry: DriveEntry; parentId: string | null; isRoot: boolean }> {
  const raw = await call(token, "GET", `/shares/${sharesId(url)}/driveItem?$select=${ITEM_SELECT}`);
  return { entry: driveEntry(raw), parentId: raw?.parentReference?.id ? String(raw.parentReference.id) : null, isRoot: !!raw?.root };
}

/** A folder's contents, every page. */
export async function listChildren(token: string, driveId: string, itemId: string, opts: { foldersOnly?: boolean } = {}): Promise<DriveEntry[]> {
  const items = await listAllChildren(async (url) => {
    const res = await graph({ method: "GET", url, token });
    if (res.status >= 400) throw new GraphError(res.status);
    return res.body;
  }, `/drives/${driveId}/items/${itemId}/children?$top=200&$select=${ITEM_SELECT}`);
  const out = items.map(i => driveEntry(i, driveId));
  return opts.foldersOnly ? out.filter(e => e.isFolder) : out;
}

/** Folders by name, in the BGP library, the person's OneDrive, or both. */
export async function searchFolders(token: string, q: string, where: "library" | "onedrive" | "all"): Promise<DriveEntry[]> {
  const text = encodeURIComponent(q.replace(/'/g, "''"));
  const run = async (base: string, driveId: string | null) => {
    const res = await graph({ method: "GET", url: `${base}/search(q='${text}')?$top=200&$select=${ITEM_SELECT}`, token });
    if (res.status >= 400) throw new GraphError(res.status);
    return ((res.body?.value || []) as any[]).map(i => driveEntry(i, driveId)).filter(e => e.isFolder && e.driveId && e.itemId);
  };
  const runs: Promise<DriveEntry[]>[] = [];
  if (where !== "onedrive") runs.push(bgpLibrary(token).then(lib => run(`/drives/${lib.driveId}/root`, lib.driveId)));
  if (where !== "library") runs.push(run("/me/drive/root", null));
  const settled = await Promise.allSettled(runs);
  if (settled.every(s => s.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason;
  const seen = new Set<string>();
  const out: DriveEntry[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const e of s.value) {
      const key = `${e.driveId}|${e.itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out.slice(0, 40);
}

// ── Making folders ──────────────────────────────────────────────────────
/** A new folder inside another. A name already there is refused, never renamed. */
export async function createFolder(token: string, driveId: string, parentId: string, name: string): Promise<DriveEntry> {
  const res = await graph({ method: "POST", url: `/drives/${driveId}/items/${parentId}/children`, token, json: { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" } });
  if (res.status >= 400) throw new GraphError(res.status, res.status === 409 ? `A folder called "${name}" is already there.` : undefined);
  return driveEntry(res.body, driveId);
}

/** A new folder with a template's folders inside it, parents first. One that fails is listed, the rest still made. */
export async function createFolderTree(token: string, driveId: string, parentId: string, name: string, template: readonly string[]): Promise<{ root: DriveEntry; made: number; failed: string[] }> {
  const tree = folderTreePaths([...template]);
  if ("problem" in tree) throw new GraphError(400, tree.problem);
  const root = await createFolder(token, driveId, parentId, name);
  const ids = new Map<string, string>([["", root.itemId]]);
  const failed: string[] = [];
  let made = 1;
  for (const parts of folderTreeOrder(tree.paths)) {
    const parent = ids.get(parts.slice(0, -1).join("/"));
    if (!parent) continue; // its parent failed, already listed
    try {
      const child = await createFolder(token, driveId, parent, parts[parts.length - 1]);
      ids.set(parts.join("/"), child.itemId);
      made++;
    } catch (e: any) {
      failed.push(`${parts.join(" / ")}: ${e?.message || "not made"}`);
    }
  }
  return { root, made, failed };
}

// ── Inside a folder (step 3): rename, move, copy, delete, upload, share, preview ──
/** A file or folder before it is changed: what it is, its folder, and whether it is a library's top. */
export async function itemForChange(token: string, driveId: string, itemId: string): Promise<{ entry: DriveEntry; parentId: string | null; isRoot: boolean }> {
  const raw = await call(token, "GET", `/drives/${driveId}/items/${itemId}?$select=${ITEM_SELECT}`);
  return { entry: driveEntry(raw, driveId), parentId: raw?.parentReference?.id ? String(raw.parentReference.id) : null, isRoot: !!raw?.root };
}

/** A new name in the same folder. A name already there is refused, never replaced. */
export async function renameItem(token: string, driveId: string, itemId: string, name: string): Promise<DriveEntry> {
  const res = await graph({ method: "PATCH", url: `/drives/${driveId}/items/${itemId}?@microsoft.graph.conflictBehavior=fail`, token, json: { name } });
  if (res.status >= 400) throw new GraphError(res.status, res.status === 409 ? `Something called "${name}" is already there.` : undefined);
  return driveEntry(res.body, driveId);
}

/** Into another folder of the same library (Microsoft moves within one library only). */
export async function moveItem(token: string, driveId: string, itemId: string, parentId: string): Promise<DriveEntry> {
  const res = await graph({ method: "PATCH", url: `/drives/${driveId}/items/${itemId}?@microsoft.graph.conflictBehavior=fail`, token, json: { parentReference: { id: parentId } } });
  if (res.status >= 400) throw new GraphError(res.status, res.status === 409 ? "Something of that name is already in that folder." : res.status === 400 ? "SharePoint would not move it there (a folder cannot go inside itself)." : undefined);
  return driveEntry(res.body, driveId);
}

/**
 * Starts a copy into any folder, in any library. Microsoft copies in the
 * background and answers with an address to ask how far it has got; that
 * address is on BGP's SharePoint and is asked with no token. Null when it
 * gave none the engine may call.
 */
export async function startCopy(token: string, driveId: string, itemId: string, toDriveId: string, toParentId: string): Promise<string | null> {
  const res = await graph({ method: "POST", url: `/drives/${driveId}/items/${itemId}/copy?@microsoft.graph.conflictBehavior=rename`, token, json: { parentReference: { driveId: toDriveId, id: toParentId } } });
  if (res.status >= 400) throw new GraphError(res.status);
  const target = res.location ? graphTarget(res.location) : null;
  return target && !target.withToken ? res.location : null;
}

/** How far a copy has got. */
export async function copyProgress(monitorUrl: string) {
  const target = graphTarget(monitorUrl);
  if (!target || target.withToken) throw new GraphError(400, "Not a copy SharePoint is running.");
  const res = await graph({ method: "GET", url: monitorUrl, token: null });
  return copyState(res.status, res.body, res.location);
}

/** To the library's recycle bin, where it can be restored for 93 days. */
export async function deleteItem(token: string, driveId: string, itemId: string): Promise<void> {
  const res = await graph({ method: "DELETE", url: `/drives/${driveId}/items/${itemId}`, token });
  if (res.status >= 400) throw new GraphError(res.status);
}

/** A file of up to 10 MB in one go. A name already there gets a number added, never replaced. */
export async function uploadSmall(token: string, driveId: string, parentId: string, name: string, bytes: Uint8Array): Promise<DriveEntry> {
  if (bytes.length > UPLOAD_SESSION_ABOVE) throw new GraphError(413, "Larger files go up in pieces.");
  const res = await graph({ method: "PUT", url: `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`, token, bytes, headers: { "Content-Type": "application/octet-stream" } });
  if (res.status >= 400) throw new GraphError(res.status);
  return driveEntry(res.body, driveId);
}

/** An upload session for a larger file: the address the pieces go to, signed by Microsoft. */
export async function startUploadSession(token: string, driveId: string, parentId: string, name: string): Promise<{ uploadUrl: string; expires: string | null }> {
  const res = await graph({ method: "POST", url: `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}:/createUploadSession`, token, json: { item: { "@microsoft.graph.conflictBehavior": "rename", name } } });
  if (res.status >= 400) throw new GraphError(res.status);
  const uploadUrl = String(res.body?.uploadUrl || "");
  const target = graphTarget(uploadUrl);
  if (!target || target.withToken) throw new GraphError(502, "SharePoint gave no upload address the app may use.");
  return { uploadUrl, expires: res.body?.expirationDateTime || null };
}

/** One piece of a session, with no token. Done gives the file; otherwise where the next piece starts. */
export async function uploadPiece(uploadUrl: string, bytes: Uint8Array, start: number, total: number): Promise<{ done: DriveEntry | null; next: number }> {
  const res = await graph({ method: "PUT", url: uploadUrl, token: null, bytes, headers: { "Content-Range": contentRange(start, bytes.length, total) } });
  if (res.status === 200 || res.status === 201) return { done: driveEntry(res.body), next: total };
  if (res.status === 202) {
    const next = Number(String(res.body?.nextExpectedRanges?.[0] ?? "").split("-")[0]);
    return { done: null, next: Number.isFinite(next) && next > start ? next : start + bytes.length };
  }
  throw new GraphError(res.status);
}

/** Ends a session that will not be finished. */
export async function cancelUploadSession(uploadUrl: string): Promise<void> {
  await graph({ method: "DELETE", url: uploadUrl, token: null }).catch(() => undefined);
}

/**
 * A link to send. "Anyone with the link" falls back to people in BGP when
 * BGP's sharing rules do not allow it, and says so.
 */
export async function shareLink(token: string, driveId: string, itemId: string, opts: { scope: "anonymous" | "organization"; edit: boolean }): Promise<{ url: string; scope: "anonymous" | "organization"; edit: boolean; fellBack: boolean }> {
  const make = (scope: "anonymous" | "organization") => graph({ method: "POST", url: `/drives/${driveId}/items/${itemId}/createLink`, token, json: { type: opts.edit ? "edit" : "view", scope } });
  let res = await make(opts.scope);
  let fellBack = false;
  if (res.status >= 400 && opts.scope === "anonymous" && (res.status === 400 || res.status === 403)) {
    res = await make("organization");
    fellBack = res.status < 400;
  }
  if (res.status >= 400) throw new GraphError(res.status);
  const url = String(res.body?.link?.webUrl || "");
  if (!/^https:\/\//.test(url)) throw new GraphError(502, "SharePoint gave no link.");
  return { url, scope: fellBack ? "organization" : opts.scope, edit: opts.edit, fellBack };
}

/** Named people, by email, with SharePoint's own invitation. They sign in to open it. */
export async function invitePeople(token: string, driveId: string, itemId: string, emails: string[], write: boolean, message: string): Promise<void> {
  const res = await graph({
    method: "POST", url: `/drives/${driveId}/items/${itemId}/invite`, token,
    json: { recipients: emails.map(email => ({ email })), roles: [write ? "write" : "read"], requireSignIn: true, sendInvitation: true, message },
  });
  if (res.status >= 400) throw new GraphError(res.status);
}

/** An address that shows the file in a frame, as the person who asked for it. */
export async function previewUrl(token: string, driveId: string, itemId: string): Promise<string> {
  const res = await graph({ method: "POST", url: `/drives/${driveId}/items/${itemId}/preview`, token, json: {} });
  if (res.status >= 400) throw new GraphError(res.status);
  const url = String(res.body?.getUrl || "");
  if (!/^https:\/\//.test(url)) throw new GraphError(415, "SharePoint has no preview of that file: open it in SharePoint.");
  return url;
}

// ── Files, for the code that works by path (ChatBGP's tools, Model Studio, the MCP server, Pathway) ──
/** Above this a file is not read into the app: it is opened in SharePoint. */
export const DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;

/**
 * A file's content. Graph gives a short-lived address on BGP's SharePoint to
 * fetch it from, which is asked with no token (graphTarget allows only BGP's
 * own SharePoint there).
 */
export async function downloadFile(token: string, driveId: string, itemId: string, maxBytes = DOWNLOAD_MAX_BYTES): Promise<{ entry: DriveEntry; bytes: Uint8Array }> {
  const item = await call(token, "GET", `/drives/${driveId}/items/${itemId}`);
  const entry = driveEntry(item, driveId);
  const tooLarge = () => new GraphError(413, `That file is over ${Math.round(maxBytes / 1024 / 1024)} MB: open it in SharePoint.`);
  if (entry.isFolder) throw new GraphError(400, "That is a folder, not a file.");
  if (entry.size !== null && entry.size > maxBytes) throw tooLarge();
  const url = String(item?.["@microsoft.graph.downloadUrl"] || "");
  const target = url ? graphTarget(url) : null;
  if (!target || target.withToken) throw new GraphError(502, "SharePoint gave no download address the app may use.");
  const res = await graph({ method: "GET", url, token: null, binary: true });
  if (res.status >= 400) throw new GraphError(res.status);
  const bytes = res.body instanceof Uint8Array ? res.body : new Uint8Array();
  if (bytes.length > maxBytes) throw tooLarge();
  return { entry, bytes };
}

/** Files and folders by name in one drive. */
export async function searchDrive(token: string, driveId: string, q: string, top = 50): Promise<DriveEntry[]> {
  const text = encodeURIComponent(q.replace(/'/g, "''"));
  const res = await graph({ method: "GET", url: `/drives/${driveId}/root/search(q='${text}')?$top=${Math.max(1, Math.min(200, Math.trunc(top)))}&$select=${ITEM_SELECT}`, token });
  if (res.status >= 400) throw new GraphError(res.status);
  return ((res.body?.value || []) as any[]).map(i => driveEntry(i, driveId)).filter(e => e.driveId && e.itemId);
}

/** A file the server holds, into a folder: in one go up to 10 MB, in pieces above. A name already there gets a number added. */
export async function uploadFile(token: string, driveId: string, parentId: string, name: string, bytes: Uint8Array): Promise<DriveEntry> {
  if (bytes.length <= UPLOAD_SESSION_ABOVE) return uploadSmall(token, driveId, parentId, name, bytes);
  const session = await startUploadSession(token, driveId, parentId, name);
  try {
    let start = 0;
    while (start < bytes.length) {
      const out = await uploadPiece(session.uploadUrl, bytes.subarray(start, Math.min(bytes.length, start + UPLOAD_PIECE)), start, bytes.length);
      if (out.done) return out.done;
      start = out.next;
    }
  } catch (e) {
    await cancelUploadSession(session.uploadUrl);
    throw e;
  }
  await cancelUploadSession(session.uploadUrl);
  throw new GraphError(502, "SharePoint did not finish the upload.");
}

/**
 * New content for a file the app keeps for a record (a model run's live copy
 * that Embed Excel shows): the same file, its name and folder unchanged. Up
 * to 10 MB; anything larger goes up as a new copy.
 */
export async function replaceFileContent(token: string, driveId: string, itemId: string, bytes: Uint8Array): Promise<DriveEntry> {
  if (bytes.length > UPLOAD_SESSION_ABOVE) throw new GraphError(413, "Files over 10 MB go up as a new copy.");
  const res = await graph({ method: "PUT", url: `/drives/${driveId}/items/${itemId}/content`, token, bytes, headers: { "Content-Type": "application/octet-stream" } });
  if (res.status >= 400) throw new GraphError(res.status);
  return driveEntry(res.body, driveId);
}
