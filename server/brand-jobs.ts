// Tiny in-memory tracker for long-running brand-profile background jobs
// (store research, image refresh, menu-intel refresh, etc.).
//
// Why: Railway's edge proxy aborts requests after ~60s, so endpoints that
// hit Google Places + scrape stores or download images can't hold an
// HTTP connection open while they finish. Instead, the POST kicks off
// the work, returns 202 immediately, and the client polls a status
// endpoint until the job lands.
//
// Memory-only on purpose — jobs are cheap to re-run and we don't need
// persistence across deploys. If the process restarts mid-job the
// client will just time out and the user can hit "Refresh" again.

export type JobStatus =
  | { state: "running"; startedAt: number }
  | { state: "done"; startedAt: number; finishedAt: number; result: any }
  | { state: "error"; startedAt: number; finishedAt: number; error: string };

const jobs = new Map<string, JobStatus>();
// Track the underlying promise so concurrent kicks for the same key
// share one execution. The promise itself is not exposed via getStatus.
const inFlight = new Map<string, Promise<void>>();

const JOB_TTL_MS = 15 * 60_000; // keep finished results 15 minutes

function reap() {
  const now = Date.now();
  for (const [key, status] of jobs.entries()) {
    if (status.state !== "running" && now - status.finishedAt > JOB_TTL_MS) {
      jobs.delete(key);
    }
  }
}

export function startJob(key: string, fn: () => Promise<any>): { alreadyRunning: boolean } {
  reap();
  if (inFlight.has(key)) return { alreadyRunning: true };
  const startedAt = Date.now();
  jobs.set(key, { state: "running", startedAt });
  const p = (async () => {
    try {
      const result = await fn();
      jobs.set(key, { state: "done", startedAt, finishedAt: Date.now(), result });
    } catch (err: any) {
      jobs.set(key, { state: "error", startedAt, finishedAt: Date.now(), error: err?.message || String(err) });
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return { alreadyRunning: false };
}

export function getJobStatus(key: string): JobStatus | null {
  return jobs.get(key) || null;
}
