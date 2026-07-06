/**
 * Scheduled jobs worker.
 *
 * Lets ChatBGP (or anyone with sql_write) author background jobs by inserting
 * into the `scheduled_jobs` table. The worker polls every minute, picks
 * everything that's due, runs it, and recomputes next_run_at.
 *
 * Action kinds:
 *   sql_query         — payload.query: string. Runs SELECT, stores rows
 *                       (truncated to 5KB) in last_run_output.
 *   sql_write         — payload: { table, op, where?, data?, rows?, returning? }.
 *                       Runs through executeSqlWrite (audited).
 *   send_chat_message — payload: { threadId, content }. Posts an assistant
 *                       message to a chat thread (e.g. daily digest).
 *   send_email        — payload: { to, subject, body, html? }. Sends via the
 *                       Microsoft Graph integration if signed in, otherwise
 *                       logs a "not configured" warning.
 *
 * Schedule kinds (string in scheduleValue):
 *   daily   — "HH:MM"             (server tz)
 *   weekly  — "DOW:HH:MM"         (DOW = MON|TUE|...|SUN)
 *   hourly  — "MM"                (top-of-hour minute, 00-59)
 *   cron    — 5-field expression (basic support: m h dom mon dow)
 *
 * The worker logs every run to last_run_status / last_run_output and
 * increments run_count. Three consecutive errors auto-disable the job
 * to stop runaway loops.
 */

import { pool } from "./db";
import { executeSqlWrite, executeSqlQuery } from "./sql-tools";

const POLL_MS = 60 * 1000;
const MAX_OUTPUT_BYTES = 5000;
const AUTO_DISABLE_AFTER_ERRORS = 3;

let started = false;
let intervalHandle: NodeJS.Timeout | null = null;

// ─── Schedule helpers ───────────────────────────────────────────────────────

const DOW_MAP: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

function nextDailyRun(now: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) throw new Error(`Bad daily schedule: ${hhmm}`);
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(h, m);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

function nextWeeklyRun(now: Date, value: string): Date {
  const [dowStr, hhmm] = value.split(":", 2);
  const dow = DOW_MAP[dowStr.toUpperCase()];
  if (dow === undefined) throw new Error(`Bad weekly DOW: ${dowStr}`);
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) throw new Error(`Bad weekly time: ${hhmm}`);
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(h, m);
  let dayDiff = (dow - next.getDay() + 7) % 7;
  if (dayDiff === 0 && next <= now) dayDiff = 7;
  next.setDate(next.getDate() + dayDiff);
  return next;
}

function nextHourlyRun(now: Date, mmStr: string): Date {
  const m = Number(mmStr);
  if (!Number.isFinite(m) || m < 0 || m > 59) throw new Error(`Bad hourly minute: ${mmStr}`);
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(m);
  if (next <= now) next.setHours(next.getHours() + 1);
  return next;
}

// Minimal cron support: 5-field "m h dom mon dow", each field is either *,
// a single number, a comma list, or */N. Enough for "every 15 min", "0 */4 * * *",
// "0 9 * * 1-5" (only single-DOW or list, no ranges). Use sparingly — daily/
// weekly/hourly cover 90% of cases.
function nextCronRun(now: Date, expr: string): Date {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron must have 5 fields: ${expr}`);
  const [mF, hF, domF, monF, dowF] = parts;
  const matchField = (val: number, f: string, min: number, max: number): boolean => {
    if (f === "*") return true;
    for (const part of f.split(",")) {
      if (part.startsWith("*/")) {
        const step = Number(part.slice(2));
        if (Number.isFinite(step) && step > 0 && (val - min) % step === 0) return true;
      } else if (part.includes("-")) {
        const [a, b] = part.split("-").map(Number);
        if (val >= a && val <= b) return true;
      } else {
        if (Number(part) === val) return true;
      }
    }
    return false;
  };
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  // Bounded search — a year of minutes is ~525,000. Worst case for a malformed
  // cron, give up after 366 days.
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (
      matchField(cursor.getMinutes(), mF, 0, 59) &&
      matchField(cursor.getHours(), hF, 0, 23) &&
      matchField(cursor.getDate(), domF, 1, 31) &&
      matchField(cursor.getMonth() + 1, monF, 1, 12) &&
      matchField(cursor.getDay(), dowF, 0, 6)
    ) {
      return new Date(cursor);
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  throw new Error(`Cron expression matched nothing within a year: ${expr}`);
}

export function computeNextRun(scheduleKind: string, scheduleValue: string, from: Date = new Date()): Date {
  switch (scheduleKind) {
    case "daily": return nextDailyRun(from, scheduleValue);
    case "weekly": return nextWeeklyRun(from, scheduleValue);
    case "hourly": return nextHourlyRun(from, scheduleValue);
    case "cron": return nextCronRun(from, scheduleValue);
    default: throw new Error(`Unknown schedule kind: ${scheduleKind}`);
  }
}

// ─── Action runners ─────────────────────────────────────────────────────────

interface JobRow {
  id: string;
  name: string;
  description: string | null;
  schedule_kind: string;
  schedule_value: string;
  action_kind: string;
  action_payload: any;
  enabled: boolean;
  created_by: string | null;
  next_run_at: Date;
  error_count: number;
}

async function runAction(job: JobRow): Promise<{ status: "ok" | "error"; output: string }> {
  try {
    if (job.action_kind === "sql_query") {
      const query = String(job.action_payload?.query || "");
      if (!query) return { status: "error", output: "payload.query missing" };
      const r = await executeSqlQuery(query);
      if (!r.success) return { status: "error", output: r.error || "query failed" };
      const rowsStr = JSON.stringify(r.rows || []);
      return { status: "ok", output: `${r.rowCount ?? 0} row(s); ${rowsStr.substring(0, MAX_OUTPUT_BYTES - 100)}` };
    }
    if (job.action_kind === "sql_write") {
      const p = job.action_payload || {};
      const r = await executeSqlWrite(
        { table: p.table, op: p.op, data: p.data, rows: p.rows, where: p.where, returning: p.returning },
        { userId: job.created_by || undefined, threadId: `scheduled:${job.id}` },
      );
      if (!r.success) return { status: "error", output: r.error || "write failed" };
      return { status: "ok", output: `affected=${r.affected}` };
    }
    if (job.action_kind === "send_chat_message") {
      const threadId = String(job.action_payload?.threadId || "");
      const content = String(job.action_payload?.content || "");
      if (!threadId || !content) return { status: "error", output: "payload.threadId and payload.content required" };
      await pool.query(
        `INSERT INTO chat_messages (thread_id, role, content, user_id) VALUES ($1, 'assistant', $2, $3)`,
        [threadId, content.substring(0, 8000), job.created_by],
      );
      return { status: "ok", output: `posted to thread ${threadId}` };
    }
    if (job.action_kind === "send_email") {
      // Defer to the existing email send pipeline. The Microsoft token must
      // belong to a session; for scheduled jobs, fall back to a system-owned
      // identity if configured. For now, log and skip — wiring full system-
      // identity email is a follow-up.
      return { status: "error", output: "send_email scheduled action not wired yet — use send_chat_message for digests for now" };
    }
    return { status: "error", output: `Unknown action_kind: ${job.action_kind}` };
  } catch (err: any) {
    return { status: "error", output: `Exception: ${err?.message || String(err)}`.substring(0, MAX_OUTPUT_BYTES) };
  }
}

// ─── Worker loop ────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  let due: JobRow[] = [];
  try {
    const r = await pool.query(
      `SELECT id, name, description, schedule_kind, schedule_value, action_kind,
              action_payload, enabled, created_by, next_run_at, error_count
         FROM scheduled_jobs
        WHERE enabled = true AND next_run_at <= NOW()
        ORDER BY next_run_at ASC
        LIMIT 10`,
    );
    due = r.rows;
  } catch (err: any) {
    // Table might not exist yet (migration pending); back off quietly.
    if (!/relation .* does not exist/i.test(err?.message || "")) {
      console.warn("[scheduled-jobs] poll failed:", err?.message);
    }
    return;
  }

  for (const job of due) {
    const t0 = Date.now();
    const result = await runAction(job);
    const ms = Date.now() - t0;
    const newErrorCount = result.status === "error" ? job.error_count + 1 : 0;
    const shouldDisable = newErrorCount >= AUTO_DISABLE_AFTER_ERRORS;

    let nextRun: Date;
    try {
      nextRun = computeNextRun(job.schedule_kind, job.schedule_value);
    } catch (e: any) {
      // Malformed schedule — disable the job and store the error.
      await pool.query(
        `UPDATE scheduled_jobs
            SET enabled = false,
                last_run_at = NOW(),
                last_run_status = 'error',
                last_run_output = $1,
                last_run_ms = $2,
                run_count = run_count + 1,
                error_count = error_count + 1
          WHERE id = $3`,
        [`Bad schedule: ${e?.message}`.substring(0, MAX_OUTPUT_BYTES), ms, job.id],
      );
      console.warn(`[scheduled-jobs] disabled "${job.name}" — bad schedule: ${e?.message}`);
      continue;
    }

    await pool.query(
      `UPDATE scheduled_jobs
          SET last_run_at = NOW(),
              last_run_status = $1,
              last_run_output = $2,
              last_run_ms = $3,
              run_count = run_count + 1,
              error_count = $4,
              enabled = CASE WHEN $5::bool THEN false ELSE enabled END,
              next_run_at = $6
        WHERE id = $7`,
      [
        result.status,
        result.output.substring(0, MAX_OUTPUT_BYTES),
        ms,
        newErrorCount,
        shouldDisable,
        nextRun,
        job.id,
      ],
    );
    if (shouldDisable) {
      console.warn(`[scheduled-jobs] disabled "${job.name}" after ${newErrorCount} consecutive errors`);
    } else {
      console.log(`[scheduled-jobs] ran "${job.name}" (${result.status}) in ${ms}ms — next ${nextRun.toISOString()}`);
    }
  }
}

export function startScheduledJobs(): void {
  if (started) return;
  started = true;
  // First tick after a short delay so the rest of the boot sequence finishes.
  setTimeout(() => { tick().catch(e => console.error("[scheduled-jobs] tick:", e?.message)); }, 30_000);
  intervalHandle = setInterval(() => {
    tick().catch(e => console.error("[scheduled-jobs] tick:", e?.message));
  }, POLL_MS);
  console.log("[scheduled-jobs] worker started — polling every 60s");
}

export function stopScheduledJobs(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  started = false;
}
