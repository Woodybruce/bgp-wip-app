// The folder engine for code that names folders by path (Woody, 24 November
// 2026: "go ahead with the folder suggestion"; docs/folders-review-2026-11-20.md,
// step 5): ChatBGP's tools, Model Studio's assistant, Pathway and the MLRO
// report. A path is read, found and, where asked, made here, through the one
// door to Microsoft (./graph). A path a person gives starts inside
// "BGP - Share Drive" (decision 2): the old "BGP share drive" tree is never
// named. A missing folder is made only inside one that is there, a name
// already there is used and never replaced, and every folder made and file
// put is a row of folder_actions.
import type { Request } from "express";
import { SHARE_DRIVE_NAME, itemNameProblem, uploadProblem, type DriveEntry } from "@shared/folders";
import { GraphError, bgpLibrary, createFolder, entryByPath, getEntry, uploadFile, type LibraryRef } from "./graph";
import { folderRefusal, logFolderAction, type FolderActor } from "./links";
import type { Db } from "./access";

export const OLD_TREE_REFUSAL = `The old "BGP share drive" folder is retired: give the path inside ${SHARE_DRIVE_NAME}, for example Investment/Deal Files.`;
const OLD_TREE_MAKE = 'Nothing new is made in the old "BGP share drive" folder, which is retired';

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const isShareDrive = (s: string) => norm(s) === norm(SHARE_DRIVE_NAME);
const isOldTree = (s: string) => norm(s) === "bgp share drive";
const isLibraryName = (s: string) => /^(shared )?documents$/.test(norm(s));

function splitPath(raw: unknown): string[] {
  // A path Graph wrote ("/drives/<id>/root:/BGP - Share Drive/…") starts after "root:".
  const text = String(raw ?? "").replace(/^.*?\broot:/, "");
  return text.replace(/\\/g, "/").split("/").map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function checked(parts: string[]): { parts: string[] } | { problem: string } {
  if (parts.length > 20) return { problem: "That path is too deep." };
  for (const p of parts) {
    if (p === "." || p === "..") return { problem: "A path can't step up a folder." };
    const bad = itemNameProblem(p);
    if (bad) return { problem: `"${p}": ${bad}` };
  }
  return { parts };
}

/**
 * A path inside BGP - Share Drive, as folder names: "Investment/Deal Files"
 * gives ["Investment", "Deal Files"], and "" or "/" is BGP - Share Drive
 * itself. Starting with "BGP - Share Drive" (or the library's own name) is the
 * same; the old "BGP share drive" is refused.
 */
export function shareDrivePath(raw: unknown): { parts: string[] } | { problem: string } {
  const parts = splitPath(raw);
  if (parts.length && isLibraryName(parts[0])) parts.shift();
  if (parts.length && isShareDrive(parts[0])) parts.shift();
  else if (parts.length && isOldTree(parts[0])) return { problem: OLD_TREE_REFUSAL };
  return checked(parts);
}

/** A path from the top of the BGP library, as a record stores it ("BGP - Share Drive / Investment / 1 High St"). */
export function libraryPath(raw: unknown): { parts: string[] } | { problem: string } {
  const parts = splitPath(raw);
  if (parts.length && isLibraryName(parts[0])) parts.shift();
  return checked(parts);
}

/** "BGP - Share Drive / Investment / Deal Files", for showing. */
export function shareDriveLabel(parts: string[]): string {
  return [SHARE_DRIVE_NAME, ...parts].join(" / ");
}

/** Where a folder made or a file put is logged, as whom. */
export interface FolderLog { db: Db; actor: FolderActor; detail?: Record<string, unknown> }

async function makeFolder(token: string, driveId: string, parentId: string, name: string, path: string, log: FolderLog): Promise<DriveEntry> {
  try {
    const made = await createFolder(token, driveId, parentId, name);
    await logFolderAction(log.db, log.actor, { action: "create", driveId, itemId: made.itemId, parentAfter: parentId, nameAfter: name, detail: log.detail });
    return made;
  } catch (e: any) {
    // Made by someone else since it was looked for: use it.
    if (e instanceof GraphError && e.status === 409) {
      const there = await entryByPath(token, driveId, path);
      if (there?.isFolder) return there;
    }
    await logFolderAction(log.db, log.actor, { action: "create", driveId, parentAfter: parentId, nameAfter: name, ok: false, error: e?.message || "not made", detail: log.detail });
    throw e;
  }
}

/**
 * The folder at a path from the top of the library. With `make`, each
 * missing folder after the first `keep` is made inside the one above it; the
 * first `keep` must already be there (for a person's path, BGP - Share Drive
 * and the top-level folder in it; for a record's folder, the whole of it).
 * Nothing is made in the old "BGP share drive" tree except below a record's
 * own folder. Without `make` the whole path must be there.
 */
export async function folderAtPath(token: string, lib: LibraryRef, parts: string[], opts: { make?: FolderLog; keep?: number } = {}): Promise<DriveEntry> {
  const label = (n: number) => parts.slice(0, n).join(" / ") || lib.name;
  if (!parts.length) return getEntry(token, lib.driveId, lib.itemId);
  const whole = await entryByPath(token, lib.driveId, parts.join("/"));
  if (whole) {
    if (!whole.isFolder) throw folderRefusal(400, `"${label(parts.length)}" is a file, not a folder.`);
    return whole;
  }
  if (!opts.make) throw folderRefusal(404, `There is no folder at "${label(parts.length)}".`);
  let parentId = lib.itemId;
  let entry: DriveEntry | null = null;
  let making = false;
  for (let i = 0; i < parts.length; i++) {
    const path = parts.slice(0, i + 1).join("/");
    const here = making ? null : await entryByPath(token, lib.driveId, path);
    if (here) {
      if (!here.isFolder) throw folderRefusal(400, `"${label(i + 1)}" is a file, not a folder.`);
      entry = here;
    } else {
      if (i < (opts.keep ?? 0)) throw folderRefusal(404, `There is no folder called "${parts[i]}" in "${label(i)}": check the path. Nothing was made.`);
      if (isOldTree(parts[0]) && !opts.keep) throw folderRefusal(400, `${OLD_TREE_MAKE}: "${label(i + 1)}" isn't there.`);
      making = true;
      entry = await makeFolder(token, lib.driveId, parentId, parts[i], path, opts.make);
    }
    parentId = entry.itemId;
  }
  return entry!;
}

/** A file into a folder: its name checked, a name already there given a number, the upload logged. */
export async function saveFileInto(token: string, folder: DriveEntry, name: string, bytes: Uint8Array, log: FolderLog): Promise<DriveEntry> {
  const problem = uploadProblem(name, bytes.length);
  if (problem) throw folderRefusal(400, problem);
  const detail = { size: bytes.length, ...log.detail };
  try {
    const made = await uploadFile(token, folder.driveId, folder.itemId, name, bytes);
    await logFolderAction(log.db, log.actor, { action: "upload", driveId: folder.driveId, itemId: made.itemId, parentAfter: folder.itemId, nameAfter: made.name, detail });
    return made;
  } catch (e: any) {
    await logFolderAction(log.db, log.actor, { action: "upload", driveId: folder.driveId, parentAfter: folder.itemId, nameAfter: name, ok: false, error: e?.message || "failed", detail });
    throw e;
  }
}

/**
 * A file into a record's stored folder (a path from the top of the library,
 * as a Pathway run keeps it), in the subfolders given below it, made where
 * missing; as the person the request is from, on their own Microsoft 365,
 * logged. The record's folder itself must be there.
 */
export async function saveFileAtLibraryPath(
  req: Request, folderPath: string, below: string[], name: string, bytes: Uint8Array, detail: Record<string, unknown>,
): Promise<DriveEntry> {
  const own = await ownMicrosoft(req);
  if (!own) throw folderRefusal(428, "The person this runs for has not connected their own Microsoft 365.");
  const p = libraryPath(folderPath);
  if ("problem" in p) throw folderRefusal(400, p.problem);
  const { pool } = await import("../db");
  const log: FolderLog = { db: pool, actor: { userId: own.userId, account: own.account }, detail };
  const lib = await bgpLibrary(own.token);
  const folder = await folderAtPath(own.token, lib, [...p.parts, ...below], { make: log, keep: p.parts.length });
  return saveFileInto(own.token, folder, name, bytes, log);
}

/** The folder an entry sits in, as shown: "BGP - Share Drive / Investment" for "… / Investment / report.xlsx". */
export function entryFolderPath(e: DriveEntry): string {
  return e.path.split(" / ").slice(0, -1).join(" / ");
}

/** The person a request is from, with their own Microsoft 365, never a colleague's (decision 7). Null when they have not connected it. */
export async function ownMicrosoft(req: Request | null | undefined): Promise<{ userId: string; token: string; account: string } | null> {
  const userId = String((req as any)?.session?.userId || (req as any)?.tokenUserId || "");
  if (!userId) return null;
  const { getOwnMsAccess } = await import("../microsoft");
  const own = await getOwnMsAccess(userId).catch(() => null);
  return own ? { userId, token: own.token, account: own.account } : null;
}

/** A refusal or a Graph answer in plain words; anything else is said as a fault. */
export function folderErrorWords(e: any): string {
  if (e instanceof GraphError) return e.message;
  if (e?.status && e.status >= 400 && e.status < 500 && e.message) return e.message;
  return "SharePoint could not be reached just now.";
}
