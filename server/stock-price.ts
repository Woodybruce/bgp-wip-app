// ─── Stock price service ──────────────────────────────────────────────────
// Fetches market data for listed retail brands from Yahoo Finance's public
// query endpoint. No API key required. Successful quotes are cached
// in-memory for 6 hours per ticker; failed/invalid lookups get a ≤60s
// negative cache so one bad response can't blank the panel for hours.
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
// ──────────────────────────────────────────────────────────────────────────

import { webshareF, isProxyConfigured } from "./proxy-fetch";

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
// Callers need to tell "Yahoo has never heard of this symbol" apart from
// "Yahoo is down / rate-limited us" — the UI shows "unknown ticker" for the
// former and a retryable "provider error" for the latter.
export type StockQuoteStatus = "ok" | "invalid-symbol" | "provider-error";

export interface StockSnapshotLookup {
  status: StockQuoteStatus;
  snapshot: StockSnapshot | null;
}

// ─── Ticker normalization ────────────────────────────────────────────────
// Stored tickers occasionally carry an exchange prefix (LON:HMSO, LSE:JD.L)
// or a typo. Normalize to the bare Yahoo symbol before every lookup.
const EXCHANGE_PREFIX_RE = /^(?:LON|LSE|XLON):/;

// Defensive aliases for known one-off stored mistakes. Keys are the
// prefix-stripped, uppercased stored value; values are the full Yahoo
// symbol. Hammerson is stored as "HMSON" (stray N — the correct LSE ticker
// is HMSO, Yahoo symbol HMSO.L). The durable fix is DB data cleanup in
// Delivery 2/6 — keep this map tiny and explicit until then.
const TICKER_ALIASES: Record<string, string> = {
  HMSON: "HMSO.L",
};

/**
 * Normalize a stored ticker to the Yahoo instrument symbol:
 * trim + uppercase, strip a London exchange prefix (LON:/LSE:/XLON:), apply
 * the alias map, and append the .L suffix for London-prefixed listings that
 * lack one (London listings trade in pence — see mapV7Quote's GBp handling).
 * Tickers that already carry a Yahoo suffix (.L, .PA, …) or have no London
 * prefix pass through unchanged. Returns null when nothing usable remains.
 */
export function normalizeTicker(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim().toUpperCase();
  if (!s) return null;
  const london = EXCHANGE_PREFIX_RE.test(s);
  if (london) s = s.replace(EXCHANGE_PREFIX_RE, "");
  if (!s) return null;
  const alias = TICKER_ALIASES[s];
  if (alias) return alias;
  if (london && !s.includes(".")) s = `${s}.L`;
  return s;
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
      if (q) return { status: "ok", snapshot: mapV7Quote(q, symbol) };
      return { status: "invalid-symbol", snapshot: null };
    }
    const chart = await snapshotViaChart(symbol);
    if (chart.snapshot) return { status: "ok", snapshot: chart.snapshot };
    return chart.notFound
      ? { status: "invalid-symbol", snapshot: null }
      : { status: "provider-error", snapshot: null };
  } catch (err: any) {
    console.warn(`[stock-price] fetch failed for ${symbol}: ${err.message}`);
    return { status: "provider-error", snapshot: null };
  }
}

/**
 * Look up a single ticker with an explicit outcome: "ok" (snapshot
 * attached), "invalid-symbol", or "provider-error". The stored ticker is
 * normalized first (prefix strip, alias map, .L suffix). Successful quotes
 * are cached 6h; failures are negative-cached for NEGATIVE_TTL_MS so a
 * transient error or typo doesn't blank the panel for hours.
 */
export async function getStockSnapshotState(ticker: string): Promise<StockSnapshotLookup> {
  const symbol = normalizeTicker(ticker);
  if (!symbol) return { status: "invalid-symbol", snapshot: null };
  const now = Date.now();

  const cached = CACHE.get(symbol);
  if (cached && cached.expiresAt > now) return cached.data;

  const fresh = await fetchSnapshotFromYahoo(symbol);
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
            ? { status: "ok", snapshot: mapV7Quote(q, symbol) }
            : { status: "invalid-symbol", snapshot: null });
        }
      } else {
        // No crumb — fall back to per-ticker chart lookups, 4 at a time.
        for (let j = 0; j < chunk.length; j += 4) {
          const outcomes = await Promise.all(chunk.slice(j, j + 4).map(async (symbol) => ({
            symbol,
            outcome: await snapshotViaChart(symbol)
              .then((c): StockSnapshotLookup => c.snapshot
                ? { status: "ok", snapshot: c.snapshot }
                : { status: c.notFound ? "invalid-symbol" : "provider-error", snapshot: null })
              .catch((): StockSnapshotLookup => ({ status: "provider-error", snapshot: null })),
          })));
          for (const { symbol, outcome } of outcomes) record(symbol, outcome);
        }
      }
    } catch (err: any) {
      console.warn(`[stock-price] batch fetch failed: ${err.message}`);
      chunk.forEach(symbol => record(symbol, { status: "provider-error", snapshot: null }));
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
