// ─────────────────────────────────────────────────────────────────────────
// Brand site pipeline: where a brand is about to open, from two public
// sources that name the operator months before the press does.
//
//   Planning applications that name the brand (shopfront, signage, change of
//   use, fit-out), searched nationally through PlanIt (planit.org.uk: free,
//   no key, community-run, so one request per brand per run).
//
//   Job adverts by town ("General Manager, new opening, Reading";
//   "Acquisitions Surveyor") through the Adzuna jobs API. Needs
//   ADZUNA_APP_ID and ADZUNA_APP_KEY; without them nothing is asked and the
//   reply says configured: false.
//
// Which record or advert counts is decided in shared/brand-pipeline.ts.
// Register text and advert text are stored and shown as data, never acted on.
// Only the brand's own names go out in a request: never a person.
//
// Routes:
//   GET  /api/brand/:companyId/pipeline           — the summary
//   POST /api/brand/:companyId/pipeline/refresh   — BGP staff: read both sources now
// ─────────────────────────────────────────────────────────────────────────
import { watchedSql, WATCH_RECHECK_DAYS } from "./crm-watch";
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import {
  JOBS_WINDOW_DAYS, PLANNING_WINDOW_DAYS, TOO_COMMON_REASON,
  brandNames, jobRowsFrom, planningRowsFrom, planningSearchTerm, planningSiteKey, normText,
  type PipelineItem, type PipelineRow, type PipelineSummary,
} from "@shared/brand-pipeline";

export type { PipelineItem, PipelineSummary } from "@shared/brand-pipeline";

const router = Router();

const PLANIT_URL = "https://www.planit.org.uk/api/applics/json";
const ADZUNA_URL = "https://api.adzuna.com/v1/api/jobs/gb/search/1";
const USER_AGENT = "BGP-Dashboard/1.0 (brand pipeline)";
const TIMEOUT_MS = 20000;
const RECHECK_DAYS = 30;
const NOT_CONFIGURED = "not configured";

interface Db { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

// Everything outside this file that a run touches, so tests can stand in.
export interface PipelineDeps {
  fetch?: typeof fetch;
  db?: Db;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface RefreshResult {
  planning: { ok: boolean; reason?: string; found: number };
  jobs: { configured: boolean; ok: boolean; reason?: string; found: number };
}

function jobsKeys(env: Record<string, string | undefined>): { id: string; key: string } | null {
  const id = (env.ADZUNA_APP_ID || "").trim();
  const key = (env.ADZUNA_APP_KEY || "").trim();
  return id && key ? { id, key } : null;
}

function dayBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
}

// ─── Storage ─────────────────────────────────────────────────────────────

async function ensureOn(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS brand_pipeline_items (
    id serial primary key,
    brand_company_id varchar not null,
    kind text not null,
    item_key text not null,
    title text not null,
    town text,
    authority text,
    address text,
    item_date date,
    url text,
    detail jsonb,
    first_seen_at timestamp not null default now(),
    last_seen_at timestamp not null default now(),
    unique (brand_company_id, kind, item_key)
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS brand_pipeline_checks (
    brand_company_id varchar primary key,
    checked_at timestamp not null default now(),
    planning_status text,
    jobs_status text,
    jobs_total integer,
    jobs_by_town jsonb
  )`);
}

export async function ensurePipelineTable(): Promise<void> {
  await ensureOn(pool);
}

// Once per process when running on the real pool, so a manual refresh works
// before the boot statement has been wired in.
let tablesReady: Promise<void> | null = null;
async function ready(deps: PipelineDeps): Promise<void> {
  if (deps.db) return;
  if (!tablesReady) tablesReady = ensurePipelineTable().catch((e) => { tablesReady = null; throw e; });
  await tablesReady;
}

// Insert or bump last_seen_at. Rows are never deleted.
async function saveRows(db: Db, companyId: string, rows: PipelineRow[]): Promise<void> {
  if (!rows.length) return;
  const payload = rows.map((r) => ({
    kind: r.kind, item_key: r.key, title: r.title, town: r.town, authority: r.authority,
    address: r.address, item_date: r.date, url: r.url, detail: r.detail,
  }));
  await db.query(
    `INSERT INTO brand_pipeline_items (brand_company_id, kind, item_key, title, town, authority, address, item_date, url, detail)
     SELECT $1, x.kind, x.item_key, x.title, x.town, x.authority, x.address, x.item_date, x.url, x.detail
       FROM jsonb_to_recordset($2::jsonb)
         AS x(kind text, item_key text, title text, town text, authority text, address text, item_date date, url text, detail jsonb)
     ON CONFLICT (brand_company_id, kind, item_key) DO UPDATE
       SET title = EXCLUDED.title, town = EXCLUDED.town, authority = EXCLUDED.authority, address = EXCLUDED.address,
           item_date = EXCLUDED.item_date, url = EXCLUDED.url, detail = EXCLUDED.detail, last_seen_at = now()`,
    [companyId, JSON.stringify(payload)],
  );
}

// ─── The two sources ─────────────────────────────────────────────────────

function failure(err: any, secrets: string[] = []): string {
  let msg = String(err?.message || err || "failed").slice(0, 160);
  // A key must never reach a log line or a stored status.
  for (const s of secrets) if (s) msg = msg.split(s).join("***");
  return msg;
}

async function readPlanning(names: string[], deps: PipelineDeps): Promise<{ ok: boolean; reason?: string; rows: PipelineRow[]; asked: boolean }> {
  const term = planningSearchTerm(names);
  if ("skip" in term) return { ok: false, reason: term.skip, rows: [], asked: false };
  const now = deps.now?.() ?? new Date();
  const params = new URLSearchParams({
    search: term.search,
    pg_sz: "100",
    start_date: dayBefore(now, PLANNING_WINDOW_DAYS),
    select: "name,uid,address,postcode,description,start_date,area_name,app_type,app_state,link",
  });
  try {
    const res = await (deps.fetch ?? fetch)(`${PLANIT_URL}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, rows: [], asked: true };
    const data: any = await res.json();
    // No match comes back as an empty list with a null total.
    return { ok: true, rows: planningRowsFrom(data?.records, { names, now }), asked: true };
  } catch (err: any) {
    return { ok: false, reason: failure(err), rows: [], asked: true };
  }
}

interface JobsOutcome { configured: boolean; ok: boolean; reason?: string; rows: PipelineRow[]; total: number | null; byTown: { town: string; adverts: number }[]; asked: boolean }

async function readJobs(names: string[], deps: PipelineDeps): Promise<JobsOutcome> {
  const keys = jobsKeys(deps.env ?? process.env);
  if (!keys) return { configured: false, ok: false, reason: NOT_CONFIGURED, rows: [], total: null, byTown: [], asked: false };
  const none = { configured: true, ok: false, rows: [], total: null, byTown: [], asked: true };
  const now = deps.now?.() ?? new Date();
  const params = new URLSearchParams({
    app_id: keys.id,
    app_key: keys.key,
    results_per_page: "50",
    company: names[0].replace(/\s+/g, " ").trim().slice(0, 80),
    max_days_old: String(JOBS_WINDOW_DAYS),
    "content-type": "application/json",
  });
  try {
    const res = await (deps.fetch ?? fetch)(`${ADZUNA_URL}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return { ...none, reason: `HTTP ${res.status}` };
    const data: any = await res.json();
    if (!data || typeof data !== "object" || !Array.isArray(data.results)) return { ...none, reason: "unexpected reply" };
    const read = jobRowsFrom(data, { names, now });
    return { configured: true, ok: true, rows: read.rows, total: read.total, byTown: read.byTown, asked: true };
  } catch (err: any) {
    return { ...none, reason: failure(err, [keys.key, keys.id]) };
  }
}

// ─── One brand ───────────────────────────────────────────────────────────

async function refreshOne(companyId: string, deps: PipelineDeps): Promise<RefreshResult & { asked: boolean }> {
  const db = deps.db ?? pool;
  await ready(deps);
  const configured = !!jobsKeys(deps.env ?? process.env);
  const q = await db.query(`SELECT id, name, trading_entities FROM crm_companies WHERE id = $1`, [companyId]);
  const names = q.rows[0] ? brandNames(q.rows[0].name, q.rows[0].trading_entities, 5) : [];
  if (!names.length) {
    const reason = "brand not found";
    return { planning: { ok: false, reason, found: 0 }, jobs: { configured, ok: false, reason, found: 0 }, asked: false };
  }

  // Different hosts, so together: the staff refresh stays inside one timeout.
  const [planning, jobs] = await Promise.all([readPlanning(names, deps), readJobs(names, deps)]);

  await saveRows(db, companyId, [...planning.rows, ...jobs.rows]);
  const planningStatus = planning.ok ? "ok" : planning.reason === TOO_COMMON_REASON ? `skipped: ${planning.reason}` : `failed: ${planning.reason}`;
  const jobsStatus = jobs.ok ? "ok" : !jobs.configured ? NOT_CONFIGURED : `failed: ${jobs.reason}`;
  // A failed jobs read keeps the figures from the last one that worked.
  await db.query(
    `INSERT INTO brand_pipeline_checks (brand_company_id, checked_at, planning_status, jobs_status, jobs_total, jobs_by_town)
     VALUES ($1, now(), $2, $3, $4, $5::jsonb)
     ON CONFLICT (brand_company_id) DO UPDATE
       SET checked_at = now(), planning_status = EXCLUDED.planning_status, jobs_status = EXCLUDED.jobs_status,
           jobs_total = CASE WHEN EXCLUDED.jobs_status = 'ok' THEN EXCLUDED.jobs_total ELSE brand_pipeline_checks.jobs_total END,
           jobs_by_town = CASE WHEN EXCLUDED.jobs_status = 'ok' THEN EXCLUDED.jobs_by_town ELSE brand_pipeline_checks.jobs_by_town END`,
    [companyId, planningStatus, jobsStatus, jobs.ok ? jobs.total : null, jobs.ok ? JSON.stringify(jobs.byTown.slice(0, 40)) : null],
  );

  return {
    planning: { ok: planning.ok, ...(planning.reason ? { reason: planning.reason } : {}), found: planning.rows.length },
    jobs: { configured: jobs.configured, ok: jobs.ok, ...(jobs.reason ? { reason: jobs.reason } : {}), found: jobs.rows.length },
    asked: planning.asked || jobs.asked,
  };
}

export async function refreshBrandPipeline(companyId: string, deps: PipelineDeps = {}): Promise<RefreshResult> {
  const { asked: _asked, ...result } = await refreshOne(companyId, deps);
  return result;
}

// ─── Reading it back ─────────────────────────────────────────────────────

const missingTable = (e: any) => e?.code === "42P01";

function toItem(r: any): PipelineItem {
  const item: PipelineItem = {
    kind: r.kind, title: r.title, town: r.town ?? null, authority: r.authority ?? null,
    address: r.address ?? null, date: r.item_date ?? null, url: r.url ?? null,
  };
  if (r.kind === "planning") item.state = r.state ?? null;
  return item;
}

function townCounts(v: unknown): { town: string; adverts: number }[] {
  const out = (Array.isArray(v) ? v : [])
    .filter((x: any) => x && typeof x.town === "string" && Number.isFinite(Number(x.adverts)))
    .map((x: any) => ({ town: x.town as string, adverts: Number(x.adverts) }));
  return out.sort((a, b) => b.adverts - a.adverts || a.town.localeCompare(b.town)).slice(0, 12);
}

const ITEM_COLUMNS = `kind, title, town, authority, address, to_char(item_date, 'YYYY-MM-DD') AS item_date, url, detail->>'state' AS state`;

export async function pipelineSummary(companyId: string, deps: PipelineDeps = {}): Promise<PipelineSummary> {
  const db = deps.db ?? pool;
  const now = deps.now?.() ?? new Date();
  const summary: PipelineSummary = {
    checkedAt: null, planning: [], jobs: [], jobsConfigured: !!jobsKeys(deps.env ?? process.env),
    jobsTotal: null, jobTowns: [], planningSkipped: null,
  };
  try {
    const [planning, jobs, check] = await Promise.all([
      db.query(
        `SELECT ${ITEM_COLUMNS} FROM brand_pipeline_items
          WHERE brand_company_id = $1 AND kind = 'planning' AND item_date >= $2::date
          ORDER BY item_date DESC, id DESC LIMIT 40`,
        [companyId, dayBefore(now, PLANNING_WINDOW_DAYS)]),
      db.query(
        `SELECT ${ITEM_COLUMNS} FROM brand_pipeline_items
          WHERE brand_company_id = $1 AND kind IN ('job_new_opening', 'job_property_role')
            AND COALESCE(item_date, last_seen_at::date) >= $2::date
          ORDER BY COALESCE(item_date, last_seen_at::date) DESC, id DESC LIMIT 40`,
        [companyId, dayBefore(now, JOBS_WINDOW_DAYS)]),
      db.query(
        `SELECT checked_at, planning_status, jobs_status, jobs_total, jobs_by_town
           FROM brand_pipeline_checks WHERE brand_company_id = $1`,
        [companyId]),
    ]);
    summary.planning = planning.rows.map(toItem);
    summary.jobs = jobs.rows.map(toItem);
    const c = check.rows[0];
    if (c) {
      const at = c.checked_at instanceof Date ? c.checked_at : new Date(c.checked_at);
      summary.checkedAt = Number.isNaN(at.getTime()) ? null : at.toISOString();
      summary.jobsTotal = c.jobs_total == null ? null : Number(c.jobs_total);
      summary.jobTowns = townCounts(c.jobs_by_town);
      const skipped = /^skipped:\s*(.+)$/.exec(String(c.planning_status || ""));
      summary.planningSkipped = skipped ? skipped[1] : null;
    }
  } catch (e: any) {
    // Before the tables exist there is simply nothing to show.
    if (!missingTable(e)) throw e;
  }
  return summary;
}

export interface PipelineEvidence {
  planning12m: number;      // distinct sites with an application in the last 12 months
  planning90d: number;      // of those, sites with one in the last 90 days
  planningTowns: string[];  // newest first, at most 12
  newOpeningJobs: number;   // distinct new-opening adverts in the last 60 days (a repost counts once)
  propertyRoles: number;    // distinct property and acquisitions adverts in the last 60 days
  jobTowns: string[];       // towns of the new-opening adverts, newest first, at most 12
}

// For the expansion score. Never throws: no tables, no rows or a failed read
// all read as "no evidence".
export async function pipelineEvidence(companyId: string, deps: PipelineDeps = {}): Promise<PipelineEvidence> {
  const none: PipelineEvidence = { planning12m: 0, planning90d: 0, planningTowns: [], newOpeningJobs: 0, propertyRoles: 0, jobTowns: [] };
  try {
    const db = deps.db ?? pool;
    const now = deps.now?.() ?? new Date();
    const q = await db.query(
      `SELECT kind, title, town, authority, address, to_char(item_date, 'YYYY-MM-DD') AS item_date, detail->>'postcode' AS postcode
         FROM brand_pipeline_items
        WHERE brand_company_id = $1
          AND ((kind = 'planning' AND item_date >= $2::date)
            OR (kind IN ('job_new_opening', 'job_property_role') AND COALESCE(item_date, last_seen_at::date) >= $3::date))
        ORDER BY item_date DESC NULLS LAST, id DESC
        LIMIT 1000`,
      [companyId, dayBefore(now, PLANNING_WINDOW_DAYS), dayBefore(now, JOBS_WINDOW_DAYS)]);
    const recent = dayBefore(now, 90);
    const sites = new Set<string>();
    const sites90 = new Set<string>();
    const planningTowns: string[] = [];
    const openings = new Set<string>();
    const roles = new Set<string>();
    const jobTowns: string[] = [];
    const addTown = (list: string[], town: unknown) => {
      if (typeof town === "string" && town.trim() && !list.some((t) => t.toLowerCase() === town.trim().toLowerCase())) list.push(town.trim());
    };
    for (const r of q.rows) {
      if (r.kind === "planning") {
        // Several applications at one address are one site.
        const site = planningSiteKey(r.address, r.postcode) || `${r.authority}|${r.title}`;
        sites.add(site);
        if (r.item_date && r.item_date >= recent) sites90.add(site);
        addTown(planningTowns, r.town || r.authority);
      } else if (r.kind === "job_new_opening") {
        openings.add(`${normText(r.title)}|${normText(r.town)}`);
        addTown(jobTowns, r.town);
      } else if (r.kind === "job_property_role") {
        roles.add(`${normText(r.title)}|${normText(r.town)}`);
      }
    }
    return {
      planning12m: sites.size, planning90d: sites90.size, planningTowns: planningTowns.slice(0, 12),
      newOpeningJobs: openings.size, propertyRoles: roles.size, jobTowns: jobTowns.slice(0, 12),
    };
  } catch {
    return none;
  }
}

// ─── Nightly ─────────────────────────────────────────────────────────────

// Tenant brands not checked in the last 30 days: never-checked first, then
// the oldest. A read that failed is tried again after 3 days, and once the
// jobs keys arrive the brands checked without them come round again.
export async function nightlyPipelinePass(cap = 60, deps: PipelineDeps = {}): Promise<{ attempted: number; planningFound: number; jobsFound: number; failed: number }> {
  const db = deps.db ?? pool;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const out = { attempted: 0, planningFound: 0, jobsFound: 0, failed: 0 };
  try {
    await ready(deps);
    const limit = Math.max(0, Math.min(500, Math.floor(Number(cap) || 0)));
    if (!limit) return out;
    const q = await db.query(
      `SELECT c.id
         FROM crm_companies c
         LEFT JOIN brand_pipeline_checks k ON k.brand_company_id = c.id
        WHERE c.company_type ILIKE 'tenant%' AND c.merged_into_id IS NULL AND c.archived_at IS NULL
          AND (k.checked_at IS NULL
            OR k.checked_at < now() - interval '${RECHECK_DAYS} days'
            OR (${watchedSql("c")} AND k.checked_at < now() - interval '${WATCH_RECHECK_DAYS} days')
            OR ((k.planning_status LIKE 'failed%' OR k.jobs_status LIKE 'failed%') AND k.checked_at < now() - interval '3 days')
            OR ($2::boolean AND k.jobs_status = '${NOT_CONFIGURED}'))
        ORDER BY ${watchedSql("c")} DESC, k.checked_at ASC NULLS FIRST, c.id
        LIMIT $1`,
      [limit, !!jobsKeys(deps.env ?? process.env)]);
    let pause = false;
    for (const row of q.rows) {
      // Polite to a community-run register: 2s between brands that asked it anything.
      if (pause) await sleep(2000);
      out.attempted++;
      try {
        const r = await refreshOne(String(row.id), deps);
        pause = r.asked;
        out.planningFound += r.planning.found;
        out.jobsFound += r.jobs.found;
        const planningFailed = !r.planning.ok && r.planning.reason !== TOO_COMMON_REASON;
        const jobsFailed = r.jobs.configured && !r.jobs.ok;
        if (planningFailed || jobsFailed) out.failed++;
      } catch (e: any) {
        // One brand never stops the run.
        pause = true;
        out.failed++;
        console.warn(`[brand-pipeline] ${row.id}: ${failure(e)}`);
      }
    }
  } catch (e: any) {
    console.warn(`[brand-pipeline] nightly pass stopped: ${failure(e)}`);
  }
  console.log(`[brand-pipeline] nightly pass: ${out.attempted} brands, ${out.planningFound} planning records, ${out.jobsFound} job adverts, ${out.failed} failed`);
  return out;
}

// ─── Routes ──────────────────────────────────────────────────────────────

// Public-register data: any signed-in login may read it.
router.get("/api/brand/:companyId/pipeline", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await pipelineSummary(String(req.params.companyId)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const refreshing = new Map<string, Promise<RefreshResult>>();

router.post("/api/brand/:companyId/pipeline/refresh", requireAuth, async (req: Request, res: Response) => {
  try {
    // BGP staff only: a client login, or staff viewing as one, does not spend requests.
    const { resolveCompanyScope } = await import("./company-scope");
    if (await resolveCompanyScope(req)) return res.status(403).json({ error: "BGP staff only" });
    const companyId = String(req.params.companyId);
    // A second press while one is running waits for the first.
    let job = refreshing.get(companyId);
    if (!job) {
      job = refreshBrandPipeline(companyId).finally(() => refreshing.delete(companyId));
      refreshing.set(companyId, job);
    }
    const refresh = await job;
    res.json({ ...(await pipelineSummary(companyId)), refresh });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
