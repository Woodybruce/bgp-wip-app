// Client folder setup jobs (Delivery 5, Task 4) — durable, resumable runner
// for the standard client folder tree, modelled on runPreparationStage
// (server/brand-preparation-jobs.ts): one system_settings row per company,
// pg_try_advisory_lock on the job key (double-clicks and concurrent runners
// are no-ops), claim + lease, and PER-NODE status as the resume point — a
// restart re-reads the row and skips every bound|created node, so a
// retry/resume never creates a duplicate tree.
//
// Steps: (1) re-run the Task-3 matcher and persist `bound` bindings;
// (2) create only `missing` nodes, parent-before-child, inside the
// already-authorised client root (409 = success); (3) stamp webUrls
// (root + property roots) exactly as the legacy stamper did. The job ends
// `done` ONLY when every node is bound|created — "done despite partial
// failure" is impossible.
//
// The Graph token is the acting staff member's delegated token, taken per
// resume call and never persisted. Bind-first: existing folders are bound,
// never moved, renamed or re-created.

import { randomUUID } from "node:crypto";
import { resolveAccountView, type AccountView, type Querier } from "./account-resolver";
import {
  getAccountFolderMap, recordFolderBinding, recordFolderCreated,
  stampClientRootUrl, stampPropertyRootUrl, nodeKey,
} from "./account-folder-map";
import {
  matchExpectedTree, walkPhysicalTree, resolveClientRoot,
  type ChildrenLister, type PhysicalNode, type ResolvedRoot,
} from "./account-folder-inventory";
import { buildExpectedFolderTree, type ExpectedFolderNode } from "@shared/client-folder-tree";
import { runChunked, type SharePointItemRef } from "./sharepoint-graph";

const LEASE_MS = 15 * 60_000;
const CREATE_PARALLELISM = 3;

export const clientFolderJobKey = (companyId: string) => `client-folder-job:${companyId}`;

// ─── State ───────────────────────────────────────────────────────────────

export type ClientFolderNodeStatus = "pending" | "bound" | "created" | "failed";

export interface ClientFolderNodeState {
  logicalKey: string;
  ownerKind: string;
  ownerId: string;
  displayName: string;
  treePath: string[];
  status: ClientFolderNodeStatus;
  error?: string;
  driveId?: string;
  itemId?: string;
  webUrl?: string | null;
}

export interface ClientFolderJobState {
  status: "running" | "done" | "failed";
  companyId: string;
  companyName: string;
  claim?: string;
  leaseUntil?: string;
  startedAt: number;                  // epoch ms — the wire field the existing poller renders
  properties: number;
  total: number;
  message?: string;
  nodes: ClientFolderNodeState[];
}

// The wire shape the existing UI poller consumes (status/created/errors/
// total/message) plus the new per-node failure list. A stale "running"
// claim (lease expired — the process died) projects as resumable failure
// so the UI stops polling and offers the retry.
export function clientFolderJobWire(state: ClientFolderJobState, now = Date.now()) {
  const stale = state.status === "running" && new Date(state.leaseUntil || 0).getTime() <= now;
  const failedNodes = state.nodes
    .filter(n => n.status === "failed")
    .map(n => ({ logicalKey: n.logicalKey, displayName: n.displayName, error: n.error || "unknown" }));
  return {
    status: stale ? "failed" as const : state.status,
    startedAt: state.startedAt,
    companyName: state.companyName,
    properties: state.properties,
    created: state.nodes.filter(n => n.status === "bound" || n.status === "created").length,
    errors: state.nodes.filter(n => n.status === "failed").length,
    total: state.total,
    message: stale ? "Setup was interrupted — re-run to resume from where it stopped." : state.message,
    failedNodes,
  };
}

// ─── Store (system_settings-backed, advisory-locked) ─────────────────────

export interface ClientFolderJobStore {
  tryLock(): Promise<boolean>;
  read(): Promise<ClientFolderJobState | null>;
  save(state: ClientFolderJobState): Promise<void>;
  unlock(): Promise<void>;
  close(): void;
}

type Connection = { query: (sql: string, values?: any[]) => Promise<any>; release: () => void };
type Database = { query: (sql: string, values?: any[]) => Promise<any>; connect: () => Promise<Connection> };

// The session lock survives transaction commits while the runner works;
// after a crash the connection closes and the claim becomes retryable once
// the lease lapses (same semantics as runPreparationStage).
export function pgClientFolderJobStore(db: Database, companyId: string): ClientFolderJobStore {
  const key = clientFolderJobKey(companyId);
  let client: Connection | null = null;
  let claim = "";
  return {
    async tryLock() {
      client = await db.connect();
      const locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [key])).rows[0]?.locked === true;
      if (!locked) { client.release(); client = null; return false; }
      await client.query("INSERT INTO system_settings(key,value) VALUES ($1,'{}'::jsonb) ON CONFLICT(key) DO NOTHING", [key]);
      return true;
    },
    async read() {
      const value = (await client!.query("SELECT value FROM system_settings WHERE key=$1", [key])).rows[0]?.value;
      return (value && Object.keys(value).length > 0 ? value : null) as ClientFolderJobState | null;
    },
    async save(state) {
      if (state.claim) claim = state.claim;
      // Guarded by the claim: a lapsed-lease runner can never clobber the
      // state of the runner that legitimately re-claimed after it.
      await client!.query(
        "UPDATE system_settings SET value=$2::jsonb, updated_at=now() WHERE key=$1 AND (value->>'claim' = $3 OR value->>'claim' IS NULL OR value = '{}'::jsonb)",
        [key, JSON.stringify(state), claim],
      );
    },
    async unlock() {
      if (!client) return;
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]).catch(() => {});
    },
    close() {
      client?.release();
      client = null;
    },
  };
}

export async function readClientFolderJobState(
  companyId: string,
  deps: { pool?: Querier } = {},
): Promise<ClientFolderJobState | null> {
  const q = deps.pool ?? (await import("./db")).pool;
  const { rows } = await q.query("SELECT value FROM system_settings WHERE key=$1", [clientFolderJobKey(companyId)]);
  const value = rows[0]?.value;
  return (value && Object.keys(value).length > 0 ? value : null) as ClientFolderJobState | null;
}

// ─── Graph surface (injectable for tests) ────────────────────────────────

export interface ClientFolderGraph {
  resolveRoot(): Promise<ResolvedRoot | null>;
  // Creates "BGP share drive/{ClientName}" when no root exists at all, then
  // resolves it. The only folder ever created outside an existing bound
  // parent — the authorised location, same as the legacy setup.
  ensureRoot(clientName: string): Promise<SharePointItemRef>;
  listChildren: ChildrenLister;
  createFolder(driveId: string, parentItemId: string, name: string): Promise<{ success: boolean; item?: { id: string; webUrl: string | null }; error?: string }>;
}

// ─── Runner ──────────────────────────────────────────────────────────────

function stateNodeFor(node: ExpectedFolderNode): ClientFolderNodeState {
  return {
    logicalKey: node.logicalKey,
    ownerKind: node.ownerKind,
    ownerId: node.ownerId,
    displayName: node.displayName,
    treePath: node.treePath,
    status: "pending",
  };
}

function nodePathKey(node: Pick<ClientFolderNodeState, "treePath">): string {
  return node.treePath.join("");
}

export async function runClientFolderJob(
  args: { companyId: string; companyName?: string; userId?: string | null; now?: () => Date },
  deps: { store: ClientFolderJobStore; pool?: Querier; graph: ClientFolderGraph; view?: AccountView },
): Promise<{ ran: boolean; reason?: string; state: ClientFolderJobState | null }> {
  const { store } = deps;
  const q = deps.pool ?? (await import("./db")).pool;
  const clock = args.now || (() => new Date());

  if (!(await store.tryLock())) {
    return { ran: false, reason: "already_running", state: await readClientFolderJobState(args.companyId, { pool: q }).catch(() => null) };
  }

  try {
    const previous = await store.read();
    const now = clock();
    if (previous?.status === "running" && previous.claim && new Date(previous.leaseUntil || 0).getTime() > now.getTime()) {
      return { ran: false, reason: "leased", state: previous };
    }

    // 1. Account identity: the resolver's confirmed entity set + portfolio —
    //    never the legacy SELECT DISTINCT p.name (same-name properties keep
    //    their own folders by stable id).
    const view = deps.view ?? await resolveAccountView(args.companyId, {}, { pool: q });
    const clientName = args.companyName || view.root.name;
    const expected = buildExpectedFolderTree({
      companyId: args.companyId,
      clientName,
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

    // Resume: keep per-node status from the previous run (bound|created are
    // never re-touched); FAILED nodes go back to pending so a retry
    // re-attempts exactly the failed set; new expected nodes join as
    // pending; gone nodes drop.
    const priorByNode = new Map((previous?.nodes || []).map(n => [`${n.ownerKind}|${n.ownerId}|${n.logicalKey}`, n]));
    const nodes: ClientFolderNodeState[] = expected.map(e => {
      const prior = priorByNode.get(`${e.ownerKind}|${e.ownerId}|${e.logicalKey}`);
      if (prior) {
        const retry = prior.status === "failed";
        return { ...prior, status: retry ? "pending" as const : prior.status, error: retry ? undefined : prior.error, treePath: e.treePath, displayName: e.displayName };
      }
      return stateNodeFor(e);
    });

    const claim = randomUUID();
    const state: ClientFolderJobState = {
      status: "running",
      companyId: args.companyId,
      companyName: clientName,
      claim,
      leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
      startedAt: previous?.startedAt && previous.status === "running" ? previous.startedAt : now.getTime(),
      properties: view.properties.length,
      total: nodes.length,
      nodes,
    };
    await store.save(state);

    const byStateNode = new Map(nodes.map(n => [`${n.ownerKind}|${n.ownerId}|${n.logicalKey}`, n]));
    const byPath = new Map(nodes.map(n => [nodePathKey(n), n]));

    // 2. The client root: bind the existing physical root FIRST; only when
    //    no root exists at all is one created (the authorised location).
    const rootNode = byStateNode.get(nodeKey("company", args.companyId, "root"))!;
    if (rootNode.status === "pending") {
      const resolved = await deps.graph.resolveRoot();
      if (resolved) {
        const r = await recordFolderBinding({
          ownerKind: "company", ownerId: args.companyId, logicalKey: "root",
          displayName: rootNode.displayName,
          driveId: resolved.ref.driveId, itemId: resolved.ref.itemId,
          webUrl: resolved.ref.webUrl, boundBy: args.userId ?? null,
        }, "bound", { pool: q });
        Object.assign(rootNode, r.status === "conflict"
          ? { status: "failed", error: "Root folder is already bound to another node — resolve manually" }
          : { status: "bound", driveId: resolved.ref.driveId, itemId: resolved.ref.itemId, webUrl: resolved.ref.webUrl });
      } else {
        const created = await deps.graph.ensureRoot(clientName);
        const r = await recordFolderCreated({
          ownerKind: "company", ownerId: args.companyId, logicalKey: "root",
          displayName: rootNode.displayName,
          driveId: created.driveId, itemId: created.itemId,
          webUrl: created.webUrl, boundBy: args.userId ?? null,
        }, { pool: q });
        Object.assign(rootNode, r.status === "conflict"
          ? { status: "failed", error: "Root folder is already bound to another node — resolve manually" }
          : { status: "created", driveId: created.driveId, itemId: created.itemId, webUrl: created.webUrl });
      }
      await store.save(state);
    }
    if (rootNode.status === "failed") {
      state.status = "failed";
      state.message = rootNode.error;
      delete state.claim; delete state.leaseUntil;
      await store.save(state);
      return { ran: true, state };
    }
    if (rootNode.webUrl) {
      await stampClientRootUrl(args.companyId, rootNode.webUrl, { pool: q }).catch(() => {});
    }

    const rootRef: SharePointItemRef = {
      driveId: rootNode.driveId!, itemId: rootNode.itemId!,
      name: rootNode.displayName, webUrl: rootNode.webUrl ?? null, fullPath: "",
    };

    // 3. Re-run the matcher over the physical tree (complete pagination).
    const walk = await walkPhysicalTree(deps.graph.listChildren, rootRef.driveId, rootRef);
    const mapLoad = await getAccountFolderMap(args.companyId, {}, { pool: q, view });
    const matchRows = matchExpectedTree(expected, walk.root, rootRef.driveId, mapLoad.byNode);
    const matchByNode = new Map(matchRows.map(r => [`${r.ownerKind}|${r.ownerId}|${r.logicalKey}`, r]));

    const pendingNodes = () => nodes.filter(n => n.status === "pending");

    // 4. Persist bindings for everything the matcher found (bind FIRST).
    for (const node of pendingNodes()) {
      const row = matchByNode.get(`${node.ownerKind}|${node.ownerId}|${node.logicalKey}`);
      if (!row) continue;
      if (row.status === "bound") {
        const boundRow = mapLoad.byNode.get(nodeKey(node.ownerKind, node.ownerId, node.logicalKey));
        Object.assign(node, { status: "bound", driveId: row.driveId, itemId: row.itemId, webUrl: boundRow?.web_url ?? null });
      } else if (row.status === "matched") {
        const physical = row.itemId ? findPhysical(walk.root, row.itemId) : null;
        const r = await recordFolderBinding({
          ownerKind: node.ownerKind as any, ownerId: node.ownerId, logicalKey: node.logicalKey,
          displayName: node.displayName,
          driveId: row.driveId!, itemId: row.itemId!,
          webUrl: physical?.webUrl ?? null, boundBy: args.userId ?? null,
        }, "bound", { pool: q });
        if (r.status === "conflict") {
          Object.assign(node, { status: "failed", error: "Physical folder is already bound to another node — resolve manually" });
        } else {
          Object.assign(node, { status: "bound", driveId: row.driveId, itemId: row.itemId, webUrl: physical?.webUrl ?? null });
        }
      } else if (row.status === "conflict") {
        Object.assign(node, { status: "failed", error: row.notes.join(" ") || "Ambiguous physical match — resolve manually" });
      }
    }
    await store.save(state);

    // 5. Create the genuinely missing nodes, parent-before-child, bounded
    //    parallelism. 409 counts as success (createFolderInItem resolves the
    //    existing child); any other Graph failure marks the node failed and
    //    the run continues.
    const depths = [...new Set(pendingNodes().map(n => n.treePath.length))].sort((a, b) => a - b);
    for (const depth of depths) {
      const level = pendingNodes().filter(n => n.treePath.length === depth);
      await runChunked(level, CREATE_PARALLELISM, async (node) => {
        const parent = byPath.get(node.treePath.slice(0, -1).join(""));
        if (!parent || parent.status === "failed" || !parent.itemId || !parent.driveId) {
          Object.assign(node, { status: "failed", error: "Parent folder is not available — its setup must succeed first" });
          return;
        }
        const created = await deps.graph.createFolder(parent.driveId, parent.itemId, node.displayName);
        if (!created.success) {
          Object.assign(node, { status: "failed", error: created.error || "Graph create failed" });
          return;
        }
        if (!created.item) {
          Object.assign(node, { status: "failed", error: "Folder exists but its item id could not be resolved — retry to re-resolve" });
          return;
        }
        const r = await recordFolderCreated({
          ownerKind: node.ownerKind as any, ownerId: node.ownerId, logicalKey: node.logicalKey,
          displayName: node.displayName,
          driveId: parent.driveId, itemId: created.item.id,
          webUrl: created.item.webUrl ?? null, boundBy: args.userId ?? null,
        }, { pool: q });
        if (r.status === "conflict") {
          Object.assign(node, { status: "failed", error: "Folder is already bound to another node — resolve manually" });
        } else {
          Object.assign(node, { status: "created", driveId: parent.driveId, itemId: created.item.id, webUrl: created.item.webUrl ?? null });
        }
      });
      await store.save(state);
    }

    // 6. Property-root webUrl stamps (existing readers keep working).
    for (const node of nodes) {
      if (node.logicalKey === "property" && (node.status === "bound" || node.status === "created") && node.webUrl) {
        await stampPropertyRootUrl(node.ownerId, node.webUrl, { pool: q }).catch(() => {});
      }
    }

    // 7. done ONLY when every node is bound|created.
    const failed = nodes.filter(n => n.status === "failed");
    state.status = failed.length === 0 ? "done" : "failed";
    state.message = failed.length === 0
      ? undefined
      : `${failed.length} folder${failed.length === 1 ? "" : "s"} could not be set up — re-run to resume (bound/created folders are kept).`;
    delete state.claim; delete state.leaseUntil;
    await store.save(state);
    return { ran: true, state };
  } finally {
    await store.unlock();
    store.close();
  }
}

function findPhysical(root: PhysicalNode, itemId: string): PhysicalNode | null {
  if (root.itemId === itemId) return root;
  for (const c of root.children) {
    const hit = findPhysical(c, itemId);
    if (hit) return hit;
  }
  return null;
}
