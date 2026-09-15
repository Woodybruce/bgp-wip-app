import { randomUUID } from "node:crypto";

export const BRAND_PREPARATION_STAGES = ["identity", "profile", "apollo", "rocketreach", "stores", "images", "logo", "brief", "contacts"] as const;
export type BrandPreparationStage = typeof BRAND_PREPARATION_STAGES[number];
export type PreparationOutcome = { status: "ready" | "no_match" | "needs_review" | "unavailable"; reason?: string; fingerprint?: string };
export type PreparationState = {
  stage: BrandPreparationStage; fingerprint: string; status: string;
  lastAttemptAt?: string; lastSuccessAt?: string; nextAttemptAt?: string;
  lastError?: string | null; reason?: string | null; failures?: number;
  claim?: string; leaseUntil?: string;
};
type Queryable = { query: (sql: string, values?: any[]) => Promise<any> };
type Connection = Queryable & { release: () => void };
type Database = Queryable & { connect: () => Promise<Connection> };
const DAY = 86400000;
const LEASE_MS = 15 * 60000;
export const preparationKey = (companyId: string, stage: BrandPreparationStage) => `brand-preparation:${companyId}:${stage}`;

export function nextPreparationState(previous: Partial<PreparationState>, outcome: PreparationOutcome | { status: "error"; reason: string }, now: Date): Partial<PreparationState> {
  const failures = outcome.status === "error" ? (previous.failures || 0) + 1 : 0;
  const delay = outcome.status === "ready" ? 30 * DAY
    : outcome.status === "no_match" ? 7 * DAY
    : outcome.status === "error" ? Math.min(7 * DAY, 3600000 * 2 ** Math.min(failures - 1, 8))
    : DAY;
  return {
    status: outcome.status, failures, reason: outcome.reason || null,
    lastError: outcome.status === "error" ? outcome.reason : null,
    ...(outcome.status === "ready" ? { lastSuccessAt: now.toISOString() } : {}),
    nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
  };
}

// The session lock survives transaction commits while a provider is running.
// A second process cannot claim even if a slow call outlasts its persisted lease.
// After a crash the connection closes; its claim becomes retryable after the lease.
export async function runPreparationStage(
  db: Database, companyId: string, stage: BrandPreparationStage, fingerprint: string,
  work: () => Promise<PreparationOutcome>,
  options: { dailyLimit: number; force?: boolean; charge?: boolean; readyTtlMs?: number; now?: () => Date } = { dailyLimit: 20 },
): Promise<{ ran: boolean; state: PreparationState; reason?: string }> {
  const key = preparationKey(companyId, stage);
  const client = await db.connect();
  const clock = options.now || (() => new Date());
  let locked = false;
  let transaction = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [key])).rows[0]?.locked === true;
    if (!locked) return { ran: false, state: { stage, fingerprint, status: "running" }, reason: "already_running" };
    await client.query("BEGIN"); transaction = true;
    await client.query("INSERT INTO system_settings(key,value) VALUES ($1,'{}'::jsonb) ON CONFLICT(key) DO NOTHING", [key]);
    const previous: PreparationState = (await client.query("SELECT value FROM system_settings WHERE key=$1 FOR UPDATE", [key])).rows[0].value || {};
    const now = clock();
    const sameIdentity = previous.fingerprint === fingerprint;
    if (previous.claim && new Date(previous.leaseUntil || 0).getTime() > now.getTime()) {
      await client.query("COMMIT"); transaction = false;
      return { ran: false, state: previous, reason: "leased" };
    }
    if (!options.force && sameIdentity && new Date(previous.nextAttemptAt || 0).getTime() > now.getTime()) {
      await client.query("COMMIT"); transaction = false;
      return { ran: false, state: previous, reason: "cooldown" };
    }
    if (options.charge !== false) {
      const budgetKey = `brand-preparation-budget:${now.toISOString().slice(0, 10)}:${stage}`;
      await client.query("INSERT INTO system_settings(key,value) VALUES ($1,'{\"used\":0}'::jsonb) ON CONFLICT(key) DO NOTHING", [budgetKey]);
      const budget = (await client.query("SELECT value FROM system_settings WHERE key=$1 FOR UPDATE", [budgetKey])).rows[0].value;
      if ((Number(budget?.used) || 0) >= Math.max(0, options.dailyLimit)) {
        await client.query("COMMIT"); transaction = false;
        return { ran: false, state: sameIdentity ? previous : { stage, fingerprint, status: "pending" }, reason: "daily_limit" };
      }
      await client.query("UPDATE system_settings SET value=$2::jsonb,updated_at=now() WHERE key=$1", [budgetKey, JSON.stringify({ used: (Number(budget?.used) || 0) + 1 })]);
    }
    const claim = randomUUID();
    const claimed: PreparationState = {
      ...(sameIdentity ? previous : {}), stage, fingerprint, status: "running", claim,
      leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(), lastAttemptAt: now.toISOString(),
    };
    await client.query("UPDATE system_settings SET value=$2::jsonb,updated_at=now() WHERE key=$1", [key, JSON.stringify(claimed)]);
    await client.query("COMMIT"); transaction = false;
    let outcome: PreparationOutcome | { status: "error"; reason: string };
    try { outcome = await work(); }
    catch (error: any) { outcome = { status: "error", reason: String(error?.message || "Preparation failed").slice(0, 500) }; }
    const finishedAt = clock();
    const final: PreparationState = { ...claimed, ...nextPreparationState(claimed, outcome, finishedAt), fingerprint: "fingerprint" in outcome && outcome.fingerprint || claimed.fingerprint };
    if (outcome.status === "ready" && options.readyTtlMs) final.nextAttemptAt = new Date(finishedAt.getTime() + options.readyTtlMs).toISOString();
    delete final.claim; delete final.leaseUntil;
    await client.query("UPDATE system_settings SET value=$2::jsonb,updated_at=now() WHERE key=$1 AND value->>'claim'=$3", [key, JSON.stringify(final), claim]);
    return { ran: true, state: final };
  } catch (error) {
    if (transaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]).catch(() => {});
    client.release();
  }
}

export async function readPreparationStates(db: Queryable, companyId: string, fingerprint: string): Promise<PreparationState[]> {
  const keys = BRAND_PREPARATION_STAGES.map(stage => preparationKey(companyId, stage));
  const rows = (await db.query("SELECT key,value FROM system_settings WHERE key=ANY($1::text[])", [keys])).rows;
  const states = new Map(rows.map((row: any) => [row.key, row.value]));
  return BRAND_PREPARATION_STAGES.map(stage => {
    const saved = states.get(preparationKey(companyId, stage)) as PreparationState | undefined;
    if (!saved || saved.fingerprint !== fingerprint) return { stage, fingerprint, status: "pending" };
    const { claim, leaseUntil, ...publicState } = saved;
    if (claim && new Date(leaseUntil || 0).getTime() <= Date.now()) return { ...publicState, status: "pending" };
    return publicState;
  });
}
