// App/AI spend metering — every AI call the app makes gets logged with its
// token usage and priced against the official rate card, so the Finance
// dashboard can estimate spend by provider and feature. Token counts come
// from provider responses; prices use published standard USD rates, not invoices.
//
// Image generation (Gemini / gpt-image-1) is billed per-image with rates
// that vary by size/quality — we count images always, and only price them
// when the flat per-image override envs are set:
//   AI_IMAGE_COST_USD_GEMINI / AI_IMAGE_COST_USD_OPENAI
//
// The table is created by this module on first use (same self-ensuring
// pattern as ensureIngestColumns) — no shared/schema.ts change.

import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireEquityOrAdmin } from "./auth";

// USD per million tokens. Existing Anthropic rates are retained except where
// a model-specific current rate is known. Saved costs are not recalculated.
const RATE_CARD: Array<{ match: RegExp; in: number; out: number; cacheRead: number; cacheWrite: number }> = [
  // Fable was unpriced here, so the dashboard showed ~$5/month while it ran
  // most of ChatBGP (Woody, 2026-09-29).
  { match: /^claude-fable-5-1(?:-\d{8})?$/i, in: 10, out: 50, cacheRead: 0.25, cacheWrite: 12.50 },
  { match: /^claude-(?:fable|mythos)-5(?:-\d{8})?$/i, in: 10, out: 50, cacheRead: 1.00, cacheWrite: 12.50 },
  { match: /opus-5-5/i, in: 4,  out: 20, cacheRead: 0.20, cacheWrite: 5.00 },
  { match: /opus-5|opus-4/i, in: 5,  out: 25, cacheRead: 0.50, cacheWrite: 6.25 },
  { match: /sonnet-5/i, in: 2,  out: 10, cacheRead: 0.20, cacheWrite: 2.50 },
  { match: /sonnet-4/i, in: 3,  out: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  { match: /haiku-4/i,  in: 1,  out: 5,  cacheRead: 0.10, cacheWrite: 1.25 },
];

// Official model pages, checked 2026-09-30:
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
// https://developers.openai.com/api/docs/models/gpt-6-sol
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://developers.openai.com/api/docs/models/gpt-6-astra
// Exact model IDs and dated snapshots only; do not price unknown variants.
const OPENAI_RATE_CARD: typeof RATE_CARD = [
  { match: /^gpt-6\.1-sol(?:-\d{4}-\d{2}-\d{2})?$/i, in: 2, out: 10, cacheRead: 0.10, cacheWrite: 2.50 },
  { match: /^gpt-6-sol(?:-\d{4}-\d{2}-\d{2})?$/i, in: 2, out: 10, cacheRead: 0.20, cacheWrite: 2.50 },
  { match: /^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/i, in: 0.10, out: 0.50, cacheRead: 0.01, cacheWrite: 0.125 },
  { match: /^gpt-6-astra(?:-\d{4}-\d{2}-\d{2})?$/i, in: 10, out: 50, cacheRead: 1, cacheWrite: 12.50 },
];

let ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = pool.query(`
      CREATE TABLE IF NOT EXISTS api_usage_log (
        id BIGSERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL DEFAULT now(),
        provider TEXT NOT NULL,
        model TEXT,
        feature TEXT,
        input_tokens BIGINT DEFAULT 0,
        output_tokens BIGINT DEFAULT 0,
        cache_read_tokens BIGINT DEFAULT 0,
        cache_write_tokens BIGINT DEFAULT 0,
        images INT DEFAULT 0,
        cost_usd NUMERIC(12, 6)
      );
      CREATE INDEX IF NOT EXISTS api_usage_log_at_idx ON api_usage_log (at);
      -- Fable calls were logged unpriced; price them at $10 / $50 per MTok
      -- (cache reads $1, writes $12.50). Keep this legacy estimate limited
      -- to Fable 5, not newer versions with different prices.
      UPDATE api_usage_log SET cost_usd = (
          input_tokens * 10.0 + output_tokens * 50.0 + cache_read_tokens * 1.0 + cache_write_tokens * 12.5
        ) / 1000000.0
       WHERE provider = 'anthropic' AND model ~ '^claude-fable-5(-[0-9]{8})?$'
         AND coalesce(cost_usd, 0) = 0;
    `).then(() => undefined).catch((e) => {
      console.warn("[api-usage] table ensure failed:", e?.message);
      ensured = null; // retry on next call
    }) as Promise<void>;
  }
  return ensured;
}

export interface AiUsageEvent {
  provider: "anthropic" | "google" | "openai" | "perplexity" | string;
  model?: string | null;
  feature?: string | null;
  // Normalized disjoint token buckets (as emitted by our AI adapters), or
  // raw OpenAI Responses usage with its inclusive input_tokens and details.
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
      cache_write_tokens?: number;
    } | null;
  } | null;
  images?: number;
  costUsd?: number | null; // explicit override when the caller knows better
}

function priceFor(provider: string, model: string | null | undefined) {
  if (!model) return null;
  const rates = provider === "anthropic" ? RATE_CARD : provider === "openai" ? OPENAI_RATE_CARD : [];
  return rates.find(r => r.match.test(model)) || null;
}

function normalizedUsage(e: AiUsageEvent) {
  const u = e.usage;
  const count = (n: number | undefined) => typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
  let input = count(u?.input_tokens);
  let read = count(u?.cache_read_input_tokens);
  let write = count(u?.cache_creation_input_tokens);
  if (e.provider === "openai" && u?.input_tokens_details) {
    // Responses input_tokens includes both cache buckets. Subtract them once
    // so the database and estimates use the same disjoint representation.
    read = Math.min(input, count(u.input_tokens_details.cached_tokens));
    write = Math.min(input - read, count(u.input_tokens_details.cache_write_tokens));
    input -= read + write;
  }
  return { input, output: count(u?.output_tokens), read, write };
}

function estimateCost(e: AiUsageEvent): number | null {
  if (e.costUsd != null) return e.costUsd;
  if ((e.provider === "anthropic" || e.provider === "openai") && e.usage && !e.images) {
    const rate = priceFor(e.provider, e.model);
    if (!rate) return null;
    if (![e.usage.input_tokens, e.usage.output_tokens, e.usage.cache_read_input_tokens, e.usage.cache_creation_input_tokens]
      .some(n => typeof n === "number" && Number.isFinite(n) && n >= 0)) return null;
    const u = normalizedUsage(e);
    // GPT-6 long-context pricing applies to the entire request, including
    // cached input: above 272k prompt tokens, input/cache 2× and output 1.5×.
    const longContext = e.provider === "openai" && u.input + u.read + u.write > 272_000;
    const inputMultiplier = longContext ? 2 : 1;
    const outputMultiplier = longContext ? 1.5 : 1;
    return (
      (u.input * rate.in + u.read * rate.cacheRead + u.write * rate.cacheWrite) * inputMultiplier +
      u.output * rate.out * outputMultiplier
    ) / 1_000_000;
  }
  if (e.images) {
    const env = e.provider === "google" ? process.env.AI_IMAGE_COST_USD_GEMINI : process.env.AI_IMAGE_COST_USD_OPENAI;
    const per = Number(env);
    if (env && !isNaN(per)) return e.images * per;
  }
  return null;
}

// Fire-and-forget — a metering failure must never break the AI call itself.
export function logAiUsage(e: AiUsageEvent): void {
  const u = normalizedUsage(e);
  ensureTable()
    .then(() =>
      pool.query(
        `INSERT INTO api_usage_log (provider, model, feature, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, images, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          e.provider,
          e.model || null,
          e.feature || null,
          u.input,
          u.output,
          u.read,
          u.write,
          e.images || 0,
          estimateCost(e),
        ],
      ),
    )
    .catch((err: any) => console.warn("[api-usage] log failed:", err?.message));
}

// ── Aggregation endpoint ────────────────────────────────────────────────
const CACHE_TTL_MS = 10 * 60_000;
let cache: { at: number; payload: any } | null = null;

function fyStartIso(): string {
  const now = new Date();
  const y = now.getUTCMonth() >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${y}-05-01`;
}

async function buildCosts(): Promise<any> {
  await ensureTable();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const fy = fyStartIso();

  const [totals, byProvider, byFeature, daily] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(cost_usd) FILTER (WHERE at >= $1), 0)::float AS month_usd,
         COALESCE(SUM(cost_usd) FILTER (WHERE at >= $2::date), 0)::float AS fytd_usd,
         COUNT(*) FILTER (WHERE at >= $1)::int AS month_calls,
         COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) FILTER (WHERE at >= $1), 0)::bigint AS month_tokens,
         COUNT(*) FILTER (WHERE at >= $1 AND cost_usd IS NULL)::int AS month_unpriced_calls,
         COUNT(*) FILTER (WHERE at >= $2::date AND cost_usd IS NULL)::int AS fytd_unpriced_calls,
         COUNT(*) FILTER (WHERE at >= $1 AND cost_usd IS NULL AND images > 0)::int AS month_unpriced_images
       FROM api_usage_log`,
      [monthStart.toISOString(), fy],
    ),
    pool.query(
      `SELECT provider, COALESCE(model, '—') AS model,
              COUNT(*)::int AS calls,
              COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced_calls,
              COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
              COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
              COALESCE(SUM(images), 0)::int AS images,
              COALESCE(SUM(cost_usd), 0)::float AS usd
         FROM api_usage_log
        WHERE at >= $1
        GROUP BY provider, model
        ORDER BY usd DESC, calls DESC`,
      [monthStart.toISOString()],
    ),
    pool.query(
      `SELECT COALESCE(feature, 'other') AS feature,
              COUNT(*)::int AS calls,
              COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced_calls,
              COALESCE(SUM(cost_usd), 0)::float AS usd
         FROM api_usage_log
        WHERE at >= $1
        GROUP BY feature
        ORDER BY usd DESC
        LIMIT 8`,
      [monthStart.toISOString()],
    ),
    pool.query(
      `SELECT to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              COALESCE(SUM(cost_usd), 0)::float AS usd
         FROM api_usage_log
        WHERE at >= now() - interval '30 days'
        GROUP BY 1 ORDER BY 1`,
    ),
  ]);

  // ScraperAPI credits — their account endpoint reports plan usage directly.
  let scraperapi: any = null;
  if (process.env.SCRAPERAPI_KEY) {
    try {
      const r = await fetch(
        `https://api.scraperapi.com/account?api_key=${encodeURIComponent(process.env.SCRAPERAPI_KEY)}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (r.ok) {
        const j: any = await r.json();
        scraperapi = {
          requestCount: j.requestCount ?? null,
          requestLimit: j.requestLimit ?? null,
          subscriptionName: j.subscriptionName || j.plan || null,
        };
      }
    } catch (e: any) {
      console.warn("[api-usage] scraperapi account fetch failed:", e?.message);
    }
  }

  const t = totals.rows[0] || {};
  return {
    monthUsd: Math.round((t.month_usd || 0) * 100) / 100,
    fytdUsd: Math.round((t.fytd_usd || 0) * 100) / 100,
    monthCalls: t.month_calls || 0,
    monthTokens: Number(t.month_tokens || 0),
    monthUnpricedCalls: t.month_unpriced_calls || 0,
    fytdUnpricedCalls: t.fytd_unpriced_calls || 0,
    monthUnpricedImages: t.month_unpriced_images || 0,
    byProvider: byProvider.rows,
    byFeature: byFeature.rows,
    daily: daily.rows,
    scraperapi,
    meteredFrom: "Estimates use provider-reported tokens and published standard USD rates, including known cache and GPT-6 long-context rates. They are not invoices: service tiers, regional uplifts and additional tool fees may differ. Unpriced calls are excluded from totals; previously saved estimates retain their original rates.",
    fetchedAt: new Date().toISOString(),
  };
}

export function registerApiUsageRoutes(app: Express): void {
  app.get("/api/app-costs", requireEquityOrAdmin, async (req: Request, res: Response) => {
    try {
      if (cache && Date.now() - cache.at < CACHE_TTL_MS && req.query.refresh !== "1") {
        return res.json(cache.payload);
      }
      const payload = await buildCosts();
      cache = { at: Date.now(), payload };
      res.json(payload);
    } catch (e: any) {
      console.error("[api-usage] costs error:", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });
}
