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
import { askPerplexity, isPerplexityConfigured } from "./perplexity";
import { getBrandIdentity } from "./brand-identity";
import { knownBrandLegalIdentity, verifyBrandIdentityFromOfficialSite } from "./brand-identity-verification";
import { CLIENT_CRM_CATEGORIES } from "@shared/tenant-categories";
import { BRAND_PREPARATION_STAGES, readPreparationStates, runPreparationStage, type BrandPreparationStage, type PreparationOutcome } from "./brand-preparation-jobs";

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// Brand enrichment runs once per tracked brand and feeds every downstream
// decision (concept pitch, backer detail, rollout status). Use Opus for best
// factual accuracy, fall back to Sonnet then Haiku on failure.
const MODEL_PRIMARY = "claude-opus-4-7";
const MODEL_FALLBACK_1 = "claude-sonnet-4-6";
const MODEL_FALLBACK_2 = "claude-haiku-4-5-20251001";

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

async function fetchBrandWebContext(name: string, domain: string | null): Promise<string> {
  if (!isPerplexityConfigured()) return "";
  try {
    const query = `Research only the business ${name} whose verified official website is ${domain}. Find current store count, expansion plans, investors, concept and industry. Prefer ${domain}; exclude businesses sharing the name and return no result when identity is uncertain.`;
    const r = await askPerplexity(query, { maxTokens: 400, temperature: 0.1 });
    const citations = r.citations.map(c => c.url).join(", ");
    return `\nLive web research (Perplexity, ${new Date().toISOString().slice(0, 10)}):\n${r.answer}${citations ? `\nSources: ${citations}` : ""}`;
  } catch {
    return "";
  }
}

function buildPrompt(company: any, webContext: string): string {
  return `You are enriching a UK retail-property CRM record for the brand/company below.

Return a JSON object that best describes this company's current public profile for a commercial property agent. Fields to fill (any you cannot determine with reasonable confidence → null, do not guess):

{
  "concept_pitch": "1-2 sentence plain description of what the brand does / its concept (customer-facing), or null",
  "store_count": integer UK store count or null,
  "rollout_status": one of ${JSON.stringify(ROLLOUT_VALUES)} or null,
  "backers": "ULTIMATE parent group / controlling owner at the TOP of the corporate chain — not the immediate holding company. Walk up: e.g. for Christian Dior → LVMH; for Bottega Veneta → Kering; for Zara → Inditex; for Dover Street Market → Comme des Garçons (Kawakubo family). Include notable past owners only if they held a meaningful stake within the last 5 years. Comma-separated string, or null",
  "backers_detail": [{"name":"Backer Co","type":"PE fund|VC|parent group|angel|sovereign wealth|family office|other|former parent","description":"1-sentence about who they are and what they're known for. Mark clearly if the stake has been exited."}] or null — up to 5 most notable current AND recent (last 5y) backers/investors, in priority order with current ultimate parent FIRST,
  "instagram_handle": "handle without the @, or null",
  "description": "1-sentence corporate description, or null",
  "industry": "e.g. 'Fashion retail', 'QSR restaurant', 'Fitness', or null",
  "employee_count": approximate integer headcount or null
}

Verified identity and existing CRM context:
The official domain identifies the business. Existing concept and store count may contain legacy errors; cross-check them against current official sources instead of treating them as proof. Return null for conflicting or unsubstantiated information.
- Name: ${JSON.stringify(company.name)}
- Domain: ${company.domain || company.domain_url || "unknown"}
- Companies House: ${company.companies_house_number || "unknown"}
- Existing concept pitch: ${company.concept_pitch || "(none)"}
- Existing store count: ${company.store_count ?? "(none)"}
${webContext}
Output JSON only. No prose, no code fences.`;
}

async function enrichCompany(companyId: string): Promise<{ updated: string[]; skipped: string[]; reason?: string; aiOut?: any }> {
  const q = await pool.query(`SELECT *, updated_at::text AS enrichment_revision FROM crm_companies WHERE id = $1 AND merged_into_id IS NULL`, [companyId]);
  const c = q.rows[0];
  if (!c) return { updated: [], skipped: [], reason: "company not found" };
  const identity = getBrandIdentity(c);
  if (identity.status !== "verified") return { updated: [], skipped: [], reason: identity.reason || "Confirm the official website first" };
  if (c.ai_disabled) return { updated: [], skipped: [], reason: "Brand enrichment is disabled" };
  if (!process.env.ANTHROPIC_API_KEY) return { updated: [], skipped: [], reason: "AI enrichment unavailable — AI service is not configured" };

  const aiFields: Record<string, string> = c.ai_generated_fields || {};

  const webContext = await fetchBrandWebContext(c.name, identity.domain);
  const prompt = buildPrompt({ ...c, domain: identity.domain }, webContext);
  let aiOut: any = null;
  const modelsToTry = [MODEL_PRIMARY, MODEL_FALLBACK_1, MODEL_FALLBACK_2];
  let lastErr: any = null;
  for (const model of modelsToTry) {
    try {
      const msg = await anthropic.messages.create({
        model,
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      });
      const txt = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
      const match = txt.match(/\{[\s\S]*\}/);
      if (match) {
        aiOut = JSON.parse(match[0]);
        break;
      }
    } catch (e: any) {
      lastErr = e;
      console.warn(`[brand-enrichment] ${model} failed (${e?.message}), trying next`);
    }
  }
  if (!aiOut && lastErr) {
    const reason = /api ?key|authentication|authToken/i.test(lastErr?.message || "")
      ? "AI enrichment unavailable — AI service is not configured"
      : "AI enrichment failed — try again shortly";
    return { updated: [], skipped: [], reason };
  }

  if (!aiOut || typeof aiOut !== "object") {
    return { updated: [], skipped: [], reason: "AI returned unparseable response" };
  }

  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  const updated: string[] = [];
  const skipped: string[] = [];
  const profileAfter = { ...c };

  for (const field of ENRICHABLE_FIELDS) {
    const aiVal = aiOut[field];
    const existingVal = (c as any)[field];
    const humanEdited = existingVal !== null && existingVal !== undefined && existingVal !== "" && !aiFields[field];

    // Human-edited → never overwrite
    if (humanEdited) {
      skipped.push(`${field} (human-edited)`);
      continue;
    }
    // instagram_handle is FILL-ONLY: heals and the verified feed pipeline
    // own existing values. An enrich guess overwrote Bill's verified
    // handle (billsrestaurant → billsrestaurants, 2026-08-19) because a
    // previously-AI-stamped field stays "AI-owned" and re-writable.
    if (field === "instagram_handle" && existingVal) {
      skipped.push("instagram_handle (already set)");
      continue;
    }
    if (aiVal === null || aiVal === undefined) continue;

    // Validate rollout_status
    if (field === "rollout_status" && !ROLLOUT_VALUES.includes(aiVal)) continue;

    // Type coerce ints
    let value: any = aiVal;
    if (field === "store_count" || field === "employee_count") {
      if (typeof aiVal !== "number" && typeof aiVal !== "string" || typeof aiVal === "string" && !aiVal.trim()) continue;
      const n = Number(aiVal);
      if (!Number.isFinite(n) || n < 0 || field === "employee_count" && n === 0) continue;
      value = Math.round(n);
    } else if (typeof value !== "string") continue;
    if (typeof value === "string") value = value.trim();
    if (value === "") continue;

    sets.push(`${field} = $${i++}`);
    vals.push(value);
    profileAfter[field] = value;
    aiFields[field] = new Date().toISOString();
    updated.push(field);
  }

  // Detail must share the ownership of the headline backers field; otherwise
  // an AI list can visually override a human correction on the profile.
  if ((updated.includes("backers") || !!aiFields.backers) && Array.isArray(aiOut.backers_detail)) {
    const allowedTypes = new Set(["PE fund", "VC", "parent group", "angel", "sovereign wealth", "family office", "other", "former parent"]);
    const details = aiOut.backers_detail.filter((entry: any) => entry && typeof entry === "object" && !Array.isArray(entry)
      && typeof entry.name === "string" && !!entry.name.trim() && entry.name.trim().length <= 150
      && (entry.description == null || typeof entry.description === "string"))
      .slice(0, 5).map((entry: any) => ({ name: entry.name.trim(), type: allowedTypes.has(entry.type) ? entry.type : "other", description: String(entry.description || "").trim().slice(0, 1000) }));
    if (details.length) { aiFields.backers_detail = details; updated.push("backers_detail"); }
  }

  if (updated.length) {
    sets.push(`ai_generated_fields = $${i++}`);
    vals.push(JSON.stringify(aiFields));
  }
  const hasSummary = [profileAfter.description, profileAfter.concept_pitch].some(value => typeof value === "string" && !!value.trim());
  const complete = hasSummary && typeof profileAfter.industry === "string" && !!profileAfter.industry.trim();
  if (!updated.length && !complete) return { updated: [], skipped, reason: "No verified profile information found; the description or industry is still missing" };
  if (complete) sets.push(`last_enriched_at = now()`);
  sets.push(`updated_at = now()`);
  vals.push(companyId);

  const saved = await pool.query(
    `UPDATE crm_companies SET ${sets.join(", ")} WHERE id = $${i}
       AND updated_at IS NOT DISTINCT FROM $${i + 1}`,
    [...vals, c.enrichment_revision]
  );

  if (!saved.rowCount) throw new Error("The brand changed during research; the result was not applied. Refresh to try again.");

  return { updated, skipped, aiOut, ...(complete ? {} : { reason: "No verified profile information found for the missing description or industry" }) };
}

// Exported for property-pathway orchestrator (Stage 2)
export async function enrichBrandById(companyId: string): Promise<Record<string, any>> {
  const r = (await prepareBrandStage(companyId, "profile")).result || { updated: [] };
  const out: Record<string, any> = {};
  for (const f of r.updated) {
    out[f] = r.aiOut?.[f];
  }
  return out;
}

// Each stage reserves a daily run before calling providers. A profile run can use
// one web-research call and at most three model attempts; the existing Google
// spending guard still applies independently to store/image requests.
const DAILY_LIMITS: Record<BrandPreparationStage, number> = { identity: 40, profile: 30, apollo: 30, rocketreach: 20, stores: 20, images: 20, logo: 40, brief: 30, contacts: 0 };
const configured = (stage: BrandPreparationStage) => {
  if (stage === "profile" || stage === "brief") return !!process.env.ANTHROPIC_API_KEY;
  if (stage === "apollo") return !!process.env.APOLLO_API_KEY;
  if (stage === "rocketreach") return !!process.env.ROCKETREACH_API_KEY;
  if (stage === "logo") return !!process.env.LOGO_DEV_TOKEN;
  if (stage === "stores") return !!(process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY);
  return true;
};

export async function enqueueBrandPreparation(companyId: string): Promise<void> {
  await pool.query(`INSERT INTO system_settings(key,value,updated_at) VALUES ($1,$2::jsonb,now())
    ON CONFLICT(key) DO UPDATE SET value=$2::jsonb,updated_at=now()`,
  [`brand-preparation-request:${companyId}`, JSON.stringify({ requestedAt: new Date().toISOString() })]);
}

export async function prepareBrandStage(companyId: string, stage: BrandPreparationStage, force = false, options: { tab?: "brand" | "uk" | "activity" | "intel" } = {}) {
  const company = (await pool.query("SELECT * FROM crm_companies WHERE id=$1 AND merged_into_id IS NULL", [companyId])).rows[0];
  if (!company) throw new Error("Company not found");
  const identity = getBrandIdentity(company);
  const usable = stage === "identity" ? identity.status !== "verified" && !!knownBrandLegalIdentity(company) && !company.ai_disabled : identity.status === "verified" && !company.ai_disabled && configured(stage);
  let result: any;
  const run = await runPreparationStage(pool, companyId, stage, identity.fingerprint, async (): Promise<PreparationOutcome> => {
    if (stage === "identity" && !company.ai_disabled) {
      const verified = await verifyBrandIdentityFromOfficialSite(pool, company);
      const current = (await pool.query("SELECT * FROM crm_companies WHERE id=$1", [companyId])).rows[0];
      return { ...verified, fingerprint: getBrandIdentity(current).fingerprint };
    }
    if (identity.status !== "verified") return { status: "needs_review", reason: identity.reason || "Confirm the official website" };
    if (company.ai_disabled) return { status: "unavailable", reason: "Automatic enrichment is disabled for this brand" };
    if (!configured(stage)) return { status: "unavailable", reason: "The service for this section is not configured" };
    if (stage === "profile") {
      result = await enrichCompany(companyId);
      if (result.reason) {
        if (/No verified profile/.test(result.reason)) return { status: "no_match", reason: result.reason };
        throw new Error(result.reason);
      }
      return { status: "ready" };
    }
    if (stage === "apollo" || stage === "rocketreach") {
      result = stage === "apollo" ? await (await import("./apollo-company")).refreshApolloCompany(companyId)
        : await (await import("./rocketreach-company")).refreshRocketReachCompany(companyId);
      return { status: result.status === "matched" ? "ready" : result.status === "blocked" ? "needs_review" : "no_match", reason: result.reason };
    }
    if (stage === "stores") {
      result = await (await import("./brand-profile")).researchBrandStores(companyId);
      return { status: result.found > 0 ? "ready" : "no_match", reason: result.found > 0 ? undefined : "No verified stores found" };
    }
    if (stage === "images") {
      result = await (await import("./brand-images")).refreshBrandImages(companyId, { target: 3 });
      return { status: result.imported > 0 || /^Already have \d+ auto-images/.test(result.skipped || "") ? "ready" : "no_match", reason: result.skipped || undefined };
    }
    if (stage === "logo") return (await import("./image-studio")).prepareBrandLogo(companyId);
    if (stage === "brief") {
      const prepared = await readPreparationStates(pool, companyId, identity.fingerprint);
      if (prepared.find(section => section.stage === "profile")?.status !== "ready") return { status: "needs_review", reason: "Prepare the factual profile before generating the BGP brief" };
      result = await (await import("./brand-ai-take")).prepareBrandAiTake(companyId, options.tab || "brand");
      return { status: result.text ? "ready" : "no_match", reason: result.reason };
    }
    // Existing linked people are usable immediately; a missing contact needs a
    // real discovery/review workflow, never a guessed name or job title.
    const linked = (await pool.query("SELECT COUNT(*)::int AS count FROM crm_contacts WHERE company_id=$1", [companyId])).rows[0]?.count || 0;
    return { status: "needs_review", reason: linked ? `${linked} linked contacts are available; confirm the current property contact before marking this section complete` : "Add or verify a property contact for this brand" };
  }, { dailyLimit: DAILY_LIMITS[stage], force, charge: usable && stage !== "contacts", readyTtlMs: (stage === "brief" || stage === "contacts" ? 7 : 30) * 86400000 });
  return { ...run, result };
}

async function selectPreparationCompanies(limit: number): Promise<string[]> {
  const rows = (await pool.query(`SELECT c.id FROM crm_companies c
    WHERE c.merged_into_id IS NULL AND c.ai_disabled IS DISTINCT FROM TRUE
      AND (c.company_type ILIKE 'tenant%' OR c.company_type ILIKE '%brand%')
      AND (EXISTS(SELECT 1 FROM system_settings q WHERE q.key='brand-preparation-request:'||c.id)
        OR (SELECT COUNT(*) FROM system_settings s WHERE s.key LIKE 'brand-preparation:'||c.id||':%') < 9
        OR EXISTS(SELECT 1 FROM system_settings s WHERE s.key LIKE 'brand-preparation:'||c.id||':%'
          AND COALESCE(NULLIF(s.value->>'nextAttemptAt','')::timestamptz, '1970-01-01'::timestamptz) <= now()))
    ORDER BY
      EXISTS(SELECT 1 FROM system_settings q WHERE q.key='brand-preparation-request:'||c.id) DESC,
      EXISTS(SELECT 1 FROM crm_requirements_leasing r WHERE r.company_id=c.id AND LOWER(COALESCE(r.status,'active'))='active') DESC,
      EXISTS(SELECT 1 FROM crm_deals d WHERE d.tenant_id=c.id AND LOWER(COALESCE(d.status,'')) NOT IN ('complete','completed','lost','aborted','cancelled')) DESC,
      (c.company_type ILIKE ANY($1::text[]) OR EXISTS(SELECT 1 FROM crm_companies client WHERE c.id=ANY(COALESCE(client.crm_extra_brand_ids,'{}'::text[])))) DESC,
      COALESCE((SELECT MIN(s.updated_at) FROM system_settings s WHERE s.key LIKE 'brand-preparation:'||c.id||':%'), '1970-01-01'::timestamp) ASC,
      c.id
    LIMIT $2`, [CLIENT_CRM_CATEGORIES, Math.max(1, Math.min(100, limit))])).rows;
  return rows.map(row => row.id);
}

export async function runBrandPreparationBatch(limit = 20) {
  if (process.env.BRAND_PREPARATION_ENABLED === "false") return { processed: 0, results: [], reason: "Background preparation is disabled" };
  const ids = await selectPreparationCompanies(limit);
  const results: any[] = [];
  for (const id of ids) {
    const stages = [];
    for (const stage of BRAND_PREPARATION_STAGES) {
      try { const run = await prepareBrandStage(id, stage); stages.push({ stage, ran: run.ran, status: run.state.status, reason: run.reason }); }
      catch (error: any) { stages.push({ stage, status: "error", reason: error.message }); }
    }
    results.push({ id, stages });
    await pool.query("DELETE FROM system_settings WHERE key=$1", [`brand-preparation-request:${id}`]);
  }
  return { processed: ids.length, results };
}

async function checkBrandScope(req: Request, companyId?: string): Promise<boolean> {
  const { resolveCompanyScope, isClientVisibleBrand } = await import("./company-scope");
  const scope = await resolveCompanyScope(req);
  return !scope || !!companyId && (companyId === scope || await isClientVisibleBrand(companyId, scope));
}

// Keep literal batch ahead of the parameter route; otherwise "batch" is treated as an ID.
router.post("/api/brand/enrich/batch", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!await checkBrandScope(req)) return res.status(403).json({ error: "Batch preparation is available in the staff view" });
    const limit = Number(req.body?.limit ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ error: "limit must be an integer from 1 to 100" });
    res.json(await runBrandPreparationBatch(limit));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/api/brand/enrich/:companyId", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    if (!await checkBrandScope(req, companyId)) return res.status(403).json({ error: "Access denied" });
    const run = await prepareBrandStage(companyId, "profile", true);
    await enqueueBrandPreparation(companyId);
    res.json({ updated: [], skipped: [], ...run.result, preparation: run.state, reason: run.result?.reason || (run.state.status !== "ready" ? run.state.reason || run.reason : undefined) });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/api/brand/:companyId/preparation", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    if (!await checkBrandScope(req, companyId)) return res.status(403).json({ error: "Access denied" });
    const company = (await pool.query("SELECT * FROM crm_companies WHERE id=$1", [companyId])).rows[0];
    if (!company) return res.status(404).json({ error: "Company not found" });
    const identity = getBrandIdentity(company);
    const stages = await readPreparationStates(pool, companyId, identity.fingerprint);
    res.json({ identity, stages, ready: identity.status === "verified" && stages.every(stage => stage.status === "ready") });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/api/brand/enrich/status", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!await checkBrandScope(req)) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(`SELECT
      COUNT(*) FILTER (WHERE company_type ILIKE 'tenant%' AND merged_into_id IS NULL)::int AS tracked_total,
      COUNT(*) FILTER (WHERE company_type ILIKE 'tenant%' AND merged_into_id IS NULL AND last_enriched_at IS NULL)::int AS tracked_never,
      COUNT(*) FILTER (WHERE company_type ILIKE 'tenant%' AND merged_into_id IS NULL AND last_enriched_at < now()-INTERVAL '30 days')::int AS tracked_stale,
      COUNT(*) FILTER (WHERE merged_into_id IS NULL)::int AS all_companies FROM crm_companies`);
    const stages = (await pool.query("SELECT value->>'stage' AS stage,value->>'status' AS status,COUNT(*)::int AS count FROM system_settings WHERE key LIKE 'brand-preparation:%' GROUP BY 1,2")).rows;
    const dailyUsage = (await pool.query("SELECT split_part(key,':',3) AS stage,COALESCE((value->>'used')::int,0) AS used FROM system_settings WHERE key LIKE $1", [`brand-preparation-budget:${new Date().toISOString().slice(0, 10)}:%`])).rows;
    res.json({ ...rows[0], stages, dailyLimits: DAILY_LIMITS, dailyUsage });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export async function runNightlyBrandEnrichment() {
  const result = await runBrandPreparationBatch(20);
  console.log(`[brand-enrich] preparation checked ${result.processed} brands`);
}

export default router;
