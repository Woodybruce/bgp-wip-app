// Directory-wide official-website sweep.
//
// Woody, 2026-09-23: "Lets just find the correct websites for each brand and
// then give me a list of those that are genuinely unknown." The per-brand
// preparation queue verifies ~40 identities a day, so 1,929 brands would
// take weeks and most had never been checked. This sweep walks every tracked
// brand without a verified website once: a saved website is verified (moved
// sites and dead domains are handled), a missing one is discovered — every
// write still needs the same strict official-site proof. The outcome of each
// brand is stamped on the record, so the unknown list is simply the brands
// that didn't prove out, and a restart resumes where it stopped.
import { pool } from "./db";
import { getBrandIdentity } from "./brand-identity";
import { discoverAndVerifyBrandWebsite, hasAnySavedWebsite, isDeadWebsiteError, verifyBrandIdentityFromOfficialSite } from "./brand-identity-verification";

const KEY = "brand-website-sweep";
const CONCURRENCY = 3;

type SweepState = { status: "running" | "done" | "stopped"; startedAt: string; finishedAt?: string; processed: number; verified: number; unknown: number; total: number; lastError?: string };

let active: Promise<void> | null = null;

const BRAND_FILTER = `c.merged_into_id IS NULL AND c.ai_disabled IS DISTINCT FROM TRUE AND COALESCE(TRIM(c.name),'') <> ''
  AND (c.company_type ILIKE 'tenant%' OR c.company_type ILIKE '%brand%' OR c.company_type ILIKE '%landlord%' OR c.company_type ILIKE '%client%')
  AND COALESCE(c.ai_generated_fields->'brand_identity'->>'status','') <> 'verified'`;

async function readState(): Promise<SweepState | null> {
  return (await pool.query("SELECT value FROM system_settings WHERE key=$1", [KEY])).rows[0]?.value || null;
}
async function writeState(state: SweepState) {
  await pool.query(`INSERT INTO system_settings(key,value,updated_at) VALUES ($1,$2::jsonb,now()) ON CONFLICT(key) DO UPDATE SET value=$2::jsonb,updated_at=now()`, [KEY, JSON.stringify(state)]);
}

async function stamp(companyId: string, check: Record<string, unknown>) {
  await pool.query(`UPDATE crm_companies SET ai_generated_fields = jsonb_set(COALESCE(ai_generated_fields,'{}'::jsonb), '{website_check}', $2::jsonb, true) WHERE id=$1`,
    [companyId, JSON.stringify({ ...check, at: new Date().toISOString() })]);
}

async function checkOne(companyId: string): Promise<"verified" | "unknown"> {
  const company = (await pool.query("SELECT * FROM crm_companies WHERE id=$1", [companyId])).rows[0];
  if (!company) return "unknown";
  if (getBrandIdentity(company).status === "verified") { await stamp(companyId, { status: "verified", domain: getBrandIdentity(company).domain }); return "verified"; }
  let result: { status: string; reason?: string; domain?: string; verdict?: unknown } = { status: "needs_review" };
  try {
    if (!hasAnySavedWebsite(company)) result = await discoverAndVerifyBrandWebsite(pool, company);
    else {
      try {
        result = await verifyBrandIdentityFromOfficialSite(pool, company);
        const verdict = (result as any).verdict;
        // A saved site that loads but doesn't prove out may simply be the
        // wrong site — search for the real one before giving up.
        if (result.status !== "ready") {
          const found = await discoverAndVerifyBrandWebsite(pool, company, { replaceDeadWebsite: true });
          if (found.status === "ready") result = found;
          else if (verdict) result = { ...result, verdict };
        }
      } catch (error: any) {
        result = await discoverAndVerifyBrandWebsite(pool, company, { replaceDeadWebsite: true });
        if (result.status !== "ready") result = { ...result, reason: isDeadWebsiteError(error) ? "The saved website no longer exists and no replacement could be proven" : (result.reason || String(error?.message || "").slice(0, 160)) };
      }
    }
  } catch (error: any) {
    result = { status: "error", reason: String(error?.message || "check failed").slice(0, 200) };
  }
  const after = (await pool.query("SELECT * FROM crm_companies WHERE id=$1", [companyId])).rows[0];
  const verified = !!after && getBrandIdentity(after).status === "verified";
  await stamp(companyId, verified
    ? { status: "verified", domain: getBrandIdentity(after).domain }
    : { status: "unknown", reason: result.reason || "No official website could be proven", suggestion: after?.ai_generated_fields?.website_suggestion?.domain || null, verdict: result.verdict || null });
  return verified ? "verified" : "unknown";
}

async function run(state: SweepState) {
  const since = state.startedAt;
  const next = async (): Promise<string | null> => {
    const row = (await pool.query(`SELECT c.id FROM crm_companies c WHERE ${BRAND_FILTER}
        AND COALESCE(c.ai_generated_fields->'website_check'->>'at','') < $1
        AND NOT (c.id = ANY($2::text[]))
      ORDER BY (c.company_type ILIKE 'tenant%') DESC, c.name LIMIT 1`, [since, [...inFlight]])).rows[0];
    return row?.id || null;
  };
  const inFlight = new Set<string>();
  const worker = async () => {
    while (true) {
      const current = await readState();
      if (!current || current.status !== "running" || current.startedAt !== since) return;
      const id = await next();
      if (!id) return;
      inFlight.add(id);
      try {
        const outcome = await checkOne(id);
        state.processed++; if (outcome === "verified") state.verified++; else state.unknown++;
      } catch (error: any) {
        state.lastError = String(error?.message || error).slice(0, 200);
        await stamp(id, { status: "unknown", reason: state.lastError }).catch(() => {});
        state.processed++; state.unknown++;
      } finally { inFlight.delete(id); }
      if (state.processed % 10 === 0) await writeState(state).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const current = await readState();
  if (current?.status === "running" && current.startedAt === since) {
    await writeState({ ...state, status: "done", finishedAt: new Date().toISOString() });
    console.log(`[website-sweep] done: ${state.verified} verified, ${state.unknown} unknown of ${state.processed}`);
  }
}

/** Start (or resume) the sweep. Returns the current state immediately. */
export async function startWebsiteSweep(opts: { restart?: boolean } = {}): Promise<SweepState> {
  let state = await readState();
  if (!state || opts.restart || state.status !== "running") {
    const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM crm_companies c WHERE ${BRAND_FILTER}`)).rows[0].n;
    // A fresh sweep re-checks unknowns from earlier sweeps too.
    state = { status: "running", startedAt: new Date().toISOString(), processed: 0, verified: 0, unknown: 0, total };
    await writeState(state);
  }
  if (!active) {
    const s = state;
    active = run(s).catch(error => console.error("[website-sweep] stopped:", error?.message)).finally(() => { active = null; });
  }
  return state;
}

/** Resume a sweep interrupted by a restart/deploy. Called at boot. */
export async function resumeWebsiteSweep(): Promise<void> {
  const state = await readState().catch(() => null);
  if (state?.status === "running" && !active) {
    console.log(`[website-sweep] resuming (${state.processed}/${state.total})`);
    active = run(state).catch(error => console.error("[website-sweep] stopped:", error?.message)).finally(() => { active = null; });
  }
}

export async function stopWebsiteSweep(): Promise<void> {
  const state = await readState();
  if (state?.status === "running") await writeState({ ...state, status: "stopped", finishedAt: new Date().toISOString() });
}

/** Progress plus the genuinely-unknown list (brands the sweep checked and could not prove). */
export async function readWebsiteSweep(): Promise<any> {
  const state = await readState();
  const unknown = (await pool.query(`SELECT c.id, c.name, c.company_type, COALESCE(c.domain, c.domain_url, c.website) AS saved_website,
        c.ai_generated_fields->'website_check'->>'reason' AS reason, c.ai_generated_fields->'website_check'->>'suggestion' AS suggestion,
        c.ai_generated_fields->'website_check'->>'at' AS checked_at, c.ai_generated_fields->'website_check'->'verdict' AS verdict
      FROM crm_companies c WHERE ${BRAND_FILTER} AND c.ai_generated_fields->'website_check'->>'status' = 'unknown'
      ORDER BY (c.company_type ILIKE 'tenant%') DESC, c.name`)).rows;
  const verifiedCount = (await pool.query(`SELECT COUNT(*)::int AS n FROM crm_companies c WHERE c.merged_into_id IS NULL AND c.ai_generated_fields->'brand_identity'->>'status' = 'verified'`)).rows[0].n;
  return { sweep: state, verifiedBrands: verifiedCount, unknownCount: unknown.length, unknown };
}
