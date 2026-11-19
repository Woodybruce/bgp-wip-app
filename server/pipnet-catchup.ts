// The twelve-month PIPnet catch-up (19 November 2026). Woody: "We want the
// last 12 months", each flyer kept as it was uploaded, and the agents into
// the tenant rep CRM. The rules are shared/pipnet-catchup.ts; each search and
// its listings go through the daily import's own per-listing step
// (importPipnetCatchupStep in server/pipnet.ts), so a listing is stored,
// read and linked exactly as the 05:30 import does it.
//
// Admin only, started by a person, never at boot or on a timer: a run an
// admin started carries on after a deploy (resumePipnetCatchup, called a
// little after boot). Each search is its own PIPnet session, logged off when
// it finishes, so the run never holds one of BGP's PIPnet licences for long,
// and it takes turns with the daily import. It pauses after the first 100
// flyers read by AI with what they cost (decision A); Carry on reads the rest.
//
//   GET  /api/admin/pipnet-catchup   the run, in words and figures
//   POST /api/admin/pipnet-catchup   { action: "start" | "carry_on" | "stop" }
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "./auth";
import { pool } from "./db";
import {
  addTally, catchupSince, catchupWords, emptyTotals, nextCatchupStep, pauseForCost,
  type CatchupSearch, type PipnetCatchupState,
} from "../shared/pipnet-catchup";

const KEY = "pipnet-catchup";
const MAX_SEARCHES_KEPT = 200;

type Db = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };
export type CatchupDeps = {
  db?: Db;
  now?: () => Date;
  listTypes?: () => Promise<string[]>;
  step?: (params: { tradeType: string | null; since: string; cutoff: string }) => Promise<{
    rows: number; capped: boolean; imported: number; promoted: number; agentsOnly: number;
    aiReads: number; reused: number; skippedOld: number; failed: number;
  }>;
  flyerSpend?: (sinceIso: string) => Promise<{ flyers: number; usd: number | null }>;
};

const pipnet = () => import("./pipnet");

async function readState(db: Db): Promise<PipnetCatchupState | null> {
  return (await db.query(`SELECT value FROM system_settings WHERE key = $1`, [KEY])).rows[0]?.value ?? null;
}

async function writeState(db: Db, state: PipnetCatchupState): Promise<void> {
  await db.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [KEY, JSON.stringify(state)]);
}

// Progress is written only while this run is still the one running, so a
// Stop pressed during a search is never written over.
async function writeProgress(db: Db, state: PipnetCatchupState): Promise<boolean> {
  const r = await db.query(
    `UPDATE system_settings SET value = $2::jsonb, updated_at = now()
      WHERE key = $1 AND value->>'status' = 'running' AND value->>'runId' = $3
      RETURNING key`,
    [KEY, JSON.stringify(state), state.runId]);
  return (r.rows?.length ?? 0) > 0;
}

// What the flyers read since the run began cost, as App costs records it.
async function flyerSpendSince(db: Db, sinceIso: string): Promise<{ flyers: number; usd: number | null }> {
  const r = await db.query(
    `SELECT count(*)::int AS n, sum(cost_usd)::float AS usd FROM api_usage_log WHERE feature = 'pipnet-flyer' AND at >= $1::timestamptz`,
    [sinceIso]).catch(() => ({ rows: [] as any[] }));
  const row = r.rows[0];
  return { flyers: Number(row?.n ?? 0), usd: row?.usd == null ? null : Number(row.usd) };
}

async function runCatchup(state: PipnetCatchupState, deps: CatchupDeps): Promise<void> {
  const db = deps.db ?? (pool as unknown as Db);
  const step = deps.step ?? (async params => (await pipnet()).importPipnetCatchupStep(params));
  while (true) {
    const current = await readState(db);
    if (!current || current.status !== "running" || current.runId !== state.runId) return;
    const next = nextCatchupStep(state);
    const now = () => (deps.now?.() ?? new Date()).toISOString();
    if (next.kind === "done") {
      const done = { ...state, status: "done" as const, finishedAt: now() };
      if (await writeProgress(db, done)) console.log(`[pipnet-catchup] done: ${catchupWords(done)}`);
      return;
    }
    let search: CatchupSearch;
    try {
      const t = await step({ tradeType: next.tradeType, since: state.since, cutoff: state.cutoff });
      state.totals = addTally(state.totals, t);
      search = { tradeType: next.tradeType, rows: t.rows, capped: t.capped, aiReads: t.aiReads, failed: false, at: now() };
    } catch (e: any) {
      // PIPnet refused or failed: stop, keeping the place, so Carry on tries this search again.
      const message = String(e?.message || e).slice(0, 300);
      await writeProgress(db, { ...state, status: "stopped", finishedAt: now(), lastError: message });
      console.warn(`[pipnet-catchup] stopped at ${next.tradeType ?? "the last pass"}: ${message}`);
      return;
    }
    state.searches = [...state.searches, search].slice(-MAX_SEARCHES_KEPT);
    state.next++;
    if (pauseForCost(state)) {
      const spend = await (deps.flyerSpend ?? (since => flyerSpendSince(db, since)))(state.startedAt);
      const paused = { ...state, status: "paused" as const, finishedAt: now(), firstCost: { flyers: state.totals.aiReads, usd: spend.usd } };
      if (await writeProgress(db, paused)) console.log(`[pipnet-catchup] paused for the cost: ${catchupWords(paused)}`);
      return;
    }
    if (!(await writeProgress(db, state))) return;
  }
}

let run: Promise<void> | null = null;
// The run this process last launched, for tests to wait on.
export const currentCatchupRun = () => run;

function launch(state: PipnetCatchupState, deps: CatchupDeps): void {
  run = runCatchup(state, deps).catch((e: any) => console.error(`[pipnet-catchup] stopped: ${e?.message || e}`));
}

// Start a new run (reading PIPnet's trade types), or carry on a paused or
// stopped one from its place; a finished run starts again.
export async function startPipnetCatchup(startedBy: string | null, deps: CatchupDeps = {}): Promise<PipnetCatchupState> {
  const db = deps.db ?? (pool as unknown as Db);
  const prev = await readState(db);
  if (prev?.status === "running") return prev;
  let state: PipnetCatchupState;
  if (prev && prev.status !== "done") {
    // Carry on: after the pause for the cost, the rest is read without pausing again.
    state = { ...prev, status: "running", runId: randomUUID(), phase: prev.status === "paused" ? "rest" : prev.phase, finishedAt: null, lastError: null };
  } else {
    const types = await (deps.listTypes ?? (async () => (await pipnet()).listPipnetTradeTypes()))();
    const { since, cutoff } = catchupSince(deps.now?.() ?? new Date());
    state = {
      status: "running", runId: randomUUID(), phase: "first", since, cutoff,
      startedAt: (deps.now?.() ?? new Date()).toISOString(), startedBy, finishedAt: null,
      types, next: 0, totals: emptyTotals(), searches: [], firstCost: null, lastError: null,
    };
  }
  await writeState(db, state);
  launch({ ...state }, deps);
  return state;
}

export async function stopPipnetCatchup(deps: CatchupDeps = {}): Promise<PipnetCatchupState | null> {
  const db = deps.db ?? (pool as unknown as Db);
  const state = await readState(db);
  if (state?.status !== "running") return state;
  const stopped = { ...state, status: "stopped" as const, finishedAt: (deps.now?.() ?? new Date()).toISOString() };
  await writeState(db, stopped);
  return stopped;
}

// A run an admin started carries on after a restart or deploy. It never
// starts a run of its own.
export async function resumePipnetCatchup(deps: CatchupDeps = {}): Promise<void> {
  const db = deps.db ?? (pool as unknown as Db);
  const state = await readState(db);
  if (state?.status !== "running") return;
  const resumed = { ...state, runId: randomUUID() };
  await writeState(db, resumed);
  console.log(`[pipnet-catchup] carrying on: ${catchupWords(resumed)}`);
  launch({ ...resumed }, deps);
}

export async function pipnetCatchupView(deps: CatchupDeps = {}) {
  const db = deps.db ?? (pool as unknown as Db);
  const state = await readState(db);
  return { state, words: catchupWords(state), capped: (state?.searches || []).filter(s => s.capped).map(s => s.tradeType ?? "no trade type") };
}

const router = Router();

router.get("/api/admin/pipnet-catchup", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    res.json(await pipnetCatchupView());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/pipnet-catchup", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const action = String(req.body?.action || "");
    if (action === "start" || action === "carry_on") {
      const userId = (req.session as any)?.userId || (req as any).tokenUserId || null;
      const who = userId ? (await pool.query(`SELECT name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? null : null;
      await startPipnetCatchup(who);
    } else if (action === "stop") {
      await stopPipnetCatchup();
    } else {
      return res.status(400).json({ error: "Say start, carry_on or stop" });
    }
    res.json(await pipnetCatchupView());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
