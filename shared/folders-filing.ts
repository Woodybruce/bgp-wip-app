// Filing the documents the app makes (Woody, 24 November 2026: "go ahead with
// the folder suggestion"; docs/folders-review-2026-11-20.md, 4.4 and decision
// 2). A document goes into the folder linked to its record in Folders: the
// record's first link by position, else (a transaction, scheme, Lease Advisory
// matter or Pathway run) its property's first, inside the sub-folder its
// screen names, made where missing. With no folder linked it stays in the app
// and is not filed in SharePoint: nothing new is made in the old
// "BGP share drive" tree. The rules the server (server/folders/filing.ts) and
// the screens share.
import { SHOWS_PROPERTY_FOLDERS, itemNameProblem, safeFolderName, type FolderRecordType } from "./folders";

// safeFolderName cuts a long name after it strips a trailing dot, so the cut
// can end in one: a second pass leaves a name that passes folderTreePaths.
const folderPart = (raw: string) => safeFolderName(safeFolderName(raw));

/** The sub-folder a document goes in ("Rent Review/Valuation") as the folders to walk: each a name SharePoint takes, at most four deep. */
export function filingSubfolder(raw: unknown): string[] {
  return String(raw ?? "").split("/").map(folderPart).filter(Boolean).slice(0, 4);
}

/** A file name SharePoint takes: no " * : < > ? / \ |, no trailing dot or space; a long one is shortened and keeps its extension. */
export function safeFileName(raw: unknown, fallback = "Document"): string {
  const text = String(raw ?? "").replace(/["*:<>?/\\|]/g, "-").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  const dot = text.lastIndexOf(".");
  const ext = dot > 0 && text.length - dot <= 10 ? text.slice(dot) : "";
  let stem = ext ? text.slice(0, dot) : text;
  if (stem.length + ext.length > 200) stem = stem.slice(0, 200 - ext.length).trim();
  const name = `${stem}${ext}`;
  return stem && !itemNameProblem(name) ? name : `${fallback}${ext}`;
}

/**
 * What the person sees when a document stays in the app. A transaction,
 * scheme, matter or run names its property: a folder linked there serves
 * every one of them, and the property page is where Folders are linked.
 */
export function notFiledWords(record: { type: FolderRecordType; name: string }, propertyName: string | null): string {
  const where = (SHOWS_PROPERTY_FOLDERS.includes(record.type) && propertyName?.trim()) || record.name.trim() || "its record";
  return `Not filed in SharePoint: link a folder to ${where} first.`;
}
/**
 * Every folder linked to the record (and to its property) is shared with a
 * client, or inside one that is: the app keeps BGP's own documents out of them.
 */
export function notFiledSharedWords(record: { type: FolderRecordType; name: string }, propertyName: string | null): string {
  const where = (SHOWS_PROPERTY_FOLDERS.includes(record.type) && propertyName?.trim()) || record.name.trim() || "its record";
  return `Not filed in SharePoint: the folders linked to ${where} are shared with a client. Link a folder only BGP uses first.`;
}

/** A folder shared with a client, as filing reads it: its drive and the path SharePoint last gave. */
export interface SharedPlace { driveId: string; path: string | null }
const pathKey = (p: string | null | undefined) => String(p ?? "").trim().replace(/\s*\/\s*/g, " / ").toLowerCase();

/**
 * Whether the app may not file its own documents in a linked folder: the
 * folder is shared with a client, or lies inside one that is (a client sees
 * everything below a folder shared with it). With no path to compare, a
 * folder on a drive that holds a shared folder is kept out too.
 */
export function filingBlockedByShare(link: { driveId: string; path: string | null; shared: boolean }, shared: SharedPlace[]): boolean {
  if (link.shared) return true;
  const sameDrive = shared.filter(s => s.driveId === link.driveId);
  if (!sameDrive.length) return false;
  const mine = pathKey(link.path);
  if (!mine) return true;
  return sameDrive.some(s => {
    const theirs = pathKey(s.path);
    return !theirs || mine === theirs || mine.startsWith(`${theirs} / `);
  });
}
export const NOT_FILED_NO_RECORD = "Not filed in SharePoint: the record it belongs to was not found.";
export const NOT_FILED_NO_SIGN_IN = "Not filed in SharePoint: the app could not sign in to Microsoft 365.";
export const NOT_FILED_UNREAD = "Not filed in SharePoint: the record's folders could not be read.";
export const NOT_FILED_FROM_EMAIL = "Not filed in SharePoint: a document made from an email has no property or transaction to file it under.";
/** SharePoint refused it: its reason, in the engine's plain words. */
export function notFiledBecause(reason: string): string {
  return `Not filed in SharePoint. ${reason.trim() || "SharePoint did not take it."}`;
}

// ── Legal & DD's project folder ─────────────────────────────────────────
/** The most folders a project is made with (the engine's tree takes 80). */
export const DD_PROJECT_MAX_FOLDERS = 80;
/**
 * The folders a DD analysis suggests (its folder mapping's targets), as the
 * engine's tree takes them: each part a name SharePoint takes, at most four
 * deep, each once whatever its case, at most 80. Those past 80 are listed.
 */
export function ddProjectPaths(mapping: unknown): { paths: string[]; dropped: string[] } {
  const seen = new Set<string>();
  const paths: string[] = [];
  const dropped: string[] = [];
  for (const m of Array.isArray(mapping) ? mapping : []) {
    const parts = String((m as { targetFolder?: unknown } | null)?.targetFolder ?? "").split("/").map(folderPart).filter(Boolean).slice(0, 4);
    if (!parts.length) continue;
    const path = parts.join("/");
    if (seen.has(path.toLowerCase())) continue;
    seen.add(path.toLowerCase());
    if (paths.length >= DD_PROJECT_MAX_FOLDERS) dropped.push(path);
    else paths.push(path);
  }
  return { paths, dropped };
}
