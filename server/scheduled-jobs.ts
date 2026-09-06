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
    if (job.action_kind === "pathway_digest") {
      // Computed at run time (counts change nightly) — that's why this
      // isn't a static send_chat_message. payload.threadId targets a
      // specific chat; without one, the digest lands in the job creator's
      // most recent plain ChatBGP conversation.
      const { buildPathwayDigest } = await import("./property-pathway");
      const digest = await buildPathwayDigest();
      if (!digest) return { status: "ok", output: "quiet day — nothing to report, no message posted" };
      let threadId = String(job.action_payload?.threadId || "");
      if (!threadId && job.created_by) {
        const { rows } = await pool.query(
          `SELECT id FROM chat_threads
            WHERE is_ai_chat = TRUE AND linked_type IS NULL AND created_by = $1
            ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
          [job.created_by],
        );
        threadId = rows[0]?.id || "";
      }
      if (!threadId) return { status: "error", output: "payload.threadId missing and no ChatBGP thread found for the job creator" };
      await pool.query(
        `INSERT INTO chat_messages (thread_id, role, content, user_id) VALUES ($1, 'assistant', $2, $3)`,
        [threadId, digest.substring(0, 8000), job.created_by],
      );
      // Bump the thread so the digest surfaces at the top of the chat list.
      await pool.query(`UPDATE chat_threads SET updated_at = now() WHERE id = $1`, [threadId]).catch(() => {});
      return { status: "ok", output: `digest posted to thread ${threadId}` };
    }
    if (job.action_kind === "aml_rescreen") {
      // Ongoing AML monitoring — re-screens every subject KYC'd in the last
      // 12 months against ComplyAdvantage and reports anyone whose position
      // WORSENED (new matches / escalated status) since the last sweep.
      // A one-off screen at onboarding goes stale the day a name lands on a
      // list; this closes that gap weekly.
      const { screenNames, isComplyAdvantageConfigured } = await import("./comply-advantage");
      if (!isComplyAdvantageConfigured()) return { status: "error", output: "ComplyAdvantage not configured" };
      await pool.query(`
        CREATE TABLE IF NOT EXISTS aml_monitor_baseline (
          subject       TEXT PRIMARY KEY,
          status        TEXT,
          match_count   INTEGER NOT NULL DEFAULT 0,
          last_screened TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      const { rows: subjects } = await pool.query(
        `SELECT DISTINCT subject_name FROM kyc_investigations
          WHERE conducted_at > now() - interval '12 months' AND subject_name IS NOT NULL
          ORDER BY subject_name LIMIT 40`,
      );
      if (subjects.length === 0) return { status: "ok", output: "no KYC subjects in the last 12 months" };
      const results = await screenNames(subjects.map((s: any) => ({ name: s.subject_name, role: "monitored" })));
      const escalations: string[] = [];
      for (const r of results) {
        const { rows: prev } = await pool.query(`SELECT status, match_count FROM aml_monitor_baseline WHERE subject = $1`, [r.name]);
        const prevCount = prev[0]?.match_count ?? null;
        const prevStatus = prev[0]?.status ?? null;
        if (prevCount != null && (r.matches.length > prevCount || (prevStatus === "clear" && r.status !== "clear"))) {
          escalations.push(`⚠️ ${r.name}: ${prevStatus || "clear"} (${prevCount}) → ${r.status} (${r.matches.length} match${r.matches.length === 1 ? "" : "es"})`);
        }
        await pool.query(
          `INSERT INTO aml_monitor_baseline (subject, status, match_count, last_screened) VALUES ($1, $2, $3, now())
           ON CONFLICT (subject) DO UPDATE SET status = $2, match_count = $3, last_screened = now()`,
          [r.name, r.status, r.matches.length],
        );
      }
      if (escalations.length === 0) return { status: "ok", output: `re-screened ${results.length} subjects — no escalations` };
      // Escalations go to the job creator's ChatBGP, same route as the digest.
      let threadId = String(job.action_payload?.threadId || "");
      if (!threadId && job.created_by) {
        const { rows } = await pool.query(
          `SELECT id FROM chat_threads WHERE is_ai_chat = TRUE AND linked_type IS NULL AND created_by = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
          [job.created_by],
        );
        threadId = rows[0]?.id || "";
      }
      const msg = `**AML monitoring — screening changes detected**\n\n${escalations.join("\n")}\n\nOpen the Investigator to review before any further work for these subjects.`;
      if (threadId) {
        await pool.query(`INSERT INTO chat_messages (thread_id, role, content, user_id) VALUES ($1, 'assistant', $2, $3)`, [threadId, msg, job.created_by]);
        await pool.query(`UPDATE chat_threads SET updated_at = now() WHERE id = $1`, [threadId]).catch(() => {});
      }
      return { status: "ok", output: `re-screened ${results.length}; ${escalations.length} escalation(s)${threadId ? " — posted to chat" : ""}` };
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

// Seed the pathway morning digest if nobody has one yet — daily 08:00 into
// Woody's latest ChatBGP conversation (threadId resolved at run time, so it
// follows him to whichever chat he last used). Deleting/disabling the job
// row is the off switch; a disabled row also blocks re-seeding.
async function ensurePathwayDigestJob(): Promise<void> {
  try {
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM scheduled_jobs WHERE action_kind = 'pathway_digest' LIMIT 1`,
    );
    const { rows: woody } = await pool.query(
      `SELECT id FROM users WHERE lower(email) LIKE 'woody@%' LIMIT 1`,
    );
    // No early returns — the AML seed below must still run when the digest
    // already exists.
    if (!existing[0] && woody[0]) {
      await pool.query(
        `INSERT INTO scheduled_jobs (name, description, schedule_kind, schedule_value, action_kind, action_payload, enabled, created_by, next_run_at)
         VALUES ($1, $2, 'daily', '08:00', 'pathway_digest', '{}'::jsonb, true, $3, $4)`,
        [
          "Pathway morning digest",
          "Posts runs completed overnight, runs awaiting sign-off, and failed stages to Woody's ChatBGP each morning. Quiet days post nothing.",
          woody[0].id,
          computeNextRun("daily", "08:00"),
        ],
      );
      console.log("[scheduled-jobs] seeded Pathway morning digest (daily 08:00)");
    }
  } catch (err: any) {
    console.warn("[scheduled-jobs] digest seed skipped:", err?.message);
  }
  // Weekly AML re-screen (Monday 07:30) — same guarded-seed pattern.
  try {
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM scheduled_jobs WHERE action_kind = 'aml_rescreen' LIMIT 1`,
    );
    if (existing[0]) return;
    const { rows: woody } = await pool.query(`SELECT id FROM users WHERE lower(email) LIKE 'woody@%' LIMIT 1`);
    if (!woody[0]) return;
    await pool.query(
      `INSERT INTO scheduled_jobs (name, description, schedule_kind, schedule_value, action_kind, action_payload, enabled, created_by, next_run_at)
       VALUES ($1, $2, 'weekly', 'MON:07:30', 'aml_rescreen', '{}'::jsonb, true, $3, $4)`,
      [
        "AML weekly monitoring",
        "Re-screens every subject KYC'd in the last 12 months against ComplyAdvantage and posts to ChatBGP when anyone's sanctions/PEP position worsens. Quiet weeks post nothing.",
        woody[0].id,
        computeNextRun("weekly", "MON:07:30"),
      ],
    );
    console.log("[scheduled-jobs] seeded AML weekly monitoring (MON 07:30)");
  } catch (err: any) {
    console.warn("[scheduled-jobs] AML monitor seed skipped:", err?.message);
  }
}

export function startScheduledJobs(): void {
  if (started) return;
  started = true;
  // First tick after a short delay so the rest of the boot sequence finishes.
  setTimeout(() => {
    ensurePathwayDigestJob().catch(() => {});
    tick().catch(e => console.error("[scheduled-jobs] tick:", e?.message));
  }, 30_000);
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
