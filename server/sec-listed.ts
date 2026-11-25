// US-listed companies, from the SEC's own list of companies with shares on a
// US exchange (Woody, 25 November 2026, on Google LLC: "google LLC is owned by
// a listed business? cant that auto approve that way same as a plc?"). Read at
// most once a day, no key; a failed read waits ten minutes and never throws.
import { overseasNameKey } from "@shared/kyc-prechecks";
import type { ListedHit } from "@shared/foreign-owners";

const URL = process.env.SEC_TICKERS_URL || "https://www.sec.gov/files/company_tickers_exchange.json";
// The SEC asks automated readers to name themselves and a contact address.
const USER_AGENT = "Bruce Gillingham Pollard AML checks kyc@brucegillinghampollard.com";
// Nasdaq, NYSE and Cboe are regulated exchanges; OTC markets are not.
const EXCHANGES = new Set(["nasdaq", "nyse", "cboe"]);
const DAY = 24 * 3600_000;

let held: { at: number; byKey: Map<string, ListedHit> } | null = null;
let failedAt = 0;

export function secListFrom(data: any): Map<string, ListedHit> {
  const fields: string[] = Array.isArray(data?.fields) ? data.fields : [];
  const at = (f: string) => fields.indexOf(f);
  const [iCik, iName, iTicker, iExchange] = [at("cik"), at("name"), at("ticker"), at("exchange")];
  const out = new Map<string, ListedHit>();
  if ([iCik, iName, iTicker, iExchange].some(i => i < 0)) return out;
  for (const row of Array.isArray(data?.data) ? data.data : []) {
    const exchange = String(row?.[iExchange] || "");
    if (!EXCHANGES.has(exchange.toLowerCase())) continue;
    const name = String(row?.[iName] || "").trim();
    const key = overseasNameKey(name);
    if (!key || out.has(key)) continue;
    out.set(key, { name, cik: Number(row[iCik]), ticker: String(row[iTicker] || ""), exchange });
  }
  return out;
}

/** A lookup by company name, or null when the SEC's list cannot be read. */
export async function secListedLookup(fetcher: typeof fetch = fetch): Promise<((name: string) => ListedHit | null) | null> {
  if (process.env.SEC_LISTED === "off") return null;
  const now = Date.now();
  if (!held || now - held.at > DAY) {
    if (now - failedAt < 10 * 60_000) return held ? lookupIn(held.byKey) : null;
    try {
      const res = await fetcher(URL, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`the SEC answered ${res.status}`);
      const byKey = secListFrom(await res.json());
      if (byKey.size < 1000) throw new Error("the SEC's list looks cut short");
      held = { at: now, byKey };
    } catch (e: any) {
      failedAt = now;
      console.warn(`[sec-listed] could not read the SEC's list: ${e?.message || e}`);
      return held ? lookupIn(held.byKey) : null;
    }
  }
  return lookupIn(held.byKey);
}

const lookupIn = (byKey: Map<string, ListedHit>) => (name: string): ListedHit | null => byKey.get(overseasNameKey(name)) || null;
