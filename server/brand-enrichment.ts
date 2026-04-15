// ─────────────────────────────────────────────────────────────────────────
// Automatic brand enrichment.
//
// Writes AI-generated brand profile fields directly to crm_companies.
// Each field is flagged in ai_generated_fields (jsonb) so the UI can mark it
// with a sparkle and so a human edit strips the flag (the human becomes the
// source of truth).
//
// Triggers:
//   - POST /api/brand/enrich/:companyId       — manual enrichment of one brand
//   - POST /api/brand/enrich/batch            — enrich up to N stale brands
//   - GET  /api/brand/enrich/status           — counts of stale / fresh
//
// The batch endpoint is also exposed as runNightlyBrandEnrichment() for cron.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import Anthropic from "@anthropic-ai/sdk";

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5-20251001";

// Fields Claude is allowed to write. Everything else (CH number, address,
// registered legal name, founded year from CH) we leave alone.
const ENRICHABLE_FIELDS = [
  "concept_pitch",
  "store_count",
  "rollout_status",
  "backers",
  "instagram_handle",
  "description",
  "industry",
  "employee_count",
] as const;

type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

const ROLLOUT_VALUES = ["scaling", "stable", "contracting", "entering_uk", "rumoured"];

function buildPrompt(company: any): string {
  return `You are enriching a UK retail-property CRM record for the brand/company below.

Return a JSON object that best describes this company's current public profile for a commercial property agent. Fields to fill (any you cannot determine with reasonable confidence → null, do not guess):

{
  "concept_pitch": "1-2 sentence plain description of what the brand does / its concept (customer-facing), or null",
  "store_count": integer UK store count or null,
  "rollout_status": one of ${JSON.stringify(ROLLOUT_VALUES)} or null,
  "backers": "Names of investors, parent group, or notable backers (comma-separated string), or null",
  "instagram_handle": "handle without the @, or null",
  "description": "1-sentence corporate description, or null",
  "industry": "e.g. 'Fashion retail', 'QSR restaurant', 'Fitness', or null",
  "employee_count": approximate integer headcount or null
}

Known facts (do not contradict):
- Name: ${JSON.stringify(company.name)}
- Domain: ${company.domain || company.domain_url || "unknown"}
- Companies House: ${company.companies_house_number || "unknown"}
- Existing concept pitch: ${company.concept_pitch || "(none)"}
- Existing store count: ${company.store_count ?? "(none)"}

Output JSON only. No prose, no code fences.`;
}

async function enrichCompany(companyId: string): Promise<{ updated: string[]; skipped: string[]; reason?: string }> {
  const q = await pool.query(
    `SELECT id, name, domain, domain_url, companies_house_number, concept_pitch, store_count,
            rollout_status, backers, instagram_handle, description, industry, employee_count,
            ai_generated_fields
       FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const c = q.rows[0];
  if (!c) return { updated: [], skipped: [], reason: "company not found" };

  const aiFields: Record<string, string> = c.ai_generated_fields || {};

  const prompt = buildPrompt(c);
  let aiOut: any = null;
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });
    const txt = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
    const match = txt.match(/\{[\s\S]*\}/);
    if (match) aiOut = JSON.parse(match[0]);
  } catch (e: any) {
    return { updated: [], skipped: [], reason: `AI call failed: ${e?.message || e}` };
  }

  if (!aiOut || typeof aiOut !== "object") {
    return { updated: [], skipped: [], reason: "AI returned unparseable response" };
  }

  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const field of ENRICHABLE_FIELDS) {
    const aiVal = aiOut[field];
    const existingVal = (c as any)[field];
    const humanEdited = existingVal !== null && existingVal !== undefined && existingVal !== "" && !aiFields[field];

    // Human-edited → never overwrite
    if (humanEdited) {
      skipped.push(`${field} (human-edited)`);
      continue;
    }
    if (aiVal === null || aiVal === undefined) continue;

    // Validate rollout_status
    if (field === "rollout_status" && !ROLLOUT_VALUES.includes(aiVal)) continue;

    // Type coerce ints
    let value: any = aiVal;
    if (field === "store_count" || field === "employee_count") {
      const n = Number(aiVal);
      if (!Number.isFinite(n)) continue;
      value = Math.round(n);
    }
    if (typeof value === "string") value = value.trim();
    if (value === "") continue;

    sets.push(`${field} = $${i++}`);
    vals.push(value);
    aiFields[field] = new Date().toISOString();
    updated.push(field);
  }

  if (updated.length) {
    sets.push(`ai_generated_fields = $${i++}`);
    vals.push(JSON.stringify(aiFields));
  }
  sets.push(`last_enriched_at = now()`);
  sets.push(`updated_at = now()`);
  vals.push(companyId);

  await pool.query(
    `UPDATE crm_companies SET ${sets.join(", ")} WHERE id = $${i}`,
    vals
  );

  return { updated, skipped };
}

// ─── Endpoints ──────────────────────────────────────────────────────────

// Enrich a single company right now
router.post("/api/brand/enrich/:companyId", requireAuth, async (req: Request, res: Response) => {
  try {
    const out = await enrichCompany(String(req.params.companyId));
    res.json(out);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Batch enrich — stale tracked brands first, then other brand-like companies
router.post("/api/brand/enrich/batch", requireAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.body?.limit ?? 25), 100);
    const ids = await selectStaleCompanies(limit);
    const results: any[] = [];
    for (const id of ids) {
      const r = await enrichCompany(id);
      results.push({ id, ...r });
      // tiny gap to avoid hammering
      await new Promise(r => setTimeout(r, 250));
    }
    res.json({ processed: ids.length, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Status — how much work is pending
router.get("/api/brand/enrich/status", requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE is_tracked_brand = true AND merged_into_id IS NULL)::int AS tracked_total,
         COUNT(*) FILTER (WHERE is_tracked_brand = true AND merged_into_id IS NULL AND last_enriched_at IS NULL)::int AS tracked_never,
         COUNT(*) FILTER (WHERE is_tracked_brand = true AND merged_into_id IS NULL AND last_enriched_at < now() - INTERVAL '30 days')::int AS tracked_stale,
         COUNT(*) FILTER (WHERE merged_into_id IS NULL)::int AS all_companies
       FROM crm_companies`
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function selectStaleCompanies(limit: number): Promise<string[]> {
  // Priority:
  //  1. tracked brands that have never been enriched
  //  2. tracked brands with stale enrichment (>30d)
  //  3. any brand-like company (company_type ilike '%brand%' or has concept_pitch) never enriched
  const { rows } = await pool.query(
    `SELECT id FROM crm_companies
      WHERE merged_into_id IS NULL
        AND (
          (is_tracked_brand = true AND last_enriched_at IS NULL)
          OR (is_tracked_brand = true AND last_enriched_at < now() - INTERVAL '30 days')
          OR (company_type ILIKE '%brand%' AND last_enriched_at IS NULL)
        )
      ORDER BY
        is_tracked_brand DESC,
        last_enriched_at ASC NULLS FIRST
      LIMIT $1`,
    [limit]
  );
  return rows.map(r => r.id);
}

// ─── Cron entry (called from server/index.ts nightly tick) ──────────────
export async function runNightlyBrandEnrichment() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[brand-enrich] skipped — no ANTHROPIC_API_KEY");
    return;
  }
  const ids = await selectStaleCompanies(50);
  if (!ids.length) {
    console.log("[brand-enrich] nothing stale");
    return;
  }
  console.log(`[brand-enrich] enriching ${ids.length} companies`);
  let ok = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const r = await enrichCompany(id);
      if (r.reason) failed++; else ok++;
    } catch {
      failed++;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`[brand-enrich] done — ${ok} enriched, ${failed} failed`);
}

export default router;
