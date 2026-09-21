// Account folder inventory (Delivery 5, Task 3) — the read-only dry-run
// mapping report. BIND FIRST: it walks the client's existing physical
// SharePoint tree (complete pagination via @odata.nextLink, bounded depth 4)
// and matches every expected logical node against what is already there,
// reporting bound / matched / missing / conflict per node. Nothing is
// created, moved or written by this module — the binding writes happen in
// the durable setup job (server/client-folder-jobs.ts), which re-runs the
// same matcher and persists `bound` rows before creating `missing` ones.
//
// Staff only: any resolved client scope → 403 (same guard shape as the
// reconciliation route).

import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { resolveAccountView, type Querier } from "./account-resolver";
import { getAccountFolderMap, nodeKey, type AccountFolderMapRow } from "./account-folder-map";
import {
  buildExpectedFolderTree, expectedNameCandidates,
  type ExpectedFolderNode, type FolderOwnerKind,
} from "@shared/client-folder-tree";
import {
  SHAREPOINT_ROOT_FOLDER, getSharePointDriveId,
  resolveFolderUrlRef, resolveItemByPath, type SharePointItemRef,
} from "./sharepoint-graph";
import { GRAPH_LIST_PAGE_CAP, type GraphChildrenPage } from "./microsoft-graph-pagination";

const WALK_DEPTH_CAP = 4;

export type InventoryStatus = "bound" | "matched" | "missing" | "conflict";

export interface InventoryRow {
  logicalKey: string;
  ownerKind: FolderOwnerKind;
  ownerId: string;
  ownerLabel: string;
  displayName: string;
  status: InventoryStatus;
  driveId: string | null;
  itemId: string | null;
  physicalName: string | null;
  notes: string[];
}

export interface FolderInventoryReport {
  companyId: string;
  clientName: string;
  root: { source: "map" | "url" | "path"; driveId: string; itemId: string; name: string; webUrl: string | null } | null;
  rows: InventoryRow[];
  summary: { total: number; bound: number; matched: number; missing: number; conflicts: number };
  // Proof the walk enumerated every child page (>200-item folders appear whole).
  enumeration: { maxDepth: number; foldersWalked: number; itemsSeen: number; warnings: string[] };
  generatedAt: string;
}

// Staff-only guard — tested as the pure helper, same shape as
// reconciliationDeniedForScope.
export function folderInventoryDeniedForScope(scopeCompanyId: string | null | undefined): boolean {
  return scopeCompanyId != null;
}

// ─── Physical tree walk ──────────────────────────────────────────────────

export interface PhysicalNode {
  itemId: string;
  name: string;
  isFolder: boolean;
  webUrl?: string | null;
  children: PhysicalNode[];
}

export interface ChildrenPage {
  items: any[];
  capped: boolean;
}

export type ChildrenLister = (driveId: string, itemId: string) => Promise<ChildrenPage>;

// A ChildrenLister that follows @odata.nextLink until exhausted (the >200
// items acceptance gate), surfacing a page-cap warning instead of silently
// truncating. `fetchPage` receives the first-page URL then each absolute
// nextLink — injected so tests run 3 synthetic pages with no network.
export function createChildrenLister(
  fetchPage: (url: string) => Promise<GraphChildrenPage>,
  firstPageUrl: (driveId: string, itemId: string) => string,
  maxPages: number = GRAPH_LIST_PAGE_CAP,
): ChildrenLister {
  return async (driveId, itemId) => {
    const items: any[] = [];
    let url: string | null = firstPageUrl(driveId, itemId);
    let pages = 0;
    let capped = false;
    while (url) {
      const page = await fetchPage(url);
      pages++;
      items.push(...(page?.value || []));
      url = page?.["@odata.nextLink"] || null;
      if (url && pages >= maxPages) { capped = true; break; }
    }
    return { items, capped };
  };
}

export interface WalkResult {
  root: PhysicalNode;
  foldersWalked: number;
  itemsSeen: number;
  warnings: string[];
}

// Depth-bounded walk of the physical tree under the client root. Depth 4
// covers the logical tree (root → section → entity/property → subfolder).
export async function walkPhysicalTree(
  listChildren: ChildrenLister,
  driveId: string,
  root: SharePointItemRef,
  maxDepth: number = WALK_DEPTH_CAP,
): Promise<WalkResult> {
  const warnings: string[] = [];
  let foldersWalked = 0;
  let itemsSeen = 0;

  const walk = async (itemId: string, name: string, depth: number, webUrl: string | null = null): Promise<PhysicalNode> => {
    const node: PhysicalNode = { itemId, name, isFolder: true, webUrl, children: [] };
    if (depth >= maxDepth) return node;
    foldersWalked++;
    const page = await listChildren(driveId, itemId);
    itemsSeen += page.items.length;
    if (page.capped) {
      warnings.push(`Page cap hit listing "${name}" — the listing may be incomplete`);
    }
    for (const child of page.items) {
      if (!child?.folder) {
        node.children.push({ itemId: child?.id || "", name: child?.name || "", isFolder: false, webUrl: child?.webUrl ?? null, children: [] });
        continue;
      }
      node.children.push(await walk(child.id, child.name || "", depth + 1, child?.webUrl ?? null));
    }
    return node;
  };

  const rootNode = await walk(root.itemId, root.name, 0, root.webUrl ?? null);
  return { root: rootNode, foldersWalked, itemsSeen, warnings };
}

// ─── Matcher (pure — tested without Graph) ───────────────────────────────

export function matchExpectedTree(
  nodes: ExpectedFolderNode[],
  physicalRoot: PhysicalNode | null,
  rootDriveId: string | null,
  bindings: Map<string, AccountFolderMapRow>,
): InventoryRow[] {
  const rows: InventoryRow[] = [];
  const byItem = new Map<string, PhysicalNode>();
  if (physicalRoot) {
    const index = (n: PhysicalNode) => {
      byItem.set(n.itemId, n);
      for (const c of n.children) index(c);
    };
    index(physicalRoot);
  }

  const pathOf = (n: ExpectedFolderNode) => n.treePath.join("");
  const childrenOf = new Map<string, ExpectedFolderNode[]>();
  for (const n of nodes) {
    if (n.treePath.length <= 1) continue;
    const parent = n.treePath.slice(0, -1).join("");
    childrenOf.set(parent, [...(childrenOf.get(parent) || []), n]);
  }

  const visit = (node: ExpectedFolderNode, physicalParent: PhysicalNode | null, parentMissing: boolean) => {
    const notes: string[] = [];
    let status: InventoryStatus = "missing";
    let driveId: string | null = null;
    let itemId: string | null = null;
    let physicalName: string | null = null;
    let descend: PhysicalNode | null = null;
    const isRoot = node.treePath.length === 1;
    const binding = bindings.get(nodeKey(node.ownerKind, node.ownerId, node.logicalKey));

    if (binding && (binding.bind_status === "bound" || binding.bind_status === "created")) {
      status = "bound";
      driveId = binding.drive_id;
      itemId = binding.item_id;
      const physical = byItem.get(binding.item_id);
      if (physical) {
        physicalName = physical.name;
        descend = isRoot ? physicalRoot : physical;
      } else {
        notes.push("Bound item not seen under the client root (moved, deleted, or the listing was truncated) — check in SharePoint");
      }
    } else if (isRoot) {
      if (physicalRoot) {
        status = "matched";
        driveId = rootDriveId;
        itemId = physicalRoot.itemId;
        physicalName = physicalRoot.name;
        descend = physicalRoot;
      }
    } else if (!physicalParent || parentMissing) {
      status = "missing";
      if (parentMissing) notes.push("Parent folder is missing — created together with it");
    } else {
      const folders = physicalParent.children.filter(c => c.isFolder);
      let hits = folders.filter(c => c.name === node.displayName);
      let legacy = false;
      if (hits.length === 0) {
        const candidates = expectedNameCandidates(node);
        hits = folders.filter(c => candidates.includes(c.name));
        legacy = hits.length > 0;
      }
      if (hits.length === 1) {
        status = "matched";
        driveId = rootDriveId;
        itemId = hits[0].itemId;
        physicalName = hits[0].name;
        descend = hits[0];
        if (legacy) notes.push("Matched by the legacy (pre-Delivery-5) folder name");
      } else if (hits.length > 1) {
        status = "conflict";
        driveId = rootDriveId;
        notes.push(...hits.map(h => `Physical folder "${h.name}" (${h.itemId}) also matches this node`));
        notes.push("No binding written — resolve the duplicate manually");
      }
    }

    rows.push({
      logicalKey: node.logicalKey,
      ownerKind: node.ownerKind,
      ownerId: node.ownerId,
      ownerLabel: node.ownerLabel,
      displayName: node.displayName,
      status, driveId, itemId, physicalName, notes,
    });

    for (const child of childrenOf.get(pathOf(node)) || []) {
      visit(child, descend, status === "missing" || status === "conflict");
    }
  };

  const rootNode = nodes.find(n => n.treePath.length === 1);
  if (rootNode) visit(rootNode, physicalRoot, physicalRoot == null);
  return rows;
}

export function summarizeInventory(rows: InventoryRow[]): FolderInventoryReport["summary"] {
  return {
    total: rows.length,
    bound: rows.filter(r => r.status === "bound").length,
    matched: rows.filter(r => r.status === "matched").length,
    missing: rows.filter(r => r.status === "missing").length,
    conflicts: rows.filter(r => r.status === "conflict").length,
  };
}

// ─── Root resolution: map → stored URL → legacy path probe ───────────────

export interface ResolvedRoot {
  ref: SharePointItemRef;
  source: "map" | "url" | "path";
}

async function defaultPool(): Promise<Querier> {
  const { pool } = await import("./db");
  return pool;
}

export async function resolveClientRoot(
  companyId: string,
  companyName: string,
  token: string,
  deps: { pool?: Querier } = {},
): Promise<ResolvedRoot | null> {
  const q = deps.pool ?? await defaultPool();

  // 1. A durable binding wins — drive/item identity directly, no resolution.
  const { rows: mapRows } = await q.query(
    `SELECT drive_id, item_id, display_name, web_url, cached_path FROM account_folder_map
      WHERE owner_kind = 'company' AND owner_id = $1 AND logical_key = 'root'
        AND bind_status IN ('bound', 'created')
      LIMIT 1`,
    [companyId],
  ).catch((e: any) => (e?.code === "42P01" ? { rows: [] as any[] } : Promise.reject(e)));
  if (mapRows[0]) {
    const r = mapRows[0];
    return {
      source: "map",
      ref: {
        driveId: r.drive_id, itemId: r.item_id, name: r.display_name,
        webUrl: r.web_url ?? null, fullPath: (r.cached_path || "").toLowerCase(),
      },
    };
  }

  const graphGet = async (path: string) => {
    const res = await fetch(path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  };

  // 2. The stored folder URL (the client jail's root), across same-named
  //    duplicate company rows exactly as the jail resolves it.
  const { rows: urlRows } = await q.query(
    `SELECT sharepoint_folder_url FROM crm_companies
      WHERE (id = $1 OR (merged_into_id IS NULL AND lower(trim(name)) =
              (SELECT lower(trim(name)) FROM crm_companies WHERE id = $1)))
        AND sharepoint_folder_url IS NOT NULL
      ORDER BY (id = $1) DESC
      LIMIT 1`,
    [companyId],
  );
  const url: string | null = urlRows[0]?.sharepoint_folder_url || null;
  if (url) {
    const ref = await resolveFolderUrlRef(url, graphGet).catch(() => null);
    if (ref) return { source: "url", ref };
  }

  // 3. Legacy path probe: BGP share drive/{ClientName}.
  const spInfo = await getSharePointDriveId(token);
  if (!spInfo) return null;
  const ref = await resolveItemByPath(token, spInfo.driveId, `${SHAREPOINT_ROOT_FOLDER}/${companyName}`);
  return ref ? { source: "path", ref } : null;
}

// ─── Report assembly ─────────────────────────────────────────────────────

export interface InventoryGraphDeps {
  resolveRoot?: () => Promise<ResolvedRoot | null>;
  listChildren?: ChildrenLister;
}

export async function generateFolderInventory(
  companyId: string,
  deps: { pool?: Querier; graph?: InventoryGraphDeps } = {},
): Promise<FolderInventoryReport> {
  const q = deps.pool ?? await defaultPool();
  const view = await resolveAccountView(companyId, {}, { pool: q });
  const mapLoad = await getAccountFolderMap(companyId, {}, { pool: q, view });

  const resolved = deps.graph?.resolveRoot ? await deps.graph.resolveRoot() : null;
  let walk: WalkResult | null = null;
  if (resolved && deps.graph?.listChildren) {
    walk = await walkPhysicalTree(deps.graph.listChildren, resolved.ref.driveId, resolved.ref);
  }

  const nodes = buildExpectedFolderTree({
    companyId,
    clientName: view.root.name,
    entities: view.entities
      .filter(e => e.relation !== "self")
      .map(e => ({
        entityKind: e.relation === "trading_entity" ? "trading_entity" as const : "company" as const,
        entityId: e.companyId,
        name: e.name,
        companiesHouseNumber: e.companiesHouseNumber,
      })),
    properties: view.properties.map(p => ({ propertyId: p.propertyId, name: p.name })),
  });

  const rows = matchExpectedTree(nodes, walk?.root ?? null, resolved?.ref.driveId ?? null, mapLoad.byNode);

  return {
    companyId,
    clientName: view.root.name,
    root: resolved
      ? { source: resolved.source, driveId: resolved.ref.driveId, itemId: resolved.ref.itemId, name: resolved.ref.name, webUrl: resolved.ref.webUrl }
      : null,
    rows,
    summary: summarizeInventory(rows),
    enumeration: {
      maxDepth: WALK_DEPTH_CAP,
      foldersWalked: walk?.foldersWalked ?? 0,
      itemsSeen: walk?.itemsSeen ?? 0,
      warnings: walk?.warnings ?? (resolved ? [] : ["Client root folder could not be resolved — every node reports missing"]),
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── Route ───────────────────────────────────────────────────────────────

const router = Router();

router.get("/api/accounts/:id/folder-inventory", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    const scopeCompanyId = await resolveCompanyScope(req);
    if (folderInventoryDeniedForScope(scopeCompanyId)) {
      return res.status(403).json({ error: "Folder inventory reports are staff-only" });
    }
    const { getValidMsToken } = await import("./microsoft");
    const token = await getValidMsToken(req);
    if (!token) return res.status(401).json({ message: "Not connected to Microsoft 365" });

    const companyId = String(req.params.id);
    const q = await defaultPool();
    const { rows: companyRows } = await q.query(`SELECT name FROM crm_companies WHERE id = $1`, [companyId]);
    if (!companyRows[0]) return res.status(404).json({ error: "Company not found" });

    const listChildren = createChildrenLister(
      async (url) => {
        const pageRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!pageRes.ok) throw new Error(`Graph listing failed: ${pageRes.status}`);
        return pageRes.json();
      },
      (driveId, itemId) =>
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=200&$select=id,name,folder,file,size,webUrl`,
    );

    const report = await generateFolderInventory(companyId, {
      pool: q,
      graph: {
        resolveRoot: () => resolveClientRoot(companyId, companyRows[0].name, token, { pool: q }),
        listChildren,
      },
    });
    res.json(report);
  } catch (e: any) {
    if (e?.message === "company not found") return res.status(404).json({ error: "Company not found" });
    res.status(500).json({ error: e.message });
  }
});

export default router;
