// ─────────────────────────────────────────────────────────────────────────
// Monthly per-brand Perplexity refresh.
//
// For each tracked brand, asks Perplexity to summarise the last 30 days of
// material UK/expansion-relevant news, then uses Haiku to convert the prose
// into structured brand_signals rows. Also refreshes brand_analysis with
// the latest Perplexity-grounded paragraph.
//
// Runs monthly (1st of the month, 03:00). Soft rate-limited by sleeping
// 2s between brands so a 200-brand batch takes ~7 minutes — well within a
// single overnight slot.
//
// Endpoints:
//   POST /api/brand/:companyId/perplexity-refresh   — run for one brand
//   POST /api/brand-perplexity-refresh/run-all      — admin: kick all
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { askPerplexity, isPerplexityConfigured } from "./perplexity";
import Anthropic from "@anthropic-ai/sdk";
import { safeParseJSON } from "./utils/anthropic-client";
import { invalidateBrandAiTake } from "./brand-ai-take";

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HAIKU = "claude-haiku-4-5-20251001";

// ─── Per-brand refresh ───────────────────────────────────────────────────

interface RefreshResult {
  brandId: string;
  brandName: string;
  signalsAdded: number;
  analysisUpdated: boolean;
  error?: string;
}

export async function refreshBrandFromPerplexity(brandId: string): Promise<RefreshResult> {
  const brandQ = await pool.query(
    `SELECT id, name, industry, uk_entity_name, brand_analysis FROM crm_companies WHERE id = $1`,
    [brandId]
  );
  if (!brandQ.rows[0]) return { brandId, brandName: "?", signalsAdded: 0, analysisUpdated: false, error: "not found" };
  const brand = brandQ.rows[0];

  const result: RefreshResult = { brandId, brandName: brand.name, signalsAdded: 0, analysisUpdated: false };

  try {
    if (!isPerplexityConfigured()) throw new Error("Perplexity not configured");

    // 1. Ask Perplexity for the last 30 days
    const prompt = `What's happened with the brand "${brand.name}"${brand.industry ? ` (${brand.industry})` : ""} in the last 30 days that is materially relevant to UK retail-property strategy?

Focus only on events that affect their physical property footprint or covenant strength:
- New store openings (UK or globally signalling expansion)
- Store closures
- UK market entry rumours
- Funding rounds, M&A, IPO
- C-suite or property/expansion-team leadership changes
- Earnings beats/misses, profit warnings, insolvency news
- Major partnership / wholesale deals

For each event, give: a short headline, what happened, when (approximate date or "early Apr 2026"), and the source URL if cited.

Skip vague brand-marketing news, social-media campaigns, sponsorship deals, product launches, sustainability pledges. If nothing material has happened, say so explicitly.

Be UK-focused. ${brand.uk_entity_name ? `The UK operating entity is "${brand.uk_entity_name}".` : ""}`;

    const ppx = await askPerplexity(prompt, { maxTokens: 1500, temperature: 0.2 });

    // 2. Use Haiku to extract structured signals from the prose
    const extractPrompt = `You are converting a research paragraph into structured retail-property signals.

Brand: ${brand.name}
Research output:
${ppx.answer}

Citations:
${ppx.citations.slice(0, 8).map((c, i) => `[${i + 1}] ${c.url}`).join("\n")}

Extract every material event into a JSON array. Use this schema for each event:
{
  "signal_type": "opening" | "closure" | "funding" | "exec_change" | "sector_move" | "rumour" | "news",
  "headline": "<one-line summary, ~10 words>",
  "detail": "<2-3 sentence detail>",
  "signal_date": "YYYY-MM-DD" | null,
  "magnitude": "small" | "medium" | "large",
  "sentiment": "positive" | "neutral" | "negative",
  "source_url": "<best matching citation URL>" | null
}

Rules:
- Only material events (skip product launches / vague marketing).
- If the research says nothing happened, return [].
- If a date is fuzzy ("late March 2026"), pick the 15th of that month.
- Map UK store openings as "opening", layoffs/store closures as "closure", any funding round as "funding".
- magnitude=large only for >£50m raises, c-suite changes, or major flagship openings.

Return ONLY the JSON array. No commentary.`;

    const haikuRes = await anthropic.messages.create({
      model: HAIKU,
      max_tokens: 1500,
      messages: [{ role: "user", content: extractPrompt }],
    });
    const haikuText = haikuRes.content.map((b: any) => b.type === "text" ? b.text : "").join("").trim();
    let events: any[] = [];
    try {
      events = safeParseJSON(haikuText);
      if (!Array.isArray(events)) events = [];
    } catch (e: any) {
      console.warn(`[brand-perplexity-refresh] Haiku parse failed for ${brand.name}: ${e.message}`);
      events = [];
    }

    // 3. Insert signals (dedup on headline + brand)
    for (const ev of events) {
      if (!ev.headline || !ev.signal_type) continue;
      const dup = await pool.query(
        `SELECT id FROM brand_signals
          WHERE brand_company_id = $1
            AND headline = $2
            AND created_at >= now() - interval '90 days'`,
        [brandId, ev.headline]
      );
      if (dup.rows.length > 0) continue;
      await pool.query(
        `INSERT INTO brand_signals (brand_company_id, signal_type, headline, detail, source, signal_date, magnitude, sentiment, ai_generated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
        [
          brandId,
          ev.signal_type,
          ev.headline,
          ev.detail || null,
          ev.source_url || "perplexity",
          ev.signal_date || null,
          ev.magnitude || "medium",
          ev.sentiment || "neutral",
        ]
      );
      result.signalsAdded++;
    }

    // 4. Refresh brand_analysis if Perplexity returned something substantive
    if (ppx.answer.trim().length > 200) {
      await pool.query(
        `UPDATE crm_companies
            SET brand_analysis = $1,
                brand_analysis_at = now()
          WHERE id = $2`,
        [ppx.answer.trim(), brandId]
      );
      result.analysisUpdated = true;
    }

    invalidateBrandAiTake(brandId);
  } catch (err: any) {
    result.error = err.message;
  }

  return result;
}

// ─── Bulk runner ────────────────────────────────────────────────────────

export async function runMonthlyPerplexityRefresh(): Promise<{ scanned: number; signalsAdded: number; analysisUpdated: number; errors: number }> {
  const brands = await pool.query(
    `SELECT id FROM crm_companies
      WHERE is_tracked_brand = true AND merged_into_id IS NULL
      ORDER BY name`
  );
  let signalsAdded = 0;
  let analysisUpdated = 0;
  let errors = 0;

  for (const b of brands.rows) {
    const r = await refreshBrandFromPerplexity(b.id);
    if (r.error) errors++;
    signalsAdded += r.signalsAdded;
    if (r.analysisUpdated) analysisUpdated++;
    // Soft rate-limit so we don't hammer Perplexity
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`[brand-perplexity-refresh] scanned ${brands.rows.length} brands, +${signalsAdded} signals, ${analysisUpdated} analyses refreshed, ${errors} errors`);
  return { scanned: brands.rows.length, signalsAdded, analysisUpdated, errors };
}

// ─── Endpoints ──────────────────────────────────────────────────────────

router.post("/api/brand/:companyId/perplexity-refresh", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await refreshBrandFromPerplexity(String(req.params.companyId));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand-perplexity-refresh/run-all", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const adminCheck = await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [userId]);
    if (!adminCheck.rows[0]?.is_admin) return res.status(403).json({ error: "Admin only" });
    // Fire-and-forget — bulk run takes minutes
    runMonthlyPerplexityRefresh().catch(e => console.error("[perplexity-refresh] bulk run failed:", e?.message));
    res.json({ started: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
