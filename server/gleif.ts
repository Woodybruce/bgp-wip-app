// GLEIF, the Global Legal Entity Identifier Foundation's free register of
// LEIs (Woody, 21 November 2026: the free route to a company abroad's owners).
// Its API needs no key and its data is open (CC0). Each LEI record holds the
// entity's direct and ultimate accounting parents, or the reason it reports
// none: owned by individuals, not consolidated, not public.
//
// Requests are paced one a second across the app (GLEIF asks automated users
// to keep to its rate limit), each with its own time limit, and never throw:
// a failed look-up is a trace that says why.
import {
  gleifEntityFrom, gleifTop, pickGleifRecord, countryCode,
  type GleifEntity, type GleifTrace,
} from "@shared/foreign-owners";

const BASE = (process.env.GLEIF_API_URL || "https://api.gleif.org/api/v1").replace(/\/+$/, "");
const GAP_MS = process.env.GLEIF_GAP_MS != null && process.env.GLEIF_GAP_MS !== "" ? Math.max(0, Number(process.env.GLEIF_GAP_MS) || 0) : 1100;
const MAX_PARENTS = 6;

export const gleifOn = (): boolean => String(process.env.GLEIF || "").trim().toLowerCase() !== "off";

let turn: Promise<void> = Promise.resolve();
let lastAt = 0;
function nextTurn(): Promise<void> {
  const mine = turn.then(async () => {
    const wait = lastAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastAt = Date.now();
  });
  turn = mine.catch(() => {});
  return mine;
}

/** One GLEIF read: the JSON, or null for "not found" (GLEIF answers 404 for a parent that is not there). */
export async function gleifGet(path: string, params: Record<string, string> = {}, fetcher: typeof fetch = fetch): Promise<any | null> {
  await nextTurn();
  const qs = new URLSearchParams(params).toString();
  const res = await fetcher(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Accept: "application/vnd.api+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (res.status === 429) throw new Error("GLEIF asked us to slow down; try again in a minute");
  if (!res.ok) throw new Error(`GLEIF answered ${res.status}`);
  return res.json();
}

const recordsOf = (json: any): GleifEntity[] =>
  (Array.isArray(json?.data) ? json.data : []).map(gleifEntityFrom).filter((e: GleifEntity | null): e is GleifEntity => !!e);

/** The GLEIF records that could be the company: by its registration number, then by its name in its country. */
export async function searchGleif(q: { name: string; country: string | null; registrationNumber: string | null; authorities?: string[] | null }, fetcher: typeof fetch = fetch): Promise<GleifEntity[]> {
  const out: GleifEntity[] = [];
  const keep = (list: GleifEntity[]) => { for (const e of list) if (!out.some(x => x.lei === e.lei)) out.push(e); };
  const code = countryCode(q.country);
  const reg = String(q.registrationNumber || "").trim();
  if (reg) {
    keep(recordsOf(await gleifGet("/lei-records", { "filter[entity.registeredAs]": reg, "page[size]": "10" }, fetcher)));
    if (pickGleifRecord(q, out).status === "found") return out;
  }
  const name = String(q.name || "").replace(/\s+/g, " ").trim();
  if (name) {
    keep(recordsOf(await gleifGet("/lei-records", {
      "filter[entity.legalName]": name, "page[size]": "20",
      ...(code ? { "filter[entity.legalAddress.country]": code } : {}),
    }, fetcher)));
  }
  return out;
}

/**
 * A company followed up GLEIF: the record that is it, each direct parent in
 * turn (at most six), and what GLEIF says is above the last one. A company
 * abroad since 21 November 2026, and a UK party since the same evening.
 */
export async function traceGleif(q: { name: string; country: string | null; registrationNumber: string | null; authorities?: string[] | null }, fetcher: typeof fetch = fetch): Promise<GleifTrace> {
  const empty = (status: GleifTrace["status"], error: string | null = null, candidates = 0): GleifTrace => ({ status, entity: null, parents: [], top: null, candidates, error });
  if (!gleifOn()) return empty("skipped", "GLEIF look-ups are switched off");
  try {
    const records = await searchGleif(q, fetcher);
    const pick = pickGleifRecord(q, records);
    if (!pick.pick) return empty(pick.status, null, pick.candidates);
    const parents: GleifEntity[] = [];
    const seen = new Set([pick.pick.lei]);
    let current = pick.pick;
    let top = null as GleifTrace["top"];
    for (let level = 0; level <= MAX_PARENTS; level++) {
      const parent = await gleifGet(`/lei-records/${current.lei}/direct-parent`, {}, fetcher);
      const entity = parent?.data ? gleifEntityFrom(parent.data) : null;
      if (entity && !seen.has(entity.lei)) {
        if (level === MAX_PARENTS) { top = { kind: "unknown", reason: null, words: `GLEIF goes on above ${current.name}; the look-up stopped after ${MAX_PARENTS} parents` }; break; }
        parents.push(entity);
        seen.add(entity.lei);
        current = entity;
        continue;
      }
      const exception = await gleifGet(`/lei-records/${current.lei}/direct-parent-reporting-exception`, {}, fetcher);
      top = gleifTop(null, exception?.data?.attributes?.reason || null);
      break;
    }
    return { status: "found", entity: pick.pick, parents, top, candidates: 1, error: null };
  } catch (e: any) {
    const message = e?.name === "TimeoutError" || /aborted|timed? ?out/i.test(String(e?.message)) ? "GLEIF did not answer in time" : String(e?.message || e).slice(0, 160);
    return empty("error", message);
  }
}
