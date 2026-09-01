// Hard daily cap on server-side Google Maps/Places spend (Woody,
// 2026-09-01: "cap the google spend to £200 per day", after the August
// Places bill hit £466 in a week). Enforced by wrapping global fetch so
// every one of the ~60 googleapis call sites across the server is
// covered without touching them. Costs are list-price estimates per SKU
// family — deliberately rounded UP a touch so the cap errs on the safe
// side. When the cap is hit, Google calls get a synthetic 429 with
// status OVER_QUERY_LIMIT (the shape Places parsers already treat as a
// failed lookup) until midnight UTC.
import { pool } from "./db";

const CAP_GBP = Number(process.env.GOOGLE_DAILY_CAP_GBP || 200);

let day = "";
let spentGbp = 0;
let loaded = false;
let dirty = false;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function estimateCostGbp(url: string): number {
  const u = url.toLowerCase();
  if (u.includes("textsearch") || u.includes(":searchtext")) return 0.03;
  if (u.includes("nearbysearch")) return 0.03;
  if (u.includes("place/details") || u.includes("findplacefromtext")) return 0.015;
  if (u.includes("/photo")) return 0.007;
  if (u.includes("streetview")) return 0.007;
  if (u.includes("staticmap")) return 0.002;
  if (u.includes("geocode")) return 0.005;
  return 0.005;
}

async function ensureLoaded(): Promise<void> {
  const key = todayKey();
  if (loaded && day === key) return;
  day = key;
  spentGbp = 0;
  loaded = true;
  try {
    const r = await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [`google_budget:${key}`]);
    const v = r.rows[0]?.value;
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    if (parsed && typeof parsed.gbp === "number") spentGbp = parsed.gbp;
  } catch {
    // table missing or unreadable — run with in-memory tally only
  }
}

let flushScheduled = false;
function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(async () => {
    flushScheduled = false;
    if (!dirty) return;
    dirty = false;
    try {
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [`google_budget:${day}`, JSON.stringify({ gbp: Math.round(spentGbp * 1000) / 1000 })],
      );
    } catch {/* next flush retries */}
  }, 15_000).unref?.();
}

const GOOGLE_HOST_RE = /\b(maps|places)\.googleapis\.com/i;
let warnedToday = "";

export function installGoogleBudgetGuard(): void {
  const realFetch = globalThis.fetch.bind(globalThis);
  (globalThis as any).fetch = async (input: any, init?: any) => {
    let url = "";
    try {
      url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url || "");
    } catch {/* leave blank */}
    if (url && GOOGLE_HOST_RE.test(url)) {
      await ensureLoaded();
      if (spentGbp >= CAP_GBP) {
        if (warnedToday !== day) {
          warnedToday = day;
          console.warn(`[google-budget] £${CAP_GBP}/day cap reached (est £${spentGbp.toFixed(2)}) — blocking Google Maps/Places calls until midnight UTC`);
        }
        return new Response(
          JSON.stringify({ error: "google-daily-cap-reached", status: "OVER_QUERY_LIMIT", results: [], candidates: [] }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        );
      }
      spentGbp += estimateCostGbp(url);
      dirty = true;
      scheduleFlush();
    }
    return realFetch(input, init);
  };
  console.log(`[google-budget] daily Google Maps/Places cap active: £${CAP_GBP}/day`);
}
