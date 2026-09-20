// Pure ticker normalisation shared by the server quote providers
// (server/stock-price.ts) and the UI (the collapsed market card shows the
// cleaned symbol without waiting for the quote API). No imports, no I/O.
//
// Stored tickers (crm_companies.stock_ticker — the ONLY market-data field on
// the company record; there is no separate exchange column) occasionally
// carry an exchange label ("LSE: HMSON", "NASDAQ: AAPL") or a typo. The
// exchange label is the only place the listing venue is recorded, so the
// label — not guesswork — drives the Yahoo suffix mapping.

// Exchange label → Yahoo suffix. "" means the bare symbol IS the Yahoo symbol
// (US listings). Labels not in this map are stripped with no suffix added.
const EXCHANGE_SUFFIX: Record<string, string> = {
  LON: ".L",
  LSE: ".L",
  XLON: ".L",
  NASDAQ: "",
  NYSE: "",
  NYSEARCA: "",
  ARCA: "",
  AMEX: "",
  NYSEAMERICAN: "",
  EPA: ".PA",   // Euronext Paris
  XPAR: ".PA",
  AMS: ".AS",   // Euronext Amsterdam
  XAMS: ".AS",
  ETR: ".DE",   // Xetra
  XETRA: ".DE",
  FWB: ".DE",
  TSX: ".TO",
  ASX: ".AX",
  JPX: ".T",
  TSE: ".T",
  HKEX: ".HK",
  SEHK: ".HK",
};

// "LSE: HMSON" / "NASDAQ:AAPL" — label, colon, optional whitespace, symbol.
const EXCHANGE_PREFIX_RE = /^([A-Z]{2,12})\s*:\s*(\S.*)$/;

// Defensive aliases for known one-off stored mistakes. Keys are the
// prefix-stripped, uppercased stored value; values are the full Yahoo
// symbol. Hammerson is stored as "HMSON" (stray N — the correct LSE ticker
// is HMSO, Yahoo symbol HMSO.L). The durable fix is DB data cleanup in
// Delivery 2/6 — keep this map tiny and explicit until then.
export const TICKER_ALIASES: Record<string, string> = {
  HMSON: "HMSO.L",
};

/**
 * Normalize a stored ticker to the Yahoo instrument symbol:
 * trim + uppercase, strip an exchange label prefix (LON:/LSE:/NASDAQ:/…),
 * apply the alias map, and append the Yahoo suffix the label implies (London
 * listings get .L — they trade in pence; see mapV7Quote's GBp handling).
 * Tickers that already carry a Yahoo suffix (.L, .PA, …) or have no exchange
 * label pass through unchanged. Returns null when nothing usable remains.
 */
export function normalizeTicker(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim().toUpperCase();
  if (!s) return null;
  // A bare label with no symbol ("LON:", "LSE: ") is unusable.
  if (/^[A-Z]{2,12}\s*:\s*$/.test(s)) return null;
  let suffix: string | undefined;
  const prefixed = s.match(EXCHANGE_PREFIX_RE);
  if (prefixed) {
    suffix = EXCHANGE_SUFFIX[prefixed[1]];
    s = prefixed[2].trim();
    if (!s) return null;
  }
  const alias = TICKER_ALIASES[s];
  if (alias) return alias;
  if (suffix && !s.includes(".")) s = `${s}${suffix}`;
  return s;
}

/**
 * What the UI should display for a stored ticker: the normalized Yahoo
 * symbol when one can be derived, else the trimmed raw string. Never null
 * for non-empty input, so the collapsed market card always shows something
 * clean ("HMSO.L", not "LSE: HMSON").
 */
export function displayTicker(raw: string): string {
  return normalizeTicker(raw) ?? raw.trim();
}

/**
 * Map a normalized Yahoo symbol to a Stooq symbol (Stooq is the fallback
 * quote provider). London: HMSO.L → hmso.uk. Bare (US): NKE → nke.us.
 * Other venues have no reliable Stooq mapping here — returns null and the
 * caller treats the quote as Yahoo-only.
 */
export function toStooqSymbol(yahooSymbol: string): string | null {
  const s = yahooSymbol.trim().toLowerCase();
  if (!s) return null;
  if (s.endsWith(".l")) return `${s.slice(0, -2)}.uk`;
  if (!s.includes(".")) return `${s}.us`;
  return null;
}
