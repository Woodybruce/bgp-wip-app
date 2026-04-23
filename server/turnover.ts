import { Router, Request, Response } from "express";
import { requireAuth } from "./auth";

const router = Router();

let dbPool: any = null;
async function getPool() {
  if (!dbPool) {
    const { pool } = await import("./db");
    dbPool = pool;
    // Ensure new store-level columns exist
    dbPool.query(`ALTER TABLE turnover_data ADD COLUMN IF NOT EXISTS store_name TEXT`).catch(() => {});
    dbPool.query(`ALTER TABLE turnover_data ADD COLUMN IF NOT EXISTS google_place_id TEXT`).catch(() => {});
    dbPool.query(`ALTER TABLE turnover_data ADD COLUMN IF NOT EXISTS lat REAL`).catch(() => {});
    dbPool.query(`ALTER TABLE turnover_data ADD COLUMN IF NOT EXISTS lng REAL`).catch(() => {});
    dbPool.query(`ALTER TABLE turnover_data ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT false`).catch(() => {});
  }
  return dbPool;
}

async function getUserInfo(pool: any, req: Request) {
  const userId = (req.session as any)?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const result = await pool.query("SELECT id, username, is_admin FROM users WHERE id = $1", [userId]);
  return result.rows[0] || null;
}

// ── UK bounding box for Overpass queries ──────────────────────────────────
const UK_BBOX = "49.8,-7.6,60.9,2.2";

async function queryOverpass(query: string): Promise<any[]> {
  const encoded = encodeURIComponent(query);
  const res = await fetch(`https://overpass-api.de/api/interpreter`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encoded}`,
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Overpass error: ${res.status}`);
  const data = await res.json() as any;
  return data.elements || [];
}

function buildOverpassQuery(brandName: string): string {
  const escaped = brandName.replace(/[^a-zA-Z0-9 &.,'()-]/g, "");
  return `[out:json][timeout:25];
(
  node["brand"="${escaped}"]["shop"](${UK_BBOX});
  node["name"="${escaped}"]["shop"](${UK_BBOX});
  node["brand"="${escaped}"]["amenity"="fast_food"](${UK_BBOX});
  node["name"="${escaped}"]["amenity"="fast_food"](${UK_BBOX});
  node["brand"="${escaped}"]["amenity"="restaurant"](${UK_BBOX});
  node["brand"="${escaped}"]["amenity"="cafe"](${UK_BBOX});
  node["brand"="${escaped}"]["amenity"="bank"](${UK_BBOX});
  node["brand"="${escaped}"]["amenity"="gym"](${UK_BBOX});
  way["brand"="${escaped}"]["shop"](${UK_BBOX});
  way["name"="${escaped}"]["shop"](${UK_BBOX});
);
out center body;`;
}

router.get("/api/turnover", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const { company_id, property_id, category, search } = req.query;
    let sql = `SELECT * FROM turnover_data WHERE 1=1`;
    const params: any[] = [];
    let idx = 1;

    if (company_id) { sql += ` AND company_id = $${idx}`; params.push(company_id); idx++; }
    if (property_id) { sql += ` AND property_id = $${idx}`; params.push(property_id); idx++; }
    if (category) { sql += ` AND category = $${idx}`; params.push(category); idx++; }
    if (search) {
      sql += ` AND (company_name ILIKE $${idx} OR property_name ILIKE $${idx} OR location ILIKE $${idx} OR notes ILIKE $${idx})`;
      params.push(`%${search}%`); idx++;
    }

    sql += ` ORDER BY created_at DESC`;
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// NOTE: GET/PATCH/DELETE /:id routes are registered BELOW the named routes
// (find-stores, stats/summary, etc.) to avoid Express /:id shadowing them.

router.post("/api/turnover", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const user = await getUserInfo(pool, req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { company_id, company_name, property_id, property_name, store_name, location,
            google_place_id, lat, lng,
            period, turnover, sqft, source, confidence, category, notes,
            linked_requirement_id, is_draft } = req.body;

    if (!company_name || !period) return res.status(400).json({ error: "Company name and period are required" });

    const turnoverVal = turnover ? parseFloat(turnover) : null;
    const sqftVal = sqft ? parseFloat(sqft) : null;
    const perSqft = (turnoverVal && sqftVal && sqftVal > 0) ? Math.round((turnoverVal / sqftVal) * 100) / 100 : null;

    const result = await pool.query(
      `INSERT INTO turnover_data (company_id, company_name, property_id, property_name, store_name,
        location, google_place_id, lat, lng, period,
        turnover, sqft, turnover_per_sqft, source, confidence, category, notes,
        linked_requirement_id, is_draft, added_by, added_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [company_id || null, company_name, property_id || null, property_name || null, store_name || null,
       location || null, google_place_id || null, lat || null, lng || null, period,
       turnoverVal, sqftVal, perSqft, source || "Conversation", confidence || "Medium",
       category || null, notes || null, linked_requirement_id || null, is_draft || false,
       user.username, user.id]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/turnover/stats/summary", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_entries,
        COUNT(DISTINCT company_name) as unique_brands,
        COUNT(DISTINCT category) as categories,
        AVG(turnover) as avg_turnover,
        AVG(turnover_per_sqft) as avg_per_sqft
      FROM turnover_data
    `);
    const byCategory = await pool.query(`
      SELECT category, COUNT(*) as count, AVG(turnover) as avg_turnover
      FROM turnover_data WHERE category IS NOT NULL
      GROUP BY category ORDER BY count DESC
    `);
    const bySource = await pool.query(`
      SELECT source, COUNT(*) as count
      FROM turnover_data GROUP BY source ORDER BY count DESC
    `);
    res.json({ summary: result.rows[0], byCategory: byCategory.rows, bySource: bySource.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Find UK store locations via Overpass (OpenStreetMap) ─────────────────────
router.get("/api/turnover/find-stores", requireAuth, async (req: Request, res: Response) => {
  try {
    const brandName = (req.query.brand as string || "").trim();
    if (!brandName) return res.status(400).json({ error: "brand query param required" });

    const elements = await queryOverpass(buildOverpassQuery(brandName));

    const stores = elements.map((el: any) => {
      const lat = el.type === "way" ? el.center?.lat : el.lat;
      const lng = el.type === "way" ? el.center?.lon : el.lon;
      const tags = el.tags || {};
      const addr = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"] || tags["addr:town"], tags["addr:postcode"]]
        .filter(Boolean).join(", ");
      return {
        osmId: `${el.type}/${el.id}`,
        name: tags.name || tags.brand || brandName,
        address: addr || tags["addr:full"] || null,
        postcode: tags["addr:postcode"] || null,
        city: tags["addr:city"] || tags["addr:town"] || null,
        lat: lat || null,
        lng: lng || null,
        shopType: tags.shop || tags.amenity || null,
      };
    }).filter((s: any) => s.lat && s.lng);

    res.json({ brand: brandName, count: stores.length, stores });
  } catch (err: any) {
    console.error("[find-stores]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Bulk-create draft turnover records from Overpass store data ───────────────
router.post("/api/turnover/populate-stores", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const user = await getUserInfo(pool, req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { company_id, company_name, brand_name, category, period } = req.body;
    if (!company_name || !brand_name) return res.status(400).json({ error: "company_name and brand_name required" });

    const elements = await queryOverpass(buildOverpassQuery(brand_name));
    const { nanoid } = await import("nanoid");

    let created = 0;
    let skipped = 0;

    for (const el of elements) {
      const lat = el.type === "way" ? el.center?.lat : el.lat;
      const lng = el.type === "way" ? el.center?.lon : el.lon;
      if (!lat || !lng) { skipped++; continue; }

      const tags = el.tags || {};
      const addr = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"] || tags["addr:town"], tags["addr:postcode"]]
        .filter(Boolean).join(", ");
      const location = addr || tags["addr:full"] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      const storeName = tags.name || tags.brand || brand_name;
      const osmRef = `${el.type}/${el.id}`;

      // Skip if a record with this OSM reference already exists (use company_name since company_id can be null)
      const existing = await pool.query(
        `SELECT id FROM turnover_data WHERE LOWER(company_name) = LOWER($1) AND notes LIKE $2 LIMIT 1`,
        [company_name, `%OSM:${osmRef}%`]
      );
      if (existing.rows.length) { skipped++; continue; }

      await pool.query(
        `INSERT INTO turnover_data (id, company_id, company_name, store_name, location, lat, lng,
          period, source, confidence, category, notes, is_draft, added_by, added_by_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
        [nanoid(), company_id || null, company_name, storeName, location, lat, lng,
         period || new Date().getFullYear().toString(),
         "OpenStreetMap", "Low",
         category || null,
         `Auto-imported from OpenStreetMap. OSM:${osmRef}${tags["addr:postcode"] ? ` · ${tags["addr:postcode"]}` : ""}`,
         true, user.username, user.id]
      );
      created++;
    }

    res.json({ created, skipped, total: elements.length });
  } catch (err: any) {
    console.error("[populate-stores]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Populate draft turnover records from CRM leasing comps ───────────────────
router.post("/api/turnover/populate-from-comps", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const user = await getUserInfo(pool, req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { company_id } = req.body; // optional: scope to one brand

    // Find comps where tenant name matches a known brand in crm_companies
    const compsQuery = company_id
      ? `SELECT cc.id as comp_id, cc.tenant, cc.area_sqft, cc.nia_sqft, cc.address,
               cc.completion_date, cc.deal_type, cc.group_name,
               co.id as company_id, co.name as company_name, co.company_type
         FROM crm_comps cc
         JOIN crm_companies co ON LOWER(TRIM(co.name)) = LOWER(TRIM(cc.tenant))
         WHERE co.id = $1 AND cc.tenant IS NOT NULL AND cc.tenant != ''`
      : `SELECT cc.id as comp_id, cc.tenant, cc.area_sqft, cc.nia_sqft, cc.address,
               cc.completion_date, cc.deal_type, cc.group_name,
               co.id as company_id, co.name as company_name, co.company_type
         FROM crm_comps cc
         JOIN crm_companies co ON LOWER(TRIM(co.name)) = LOWER(TRIM(cc.tenant))
         WHERE cc.tenant IS NOT NULL AND cc.tenant != ''
           AND co.company_type ILIKE 'Tenant%'
         LIMIT 200`;

    const { rows: comps } = await pool.query(compsQuery, company_id ? [company_id] : []);
    const { nanoid } = await import("nanoid");

    let created = 0;
    let skipped = 0;

    for (const comp of comps) {
      // Skip if this comp is already linked
      const existing = await pool.query(
        `SELECT id FROM turnover_data WHERE notes LIKE $1 LIMIT 1`,
        [`%comp:${comp.comp_id}%`]
      );
      if (existing.rows.length) { skipped++; continue; }

      const sqft = comp.nia_sqft ? parseFloat(comp.nia_sqft) : (comp.area_sqft ? parseFloat(comp.area_sqft) : null);
      const period = comp.completion_date
        ? (comp.completion_date.length >= 4 ? comp.completion_date.substring(0, 4) : comp.completion_date)
        : new Date().getFullYear().toString();

      let location: string | null = null;
      if (comp.address) {
        try {
          const addr = typeof comp.address === "string" ? JSON.parse(comp.address) : comp.address;
          location = [addr.street, addr.city, addr.postcode].filter(Boolean).join(", ") || null;
        } catch { location = null; }
      }

      const category = (comp.company_type || "").replace("Tenant - ", "") || null;

      await pool.query(
        `INSERT INTO turnover_data (id, company_id, company_name, location, period,
          sqft, source, confidence, category, notes, is_draft, added_by, added_by_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())`,
        [nanoid(), comp.company_id, comp.company_name, location, period,
         sqft, "CRM Comp", "Medium",
         category,
         `Auto-imported from CRM comp. comp:${comp.comp_id}${location ? ` · ${location}` : ""}. Sqft pre-filled — add turnover figure.`,
         true, user.username, user.id]
      );
      created++;
    }

    res.json({ created, skipped, matched_comps: comps.length });
  } catch (err: any) {
    console.error("[populate-from-comps]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Confirm a draft entry (remove is_draft flag) ─────────────────────────────
router.patch("/api/turnover/:id/confirm", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const result = await pool.query(
      `UPDATE turnover_data SET is_draft = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Parameterized /:id routes MUST be last to avoid shadowing named routes ──

router.get("/api/turnover/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const result = await pool.query("SELECT * FROM turnover_data WHERE id = $1", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/turnover/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const user = await getUserInfo(pool, req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const existing = await pool.query("SELECT * FROM turnover_data WHERE id = $1", [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: "Not found" });

    const allowedFields: Record<string, string> = {
      company_id: "company_id", company_name: "company_name", property_id: "property_id",
      property_name: "property_name", store_name: "store_name", location: "location",
      google_place_id: "google_place_id", lat: "lat", lng: "lng",
      period: "period", turnover: "turnover", sqft: "sqft",
      source: "source", confidence: "confidence", category: "category",
      notes: "notes", linked_requirement_id: "linked_requirement_id", is_draft: "is_draft"
    };

    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const [key, col] of Object.entries(allowedFields)) {
      if (req.body[key] !== undefined) {
        sets.push(`${col} = $${idx}`);
        params.push(req.body[key] === "" ? null : req.body[key]);
        idx++;
      }
    }

    if (sets.length === 0) return res.status(400).json({ error: "No fields to update" });

    // Recalculate turnover_per_sqft
    const turnoverVal = req.body.turnover !== undefined
      ? (parseFloat(req.body.turnover) || null)
      : (existing.rows[0].turnover != null ? parseFloat(existing.rows[0].turnover) : null);
    const sqftVal = req.body.sqft !== undefined
      ? (parseFloat(req.body.sqft) || null)
      : (existing.rows[0].sqft != null ? parseFloat(existing.rows[0].sqft) : null);
    if (turnoverVal && sqftVal && sqftVal > 0) {
      sets.push(`turnover_per_sqft = $${idx}`);
      params.push(Math.round((turnoverVal / sqftVal) * 100) / 100);
      idx++;
    } else if (req.body.turnover !== undefined || req.body.sqft !== undefined) {
      // Clear stale per-sqft when turnover or sqft is zeroed/removed
      sets.push(`turnover_per_sqft = NULL`);
    }

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE turnover_data SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      params
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/turnover/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const result = await pool.query("DELETE FROM turnover_data WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
