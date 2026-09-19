import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { getBrandIdentity } from "./brand-identity";
import { currentOfficialProfileEvidence } from "./brand-profile-evidence";
import { readPreparationStates } from "./brand-preparation-jobs";

type Tab = "brand" | "uk" | "activity" | "intel";
type CoreStatus = { status: "idle" | "running" | "done" | "error" | "needs_review";
  tab?: Tab; reason?: string; updated?: string[]; startedAt?: string; finishedAt?: string; expiresAt?: string; claim?: string };
const keyFor = (id: string) => `brand-core-refresh:${id}`;

export async function readBrandCoreRefresh(companyId: string): Promise<CoreStatus> {
  const saved = (await pool.query("SELECT value FROM system_settings WHERE key=$1", [keyFor(companyId)])).rows[0]?.value;
  if (!saved) return { status: "idle" };
  const { claim, ...publicState } = saved;
  if (saved.status === "running" && !(Date.parse(saved.expiresAt || "") >= Date.now())) {
    return { ...publicState, status: "error", reason: "Profile preparation was interrupted or took too long. Refresh to try again; saved information has been kept." };
  }
  return publicState;
}

export async function prepareBrandCore(companyId: string, options: { refreshProfile?: boolean; tab?: Tab } = {}, progress: (reason: string) => Promise<void> = async () => {}): Promise<CoreStatus> {
  const { prepareBrandStage, enqueueBrandPreparation } = await import("./brand-enrichment");
  const company = (await pool.query("SELECT * FROM crm_companies WHERE id=$1 AND merged_into_id IS NULL", [companyId])).rows[0];
  if (!company) throw new Error("Company not found");
  if (company.ai_disabled) return { status: "needs_review", reason: "Automatic enrichment is disabled for this company." };
  const stopped = (run: any): CoreStatus | null => {
    if (run.reason === "daily_limit") return { status: "error", reason: "Today's research limit has been reached. Preparation can resume tomorrow; saved information is unchanged." };
    if (run.state.status === "ready") return null;
    return { status: run.state.status === "needs_review" ? "needs_review" : "error",
      reason: run.state.reason || (run.state.status === "running" ? "This section is already being prepared. Try refresh again shortly." : run.reason) || "Preparation did not finish. Refresh to retry." };
  };
  if (getBrandIdentity(company).status !== "verified") {
    await progress("Checking the company against its official website…");
    const failure = stopped(await prepareBrandStage(companyId, "identity", true));
    if (failure) return failure;
  }
  const current = (await pool.query("SELECT * FROM crm_companies WHERE id=$1", [companyId])).rows[0];
  const states = await readPreparationStates(pool, companyId, getBrandIdentity(current).fingerprint);
  const profile = states.find(stage => stage.stage === "profile");
  let updated: string[] = [];
  if (options.refreshProfile || profile?.status !== "ready" || !(Date.parse(profile.nextAttemptAt || "") > Date.now())
    || (current.ai_generated_fields?.brand_identity?.previousFactsNeedReview && !currentOfficialProfileEvidence(current))) {
    await progress("Checking the factual profile against the official website…");
    const run = await prepareBrandStage(companyId, "profile", true);
    const failure = stopped(run);
    if (failure) return failure;
    updated = run.result?.updated || [];
  }
  await progress("Preparing the BGP brief from the checked profile and CRM activity…");
  const brief = await prepareBrandStage(companyId, "brief", true, { tab: options.tab || "brand" });
  const failure = stopped(brief);
  if (failure) return { ...failure, updated };
  const { readPreparedBrandAiTake } = await import("./brand-ai-take");
  const take = await readPreparedBrandAiTake(companyId, options.tab || "brand");
  if (!take.text?.trim() || take.pending) return { status: "error", updated, reason: take.reason || "No BGP brief was produced. Refresh to retry." };
  await enqueueBrandPreparation(companyId).catch(error => console.warn("[brand-core-refresh] Optional sections could not be queued:", error.message));
  return { status: "done", updated };
}

export async function startBrandCoreRefresh(companyId: string, options: { refreshProfile?: boolean; tab?: Tab } = {}): Promise<CoreStatus> {
  const key = keyFor(companyId);
  const connection = await pool.connect();
  let locked = false;
  try {
    locked = (await connection.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [key])).rows[0]?.locked === true;
    if (!locked) {
      const existing = await readBrandCoreRefresh(companyId);
      connection.release();
      return { ...existing, status: "running", reason: "The profile and BGP brief are already being prepared…" };
    }
    const claim = randomUUID();
    const state: CoreStatus = { status: "running", tab: options.tab || "brand", startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), claim, reason: "Preparing the profile and BGP brief…" };
    await connection.query(`INSERT INTO system_settings(key,value,updated_at) VALUES ($1,$2::jsonb,now())
      ON CONFLICT(key) DO UPDATE SET value=$2::jsonb,updated_at=now()`, [key, JSON.stringify(state)]);
    const save = async (outcome: Partial<CoreStatus>) => {
      await connection.query("UPDATE system_settings SET value=$2::jsonb,updated_at=now() WHERE key=$1 AND value->>'claim'=$3",
        [key, JSON.stringify({ ...state, ...outcome }), claim]);
    };
    void (async () => {
      try {
        const result = await prepareBrandCore(companyId, options, reason => save({ reason }));
        await save({ ...result, reason: result.reason, finishedAt: new Date().toISOString() });
      } catch (error: any) {
        await save({ status: "error", reason: String(error?.message || "Profile preparation failed").slice(0, 500), finishedAt: new Date().toISOString() });
      } finally {
        await connection.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]).catch(() => {});
        connection.release();
      }
    })().catch(error => console.error("[brand-core-refresh] Could not finish refresh:", error.message));
    const { claim: _claim, ...publicState } = state;
    return publicState;
  } catch (error) {
    if (locked) await connection.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]).catch(() => {});
    connection.release();
    throw error;
  }
}
