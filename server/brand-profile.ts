// ─────────────────────────────────────────────────────────────────────────
// Brand profile + agent representations + brand signals API.
// Everything the BrandProfilePanel on the company detail page reads from.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();

// ─── Full brand profile (one request, all sections) ─────────────────────
router.get("/api/brand/:companyId/profile", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;

    const companyQ = pool.query(
      `SELECT id, name, description, company_type, companies_house_number, domain, domain_url,
              linkedin_url, phone, industry, employee_count, annual_revenue, founded_year,
              kyc_status, kyc_expires_at, aml_risk_level, aml_pep_status,
              is_tracked_brand, tracking_reason, brand_group_id,
              concept_pitch, store_count, rollout_status, backers, instagram_handle,
              agent_type, ai_generated_fields, last_enriched_at,
              parent_company_id, merged_into_id
         FROM crm_companies WHERE id = $1`,
      [companyId]
    );

    const signalsQ = pool.query(
      `SELECT id, signal_type, headline, detail, source, signal_date, magnitude, sentiment, ai_generated, created_at
         FROM brand_signals WHERE brand_company_id = $1
         ORDER BY COALESCE(signal_date, created_at) DESC LIMIT 20`,
      [companyId]
    );

    // Who represents this brand
    const repsForBrandQ = pool.query(
      `SELECT r.id, r.agent_type, r.region, r.start_date, r.end_date, r.notes,
              r.agent_company_id, a.name AS agent_name, a.domain AS agent_domain,
              r.primary_contact_id, ct.name AS contact_name, ct.email AS contact_email
         FROM brand_agent_representations r
         LEFT JOIN crm_companies a ON a.id = r.agent_company_id
         LEFT JOIN crm_contacts  ct ON ct.id = r.primary_contact_id
        WHERE r.brand_company_id = $1 AND r.end_date IS NULL
        ORDER BY r.start_date DESC NULLS LAST`,
      [companyId]
    );

    // Brands this agent represents (if this company is an agent)
    const brandsForAgentQ = pool.query(
      `SELECT r.id, r.agent_type, r.region, r.start_date,
              r.brand_company_id, b.name AS brand_name, b.is_tracked_brand
         FROM brand_agent_representations r
         LEFT JOIN crm_companies b ON b.id = r.brand_company_id
        WHERE r.agent_company_id = $1 AND r.end_date IS NULL
        ORDER BY b.name ASC`,
      [companyId]
    );

    // KYC doc count + last upload
    const kycQ = pool.query(
      `SELECT COUNT(*)::int AS doc_count,
              MAX(uploaded_at) AS last_uploaded_at
         FROM kyc_documents
        WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId]
    );

    // Image gallery (brand_name match OR property linkage via crm_companies)
    const imagesQ = pool.query(
      `SELECT i.id, i.file_name, i.thumbnail_data, i.category, i.created_at
         FROM image_studio_images i
        WHERE i.brand_name IS NOT NULL
          AND lower(i.brand_name) = (SELECT lower(name) FROM crm_companies WHERE id = $1)
        ORDER BY i.created_at DESC LIMIT 12`,
      [companyId]
    );

    // Deals where this company is landlord/tenant/vendor/purchaser
    const dealsQ = pool.query(
      `SELECT d.id, d.name, d.status, d.deal_type, d.stage, d.updated_at, d.hots_completed_at,
              CASE
                WHEN d.landlord_id  = $1 THEN 'landlord'
                WHEN d.tenant_id    = $1 THEN 'tenant'
                WHEN d.vendor_id    = $1 THEN 'vendor'
                WHEN d.purchaser_id = $1 THEN 'purchaser'
              END AS role
         FROM crm_deals d
        WHERE d.landlord_id = $1 OR d.tenant_id = $1 OR d.vendor_id = $1 OR d.purchaser_id = $1
        ORDER BY d.updated_at DESC NULLS LAST LIMIT 10`,
      [companyId]
    );

    // Parent brand group (if any)
    const parentGroupQ = pool.query(
      `SELECT c.id, c.name, c.store_count
         FROM crm_companies c
        WHERE c.id = (SELECT brand_group_id FROM crm_companies WHERE id = $1)`,
      [companyId]
    );

    // Sister brands — same group
    const siblingsQ = pool.query(
      `SELECT c.id, c.name, c.store_count, c.rollout_status
         FROM crm_companies c
        WHERE c.brand_group_id = (SELECT brand_group_id FROM crm_companies WHERE id = $1)
          AND c.id <> $1
          AND c.merged_into_id IS NULL`,
      [companyId]
    );

    // News articles mentioning this brand (title or summary match)
    const newsQ = pool.query(
      `SELECT n.id, n.title, n.summary, n.ai_summary, n.url, n.image_url, n.source_name, n.published_at, n.category
         FROM news_articles n,
              (SELECT name FROM crm_companies WHERE id = $1) AS co
        WHERE (n.title ILIKE '%' || co.name || '%' OR n.summary ILIKE '%' || co.name || '%'
               OR n.ai_summary ILIKE '%' || co.name || '%')
        ORDER BY n.published_at DESC NULLS LAST
        LIMIT 10`,
      [companyId]
    );

    const [company, signals, repsForBrand, brandsForAgent, kyc, images, deals, parentGroup, siblings, news] = await Promise.all([
      companyQ, signalsQ, repsForBrandQ, brandsForAgentQ, kycQ, imagesQ, dealsQ, parentGroupQ, siblingsQ, newsQ,
    ]);

    if (!company.rows[0]) return res.status(404).json({ error: "Company not found" });

    res.json({
      company: company.rows[0],
      signals: signals.rows,
      representedBy: repsForBrand.rows,
      representing: brandsForAgent.rows,
      kyc: kyc.rows[0] || { doc_count: 0, last_uploaded_at: null },
      images: images.rows,
      deals: deals.rows,
      parentGroup: parentGroup.rows[0] || null,
      siblings: siblings.rows,
      news: news.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update brand-specific fields ───────────────────────────────────────
router.patch("/api/brand/:companyId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const body = req.body || {};
    const allowed = [
      "is_tracked_brand", "tracking_reason", "brand_group_id",
      "concept_pitch", "store_count", "rollout_status", "backers",
      "instagram_handle", "agent_type",
    ];
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const key of allowed) {
      // tolerate both snake and camel
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const v = key in body ? body[key] : (camel in body ? body[camel] : undefined);
      if (v !== undefined) {
        sets.push(`${key} = $${i++}`);
        vals.push(v);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no fields to update" });

    // Strip the listed keys from ai_generated_fields — a human edited them
    sets.push(`ai_generated_fields = (
      SELECT CASE WHEN ai_generated_fields IS NULL THEN NULL
                  ELSE ai_generated_fields - ARRAY[${allowed.filter(k => (k in body) || (k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) in body)).map(k => `'${k}'`).join(",") || "''"}]::text[]
             END
      FROM crm_companies WHERE id = $${i})`);
    sets.push(`updated_at = now()`);
    vals.push(companyId);

    await pool.query(
      `UPDATE crm_companies SET ${sets.join(", ")} WHERE id = $${i}`,
      vals
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Agent representations CRUD ─────────────────────────────────────────
router.post("/api/brand/representations", requireAuth, async (req: Request, res: Response) => {
  try {
    const { brandCompanyId, agentCompanyId, agentType, region, primaryContactId, startDate, notes } = req.body || {};
    if (!brandCompanyId || !agentCompanyId || !agentType) {
      return res.status(400).json({ error: "brandCompanyId, agentCompanyId, agentType required" });
    }
    const r = await pool.query(
      `INSERT INTO brand_agent_representations (brand_company_id, agent_company_id, agent_type, region, primary_contact_id, start_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [brandCompanyId, agentCompanyId, agentType, region || null, primaryContactId || null, startDate || null, notes || null]
    );
    res.json(r.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/brand/representations/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const allowed = ["agent_type", "region", "primary_contact_id", "start_date", "end_date", "notes"];
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const key of allowed) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const v = key in body ? body[key] : (camel in body ? body[camel] : undefined);
      if (v !== undefined) {
        sets.push(`${key} = $${i++}`);
        vals.push(v);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no fields" });
    sets.push(`updated_at = now()`);
    vals.push(id);
    await pool.query(`UPDATE brand_agent_representations SET ${sets.join(", ")} WHERE id = $${i}`, vals);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/brand/representations/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query(`DELETE FROM brand_agent_representations WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Brand signals CRUD ─────────────────────────────────────────────────
router.post("/api/brand/signals", requireAuth, async (req: Request, res: Response) => {
  try {
    const { brandCompanyId, signalType, headline, detail, source, signalDate, magnitude, sentiment, aiGenerated } = req.body || {};
    if (!brandCompanyId || !signalType || !headline) {
      return res.status(400).json({ error: "brandCompanyId, signalType, headline required" });
    }
    const r = await pool.query(
      `INSERT INTO brand_signals (brand_company_id, signal_type, headline, detail, source, signal_date, magnitude, sentiment, ai_generated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [brandCompanyId, signalType, headline, detail || null, source || null, signalDate || null, magnitude || null, sentiment || null, !!aiGenerated]
    );
    res.json(r.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/brand/signals/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query(`DELETE FROM brand_signals WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Tracked brands list (for the /admin/brands filter) ─────────────────
router.get("/api/brand/tracked", requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, tracking_reason, store_count, rollout_status, concept_pitch,
              brand_group_id, last_enriched_at, instagram_handle
         FROM crm_companies
        WHERE is_tracked_brand = true AND merged_into_id IS NULL
        ORDER BY name ASC`
    );
    res.json({ brands: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
