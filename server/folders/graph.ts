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
  SHARE_DRIVE_NAME, driveKindOf, folderDisplayPath, folderTreeOrder, folderTreePaths, graphRefusalWords,
  type DriveEntry, type FolderPlaces,
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
}
export interface GraphResponse { status: number; body: any; location: string | null; retryAfter: number | null }
export type GraphTransport = (r: GraphRequest) => Promise<GraphResponse>;

const fetchTransport: GraphTransport = async (r) => {
  const headers: Record<string, string> = { ...(r.headers || {}) };
  if (r.token) headers.Authorization = `Bearer ${r.token}`;
  let body: any;
  if (r.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(r.json); }
  else if (r.bytes) body = r.bytes;
  const res = await fetch(r.url, { method: r.method, headers, body, signal: AbortSignal.timeout(90_000) });
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

/** The folder a pasted SharePoint or OneDrive address opens. */
export async function openLink(token: string, url: string): Promise<DriveEntry> {
  return driveEntry(await call(token, "GET", `/shares/${sharesId(url)}/driveItem?$select=${ITEM_SELECT}`));
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
