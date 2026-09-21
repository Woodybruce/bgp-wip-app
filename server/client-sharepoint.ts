// Client-scoped SharePoint browsing (Landsec app).
//
// The client app gets the standard SharePoint file surface, but jailed to
// ONE folder: crm_companies.sharepoint_folder_url for their company — the
// "Landsec" folder holding the per-property folder trees. Requests run on
// the app-level Graph token (the client never gets a Microsoft token), and
// every item id is verified to live under the client's root before
// anything is listed or downloaded — no path-hopping into the rest of the
// BGP tenant.
//
// Mounted under /api/client/ which is already on the client read allowlist.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { graphRequest } from "./shared-mailbox";
import { resolveCompanyScope } from "./company-scope";
import { listAllChildren } from "./microsoft-graph-pagination";
import { resolveAccountView, type AccountView, type Querier } from "./account-resolver";
import { getAccountFolderMap, resolveNodeFolder, nodeKey } from "./account-folder-map";

const router = Router();

interface RootRef {
  driveId: string;
  itemId: string;
  name: string;
  // Path prefix used for the jail check, e.g. "/drives/b!x/root:/CLIENTS/Landsec"
  pathPrefix: string;
  resolvedAt: number;
}

const rootCache = new Map<string, RootRef>();
const ROOT_TTL_MS = 10 * 60_000;

// Injectable surface so tests run without Graph/DB (Delivery 5, Task 5).
export interface SharePointDeps {
  pool?: Querier;
  graphGet?: (path: string) => Promise<any>;
  cache?: Map<string, RootRef>;
  now?: () => number;
}

function sharesId(url: string): string {
  const b64 = Buffer.from(url, "utf8").toString("base64")
    .replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  return `u!${b64}`;
}

function itemFullPath(item: any): string {
  const parent = item?.parentReference?.path || "";
  return `${parent}/${item?.name || ""}`.toLowerCase();
}

export async function resolveRoot(companyId: string, deps: SharePointDeps = {}): Promise<RootRef | null> {
  const q = deps.pool ?? pool;
  const graphGet = deps.graphGet ?? graphRequest;
  const cache = deps.cache ?? rootCache;
  const now = deps.now ?? Date.now;
  const cached = cache.get(companyId);
  if (cached && now() - cached.resolvedAt < ROOT_TTL_MS) return cached;

  // 1. The durable binding wins (Delivery 5): drive/item identity directly,
  //    no URL resolution and rename-safe. The item meta is still fetched by
  //    id to derive the jail path prefix fresh (a rename never breaks the
  //    jail); a binding whose item was deleted falls through to the legacy
  //    URL resolution below.
  const { rows: mapRows } = await q.query(
    `SELECT drive_id, item_id FROM account_folder_map
      WHERE owner_kind = 'company' AND owner_id = $1 AND logical_key = 'root'
        AND bind_status IN ('bound', 'created')
      LIMIT 1`,
    [companyId],
  ).catch((e: any) => (e?.code === "42P01" ? { rows: [] as any[] } : Promise.reject(e)));
  if (mapRows[0]) {
    const bound = mapRows[0];
    const item = await graphGet(`/drives/${bound.drive_id}/items/${bound.item_id}?$select=id,name,webUrl,parentReference,folder`).catch(() => null);
    if (item?.id) {
      const ref: RootRef = {
        driveId: bound.drive_id, itemId: bound.item_id, name: item.name,
        pathPrefix: itemFullPath(item), resolvedAt: now(),
      };
      cache.set(companyId, ref);
      return ref;
    }
  }

  // 2. Legacy: the folder link can sit on a duplicate company row (a second
  //    "Landsec" record) — same hazard the team board handles. Prefer the
  //    scope row's own URL, fall back to any same-named unmerged sibling
  //    that has one.
  const r = await q.query(
    `SELECT sharepoint_folder_url FROM crm_companies
      WHERE (id = $1 OR (merged_into_id IS NULL AND lower(trim(name)) =
              (SELECT lower(trim(name)) FROM crm_companies WHERE id = $1)))
        AND sharepoint_folder_url IS NOT NULL
      ORDER BY (id = $1) DESC
      LIMIT 1`,
    [companyId]
  );
  const url: string | null = r.rows[0]?.sharepoint_folder_url || null;
  if (!url) return null;

  const item = await graphGet(`/shares/${sharesId(url)}/driveItem?$select=id,name,webUrl,parentReference,folder`);
  if (!item?.id || !item?.parentReference?.driveId) return null;

  const ref: RootRef = {
    driveId: item.parentReference.driveId,
    itemId: item.id,
    name: item.name,
    pathPrefix: itemFullPath(item),
    resolvedAt: now(),
  };
  cache.set(companyId, ref);
  return ref;
}

// The requester's company — client logins and staff in client-view mode
// only. Staff outside client view use the full /api/microsoft surface.
async function requireClientScope(req: Request, res: Response): Promise<string | null> {
  const scope = await resolveCompanyScope(req);
  if (!scope) {
    res.status(403).json({ message: "Client-scoped SharePoint is only available in the client view" });
    return null;
  }
  return scope;
}

// Verify an item sits inside the client's root folder.
async function assertInRoot(root: RootRef, itemId: string, graphGet: (path: string) => Promise<any> = graphRequest): Promise<any | null> {
  if (itemId === root.itemId) return { id: root.itemId, name: root.name };
  const item = await graphGet(`/drives/${root.driveId}/items/${itemId}?$select=id,name,webUrl,parentReference,folder,file,size,lastModifiedDateTime`);
  if (!item?.id) return null;
  const full = itemFullPath(item);
  if (full !== root.pathPrefix && !full.startsWith(root.pathPrefix + "/")) return null;
  return item;
}

// The bound property folder for the client Files board (Delivery 5, Task
// 5): identity is the account_folder_map row, never a name match. Returns
// null when the property is outside the caller's scoped portfolio, when no
// binding exists (the UI falls back to the legacy "unverified" name match),
// or when the bound item fails the jail check — a binding pointing outside
// the client root is a data problem to fix, never something to expose.
export async function resolveBoundPropertyRoot(
  scope: string,
  propertyId: string,
  deps: SharePointDeps & { view?: AccountView } = {},
): Promise<{ id: string; name: string; webUrl: string | null } | null> {
  const q = deps.pool ?? pool;
  const view = deps.view ?? await resolveAccountView(scope, { scopeCompanyId: scope }, { pool: q });
  if (!view.properties.some(p => p.propertyId === propertyId)) return null;

  const map = await getAccountFolderMap(scope, { scopeCompanyId: scope }, { pool: q, view });
  const bound = resolveNodeFolder(map, "property", propertyId, "property");
  if (!bound) return null;

  const root = await resolveRoot(scope, deps);
  if (!root) return null;
  const item = await assertInRoot(root, bound.itemId, deps.graphGet ?? graphRequest).catch(() => null);
  if (!item) {
    console.warn(`[client-sharepoint] property binding ${propertyId} failed the root jail — not exposing it`);
    return null;
  }
  const row = map.byNode.get(nodeKey("property", propertyId, "property"));
  return { id: bound.itemId, name: item.name || row?.display_name || "", webUrl: item.webUrl ?? row?.web_url ?? null };
}

// GET /api/client/sharepoint/property-root?propertyId= — the verified
// property folder binding, 404 when nothing is bound (UI falls back).
router.get("/api/client/sharepoint/property-root", requireAuth, async (req, res) => {
  try {
    const scope = await requireClientScope(req, res);
    if (!scope) return;
    const propertyId = String(req.query.propertyId || "");
    if (!propertyId) return res.status(400).json({ message: "propertyId required" });
    const bound = await resolveBoundPropertyRoot(scope, propertyId);
    if (!bound) return res.status(404).json({ message: "No verified folder is bound to that property" });
    res.json(bound);
  } catch (e: any) {
    console.error("[client-sharepoint] property-root failed:", e?.message);
    res.status(500).json({ message: "Couldn't reach SharePoint" });
  }
});

// GET /api/client/sharepoint/root — the client's root folder (name + id).
router.get("/api/client/sharepoint/root", requireAuth, async (req, res) => {
  try {
    const scope = await requireClientScope(req, res);
    if (!scope) return;
    const root = await resolveRoot(scope);
    if (!root) return res.status(404).json({ message: "No SharePoint folder is linked for your company yet — ask your BGP team." });
    res.json({ id: root.itemId, name: root.name });
  } catch (e: any) {
    console.error("[client-sharepoint] root failed:", e?.message);
    res.status(500).json({ message: "Couldn't reach SharePoint" });
  }
});

// GET /api/client/sharepoint/list?itemId= — children of a folder under the root.
router.get("/api/client/sharepoint/list", requireAuth, async (req, res) => {
  try {
    const scope = await requireClientScope(req, res);
    if (!scope) return;
    const root = await resolveRoot(scope);
    if (!root) return res.status(404).json({ message: "No SharePoint folder is linked for your company yet — ask your BGP team." });

    const itemId = String(req.query.itemId || root.itemId);
    const item = await assertInRoot(root, itemId);
    if (!item) return res.status(403).json({ message: "That folder is outside your SharePoint area" });

    // graphRequest accepts absolute URLs, so @odata.nextLink pages resolve
    // as-is — large folders no longer truncate at the first page.
    const children = await listAllChildren(
      (url) => graphRequest(url),
      `/drives/${root.driveId}/items/${itemId}/children?$top=200&$orderby=name&$select=id,name,size,lastModifiedDateTime,folder,file`
    );
    const items = children.map((c: any) => ({
      id: c.id,
      name: c.name,
      size: c.size ?? null,
      lastModified: c.lastModifiedDateTime ?? null,
      isFolder: !!c.folder,
      childCount: c.folder?.childCount ?? null,
    }));
    res.json({ items });
  } catch (e: any) {
    console.error("[client-sharepoint] list failed:", e?.message);
    res.status(500).json({ message: "Couldn't list that folder" });
  }
});

// GET /api/client/sharepoint/content?itemId= — download a file under the root.
router.get("/api/client/sharepoint/content", requireAuth, async (req, res) => {
  try {
    const scope = await requireClientScope(req, res);
    if (!scope) return;
    const root = await resolveRoot(scope);
    if (!root) return res.status(404).json({ message: "No SharePoint folder is linked for your company yet" });

    const itemId = String(req.query.itemId || "");
    if (!itemId) return res.status(400).json({ message: "itemId required" });
    const item = await assertInRoot(root, itemId);
    if (!item || item.folder) return res.status(403).json({ message: "That file is outside your SharePoint area" });

    const meta = await graphRequest(`/drives/${root.driveId}/items/${itemId}?$select=id,name,@microsoft.graph.downloadUrl`);
    const dl = meta?.["@microsoft.graph.downloadUrl"];
    if (!dl) return res.status(404).json({ message: "No download available for that file" });
    res.redirect(dl);
  } catch (e: any) {
    console.error("[client-sharepoint] content failed:", e?.message);
    res.status(500).json({ message: "Couldn't download that file" });
  }
});

export default router;
