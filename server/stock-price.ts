// ─── Stock price service ──────────────────────────────────────────────────
// Fetches market data for listed retail brands from Yahoo Finance's public
// query endpoint. No API key required. Cached in-memory for 6 hours per
// ticker so we don't hammer Yahoo.
//
// Used by Brand Hunter scoring — large caps, rising stocks, and recent
// earnings beats are all strong expansion signals.
// ──────────────────────────────────────────────────────────────────────────

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

interface CacheEntry {
  data: StockSnapshot | null;
  expiresAt: number;
}

interface HistoryCacheEntry {
  data: PricePoint[];
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const HISTORY_CACHE = new Map<string, HistoryCacheEntry>();
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
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

async function fetchFromYahoo(ticker: string): Promise<StockSnapshot | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BGP-Dashboard/1.0)" },
    });
    if (!resp.ok) {
      console.warn(`[stock-price] Yahoo returned ${resp.status} for ${ticker}`);
      return null;
    }
    const json: any = await resp.json();
    const q = json?.quoteResponse?.result?.[0];
    if (!q) return null;

    const currency = q.currency ?? null;
    const marketCap = typeof q.marketCap === "number" ? q.marketCap : null;
    const fiftyTwoWeekChange = typeof q.fiftyTwoWeekChange === "number"
      ? q.fiftyTwoWeekChange
      : (typeof q.fiftyTwoWeekChangePercent === "number" ? q.fiftyTwoWeekChangePercent / 100 : null);

    const marketCapGBP = fxToGBP(marketCap, currency);

    return {
      ticker: q.symbol ?? ticker,
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
  } catch (err: any) {
    console.warn(`[stock-price] fetch failed for ${ticker}: ${err.message}`);
    return null;
  }
}

/**
 * Look up a single ticker. Cached 6h. Returns null if Yahoo can't resolve it
 * or the fetch failed — caller should treat missing data as "no stock signal".
 */
export async function getStockSnapshot(ticker: string): Promise<StockSnapshot | null> {
  if (!ticker || !ticker.trim()) return null;
  const key = ticker.trim().toUpperCase();
  const now = Date.now();

  const cached = CACHE.get(key);
  if (cached && cached.expiresAt > now) return cached.data;

  const fresh = await fetchFromYahoo(key);
  CACHE.set(key, { data: fresh, expiresAt: now + TTL_MS });
  return fresh;
}

/**
 * Batch lookup. Fetches up to 50 tickers per Yahoo call.
 */
export async function getStockSnapshots(tickers: string[]): Promise<Map<string, StockSnapshot>> {
  const result = new Map<string, StockSnapshot>();
  const toFetch: string[] = [];
  const now = Date.now();

  for (const raw of tickers) {
    if (!raw) continue;
    const key = raw.trim().toUpperCase();
    if (!key) continue;
    const cached = CACHE.get(key);
    if (cached && cached.expiresAt > now) {
      if (cached.data) result.set(key, cached.data);
    } else {
      toFetch.push(key);
    }
  }

  for (let i = 0; i < toFetch.length; i += 50) {
    const chunk = toFetch.slice(i, i + 50);
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(","))}`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BGP-Dashboard/1.0)" },
      });
      if (!resp.ok) {
        console.warn(`[stock-price] batch ${i}-${i + chunk.length} returned ${resp.status}`);
        chunk.forEach(k => CACHE.set(k, { data: null, expiresAt: now + 10 * 60 * 1000 }));
        continue;
      }
      const json: any = await resp.json();
      const rows: any[] = json?.quoteResponse?.result ?? [];
      const gotByTicker = new Map<string, any>();
      for (const r of rows) {
        if (r?.symbol) gotByTicker.set(r.symbol.toUpperCase(), r);
      }
      for (const key of chunk) {
        const q = gotByTicker.get(key);
        if (!q) {
          CACHE.set(key, { data: null, expiresAt: now + TTL_MS });
          continue;
        }
        const currency = q.currency ?? null;
        const marketCap = typeof q.marketCap === "number" ? q.marketCap : null;
        const fiftyTwoWeekChange = typeof q.fiftyTwoWeekChange === "number"
          ? q.fiftyTwoWeekChange
          : (typeof q.fiftyTwoWeekChangePercent === "number" ? q.fiftyTwoWeekChangePercent / 100 : null);
        const marketCapGBP = fxToGBP(marketCap, currency);
        const snap: StockSnapshot = {
          ticker: q.symbol ?? key,
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
        CACHE.set(key, { data: snap, expiresAt: now + TTL_MS });
        result.set(key, snap);
      }
    } catch (err: any) {
      console.warn(`[stock-price] batch fetch failed: ${err.message}`);
      chunk.forEach(k => CACHE.set(k, { data: null, expiresAt: now + 10 * 60 * 1000 }));
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
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BGP-Dashboard/1.0)" },
    });
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
  if (!ticker || !ticker.trim()) return [];
  const key = ticker.trim().toUpperCase();
  const now = Date.now();

  const cached = HISTORY_CACHE.get(key);
  if (cached && cached.expiresAt > now) return cached.data;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?range=3mo&interval=1d&includePrePost=false`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BGP-Dashboard/1.0)" },
    });
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
