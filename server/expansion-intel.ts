// ─────────────────────────────────────────────────────────────────────────
// Expansion Intelligence v2 (Woody, 2026-08-03).
//
// Two halves:
//
//   normaliseBrandFacts — ONE model pass per brand over everything we've
//   gathered (news candidates, Perplexity research, the existing AI signal
//   rows) that emits typed / dated / geo-tagged / confidence-rated facts,
//   deduped across sources via a slug fingerprint. Rebuilds the brand's
//   AI-generated signal set on every run; deal learnings and hand-logged
//   rows are never touched.
//
//   gatherBgpEvidence + covenant grade — the ground-truth inputs for the
//   v2 scorer (computeExpansionScoreV2 in hunter-score.ts): requirements,
//   live deals, offers, viewings, interactions, representation.
//
// Routes:
//   GET  /api/brand/:companyId/expansion-score      — score + sub-scores + why-lines
//   POST /api/brand/:companyId/expansion-refresh    — normalise facts, re-score
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import Anthropic from "@anthropic-ai/sdk";
import { safeParseJSON } from "./utils/anthropic-client";
import { computeExpansionScoreV2, type BgpEvidence, type ExpansionFact } from "./hunter-score";

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL_EXTRACT = "claude-sonnet-4-6";
const MODEL_FALLBACK = "claude-haiku-4-5-20251001";

const FACT_KINDS = ["opening", "closure", "funding", "requirement", "hiring", "exec_change", "sector_move", "news"];

export async function gatherBgpEvidence(companyId: string): Promise<BgpEvidence> {
  const [reqs, deals, offers, viewings, interactions, reps] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM crm_requirements_leasing WHERE company_id = $1 AND status = 'Active'`, [companyId]),
    pool.query(
      `SELECT count(*)::int AS n FROM crm_deals
        WHERE tenant_id = $1
          AND COALESCE(status,'') NOT IN ('WIT','COM','INV','Withdrawn','Completed','Invoiced','Lost','Dead')`,
      [companyId]
    ),
    pool.query(`SELECT count(*)::int AS n FROM unit_offers WHERE company_id = $1 AND created_at >= now() - interval '90 days'`, [companyId]),
    pool.query(`SELECT count(*)::int AS n FROM unit_viewings WHERE company_id = $1 AND created_at >= now() - interval '90 days'`, [companyId]),
    pool.query(
      `SELECT count(*)::int AS n FROM crm_interactions i
        LEFT JOIN crm_contacts c ON c.id = i.contact_id
        WHERE (i.company_id = $1 OR c.company_id = $1)
          AND i.interaction_date >= now() - interval '90 days'`,
      [companyId]
    ),
    pool.query(`SELECT count(*)::int AS n FROM brand_agent_representations WHERE brand_company_id = $1 AND end_date IS NULL`, [companyId]),
  ]);
  return {
    activeRequirements: reqs.rows[0]?.n || 0,
    pipnetRequirements: 0, // filled by the caller from the pipnet cache when warm
    liveDeals: deals.rows[0]?.n || 0,
    offers90d: offers.rows[0]?.n || 0,
    viewings90d: viewings.rows[0]?.n || 0,
    interactions90d: interactions.rows[0]?.n || 0,
    representedBy: reps.rows[0]?.n || 0,
  };
}

async function covenantGradeFor(companyId: string): Promise<{ grade: string | null } | null> {
  const r = await pool.query(
    `SELECT cr.grade FROM covenant_reports cr
      JOIN crm_companies co ON co.companies_house_number = cr.company_number
     WHERE co.id = $1
     ORDER BY cr.computed_at DESC LIMIT 1`,
    [companyId]
  ).catch(() => ({ rows: [] as any[] }));
  return r.rows[0] ? { grade: r.rows[0].grade } : null;
}

async function loadFacts(companyId: string): Promise<ExpansionFact[]> {
  const r = await pool.query(
    `SELECT signal_type, headline, magnitude, sentiment, geography, confidence, signal_date, created_at
       FROM brand_signals
      WHERE brand_company_id = $1
        AND COALESCE(signal_date, created_at) >= now() - interval '24 months'`,
    [companyId]
  );
  return r.rows;
}

export async function scoreBrandExpansion(companyId: string) {
  const brandQ = await pool.query(
    `SELECT id, name, industry, rollout_status, store_count, backers, instagram_handle,
            tiktok_handle, dept_store_presence, franchise_activity, hunter_flag,
            concept_pitch, description, stock_ticker
       FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const brand = brandQ.rows[0];
  if (!brand) return null;
  const [facts, bgp, covenant] = await Promise.all([
    loadFacts(companyId),
    gatherBgpEvidence(companyId),
    covenantGradeFor(companyId),
  ]);
  let stock: any = null;
  if (brand.stock_ticker) {
    try {
      const { getStockSnapshots } = await import("./stock-price");
      const map = await getStockSnapshots([String(brand.stock_ticker).trim().toUpperCase()]);
      stock = Array.from(map.values())[0] || null;
    } catch { /* stock is optional */ }
  }
  return computeExpansionScoreV2({ brand, facts, stock, covenant, bgp });
}

// ─── Fact normalisation — the single extraction pass ────────────────────

export async function normaliseBrandFacts(companyId: string): Promise<{ facts: number; error?: string }> {
  const brandQ = await pool.query(
    `SELECT name, industry, domain_url, brand_analysis FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const brand = brandQ.rows[0];
  if (!brand) return { facts: 0, error: "not found" };

  // Feed the extractor everything machine-collected — flagged rows plus
  // legacy news-linker rows (URL-sourced, written before the flag was set).
  const existingQ = await pool.query(
    `SELECT headline, detail, signal_type, signal_date, source FROM brand_signals
      WHERE brand_company_id = $1
        AND (ai_generated = true OR source LIKE 'http%')
        AND (source IS NULL OR source NOT LIKE 'bgp-deal:%')
        AND COALESCE(signal_date, created_at) >= now() - interval '24 months'
      ORDER BY COALESCE(signal_date, created_at) DESC LIMIT 60`,
    [companyId]
  );
  const newsQ = await pool.query(
    `SELECT title, summary, url, published_at FROM news_articles
      WHERE (title ILIKE '%' || $1 || '%' OR summary ILIKE '%' || $1 || '%')
        AND published_at >= now() - interval '120 days'
      ORDER BY published_at DESC LIMIT 25`,
    [brand.name]
  );

  const material = [
    ...existingQ.rows.map((s: any, i: number) => `S${i}. [${s.signal_type}${s.signal_date ? ` ${new Date(s.signal_date).toISOString().slice(0, 10)}` : ""}] ${s.headline}${s.detail ? ` — ${String(s.detail).slice(0, 160)}` : ""}${s.source?.startsWith("http") ? ` (${s.source})` : ""}`),
    ...newsQ.rows.map((n: any, i: number) => `N${i}. [news${n.published_at ? ` ${new Date(n.published_at).toISOString().slice(0, 10)}` : ""}] ${n.title}${n.summary ? ` — ${String(n.summary).slice(0, 160)}` : ""} (${n.url})`),
  ];
  if (brand.brand_analysis) material.push(`RESEARCH: ${String(brand.brand_analysis).slice(0, 3000)}`);
  if (material.length === 0) return { facts: 0 };

  const prompt = `"${brand.name}" is a UK ${brand.industry || "retail/hospitality"} brand${brand.domain_url ? ` (${brand.domain_url})` : ""} tracked by a commercial property agency that wants to know whether the brand will take NEW UK SPACE in the next 12 months.

Below is everything gathered about the brand — prior signals, news candidates, and research. Normalise it into a deduplicated list of FACTS.

${material.join("\n")}

Rules:
- ONLY facts about ${brand.name} the brand. Discard anything about a different entity sharing the name (sports teams, people, US chains, songs), and stories where the brand is a passing mention.
- MERGE duplicates — the same opening reported three times is ONE fact.
- kind must be one of: ${FACT_KINDS.join(" | ")}. "requirement" = the brand stating what space it wants. "hiring" = store-level recruitment suggesting new sites.
- geography: "uk" | "europe" | "row" | "unknown" — only "uk" when the text says so.
- confidence: "confirmed" (happened / officially announced) | "reported" (credible press) | "rumour".
- date: YYYY-MM-DD when the EVENT happened (not publication) — null if unknown.
- dedupe_key: short kebab-case fingerprint of the event, e.g. "opening-battersea-2026-05".
- source_url: best URL from the material, or null.

Return ONLY a JSON array:
[{"kind":"...","headline":"~12 words","detail":"1-2 sentences","date":"YYYY-MM-DD"|null,"geography":"...","confidence":"...","magnitude":"small|medium|large","sentiment":"positive|neutral|negative","source_url":"..."|null,"dedupe_key":"..."}]
Return [] if nothing survives.`;

  let text = "";
  for (const model of [MODEL_EXTRACT, MODEL_FALLBACK]) {
    try {
      const r = await anthropic.messages.create({ model, max_tokens: 8000, messages: [{ role: "user", content: prompt }] });
      text = r.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
      break;
    } catch (e: any) {
      console.warn(`[expansion-intel] ${brand.name}: ${model} failed (${e?.message})`);
    }
  }
  if (!text) {
    console.warn(`[expansion-intel] ${brand.name}: no extraction text from any model`);
    return { facts: 0, error: "extraction unavailable" };
  }

  // Models often fence the JSON (```json … ```) — strip before parsing.
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let facts: any[] = [];
  try {
    facts = safeParseJSON(unfenced);
    if (!Array.isArray(facts)) facts = [];
  } catch {
    console.warn(`[expansion-intel] ${brand.name}: parse failed — raw starts: ${text.slice(0, 200)}`);
    return { facts: 0, error: "parse failed" };
  }
  facts = facts.filter(f => f && f.headline && FACT_KINDS.includes(f.kind));

  // Guard against a bad model day wiping a healthy fact set: if we had
  // plenty of signals and the extraction returned nothing, keep the old set.
  if (facts.length === 0 && existingQ.rows.length > 3) {
    console.warn(`[expansion-intel] ${brand.name}: extraction returned 0 facts (had ${existingQ.rows.length} signals) — keeping previous set. Raw starts: ${text.slice(0, 200)}`);
    return { facts: 0, error: "kept previous facts" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM brand_signals
        WHERE brand_company_id = $1 AND ai_generated = true
          AND (source IS NULL OR source NOT LIKE 'bgp-deal:%')`,
      [companyId]
    );
    for (const f of facts) {
      await client.query(
        `INSERT INTO brand_signals
           (brand_company_id, signal_type, headline, detail, source, signal_date,
            magnitude, sentiment, geography, confidence, dedupe_key, ai_generated)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
         ON CONFLICT (brand_company_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
        [
          companyId, f.kind, String(f.headline).slice(0, 500), f.detail || null,
          f.source_url || null, f.date || null, f.magnitude || "medium",
          f.sentiment || "neutral", f.geography || "unknown",
          f.confidence || "reported", f.dedupe_key ? String(f.dedupe_key).slice(0, 120) : null,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (e: any) {
    await client.query("ROLLBACK");
    console.error(`[expansion-intel] ${brand.name}: write failed — ${e?.message}`);
    return { facts: 0, error: e?.message };
  } finally {
    client.release();
  }
  console.log(`[expansion-intel] ${brand.name}: normalised to ${facts.length} facts`);
  return { facts: facts.length };
}

// Nightly pass — normalise the brands most in need: fresh AI signals that
// haven't been through the extractor yet (dedupe_key IS NULL), oldest-junk
// first, capped so the nightly run stays cheap (~25 Sonnet calls).
export async function nightlyNormalisePass(cap = 25): Promise<{ brands: number; facts: number }> {
  const q = await pool.query(
    `SELECT brand_company_id AS id, count(*) AS pending
       FROM brand_signals s
       JOIN crm_companies c ON c.id = s.brand_company_id AND c.is_tracked_brand = true
      WHERE s.ai_generated = true AND s.dedupe_key IS NULL
        AND (s.source IS NULL OR s.source NOT LIKE 'bgp-deal:%')
      GROUP BY brand_company_id
      ORDER BY count(*) DESC
      LIMIT $1`,
    [cap]
  );
  let brands = 0, facts = 0;
  for (const row of q.rows) {
    const r = await normaliseBrandFacts(row.id).catch((e: any) => ({ facts: 0, error: e?.message }));
    brands++;
    facts += r.facts || 0;
  }
  if (brands > 0) console.log(`[expansion-intel] nightly pass: ${brands} brands normalised, ${facts} facts`);
  return { brands, facts };
}

// ─── Routes ──────────────────────────────────────────────────────────────

router.get("/api/brand/:companyId/expansion-score", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    const result = await scoreBrandExpansion(companyId);
    if (!result) return res.status(404).json({ error: "not found" });
    res.json({ ...result, inFlight: pendingNormalise.has(companyId) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Normalisation runs 60-120s (one big Sonnet pass) and the edge proxy 504s
// anything over ~45s, so the POST kicks a background job and returns 202;
// callers poll GET /expansion-score (which reports inFlight) for the result.
const pendingNormalise = new Map<string, Promise<void>>();

router.post("/api/brand/:companyId/expansion-refresh", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    if (pendingNormalise.has(companyId)) {
      return res.status(202).json({ accepted: true, inFlight: true, alreadyRunning: true });
    }
    const job = (async () => {
      try {
        await normaliseBrandFacts(companyId);
      } catch (e: any) {
        console.error(`[expansion-intel] refresh ${companyId}: ${e?.message}`);
      } finally {
        pendingNormalise.delete(companyId);
      }
    })();
    pendingNormalise.set(companyId, job);
    res.status(202).json({ accepted: true, inFlight: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
