// ─── AML market-data overlay ──────────────────────────────────────────────
// For listed counterparties (PLCs, big retailers etc.) market data is a fast,
// free, public signal that helps the sweep:
//  - Listed = subject to FCA continuous-disclosure rules → lower fraud risk
//  - Recent earnings beats / analyst upgrades = financial covenant healthy
//  - Halts / sharp drops = run a closer look (could be insolvency-adjacent)
//
// We piggyback on stock-price.ts (Yahoo Finance, no key required), and leave
// hooks for paid commercial credit data (Creditsafe, Red Flag Alert, Experian)
// when an account is in place.
// ──────────────────────────────────────────────────────────────────────────

import { searchTicker, getStockSnapshot, type StockSnapshot } from "./stock-price";

export interface AmlMarketData {
  listed: boolean;
  ticker: string | null;
  exchange: string | null;
  marketCapGBP: number | null;
  fiftyTwoWeekChange: number | null;
  signals: {
    largeCap: boolean;
    midCap: boolean;
    sharpDrop: boolean;          // -30%+ in 52 weeks → look closer
    strongMomentum: boolean;
    halted: boolean;             // price === null mid-trading-day
  };
  creditSafe?: {
    configured: boolean;
    score?: number | null;
    riskBand?: string | null;
    insolvencyFlag?: boolean;
    fetchedAt?: string;
  };
  fetchedAt: string;
}

// Paid commercial credit data — Creditsafe / Red Flag Alert / Experian.
// All three sit behind an API key + account; this is the no-op fallback.
// When a key is added (CREDITSAFE_API_KEY etc.) replace this with the real
// adapter.
async function fetchCreditsafeSnapshot(_companyNumber: string | null): Promise<AmlMarketData["creditSafe"]> {
  if (!process.env.CREDITSAFE_USERNAME && !process.env.CREDITSAFE_API_KEY) {
    return { configured: false };
  }
  // TODO: real Creditsafe Connect API call when account is provisioned.
  // POST https://connect.creditsafe.com/v1/authenticate → token
  // GET  https://connect.creditsafe.com/v1/companies/{country}/{regNo}/report
  return { configured: false };
}

export async function fetchAmlMarketData(
  companyName: string,
  companiesHouseNumber: string | null,
): Promise<AmlMarketData> {
  const out: AmlMarketData = {
    listed: false,
    ticker: null,
    exchange: null,
    marketCapGBP: null,
    fiftyTwoWeekChange: null,
    signals: {
      largeCap: false,
      midCap: false,
      sharpDrop: false,
      strongMomentum: false,
      halted: false,
    },
    fetchedAt: new Date().toISOString(),
  };

  // Yahoo Finance — find a UK-listed match first, fall back to any equity
  try {
    const suggestions = await searchTicker(companyName);
    if (suggestions.length > 0) {
      // Prefer LSE listing (.L suffix) if present
      const preferred = suggestions.find(s => s.symbol?.endsWith(".L")) || suggestions[0];
      const snap: StockSnapshot | null = await getStockSnapshot(preferred.symbol);
      if (snap) {
        out.listed = true;
        out.ticker = snap.ticker;
        out.exchange = snap.exchange;
        out.marketCapGBP = snap.marketCapGBP;
        out.fiftyTwoWeekChange = snap.fiftyTwoWeekChange;
        out.signals.largeCap = !!snap.signals?.largeCap;
        out.signals.midCap = !!snap.signals?.midCap;
        out.signals.strongMomentum = !!snap.signals?.strongMomentum;
        if (snap.fiftyTwoWeekChange != null && snap.fiftyTwoWeekChange < -0.30) {
          out.signals.sharpDrop = true;
        }
        if (snap.price === null && snap.exchange) {
          out.signals.halted = true;
        }
      }
    }
  } catch (e: any) {
    console.warn("[aml-market] Yahoo lookup failed:", e?.message);
  }

  // Creditsafe / commercial credit (gated on API key).
  out.creditSafe = await fetchCreditsafeSnapshot(companiesHouseNumber);

  return out;
}

export function hasMarketSignals(d: AmlMarketData): boolean {
  return d.listed || (d.creditSafe?.score != null);
}
