// The SRA's own data on the law firms on its register, read with BGP's key
// (Woody, 21 November 2026: "ive done the solcitors api btw"). Rules and the
// SRA's terms: shared/sra-register.ts.
//
// One call returns every organisation (about 25,000, 24 MB, a few seconds).
// The SRA refreshes the data every 24 hours and its terms cap reads a day, so
// the app reads it at most once a day, on the first solicitors check (or the
// admin's connection test) after that, keeps it in memory, and after a failed
// read waits ten minutes before trying again (a stale copy, when there is one,
// is used meanwhile and says when it was read). Nothing reads it at boot or on
// a timer. The key is SRA_API_KEY (Railway); it is sent only to the SRA's own
// host, as the Ocp-Apim-Subscription-Key header, and never logged.
import { SRA_DATASHARE_URL, buildSraIndex, readSraFirm, sraDayWords, type SraFirm, type SraIndex } from "@shared/sra-register";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const READ_TIMEOUT_MS = 120_000;
/** Fewer entries than this is an answer cut short, not the register (25,310 on 21 November 2026). */
const MIN_ENTRIES = 5_000;

export const sraKey = (): string | null => (process.env.SRA_API_KEY || "").trim() || null;
export const sraConfigured = (): boolean => !!sraKey();

export interface SraRegisterState { index: SraIndex; readAt: string; count: number }
export class SraReadError extends Error {
  constructor(message: string, readonly kind: "no_key" | "refused" | "busy" | "failed") { super(message); }
}

let held: SraRegisterState | null = null;
let reading: Promise<SraRegisterState> | null = null;
let lastFailure: { at: number; message: string; kind: SraReadError["kind"] } | null = null;

async function readOnce(): Promise<SraRegisterState> {
  const key = sraKey();
  if (!key) throw new SraReadError("The SRA's data is not set up: SRA_API_KEY is not set on Railway.", "no_key");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), READ_TIMEOUT_MS);
  try {
    const res = await fetch(SRA_DATASHARE_URL, {
      headers: { "Ocp-Apim-Subscription-Key": key, "Cache-Control": "no-cache", Accept: "application/json" },
      signal: ctl.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new SraReadError(`The SRA refused the key (${res.status}): check SRA_API_KEY on Railway against the subscription on the SRA's developer portal.`, "refused");
    }
    if (res.status === 429) throw new SraReadError("The SRA asked us to slow down (429): its data share allows a set number of reads a day.", "busy");
    if (!res.ok) throw new SraReadError(`The SRA's data share answered ${res.status}.`, "failed");
    const body: any = await res.json();
    const list: unknown[] = Array.isArray(body?.Organisations) ? body.Organisations : [];
    const firms = list.map(readSraFirm).filter((f): f is SraFirm => !!f);
    if (firms.length < MIN_ENTRIES) throw new SraReadError(`The SRA's answer looked cut short (${firms.length} entries).`, "failed");
    return { index: buildSraIndex(firms), readAt: new Date().toISOString(), count: firms.length };
  } catch (err: any) {
    if (err instanceof SraReadError) throw err;
    throw new SraReadError(ctl.signal.aborted ? "The SRA's data share did not answer in time." : `The SRA's data share could not be read: ${String(err?.message || err).slice(0, 160)}`, "failed");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The SRA's data, read at most once a day. A failed read keeps the copy the
 * app already holds (its readAt says how old it is); with none it throws an
 * SraReadError whose message can be shown.
 */
export async function sraRegister(): Promise<SraRegisterState> {
  if (held && Date.now() - Date.parse(held.readAt) < DAY_MS) return held;
  if (reading) return reading;
  if (lastFailure && Date.now() - lastFailure.at < RETRY_AFTER_FAILURE_MS) {
    if (held) return held;
    throw new SraReadError(lastFailure.message, lastFailure.kind);
  }
  reading = readOnce()
    .then(state => { held = state; lastFailure = null; return state; })
    .catch((err: SraReadError) => {
      lastFailure = { at: Date.now(), message: err.message, kind: err.kind || "failed" };
      console.error("[sra-register] read failed:", err.message);
      if (held) return held;
      throw err;
    })
    .finally(() => { reading = null; });
  return reading;
}

/** For the admin's connection test (Subscriptions & APIs): reads only when the copy held is a day old. */
export async function pingSra(): Promise<{ ok: boolean; message: string }> {
  if (!sraConfigured()) return { ok: false, message: "SRA_API_KEY not set" };
  try {
    const s = await sraRegister();
    const age = Date.now() - Date.parse(s.readAt);
    const when = age < 60_000 ? "just now" : `${sraDayWords(s.readAt.slice(0, 10))} ${s.readAt.slice(11, 16)} UTC`;
    return {
      ok: !lastFailure,
      message: `${s.count.toLocaleString("en-GB")} entries on the SRA's register, read ${when}${lastFailure ? `; the last read failed: ${lastFailure.message}` : ""}`,
    };
  } catch (err: any) {
    return { ok: false, message: err?.message || "The SRA's data could not be read." };
  }
}
