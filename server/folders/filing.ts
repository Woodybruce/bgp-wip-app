// Filing the documents the app makes into a record's Folders (Woody, 24
// November 2026: "go ahead with the folder suggestion"; docs/folders-review-
// 2026-11-20.md, 4.4 and decision 2). A Targeting Brief, a Document Brief, a
// Lease Advisory workbook, a Pathway model or a Why Buy deck goes into the
// folder linked to its record: the record's first live link by position, else
// (a transaction, scheme, Lease Advisory matter or Pathway run) its property's
// first, inside the sub-folder its caller names, made where missing. With no
// folder linked it stays in the app and the words say so
// (shared/folders-filing.ts): nothing new is made in the old "BGP share drive"
// tree. Microsoft is called only through graph.ts, with the token the caller
// hands in (the app's own for these documents: server/document-filing.ts).
// Every folder made and every file put is a row of folder_actions.
import { SHOWS_PROPERTY_FOLDERS, needsUploadSession, UPLOAD_PIECE, type DriveEntry, type FolderRecordRef, type FolderRecordType } from "@shared/folders";
import {
  NOT_FILED_NO_RECORD, NOT_FILED_NO_SIGN_IN, NOT_FILED_UNREAD, filingSubfolder, notFiledBecause, notFiledWords, safeFileName,
} from "@shared/folders-filing";
import { GraphError, cancelUploadSession, createFolder, driveEntry, graph, startUploadSession, uploadPiece, uploadSmall } from "./graph";
import { folderRecord, type Db, type FolderRecord } from "./access";
import { logFolderAction, type FolderActor } from "./links";

/** Whose Microsoft account Graph saw when the app filed a document: its own. */
export const APP_ACCOUNT = "app";

/** The folder a record's documents go in: one of its links, or its property's. */
export interface FilingLink { linkId: string; driveId: string; itemId: string; label: string; path: string | null; on: FolderRecordRef }
export type FilingPlace = { record: FolderRecord; link: FilingLink } | { record: FolderRecord | null; link: null; note: string };

async function firstLink(db: Db, type: FolderRecordType, id: string, on: FolderRecordRef): Promise<FilingLink | null> {
  const row = (await db.query(
    `SELECT id, drive_id, item_id, label, cached_path FROM record_folders
      WHERE record_type = $1 AND record_id = $2 AND removed_at IS NULL
      ORDER BY position, linked_at, id LIMIT 1`, [type, id],
  )).rows[0];
  return row ? { linkId: String(row.id), driveId: String(row.drive_id), itemId: String(row.item_id), label: String(row.label), path: row.cached_path || null, on } : null;
}

/** Where a record's documents go: its first link by position; with none, a transaction (or scheme, matter, run) takes its property's first. */
export async function filingPlace(db: Db, ref: { type: FolderRecordType; id: string }): Promise<FilingPlace> {
  const record = await folderRecord(db, ref.type, ref.id);
  if (!record) return { record: null, link: null, note: NOT_FILED_NO_RECORD };
  const own = await firstLink(db, record.type, record.id, { type: record.type, id: record.id, name: record.name });
  if (own) return { record, link: own };
  if (SHOWS_PROPERTY_FOLDERS.includes(record.type) && record.propertyId) {
    const inherited = await firstLink(db, "property", record.propertyId, { type: "property", id: record.propertyId, name: record.propertyName || "" });
    if (inherited) return { record, link: inherited };
  }
  return { record, link: null, note: notFiledWords(record, record.propertyName) };
}

/** A file into a folder, as whoever the token is: up to 10 MB in one go, larger in pieces. A name already there gets a number, never replaced. */
export async function uploadToFolder(token: string, driveId: string, parentId: string, name: string, bytes: Uint8Array): Promise<DriveEntry> {
  if (!needsUploadSession(bytes.length)) return uploadSmall(token, driveId, parentId, name, bytes);
  const { uploadUrl } = await startUploadSession(token, driveId, parentId, name);
  try {
    let next = 0;
    while (next < bytes.length) {
      const piece = await uploadPiece(uploadUrl, bytes.subarray(next, Math.min(bytes.length, next + UPLOAD_PIECE)), next, bytes.length);
      if (piece.done) return piece.done;
      next = piece.next;
    }
    throw new GraphError(502, "SharePoint did not say the file arrived.");
  } catch (e) {
    await cancelUploadSession(uploadUrl);
    throw e;
  }
}

/** A folder inside another, by its name: the one there, else made. One made a moment ago by another filing is used, never a second. */
async function childFolder(token: string, driveId: string, parentId: string, name: string): Promise<{ entry: DriveEntry; made: boolean }> {
  const find = () => graph({ method: "GET", url: `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}?$select=id,name,folder,file,webUrl,parentReference`, token });
  const found = await find();
  if (found.status < 400) {
    const entry = driveEntry(found.body, driveId);
    if (!entry.isFolder) throw new GraphError(409, `A file called "${name}" is where its folder would go.`);
    return { entry, made: false };
  }
  if (found.status !== 404) throw new GraphError(found.status);
  try {
    return { entry: await createFolder(token, driveId, parentId, name), made: true };
  } catch (e) {
    if (!(e instanceof GraphError) || e.status !== 409) throw e;
    const again = await find();
    if (again.status >= 400) throw new GraphError(again.status);
    return { entry: driveEntry(again.body, driveId), made: false };
  }
}

/** The app filed it, perhaps for someone who pressed something; Graph saw the app's own account. */
function appActor(userId: string | null): FolderActor {
  // folder_actions.user_id takes null: a background filing has nobody behind it.
  return { userId: userId as string, account: APP_ACCOUNT };
}

export interface FilingDocument {
  record: { type: FolderRecordType; id: string };
  /** Inside the linked folder, e.g. "Rent Review/Valuation"; made where missing. */
  subfolder?: string;
  name: string;
  bytes: Uint8Array;
  /** The person it was made for, when someone pressed something. */
  userId?: string | null;
  /** What it is, for the log ("Targeting Brief"). */
  what?: string;
}
export type FilingResult =
  | { filed: true; webUrl: string | null; driveId: string; itemId: string; name: string; path: string; folder: FilingLink }
  | { filed: false; note: string };

/**
 * A document into its record's folder, with the token `token` gives. It never
 * throws: a document that cannot be filed stays in the app and the result
 * says why, in words the screens show as they are.
 */
export async function fileRecordDocument(db: Db, token: () => Promise<string | null>, doc: FilingDocument): Promise<FilingResult> {
  let place: FilingPlace;
  try {
    place = await filingPlace(db, doc.record);
  } catch (e: any) {
    console.warn("[folders-filing] folders not read:", e?.message);
    return { filed: false, note: NOT_FILED_UNREAD };
  }
  if (!place.link) return { filed: false, note: place.note };
  const link = place.link;
  const signedIn = await token().catch(() => null);
  if (!signedIn) return { filed: false, note: NOT_FILED_NO_SIGN_IN };
  const actor = appActor(doc.userId ?? null);
  const name = safeFileName(doc.name);
  const parts = filingSubfolder(doc.subfolder);
  const base = { recordType: doc.record.type, recordId: doc.record.id, driveId: link.driveId };
  const detail = {
    filing: doc.what || null, subfolder: parts.join("/") || null, link: link.linkId,
    ...(link.on.type === doc.record.type && link.on.id === doc.record.id ? {} : { folderOn: { type: link.on.type, id: link.on.id } }),
  };
  let parentId = link.itemId;
  try {
    for (const part of parts) {
      const child = await childFolder(signedIn, link.driveId, parentId, part);
      if (child.made) await logFolderAction(db, actor, { ...base, action: "create", itemId: child.entry.itemId, parentAfter: parentId, nameAfter: part, detail });
      parentId = child.entry.itemId;
    }
    const file = await uploadToFolder(signedIn, link.driveId, parentId, name, doc.bytes);
    await logFolderAction(db, actor, { ...base, action: "upload", itemId: file.itemId, parentAfter: parentId, nameAfter: file.name, detail: { ...detail, size: doc.bytes.length } });
    return { filed: true, webUrl: file.webUrl, driveId: file.driveId || link.driveId, itemId: file.itemId, name: file.name, path: file.path, folder: link };
  } catch (e: any) {
    const reason = e instanceof GraphError ? e.message : "SharePoint could not be reached.";
    await logFolderAction(db, actor, { ...base, action: "upload", ok: false, error: e?.message || reason, parentAfter: parentId, nameAfter: name, detail: { ...detail, size: doc.bytes.length } });
    return { filed: false, note: notFiledBecause(reason) };
  }
}
