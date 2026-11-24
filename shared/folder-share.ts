// Folders shared with a client (Woody, 24 November 2026: decision 6 of
// docs/folders-review-2026-11-20.md, "let BGP staff share chosen folders with
// a client"). BGP staff share a folder linked to a record with the client
// company whose logins can open that record; the client then sees that folder
// and everything in it, read only, in its data room, and a login held to
// named schemes (a joint agent) only those on properties at its schemes. The
// rules the server (server/folders/share.ts, server/client-sharepoint.ts) and
// the screens share.
import { SHARE_DRIVE_NAME } from "./folders";

/**
 * The records whose folders can be shared with a client: a property, a
 * transaction (through its property) and a company (with itself, when it is a
 * client). Never a scheme, a Lease Advisory matter or a Pathway run.
 */
export const SHAREABLE_RECORD_TYPES = ["property", "deal", "company"] as const;
export type ShareableRecordType = (typeof SHAREABLE_RECORD_TYPES)[number];
export function isShareableRecordType(v: unknown): v is ShareableRecordType {
  return typeof v === "string" && (SHAREABLE_RECORD_TYPES as readonly string[]).includes(v);
}

/** A client company, as staff and the screens are sent it. */
export interface SharedWith { id: string; name: string }

/** What the share dialog is sent: who it is shared with now, who it may be shared with, and why nobody when nobody. */
export interface ShareOptions {
  sharedWith: SharedWith | null;
  candidates: SharedWith[];
  why: string | null;
}

/** A folder shared with the caller's company, as a client is sent it: never its drive or item id, its path or its SharePoint address. */
export interface ClientSharedFolder {
  id: string;
  label: string;
  recordType: ShareableRecordType;
  recordName: string;
  propertyId: string | null;
  propertyName: string | null;
}

/** A file or folder inside a shared folder, as a client is sent it: addressed by its name below the shared folder, never by an id. */
export interface ClientSharedItem {
  name: string;
  size: number | null;
  lastModified: string | null;
  isFolder: boolean;
  childCount: number | null;
}

/**
 * Whether a link shared with a company shows to a login of that company. A
 * property's folder when the login can open the property (scheme limits
 * included); a transaction's when it can open the transaction and its
 * property; a company's own folder only to the company itself, and never to
 * a login held to named schemes. Anything else, or any doubt, is no.
 */
export function sharedLinkVisible(
  link: { recordType: string; recordId: string; sharedWith: string | null; removed: boolean; propertyId: string | null },
  viewer: { scope: string | null; limited: boolean },
  facts: { propertyInScope: boolean; dealInScope: boolean },
): boolean {
  if (!viewer.scope || link.removed || !link.sharedWith || link.sharedWith !== viewer.scope) return false;
  if (link.recordType === "property") return !!link.propertyId && link.propertyId === link.recordId && facts.propertyInScope;
  if (link.recordType === "deal") return !!link.propertyId && facts.propertyInScope && facts.dealInScope;
  if (link.recordType === "company") return link.recordId === viewer.scope && !viewer.limited;
  return false;
}

// ── Inside a shared folder ──────────────────────────────────────────────
// A client never names a drive or item id: it asks for the shared folder by
// its link id and a path of names below it ("Leases/2026"). The server reads
// the folder by the ids it stored and only below it.
const NOT_IN_A_NAME = /["*:<>?\\|\u0000-\u001f\u007f]/;
export const SHARED_PATH_MAX_DEPTH = 30;
/** The names below a shared folder, or null when it is not a path the app reads: no "." or "..", no empty part, nothing SharePoint does not take in a name. */
export function sharedPathParts(raw: unknown): string[] | null {
  if (raw === undefined || raw === null || raw === "") return [];
  if (typeof raw !== "string" || raw.length > 2000) return null;
  const parts = raw.split("/");
  if (parts.length > SHARED_PATH_MAX_DEPTH) return null;
  for (const part of parts) {
    if (!part || part === "." || part === ".." || part.length > 400 || part !== part.trim() || NOT_IN_A_NAME.test(part)) return null;
  }
  return parts;
}

/** A file or folder's place in its drive, as Graph gives it, lower case: "/drives/b!x/root:/bgp - share drive/national/bluewater". */
export function driveItemPath(item: { name?: unknown; parentReference?: { path?: unknown } | null } | null | undefined): string | null {
  const parent = item?.parentReference?.path;
  const name = item?.name;
  if (typeof parent !== "string" || !parent || typeof name !== "string" || !name) return null;
  return `${parent}/${name}`.toLowerCase();
}

/** The shared folder itself, read again before a client is shown anything in it: a folder, never a drive's top or the whole of BGP - Share Drive. */
export function sharedRootProblem(item: any, driveId: string): string | null {
  if (!item?.id || !item?.folder) return "not a folder";
  if (item.root) return "the top of a drive";
  if (item?.parentReference?.driveId !== driveId) return "another drive";
  if (String(item.name) === SHARE_DRIVE_NAME && /\/root:$/.test(String(item?.parentReference?.path || ""))) return "the whole of BGP - Share Drive";
  if (!driveItemPath(item)) return "no place in its drive";
  return null;
}

/** An item a client asked for lies inside the shared folder: the same drive, and its place below the folder's. */
export function insideSharedFolder(folder: { driveId: string; path: string }, item: any): boolean {
  const path = driveItemPath(item);
  return !!path && item?.parentReference?.driveId === folder.driveId && path.startsWith(`${folder.path}/`);
}
