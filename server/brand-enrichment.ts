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
import { pool, db } from "./db";
import { imageStudioImages } from "@shared/schema";
import { eq, and, ilike } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";

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
  "backers_detail": [{"name":"Backer Co","type":"PE fund|VC|parent group|angel|sovereign wealth|family office|other","description":"1-sentence about who they are and what they're known for"}] or null — up to 5 most notable backers/investors,
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

  // Store structured backers_detail in ai_generated_fields (not a column, just JSONB)
  if (Array.isArray(aiOut.backers_detail) && aiOut.backers_detail.length > 0) {
    aiFields.backers_detail = aiOut.backers_detail;
    if (!updated.includes("backers_detail")) updated.push("backers_detail");
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

  // Auto-fetch brand images (fire-and-forget — don't block the enrichment response)
  if (c.is_tracked_brand || updated.includes("concept_pitch")) {
    fetchBrandImages(companyId, c.name, aiOut?.industry || c.industry || undefined).catch(e =>
      console.warn(`[brand-images] Background fetch failed for ${c.name}:`, e?.message)
    );
  }

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

// ─── Auto-fetch brand images via Unsplash / Pexels ─────────────────────
//
// Called after AI enrichment. Searches for storefront / interior / brand
// shots and imports up to 5 into image_studio_images tagged with the
// brand name.  Skipped if brand already has ≥3 images.

const IMAGE_DIR = path.join(process.cwd(), "uploads", "image-studio");

async function ensureImageDir() {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
}

async function makeThumbnail(buf: Buffer): Promise<{ thumbnail: string; width: number; height: number }> {
  const meta = await sharp(buf).metadata();
  const thumb = await sharp(buf).resize(200, 200, { fit: "cover" }).jpeg({ quality: 70 }).toBuffer();
  return { thumbnail: thumb.toString("base64"), width: meta.width || 0, height: meta.height || 0 };
}

interface StockHit { url: string; description: string; photographer: string; source: string }

async function searchUnsplash(query: string, count: number): Promise<StockHit[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${key}` } }
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.results || []).map((r: any) => ({
      url: r.urls?.regular || r.urls?.small,
      description: r.description || r.alt_description || query,
      photographer: r.user?.name || "Unsplash",
      source: "unsplash",
    }));
  } catch { return []; }
}

async function searchPexels(query: string, count: number): Promise<StockHit[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
      { headers: { Authorization: key } }
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.photos || []).map((p: any) => ({
      url: p.src?.large || p.src?.medium,
      description: p.alt || query,
      photographer: p.photographer || "Pexels",
      source: "pexels",
    }));
  } catch { return []; }
}

async function fetchBrandImages(companyId: string, brandName: string, industry?: string): Promise<number> {
  // Skip if we already have enough images for this brand
  const existing = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM image_studio_images WHERE LOWER(brand_name) = LOWER($1)`,
    [brandName]
  );
  if ((existing.rows[0]?.cnt || 0) >= 3) return 0;

  await ensureImageDir();

  // Build brand-specific queries — these yield much better results than generic stock
  const concept = industry || "store";
  const queries = [
    `${brandName} ${concept} exterior storefront`,
    `${brandName} ${concept} interior`,
  ];

  const allHits: StockHit[] = [];
  for (const q of queries) {
    const unsplash = await searchUnsplash(q, 3);
    if (unsplash.length > 0) {
      allHits.push(...unsplash);
    } else {
      const pexels = await searchPexels(q, 3);
      allHits.push(...pexels);
    }
    if (allHits.length >= 5) break;
  }

  const toImport = allHits.slice(0, 5);
  let imported = 0;
  for (const hit of toImport) {
    if (!hit.url) continue;
    try {
      const resp = await fetch(hit.url);
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 5000) continue; // skip tiny images

      const filename = `brand-${crypto.randomUUID()}.jpg`;
      const filePath = path.join(IMAGE_DIR, filename);
      await fs.writeFile(filePath, buf);

      const { thumbnail, width, height } = await makeThumbnail(buf);

      await db.insert(imageStudioImages).values({
        fileName: `${brandName} — ${hit.description}`.slice(0, 200),
        category: "Brand",
        tags: ["brand-auto", brandName, hit.source],
        description: `Auto-fetched from ${hit.source} for ${brandName}. Photo: ${hit.photographer}`,
        source: hit.source,
        brandName,
        mimeType: "image/jpeg",
        fileSize: buf.length,
        width,
        height,
        thumbnailData: thumbnail,
        localPath: filePath,
      });
      imported++;
    } catch (err: any) {
      console.warn(`[brand-images] Failed to import image for ${brandName}:`, err.message);
    }
  }
  if (imported > 0) console.log(`[brand-images] Imported ${imported} images for ${brandName}`);
  return imported;
}

export default router;
