// App/AI spend metering — every AI call the app makes gets logged with its
// token usage and priced against the official rate card, so the Finance
// dashboard can show exactly what the app is spending, by provider and by
// feature. Token counts come from the providers' own responses (exact);
// prices are per-MTok USD from Anthropic's published pricing.
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
import { requireAdmin } from "./auth";

// USD per million tokens. Matched by substring so dated variants map too.
const RATE_CARD: Array<{ match: RegExp; in: number; out: number; cacheRead: number; cacheWrite: number }> = [
  { match: /opus-4/i,   in: 5,  out: 25, cacheRead: 0.50, cacheWrite: 6.25 },
  { match: /sonnet-4/i, in: 3,  out: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  { match: /haiku-4/i,  in: 1,  out: 5,  cacheRead: 0.10, cacheWrite: 1.25 },
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
  // Anthropic-style usage object — pass response.usage straight through.
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  } | null;
  images?: number;
  costUsd?: number | null; // explicit override when the caller knows better
}

function priceFor(model: string | null | undefined) {
  if (!model) return null;
  return RATE_CARD.find(r => r.match.test(model)) || null;
}

function estimateCost(e: AiUsageEvent): number | null {
  if (e.costUsd != null) return e.costUsd;
  if (e.provider === "anthropic" && e.usage) {
    const rate = priceFor(e.model);
    if (!rate) return null;
    const u = e.usage;
    return (
      (u.input_tokens || 0) * rate.in +
      (u.output_tokens || 0) * rate.out +
      (u.cache_read_input_tokens || 0) * rate.cacheRead +
      (u.cache_creation_input_tokens || 0) * rate.cacheWrite
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
  ensureTable()
    .then(() =>
      pool.query(
        `INSERT INTO api_usage_log (provider, model, feature, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, images, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          e.provider,
          e.model || null,
          e.feature || null,
          e.usage?.input_tokens || 0,
          e.usage?.output_tokens || 0,
          e.usage?.cache_read_input_tokens || 0,
          e.usage?.cache_creation_input_tokens || 0,
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
         COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens) FILTER (WHERE at >= $1), 0)::bigint AS month_tokens,
         COUNT(*) FILTER (WHERE at >= $1 AND cost_usd IS NULL AND images > 0)::int AS month_unpriced_images
       FROM api_usage_log`,
      [monthStart.toISOString(), fy],
    ),
    pool.query(
      `SELECT provider, COALESCE(model, '—') AS model,
              COUNT(*)::int AS calls,
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
    monthUnpricedImages: t.month_unpriced_images || 0,
    byProvider: byProvider.rows,
    byFeature: byFeature.rows,
    daily: daily.rows,
    scraperapi,
    meteredFrom: "Token usage reported by each provider response, priced at the official per-MTok rates (Opus $5/$25, Sonnet $3/$15, Haiku $1/$5; cache reads 0.1×, writes 1.25×).",
    fetchedAt: new Date().toISOString(),
  };
}

export function registerApiUsageRoutes(app: Express): void {
  app.get("/api/app-costs", requireAdmin, async (req: Request, res: Response) => {
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
