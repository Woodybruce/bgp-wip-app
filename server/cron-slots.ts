// Restart-proof fixed-time job runner. The old pattern — an hourly
// setInterval checking getHours() — silently skipped a job's whole slot
// whenever a deploy straddled its hour (boot at 09:05 → first tick 10:05 →
// that Monday's 09:00 client reports never sent, nothing recorded). Jobs
// here run off one 5-minute tick: each declares when it becomes due and
// what its slot id is, and a persisted once-per-slot claim (the
// deal-verdicts system_settings pattern) means a job straddled by a deploy
// runs minutes late instead of being skipped, while reruns and multiple
// instances can never double-fire the same slot.
//
// Times are Europe/London, so "04:00" means 4am London across the BST/UTC
// changes (the raw getHours() checks drifted an hour twice a year).
// Catch-up is bounded to a 3-hour window after the scheduled time: late
// enough to absorb any deploy, early enough that a first deploy of this
// runner doesn't fire the whole night's schedule at 2pm.

import { pool } from "./db";

export type LondonNow = {
  date: string;       // 2026-10-26 (London calendar date)
  month: string;      // 2026-10
  hour: number;       // 0-23, London
  minute: number;
  day: number;        // 0=Sun … 6=Sat, London
  dayOfMonth: number;
  epochWeek: number;  // floor(unix days / 7) — increments exactly once between consecutive Mondays
};

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function londonNow(d = new Date()): LondonNow {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    month: `${get("year")}-${get("month")}`,
    hour: Number(get("hour")) % 24, // some ICU builds render midnight as "24"
    minute: Number(get("minute")),
    day: WEEKDAYS[get("weekday")] ?? 0,
    dayOfMonth: Number(get("day")),
    epochWeek: Math.floor(d.getTime() / (7 * 24 * 60 * 60 * 1000)),
  };
}

const CATCHUP_WINDOW_MIN = 3 * 60;

function within(now: LondonNow, hour: number, minute: number): boolean {
  const nowMin = now.hour * 60 + now.minute;
  const startMin = hour * 60 + minute;
  return nowMin >= startMin && nowMin < startMin + CATCHUP_WINDOW_MIN;
}

export const dailyAt = (hour: number, minute = 0) => (now: LondonNow) =>
  within(now, hour, minute) ? now.date : null;

export const weeklyAt = (day: number, hour: number, minute = 0) => (now: LondonNow) =>
  now.day === day && within(now, hour, minute) ? now.date : null;

export const monthlyAt = (dayOfMonth: number, hour: number, minute = 0) => (now: LondonNow) =>
  now.dayOfMonth === dayOfMonth && within(now, hour, minute) ? now.month : null;

export type FixedJob = {
  key: string;
  // Slot id when the job is due now, else null. Same slot id across the
  // catch-up window = at most one run per slot, deploys included.
  due: (now: LondonNow) => string | null;
  run: () => Promise<unknown>;
};

async function claimJobSlot(key: string, slotId: string): Promise<boolean> {
  const val = JSON.stringify(slotId);
  const r = await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb WHERE system_settings.value IS DISTINCT FROM $2::jsonb
     RETURNING key`,
    [`cron-slot:${key}`, val],
  );
  return (r.rowCount || 0) > 0;
}

export function startFixedJobs(jobs: FixedJob[]): void {
  const tick = async () => {
    const now = londonNow();
    for (const job of jobs) {
      try {
        const slot = job.due(now);
        if (!slot) continue;
        if (!(await claimJobSlot(job.key, slot))) continue;
        console.log(`[cron-slots] running ${job.key} (slot ${slot})`);
        // Fire and forget, like the setIntervals this replaces — one slow
        // job must not hold the rest of the schedule.
        job.run().catch((err: any) => console.error(`[cron-slots] ${job.key} failed:`, err?.message));
      } catch (err: any) {
        console.error(`[cron-slots] ${job.key} tick failed:`, err?.message);
      }
    }
  };
  setInterval(() => { tick().catch((e: any) => console.error("[cron-slots] tick failed:", e?.message)); }, 5 * 60 * 1000);
  // Boot catch-up: a slot straddled by the deploy runs ~90s after boot.
  setTimeout(() => { tick().catch((e: any) => console.error("[cron-slots] boot tick failed:", e?.message)); }, 90 * 1000);
}
