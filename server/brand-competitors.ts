// AI-researched brand competitors. Companies House + RocketReach don't give
// us competitors on our current plan (RR's lookupCompany is credit-gated),
// so we ask Claude instead. ~free per call, fully sufficient for retail
// brand-to-brand "who else might want this unit?" questions.
//
// Endpoints:
//   GET  /api/brand/:companyId/competitors           → return stored AI competitors
//   POST /api/brand/:companyId/competitors/research  → run Claude, store result
//
// Storage: crm_companies.ai_competitors JSONB
//   Array<{ name: string; reason?: string; segment?: string }>
import { Router, type Request, type Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7"];

async function callClaude(prompt: string): Promise<string> {
  let lastErr: any = null;
  for (const model of MODELS) {
    try {
      const msg = await anthropic.messages.create({
        model,
        // 800 truncated the JSON mid-array for multi-competitor brands
        // (response cut off at ~12 entries → unparseable 502). 2500 gives
        // headroom for the full 8-12 list with reasons.
        max_tokens: 2500,
        messages: [{ role: "user", content: prompt }],
      });
      const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
      if (text) return text;
    } catch (e: any) {
      lastErr = e;
      console.warn(`[brand-competitors] ${model} failed (${e?.message}), trying next`);
    }
  }
  throw new Error(`AI call failed: ${lastErr?.message || "unknown"}`);
}

function buildPrompt(opts: { name: string; industry: string | null; description: string | null; analysis: string | null; country: string | null }): string {
  return `You are a UK commercial property researcher at Bruce Gillingham Pollard. Identify the top 8-12 closest competitors for this brand — the kind of brand that would pitch for the same retail/F&B unit.

Brand: ${opts.name}
${opts.industry ? `Industry: ${opts.industry}` : ""}
${opts.country ? `HQ country: ${opts.country}` : ""}
${opts.description ? `Description: ${opts.description}` : ""}
${opts.analysis ? `Recent context: ${opts.analysis}` : ""}

Rules:
- Real competitors only. No made-up names.
- Bias toward UK retail relevance — brands that have UK stores or are realistic UK lease prospects.
- Order by closeness of competition (direct positioning > adjacent > peripheral).
- For each, give a one-sentence reason in plain broker English ("similar price point", "competes in same fit-out tier", "shares core demographic").
- Segment is one of: direct / adjacent / aspirational / value (which tier compared to this brand).

Output STRICT JSON, no prose, no markdown fences:
{
  "competitors": [
    { "name": "...", "reason": "...", "segment": "direct" }
  ]
}`;
}

function tryParseJson(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {}
  // strip ``` fences and retry
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {}
  // find the first {...} block
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  return null;
}

router.get("/api/brand/:companyId/competitors", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    const row = await pool.query(
      `SELECT ai_competitors, ai_competitors_at FROM crm_companies WHERE id = $1`,
      [companyId]
    );
    if (!row.rowCount) return res.status(404).json({ error: "Company not found" });
    const r = row.rows[0];
    res.json({
      competitors: r.ai_competitors || [],
      generated_at: r.ai_competitors_at || null,
    });
  } catch (err: any) {
    console.error("[brand-competitors] GET error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand/:companyId/competitors/research", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: "ANTHROPIC_API_KEY not configured" });
    }
    const companyId = String(req.params.companyId);
    const companyRow = await pool.query(
      `SELECT c.id, c.name, c.industry, c.description, c.brand_analysis, brd.payload AS rr
         FROM crm_companies c
         LEFT JOIN brand_rocketreach_data brd ON brd.company_id = c.id
        WHERE c.id = $1`,
      [companyId]
    );
    if (!companyRow.rowCount) return res.status(404).json({ error: "Company not found" });
    const c = companyRow.rows[0];

    const country = c.rr?.country_code || null;
    const industry = c.industry || c.rr?.industry_str || null;

    const prompt = buildPrompt({
      name: c.name,
      industry,
      description: c.description,
      analysis: c.brand_analysis,
      country,
    });

    const raw = await callClaude(prompt);
    const parsed = tryParseJson(raw);
    if (!parsed || !Array.isArray(parsed.competitors)) {
      console.warn(`[brand-competitors] couldn't parse Claude response for ${companyId}:`, raw.slice(0, 200));
      return res.status(502).json({ error: "Couldn't parse AI response", raw: raw.slice(0, 500) });
    }

    const competitors = parsed.competitors
      .filter((x: any) => x && typeof x.name === "string" && x.name.trim())
      .slice(0, 15)
      .map((x: any) => ({
        name: String(x.name).trim(),
        reason: x.reason ? String(x.reason).trim() : null,
        segment: x.segment ? String(x.segment).trim().toLowerCase() : null,
      }));

    await pool.query(
      `UPDATE crm_companies
          SET ai_competitors = $2::jsonb,
              ai_competitors_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [companyId, JSON.stringify(competitors)]
    );

    res.json({ competitors, generated_at: new Date().toISOString() });
  } catch (err: any) {
    console.error("[brand-competitors] research error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
