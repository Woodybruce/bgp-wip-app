// Account folder map (Delivery 5, Task 2) — read-side resolver + bind
// writers for account_folder_map, the ONE durable account→folder mapping.
//
// Identity is (owner_kind, owner_id, logical_key) → (drive_id, item_id).
// cached_path / web_url are display caches refreshed on write, never used
// for identity, so a renamed SharePoint folder keeps resolving to the same
// logical node. The resolver reuses resolveAccountView's entity/property
// sets — never a second account-scope SQL.
//
// Bind-first: writers only ever RECORD a mapping (or a create that happened
// inside the already-authorised client root); nothing here moves, renames
// or re-roots an existing SharePoint folder.

import { resolveAccountView, type AccountView, type Querier } from "./account-resolver";
import type { FolderOwnerKind } from "@shared/client-folder-tree";

export interface AccountFolderMapRow {
  id: string;
  owner_kind: FolderOwnerKind;
  owner_id: string;
  parent_map_id: string | null;
  logical_key: string;
  display_name: string;
  drive_id: string;
  item_id: string;
  cached_path: string | null;
  web_url: string | null;
  bind_status: "bound" | "created" | "missing" | "conflict";
  bound_by: string | null;
}

export interface AccountFolderMap {
  view: AccountView;
  rows: AccountFolderMapRow[];
  byNode: Map<string, AccountFolderMapRow>;
  byItem: Map<string, AccountFolderMapRow>;
}

async function defaultPool(): Promise<Querier> {
  const { pool } = await import("./db");
  return pool;
}

export function nodeKey(ownerKind: string, ownerId: string, logicalKey: string): string {
  return `${ownerKind}|${ownerId}|${logicalKey}`;
}

function itemKey(driveId: string, itemId: string): string {
  return `${driveId}|${itemId}`;
}

// Loads every account_folder_map row for the account: the client root and
// top-level sections (owner_kind='company' on the root id), entity folders
// (owner_kind='entity' over the resolver's confirmed entity set) and
// property folders (owner_kind='property' over the portfolio). Scoped
// viewers get the resolver's scoped portfolio exactly as Deliveries 2/3.
export async function getAccountFolderMap(
  companyId: string,
  opts: { scopeCompanyId?: string | null } = {},
  deps: { pool?: Querier; view?: AccountView } = {},
): Promise<AccountFolderMap> {
  const q = deps.pool ?? await defaultPool();
  const view = deps.view ?? await resolveAccountView(companyId, { scopeCompanyId: opts.scopeCompanyId ?? null }, { pool: q });

  const entityIds = view.entities.filter(e => e.relation !== "self").map(e => e.companyId);
  const propertyIds = view.properties.map(p => p.propertyId);

  const { rows } = await q.query(
    `SELECT id, owner_kind, owner_id, parent_map_id, logical_key, display_name,
            drive_id, item_id, cached_path, web_url, bind_status, bound_by
       FROM account_folder_map
      WHERE (owner_kind = 'company' AND owner_id = $1)
         OR (owner_kind = 'entity' AND owner_id = ANY($2::text[]))
         OR (owner_kind = 'property' AND owner_id = ANY($3::text[]))`,
    [companyId, entityIds, propertyIds],
  ).catch((e: any) => {
    // Pre-migration environments: the table may not exist yet (42P01) — the
    // read paths then behave exactly as if nothing were bound.
    if (e?.code === "42P01") return { rows: [] as any[] };
    throw e;
  });

  const mapRows = rows as AccountFolderMapRow[];
  const byNode = new Map<string, AccountFolderMapRow>();
  const byItem = new Map<string, AccountFolderMapRow>();
  for (const row of mapRows) {
    byNode.set(nodeKey(row.owner_kind, row.owner_id, row.logical_key), row);
    byItem.set(itemKey(row.drive_id, row.item_id), row);
  }
  return { view, rows: mapRows, byNode, byItem };
}

// Pure lookup used by the upload/listing paths: the bound folder for one
// logical node, or null when nothing is bound (callers fall back to the
// legacy path/URL behaviour — binding is progressive, never big-bang).
export function resolveNodeFolder(
  map: Pick<AccountFolderMap, "byNode">,
  ownerKind: FolderOwnerKind,
  ownerId: string,
  logicalKey: string,
): { driveId: string; itemId: string } | null {
  const row = map.byNode.get(nodeKey(ownerKind, ownerId, logicalKey));
  if (!row || row.bind_status === "conflict" || row.bind_status === "missing") return null;
  return { driveId: row.drive_id, itemId: row.item_id };
}

// The names a physical folder might already have for a map row: the current
// display name plus the legacy name-only variant (pre-Delivery-5 setups
// created bare property/entity names). Identity is still the item id — this
// is only the bind-pass matcher.
export function folderNameCandidates(row: Pick<AccountFolderMapRow, "display_name">): string[] {
  const names = [row.display_name];
  const legacy = row.display_name.replace(/ — [^—]+$/, "");
  if (legacy !== row.display_name && legacy.length > 0) names.push(legacy);
  return [...new Set(names)];
}

export interface FolderBindingInput {
  ownerKind: FolderOwnerKind;
  ownerId: string;
  logicalKey: string;
  displayName: string;
  driveId: string;
  itemId: string;
  cachedPath?: string | null;
  webUrl?: string | null;
  parentMapId?: string | null;
  boundBy?: string | null;
}

// Upsert by (owner_kind, owner_id, logical_key) — idempotent on retry: a
// resumed job re-recording the same node is a no-op update, never a second
// row. Returns the effective bind_status: 'conflict' when the physical
// folder is already bound to a DIFFERENT logical node (human resolution —
// never auto-merged).
export async function recordFolderBinding(
  input: FolderBindingInput,
  bindStatus: "bound" | "created",
  deps: { pool?: Querier } = {},
): Promise<{ status: "bound" | "created" | "conflict" }> {
  const q = deps.pool ?? await defaultPool();

  const { rows: claimants } = await q.query(
    `SELECT owner_kind, owner_id, logical_key FROM account_folder_map
      WHERE drive_id = $1 AND item_id = $2`,
    [input.driveId, input.itemId],
  );
  const other = claimants.find((r: any) =>
    !(r.owner_kind === input.ownerKind && r.owner_id === input.ownerId && r.logical_key === input.logicalKey));
  if (other) {
    await q.query(
      `UPDATE account_folder_map
          SET bind_status = 'conflict', updated_at = now()
        WHERE owner_kind = $1 AND owner_id = $2 AND logical_key = $3`,
      [other.owner_kind, other.owner_id, other.logical_key],
    );
    return { status: "conflict" };
  }

  await q.query(
    `INSERT INTO account_folder_map
       (owner_kind, owner_id, parent_map_id, logical_key, display_name,
        drive_id, item_id, cached_path, web_url, bind_status, bound_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (owner_kind, owner_id, logical_key)
     DO UPDATE SET drive_id = EXCLUDED.drive_id, item_id = EXCLUDED.item_id,
                   display_name = EXCLUDED.display_name,
                   cached_path = EXCLUDED.cached_path, web_url = EXCLUDED.web_url,
                   bind_status = EXCLUDED.bind_status, bound_by = EXCLUDED.bound_by,
                   updated_at = now()`,
    [
      input.ownerKind, input.ownerId, input.parentMapId ?? null, input.logicalKey, input.displayName,
      input.driveId, input.itemId, input.cachedPath ?? null, input.webUrl ?? null, bindStatus, input.boundBy ?? null,
    ],
  );
  return { status: bindStatus };
}

export async function recordFolderCreated(
  input: FolderBindingInput,
  deps: { pool?: Querier } = {},
): Promise<{ status: "bound" | "created" | "conflict" }> {
  return recordFolderBinding(input, "created", deps);
}

// Mirrors the client root's webUrl onto crm_companies.sharepoint_folder_url
// exactly as the legacy stamper did (server/microsoft.ts client-folders
// route), so the client SharePoint jail keeps reading its root unchanged.
export async function stampClientRootUrl(
  companyId: string,
  webUrl: string,
  deps: { pool?: Querier } = {},
): Promise<void> {
  const q = deps.pool ?? await defaultPool();
  await q.query(
    `UPDATE crm_companies SET sharepoint_folder_url = $1
      WHERE id = $2
         OR (lower(trim(name)) = (SELECT lower(trim(name)) FROM crm_companies WHERE id = $2)
             AND merged_into_id IS NULL
             AND sharepoint_folder_url IS NULL)`,
    [webUrl, companyId],
  );
}

// Mirrors a property root's webUrl onto crm_properties.sharepoint_folder_url
// so PropertyFoldersPanel keeps resolving by stored URL (never overwrites a
// URL someone set deliberately).
export async function stampPropertyRootUrl(
  propertyId: string,
  webUrl: string,
  deps: { pool?: Querier } = {},
): Promise<void> {
  const q = deps.pool ?? await defaultPool();
  await q.query(
    `UPDATE crm_properties SET sharepoint_folder_url = $1
      WHERE id = $2 AND (sharepoint_folder_url IS NULL OR sharepoint_folder_url = '')`,
    [webUrl, propertyId],
  );
}
