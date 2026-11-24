// A record's folders (Woody, 24 November 2026; docs/folders-review-2026-11-20.md,
// 4.2 and 4.3): its own links (record_folders), its property's under "From
// <property>" for a transaction, and the addresses the old columns still hold,
// read only, until the migration moves them over. Linking, labelling,
// colouring, reordering and unlinking never touch SharePoint; each is a row of
// folder_actions. The shown name, path and address are refreshed on read.
import { runChunked } from "../sharepoint-graph";
import { normaliseFolderLinks } from "@shared/property-labels";
import {
  LEGACY_FOLDER_COLUMNS, SHARE_DRIVE_NAME, SHOWS_PROPERTY_FOLDERS, bgpSharePointUrl, folderColourKey, folderLabel, folderStatusFromGraph,
  folderUrlKey, isGraphId, legacyFolderKey, linkTopProblem, moveLinkTo,
  type DriveEntry, type FolderAction, type FolderLinkSource, type FolderLinkView, type FolderRecordRef, type RecordFoldersView,
} from "@shared/folders";
import { GraphError, bgpLibrary, getEntry, itemForChange, openLink, openLinkItem } from "./graph";
import { recordNames, type Db, type FolderRecord } from "./access";
import { LEGACY_RECORD_FOLDER } from "@shared/folders";

/** Who acted, and whose Microsoft account Graph saw (null when no Graph call was made). */
export interface FolderActor { userId: string; account: string | null }

/** A request the engine refuses, with its status. */
export function folderRefusal(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

export interface FolderActionEntry {
  action: FolderAction;
  recordType?: string | null; recordId?: string | null;
  driveId?: string | null; itemId?: string | null;
  nameBefore?: string | null; nameAfter?: string | null;
  parentBefore?: string | null; parentAfter?: string | null;
  ok?: boolean; error?: string | null; detail?: unknown;
}
/** One row of folder_actions. A failure to write it is said in the log and never undoes what was done. */
export async function logFolderAction(db: Db, actor: FolderActor, a: FolderActionEntry): Promise<void> {
  await db.query(
    `INSERT INTO folder_actions (user_id, ms_account, action, record_type, record_id, drive_id, item_id, name_before, name_after, parent_before, parent_after, ok, error, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
    [actor.userId, actor.account, a.action, a.recordType ?? null, a.recordId ?? null, a.driveId ?? null, a.itemId ?? null,
      a.nameBefore ?? null, a.nameAfter ?? null, a.parentBefore ?? null, a.parentAfter ?? null, a.ok !== false, a.error ?? null,
      a.detail === undefined ? null : JSON.stringify(a.detail)],
  ).catch((e: any) => console.warn("[folders] action not logged:", e?.message));
}

interface LinkRow {
  id: string; record_type: string; record_id: string; drive_id: string; item_id: string;
  label: string; colour: string | null; position: number; drive_kind: string | null; web_url: string | null;
  cached_name: string | null; cached_path: string | null; status: string; source: string;
  linked_by: string | null; linked_by_name: string | null; linked_at: Date | string | null; checked_at: Date | string | null;
}
const LINK_SELECT = `SELECT rf.id, rf.record_type, rf.record_id, rf.drive_id, rf.item_id, rf.label, rf.colour, rf.position,
    rf.drive_kind, rf.web_url, rf.cached_name, rf.cached_path, rf.status, rf.source, rf.linked_by, u.name AS linked_by_name,
    rf.linked_at, rf.checked_at
  FROM record_folders rf LEFT JOIN users u ON u.id = rf.linked_by`;

async function liveLinks(db: Db, type: string, id: string): Promise<LinkRow[]> {
  return (await db.query(`${LINK_SELECT} WHERE rf.record_type = $1 AND rf.record_id = $2 AND rf.removed_at IS NULL ORDER BY rf.position, rf.linked_at, rf.id`, [type, id])).rows;
}
async function oneLink(db: Db, linkId: string): Promise<LinkRow | null> {
  return (await db.query(`${LINK_SELECT} WHERE rf.id = $1 AND rf.removed_at IS NULL`, [linkId])).rows[0] || null;
}

const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
const linkKey = (driveId: string | null, itemId: string | null) => `${driveId}|${itemId}`;

function linkView(row: LinkRow, alsoLinked: FolderRecordRef[]): FolderLinkView {
  return {
    id: String(row.id),
    label: row.label,
    colour: folderColourKey(row.colour),
    driveId: row.drive_id,
    itemId: row.item_id,
    driveKind: row.drive_kind === "onedrive" ? "onedrive" : row.drive_kind === "library" ? "library" : null,
    name: row.cached_name,
    path: row.cached_path,
    webUrl: row.web_url,
    status: row.status === "missing" || row.status === "no_access" ? row.status : "ok",
    source: row.source,
    legacy: false,
    linkedBy: row.linked_by_name || null,
    linkedAt: iso(row.linked_at),
    alsoLinked,
  };
}

// ── Refreshed on read ───────────────────────────────────────────────────
const CHECK_EVERY_MS = 10 * 60_000;
async function refreshed(db: Db, row: LinkRow, token: string): Promise<LinkRow> {
  if (row.checked_at && Date.now() - new Date(row.checked_at).getTime() < CHECK_EVERY_MS) return row;
  try {
    const e = await getEntry(token, row.drive_id, row.item_id);
    await db.query(`UPDATE record_folders SET cached_name = $2, cached_path = $3, web_url = $4, drive_kind = $5, status = 'ok', checked_at = now() WHERE id = $1`,
      [row.id, e.name, e.path, e.webUrl, e.driveKind]);
    return { ...row, cached_name: e.name, cached_path: e.path, web_url: e.webUrl, drive_kind: e.driveKind, status: "ok", checked_at: new Date() };
  } catch (err) {
    // A passing failure (SharePoint busy, a network fault) changes nothing.
    if (!(err instanceof GraphError) || ![401, 403, 404, 410].includes(err.status)) return row;
    const status = folderStatusFromGraph(err.status);
    await db.query(`UPDATE record_folders SET status = $2, checked_at = now() WHERE id = $1`, [row.id, status]);
    return { ...row, status, checked_at: new Date() };
  }
}

/** Other records each folder is linked to ("Also linked to …"). */
async function alsoLinkedFor(db: Db, rows: LinkRow[]): Promise<(row: LinkRow) => FolderRecordRef[]> {
  if (!rows.length) return () => [];
  const others = (await db.query(
    `SELECT DISTINCT rf.record_type, rf.record_id, rf.drive_id, rf.item_id
       FROM record_folders rf
       JOIN unnest($1::text[], $2::text[]) AS k(drive_id, item_id) ON k.drive_id = rf.drive_id AND k.item_id = rf.item_id
      WHERE rf.removed_at IS NULL`,
    [rows.map(r => r.drive_id), rows.map(r => r.item_id)],
  )).rows as { record_type: string; record_id: string; drive_id: string; item_id: string }[];
  const names = await recordNames(db, others.map(o => ({ type: o.record_type, id: o.record_id })));
  return (row) => others
    .filter(o => o.drive_id === row.drive_id && o.item_id === row.item_id && !(o.record_type === row.record_type && o.record_id === row.record_id))
    .filter(o => names.has(`${o.record_type}:${o.record_id}`))
    .map(o => ({ type: o.record_type as FolderRecordRef["type"], id: o.record_id, name: names.get(`${o.record_type}:${o.record_id}`)! }));
}

// ── The old columns, read only ──────────────────────────────────────────
/** Where the migration keeps its runs (server/folders/migration.ts). */
export const MIGRATION_RUNS_KEY = "folders_migration:runs";
interface MigrationRunRow { column: string; recordId: string; key: string; value: string }
/** Every stored address a migration run moved over and nobody has undone. */
export async function migratedLegacyKeys(db: Db): Promise<Set<string>> {
  const runs = (await db.query(`SELECT value FROM system_settings WHERE key = $1`, [MIGRATION_RUNS_KEY]).catch(() => ({ rows: [] as any[] }))).rows[0]?.value;
  const out = new Set<string>();
  for (const run of Array.isArray(runs) ? runs : []) {
    if (run?.kind !== "apply" || run?.undoneAt) continue;
    for (const r of (Array.isArray(run.rows) ? run.rows : []) as MigrationRunRow[]) out.add(legacyFolderKey(r.column, r.recordId, r.key, r.value));
  }
  return out;
}

export interface LegacyFolder { column: string; key: string; label: string; url: string }
/** The addresses a record's old columns hold that no migration has moved. */
export async function legacyFolders(db: Db, record: FolderRecordRef, migrated?: Set<string>): Promise<LegacyFolder[]> {
  const out: LegacyFolder[] = [];
  if (record.type === "property") {
    const row = (await db.query(`SELECT sharepoint_folder_url, sharepoint_team_folders FROM crm_properties WHERE id = $1`, [record.id])).rows[0];
    const def = String(row?.sharepoint_folder_url || "").trim();
    if (def) out.push({ column: LEGACY_FOLDER_COLUMNS.propertyDefault, key: "", label: "Linked folder", url: def });
    for (const [label, url] of Object.entries(normaliseFolderLinks(row?.sharepoint_team_folders))) {
      out.push({ column: LEGACY_FOLDER_COLUMNS.propertyTeams, key: label, label, url });
    }
  } else if (record.type === "deal") {
    const link = String((await db.query(`SELECT sharepoint_link FROM crm_deals WHERE id = $1`, [record.id])).rows[0]?.sharepoint_link || "").trim();
    if (/^https:\/\//i.test(link)) out.push({ column: LEGACY_FOLDER_COLUMNS.dealLink, key: "", label: "Transaction link", url: link });
  } else if (LEGACY_RECORD_FOLDER[record.type]) {
    // A company's, scheme's, Lease Advisory matter's or Pathway run's one stored address.
    const { column, label } = LEGACY_RECORD_FOLDER[record.type]!;
    const [table, field] = column.split(".");
    const url = String((await db.query(`SELECT ${field} AS url FROM ${table} WHERE id = $1`, [record.id]).catch(() => ({ rows: [] as any[] }))).rows[0]?.url || "").trim();
    if (/^https:\/\//i.test(url)) out.push({ column, key: "", label, url });
  }
  if (!out.length) return out;
  const moved = migrated || await migratedLegacyKeys(db);
  const seen = new Set<string>();
  return out.filter(l => {
    const key = folderUrlKey(l.url);
    if (seen.has(key) || moved.has(legacyFolderKey(l.column, record.id, l.key, l.url))) return false;
    seen.add(key);
    return true;
  });
}

// What an old address opens, for the person reading (their access, their token); kept ten minutes.
type LegacyOpen = { entry: DriveEntry | null; status: FolderLinkView["status"] };
const legacyOpened = new Map<string, { at: number; value: LegacyOpen }>();
async function openLegacy(userId: string, token: string | null, url: string): Promise<LegacyOpen> {
  if (!token || !bgpSharePointUrl(url)) return { entry: null, status: "unknown" };
  const cacheKey = `${userId}|${url}`;
  const hit = legacyOpened.get(cacheKey);
  if (hit && Date.now() - hit.at < CHECK_EVERY_MS) return hit.value;
  let value: LegacyOpen;
  try {
    value = { entry: await openLink(token, url), status: "ok" };
  } catch (err) {
    value = { entry: null, status: err instanceof GraphError && [401, 403, 404, 410].includes(err.status) ? folderStatusFromGraph(err.status) : "unknown" };
  }
  if (legacyOpened.size > 2000) legacyOpened.clear();
  legacyOpened.set(cacheKey, { at: Date.now(), value });
  return value;
}

function legacyView(l: LegacyFolder, opened: LegacyOpen): FolderLinkView {
  const folder = opened.entry?.isFolder ? opened.entry : null;
  return {
    id: `legacy:${l.column}:${l.key}`,
    label: l.label,
    colour: null,
    driveId: folder?.driveId || null,
    itemId: folder?.itemId || null,
    driveKind: folder?.driveKind || null,
    name: opened.entry?.name || null,
    path: opened.entry?.path || null,
    webUrl: opened.entry?.webUrl || l.url,
    status: opened.status,
    source: `legacy:${l.column}`,
    legacy: true,
    linkedBy: null,
    linkedAt: null,
    alsoLinked: [],
  };
}

// ── Reading a record's folders ──────────────────────────────────────────
/** A record's folders: its own, then (a transaction and the like) its property's. */
export async function readRecordFolders(db: Db, record: FolderRecord, viewer: { userId: string; token: string | null }): Promise<RecordFoldersView> {
  const own: FolderRecordRef = { type: record.type, id: record.id, name: record.name };
  const groups: { ref: FolderRecordRef; rows: LinkRow[]; legacy: LegacyFolder[] }[] = [];
  const migrated = await migratedLegacyKeys(db);
  groups.push({ ref: own, rows: await liveLinks(db, own.type, own.id), legacy: await legacyFolders(db, own, migrated) });
  if (SHOWS_PROPERTY_FOLDERS.includes(record.type) && record.propertyId) {
    const property: FolderRecordRef = { type: "property", id: record.propertyId, name: record.propertyName || "" };
    groups.push({ ref: property, rows: await liveLinks(db, "property", property.id), legacy: await legacyFolders(db, property, migrated) });
  }
  if (viewer.token) {
    for (const g of groups) g.rows = await runChunked(g.rows, 4, row => refreshed(db, row, viewer.token!));
  }
  const also = await alsoLinkedFor(db, groups.flatMap(g => g.rows));
  const shown = new Set<string>();
  const views = [];
  for (const g of groups) {
    const folders: FolderLinkView[] = [];
    for (const row of g.rows) {
      const key = linkKey(row.drive_id, row.item_id);
      if (shown.has(key)) continue; // linked to the transaction and its property: shown once, as the transaction's
      shown.add(key);
      folders.push(linkView(row, also(row)));
    }
    for (const l of g.legacy) {
      const opened = await openLegacy(viewer.userId, viewer.token, l.url);
      const key = opened.entry?.isFolder ? linkKey(opened.entry.driveId, opened.entry.itemId) : `url|${folderUrlKey(l.url)}`;
      if (shown.has(key)) continue; // an old address already linked shows as the link
      shown.add(key);
      folders.push(legacyView(l, opened));
    }
    views.push({ from: g.ref, folders });
  }
  const [mine, ...inherited] = views;
  return {
    record: own,
    connected: !!viewer.token,
    folders: mine.folders,
    inherited: inherited.filter(v => v.folders.length > 0),
  };
}

// ── Linking ─────────────────────────────────────────────────────────────
/** Link a folder to a record, by its ids or a pasted address. The folder must be one the person can open. */
export async function addFolderLink(
  db: Db, record: FolderRecordRef, actor: FolderActor & { token: string },
  input: { driveId?: unknown; itemId?: unknown; url?: unknown; label?: unknown; colour?: unknown }, made?: DriveEntry,
): Promise<FolderLinkView> {
  let entry: DriveEntry;
  let source: FolderLinkSource;
  let place: { parentId: string | null; isRoot: boolean } | null = null;
  if (made) {
    entry = made;
    source = "created";
  } else if (typeof input.url === "string" && input.url.trim()) {
    const url = input.url.trim();
    if (!bgpSharePointUrl(url)) throw folderRefusal(400, "Paste a link to a folder in BGP's SharePoint or OneDrive.");
    const it = await openLinkItem(actor.token, url);
    entry = it.entry; place = it;
    source = "pasted";
  } else {
    if (!isGraphId(input.driveId) || !isGraphId(input.itemId)) throw folderRefusal(400, "Pick a folder.");
    const it = await itemForChange(actor.token, input.driveId, input.itemId);
    entry = it.entry; place = it;
    source = "picked";
  }
  if (!entry.isFolder) throw folderRefusal(400, "That is a file, not a folder. Link the folder it is in.");
  if (place) {
    // A library's or a OneDrive's top, or the whole of BGP - Share Drive, is never a record's folder.
    const library = entry.name === SHARE_DRIVE_NAME ? await bgpLibrary(actor.token).catch(() => null) : null;
    const top = linkTopProblem({ name: entry.name, driveId: entry.driveId, driveKind: entry.driveKind, isRoot: place.isRoot, parentId: place.parentId }, library);
    if (top) throw folderRefusal(400, top);
  }
  const label = folderLabel(input.label) || folderLabel(entry.name) || "Folder";
  const colour = input.colour === undefined || input.colour === null || input.colour === "" ? null : folderColourKey(input.colour);
  if (input.colour && !colour) throw folderRefusal(400, "Pick one of the six colours.");
  const inserted = (await db.query(
    `INSERT INTO record_folders (record_type, record_id, drive_id, item_id, label, colour, position, drive_kind, web_url, cached_name, cached_path, status, source, linked_by, checked_at)
     SELECT $1::text, $2::text, $3::text, $4::text, $5::text, $6::text,
            COALESCE((SELECT MAX(position) + 1 FROM record_folders WHERE record_type = $1::text AND record_id = $2::text AND removed_at IS NULL), 0),
            $7::text, $8::text, $9::text, $10::text, 'ok', $11::text, $12::text, now()
     ON CONFLICT (record_type, record_id, drive_id, item_id) WHERE removed_at IS NULL DO NOTHING
     RETURNING id`,
    [record.type, record.id, entry.driveId, entry.itemId, label, colour, entry.driveKind, entry.webUrl, entry.name, entry.path, source, actor.userId],
  )).rows[0];
  if (!inserted) throw folderRefusal(409, `${entry.name} is already linked here.`);
  await logFolderAction(db, actor, {
    action: "link", recordType: record.type, recordId: record.id, driveId: entry.driveId, itemId: entry.itemId,
    nameAfter: label, detail: { source, path: entry.path },
  });
  const row = await oneLink(db, String(inserted.id));
  return linkView(row!, (await alsoLinkedFor(db, [row!]))(row!));
}

/** A link's label, colour or place in the record's list. Nothing in SharePoint changes. */
export async function changeFolderLink(db: Db, actor: FolderActor, linkId: string, patch: Record<string, unknown>): Promise<FolderLinkView> {
  const row = await oneLink(db, linkId);
  if (!row) throw folderRefusal(404, "That link has gone.");
  const changes: Record<string, unknown> = {};
  if ("label" in patch) {
    const label = folderLabel(patch.label);
    if (!label) throw folderRefusal(400, "A label of 1 to 80 characters.");
    changes.label = label;
  }
  if ("colour" in patch) {
    const colour = patch.colour === null || patch.colour === "" ? null : folderColourKey(patch.colour);
    if (patch.colour && !colour) throw folderRefusal(400, "Pick one of the six colours.");
    changes.colour = colour;
  }
  let position: number | null = null;
  if ("position" in patch) {
    position = Number(patch.position);
    if (!Number.isInteger(position) || position < 0) throw folderRefusal(400, "Which place in the list?");
  }
  if (!Object.keys(changes).length && position === null) throw folderRefusal(400, "Nothing to change.");
  if ("label" in changes || "colour" in changes) {
    await db.query(`UPDATE record_folders SET label = COALESCE($2::text, label), colour = CASE WHEN $3::boolean THEN $4::text ELSE colour END WHERE id = $1`,
      [linkId, changes.label ?? null, "colour" in changes, changes.colour ?? null]);
  }
  if (position !== null) {
    const ids = (await db.query(`SELECT id FROM record_folders WHERE record_type = $1 AND record_id = $2 AND removed_at IS NULL ORDER BY position, linked_at, id`,
      [row.record_type, row.record_id])).rows.map((r: any) => String(r.id));
    const order = moveLinkTo(ids, linkId, position);
    await db.query(`UPDATE record_folders AS rf SET position = o.pos - 1 FROM unnest($1::text[]) WITH ORDINALITY AS o(id, pos) WHERE rf.id = o.id`, [order]);
    changes.position = order.indexOf(linkId);
  }
  await logFolderAction(db, actor, {
    action: "change", recordType: row.record_type, recordId: row.record_id, driveId: row.drive_id, itemId: row.item_id,
    nameBefore: row.label, nameAfter: (changes.label as string | undefined) ?? row.label, detail: changes,
  });
  const next = await oneLink(db, linkId);
  return linkView(next!, (await alsoLinkedFor(db, [next!]))(next!));
}

/** Unlink: the row is kept for the record, and the folder in SharePoint is untouched. */
export async function unlinkFolder(db: Db, actor: FolderActor, linkId: string): Promise<{ unlinked: true }> {
  const row = (await db.query(
    `UPDATE record_folders SET removed_at = now(), removed_by = $2 WHERE id = $1 AND removed_at IS NULL
     RETURNING record_type, record_id, drive_id, item_id, label`,
    [linkId, actor.userId],
  )).rows[0];
  if (!row) throw folderRefusal(404, "That link has gone.");
  await logFolderAction(db, actor, { action: "unlink", recordType: row.record_type, recordId: row.record_id, driveId: row.drive_id, itemId: row.item_id, nameBefore: row.label });
  return { unlinked: true };
}
