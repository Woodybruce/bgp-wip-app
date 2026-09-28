// Brochures and tenancy / leasing schedules straight from SharePoint (Woody,
// 2026-09-28: "should be able to pull the leasing schedule and brochure from
// the SharePoint too?"). Candidates come from three places, all on the app
// Graph token:
//   1. the property's linked folder (crm_properties.sharepoint_folder_url),
//      walked recursively — marketing / brochure / leasing folders first;
//   2. a Microsoft 365 search for the property's name across SharePoint and
//      OneDrive (falls back to a search of the BGP site drive);
//   3. the indexed SharePoint files (knowledge_base) whose name or path names
//      the property.
// Then ranked: brochures by leasing vs investment, brochure-like name, newest
// first; schedules by tenancy-schedule-like name, newest first; plans
// (PDFs and images) by plan-like names and Floor Plans / GA / Goad folders,
// whole-building before single units. Staff only — the routes refuse client
// logins.

import { sharesId } from "./sharepoint-graph";

export type SpKind = "brochure" | "schedule" | "plan";
export type BrochureType = "leasing" | "investment";
export type SpCandidate = {
  name: string;
  path: string;
  webUrl: string | null;
  driveId: string | null;
  itemId: string | null;
  size: number | null;
  lastModified: string | null;
  source: "folder" | "search" | "index";
  docDate?: string | null;
  type?: BrochureType;
  tier?: number;
  imported?: boolean;
};

const words = (s: string) => ` ${String(s || "").replace(/[_\-.+]+/g, " ").replace(/\s+/g, " ").trim()} `;

export const isPdf = (name: string) => /\.pdf$/i.test(name || "");
export const isSpreadsheet = (name: string) => /\.(xlsx|xlsm|xls)$/i.test(name || "") && !/^~\$/.test(name || "");
export const isPlanFile = (name: string) => /\.(pdf|png|jpe?g|webp)$/i.test(name || "");

const INVESTMENT_RE = /\b(investment|information memorandum|for sale|portfolios?|project [a-z]+|disposals?|acquisitions?|sales? (particulars|brochure|details))\b/i;
const LEASING_RE = /\b(leasing|letting|to let|lettings)\b/i;
// Upper-case abbreviations only: "OM" / "IM" as their own word.
const OM_RE = /(^|[^A-Za-z])(OM|IM)([^A-Za-z]|$)/;

/** Leasing vs investment: the file name decides when it says; otherwise an
 *  investment / sale / portfolio / project folder makes it investment. */
export function brochureType(name: string, path: string): BrochureType {
  const n = words(String(name || "").replace(/\.[a-z0-9]+$/i, ""));
  if (INVESTMENT_RE.test(n) || OM_RE.test(n)) return "investment";
  if (LEASING_RE.test(n)) return "leasing";
  if (INVESTMENT_RE.test(words(path))) return "investment";
  return "leasing";
}

/** 2 = the name says brochure / particulars / details / OM; 1 = it sits in a
 *  brochure or marketing folder; 0 = any other PDF. */
export function brochureTier(name: string, path: string): number {
  const n = words(String(name || "").replace(/\.[a-z0-9]+$/i, ""));
  if (/\b(brochure|particulars|details|marketing|information memorandum|flyer)\b/i.test(n) || OM_RE.test(n)) return 2;
  if (/\b(brochures?|particulars|marketing|details)\b/i.test(words(path))) return 1;
  return 0;
}

/** 2 = tenancy schedule / TS / rent roll / leasing schedule; 1 = a schedule,
 *  tenancy or rent sheet (not a service charge budget); 0 = anything else. */
export function scheduleTier(name: string, path: string): number {
  const n = words(String(name || "").replace(/\.[a-z0-9]+$/i, ""));
  if (/\b(tenancy schedule|tenancy schedules|rent roll|leasing schedule|schedule of tenancies|tenancy)\b/i.test(n) || /(^|[^A-Za-z])TS([^A-Za-z]|$)/.test(n)) return 2;
  if (/\b(service charge|budget|cash ?flow|invoice)\b/i.test(n)) return 0;
  if (/\b(schedule|tenants?|leases?|rent)\b/i.test(n)) return 1;
  if (/\b(tenancy|leasing schedule|rent roll)\b/i.test(words(path))) return 1;
  return 0;
}

const PLAN_NAME_RE = /\b(floor ?plans?|site ?plans?|goad|general arrangement|layouts?|plans?)\b/i;
// Upper-case "GA" (general arrangement) as its own word.
const GA_RE = /(^|[^A-Za-z])GA([^A-Za-z]|$)/;
const PLAN_LEVEL_RE = /\b(basement|lower ground|upper ground|ground|mezzanine|mezz|first|second|third|fourth|fifth|roof|level \d+)\b/i;
const PLAN_FOLDER_RE = /\b(floor ?plans?|plans?|goad|drawings?|layouts?|survey|cad)\b/i;
const NOT_PLAN_RE = /\b(sections?|elevations?|rcp|reflected ceiling|index of drawings|specification|licen[cs]e|lease|invoice|brochure|particulars|schedule|minutes|letter|accounts?|valuation)\b/i;
const planFolder = (folder: string) => PLAN_FOLDER_RE.test(words(folder)) || GA_RE.test(folder);

/** How plan-like a file is: +3 a plan name (floor plan, site plan, Goad, GA,
 *  layout), +1 a floor in the name, +2 it sits in a Floor Plans / GA /
 *  drawings folder (+1 when such a folder is further up), -2 a section,
 *  elevation, licence, lease, brochure or other non-plan document. */
export function planTier(name: string, path: string): number {
  const base = String(name || "").replace(/\.[a-z0-9]+$/i, "");
  const n = words(base);
  const folders = String(path || "").split("/").filter(Boolean);
  let score = 0;
  if (PLAN_NAME_RE.test(n) || GA_RE.test(base)) score += 3;
  if (PLAN_LEVEL_RE.test(n)) score += 1;
  if (folders.length && planFolder(folders[folders.length - 1])) score += 2;
  else if (folders.some(planFolder)) score += 1;
  if (NOT_PLAN_RE.test(n)) score -= 2;
  return Math.max(0, score);
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_YEAR_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s']*(\d{4}|\d{2})\b/i;
const ISO_MONTH_RE = /\b(20\d{2})\s?(0[1-9]|1[0-2])\b/;

function dateIn(text: string): string | null {
  const t = words(text);
  const m = t.match(MONTH_YEAR_RE);
  if (m) {
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    if (year >= 2000 && year <= 2099) return `${year}-${String(MONTHS[m[1].slice(0, 3).toLowerCase()]).padStart(2, "0")}-01`;
  }
  const iso = t.match(ISO_MONTH_RE);
  return iso ? `${iso[1]}-${iso[2]}-01` : null;
}

/** The document's own date: a month + year in the file name ("Dec 25"), then
 *  in the nearest folder ("… April 2024"), else SharePoint's modified date —
 *  migrated files carry the copy date, so a written date is trusted first. */
export function documentDate(name: string, path: string, lastModified: string | null): string | null {
  const fromName = dateIn(String(name || "").replace(/\.[a-z0-9]+$/i, ""));
  if (fromName) return fromName;
  const folders = String(path || "").split("/").reverse();
  for (const folder of folders.slice(0, 3)) {
    const d = dateIn(folder);
    if (d) return d;
  }
  return lastModified ? String(lastModified).slice(0, 10) : null;
}

export function urlKey(url: string | null | undefined): string | null {
  if (!url) return null;
  let u = String(url);
  try { u = decodeURIComponent(u); } catch { /* keep raw */ }
  const source = u.match(/sourcedoc=\{?([0-9a-f-]{36})/i);
  if (source) return `doc:${source[1].toLowerCase()}`;
  return u.split("?")[0].replace(/\/+$/, "").toLowerCase();
}

/** Folder path for display and classification, from Graph's parentReference
 *  ("/drives/b!x/root:/BGP share drive/London/…") or else the webUrl. */
export function candidatePath(item: any): string {
  const parent = String(item?.parentReference?.path || "");
  if (parent.includes("root:")) return decodeURIComponentSafe(parent.split("root:")[1] || "").replace(/^\/+/, "");
  const url = String(item?.webUrl || "");
  if (!url || /sourcedoc=/i.test(url)) return "";
  const path = decodeURIComponentSafe(url.split("?")[0]).replace(/^https?:\/\/[^/]+\//i, "");
  return path.split("/").slice(0, -1).join("/");
}

function decodeURIComponentSafe(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function fromGraphItem(item: any, source: SpCandidate["source"]): SpCandidate {
  return {
    name: String(item?.name || ""),
    path: candidatePath(item),
    webUrl: item?.webUrl || null,
    driveId: item?.parentReference?.driveId || null,
    itemId: item?.id || null,
    size: typeof item?.size === "number" ? item.size : null,
    lastModified: item?.lastModifiedDateTime || null,
    source,
  };
}

/** One entry per file: the same item from the folder walk and the search (or
 *  the index, matched on its URL) collapses to the first, keeping any ids. */
export function mergeCandidates(lists: SpCandidate[][]): SpCandidate[] {
  const out: SpCandidate[] = [];
  const byKey = new Map<string, SpCandidate>();
  for (const c of lists.flat()) {
    const keys = [c.driveId && c.itemId ? `item:${c.driveId}:${c.itemId}` : null, urlKey(c.webUrl)].filter(Boolean) as string[];
    const hit = keys.map(k => byKey.get(k)).find(Boolean);
    if (hit) {
      if (!hit.driveId && c.driveId) hit.driveId = c.driveId;
      if (!hit.itemId && c.itemId) hit.itemId = c.itemId;
      if (!hit.path && c.path) hit.path = c.path;
      if (!hit.lastModified && c.lastModified) hit.lastModified = c.lastModified;
      if (hit.size == null && c.size != null) hit.size = c.size;
      for (const k of keys) byKey.set(k, hit);
      continue;
    }
    const copy = { ...c };
    out.push(copy);
    for (const k of keys) byKey.set(k, copy);
  }
  return out;
}

// A single unit's particulars ("Unit 7-8 … Particulars", "Mezzanine …") sit
// below the whole-scheme brochure (Woody, 2026-09-28: the Royal Exchange's
// 2023 unit particulars outranked the Dec 25 scheme brochure).
const UNIT_LEVEL = /\b(units?\s*\d|shop\s*\d|mezzanine|kiosk|suite\s*\d)/i;
// The same file copied into several drives shows once.
const sameFile = (c: SpCandidate) => `${String(c.name || "").toLowerCase().replace(/\s*\(\d+\)(?=\.[a-z0-9]+$)/, "")}|${c.size ?? ""}`;

/** Brochures: the wanted type first, then brochure-like names, whole-scheme
 *  before single units, newest first; copies of one file collapse. */
export function rankBrochureCandidates(list: SpCandidate[], wanted: BrochureType): SpCandidate[] {
  const seen = new Set<string>();
  return list.filter(c => isPdf(c.name)).map(c => ({
    ...c,
    type: brochureType(c.name, c.path),
    tier: brochureTier(c.name, c.path),
    docDate: documentDate(c.name, c.path, c.lastModified),
  })).sort((a, b) =>
    Number(b.type === wanted) - Number(a.type === wanted)
    || (b.tier! - a.tier!)
    || Number(UNIT_LEVEL.test(a.name)) - Number(UNIT_LEVEL.test(b.name))
    || String(b.docDate || "").localeCompare(String(a.docDate || "")))
    .filter(c => { const k = sameFile(c); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Schedules: tenancy-schedule-like names first, newest first. */
export function rankScheduleCandidates(list: SpCandidate[]): SpCandidate[] {
  return list.filter(c => isSpreadsheet(c.name)).map(c => ({
    ...c,
    tier: scheduleTier(c.name, c.path),
    docDate: documentDate(c.name, c.path, c.lastModified),
  })).sort((a, b) => (b.tier! - a.tier!) || String(b.docDate || "").localeCompare(String(a.docDate || "")));
}

// A plan of one unit ("Unit 5 …", a "Unit 2-3" folder) sits below the
// whole-building drawings — the Plans board is the building's.
const UNIT_PLAN = /\b(units?|shop|suite|kiosk)\s*\d/i;
const unitPlan = (c: SpCandidate) => UNIT_PLAN.test(c.name) || UNIT_PLAN.test(String(c.path || "").split("/").pop() || "");

/** Plans: whole-building first, then plan-like tier, PDFs before an image of
 *  the same drawing, newest, then drawing-number order; anything that isn't
 *  plan-like (tier under 2) is left out, and copies of one file collapse. */
export function rankPlanCandidates(list: SpCandidate[]): SpCandidate[] {
  const seen = new Set<string>();
  return list.filter(c => isPlanFile(c.name)).map(c => ({
    ...c,
    tier: planTier(c.name, c.path),
    docDate: documentDate(c.name, c.path, c.lastModified),
  })).filter(c => c.tier! >= 2).sort((a, b) =>
    Number(unitPlan(a)) - Number(unitPlan(b))
    || (b.tier! - a.tier!)
    || Number(isPdf(b.name)) - Number(isPdf(a.name))
    || String(b.docDate || "").localeCompare(String(a.docDate || ""))
    || a.name.localeCompare(b.name, undefined, { numeric: true }))
    .filter(c => { const k = sameFile(c); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** A Graph failure in words the team can act on. */
export function plainGraphError(error: any): string {
  const msg = String(error?.message || error || "");
  if (/credentials not configured|authentication failed|app-only token/i.test(msg)) return "SharePoint isn't connected on this server right now.";
  const status = Number(msg.match(/Graph API (\d{3})/)?.[1] || error?.status || 0);
  if (status === 401 || status === 403) return "The app isn't allowed to read that SharePoint location.";
  if (status === 404) return "That file or folder isn't in SharePoint any more — it may have been moved or deleted.";
  if (status === 429 || status === 503) return "SharePoint is busy — try again in a minute.";
  return "SharePoint didn't respond — try again in a moment.";
}

// The BGP tenant's SharePoint and OneDrive hosts — nothing else is resolved.
export const SHAREPOINT_URL_RE = /^https:\/\/brucegillinghampollardlimited(-my)?\.sharepoint\.com\//i;

type Graph = (path: string, options?: RequestInit) => Promise<any>;
async function defaultGraph(): Promise<Graph> {
  return (await import("./shared-mailbox")).graphRequest;
}

const FOLDER_PRIORITY = /market|brochure|particular|detail|leas|letting|tenan|schedule|rent|investment|sale/i;
const PLAN_FOLDER_PRIORITY = /plan|floor|goad|drawing|survey|cad|layout|(^|[^A-Za-z])GA([^A-Za-z]|$)/i;

/** Every matching file under the linked folder, breadth first, marketing /
 *  leasing / tenancy folders first (plan folders first for plans), bounded
 *  by folder count and time. */
export async function walkLinkedFolder(folderUrl: string, want: (name: string) => boolean, deps: { graph?: Graph; maxFolders?: number; budgetMs?: number; priority?: RegExp } = {}): Promise<SpCandidate[]> {
  const graph = deps.graph || await defaultGraph();
  const priority = deps.priority || FOLDER_PRIORITY;
  const root = await graph(`/shares/${sharesId(folderUrl)}/driveItem?$select=id,name,webUrl,parentReference,folder`);
  const driveId = root?.parentReference?.driveId;
  if (!root?.id || !driveId) return [];
  const { listAllChildren } = await import("./microsoft-graph-pagination");
  const deadline = Date.now() + (deps.budgetMs ?? 20_000);
  const maxFolders = deps.maxFolders ?? 150;
  const queue: Array<{ id: string; depth: number }> = [{ id: root.id, depth: 0 }];
  const out: SpCandidate[] = [];
  let listed = 0;
  while (queue.length && listed < maxFolders && Date.now() < deadline) {
    const batch = queue.splice(0, 4);
    listed += batch.length;
    const pages = await Promise.all(batch.map(f => listAllChildren(
      (url) => graph(url),
      `/drives/${driveId}/items/${f.id}/children?$top=200&$select=id,name,size,webUrl,file,folder,lastModifiedDateTime,parentReference`,
    ).then(items => ({ f, items })).catch(() => ({ f, items: [] as any[] }))));
    for (const { f, items } of pages) {
      const folders = items.filter((i: any) => i.folder && f.depth < 6)
        .sort((a: any, b: any) => Number(priority.test(b.name)) - Number(priority.test(a.name)));
      queue.push(...folders.map((i: any) => ({ id: i.id, depth: f.depth + 1 })));
      for (const i of items) if (i.file && want(i.name)) out.push(fromGraphItem({ ...i, parentReference: { ...i.parentReference, driveId: i.parentReference?.driveId || driveId } }, "folder"));
    }
    queue.sort((a, b) => a.depth - b.depth);
  }
  return out;
}

const wantFor = (kind: SpKind) => kind === "brochure" ? isPdf : kind === "plan" ? isPlanFile : isSpreadsheet;
const searchName = (propertyName: string) => String(propertyName || "").replace(/["'*()]/g, " ").replace(/^\s*the\s+/i, "").replace(/\s+/g, " ").trim();

/** Microsoft 365 search (all SharePoint sites and OneDrives) for files naming
 *  the property; app-only search needs the tenant's region. Falls back to a
 *  search of the BGP site drive when that isn't available. */
export async function searchPropertyFiles(propertyName: string, kind: SpKind, deps: { graph?: Graph } = {}): Promise<SpCandidate[]> {
  const name = searchName(propertyName);
  if (name.length < 3) return [];
  const graph = deps.graph || await defaultGraph();
  const filter = kind === "brochure"
    ? `filetype:pdf AND (brochure OR particulars OR details OR memorandum OR marketing OR "to let" OR "for sale" OR investment)`
    : kind === "plan"
      ? `(filetype:pdf OR filetype:png OR filetype:jpg OR filetype:jpeg) AND (plan OR plans OR floorplan OR goad OR layout OR drawing OR GA)`
      : `(filetype:xlsx OR filetype:xlsm OR filetype:xls) AND (tenancy OR schedule OR "rent roll" OR tenant OR TS)`;
  const want = wantFor(kind);
  try {
    const res = await graph("/search/query", {
      method: "POST",
      body: JSON.stringify({ requests: [{
        entityTypes: ["driveItem"],
        query: { queryString: `"${name}" AND ${filter}` },
        from: 0, size: 50,
        region: process.env.GRAPH_SEARCH_REGION || "GBR",
      }] }),
    });
    const hits = (res?.value || []).flatMap((v: any) => v?.hitsContainers || []).flatMap((c: any) => c?.hits || []).map((h: any) => h?.resource).filter(Boolean);
    return hits.filter((r: any) => want(r.name)).map((r: any) => fromGraphItem(r, "search"));
  } catch (error: any) {
    console.warn("[sharepoint-property-files] Microsoft 365 search failed, searching the BGP site drive:", String(error?.message || error).slice(0, 200));
  }
  const { getAppToken } = await import("./shared-mailbox");
  const { getSharePointDriveId } = await import("./sharepoint-graph");
  const site = await getSharePointDriveId(await getAppToken());
  if (!site) throw new Error("Graph API 404: BGP SharePoint site not found");
  const q = encodeURIComponent(name.replace(/'/g, "''"));
  const res = await graph(`/drives/${site.driveId}/root/search(q='${q}')?$top=200&$select=id,name,size,webUrl,file,lastModifiedDateTime,parentReference`);
  return (res?.value || []).filter((r: any) => r.file && want(r.name)).map((r: any) => fromGraphItem(r, "search"));
}

/** The indexed SharePoint files whose name or path names the property. */
export async function indexedPropertyFiles(pool: any, propertyName: string, kind: SpKind): Promise<SpCandidate[]> {
  const parts = searchName(propertyName).toLowerCase().split(" ").filter(Boolean);
  if (!parts.join("").length || parts.join("").length < 3) return [];
  const like = `%${parts.map(p => p.replace(/[\\%_]/g, m => `\\${m}`)).join("%")}%`;
  const ext = kind === "brochure" ? "\\.pdf$" : kind === "plan" ? "\\.(pdf|png|jpe?g|webp)$" : "\\.(xlsx|xlsm|xls)$";
  const rows = (await pool.query(
    `SELECT file_name, file_path, file_url, last_modified, size_bytes FROM knowledge_base
      WHERE coalesce(source, 'sharepoint') = 'sharepoint' AND file_url IS NOT NULL
        AND file_name ~* $1 AND (file_name ILIKE $2 OR file_path ILIKE $2)
      ORDER BY last_modified DESC NULLS LAST LIMIT 40`, [ext, like])).rows;
  return rows.map((r: any) => ({
    name: r.file_name,
    path: String(r.file_path || "").split("/").slice(0, -1).join("/"),
    webUrl: r.file_url,
    driveId: null, itemId: null,
    size: r.size_bytes == null ? null : Number(r.size_bytes),
    lastModified: r.last_modified ? new Date(r.last_modified).toISOString() : null,
    source: "index" as const,
  }));
}

export type CandidateResult = { candidates: SpCandidate[]; linkedFolder: string | null; propertyName: string; warnings: string[] };

/** Everything the finder shows for one property, ranked. */
export async function findPropertyFiles(pool: any, propertyId: string, kind: SpKind, wanted: BrochureType = "leasing", deps: { graph?: Graph } = {}): Promise<CandidateResult> {
  const property = (await pool.query(`SELECT name, sharepoint_folder_url FROM crm_properties WHERE id = $1`, [propertyId])).rows[0];
  if (!property) throw Object.assign(new Error("Property not found"), { status: 404 });
  const folderUrl: string | null = property.sharepoint_folder_url || null;
  const want = wantFor(kind);
  const [folder, search, index] = await Promise.allSettled([
    folderUrl ? walkLinkedFolder(folderUrl, want, kind === "plan" ? { ...deps, priority: PLAN_FOLDER_PRIORITY } : deps) : Promise.resolve([]),
    searchPropertyFiles(property.name, kind, deps),
    indexedPropertyFiles(pool, property.name, kind),
  ]);
  const warnings: string[] = [];
  if (folder.status === "rejected") warnings.push(`Linked folder: ${plainGraphError(folder.reason)}`);
  if (search.status === "rejected") warnings.push(`Search: ${plainGraphError(search.reason)}`);
  if (index.status === "rejected") console.warn("[sharepoint-property-files] index lookup failed:", index.reason?.message);
  const merged = mergeCandidates([
    folder.status === "fulfilled" ? folder.value : [],
    search.status === "fulfilled" ? search.value : [],
    index.status === "fulfilled" ? index.value : [],
  ]);
  const ranked = kind === "brochure" ? rankBrochureCandidates(merged, wanted) : kind === "plan" ? rankPlanCandidates(merged) : rankScheduleCandidates(merged);
  return { candidates: ranked.slice(0, kind === "plan" ? 60 : 40), linkedFolder: folderUrl, propertyName: property.name, warnings };
}

export type SpFileRef = { driveId?: string | null; itemId?: string | null; webUrl?: string | null };
export type SpFileMeta = { driveId: string; itemId: string; name: string; size: number; webUrl: string | null; lastModified: string | null };

const GRAPH_ID_RE = /^[A-Za-z0-9!_\-.]{1,200}$/;

/** The driveItem a picked candidate points at (ids when the finder had them,
 *  otherwise its SharePoint URL). */
export async function resolveFileRef(ref: SpFileRef, deps: { graph?: Graph } = {}): Promise<SpFileMeta> {
  const graph = deps.graph || await defaultGraph();
  let item: any;
  if (ref.driveId && ref.itemId) {
    if (!GRAPH_ID_RE.test(ref.driveId) || !GRAPH_ID_RE.test(ref.itemId)) throw Object.assign(new Error("That SharePoint file reference isn't valid."), { status: 400 });
    item = await graph(`/drives/${ref.driveId}/items/${ref.itemId}?$select=id,name,size,webUrl,file,lastModifiedDateTime,parentReference`);
  } else if (ref.webUrl && SHAREPOINT_URL_RE.test(ref.webUrl)) {
    item = await graph(`/shares/${sharesId(ref.webUrl)}/driveItem?$select=id,name,size,webUrl,file,lastModifiedDateTime,parentReference`);
  } else {
    throw Object.assign(new Error("Pick a file from the SharePoint list."), { status: 400 });
  }
  if (!item?.id || !item?.file || !item?.parentReference?.driveId) throw Object.assign(new Error("That SharePoint item isn't a file."), { status: 400 });
  return { driveId: item.parentReference.driveId, itemId: item.id, name: item.name, size: Number(item.size) || 0, webUrl: item.webUrl || null, lastModified: item.lastModifiedDateTime || null };
}

/** The file's bytes via the app token. */
export async function downloadFile(meta: SpFileMeta): Promise<Buffer> {
  const { getAppToken } = await import("./shared-mailbox");
  const token = await getAppToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/drives/${meta.driveId}/items/${meta.itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "follow",
  });
  if (!res.ok) throw new Error(`Graph API ${res.status}: download failed`);
  return Buffer.from(await res.arrayBuffer());
}
