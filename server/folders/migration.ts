// Moving the old folder links over (Woody, 24 November 2026: "go ahead with
// the folder suggestion"; docs/folders-review-2026-11-20.md, 4.7). Admins
// only, each on their own Microsoft 365, never at boot or on a timer: the
// house pattern of Preview, Apply and Undo.
//
//   GET  /api/admin/folders/migration          the report: a row for each stored address, each old
//                                              team-folder path and each company's folder in
//                                              "BGP share drive/Companies", what it opens now; suggestions by name
//   POST /api/admin/folders/migration/apply    { ids, previewedAt }: the rows the same admin ticked on that preview, within the hour
//   POST /api/admin/folders/migration/undo     { batch }: a batch's links taken back out
//   GET  /api/admin/folders/migration/runs     the runs, newest first
//
// Applying makes record_folders rows (source migrated:<column>); the old
// columns are not touched and are still read where the app read them
// (OLD_FOLDER_READERS) until Woody agrees to stop reading them. Folders hides
// an old address a run has moved (migratedLegacyKeys), and shows it again
// when the run is undone.
import { Router, type Request, type RequestHandler, type Response } from "express";
import { normaliseFolderLinks, sameName } from "@shared/property-labels";
import {
  MIGRATION_COLUMNS, OLD_FOLDER_READERS, SHARE_DRIVE_NAME, bgpSharePointUrl, folderLabel, migrationApplyRefusal, migrationRowId,
  migrationStatus, teamFolderPath, type DriveEntry, type FolderRecordType, type MigrationColumn, type MigrationStatus,
} from "@shared/folders";
import { COMPANIES_FOLDER_PATH, companyFolderKey } from "@shared/folders";
import { GraphError, bgpLibrary, entryByPath, listChildren, openLink, searchFolders } from "./graph";
import { folderRecord, type Db, type FolderStaff } from "./access";
import { MIGRATION_RUNS_KEY, folderRefusal, logFolderAction } from "./links";

export const MIGRATION_PREVIEW_KEY = "folders_migration:preview";
const RUNS_KEPT = 50;
const SUGGESTION_RECORDS = 150;

export interface MigrationSource {
  column: MigrationColumn; recordType: FolderRecordType; recordId: string; recordName: string;
  /** A team or extra folder's label, else "". */
  key: string;
  /** The chip label it gets; "" takes the folder's own name. */
  label: string;
  /** The stored address, or the path the old team folders used. */
  value: string;
  kind: "address" | "path";
}
export interface MigrationRow extends MigrationSource { id: string; status: MigrationStatus; error: string | null; entry: DriveEntry | null }
export interface MigrationSuggestion { recordType: FolderRecordType; recordId: string; recordName: string; entry: DriveEntry }
export interface MigrationPreview {
  previewedAt: string; previewedBy: string; previewedByName: string;
  /** The Microsoft account the addresses were opened as: the links Apply makes are logged with it. */
  previewedAccount: string | null;
  rows: MigrationRow[]; suggestions: MigrationSuggestion[];
  counts: Partial<Record<MigrationStatus, number>>;
  /** Columns that could not be read (a table that is not there), said, never hidden. */
  unread: string[];
  readers: typeof OLD_FOLDER_READERS;
}
export interface MigrationRun {
  kind: "apply"; batch: string; at: string; by: string; byName: string;
  rows: { column: string; recordType: string; recordId: string; key: string; value: string; linkId: string }[];
  undoneAt?: string | null; undoneBy?: string | null;
}

const text = (v: unknown) => String(v ?? "").trim();
const teams = (v: unknown): string[] => (Array.isArray(v) ? v : []).map(text).filter(Boolean);

/** Every stored address and old team-folder path, with its record. */
export async function readMigrationSources(db: Db): Promise<{ sources: MigrationSource[]; unread: string[] }> {
  const sources: MigrationSource[] = [];
  const unread: string[] = [];
  const read = async (column: string, sql: string) => (await db.query(sql).catch((e: any) => { unread.push(`${column}: ${e?.message || "not read"}`); return { rows: [] as any[] }; })).rows;
  const add = (s: Omit<MigrationSource, "value"> & { value: unknown }) => {
    const value = text(s.value);
    if (value) sources.push({ ...s, value });
  };

  for (const p of await read("crm_properties", `SELECT id, name, sharepoint_folder_url, sharepoint_team_folders, folder_teams FROM crm_properties
      WHERE COALESCE(sharepoint_folder_url, '') <> '' OR sharepoint_team_folders IS NOT NULL OR COALESCE(array_length(folder_teams, 1), 0) > 0`)) {
    const base = { recordType: "property" as const, recordId: String(p.id), recordName: text(p.name) };
    add({ ...base, column: "crm_properties.sharepoint_folder_url", key: "", label: "", value: p.sharepoint_folder_url, kind: "address" });
    for (const [label, url] of Object.entries(normaliseFolderLinks(p.sharepoint_team_folders))) add({ ...base, column: "crm_properties.sharepoint_team_folders", key: label, label, value: url, kind: "address" });
    for (const team of teams(p.folder_teams)) add({ ...base, column: "crm_properties.folder_teams", key: team, label: team, value: teamFolderPath(team, base.recordName), kind: "path" });
  }
  for (const c of await read("crm_companies", `SELECT id, name, sharepoint_folder_url, folder_teams FROM crm_companies
      WHERE COALESCE(sharepoint_folder_url, '') <> '' OR COALESCE(array_length(folder_teams, 1), 0) > 0`)) {
    const base = { recordType: "company" as const, recordId: String(c.id), recordName: text(c.name) };
    add({ ...base, column: "crm_companies.sharepoint_folder_url", key: "", label: "", value: c.sharepoint_folder_url, kind: "address" });
    for (const team of teams(c.folder_teams)) add({ ...base, column: "crm_companies.folder_teams", key: team, label: team, value: teamFolderPath(team, base.recordName), kind: "path" });
  }
  for (const d of await read("crm_deals", `SELECT id, name, sharepoint_link FROM crm_deals WHERE sharepoint_link ~* '^https://'`)) {
    add({ recordType: "deal", recordId: String(d.id), recordName: text(d.name), column: "crm_deals.sharepoint_link", key: "", label: "", value: d.sharepoint_link, kind: "address" });
  }
  for (const s of await read("property_schemes", `SELECT id, name, sharepoint_folder_url FROM property_schemes WHERE COALESCE(sharepoint_folder_url, '') <> ''`)) {
    add({ recordType: "scheme", recordId: String(s.id), recordName: text(s.name), column: "property_schemes.sharepoint_folder_url", key: "", label: "", value: s.sharepoint_folder_url, kind: "address" });
  }
  for (const m of await read("pla_matters", `SELECT m.id, initcap(replace(m.matter_type, '_', ' ')) || COALESCE(' · ' || p.name, '') AS name, m.sharepoint_folder_url
      FROM pla_matters m LEFT JOIN crm_properties p ON p.id = m.property_id WHERE COALESCE(m.sharepoint_folder_url, '') <> ''`)) {
    add({ recordType: "pla_matter", recordId: String(m.id), recordName: text(m.name), column: "pla_matters.sharepoint_folder_url", key: "", label: "", value: m.sharepoint_folder_url, kind: "address" });
  }
  for (const r of await read("property_pathway_runs", `SELECT id, address AS name, sharepoint_folder_url, sharepoint_folder_path FROM property_pathway_runs
      WHERE COALESCE(sharepoint_folder_url, '') <> '' OR COALESCE(sharepoint_folder_path, '') <> ''`)) {
    const url = text(r.sharepoint_folder_url);
    add({ recordType: "pathway_run", recordId: String(r.id), recordName: text(r.name), column: "property_pathway_runs.sharepoint_folder_url", key: "", label: "", value: url || r.sharepoint_folder_path, kind: url ? "address" : "path" });
  }
  // One row per stored value of a record.
  const seen = new Set<string>();
  return {
    sources: sources.filter(s => {
      const id = migrationRowId(s.column, s.recordId, s.key, s.value);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
    unread,
  };
}

async function eachLimited<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** A folder found by name in "BGP - Share Drive" that may be the record's: the same name, or the record's name starting with it. */
export function suggestionFits(folderName: string, recordName: string): boolean {
  if (sameName(folderName, recordName)) return true;
  const f = folderName.trim().toLowerCase();
  return f.length >= 4 && recordName.trim().toLowerCase().startsWith(`${f} `);
}

/**
 * The brand page's old place: the folders in "BGP share drive/Companies",
 * listed once (every page), each offered to the company of exactly that name,
 * as the old "Open <brand> folder on SharePoint" link found it. Read with the
 * admin's own token; a place it cannot read is said, never hidden.
 */
export async function companiesPlaceRows(db: Db, token: string, live: Set<string>): Promise<{ rows: MigrationRow[]; unread: string[] }> {
  let folders: DriveEntry[];
  try {
    const library = await bgpLibrary(token);
    const place = await entryByPath(token, library.driveId, COMPANIES_FOLDER_PATH);
    if (!place?.isFolder) return { rows: [], unread: [] };
    folders = await listChildren(token, library.driveId, place.itemId, { foldersOnly: true });
  } catch (e: any) {
    return { rows: [], unread: [`${COMPANIES_FOLDER_PATH}: ${e?.message || "not read"}`] };
  }
  const byName = new Map<string, DriveEntry>();
  for (const f of folders) if (companyFolderKey(f.name)) byName.set(companyFolderKey(f.name), f);
  if (!byName.size) return { rows: [], unread: [] };
  const unread: string[] = [];
  const companies = (await db.query(
    `SELECT id, name FROM crm_companies
      WHERE merged_into_id IS NULL AND lower(btrim(regexp_replace(name, '\\s+', ' ', 'g'))) = ANY($1::text[])`,
    [[...byName.keys()]],
  ).catch((e: any) => { unread.push(`crm_companies: ${e?.message || "not read"}`); return { rows: [] as any[] }; })).rows;
  const column: MigrationColumn = "crm_companies.name";
  const rows = companies.flatMap((c: any): MigrationRow[] => {
    const entry = byName.get(companyFolderKey(c.name));
    if (!entry) return [];
    const recordId = String(c.id);
    const value = `${COMPANIES_FOLDER_PATH}/${entry.name}`;
    return [{
      column, recordType: "company", recordId, recordName: text(c.name), key: "", label: "", value, kind: "path",
      id: migrationRowId(column, recordId, "", value), error: null, entry,
      status: live.has(`company|${recordId}|${entry.driveId}|${entry.itemId}`) ? "linked" : "opens",
    }];
  });
  return { rows, unread };
}

/** The report, read with the admin's own token. Nothing is written but the preview itself. */
export async function buildMigrationPreview(db: Db, token: string, admin: FolderStaff & { account: string | null }): Promise<MigrationPreview> {
  const { sources, unread } = await readMigrationSources(db);
  const live = new Set((await db.query(`SELECT record_type, record_id, drive_id, item_id FROM record_folders WHERE removed_at IS NULL`)).rows
    .map((r: any) => `${r.record_type}|${r.record_id}|${r.drive_id}|${r.item_id}`));
  const library = sources.some(s => s.kind === "path") ? await bgpLibrary(token) : null;
  const rows: MigrationRow[] = sources.map(s => ({ ...s, id: migrationRowId(s.column, s.recordId, s.key, s.value), status: "error", error: null, entry: null }));
  await eachLimited(rows, 4, async row => {
    try {
      if (row.kind === "address" && !bgpSharePointUrl(row.value)) { row.status = "outside"; return; }
      const entry = row.kind === "address" ? await openLink(token, row.value) : await entryByPath(token, library!.driveId, row.value);
      if (!entry) { row.status = "missing"; return; }
      row.entry = entry;
      row.status = !entry.isFolder ? "not_folder" : live.has(`${row.recordType}|${row.recordId}|${entry.driveId}|${entry.itemId}`) ? "linked" : "opens";
    } catch (e: any) {
      row.status = e instanceof GraphError ? migrationStatus(e.status) : "error";
      row.error = e?.message || null;
    }
  });

  const companiesPlace = await companiesPlaceRows(db, token, live);
  rows.push(...companiesPlace.rows);
  unread.push(...companiesPlace.unread);

  // For records with nothing that opens: a folder of the same name in "BGP - Share Drive", shown as a suggestion only.
  const byRecord = new Map<string, MigrationRow[]>();
  for (const r of rows) (byRecord.get(`${r.recordType}|${r.recordId}`) || byRecord.set(`${r.recordType}|${r.recordId}`, []).get(`${r.recordType}|${r.recordId}`)!).push(r);
  const lost = [...byRecord.values()].filter(rs => !rs.some(r => r.status === "opens" || r.status === "linked") && rs[0].recordName.length >= 3).slice(0, SUGGESTION_RECORDS);
  const suggestions: MigrationSuggestion[] = [];
  await eachLimited(lost, 4, async rs => {
    const { recordType, recordId, recordName } = rs[0];
    const found = await searchFolders(token, recordName, "library").catch(() => [] as DriveEntry[]);
    for (const entry of found.filter(e => (e.path || "").startsWith(SHARE_DRIVE_NAME) && suggestionFits(e.name, recordName)).slice(0, 3)) {
      suggestions.push({ recordType, recordId, recordName, entry });
    }
  });

  const counts: Partial<Record<MigrationStatus, number>> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  const order = new Map(MIGRATION_COLUMNS.map((c, i) => [c.column, i]));
  rows.sort((a, b) => (order.get(a.column)! - order.get(b.column)!) || a.recordName.localeCompare(b.recordName) || a.key.localeCompare(b.key));
  return { previewedAt: new Date().toISOString(), previewedBy: admin.userId, previewedByName: admin.name, previewedAccount: admin.account, rows, suggestions, counts, unread, readers: OLD_FOLDER_READERS };
}

async function readSetting<T>(db: Db, key: string): Promise<T | null> {
  return ((await db.query(`SELECT value FROM system_settings WHERE key = $1`, [key])).rows[0]?.value ?? null) as T | null;
}
async function writeSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db.query(`INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
}
export async function migrationRuns(db: Db): Promise<MigrationRun[]> {
  const runs = await readSetting<MigrationRun[]>(db, MIGRATION_RUNS_KEY);
  return Array.isArray(runs) ? runs : [];
}

/** The ticked rows of the admin's own preview, within the hour, as links. One batch, every link logged. */
export async function applyMigration(db: Db, admin: FolderStaff & { account: string | null }, ids: unknown, previewedAt: unknown): Promise<{ batch: string; linked: number; already: number; skipped: { id: string; why: string }[] }> {
  const preview = await readSetting<MigrationPreview>(db, MIGRATION_PREVIEW_KEY);
  const refusal = migrationApplyRefusal(preview ? { previewedAt: preview.previewedAt, previewedBy: preview.previewedBy } : null, admin.userId, previewedAt);
  if (refusal) throw folderRefusal(409, refusal);
  const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
  if (!wanted.size) throw folderRefusal(400, "Tick the rows to move over.");
  const batch = `folders-migration-${new Date().toISOString()}`;
  const actor = { userId: admin.userId, account: preview!.previewedAccount ?? admin.account };
  const runRows: MigrationRun["rows"] = [];
  const skipped: { id: string; why: string }[] = [];
  let linked = 0, already = 0;
  for (const id of wanted) {
    const row = preview!.rows.find(r => r.id === id);
    if (!row) { skipped.push({ id, why: "Not on the preview." }); continue; }
    if (row.status !== "opens" || !row.entry) { skipped.push({ id, why: "It does not open to a folder." }); continue; }
    if (!(await folderRecord(db, row.recordType, row.recordId))) { skipped.push({ id, why: "The record has gone." }); continue; }
    const e = row.entry;
    const label = folderLabel(row.label) || folderLabel(e.name) || "Folder";
    const source = `migrated:${row.column}`;
    const inserted = (await db.query(
      `INSERT INTO record_folders (record_type, record_id, drive_id, item_id, label, position, drive_kind, web_url, cached_name, cached_path, status, source, linked_by, checked_at)
       SELECT $1::text, $2::text, $3::text, $4::text, $5::text,
              COALESCE((SELECT MAX(position) + 1 FROM record_folders WHERE record_type = $1::text AND record_id = $2::text AND removed_at IS NULL), 0),
              $6::text, $7::text, $8::text, $9::text, 'ok', $10::text, $11::text, now()
       ON CONFLICT (record_type, record_id, drive_id, item_id) WHERE removed_at IS NULL DO NOTHING
       RETURNING id`,
      [row.recordType, row.recordId, e.driveId, e.itemId, label, e.driveKind, e.webUrl, e.name, e.path, source, admin.userId],
    )).rows[0];
    // Already linked since the preview: nothing new, and nothing for an undo to take out.
    if (!inserted) { already++; continue; }
    const linkId = String(inserted.id);
    runRows.push({ column: row.column, recordType: row.recordType, recordId: row.recordId, key: row.key, value: row.value, linkId });
    linked++;
    await logFolderAction(db, actor, {
      action: "link", recordType: row.recordType, recordId: row.recordId, driveId: e.driveId, itemId: e.itemId, nameAfter: label,
      detail: { source, batch, from: row.value },
    });
  }
  if (runRows.length) {
    const runs = await migrationRuns(db);
    await writeSetting(db, MIGRATION_RUNS_KEY, [{ kind: "apply", batch, at: new Date().toISOString(), by: admin.userId, byName: admin.name, rows: runRows } satisfies MigrationRun, ...runs].slice(0, RUNS_KEPT));
  }
  return { batch, linked, already, skipped };
}

/** A batch's links taken back out (unlinked, logged); the old addresses show again. */
export async function undoMigration(db: Db, admin: FolderStaff & { account: string | null }, batch: unknown): Promise<{ batch: string; removed: number }> {
  const runs = await migrationRuns(db);
  const run = runs.find(r => r.kind === "apply" && r.batch === batch);
  if (!run) throw folderRefusal(404, "That batch isn't known.");
  if (run.undoneAt) throw folderRefusal(409, "That batch has already been undone.");
  const linkIds = run.rows.map(r => r.linkId).filter(Boolean);
  const removed = linkIds.length ? (await db.query(
    `UPDATE record_folders SET removed_at = now(), removed_by = $2
      WHERE id = ANY($1::text[]) AND removed_at IS NULL AND source LIKE 'migrated:%'
      RETURNING id, record_type, record_id, drive_id, item_id, label`, [linkIds, admin.userId],
  )).rows : [];
  for (const r of removed) {
    await logFolderAction(db, { userId: admin.userId, account: admin.account }, {
      action: "unlink", recordType: r.record_type, recordId: r.record_id, driveId: r.drive_id, itemId: r.item_id, nameBefore: r.label, detail: { batch, undo: true },
    });
  }
  run.undoneAt = new Date().toISOString();
  run.undoneBy = admin.userId;
  await writeSetting(db, MIGRATION_RUNS_KEY, runs);
  return { batch: String(batch), removed: removed.length };
}

export interface MigrationRouteDeps {
  db: Db;
  auth: RequestHandler;
  admin: RequestHandler;
  staff: (req: Request) => Promise<FolderStaff | null>;
  microsoft: (userId: string) => Promise<{ token: string; account: string } | null>;
}

export function foldersMigrationRouter(deps: MigrationRouteDeps): Router {
  const router = Router();
  const { db, auth, admin } = deps;
  // An admin, signed in as themselves; the report reads SharePoint with their own token.
  const handle = (needToken: boolean, fn: (req: Request, res: Response, me: FolderStaff & { account: string | null }, token: string | null) => Promise<unknown>): RequestHandler => async (req, res) => {
    try {
      const staff = await deps.staff(req);
      if (!staff) return res.status(403).json({ message: "Admins only, signed in as themselves." });
      const ms = needToken ? await deps.microsoft(staff.userId) : null;
      if (needToken && !ms) return res.status(428).json({ message: "Connect your own Microsoft 365 first, on the SharePoint page: the report opens each address as you.", connect: true });
      await fn(req, res, { ...staff, account: ms?.account ?? null }, ms?.token ?? null);
    } catch (e: any) {
      if (e?.status && e.status >= 400 && e.status < 500) return res.status(e.status).json({ message: e.message });
      if (e instanceof GraphError) return res.status(502).json({ message: e.message });
      console.error("[folders-migration]", e?.message || e);
      res.status(500).json({ message: "The report could not be made." });
    }
  };

  router.get("/api/admin/folders/migration", auth, admin, handle(true, async (_req, res, me, token) => {
    const preview = await buildMigrationPreview(db, token!, me);
    await writeSetting(db, MIGRATION_PREVIEW_KEY, preview);
    res.json(preview);
  }));

  router.post("/api/admin/folders/migration/apply", auth, admin, handle(false, async (req, res, me) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    res.json(await applyMigration(db, me, body.ids, body.previewedAt));
  }));

  router.post("/api/admin/folders/migration/undo", auth, admin, handle(false, async (req, res, me) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    res.json(await undoMigration(db, me, body.batch));
  }));

  router.get("/api/admin/folders/migration/runs", auth, admin, handle(false, async (_req, res) => {
    res.json({ runs: await migrationRuns(db) });
  }));

  return router;
}
