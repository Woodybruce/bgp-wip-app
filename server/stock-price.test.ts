/**
 * stock-price.test.ts — ticker normalization, negative caching, the
 * ok / invalid-symbol / provider-error state model, and the Yahoo → CNBC →
 * Stooq fallback order for market data.
 *
 * Yahoo, CNBC and Stooq access are mocked at the global fetch layer; no
 * network, no proxy env vars, so yahooFetch/stooqFetch always take the
 * direct path.
 *
 * Run with: node --import tsx --test server/stock-price.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTicker,
  getStockSnapshot,
  getStockSnapshotState,
  getStockSnapshots,
  getHistoricalPrices,
  NEGATIVE_TTL_MS,
} from "./stock-price";
import { displayTicker, toStooqSymbol, toCnbcSymbol } from "../shared/stock-ticker";

// ─── fetch mock ───────────────────────────────────────────────────────────
// v7 quote rows exist only for symbols in KNOWN_QUOTES. Symbols in DOWN
// make both v7 and the v8 chart endpoint fail (provider error). Any other
// symbol gets an empty v7 result (invalid symbol).
const KNOWN_QUOTES: Record<string, any> = {
  "HMSO.L": {
    symbol: "HMSO.L",
    regularMarketPrice: 312.4,
    currency: "GBp",
    marketCap: 1_500_000_000,
    fiftyTwoWeekChangePercent: 25,
    trailingPE: 9.5,
    fullExchangeName: "London",
    shortName: "Hammerson",
  },
  "BATCH1.L": {
    symbol: "BATCH1.L",
    regularMarketPrice: 100,
    currency: "GBp",
    marketCap: 600_000_000,
    fiftyTwoWeekChangePercent: 45,
    fullExchangeName: "London",
    shortName: "Batch One",
  },
};
const DOWN = new Set(["DOWNCO", "STOOQONLY.L", "DENIEDCO.L", "HEADERONLY.L", "CNBCONLY.L", "CNBCDOWN.L"]);
// Q1BLOCKED symbols get a 429 on query1.finance.yahoo.com but succeed on
// query2 — mirrors production, where Yahoo's edge blocks Railway's egress
// IP on query1 only.
const Q1_BLOCKED = new Set(["Q1BLOCKED.L"]);
KNOWN_QUOTES["Q1BLOCKED.L"] = {
  symbol: "Q1BLOCKED.L",
  regularMarketPrice: 42,
  currency: "GBp",
  marketCap: null,
  fiftyTwoWeekChangePercent: null,
  fullExchangeName: "London",
  shortName: "Query One Blocked",
};

// Stooq fixtures: CSV served for these .uk symbols. Symbols in STOOQ_DOWN
// fail at the HTTP layer; symbols in STOOQ_DENIED answer "Access denied"
// (the no-apikey response); anything else gets an empty body — Stooq's
// answer for a symbol it doesn't know.
const STOOQ_QUOTES: Record<string, string> = {
  "stooqonly.uk": [
    "Date,Open,High,Low,Close,Volume",
    "2025-09-18,250,255,248,252,1200000",
    "2026-09-17,310,315,308,312,900000",
    "2026-09-18,312,318,310,315,950000",
  ].join("\n"),
  "headeronly.uk": "Date,Open,High,Low,Close,Volume\n",
};
const STOOQ_DOWN = new Set(["downco.us"]); // DOWNCO has no suffix → downco.us
const STOOQ_DENIED = new Set(["deniedco.uk"]);

// CNBC fixtures: symbols in CNBC_QUOTES get a quote payload, CNBC_CHARTS
// supplies the companion chart bars. Symbols in CNBC_DOWN fail at the HTTP
// layer; anything else gets an empty FormattedQuote — CNBC's "never heard
// of it", which the fallback chain deliberately treats as weak evidence
// (narrower coverage) and NOT as invalid-symbol.
const CNBC_QUOTES: Record<string, any> = {
  "CNBCONLY-GB": {
    symbol: "CNBCONLY-GB", code: 0, name: "Cnbc Only PLC", last: "343.40",
    last_time: "2026-09-18", currencyCode: "GBp", exchange: "London Stock Exchange",
    pe: "8.61", mktcapView: "2.01B", yrhiprice: "391.80", yrloprice: "280.40",
  },
};
const CNBC_CHARTS: Record<string, any[]> = {
  "CNBCONLY-GB": [
    { close: "280.00", tradeTimeinMills: Date.parse("2025-09-18T00:00:00Z") },
    { close: "312.00", tradeTimeinMills: Date.parse("2026-03-18T00:00:00Z") },
    { close: "343.40", tradeTimeinMills: Date.parse("2026-09-18T00:00:00Z") },
  ],
};
const CNBC_DOWN = new Set(["CNBCDOWN-GB"]);

let calls: string[] = [];
const realFetch = globalThis.fetch;

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

globalThis.fetch = (async (input: any): Promise<Response> => {
  const url = String(input);
  calls.push(url);
  if (url.startsWith("https://query1.finance.yahoo.com/") && [...Q1_BLOCKED].some((s) => url.includes(s))) {
    return new Response("Too Many Requests", { status: 429 });
  }
  if (url.startsWith("https://fc.yahoo.com/")) {
    return new Response("", { status: 200, headers: { "set-cookie": "A1=test-cookie; Path=/" } });
  }
  if (url.includes("/v1/test/getcrumb")) {
    return new Response("test-crumb", { status: 200 });
  }
  if (url.includes("/v7/finance/quote")) {
    const symbols = decodeURIComponent(url.match(/symbols=([^&]+)/)?.[1] ?? "").split(",");
    if (symbols.some((s) => DOWN.has(s))) return new Response("boom", { status: 500 });
    const result = symbols.map((s) => KNOWN_QUOTES[s]).filter(Boolean);
    return jsonResponse({ quoteResponse: { result } });
  }
  if (url.includes("/v8/finance/chart/")) {
    const symbol = decodeURIComponent(url.match(/chart\/([^?]+)/)?.[1] ?? "");
    if (DOWN.has(symbol)) return new Response("boom", { status: 500 });
    return new Response(JSON.stringify({ chart: { error: { code: "Not Found", description: "No data found, symbol may be delisted" } } }), { status: 404 });
  }
  if (url.startsWith("https://stooq.com/")) {
    const symbol = decodeURIComponent(url.match(/[?&]s=([^&]+)/)?.[1] ?? "");
    if (STOOQ_DOWN.has(symbol)) return new Response("boom", { status: 500 });
    if (STOOQ_DENIED.has(symbol)) return new Response("Access denied", { status: 200, headers: { "content-type": "text/plain" } });
    const csv = STOOQ_QUOTES[symbol];
    if (csv != null) return new Response(csv, { status: 200, headers: { "content-type": "text/csv" } });
    return new Response("", { status: 200, headers: { "content-type": "text/csv" } });
  }
  if (url.startsWith("https://quote.cnbc.com/")) {
    const symbol = decodeURIComponent(url.match(/[?&]symbols=([^&]+)/)?.[1] ?? "");
    if (CNBC_DOWN.has(symbol)) return new Response("boom", { status: 500 });
    const q = CNBC_QUOTES[symbol];
    return jsonResponse({ FormattedQuoteResult: { FormattedQuote: q ? [q] : [] } });
  }
  if (url.startsWith("https://ts-api.cnbc.com/")) {
    const symbol = decodeURIComponent(url.match(/[?&]symbol=([^&]+)/)?.[1] ?? "");
    if (CNBC_DOWN.has(symbol)) return new Response("boom", { status: 500 });
    return jsonResponse({ barData: { priceBars: CNBC_CHARTS[symbol] ?? [] } });
  }
  return new Response("unexpected", { status: 500 });
}) as any;

after(() => {
  globalThis.fetch = realFetch;
});

const v7CallsFor = (symbol: string) =>
  calls.filter((u) => u.includes("/v7/finance/quote") && decodeURIComponent(u).includes(`symbols=${symbol}`)).length;

// ─── normalizeTicker ──────────────────────────────────────────────────────
describe("normalizeTicker", () => {
  it("strips London exchange prefixes and appends the .L suffix", () => {
    assert.equal(normalizeTicker("LON:HMSO"), "HMSO.L");
    assert.equal(normalizeTicker("LSE:BLND"), "BLND.L");
    assert.equal(normalizeTicker("XLON:WTW"), "WTW.L");
  });

  it("keeps an existing Yahoo suffix (no double .L)", () => {
    assert.equal(normalizeTicker("LSE:JD.L"), "JD.L");
    assert.equal(normalizeTicker("MC.PA"), "MC.PA");
  });

  it("trims and uppercases; US tickers pass through untouched", () => {
    assert.equal(normalizeTicker(" lon:hso "), "HSO.L");
    assert.equal(normalizeTicker("nke"), "NKE");
    assert.equal(normalizeTicker("LULU"), "LULU");
  });

  it("maps the stored HMSON typo to Hammerson's HMSO.L", () => {
    assert.equal(normalizeTicker("HMSON"), "HMSO.L");
    assert.equal(normalizeTicker("hmson"), "HMSO.L");
  });

  it("returns null for empty / unusable input", () => {
    assert.equal(normalizeTicker(""), null);
    assert.equal(normalizeTicker("   "), null);
    assert.equal(normalizeTicker("LON:"), null);
    assert.equal(normalizeTicker("LSE: "), null);
  });

  it("handles the stored 'LSE: HMSON' display string (label + space + typo)", () => {
    // The production Hammerson value — prefix regex must absorb the space
    // after the colon so the alias map sees bare "HMSON".
    assert.equal(normalizeTicker("LSE: HMSON"), "HMSO.L");
    assert.equal(normalizeTicker("LSE: HMSO"), "HMSO.L");
    assert.equal(normalizeTicker("LON:  BLND.L"), "BLND.L");
  });

  it("strips US exchange labels; bare US tickers stay suffix-free", () => {
    assert.equal(normalizeTicker("NASDAQ: AAPL"), "AAPL");
    assert.equal(normalizeTicker("NYSE:NKE"), "NKE");
    assert.equal(normalizeTicker("NYSEARCA: VOO"), "VOO");
  });

  it("maps non-London exchange labels to their Yahoo suffix", () => {
    assert.equal(normalizeTicker("EPA: MC"), "MC.PA");
    assert.equal(normalizeTicker("ETR: BMW"), "BMW.DE");
    assert.equal(normalizeTicker("TSX: SHOP"), "SHOP.TO");
  });
});

describe("displayTicker / toStooqSymbol", () => {
  it("displayTicker cleans stored display strings for the collapsed card", () => {
    assert.equal(displayTicker("LSE: HMSON"), "HMSO.L");
    assert.equal(displayTicker("NASDAQ: AAPL"), "AAPL");
    assert.equal(displayTicker("JD.L"), "JD.L");
  });

  it("toStooqSymbol maps London and US symbols; other venues have no mapping", () => {
    assert.equal(toStooqSymbol("HMSO.L"), "hmso.uk");
    assert.equal(toStooqSymbol("NKE"), "nke.us");
    assert.equal(toStooqSymbol("MC.PA"), null);
  });

  it("toCnbcSymbol maps London to -GB and passes bare US tickers through", () => {
    assert.equal(toCnbcSymbol("HMSO.L"), "HMSO-GB");
    assert.equal(toCnbcSymbol("NKE"), "NKE");
    assert.equal(toCnbcSymbol("MC.PA"), null); // unverified venue → no mapping
  });
});

describe("Stooq fallback", () => {
  it("serves the quote from Stooq when Yahoo fails entirely", async () => {
    const r = await getStockSnapshotState("STOOQONLY.L");
    assert.equal(r.status, "ok");
    assert.equal(r.provider, "stooq");
    assert.equal(r.snapshot?.ticker, "STOOQONLY.L");
    assert.equal(r.snapshot?.price, 315);        // last daily close
    assert.equal(r.snapshot?.currency, "GBp");   // Stooq quotes LSE in pence
    assert.equal(r.snapshot?.fiftyTwoWeekHigh, 318);
    assert.equal(r.snapshot?.fiftyTwoWeekLow, 248);
    // (315 - 252) / 252 = +25% YoY
    assert.ok(Math.abs((r.snapshot?.fiftyTwoWeekChange ?? 0) - 0.25) < 1e-9);
    assert.equal(r.snapshot?.signals.stockMomentum, true);
    // Daily feed — quoteTimestamp is the trading day, not the fetch time.
    assert.equal(r.snapshot?.quoteTimestamp, "2026-09-18T00:00:00.000Z");
  });

  it("seeds the history cache from the Stooq CSV (mini chart works while Yahoo is blocked)", async () => {
    const before = calls.filter((u) => u.includes("STOOQONLY.L") && u.includes("range=3mo")).length;
    const history = await getHistoricalPrices("STOOQONLY.L");
    assert.equal(history.length, 3);
    assert.equal(history[history.length - 1].close, 315);
    // Served from the seeded cache — no Yahoo 3mo chart fetch happened.
    assert.equal(calls.filter((u) => u.includes("STOOQONLY.L") && u.includes("range=3mo")).length, before);
  });

  it("does not call Stooq when Yahoo answers (fallback order)", async () => {
    calls = [];
    const r = await getStockSnapshotState("LON:BATCH1");
    assert.equal(r.status, "ok");
    assert.equal(r.provider, "yahoo");
    assert.ok(!calls.some((u) => u.includes("stooq.com")), "Stooq must not be queried when Yahoo succeeded");
  });

  it("reports invalid-symbol when Yahoo is down but Stooq answered with no data", async () => {
    const r = await getStockSnapshotState("HEADERONLY.L");
    assert.equal(r.status, "invalid-symbol");
    assert.equal(r.snapshot, null);
  });

  it("keeps provider-error when Yahoo fails and Stooq denies access (no apikey)", async () => {
    const r = await getStockSnapshotState("DENIEDCO.L");
    assert.equal(r.status, "provider-error");
    assert.equal(r.snapshot, null);
  });

  it("keeps provider-error when both providers fail at the HTTP layer", async () => {
    const r = await getStockSnapshotState("DOWNCO");
    assert.equal(r.status, "provider-error");
  });

  it("fails over to query2 when query1 answers 429 (Railway egress block)", async () => {
    calls = [];
    const r = await getStockSnapshotState("Q1BLOCKED.L");
    assert.equal(r.status, "ok");
    assert.equal(r.provider, "yahoo");
    assert.equal(r.snapshot?.price, 42);
    assert.ok(
      calls.some((u) => u.startsWith("https://query2.finance.yahoo.com/") && u.includes("Q1BLOCKED.L")),
      "expected a query2 retry after query1's 429",
    );
  });
});

// ─── CNBC fallback ────────────────────────────────────────────────────────
describe("CNBC fallback", () => {
  it("serves CNBC when Yahoo is down: parsed quote, scaled cap, chart-derived YoY", async () => {
    const r = await getStockSnapshotState("CNBCONLY.L");
    assert.equal(r.status, "ok");
    assert.equal(r.provider, "cnbc");
    assert.equal(r.snapshot?.ticker, "CNBCONLY.L");
    assert.equal(r.snapshot?.price, 343.4);
    assert.equal(r.snapshot?.currency, "GBp");
    assert.ok(Math.abs((r.snapshot?.marketCap ?? 0) - 2.01e9) < 1);     // "2.01B" parsed
    assert.ok(Math.abs((r.snapshot?.marketCapGBP ?? 0) - 2.01e9) < 1);  // GBp caps are already in pounds
    assert.equal(r.snapshot?.peRatio, 8.61);
    assert.equal(r.snapshot?.fiftyTwoWeekHigh, 391.8);
    assert.equal(r.snapshot?.fiftyTwoWeekLow, 280.4);
    // (343.40 - 280.00) / 280.00 — from the companion 1Y chart, not the quote.
    assert.ok(Math.abs((r.snapshot?.fiftyTwoWeekChange ?? 0) - 63.4 / 280) < 1e-9);
    assert.equal(r.snapshot?.signals.largeCap, true);
    // CNBC carries the trading date only — the timestamp stays date-level.
    assert.equal(r.snapshot?.quoteTimestamp, "2026-09-18T00:00:00.000Z");
  });

  it("seeds the history cache from the CNBC chart (mini chart works while Yahoo is blocked)", async () => {
    await getStockSnapshotState("CNBCONLY.L"); // ensures the seed regardless of test order
    const before = calls.filter((u) => u.includes("CNBCONLY.L") && u.includes("range=3mo")).length;
    const history = await getHistoricalPrices("CNBCONLY.L");
    assert.equal(history.length, 3);
    assert.equal(history[0].date, "2025-09-18");
    assert.equal(history[history.length - 1].close, 343.4);
    // Served from the seeded cache — no Yahoo 3mo chart fetch happened.
    assert.equal(calls.filter((u) => u.includes("CNBCONLY.L") && u.includes("range=3mo")).length, before);
  });

  it("ignores CNBC's unknown-symbol verdict and still falls through to Stooq", async () => {
    // STOOQONLY.L: Yahoo down, CNBC answers empty (invalid), Stooq serves.
    const r = await getStockSnapshotState("STOOQONLY.L");
    assert.equal(r.status, "ok");
    assert.equal(r.provider, "stooq");
  });

  it("falls through a CNBC HTTP failure to Stooq's verdict", async () => {
    // CNBCDOWN.L: Yahoo down, CNBC 500, Stooq answers with no data.
    const r = await getStockSnapshotState("CNBCDOWN.L");
    assert.equal(r.status, "invalid-symbol");
  });

  it("does not call CNBC when Yahoo answers (fallback order)", async () => {
    calls = [];
    const r = await getStockSnapshotState("LON:BATCH1");
    assert.equal(r.status, "ok");
    assert.equal(r.provider, "yahoo");
    assert.ok(!calls.some((u) => u.includes("cnbc.com")), "CNBC must not be queried when Yahoo succeeded");
  });
});

// ─── state model + caching ────────────────────────────────────────────────
describe("getStockSnapshotState", () => {
  before(() => {
    calls = [];
  });

  it("resolves the aliased HMSON to an ok quote for HMSO.L via Yahoo", async () => {
    const r = await getStockSnapshotState("HMSON");
    assert.equal(r.status, "ok");
    assert.equal(r.snapshot?.ticker, "HMSO.L");
    assert.equal(r.snapshot?.currency, "GBp");
    assert.equal(r.snapshot?.signals.largeCap, true); // £1.5bn cap
    // Yahoo was queried for the normalized symbol, not the raw stored value.
    assert.ok(calls.some((u) => u.includes("symbols=HMSO.L")));
    assert.ok(!calls.some((u) => u.includes("symbols=HMSON")));
  });

  it("serves a repeat lookup from the 6h success cache (no new fetch)", async () => {
    const before = calls.length;
    const r = await getStockSnapshotState("HMSON");
    assert.equal(r.status, "ok");
    assert.equal(calls.length, before);
  });

  it("classifies a symbol Yahoo doesn't know as invalid-symbol", async () => {
    const r = await getStockSnapshotState("NOSUCHCO");
    assert.equal(r.status, "invalid-symbol");
    assert.equal(r.snapshot, null);
  });

  it("classifies v7+chart failures as provider-error", async () => {
    const r = await getStockSnapshotState("DOWNCO");
    assert.equal(r.status, "provider-error");
    assert.equal(r.snapshot, null);
  });

  it("returns invalid-symbol without any fetch for unusable input", async () => {
    const before = calls.length;
    const r = await getStockSnapshotState("   ");
    assert.equal(r.status, "invalid-symbol");
    assert.equal(calls.length, before);
  });
});

describe("negative caching", () => {
  it("bounds the negative cache at ≤60s", () => {
    assert.ok(NEGATIVE_TTL_MS <= 60_000, `NEGATIVE_TTL_MS=${NEGATIVE_TTL_MS} exceeds 60s`);
  });

  it("caches invalid-symbol misses briefly — a repeat call does not refetch…", async () => {
    const before = v7CallsFor("NOSUCHCO");
    const r = await getStockSnapshotState("NOSUCHCO");
    assert.equal(r.status, "invalid-symbol");
    assert.equal(v7CallsFor("NOSUCHCO"), before);
  });

  it("…and the same short negative cache covers provider errors", async () => {
    const beforeV7 = v7CallsFor("DOWNCO");
    const beforeChart = calls.filter((u) => u.includes("/v8/finance/chart/DOWNCO")).length;
    const r = await getStockSnapshotState("DOWNCO");
    assert.equal(r.status, "provider-error");
    assert.equal(v7CallsFor("DOWNCO"), beforeV7);
    assert.equal(calls.filter((u) => u.includes("/v8/finance/chart/DOWNCO")).length, beforeChart);
  });
});

describe("getStockSnapshot (legacy wrapper)", () => {
  it("returns the snapshot on ok and null on failure states", async () => {
    assert.equal((await getStockSnapshot("HMSON"))?.ticker, "HMSO.L");
    assert.equal(await getStockSnapshot("NOSUCHCO"), null);
    assert.equal(await getStockSnapshot(""), null);
  });
});

describe("getStockSnapshots (batch)", () => {
  it("normalizes before lookup but keys the result map by the raw ticker", async () => {
    const map = await getStockSnapshots(["LON:BATCH1", "BATCHBAD", "", "  "]);
    const hit = map.get("LON:BATCH1");
    assert.equal(hit?.ticker, "BATCH1.L");
    assert.equal(hit?.signals.strongMomentum, true); // +45% YoY
    assert.equal(map.has("BATCHBAD"), false); // invalid symbol — absent, not an exception
    assert.equal(map.size, 1);
  });

  it("shares the cache between raw spellings (HMSON ≡ HMSO.L) and negative-caches misses", async () => {
    const map = await getStockSnapshots(["HMSO.L", "hmson", "BATCHBAD"]);
    assert.equal(map.get("HMSO.L")?.ticker, "HMSO.L");
    assert.equal(map.get("HMSON")?.ticker, "HMSO.L");
    assert.equal(map.has("BATCHBAD"), false);
  });
});
