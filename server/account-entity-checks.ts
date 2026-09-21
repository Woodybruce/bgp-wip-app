// Group entity checks (Delivery 5, Task 8) — ONE check job per entity in
// the canonical group view, with durable per-entity outcomes.
//
// entity_kind='company'        → runAllAmlChecks(entityId, null, userId)
//                                (kyc-orchestrator: full sweep, investigation
//                                row, checklist auto-ticks preserving manual
//                                ticks).
// entity_kind='trading_entity' → the lighter variant composed from the same
//                                kyc-clouseau building blocks (getCompanyData
//                                / screenSanctions / assessRisk) keyed by CH
//                                number/name, written into
//                                crm_entity_kyc.evidence + last_check_job_at
//                                — NEVER the deprecated
//                                crm_trading_entities.kyc_* columns.
//
// Durability: a system_settings-backed run record per (account, run id)
// with per-entity { status: queued|running|done|failed, investigationId?,
// error? }, so progress survives a restart; pg_try_advisory_lock on the
// account key makes concurrent runs no-ops (same pattern as Task 4's
// folder jobs). A retry re-runs ONLY the failed entities.
//
// Entity checks do NOT call recomputeDealKycApproved — deal-level effects
// are the Task-9 shadow report's evidence, not a side effect here.

import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "./auth";
import { getAccountEntities, groupEntitiesDeniedForScope, type GroupEntity } from "./account-entities";
import type { Querier } from "./account-resolver";

export const entityChecksRunKey = (accountId: string, runId: string) => `entity-checks:${accountId}:${runId}`;
export const entityChecksLatestKey = (accountId: string) => `entity-checks:${accountId}:latest`;

// ─── State ───────────────────────────────────────────────────────────────

export type EntityCheckStatus = "queued" | "running" | "done" | "failed";

export interface EntityCheckOutcome {
  entityKind: "company" | "trading_entity";
  entityId: string | null;
  name: string;
  status: EntityCheckStatus;
  investigationId?: number | null;
  error?: string;
}

export interface EntityChecksRun {
  runId: string;
  accountId: string;
  status: "running" | "done";           // a run ENDS done — per-entity failures live on the entities
  claim?: string;
  leaseUntil?: string;
  startedAt: number;
  finishedAt?: number;
  userId?: string | null;
  entities: EntityCheckOutcome[];
}

// ─── Store (system_settings-backed, advisory-locked) ─────────────────────

export interface EntityChecksStore {
  tryLock(): Promise<boolean>;
  saveRun(run: EntityChecksRun): Promise<void>;
  readLatest(): Promise<EntityChecksRun | null>;
  unlock(): Promise<void>;
  close(): void;
}

type Connection = { query: (sql: string, values?: any[]) => Promise<any>; release: () => void };
type Database = { query: (sql: string, values?: any[]) => Promise<any>; connect: () => Promise<Connection> };

export function pgEntityChecksStore(db: Database, accountId: string): EntityChecksStore {
  const latestKey = entityChecksLatestKey(accountId);
  let client: Connection | null = null;
  let claim = "";
  return {
    async tryLock() {
      client = await db.connect();
      const locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [latestKey])).rows[0]?.locked === true;
      if (!locked) { client.release(); client = null; return false; }
      return true;
    },
    async saveRun(run) {
      if (run.claim) claim = run.claim;
      // Claim-guarded: a lapsed-lease runner can never clobber the state of
      // the runner that legitimately re-claimed after it.
      await client!.query(
        `INSERT INTO system_settings(key,value) VALUES ($1,$2::jsonb)
         ON CONFLICT(key) DO UPDATE SET value=$2::jsonb, updated_at=now()
         WHERE system_settings.key=$1
           AND (system_settings.value->>'claim' = $3
                OR system_settings.value->>'claim' IS NULL
                OR system_settings.value = '{}'::jsonb)`,
        [entityChecksRunKey(accountId, run.runId), JSON.stringify(run), claim],
      );
      await client!.query(
        `INSERT INTO system_settings(key,value) VALUES ($1,to_jsonb($2::text))
         ON CONFLICT(key) DO UPDATE SET value=to_jsonb($2::text), updated_at=now()`,
        [latestKey, run.runId],
      );
    },
    async readLatest() {
      const { rows } = await client!.query("SELECT value FROM system_settings WHERE key=$1", [latestKey]);
      const runId = rows[0]?.value;
      if (!runId || typeof runId !== "string") return null;
      const { rows: runRows } = await client!.query("SELECT value FROM system_settings WHERE key=$1", [entityChecksRunKey(accountId, runId)]);
      return (runRows[0]?.value || null) as EntityChecksRun | null;
    },
    async unlock() {
      if (!client) return;
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [latestKey]).catch(() => {});
    },
    close() {
      client?.release();
      client = null;
    },
  };
}

export async function readLatestEntityChecksRun(
  accountId: string,
  deps: { pool?: Querier } = {},
): Promise<EntityChecksRun | null> {
  const q = deps.pool ?? (await import("./db")).pool;
  const { rows } = await q.query("SELECT value FROM system_settings WHERE key=$1", [entityChecksLatestKey(accountId)]);
  const runId = rows[0]?.value;
  if (!runId || typeof runId !== "string") return null;
  const { rows: runRows } = await q.query("SELECT value FROM system_settings WHERE key=$1", [entityChecksRunKey(accountId, runId)]);
  return (runRows[0]?.value || null) as EntityChecksRun | null;
}

// ─── Default per-kind check implementations (injectable for tests) ───────

export type CompanyChecker = (entityId: string, userId: string | null) => Promise<{ investigationId: number | null }>;
export type TradingEntityChecker = (entity: GroupEntity, q: Querier) => Promise<void>;

const defaultCompanyChecker: CompanyChecker = async (entityId, userId) => {
  const { runAllAmlChecks } = await import("./kyc-orchestrator");
  const result = await runAllAmlChecks(entityId, null, userId);
  return { investigationId: result.investigationId };
};

// The lighter trading-entity sweep: CH profile (when a number exists),
// sanctions over the entity + its officers/PSCs, risk assessment — persisted
// on the canonical crm_entity_kyc row's evidence + last_check_job_at.
const defaultTradingEntityChecker: TradingEntityChecker = async (entity, q) => {
  const { getCompanyData, screenSanctions, assessRisk } = await import("./kyc-clouseau");
  const names: string[] = [entity.name];
  let companyData: any = null;
  if (entity.companiesHouseNumber) {
    companyData = await getCompanyData(entity.companiesHouseNumber);
    for (const o of companyData?.officers || []) if (!o.resigned_on && o.name) names.push(o.name);
    for (const p of companyData?.pscs || []) if (!p.ceased_on && p.name) names.push(p.name);
  }
  const sanctions = await screenSanctions(names);
  const risk = assessRisk(companyData, sanctions);
  const evidence = {
    companies_house: companyData ? { number: entity.companiesHouseNumber, name: companyData?.profile?.company_name ?? null } : null,
    sanctions: (sanctions || []).filter((s: any) => s.status === "strong_match" || s.status === "potential_match"),
    risk,
  };
  await q.query(
    `INSERT INTO crm_entity_kyc (entity_kind, entity_id, evidence, last_check_job_at, updated_at)
     VALUES ('trading_entity', $1, $2::jsonb, now(), now())
     ON CONFLICT (entity_kind, entity_id) DO UPDATE SET
       evidence = COALESCE(crm_entity_kyc.evidence, '{}'::jsonb) || $2::jsonb,
       last_check_job_at = now(), updated_at = now()`,
    [entity.entityId, JSON.stringify(evidence)],
  );
};

// ─── Runner ──────────────────────────────────────────────────────────────

const LEASE_MS = 30 * 60_000;

export async function runEntityChecks(
  args: { accountId: string; userId?: string | null; retryFailed?: boolean; now?: () => Date },
  deps: {
    store: EntityChecksStore;
    pool?: Querier;
    view?: any;
    checkCompany?: CompanyChecker;
    checkTradingEntity?: TradingEntityChecker;
  },
): Promise<{ ran: boolean; reason?: string; run: EntityChecksRun | null }> {
  const { store } = deps;
  const q = deps.pool ?? (await import("./db")).pool;
  const clock = args.now || (() => new Date());

  if (!(await store.tryLock())) {
    return { ran: false, reason: "already_running", run: await readLatestEntityChecksRun(args.accountId, { pool: q }).catch(() => null) };
  }

  try {
    const previous = await store.readLatest();
    const now = clock();
    if (previous?.status === "running" && previous.claim && new Date(previous.leaseUntil || 0).getTime() > now.getTime()) {
      return { ran: false, reason: "leased", run: previous };
    }

    // The canonical group view decides WHAT gets checked — jsonb-only
    // entries have no canonical row to write results against, so they get
    // an explicit failed outcome pointing at the conflict, never a silent skip.
    const report = await getAccountEntities(args.accountId, {}, { pool: q, view: deps.view });
    const priorByEntity = new Map((previous?.entities || []).map(e => [`${e.entityKind}|${e.entityId}`, e]));
    const retryFailed = !!args.retryFailed && previous?.status === "done";

    const entities: EntityCheckOutcome[] = report.entities.map(e => {
      const key = `${e.entityKind}|${e.entityId}`;
      const prior = priorByEntity.get(key);
      if (retryFailed && prior && prior.status === "done") return { ...prior };
      return {
        entityKind: e.entityKind,
        entityId: e.entityId,
        name: e.name,
        status: "queued" as const,
      };
    });

    const claim = randomUUID();
    const run: EntityChecksRun = {
      runId: retryFailed && previous ? previous.runId : randomUUID(),
      accountId: args.accountId,
      status: "running",
      claim,
      leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
      startedAt: retryFailed && previous ? previous.startedAt : now.getTime(),
      userId: args.userId ?? null,
      entities,
    };
    await store.saveRun(run);

    const checkCompany = deps.checkCompany ?? defaultCompanyChecker;
    const checkTrading = deps.checkTradingEntity ?? defaultTradingEntityChecker;

    for (const outcome of entities) {
      if (outcome.status === "done") continue;    // retry carries successes forward
      if (!outcome.entityId) {
        outcome.status = "failed";
        outcome.error = "No canonical entity row — resolve the representation conflict before checks can run";
        await store.saveRun(run);
        continue;
      }
      outcome.status = "running";
      await store.saveRun(run);
      try {
        if (outcome.entityKind === "company") {
          const result = await checkCompany(outcome.entityId, args.userId ?? null);
          outcome.investigationId = result.investigationId ?? null;
        } else {
          const entity = report.entities.find(e => e.entityKind === outcome.entityKind && e.entityId === outcome.entityId)!;
          await checkTrading(entity, q);
        }
        outcome.status = "done";
      } catch (e: any) {
        outcome.status = "failed";
        outcome.error = e?.message || "check failed";
      }
      await store.saveRun(run);
    }

    run.status = "done";
    run.finishedAt = clock().getTime();
    delete run.claim;
    delete run.leaseUntil;
    await store.saveRun(run);
    return { ran: true, run };
  } finally {
    await store.unlock();
    store.close();
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────

const router = Router();

router.post("/api/accounts/:id/entity-checks", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    const scopeCompanyId = await resolveCompanyScope(req);
    if (groupEntitiesDeniedForScope(scopeCompanyId)) {
      return res.status(403).json({ error: "Entity checks are staff-only" });
    }
    const accountId = String(req.params.id);
    const { pool } = await import("./db");
    const userId = (req.session as any)?.userId || (req as any).tokenUserId || null;
    const result = await runEntityChecks(
      { accountId, userId, retryFailed: req.body?.retryFailed === true },
      { store: pgEntityChecksStore(pool as any, accountId), pool },
    );
    if (!result.ran && result.reason === "already_running") {
      return res.status(409).json({ error: "A check run is already in progress for this account", run: result.run });
    }
    res.status(202).json(result.run);
  } catch (e: any) {
    if (e?.message === "company not found") return res.status(404).json({ error: "Company not found" });
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/accounts/:id/entity-checks/latest", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    const scopeCompanyId = await resolveCompanyScope(req);
    if (groupEntitiesDeniedForScope(scopeCompanyId)) {
      return res.status(403).json({ error: "Entity checks are staff-only" });
    }
    const run = await readLatestEntityChecksRun(String(req.params.id));
    if (!run) return res.status(404).json({ error: "No check run yet for this account" });
    res.json(run);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
