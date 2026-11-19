// The twelve-month PIPnet catch-up (19 November 2026). Woody: "We want the
// last 12 months", with the original flyer kept. PIPnet's requirements search
// takes one "listed since" date, sorts newest first and stops at 50 pages
// (about 1,000 rows), so a plain search cannot reach a year back. The search
// form also takes a trade type (122 on 19 November 2026), and one trade type
// listed since a year ago fits under the cap; the catch-up searches them one
// at a time, then once with no trade type for listings that carry none.
// Pure rules: the date, the steps, when it pauses, the words it shows, and
// whether a stored flyer is read again. The run is server/pipnet-catchup.ts.

// The review's decision A: read the first 100 flyers, show what they cost,
// then the rest only when an admin says carry on.
export const CATCHUP_FIRST_FLYERS = 100;
export const PIPNET_PAGE_CAP = 50;
export const PIPNET_ROWS_PER_PAGE = 20;

export type CatchupTotals = {
  rows: number; imported: number; promoted: number; agentsOnly: number;
  aiReads: number; reused: number; skippedOld: number; failed: number;
};
export const emptyTotals = (): CatchupTotals => ({ rows: 0, imported: 0, promoted: 0, agentsOnly: 0, aiReads: 0, reused: 0, skippedOld: 0, failed: 0 });

export type CatchupSearch = { tradeType: string | null; rows: number; capped: boolean; aiReads: number; failed: boolean; at: string };

export interface PipnetCatchupState {
  status: "running" | "paused" | "done" | "stopped";
  runId: string;
  phase: "first" | "rest";         // before or after the pause for the cost
  since: string;                    // dd/mm/yyyy, PIPnet's "listed since"
  cutoff: string;                   // the same day, ISO
  startedAt: string;
  startedBy: string | null;
  finishedAt: string | null;
  types: string[];                  // PIPnet's trade types, as read when it started
  next: number;                     // the next search: types[next], or the last pass when next === types.length
  totals: CatchupTotals;
  searches: CatchupSearch[];        // each search done, newest last
  firstCost: { flyers: number; usd: number | null } | null;  // what the first 100 cost
  lastError: string | null;
}

// "Listed since" one year before today, in London: 19/11/2025 on 19 November 2026.
export function catchupSince(now: Date): { since: string; cutoff: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  const year = Number(parts.year) - 1, month = Number(parts.month), day = Number(parts.day);
  // 29 February a year back is 28 February.
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const d = Math.min(day, last);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { since: `${pad(d)}/${pad(month)}/${year}`, cutoff: `${year}-${pad(month)}-${pad(d)}T00:00:00.000Z` };
}

export type CatchupStep = { kind: "search"; tradeType: string | null } | { kind: "done" };

// The next search: each trade type in turn, then one with none.
export function nextCatchupStep(state: Pick<PipnetCatchupState, "types" | "next">): CatchupStep {
  if (state.next < state.types.length) return { kind: "search", tradeType: state.types[state.next] };
  if (state.next === state.types.length) return { kind: "search", tradeType: null };
  return { kind: "done" };
}

// After the first 100 flyers read by AI, the run pauses for an admin to see
// the cost; Carry on reads the rest without pausing again.
export function pauseForCost(state: Pick<PipnetCatchupState, "phase" | "totals">): boolean {
  return state.phase === "first" && state.totals.aiReads >= CATCHUP_FIRST_FLYERS;
}

export function addTally(totals: CatchupTotals, t: Partial<CatchupTotals>): CatchupTotals {
  const out = { ...totals };
  for (const key of Object.keys(out) as Array<keyof CatchupTotals>) out[key] += Number(t[key] || 0);
  return out;
}

// A stored listing keeps its flyer and its reading when PIPnet still gives
// the same document date, the pack was kept and the reading was sure: each
// flyer is read by AI once. A re-issued listing (new date) is read again.
export function flyerAlreadyRead(stored: { lastUpdated: string | null; rawData: any } | null, listedAs: string | null): boolean {
  if (!stored) return false;
  const raw = stored.rawData || {};
  const read = raw._visionParse;
  if (!raw._brochurePack?.url || !read || !read.confidence || read.confidence === "low") return false;
  const was = (stored.lastUpdated || "").trim();
  return !!was && was === (listedAs || "").trim();
}

// The options of the search form's trade type list, as PIPnet prints them.
export function parseTradeTypes(html: string): string[] {
  const select = /<select\b[^>]*name="tradeTypeListBox"[^>]*>([\s\S]*?)<\/select>/i.exec(html || "");
  if (!select) return [];
  const out: string[] = [];
  for (const m of select[1].matchAll(/<option\b[^>]*?(?:value="([^"]*)")?[^>]*>([\s\S]*?)<\/option>/gi)) {
    const value = (m[1] ?? m[2] ?? "").replace(/&amp;/g, "&").replace(/<[^>]+>/g, "").trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

// What the admin card says about a run.
export function catchupWords(state: PipnetCatchupState | null): string {
  if (!state) return "Not run yet.";
  const t = state.totals;
  const done = `${Math.min(state.next, state.types.length + 1)} of ${state.types.length + 1} searches`;
  const read = `${t.rows} listings seen, ${t.aiReads} flyers read, ${t.reused} already read, ${t.promoted} new requirements, ${t.agentsOnly} agents from listings naming no client`;
  if (state.status === "paused") {
    const cost = state.firstCost?.usd != null ? `, about $${state.firstCost.usd.toFixed(2)} of AI` : "";
    return `Paused after the first ${state.firstCost?.flyers ?? t.aiReads} flyers${cost}. ${read}. Carry on reads the rest.`;
  }
  if (state.status === "running") return `Running: ${done}. ${read}.`;
  if (state.status === "stopped") return `Stopped at ${done}${state.lastError ? ` (${state.lastError})` : ""}. ${read}. Carry on picks up from there.`;
  return `Finished: ${read}.`;
}
