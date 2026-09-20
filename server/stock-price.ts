// ─── Stock price service ──────────────────────────────────────────────────
// Fetches market data for listed retail brands, primarily from Yahoo
// Finance's public query endpoint (no API key required). Successful quotes
// are cached in-memory for 6 hours per ticker; failed/invalid lookups get a
// ≤60s negative cache so one bad response can't blank the panel for hours.
//
// Used by Brand Hunter scoring — large caps, rising stocks, and recent
// earnings beats are all strong expansion signals.
//
// Yahoo hardened these endpoints in 2023: v7/finance/quote now requires a
// cookie + crumb pair, and datacenter egress IPs (Railway's included) get
// 429/403 on all of them. Every request therefore goes through yahooFetch —
// direct first, then the Webshare residential proxy — and quote lookups do
// the fc.yahoo.com cookie → getcrumb dance with the v8 chart endpoint (no
// crumb needed) as the fallback when auth can't be established.
//
// When Yahoo fails outright (blocked egress IP, HTTP error, or an unknown
// symbol) the single-quote path falls back to Stooq's free daily CSV —
// see the Stooq section below.
// ──────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { webshareF, isProxyConfigured } from "./proxy-fetch";
import { normalizeTicker, toStooqSymbol } from "@shared/stock-ticker";

export { normalizeTicker } from "@shared/stock-ticker";

const YAHOO_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
};

async function yahooFetch(url: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const headers = { ...YAHOO_HEADERS, ...extraHeaders };
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if ([401, 403, 429].includes(r.status) && isProxyConfigured()) {
      return await webshareF(url, { headers, signal: AbortSignal.timeout(20_000) });
    }
    return r;
  } catch (err) {
    if (isProxyConfigured()) {
      return await webshareF(url, { headers, signal: AbortSignal.timeout(20_000) });
    }
    throw err;
  }
}

let yahooAuth: { cookie: string; crumb: string; expiresAt: number } | null = null;

async function getYahooAuth(): Promise<{ cookie: string; crumb: string } | null> {
  if (yahooAuth && Date.now() < yahooAuth.expiresAt) return yahooAuth;
  try {
    const r1 = await yahooFetch("https://fc.yahoo.com/");
    const cookie = (r1.headers.get("set-cookie") || "").split(";")[0];
    if (!cookie) return null;
    const r2 = await yahooFetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { Cookie: cookie });
    const crumb = (await r2.text()).trim();
    if (!r2.ok || !crumb || crumb.includes("<")) return null;
    yahooAuth = { cookie, crumb, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
    return yahooAuth;
  } catch {
    return null;
  }
}

async function quoteViaV7(symbols: string[]): Promise<any[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const auth = await getYahooAuth();
    if (!auth) return null;
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}&crumb=${encodeURIComponent(auth.crumb)}`;
    const resp = await yahooFetch(url, { Cookie: auth.cookie });
    if (resp.status === 401 || resp.status === 403) {
      yahooAuth = null; // stale crumb — re-auth once
      continue;
    }
    if (!resp.ok) return null;
    const json: any = await resp.json().catch(() => null);
    return json?.quoteResponse?.result ?? null;
  }
  return null;
}

// Crumb-free fallback: one v8 chart call carries price/currency/52w range in
// meta and a year of closes to derive the 52-week change. No marketCap/PE.
// notFound=true means Yahoo returned 404 / a chart error — the symbol doesn't
// exist (invalid), as opposed to a transient provider failure.
async function snapshotViaChart(ticker: string): Promise<{ snapshot: StockSnapshot | null; notFound: boolean }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d&includePrePost=false`;
  const resp = await yahooFetch(url);
  if (resp.status === 404) return { snapshot: null, notFound: true };
  if (!resp.ok) return { snapshot: null, notFound: false };
  const json: any = await resp.json().catch(() => null);
  if (json?.chart?.error) return { snapshot: null, notFound: true };
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) return { snapshot: null, notFound: false };
  const closes: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter((c: any) => typeof c === "number" && isFinite(c));
  const first = closes[0];
  const last = closes[closes.length - 1];
  const change = first && last ? (last - first) / first : null;
  const currency = meta.currency ?? null;
  return {
    notFound: false,
    snapshot: {
      ticker: meta.symbol ?? ticker,
      price: typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : last ?? null,
      currency,
      marketCap: null,
      marketCapGBP: null,
      fiftyTwoWeekHigh: typeof meta.fiftyTwoWeekHigh === "number" ? meta.fiftyTwoWeekHigh : (closes.length ? Math.max(...closes) : null),
      fiftyTwoWeekLow: typeof meta.fiftyTwoWeekLow === "number" ? meta.fiftyTwoWeekLow : (closes.length ? Math.min(...closes) : null),
      fiftyTwoWeekChange: change,
      peRatio: null,
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
      shortName: meta.shortName ?? meta.longName ?? null,
      fetchedAt: new Date().toISOString(),
      quoteTimestamp: typeof meta.regularMarketTime === "number" ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      signals: {
        largeCap: false,
        midCap: false,
        stockMomentum: change != null && change >= 0.20,
        strongMomentum: change != null && change >= 0.40,
      },
    },
  };
}

export interface StockSnapshot {
  ticker: string;
  price: number | null;
  currency: string | null;
  marketCap: number | null;        // in native currency
  marketCapGBP: number | null;     // converted to GBP approx
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekChange: number | null; // fraction, e.g. 0.24 = +24%
  peRatio: number | null;
  exchange: string | null;
  shortName: string | null;
  fetchedAt: string;
  // When the quote itself is as-of (Yahoo regularMarketTime / Stooq's daily
  // close date). Stale/delayed feeds stay honest — the card shows this, not
  // just the fetch time. null when the provider didn't say.
  quoteTimestamp?: string | null;
  // Derived signals used by Brand Hunter scoring
  signals: {
    largeCap: boolean;        // market cap > £500m
    midCap: boolean;          // £50m – £500m
    stockMomentum: boolean;   // up 20%+ over 52 weeks
    strongMomentum: boolean;  // up 40%+ over 52 weeks
  };
}

export interface TickerSuggestion {
  symbol: string;
  shortName: string | null;
  exchange: string | null;
  quoteType: string | null;
}

export interface PricePoint {
  date: string;   // ISO date
  close: number;
}

// ─── Lookup states ────────────────────────────────────────────────────────
// Callers need to tell "the provider has never heard of this symbol" apart
// from "the provider is down / rate-limited us" — the UI shows "symbol not
// recognised" for the former and a retryable "provider error" for the
// latter. `provider` records who served a successful quote so the UI can
// label it and future debugging is easy.
export type StockQuoteProvider = "yahoo" | "stooq";
export type StockQuoteStatus = "ok" | "invalid-symbol" | "provider-error";

export interface StockSnapshotLookup {
  status: StockQuoteStatus;
  snapshot: StockSnapshot | null;
  provider: StockQuoteProvider | null;
}

interface CacheEntry {
  data: StockSnapshotLookup;
  expiresAt: number;
}

interface HistoryCacheEntry {
  data: PricePoint[];
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const HISTORY_CACHE = new Map<string, HistoryCacheEntry>();
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — successful quotes only
// Failed/invalid lookups are retried after a minute, not 6h — one bad
// response or a typo'd ticker must not blank the panel for hours.
export const NEGATIVE_TTL_MS = 60 * 1000;
const HISTORY_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Rough FX — close enough for bucketing by cap size
const FX_TO_GBP: Record<string, number> = {
  GBP: 1,
  GBp: 0.01,  // pence
  USD: 0.79,
  EUR: 0.86,
  JPY: 0.0052,
  HKD: 0.10,
};

function fxToGBP(amount: number | null, currency: string | null): number | null {
  if (amount == null) return null;
  const rate = currency ? (FX_TO_GBP[currency] ?? 1) : 1;
  return amount * rate;
}

function mapV7Quote(q: any, fallbackTicker: string): StockSnapshot {
  const currency = q.currency ?? null;
  const marketCap = typeof q.marketCap === "number" ? q.marketCap : null;
  const fiftyTwoWeekChange = typeof q.fiftyTwoWeekChange === "number"
    ? q.fiftyTwoWeekChange
    : (typeof q.fiftyTwoWeekChangePercent === "number" ? q.fiftyTwoWeekChangePercent / 100 : null);
  // Yahoo prices LSE stocks in pence (GBp) but reports marketCap already in
  // pounds — running it through the pence FX rate shrank every London cap
  // 100× (Landsec came out at £53m). Only currency-convert non-GBp caps.
  const marketCapGBP = currency === "GBp" ? marketCap : fxToGBP(marketCap, currency);
  return {
    ticker: q.symbol ?? fallbackTicker,
    price: typeof q.regularMarketPrice === "number" ? q.regularMarketPrice : null,
    currency,
    marketCap,
    marketCapGBP,
    fiftyTwoWeekHigh: typeof q.fiftyTwoWeekHigh === "number" ? q.fiftyTwoWeekHigh : null,
    fiftyTwoWeekLow: typeof q.fiftyTwoWeekLow === "number" ? q.fiftyTwoWeekLow : null,
    fiftyTwoWeekChange,
    peRatio: typeof q.trailingPE === "number" ? q.trailingPE : null,
    exchange: q.fullExchangeName ?? q.exchange ?? null,
    shortName: q.shortName ?? q.longName ?? null,
    fetchedAt: new Date().toISOString(),
    quoteTimestamp: typeof q.regularMarketTime === "number" ? new Date(q.regularMarketTime * 1000).toISOString() : null,
    signals: {
      largeCap:        marketCapGBP != null && marketCapGBP >= 500_000_000,
      midCap:          marketCapGBP != null && marketCapGBP >= 50_000_000 && marketCapGBP < 500_000_000,
      stockMomentum:   fiftyTwoWeekChange != null && fiftyTwoWeekChange >= 0.20,
      strongMomentum:  fiftyTwoWeekChange != null && fiftyTwoWeekChange >= 0.40,
    },
  };
}

// Fetch a normalized Yahoo symbol, classifying the outcome so callers can
// distinguish a symbol Yahoo doesn't know (v7 answered with no row, or the
// chart endpoint 404s) from a transient provider/auth/network failure.
async function fetchSnapshotFromYahoo(symbol: string): Promise<StockSnapshotLookup> {
  try {
    const rows = await quoteViaV7([symbol]);
    if (rows) {
      const q = rows[0];
      if (q) return { status: "ok", snapshot: mapV7Quote(q, symbol), provider: "yahoo" };
      return { status: "invalid-symbol", snapshot: null, provider: null };
    }
    const chart = await snapshotViaChart(symbol);
    if (chart.snapshot) return { status: "ok", snapshot: chart.snapshot, provider: "yahoo" };
    return chart.notFound
      ? { status: "invalid-symbol", snapshot: null, provider: null }
      : { status: "provider-error", snapshot: null, provider: null };
  } catch (err: any) {
    console.warn(`[stock-price] fetch failed for ${symbol}: ${err.message}`);
    return { status: "provider-error", snapshot: null, provider: null };
  }
}

// ─── Stooq fallback provider ─────────────────────────────────────────────
// Yahoo blocks some datacenter egress IPs wholesale (production evidence:
// every HMSO.L lookup provider-errors from Railway while resolving fine
// from a residential connection). Stooq's free daily CSV is the fallback.
//
// Reality check (verified 2026-09-20): the old intraday endpoint
// (stooq.com/q/l/?f=sd2t2ohlcv&e=csv) now 404s, and the daily download
// endpoint (q/d/l/) requires TWO things since ~April 2026:
//   1. a JavaScript proof-of-work cookie (sha256 nonce → POST /__verify) —
//      solved inline by stooqFetch, cookie cached for the session, and
//   2. an `apikey` query param for CSV data (email Stooq / CAPTCHA on the
//      site to get one) — set STOOQ_API_KEY on the environment.
// Without a key Stooq answers "Access denied" and the fallback reports a
// provider error, preserving the honest UI state. UK symbols use the .uk
// suffix (hmso.uk); quotes are daily closes (delayed) — the snapshot's
// quoteTimestamp carries the trading date so the card stays honest.

let stooqAuth: { cookie: string; expiresAt: number } | null = null;

function looksLikeStooqChallenge(status: number, contentType: string, body: string): boolean {
  return status === 200 && contentType.includes("text/html") && body.includes("/__verify");
}

async function solveStooqChallenge(body: string, cookie: string): Promise<string | null> {
  const m = body.match(/const c="([^"]+)",d=(\d+)/);
  if (!m) return null;
  const [, challenge, difficulty] = m;
  const target = "0".repeat(Number(difficulty));
  let n = 0;
  while (!createHash("sha256").update(challenge + n).digest("hex").startsWith(target)) n++;
  const verify = await fetch("https://stooq.com/__verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) },
    body: `c=${encodeURIComponent(challenge)}&n=${n}`,
  });
  if (!verify.ok) return null;
  const auth = (verify.headers.get("set-cookie") || "").split(";")[0];
  if (!auth.includes("=")) return null;
  return [cookie, auth].filter(Boolean).join("; ");
}

async function stooqFetch(url: string): Promise<Response> {
  const doFetch = () => fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      ...(stooqAuth ? { Cookie: stooqAuth.cookie } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  let resp = await doFetch();
  // Anti-bot challenge? Solve it once, cache the cookie (24h Max-Age), retry.
  if (resp.ok) {
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      const body = await resp.text();
      if (looksLikeStooqChallenge(resp.status, contentType, body)) {
        const cookie = await solveStooqChallenge(body, stooqAuth?.cookie ?? "");
        if (cookie) {
          stooqAuth = { cookie, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
          resp = await doFetch();
        }
      } else {
        // Not a challenge — hand the HTML back as the response body so the
        // caller classifies it (it won't parse as CSV → provider error).
        return new Response(body, { status: resp.status, headers: resp.headers });
      }
    }
  }
  if (stooqAuth && Date.now() >= stooqAuth.expiresAt) stooqAuth = null;
  return resp;
}

interface StooqRow {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

// Stooq daily CSV: header "Date,Open,High,Low,Close,Volume" then one row per
// trading day. Unknown symbols return an empty body; rate-limit/key problems
// return plain text ("Access denied", "Exceeded the daily hits limit", …).
function parseStooqCsv(text: string): StooqRow[] {
  const rows: StooqRow[] = [];
  for (const line of text.trim().split(/\r?\n/)) {
    if (!line || /^date,/i.test(line)) continue;
    const [date, open, high, low, close, volume] = line.split(",");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) continue; // skips "Access denied" etc.
    const num = (v: string | undefined) => {
      const n = Number(v);
      return v != null && v !== "" && v !== "N/D" && isFinite(n) ? n : null;
    };
    rows.push({ date, open: num(open), high: num(high), low: num(low), close: num(close), volume: num(volume) });
  }
  return rows;
}

// null = no Stooq equivalent for this listing (Yahoo-only suffix like .PA).
async function fetchSnapshotFromStooq(symbol: string): Promise<(StockSnapshotLookup & { history?: PricePoint[] }) | null> {
  const stooqSymbol = toStooqSymbol(symbol);
  if (!stooqSymbol) return null;
  try {
    const d2 = new Date();
    const d1 = new Date(d2.getTime() - 400 * 24 * 60 * 60 * 1000); // ≥ 52 weeks of trading days
    const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const key = process.env.STOOQ_API_KEY || "";
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&d1=${ymd(d1)}&d2=${ymd(d2)}&i=d${key ? `&apikey=${encodeURIComponent(key)}` : ""}`;
    const resp = await stooqFetch(url);
    if (!resp.ok) return { status: "provider-error", snapshot: null, provider: null };
    const text = await resp.text();
    const rows = parseStooqCsv(text);
    const priced = rows.filter((r) => r.close != null);
    if (priced.length === 0) {
      // A syntactically valid CSV with zero rows means Stooq answered but
      // doesn't know the symbol; anything else (Access denied, HTML) is a
      // provider problem.
      const answered = text.trim() === "" || /^date,/i.test(text.trim());
      return answered
        ? { status: "invalid-symbol", snapshot: null, provider: null }
        : { status: "provider-error", snapshot: null, provider: null };
    }
    const first = priced[0];
    const last = priced[priced.length - 1];
    const change = first.close && last.close ? (last.close - first.close) / first.close : null;
    const highs = rows.map((r) => r.high).filter((n): n is number => n != null);
    const lows = rows.map((r) => r.low).filter((n): n is number => n != null);
    const uk = stooqSymbol.endsWith(".uk");
    const snapshot: StockSnapshot = {
      ticker: symbol,
      price: last.close,
      currency: uk ? "GBp" : "USD", // Stooq quotes LSE in pence, US in dollars
      marketCap: null,
      marketCapGBP: null,
      fiftyTwoWeekHigh: highs.length ? Math.max(...highs) : null,
      fiftyTwoWeekLow: lows.length ? Math.min(...lows) : null,
      fiftyTwoWeekChange: change,
      peRatio: null,
      exchange: uk ? "London" : null,
      shortName: null,
      fetchedAt: new Date().toISOString(),
      // Daily feed — the quote is as-of the last trading day, not now.
      quoteTimestamp: `${last.date}T00:00:00.000Z`,
      signals: {
        largeCap: false,
        midCap: false,
        stockMomentum: change != null && change >= 0.20,
        strongMomentum: change != null && change >= 0.40,
      },
    };
    const history: PricePoint[] = priced.map((r) => ({ date: r.date, close: r.close as number }));
    return { status: "ok", snapshot, provider: "stooq", history };
  } catch (err: any) {
    console.warn(`[stock-price] stooq fetch failed for ${symbol}: ${err.message}`);
    return { status: "provider-error", snapshot: null, provider: null };
  }
}

// Yahoo first, Stooq when Yahoo fails for any reason (blocked egress IP,
// HTTP error, unknown symbol). invalid-symbol wins over provider-error when
// either provider answered "no such symbol" — a successful lookup that found
// nothing is stronger evidence than a fetch that never got through.
async function fetchSnapshotWithFallback(symbol: string): Promise<StockSnapshotLookup> {
  const yahoo = await fetchSnapshotFromYahoo(symbol);
  if (yahoo.status === "ok") return yahoo;
  const stooq = await fetchSnapshotFromStooq(symbol);
  if (stooq?.status === "ok" && stooq.snapshot) {
    // The Stooq response already carries a year of daily closes — seed the
    // history cache (3-month slice) so the card's mini chart renders even
    // while Yahoo's chart endpoint is unreachable.
    if (stooq.history?.length) {
      HISTORY_CACHE.set(symbol, { data: stooq.history.slice(-63), expiresAt: Date.now() + HISTORY_TTL_MS });
    }
    return { status: "ok", snapshot: stooq.snapshot, provider: "stooq" };
  }
  if (yahoo.status === "invalid-symbol" || stooq?.status === "invalid-symbol") {
    return { status: "invalid-symbol", snapshot: null, provider: null };
  }
  return { status: "provider-error", snapshot: null, provider: null };
}

/**
 * Look up a single ticker with an explicit outcome: "ok" (snapshot
 * attached), "invalid-symbol", or "provider-error". The stored ticker is
 * normalized first (prefix strip, alias map, .L suffix), then Yahoo is tried
 * first with Stooq as the fallback — `provider` on the result says who
 * served the quote. Successful quotes are cached 6h under the normalized
 * instrument (so editing a company's ticker changes the cache key and
 * fetches fresh); failures are negative-cached for NEGATIVE_TTL_MS so a
 * transient error or typo doesn't blank the panel for hours.
 */
export async function getStockSnapshotState(ticker: string): Promise<StockSnapshotLookup> {
  const symbol = normalizeTicker(ticker);
  if (!symbol) return { status: "invalid-symbol", snapshot: null, provider: null };
  const now = Date.now();

  const cached = CACHE.get(symbol);
  if (cached && cached.expiresAt > now) return cached.data;

  const fresh = await fetchSnapshotWithFallback(symbol);
  CACHE.set(symbol, { data: fresh, expiresAt: now + (fresh.status === "ok" ? TTL_MS : NEGATIVE_TTL_MS) });
  return fresh;
}

/**
 * Look up a single ticker. Returns null if Yahoo can't resolve it or the
 * fetch failed — caller should treat missing data as "no stock signal".
 * Use getStockSnapshotState when the caller needs to tell an invalid symbol
 * apart from a provider error.
 */
export async function getStockSnapshot(ticker: string): Promise<StockSnapshot | null> {
  return (await getStockSnapshotState(ticker)).snapshot;
}

/**
 * Batch lookup. Fetches up to 50 tickers per Yahoo call.
 * Tickers are normalized before lookup and cached under the normalized Yahoo
 * symbol (so `HMSON` and `HMSO.L` share an entry), but the returned map is
 * keyed by the caller's raw trimmed/uppercased ticker for compatibility.
 * Successful quotes cache 6h; misses/errors negative-cache NEGATIVE_TTL_MS.
 */
export async function getStockSnapshots(tickers: string[]): Promise<Map<string, StockSnapshot>> {
  const result = new Map<string, StockSnapshot>();
  const toFetch: string[] = []; // unique normalized symbols
  const keysBySymbol = new Map<string, string[]>();
  const now = Date.now();

  for (const raw of tickers) {
    if (!raw) continue;
    const key = raw.trim().toUpperCase();
    if (!key) continue;
    const symbol = normalizeTicker(raw);
    if (!symbol) continue; // unusable input — simply absent from the result
    const keys = keysBySymbol.get(symbol) ?? [];
    keys.push(key);
    keysBySymbol.set(symbol, keys);
    const cached = CACHE.get(symbol);
    if (cached && cached.expiresAt > now) {
      if (cached.data.snapshot) for (const k of keys) result.set(k, cached.data.snapshot);
    } else if (keys.length === 1) {
      toFetch.push(symbol);
    }
  }

  for (let i = 0; i < toFetch.length; i += 50) {
    const chunk = toFetch.slice(i, i + 50);
    const record = (symbol: string, outcome: StockSnapshotLookup) => {
      CACHE.set(symbol, { data: outcome, expiresAt: now + (outcome.status === "ok" ? TTL_MS : NEGATIVE_TTL_MS) });
      if (outcome.snapshot) {
        for (const k of keysBySymbol.get(symbol) ?? []) result.set(k, outcome.snapshot);
      }
    };
    try {
      const rows = await quoteViaV7(chunk);
      if (rows) {
        const gotBySymbol = new Map<string, any>();
        for (const r of rows) {
          if (r?.symbol) gotBySymbol.set(String(r.symbol).toUpperCase(), r);
        }
        for (const symbol of chunk) {
          const q = gotBySymbol.get(symbol);
          record(symbol, q
            ? { status: "ok", snapshot: mapV7Quote(q, symbol), provider: "yahoo" }
            : { status: "invalid-symbol", snapshot: null, provider: null });
        }
      } else {
        // No crumb — fall back to per-ticker chart lookups, 4 at a time.
        // (Batch stays Yahoo-only: Stooq is per-ticker and would be 50
        // serial CSV fetches here. The single-quote path has the fallback.)
        for (let j = 0; j < chunk.length; j += 4) {
          const outcomes = await Promise.all(chunk.slice(j, j + 4).map(async (symbol) => ({
            symbol,
            outcome: await snapshotViaChart(symbol)
              .then((c): StockSnapshotLookup => c.snapshot
                ? { status: "ok", snapshot: c.snapshot, provider: "yahoo" }
                : { status: c.notFound ? "invalid-symbol" : "provider-error", snapshot: null, provider: null })
              .catch((): StockSnapshotLookup => ({ status: "provider-error", snapshot: null, provider: null })),
          })));
          for (const { symbol, outcome } of outcomes) record(symbol, outcome);
        }
      }
    } catch (err: any) {
      console.warn(`[stock-price] batch fetch failed: ${err.message}`);
      chunk.forEach(symbol => record(symbol, { status: "provider-error", snapshot: null, provider: null }));
    }
  }

  return result;
}

/**
 * Search Yahoo Finance for ticker suggestions by company name.
 * Returns up to 6 EQUITY results — enough to show a small picker.
 */
export async function searchTicker(name: string): Promise<TickerSuggestion[]> {
  if (!name || !name.trim()) return [];
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false`;
    const resp = await yahooFetch(url);
    if (!resp.ok) return [];
    const json: any = await resp.json();
    const quotes: any[] = json?.quotes ?? [];
    return quotes
      .filter((q: any) => q.quoteType === "EQUITY")
      .slice(0, 6)
      .map((q: any) => ({
        symbol: q.symbol,
        shortName: q.shortname ?? q.longname ?? null,
        exchange: q.exchange ?? null,
        quoteType: q.quoteType ?? null,
      }));
  } catch (err: any) {
    console.warn(`[stock-price] search failed for "${name}": ${err.message}`);
    return [];
  }
}

/**
 * Fetch 3-month daily closing prices for a ticker.
 * Used to render a mini price chart in the brand profile.
 * Cached 4h.
 */
export async function getHistoricalPrices(ticker: string): Promise<PricePoint[]> {
  const key = normalizeTicker(ticker);
  if (!key) return [];
  const now = Date.now();

  const cached = HISTORY_CACHE.get(key);
  if (cached && cached.expiresAt > now) return cached.data;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?range=3mo&interval=1d&includePrePost=false`;
    const resp = await yahooFetch(url);
    if (!resp.ok) {
      console.warn(`[stock-price] history ${resp.status} for ${key}`);
      HISTORY_CACHE.set(key, { data: [], expiresAt: now + 15 * 60 * 1000 });
      return [];
    }
    const json: any = await resp.json();
    const result = json?.chart?.result?.[0];
    if (!result) {
      HISTORY_CACHE.set(key, { data: [], expiresAt: now + 15 * 60 * 1000 });
      return [];
    }
    const timestamps: number[] = result.timestamp ?? [];
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const points: PricePoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (typeof c === "number" && isFinite(c)) {
        points.push({
          date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
          close: c,
        });
      }
    }
    HISTORY_CACHE.set(key, { data: points, expiresAt: now + HISTORY_TTL_MS });
    return points;
  } catch (err: any) {
    console.warn(`[stock-price] history fetch failed for ${key}: ${err.message}`);
    HISTORY_CACHE.set(key, { data: [], expiresAt: now + 15 * 60 * 1000 });
    return [];
  }
}
