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
// PlanIt limits how fast it may be asked: every request takes its turn
// (planitTurn), and its Retry-After is honoured.
//
// Routes:
//   GET  /api/brand/:companyId/pipeline           — the summary
//   POST /api/brand/:companyId/pipeline/refresh   — BGP staff: read both sources now
//   GET  /api/admin/brand-pipeline/planning-sweep — admins: the twelve-month
//                                                    planning check and what it found
//   POST /api/admin/brand-pipeline/planning-sweep — admins: start or stop it
// ─────────────────────────────────────────────────────────────────────────
import { randomUUID } from "node:crypto";
import { watchedSql, WATCH_RECHECK_DAYS } from "./crm-watch";
import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "./auth";
import { pool } from "./db";
import {
  JOBS_WINDOW_DAYS, NEVER_AN_OCCUPIER_TYPES, PLANNING_WINDOW_DAYS, TOO_COMMON_REASON,
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
// Planning checked on its own (the twelve-month check); the job adverts not yet.
const NOT_CHECKED = "not checked";

interface Db { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

// Everything outside this file that a run touches, so tests can stand in.
export interface PipelineDeps {
  fetch?: typeof fetch;
  db?: Db;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  planitGate?: PlanitGate;
}

export interface RefreshResult {
  planning: { ok: boolean; reason?: string; found: number; limited?: boolean };
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

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── PlanIt's pace ───────────────────────────────────────────────────────
// PlanIt's API page: "access to the API is rate limited", and past the limit
// it answers 429 with a Retry-After. On 16 and 17 November 2026 the nightly
// run asked about 26 times a minute and only the first dozen or so brands
// each night got an answer; the rest were refused, and the card read a
// refusal as "none found". Every PlanIt request in the process now books a
// turn at least PLANIT_GAP_MS after the last (37 searches one every six
// seconds went through untroubled on 18 November), and a Retry-After pushes
// every later turn back.
export const PLANIT_GAP_MS = 6000;
// A 429 with no Retry-After is waited out this long.
const PLANIT_DEFAULT_RETRY_MS = 60_000;
// How long each caller waits for PlanIt (its turn, and a Retry-After): a
// person pressing Check again, the nightly run, the twelve-month check.
const PLANIT_REFRESH_WAIT_MS = 15_000;
const PLANIT_NIGHTLY_WAIT_MS = 5 * 60_000;
const PLANIT_SWEEP_WAIT_MS = 15 * 60_000;

export interface PlanitGate { gapMs: number; next: number; clock: () => number }
export function createPlanitGate(gapMs = PLANIT_GAP_MS, clock: () => number = Date.now): PlanitGate {
  return { gapMs, next: 0, clock };
}
const processGate = createPlanitGate();

// Books the next free turn and waits for it; a wait longer than maxWaitMs is
// not booked and the caller is told how long it would have been.
async function planitTurn(gate: PlanitGate, sleep: (ms: number) => Promise<void>, maxWaitMs: number): Promise<{ go: true } | { go: false; waitMs: number }> {
  const now = gate.clock();
  const slot = Math.max(now, gate.next);
  if (slot - now > maxWaitMs) return { go: false, waitMs: slot - now };
  gate.next = slot + gate.gapMs;
  if (slot > now) await sleep(slot - now);
  return { go: true };
}

// Retry-After as seconds or an HTTP date.
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

const minutesText = (ms: number) => { const m = Math.max(1, Math.ceil(ms / 60_000)); return `${m} minute${m === 1 ? "" : "s"}`; };

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

interface PlanningOutcome { ok: boolean; reason?: string; rows: PipelineRow[]; asked: boolean; limited?: boolean }

async function readPlanning(names: string[], deps: PipelineDeps, maxWaitMs = PLANIT_REFRESH_WAIT_MS): Promise<PlanningOutcome> {
  const term = planningSearchTerm(names);
  if ("skip" in term) return { ok: false, reason: term.skip, rows: [], asked: false };
  const now = deps.now?.() ?? new Date();
  const gate = deps.planitGate ?? processGate;
  const sleep = deps.sleep ?? realSleep;
  const params = new URLSearchParams({
    search: term.search,
    pg_sz: "100",
    start_date: dayBefore(now, PLANNING_WINDOW_DAYS),
    select: "name,uid,address,postcode,description,start_date,area_name,app_type,app_state,link",
  });
  let asked = false;
  const limited = (waitMs: number): PlanningOutcome =>
    ({ ok: false, reason: `PlanIt asked us to slow down; try again in ${minutesText(waitMs)}`, rows: [], asked, limited: true });
  try {
    // A 429 is waited out (as long as this caller waits) and asked once more.
    for (let attempt = 0; attempt < 2; attempt++) {
      const turn = await planitTurn(gate, sleep, maxWaitMs);
      if (!turn.go) return limited(turn.waitMs);
      asked = true;
      const res = await (deps.fetch ?? fetch)(`${PLANIT_URL}?${params}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (res.status === 429) {
        const wait = retryAfterMs((res as any).headers?.get?.("retry-after"), gate.clock()) ?? PLANIT_DEFAULT_RETRY_MS;
        gate.next = Math.max(gate.next, gate.clock() + wait);
        continue;
      }
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, rows: [], asked };
      const data: any = await res.json();
      // No match comes back as an empty list with a null total.
      return { ok: true, rows: planningRowsFrom(data?.records, { names, now }), asked };
    }
    return limited(gate.next - gate.clock());
  } catch (err: any) {
    return { ok: false, reason: failure(err), rows: [], asked: true };
  }
}

interface JobsOutcome { configured: boolean; ok: boolean; reason?: string; rows: PipelineRow[]; total: number | null; byTown: { town: string; adverts: number }[]; asked: boolean }

// Adzuna says why it refused a request in the body ({ exception, display }).
// The words go into the stored status, never a key.
async function adzunaRefusal(res: { status: number; json(): Promise<any> }, secrets: string[]): Promise<string> {
  let words = "";
  try {
    const body: any = await res.json();
    words = String(body?.display || body?.exception || "").replace(/\s+/g, " ").trim().slice(0, 120);
  } catch { /* no readable body */ }
  for (const s of secrets) if (s) words = words.split(s).join("***");
  return `HTTP ${res.status}${words ? `: ${words}` : ""}`;
}

async function readJobs(names: string[], deps: PipelineDeps): Promise<JobsOutcome> {
  const keys = jobsKeys(deps.env ?? process.env);
  if (!keys) return { configured: false, ok: false, reason: NOT_CONFIGURED, rows: [], total: null, byTown: [], asked: false };
  const none = { configured: true, ok: false, rows: [], total: null, byTown: [], asked: true };
  const now = deps.now?.() ?? new Date();
  // The brand's name is asked as a phrase and only the adverts the brand
  // itself placed are kept (advertCompanyMatches). Adzuna's company filter is
  // not used: it takes only the employer names Adzuna knows (its documentation
  // calls them canonical and publishes no list) and refused every brand with a
  // 400 once the keys were set (seen live on 18 November 2026). One request a
  // brand; a refusal is stored with Adzuna's own words.
  const params = new URLSearchParams({
    app_id: keys.id,
    app_key: keys.key,
    results_per_page: "50",
    what_phrase: names[0].replace(/\s+/g, " ").trim().slice(0, 80),
    max_days_old: String(JOBS_WINDOW_DAYS),
    "content-type": "application/json",
  });
  try {
    const res = await (deps.fetch ?? fetch)(`${ADZUNA_URL}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return { ...none, reason: await adzunaRefusal(res, [keys.key, keys.id]) };
    const data: any = await res.json();
    if (!data || typeof data !== "object" || !Array.isArray(data.results)) return { ...none, reason: "unexpected reply" };
    const read = jobRowsFrom(data, { names, now });
    return { configured: true, ok: true, rows: read.rows, total: read.total, byTown: read.byTown, asked: true };
  } catch (err: any) {
    return { ...none, reason: failure(err, [keys.key, keys.id]) };
  }
}

// ─── One brand ───────────────────────────────────────────────────────────

const planningStatusOf = (p: PlanningOutcome) =>
  p.ok ? "ok" : p.reason === TOO_COMMON_REASON ? `skipped: ${p.reason}` : `failed: ${p.reason}`;

async function refreshOne(companyId: string, deps: PipelineDeps, planitWaitMs = PLANIT_REFRESH_WAIT_MS): Promise<RefreshResult & { asked: boolean }> {
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
  const [planning, jobs] = await Promise.all([readPlanning(names, deps, planitWaitMs), readJobs(names, deps)]);

  await saveRows(db, companyId, [...planning.rows, ...jobs.rows]);
  const planningStatus = planningStatusOf(planning);
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
    planning: { ok: planning.ok, ...(planning.reason ? { reason: planning.reason } : {}), found: planning.rows.length, ...(planning.limited ? { limited: true } : {}) },
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
// A tree or telecoms application stored before 18 November 2026 (one counted
// for The Light) is left out by both readers, as a new check leaves it out.
const occupierTypeSql = (table = "") => `lower(trim(COALESCE(${table ? `${table}.` : ""}detail->>'type', ''))) NOT IN (${NEVER_AN_OCCUPIER_TYPES.map((t) => `'${t}'`).join(", ")})`;
const OCCUPIER_TYPE_SQL = occupierTypeSql();

export async function pipelineSummary(companyId: string, deps: PipelineDeps = {}): Promise<PipelineSummary> {
  const db = deps.db ?? pool;
  const now = deps.now?.() ?? new Date();
  const summary: PipelineSummary = {
    checkedAt: null, planning: [], jobs: [], jobsConfigured: !!jobsKeys(deps.env ?? process.env),
    jobsTotal: null, jobTowns: [], planningSkipped: null, planningProblem: null, jobsProblem: null, jobsUnchecked: false,
  };
  try {
    const [planning, jobs, check] = await Promise.all([
      db.query(
        `SELECT ${ITEM_COLUMNS} FROM brand_pipeline_items
          WHERE brand_company_id = $1 AND kind = 'planning' AND item_date >= $2::date AND ${OCCUPIER_TYPE_SQL}
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
      // A check that failed is said as such, never as "none found".
      const failedAs = (status: unknown) => /^failed:\s*(.+)$/.exec(String(status || ""))?.[1] ?? null;
      summary.planningProblem = failedAs(c.planning_status);
      summary.jobsProblem = failedAs(c.jobs_status);
      summary.jobsUnchecked = c.jobs_status === NOT_CHECKED;
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
          AND ((kind = 'planning' AND item_date >= $2::date AND ${OCCUPIER_TYPE_SQL})
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
export async function nightlyPipelinePass(cap = 60, deps: PipelineDeps = {}): Promise<{ attempted: number; planningFound: number; jobsFound: number; failed: number; stoppedEarly?: string }> {
  const db = deps.db ?? pool;
  const sleep = deps.sleep ?? realSleep;
  const out: { attempted: number; planningFound: number; jobsFound: number; failed: number; stoppedEarly?: string } = { attempted: 0, planningFound: 0, jobsFound: 0, failed: 0 };
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
            OR ($2::boolean AND k.jobs_status IN ('${NOT_CONFIGURED}', '${NOT_CHECKED}')))
        ORDER BY ${watchedSql("c")} DESC, k.checked_at ASC NULLS FIRST, c.id
        LIMIT $1`,
      [limit, !!jobsKeys(deps.env ?? process.env)]);
    let pause = false;
    for (const row of q.rows) {
      // Polite to a community-run register: 2s between brands that asked it anything.
      if (pause) await sleep(2000);
      out.attempted++;
      try {
        const r = await refreshOne(String(row.id), deps, PLANIT_NIGHTLY_WAIT_MS);
        pause = r.asked;
        out.planningFound += r.planning.found;
        out.jobsFound += r.jobs.found;
        const planningFailed = !r.planning.ok && r.planning.reason !== TOO_COMMON_REASON;
        const jobsFailed = r.jobs.configured && !r.jobs.ok;
        if (planningFailed || jobsFailed) out.failed++;
        // PlanIt still refusing after a wait: the rest stay due for tomorrow,
        // never stored as failed checks.
        if (r.planning.limited) { out.stoppedEarly = r.planning.reason ?? "PlanIt asked us to slow down"; break; }
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
  console.log(`[brand-pipeline] nightly pass: ${out.attempted} brands, ${out.planningFound} planning records, ${out.jobsFound} job adverts, ${out.failed} failed${out.stoppedEarly ? ` (stopped early: ${out.stoppedEarly})` : ""}`);
  return out;
}

// ─── Twelve months of planning for every brand ──────────────────────────
// Woody, 2026-11-18: "can we do planning for the last 12 months?" The
// nightly run reaches 60 brands a night, so the tenant brands take about 46
// nights to go round. An admin starts this run instead: every tenant brand,
// planning only (no job adverts, so Adzuna's allowance is not touched), at
// PlanIt's pace, in id order from a saved place, so a deploy carries on
// where it stopped. A brand it reaches gets its records and planning status
// as the nightly check saves them; its job adverts are marked "not checked",
// which brings the brand round to the nightly run.

const SWEEP_KEY = "brand-planning-sweep";
const TENANT_BRANDS = `c.company_type ILIKE 'tenant%' AND c.merged_into_id IS NULL AND c.archived_at IS NULL`;

export interface PlanningSweepState {
  status: "running" | "done" | "stopped";
  runId: string;
  startedAt: string;
  startedBy: string | null;
  finishedAt: string | null;
  afterId: string | null;
  total: number;
  processed: number;
  withRecords: number;
  records: number;
  skipped: number;
  failed: number;
  lastError: string | null;
}

async function readSweepState(db: Db): Promise<PlanningSweepState | null> {
  return (await db.query(`SELECT value FROM system_settings WHERE key = $1`, [SWEEP_KEY])).rows[0]?.value ?? null;
}

async function writeSweepState(db: Db, state: PlanningSweepState): Promise<void> {
  await db.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [SWEEP_KEY, JSON.stringify(state)]);
}

// Progress is written only while this run is still the one running, so a
// Stop pressed between two brands is never written over.
async function writeSweepProgress(db: Db, state: PlanningSweepState): Promise<boolean> {
  const r: any = await db.query(
    `UPDATE system_settings SET value = $2::jsonb, updated_at = now()
      WHERE key = $1 AND value->>'status' = 'running' AND value->>'runId' = $3
      RETURNING key`,
    [SWEEP_KEY, JSON.stringify(state), state.runId]);
  return (r.rows?.length ?? 0) > 0;
}

async function runPlanningSweep(state: PlanningSweepState, deps: PipelineDeps): Promise<void> {
  const db = deps.db ?? pool;
  await ready(deps);
  const jobsStatus = jobsKeys(deps.env ?? process.env) ? NOT_CHECKED : NOT_CONFIGURED;
  while (true) {
    const current = await readSweepState(db);
    if (!current || current.status !== "running" || current.runId !== state.runId) return;
    const row = (await db.query(
      `SELECT c.id, c.name, c.trading_entities FROM crm_companies c
        WHERE ${TENANT_BRANDS} AND ($1::text IS NULL OR c.id > $1)
        ORDER BY c.id LIMIT 1`,
      [state.afterId])).rows[0];
    if (!row) {
      const done = { ...state, status: "done" as const, finishedAt: (deps.now?.() ?? new Date()).toISOString() };
      if (await writeSweepProgress(db, done)) {
        console.log(`[brand-pipeline] twelve-month planning check done: ${done.processed} brands, ${done.withRecords} with applications`);
      }
      return;
    }
    const names = brandNames(row.name, row.trading_entities, 5);
    const outcome: PlanningOutcome = names.length
      ? await readPlanning(names, deps, PLANIT_SWEEP_WAIT_MS)
      : { ok: false, reason: "brand not found", rows: [], asked: false };
    if (outcome.limited) {
      // PlanIt still refusing after a wait: pause, keeping the place, so
      // Start carries on from this brand.
      await writeSweepProgress(db, { ...state, status: "stopped", finishedAt: (deps.now?.() ?? new Date()).toISOString(), lastError: outcome.reason ?? null });
      console.warn(`[brand-pipeline] twelve-month planning check paused: ${outcome.reason}`);
      return;
    }
    await saveRows(db, String(row.id), outcome.rows);
    await db.query(
      `INSERT INTO brand_pipeline_checks (brand_company_id, checked_at, planning_status, jobs_status)
       VALUES ($1, now(), $2, $3)
       ON CONFLICT (brand_company_id) DO UPDATE SET checked_at = now(), planning_status = EXCLUDED.planning_status`,
      [String(row.id), planningStatusOf(outcome), jobsStatus]);
    state.afterId = String(row.id);
    state.processed++;
    if (outcome.rows.length) { state.withRecords++; state.records += outcome.rows.length; }
    if (!outcome.ok) {
      if (outcome.reason === TOO_COMMON_REASON) state.skipped++;
      else { state.failed++; state.lastError = outcome.reason ?? null; }
    }
    if (!(await writeSweepProgress(db, state))) return;
  }
}

let sweepRun: Promise<void> | null = null;
// The run this process last launched, for tests to wait on.
export const currentPlanningSweepRun = () => sweepRun;

function launchPlanningSweep(state: PlanningSweepState, deps: PipelineDeps): void {
  sweepRun = runPlanningSweep(state, deps).catch((e: any) => console.error(`[brand-pipeline] twelve-month planning check stopped: ${failure(e)}`));
}

// Start, or carry on a stopped run from its place; a finished run starts again.
export async function startPlanningSweep(startedBy: string | null, deps: PipelineDeps = {}): Promise<PlanningSweepState> {
  const db = deps.db ?? pool;
  await ready(deps);
  const prev = await readSweepState(db);
  let state: PlanningSweepState;
  if (prev && prev.status !== "done") {
    state = { ...prev, status: "running", runId: randomUUID(), finishedAt: null, lastError: null };
  } else {
    const total = Number((await db.query(`SELECT count(*)::int AS n FROM crm_companies c WHERE ${TENANT_BRANDS}`)).rows[0]?.n ?? 0);
    state = {
      status: "running", runId: randomUUID(), startedAt: (deps.now?.() ?? new Date()).toISOString(), startedBy,
      finishedAt: null, afterId: null, total, processed: 0, withRecords: 0, records: 0, skipped: 0, failed: 0, lastError: null,
    };
  }
  await writeSweepState(db, state);
  launchPlanningSweep({ ...state }, deps);
  return state;
}

export async function stopPlanningSweep(deps: PipelineDeps = {}): Promise<PlanningSweepState | null> {
  const db = deps.db ?? pool;
  await ready(deps);
  const state = await readSweepState(db);
  if (state?.status !== "running") return state;
  const stopped = { ...state, status: "stopped" as const, finishedAt: (deps.now?.() ?? new Date()).toISOString() };
  await writeSweepState(db, stopped);
  return stopped;
}

// A run an admin started carries on after a restart or deploy. Called a
// minute after boot; it never starts a run of its own.
export async function resumePlanningSweep(deps: PipelineDeps = {}): Promise<void> {
  const db = deps.db ?? pool;
  await ready(deps);
  const state = await readSweepState(db);
  if (state?.status !== "running") return;
  const resumed = { ...state, runId: randomUUID() };
  await writeSweepState(db, resumed);
  console.log(`[brand-pipeline] twelve-month planning check carrying on (${resumed.processed}/${resumed.total})`);
  launchPlanningSweep({ ...resumed }, deps);
}

export interface PlanningSweepFinding { id: string; name: string; applications: number; sites: number; latest: string | null; towns: string[] }

// The run and what the register holds now: every brand with a planning
// application naming it in the last twelve months, newest first.
export async function planningSweepView(deps: PipelineDeps = {}): Promise<{ sweep: PlanningSweepState | null; gapSeconds: number; brandCount: number; findings: PlanningSweepFinding[] }> {
  const db = deps.db ?? pool;
  await ready(deps);
  const now = deps.now?.() ?? new Date();
  const [sweep, brands, found] = await Promise.all([
    readSweepState(db),
    db.query(`SELECT count(*)::int AS n FROM crm_companies c WHERE ${TENANT_BRANDS}`),
    db.query(
      `SELECT c.id, c.name, count(*)::int AS applications,
              count(DISTINCT COALESCE(i.detail->>'site', i.address, i.item_key))::int AS sites,
              to_char(max(i.item_date), 'YYYY-MM-DD') AS latest,
              (array_agg(DISTINCT COALESCE(i.town, i.authority)) FILTER (WHERE COALESCE(i.town, i.authority) IS NOT NULL))[1:6] AS towns
         FROM brand_pipeline_items i
         JOIN crm_companies c ON c.id = i.brand_company_id
        WHERE i.kind = 'planning' AND i.item_date >= $1::date AND ${occupierTypeSql("i")}
          AND c.merged_into_id IS NULL AND c.archived_at IS NULL
        GROUP BY c.id, c.name
        ORDER BY max(i.item_date) DESC, c.name
        LIMIT 300`,
      [dayBefore(now, PLANNING_WINDOW_DAYS)]),
  ]);
  const findings = found.rows.map((r: any) => ({
    id: String(r.id), name: String(r.name), applications: Number(r.applications) || 0, sites: Number(r.sites) || 0,
    latest: r.latest ?? null, towns: Array.isArray(r.towns) ? r.towns.filter(Boolean) : [],
  }));
  return { sweep, gapSeconds: PLANIT_GAP_MS / 1000, brandCount: Number(brands.rows[0]?.n ?? 0), findings };
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

// Admins: the twelve-month planning check.
router.get("/api/admin/brand-pipeline/planning-sweep", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    res.json(await planningSweepView());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/brand-pipeline/planning-sweep", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const action = String(req.body?.action || "");
    if (action === "start") {
      const userId = (req.session as any)?.userId || (req as any).tokenUserId || null;
      const who = userId ? (await pool.query(`SELECT name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? null : null;
      await startPlanningSweep(who);
    } else if (action === "stop") {
      await stopPlanningSweep();
    } else {
      return res.status(400).json({ error: "Say start or stop" });
    }
    res.json(await planningSweepView());
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
