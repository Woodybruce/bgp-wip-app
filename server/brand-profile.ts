// ─────────────────────────────────────────────────────────────────────────
// Brand profile + agent representations + brand signals API.
// Everything the BrandProfilePanel on the company detail page reads from.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();

// ─── Auto-create brand_stores table if it doesn't exist ─────────────────
async function ensureBrandStoresTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brand_stores (
      id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      brand_company_id VARCHAR NOT NULL,
      name        TEXT NOT NULL,
      address     TEXT,
      lat         DOUBLE PRECISION,
      lng         DOUBLE PRECISION,
      place_id    TEXT,
      status      TEXT DEFAULT 'open',
      store_type  TEXT,
      notes       TEXT,
      source_type TEXT DEFAULT 'google_places',
      researched_at TIMESTAMP,
      created_at  TIMESTAMP DEFAULT now(),
      updated_at  TIMESTAMP DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS brand_stores_company_idx ON brand_stores(brand_company_id)
  `);
  // Add unique constraint for upsert — safe to run repeatedly
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'brand_stores_company_place_unique'
      ) THEN
        ALTER TABLE brand_stores ADD CONSTRAINT brand_stores_company_place_unique
          UNIQUE (brand_company_id, place_id);
      END IF;
    END $$
  `).catch(() => {});
}

// Run once on module load
ensureBrandStoresTable().catch(err =>
  console.error("[brand-profile] brand_stores table setup error:", err.message)
);

// ─── Full brand profile (one request, all sections) ─────────────────────
router.get("/api/brand/:companyId/profile", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;

    const companyQ = pool.query(
      `SELECT id, name, description, company_type, companies_house_number, companies_house_data,
              domain, domain_url,
              linkedin_url, phone, industry, employee_count, annual_revenue, founded_year,
              kyc_status, kyc_expires_at, aml_risk_level, aml_pep_status,
              is_tracked_brand, tracking_reason, brand_group_id, parent_company_id,
              concept_pitch, store_count, rollout_status, backers, instagram_handle,
              agent_type, ai_generated_fields, last_enriched_at,
              bgp_contact_crm, bgp_contact_user_ids,
              merged_into_id
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

    // Image gallery
    const imagesQ = pool.query(
      `SELECT i.id, i.file_name, i.thumbnail_data, i.category, i.created_at
         FROM image_studio_images i
        WHERE i.brand_name IS NOT NULL
          AND lower(i.brand_name) = (SELECT lower(name) FROM crm_companies WHERE id = $1)
        ORDER BY i.created_at DESC LIMIT 12`,
      [companyId]
    );

    // Deals where this company is a party
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
        ORDER BY d.updated_at DESC NULLS LAST LIMIT 20`,
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

    // News articles mentioning this brand
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

    // Active requirements / pipeline
    const requirementsQ = pool.query(
      `SELECT r.id, r.size_min, r.size_max, r.budget, r.use_class, r.status, r.location_notes,
              r.created_at, r.updated_at
         FROM crm_requirements_leasing r
        WHERE r.company_id = $1
        ORDER BY CASE WHEN r.status = 'Active' THEN 0 ELSE 1 END, r.updated_at DESC NULLS LAST
        LIMIT 10`,
      [companyId]
    );

    // Pitched-to history — leasing schedule units where this brand appears in target_brands or target_company_ids
    const pitchedToQ = pool.query(
      `SELECT u.id, u.unit_name, u.target_brands, u.status, u.priority, u.updated_at,
              p.id AS property_id, p.name AS property_name, p.address AS property_address
         FROM leasing_schedule_units u
         JOIN crm_properties p ON p.id = u.property_id
        WHERE u.target_company_ids @> ARRAY[$1]::text[]
           OR u.target_brands ILIKE '%' || (SELECT name FROM crm_companies WHERE id = $1) || '%'
        ORDER BY u.updated_at DESC NULLS LAST
        LIMIT 20`,
      [companyId]
    );

    // Recent contacts — emails/meetings linked to this company
    const contactsQ = pool.query(
      `SELECT ct.id, ct.name, ct.role, ct.email, ct.phone, ct.linkedin_url, ct.avatar_url,
              ct.last_contacted_at, ct.enrichment_source, ct.last_enriched_at
         FROM crm_contacts ct
        WHERE ct.company_id = $1 AND ct.deleted_at IS NULL
        ORDER BY ct.last_contacted_at DESC NULLS LAST, ct.name ASC
        LIMIT 20`,
      [companyId]
    );

    // Geocoded stores
    const storesQ = pool.query(
      `SELECT id, name, address, lat, lng, place_id, status, store_type, notes, source_type, researched_at
         FROM brand_stores
        WHERE brand_company_id = $1
        ORDER BY name ASC`,
      [companyId]
    );

    // Turnover data — most recent per period
    const turnoverQ = pool.query(
      `SELECT period, turnover, turnover_per_sqft, confidence, source, notes
         FROM turnover_data
        WHERE company_id = $1
        ORDER BY period DESC NULLS LAST
        LIMIT 5`,
      [companyId]
    );

    const [
      company, signals, repsForBrand, brandsForAgent,
      kyc, images, deals, parentGroup, siblings, news,
      requirements, pitchedTo, contacts, stores, turnover,
    ] = await Promise.all([
      companyQ, signalsQ, repsForBrandQ, brandsForAgentQ,
      kycQ, imagesQ, dealsQ, parentGroupQ, siblingsQ, newsQ,
      requirementsQ, pitchedToQ, contactsQ, storesQ, turnoverQ,
    ]);

    if (!company.rows[0]) return res.status(404).json({ error: "Company not found" });

    const c = company.rows[0];

    // Extract covenant data from Companies House JSONB
    const chData = c.companies_house_data;
    const chProfile = chData?.profile || {};
    const covenant = chData ? {
      companyStatus: chProfile.companyStatus || null,
      accountsOverdue: chProfile.accountsOverdue || false,
      confirmationStatementOverdue: chProfile.confirmationStatementOverdue || false,
      hasInsolvencyHistory: chProfile.hasInsolvencyHistory || false,
      hasCharges: chProfile.hasCharges || false,
      lastAccountsMadeUpTo: chProfile.lastAccountsMadeUpTo || null,
      dateOfCreation: chProfile.dateOfCreation || null,
      checkedAt: chData.checkedAt || null,
      // Derive traffic light: green = active + no issues, amber = warning, red = insolvency/dissolved
      trafficLight: chProfile.hasInsolvencyHistory
        ? "red"
        : chProfile.companyStatus === "active" && !chProfile.accountsOverdue
          ? "green"
          : "amber",
    } : null;

    // Deal ledger summary
    const completedDeals = deals.rows.filter((d: any) => d.status === "completed" || d.hots_completed_at);
    const activeDeals = deals.rows.filter((d: any) => d.status === "active" || d.status === "in_progress" || d.stage === "negotiation");

    res.json({
      company: c,
      signals: signals.rows,
      representedBy: repsForBrand.rows,
      representing: brandsForAgent.rows,
      kyc: kyc.rows[0] || { doc_count: 0, last_uploaded_at: null },
      images: images.rows,
      deals: deals.rows,
      completedDeals,
      activeDeals,
      parentGroup: parentGroup.rows[0] || null,
      siblings: siblings.rows,
      news: news.rows,
      requirements: requirements.rows,
      pitchedTo: pitchedTo.rows,
      contacts: contacts.rows,
      stores: stores.rows,
      turnover: turnover.rows,
      covenant,
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
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const v = key in body ? body[key] : (camel in body ? body[camel] : undefined);
      if (v !== undefined) {
        sets.push(`${key} = $${i++}`);
        vals.push(v);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no fields to update" });

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

// ─── Tracked brands list ─────────────────────────────────────────────────
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

// ─── Brand stores: list ──────────────────────────────────────────────────
router.get("/api/brand/:companyId/stores", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM brand_stores WHERE brand_company_id = $1 ORDER BY name ASC`,
      [req.params.companyId]
    );
    res.json({ stores: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Brand stores: research via Google Places ────────────────────────────
// Uses Google Places Text Search to find all UK stores for a brand, then
// geocodes and upserts them into brand_stores.
router.post("/api/brand/:companyId/research-stores", requireAuth, async (req: Request, res: Response) => {
  try {
    const googleKey = process.env.GOOGLE_API_KEY;
    if (!googleKey) return res.status(400).json({ error: "GOOGLE_API_KEY not configured" });

    const { rows } = await pool.query(
      `SELECT id, name, domain FROM crm_companies WHERE id = $1`,
      [req.params.companyId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Company not found" });
    const company = rows[0];

    // Google Places Text Search — search for the brand in the UK
    const queries = [
      `${company.name} store London`,
      `${company.name} UK`,
    ];

    const allResults: any[] = [];
    const seenPlaceIds = new Set<string>();

    for (const q of queries) {
      let nextPage: string | null = null;
      let page = 0;
      do {
        const url = nextPage
          ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${nextPage}&key=${googleKey}`
          : `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&region=uk&key=${googleKey}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!r.ok) break;
        const data: any = await r.json();
        for (const p of (data.results || [])) {
          if (!seenPlaceIds.has(p.place_id) && p.formatted_address?.includes("UK")) {
            seenPlaceIds.add(p.place_id);
            allResults.push(p);
          }
        }
        nextPage = data.next_page_token || null;
        page++;
        if (nextPage && page < 3) {
          // Brief pause required by Places API between paginated requests
          await new Promise(r => setTimeout(r, 2000));
        }
      } while (nextPage && page < 3);
    }

    // Upsert into brand_stores
    let upserted = 0;
    for (const p of allResults) {
      const name = p.name;
      const address = p.formatted_address;
      const lat = p.geometry?.location?.lat;
      const lng = p.geometry?.location?.lng;
      const placeId = p.place_id;
      const businessStatus = p.business_status || "OPERATIONAL";
      const status = businessStatus === "OPERATIONAL" ? "open"
        : businessStatus === "CLOSED_PERMANENTLY" ? "closed"
        : "unconfirmed";

      await pool.query(
        `INSERT INTO brand_stores (brand_company_id, name, address, lat, lng, place_id, status, source_type, researched_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'google_places', now(), now())
         ON CONFLICT (brand_company_id, place_id) DO UPDATE SET
           name = EXCLUDED.name, address = EXCLUDED.address,
           lat = EXCLUDED.lat, lng = EXCLUDED.lng,
           status = EXCLUDED.status, researched_at = now(), updated_at = now()`,
        [company.id, name, address, lat, lng, placeId, status]
      ).catch(async () => {
        // If no unique constraint yet, do a manual check
        const exists = await pool.query(
          `SELECT id FROM brand_stores WHERE brand_company_id = $1 AND place_id = $2`,
          [company.id, placeId]
        );
        if (exists.rowCount === 0) {
          await pool.query(
            `INSERT INTO brand_stores (brand_company_id, name, address, lat, lng, place_id, status, source_type, researched_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'google_places', now())`,
            [company.id, name, address, lat, lng, placeId, status]
          );
        }
      });
      upserted++;
    }

    // Update store_count on the company
    if (allResults.length > 0) {
      await pool.query(
        `UPDATE crm_companies SET store_count = $1, updated_at = now() WHERE id = $2 AND (store_count IS NULL OR store_count < $1)`,
        [allResults.filter(p => (p.business_status || "OPERATIONAL") === "OPERATIONAL").length, company.id]
      );
    }

    res.json({
      found: allResults.length,
      upserted,
      openCount: allResults.filter(p => (p.business_status || "OPERATIONAL") === "OPERATIONAL").length,
      company: { id: company.id, name: company.name },
    });
  } catch (err: any) {
    console.error("[research-stores]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Brand stores: manual add/update/delete ──────────────────────────────
router.post("/api/brand/:companyId/stores", requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, address, lat, lng, placeId, status, storeType, notes } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    const { rows } = await pool.query(
      `INSERT INTO brand_stores (brand_company_id, name, address, lat, lng, place_id, status, store_type, notes, source_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual') RETURNING *`,
      [req.params.companyId, name, address || null, lat || null, lng || null, placeId || null,
       status || "open", storeType || null, notes || null]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/brand/stores/:storeId", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query(`DELETE FROM brand_stores WHERE id = $1`, [req.params.storeId]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
