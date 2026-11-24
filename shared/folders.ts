// Folders: one engine (Woody, 24 November 2026: "go ahead with the folder
// suggestion"; docs/folders-review-2026-11-20.md). The rules the server
// (server/folders/) and the screens (client/src/components/folders/) share.
//
// A folder is known by Microsoft's drive and item ids, never by its address
// or path; the address, name and path are kept only to show and to open. Any
// record can hold several folders, and linking or unlinking never moves,
// renames or deletes anything in SharePoint (review 4.1).
import { CLIENT_FOLDER_TREE } from "./client-folder-tree";

/** BGP's own SharePoint: the tenant's host and the BGP site. */
export const BGP_SHAREPOINT_HOST = "brucegillinghampollardlimited.sharepoint.com";
export const BGP_SHAREPOINT_SITE_URL = `https://${BGP_SHAREPOINT_HOST}/sites/BGP`;
/** The team's own tree: the picker opens here (decision 2), and nothing new is made in "BGP share drive". */
export const SHARE_DRIVE_NAME = "BGP - Share Drive";

/**
 * The top of a library or a OneDrive, and "BGP - Share Drive" itself, are
 * never linked to a record: the picker opens on BGP - Share Drive, and one
 * press would otherwise link the whole drive to a transaction. `library` is
 * the BGP library's top, when known.
 */
export function linkTopProblem(
  item: { name: string; driveId: string; driveKind: "library" | "onedrive"; isRoot: boolean; parentId: string | null },
  library: { driveId: string; itemId: string } | null,
): string | null {
  if (item.isRoot) return `That is the top of ${item.driveKind === "onedrive" ? "a OneDrive" : "the library"}: open the folder you want and link that.`;
  if (item.name === SHARE_DRIVE_NAME && library && item.driveId === library.driveId && item.parentId === library.itemId) {
    return `That is the whole of ${SHARE_DRIVE_NAME}: open the folder you want and link that.`;
  }
  return null;
}

/** A SharePoint folder on BGP's own tenant: its SharePoint or a OneDrive. */
export function bgpSharePointUrl(url: unknown): boolean {
  try {
    const u = new URL(String(url ?? ""));
    return u.protocol === "https:" && /^brucegillinghampollardlimited(-my)?\.sharepoint\.com$/i.test(u.hostname);
  } catch { return false; }
}

// ── The records a folder can hang on ────────────────────────────────────
export const FOLDER_RECORD_TYPES = ["property", "deal", "company", "scheme", "pla_matter", "pathway_run"] as const;
export type FolderRecordType = (typeof FOLDER_RECORD_TYPES)[number];
export function isFolderRecordType(v: unknown): v is FolderRecordType {
  return typeof v === "string" && (FOLDER_RECORD_TYPES as readonly string[]).includes(v);
}
/** A transaction, scheme, Lease Advisory matter or Pathway run also shows its property's folders (review 4.3). */
export const SHOWS_PROPERTY_FOLDERS: readonly FolderRecordType[] = ["deal", "scheme", "pla_matter", "pathway_run"];

/** Everything done to a folder or a link is one row of folder_actions. */
export const FOLDER_ACTIONS = ["link", "unlink", "change", "create", "rename", "move", "copy", "delete", "upload", "share", "invite", "preview", "follow", "unfollow", "share_client", "unshare_client"] as const;
export type FolderAction = (typeof FOLDER_ACTIONS)[number];

/** Where a link came from: picked in the picker, made there, pasted, or moved over from an old column. */
export type FolderLinkSource = "picked" | "created" | "pasted" | `migrated:${string}`;
/** What a link showed at the last read. */
export type FolderStatus = "ok" | "missing" | "no_access";

/** Microsoft's drive and item ids: letters, digits and ! _ - . only. */
export const GRAPH_ID_RE = /^[A-Za-z0-9!_\-.]{1,200}$/;
export function isGraphId(v: unknown): v is string {
  return typeof v === "string" && GRAPH_ID_RE.test(v);
}

/** A link's label: the chip's name, which defaults to the folder's. Changing it never renames the folder. */
export function folderLabel(raw: unknown): string | null {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  return text && text.length <= 80 ? text : null;
}

// ── Colours: six muted ones, the app's own (decision 5) ─────────────────
// Graph has no documented way to read or set OneDrive's folder colour, so a
// colour here shows in the app only. The classes are the design tokens of
// the same names (client/src/index.css, light and dark).
export const FOLDER_COLOURS = [
  { key: "slate", label: "Slate", dot: "bg-folder-slate", tint: "bg-folder-slate/15 border-folder-slate/50" },
  { key: "sage", label: "Sage", dot: "bg-folder-sage", tint: "bg-folder-sage/15 border-folder-sage/50" },
  { key: "sky", label: "Sky", dot: "bg-folder-sky", tint: "bg-folder-sky/15 border-folder-sky/50" },
  { key: "sand", label: "Sand", dot: "bg-folder-sand", tint: "bg-folder-sand/15 border-folder-sand/50" },
  { key: "rose", label: "Rose", dot: "bg-folder-rose", tint: "bg-folder-rose/15 border-folder-rose/50" },
  { key: "plum", label: "Plum", dot: "bg-folder-plum", tint: "bg-folder-plum/15 border-folder-plum/50" },
] as const;
export type FolderColourKey = (typeof FOLDER_COLOURS)[number]["key"];
/** A colour key as stored, or null for none (an unknown key is no colour). */
export function folderColourKey(v: unknown): FolderColourKey | null {
  return FOLDER_COLOURS.find(c => c.key === v)?.key ?? null;
}

// ── Names SharePoint takes ──────────────────────────────────────────────
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d|\.lock|desktop\.ini)$/i;
/** What is wrong with a name a person typed for a new folder or a rename, or null when SharePoint takes it. */
export function itemNameProblem(raw: unknown): string | null {
  const name = String(raw ?? "").trim();
  if (!name) return "Give it a name.";
  if (name.length > 250) return "A name can be at most 250 characters.";
  if (/["*:<>?/\\|]/.test(name)) return 'SharePoint does not take " * : < > ? / \\ or | in a name.';
  if (/\.$/.test(name)) return "A name cannot end with a full stop.";
  if (/^~\$/.test(name) || /_vti_/i.test(name) || RESERVED.test(name.replace(/\.[^.]*$/, "")) || RESERVED.test(name)) return "SharePoint does not take that name.";
  return null;
}

/** A name SharePoint takes, made from a record's name: no " * : < > ? / \ |, no trailing dot or space. */
export function safeFolderName(name: unknown): string {
  return String(name ?? "").replace(/["*:<>?/\\|]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 120);
}

/**
 * A folder template's paths ("Financial Analysis/Cashflow Models"), checked:
 * at most 80, at most four deep, each part a name SharePoint takes.
 */
export function folderTreePaths(input: unknown): { paths: string[][] } | { problem: string } {
  if (!Array.isArray(input)) return { problem: "Which folders?" };
  if (input.length > 80) return { problem: "Too many folders: at most 80." };
  const out: string[][] = [];
  for (const raw of input) {
    const parts = String(raw ?? "").split("/").map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!parts.length) continue;
    if (parts.length > 4) return { problem: `"${String(raw)}" is more than four folders deep.` };
    if (parts.some(p => safeFolderName(p) !== p)) return { problem: `"${String(raw)}" has characters SharePoint does not allow.` };
    out.push(parts);
  }
  return { paths: out };
}

/** Every folder a tree makes, parents first: "A", "A/B", "A/B/C". */
export function folderTreeOrder(paths: string[][]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const parts of paths) {
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join("/");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(parts.slice(0, i));
    }
  }
  return out;
}

// ── Templates (decision 3) ──────────────────────────────────────────────
// "New folder" makes an empty folder; "New property folder" makes the client
// tree's five property folders inside it. The templates keyed by retired
// team names are not offered here.
export const PROPERTY_FOLDER_TEMPLATE: readonly string[] =
  (CLIENT_FOLDER_TREE.find(s => s.key === "03-properties")?.perProperty || []).map(p => p.label);
export const FOLDER_TEMPLATES = [
  { key: "empty", label: "Empty folder", folders: [] as readonly string[] },
  { key: "property", label: "Property folder", folders: PROPERTY_FOLDER_TEMPLATE },
] as const;
export type FolderTemplateKey = (typeof FOLDER_TEMPLATES)[number]["key"];
export function folderTemplate(key: unknown): readonly string[] | null {
  if (key === undefined || key === null || key === "") return [];
  return FOLDER_TEMPLATES.find(t => t.key === key)?.folders ?? null;
}

// ── Where a folder sits, for showing ────────────────────────────────────
const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
/** OneDrive for a person's own drive, a library for a SharePoint site's. */
export function driveKindOf(driveType: unknown): "library" | "onedrive" {
  return driveType === "business" || driveType === "personal" ? "onedrive" : "library";
}
/**
 * "BGP - Share Drive / National / Landsec": from Graph's parentReference.path
 * ("/drives/<id>/root:/BGP - Share Drive/National") and the item's name, else
 * from its address. A library's root is the library itself; a OneDrive's is
 * "My OneDrive".
 */
export function folderDisplayPath(item: { name?: unknown; webUrl?: unknown; root?: unknown; parentReference?: { path?: unknown; driveType?: unknown } | null }): string {
  const name = String(item?.name ?? "").trim();
  const oneDrive = driveKindOf(item?.parentReference?.driveType) === "onedrive";
  const top = oneDrive ? "My OneDrive" : "";
  if (item?.root) return oneDrive ? "My OneDrive" : name || "Documents";
  const parent = typeof item?.parentReference?.path === "string" ? item.parentReference.path : null;
  let parts: string[] | null = null;
  if (parent !== null) {
    const at = parent.indexOf("root:");
    if (at >= 0) parts = parent.slice(at + 5).split("/").filter(Boolean).map(decode);
  }
  if (parts === null) parts = pathFromWebUrl(item?.webUrl)?.slice(0, -1) ?? [];
  return [top, ...parts, name].filter(Boolean).join(" / ");
}
/** The folders of a SharePoint or OneDrive address after its library: ["BGP - Share Drive", "National"]. */
export function pathFromWebUrl(webUrl: unknown): string[] | null {
  let u: URL;
  try { u = new URL(String(webUrl ?? "")); } catch { return null; }
  if (!/\.sharepoint\.com$/i.test(u.hostname)) return null;
  const segs = u.pathname.split("/").filter(Boolean).map(decode);
  // /sites/<site>/<library>/... or /personal/<user>/<library>/...
  if (segs.length >= 3 && /^(sites|teams|personal)$/i.test(segs[0])) return segs.slice(3);
  return segs.slice(1);
}

/** One address however it is spelled: decoded, no query, no trailing slash, lower case. */
export function folderUrlKey(url: unknown): string {
  let u = String(url ?? "").trim();
  try { u = decodeURIComponent(u); } catch { /* keep it as typed */ }
  return u.split("?")[0].replace(/\/+$/, "").toLowerCase();
}

// ── The old columns, read until they are moved over ─────────────────────
// Until the migration (server/folders/migration.ts) has moved a stored
// address into a link, the record shows it read only. The old columns stay
// and are still read where nothing has moved (review 4.7).
export const LEGACY_FOLDER_COLUMNS = {
  propertyDefault: "crm_properties.sharepoint_folder_url",
  propertyTeams: "crm_properties.sharepoint_team_folders",
  dealLink: "crm_deals.sharepoint_link",
} as const;
/** One stored address of one record: what a migration run marks as moved. */
export function legacyFolderKey(column: string, recordId: string, key: string, value: string): string {
  return `${column}|${recordId}|${key}|${String(value).trim()}`;
}

// ── Reading Graph's answers ─────────────────────────────────────────────
/** A link's status from the status Graph answered when it was read. */
export function folderStatusFromGraph(status: number): FolderStatus {
  if (status === 404 || status === 410) return "missing";
  if (status === 401 || status === 403) return "no_access";
  return "ok";
}
/** Plain words for a Graph refusal. */
export function graphRefusalWords(status: number): string {
  if (status === 404 || status === 410) return "That folder or file isn't in SharePoint any more: it may have been moved or deleted.";
  if (status === 401 || status === 403) return "SharePoint says you can't open that. Ask whoever owns the folder for access.";
  if (status === 409) return "Something of that name is already there.";
  if (status === 412) return "It changed in SharePoint since this list was read. Open it again and try once more.";
  if (status === 423) return "It is locked in SharePoint (someone has it open, or it is checked out).";
  if (status === 429 || status === 503) return "SharePoint is busy. Try again in a minute.";
  if (status === 507) return "There is no room left in that library.";
  return `SharePoint answered ${status}.`;
}

// ── Order ───────────────────────────────────────────────────────────────
/** A record's links in a new order: `id` moved to `toIndex`, the rest keeping theirs. */
export function moveLinkTo(ids: string[], id: string, toIndex: number): string[] {
  const at = ids.indexOf(id);
  if (at < 0) return ids.slice();
  const rest = ids.filter(x => x !== id);
  const to = Math.max(0, Math.min(rest.length, Math.trunc(Number.isFinite(toIndex) ? toIndex : at)));
  rest.splice(to, 0, id);
  return rest;
}

// ── What the screens are sent ───────────────────────────────────────────
export interface FolderRecordRef { type: FolderRecordType; id: string; name: string }
/** A file or folder in SharePoint or a OneDrive. */
export interface DriveEntry {
  driveId: string;
  itemId: string;
  name: string;
  isFolder: boolean;
  childCount: number | null;
  size: number | null;
  modified: string | null;
  webUrl: string | null;
  path: string;
  driveKind: "library" | "onedrive";
  mimeType: string | null;
}
/** One folder on a record: a link, or (legacy) an address an old column holds, read only until it is moved over. */
export interface FolderLinkView {
  id: string;
  label: string;
  colour: FolderColourKey | null;
  driveId: string | null;
  itemId: string | null;
  driveKind: "library" | "onedrive" | null;
  name: string | null;
  path: string | null;
  webUrl: string | null;
  status: FolderStatus | "unknown";
  source: string;
  legacy: boolean;
  linkedBy: string | null;
  linkedAt: string | null;
  alsoLinked: FolderRecordRef[];
  /** The client company it is shared with (shared/folder-share.ts), when it is. */
  sharedWith?: { id: string; name: string } | null;
}
export interface RecordFoldersView {
  record: FolderRecordRef;
  /** The viewer's own Microsoft 365 is connected (folder actions run as them, decision 7). */
  connected: boolean;
  folders: FolderLinkView[];
  /** A transaction's property's folders, under "From <property>". */
  inherited: { from: FolderRecordRef; folders: FolderLinkView[] }[];
}
export interface FolderPlaces {
  library: { driveId: string; itemId: string; name: string; webUrl: string | null } | null;
  shareDrive: DriveEntry | null;
  oneDrive: DriveEntry | null;
  followed: DriveEntry[];
}

// ── Inside a folder: uploads, copies, sharing (step 3 of the review) ───
/** Above this a file goes up in pieces through an upload session (4.9, step 3). */
export const UPLOAD_SESSION_ABOVE = 10 * 1024 * 1024;
/** Each piece of a session: Microsoft needs a multiple of 320 KiB (this is 5 MiB). */
export const UPLOAD_PIECE = 16 * 320 * 1024;
/** The most the app takes in one piece of a session. */
export const UPLOAD_PIECE_MAX = 10 * 1024 * 1024;
/** The largest file the app sends on; bigger ones go up in SharePoint itself. */
export const UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;
const PIECE_UNIT = 320 * 1024;

export function needsUploadSession(size: number): boolean {
  return size > UPLOAD_SESSION_ABOVE;
}

/** Why a file cannot go up, or null. */
export function uploadProblem(name: unknown, size: unknown): string | null {
  const nameProblem = itemNameProblem(name);
  if (nameProblem) return nameProblem;
  const n = Number(size);
  if (!Number.isSafeInteger(n) || n < 0) return "That file could not be read.";
  if (n > UPLOAD_MAX_BYTES) return "Files over 1 GB go up in SharePoint itself.";
  return null;
}

/** A file's pieces for an upload session, as [first byte, last byte]. */
export function uploadPieces(size: number, piece = UPLOAD_PIECE): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!(size > 0)) return out;
  for (let start = 0; start < size; start += piece) out.push([start, Math.min(size, start + piece) - 1]);
  return out;
}

export function contentRange(start: number, length: number, total: number): string {
  return `bytes ${start}-${start + length - 1}/${total}`;
}

export function parseContentRange(v: unknown): { start: number; end: number; total: number } | null {
  const m = /^bytes (\d{1,12})-(\d{1,12})\/(\d{1,12})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const [start, end, total] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (start > end || end >= total) return null;
  return { start, end, total };
}

/** Why a piece of a session is refused, or null: it must come next, fit, and be whole 320 KiB blocks unless it is the last. */
export function pieceProblem(range: { start: number; end: number; total: number } | null, length: number, session: { next: number; size: number }): string | null {
  if (!range) return "Send the piece's place in the file.";
  if (range.total !== session.size) return "That piece is from a different file.";
  if (range.start !== session.next) return `The next piece starts at byte ${session.next}.`;
  if (length !== range.end - range.start + 1) return "The piece is not the size it says.";
  if (length > UPLOAD_PIECE_MAX) return "A piece can be at most 10 MB.";
  const last = range.end === range.total - 1;
  if (!last && length % PIECE_UNIT !== 0) return "A piece must be a whole number of 320 KB blocks, except the last.";
  return null;
}

/** How far a copy has got, from what Microsoft's monitor answered. */
export function copyState(status: number, body: any, location: string | null = null): { state: "running" | "done" | "failed"; percent: number | null; itemId: string | null; error: string | null } {
  if (status === 302 || status === 303) {
    const itemId = /\/items\/([A-Za-z0-9!_\-.]+)/.exec(String(location || ""))?.[1] || null;
    return { state: "done", percent: 100, itemId, error: null };
  }
  if (status >= 400) return { state: "failed", percent: null, itemId: null, error: graphRefusalWords(status) };
  const s = String(body?.status || "").toLowerCase();
  const percent = typeof body?.percentageComplete === "number" ? Math.max(0, Math.min(100, Math.round(body.percentageComplete))) : null;
  if (s === "completed") return { state: "done", percent: 100, itemId: body?.resourceId ? String(body.resourceId) : null, error: null };
  if (s === "failed" || s === "deletefailed" || s === "cancelled") {
    const why = String(body?.error?.message || body?.errorCode || "").trim();
    return { state: "failed", percent, itemId: null, error: why ? `SharePoint could not copy it: ${why.slice(0, 200)}` : "SharePoint could not copy it." };
  }
  return { state: "running", percent, itemId: null, error: null };
}

// ── Moving the old links over (4.7 of the review: Preview, Apply, Undo) ──
/** Every stored folder address or path the report reads, and the record it hangs on. */
export const MIGRATION_COLUMNS = [
  { column: "crm_properties.sharepoint_folder_url", recordType: "property", what: "A property's linked folder" },
  { column: "crm_properties.sharepoint_team_folders", recordType: "property", what: "A property's team or extra folder" },
  { column: "crm_properties.folder_teams", recordType: "property", what: "A property's team folder, found by its path" },
  { column: "crm_companies.sharepoint_folder_url", recordType: "company", what: "A company's folder (a client's data room root)" },
  { column: "crm_companies.folder_teams", recordType: "company", what: "A landlord's team folder, found by its path" },
  { column: "crm_deals.sharepoint_link", recordType: "deal", what: "A transaction's SharePoint link" },
  { column: "property_schemes.sharepoint_folder_url", recordType: "scheme", what: "A scheme's folder" },
  { column: "pla_matters.sharepoint_folder_url", recordType: "pla_matter", what: "A Lease Advisory matter's folder" },
  { column: "property_pathway_runs.sharepoint_folder_url", recordType: "pathway_run", what: "A Property Pathway run's folder" },
] as const;
export type MigrationColumn = (typeof MIGRATION_COLUMNS)[number]["column"];
export type MigrationStatus = "opens" | "missing" | "not_folder" | "outside" | "no_access" | "linked" | "error";
export const MIGRATION_STATUS_WORDS: Record<MigrationStatus, string> = {
  opens: "Opens", missing: "Not in SharePoint", not_folder: "A file, not a folder", outside: "Not BGP's SharePoint",
  no_access: "No access", linked: "Already in Folders", error: "Could not be read",
};
/** The old team folders sat at this path in the BGP library: "BGP share drive/<team>/<name>". */
export function teamFolderPath(team: string, name: string): string {
  return `BGP share drive/${String(team).trim()}/${String(name).trim()}`;
}
/** Graph's refusal as a row's status. */
export function migrationStatus(status: number): MigrationStatus {
  if (status === 404 || status === 410) return "missing";
  if (status === 401 || status === 403) return "no_access";
  return "error";
}
/** A row's id: the same stored address of the same record gets the same id in every preview. */
export function migrationRowId(column: string, recordId: string, key: string, value: string): string {
  const s = legacyFolderKey(column, recordId, key, value);
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `m${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}
/** Apply takes the rows of the admin's own preview, within the hour. */
export const MIGRATION_PREVIEW_MINUTES = 60;
export function migrationApplyRefusal(preview: { previewedAt: string; previewedBy: string } | null, userId: string, previewedAt: unknown, now = Date.now()): string | null {
  if (!preview) return "Preview first.";
  if (preview.previewedBy !== userId) return "Apply the preview you made yourself: preview again.";
  if (previewedAt !== preview.previewedAt) return "That preview has been replaced: preview again.";
  if (now - new Date(preview.previewedAt).getTime() > MIGRATION_PREVIEW_MINUTES * 60_000) return "That preview is more than an hour old: preview again.";
  return null;
}
/**
 * Where the app still reads the old columns. They stay until Woody agrees to
 * stop reading them (4.7); this list is what would change then.
 */
export const OLD_FOLDER_READERS: readonly { column: string; where: string; what: string }[] = [
  { column: "crm_properties.sharepoint_folder_url", where: "server/folders/links.ts", what: "Folders shows it read only until it is moved over" },
  { column: "crm_properties.sharepoint_folder_url", where: "server/sharepoint-property-files.ts", what: "the brochure, schedule and plan finders walk it (and folders in Folders)" },
  { column: "crm_properties.sharepoint_folder_url", where: "server/client-sharepoint.ts", what: "a client's data room for the property (decision 6, its own step)" },
  { column: "crm_properties.sharepoint_folder_url", where: "server/property-imagery.ts", what: "property photos from its folder" },
  { column: "crm_properties.sharepoint_folder_url", where: "server/account-folder-map.ts", what: "the client-tree job writes it" },
  { column: "crm_properties.sharepoint_folder_url", where: "server/deal-page.ts", what: "sent with a transaction's property, no longer shown" },
  { column: "crm_properties.sharepoint_team_folders", where: "server/folders/links.ts, server/sharepoint-property-files.ts", what: "Folders (read only) and the finders" },
  { column: "crm_properties.sharepoint_team_folders", where: "server/crm.ts", what: "the old team tabs' links on Property Pathway's Files" },
  { column: "crm_properties.folder_teams", where: "client/src/pages/properties.tsx (PropertyFoldersPanel)", what: "the old team tabs on Property Pathway and a landlord's Files card" },
  { column: "crm_properties.folder_teams", where: "server/deal-page.ts, server/property-merge.ts, server/chatbgp.ts", what: "sent with a transaction's property, merged, described to ChatBGP" },
  { column: "crm_companies.sharepoint_folder_url", where: "server/client-sharepoint.ts, server/account-folder-inventory.ts, server/account-folder-map.ts", what: "a client's data room root (decision 6)" },
  { column: "crm_companies.folder_teams", where: "client/src/components/brand-profile-panel.tsx, server/brand-profile.ts", what: "a landlord's Files card (step 5)" },
  { column: "crm_deals.sharepoint_link", where: "server/folders/links.ts, client/src/pages/deals.tsx", what: "Folders (read only) and the Transactions table's hidden SharePoint column" },
  { column: "property_schemes.sharepoint_folder_url", where: "server/property-schemes.ts, client/src/components/property-schemes-panel.tsx", what: "a scheme's folder link box (step 5)" },
  { column: "pla_matters.sharepoint_folder_url", where: "server/pla-matters.ts, server/pla-folder-template.ts, client/src/pages/pla-matters.tsx", what: "a Lease Advisory matter's folder (step 5)" },
  { column: "property_pathway_runs.sharepoint_folder_url", where: "server/property-pathway.ts, client/src/pages/property-pathway.tsx", what: "a Pathway run's folder (step 5)" },
];

/** People to invite by email: at most 20 addresses, each plausible. */
export function inviteEmails(v: unknown): string[] | null {
  const list = (Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/)).map(e => String(e ?? "").trim().toLowerCase()).filter(Boolean);
  const unique = [...new Set(list)];
  if (!unique.length || unique.length > 20) return null;
  return unique.every(e => /^[^\s@<>()"',;]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(e)) ? unique : null;
}
