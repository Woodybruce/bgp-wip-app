import { Router, Request, Response } from "express";
import { requireAuth } from "./auth";
import multer from "multer";
import { backfillPropertyTenants, backfillPropertyUnitFks, resolveBrandIdSubquery } from "./tenant-brand-resolver";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

let dbPool: any = null;
async function getPool() {
  if (!dbPool) {
    const { pool } = await import("./db");
    dbPool = pool;
  }
  return dbPool;
}

async function getUserInfo(pool: any, req: Request) {
  const userId = (req.session as any)?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const result = await pool.query("SELECT id, username, is_admin FROM users WHERE id = $1", [userId]);
  return result.rows[0] || null;
}

router.get("/api/tenancy-schedule/property/:propertyId", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.params;

    // Real tenancies — passing rent, leases, reviews. LEFT JOIN
    // crm_companies on a lowercased trimmed tenant_name to resolve
    // a clickable company link for the Tenant / Trading As cells
    // (mirrors the pattern used in the leasing schedule GET).
    // FK-first read: tenant_company_id is the canonical link, written
    // at import time / by the resolve-tenants backfill. The soft name
    // matcher in tenant-brand-resolver is a fading safety net for rows
    // that haven't been backfilled yet — once the team clicks Resolve
    // on the linkage card, this fallback is rarely hit.
    const occupied = await pool.query(
      `SELECT t.*,
              COALESCE(tc_fk.id, tc_soft.id) AS resolved_tenant_company_id,
              COALESCE(tc_fk.name, tc_soft.name) AS resolved_tenant_company_name
         FROM tenancy_schedule_units t
         LEFT JOIN crm_companies tc_fk ON tc_fk.id = t.tenant_company_id AND tc_fk.merged_into_id IS NULL
         LEFT JOIN LATERAL (
           SELECT c.id, c.name FROM crm_companies c
            WHERE t.tenant_company_id IS NULL
              AND c.id = ${resolveBrandIdSubquery("coalesce(t.trading_name, t.tenant_name, '')")}
            LIMIT 1
         ) tc_soft ON TRUE
        WHERE t.property_id = $1
        ORDER BY t.premises, t.sort_order, t.id`,
      [propertyId]
    );

    // Vacant units — anything on the Letting Tracker that isn't already
    // represented by a matching tenancy row (matched by unit_name). Treats
    // the Tenancy Schedule as the source of truth — every unit on the
    // property appears, occupied or not. The vacant rows carry the
    // linked available_unit_id so the UI can deep-link into the tracker.
    const vacant = await pool.query(
      `SELECT au.id AS available_unit_id, au.unit_name, au.sqft, au.asking_rent,
              au.marketing_status, au.deal_id, d.deal_ref
       FROM available_units au
       LEFT JOIN crm_deals d ON d.id = au.deal_id
       WHERE au.property_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM tenancy_schedule_units ts
           WHERE ts.property_id = au.property_id
             AND lower(trim(coalesce(ts.unit_number, ts.premises, ''))) = lower(trim(coalesce(au.unit_name, '')))
         )
       ORDER BY au.unit_name`,
      [propertyId]
    );

    // Cast vacant rows into the tenancy shape so the existing client
    // renderer Just Works. is_vacant: true is the discriminator.
    const derivedVacant = vacant.rows.map((v: any) => ({
      id: `vacant-${v.available_unit_id}`,
      property_id: propertyId,
      premises: v.unit_name || "—",
      unit_number: v.unit_name || "",
      tenant_name: "VACANT",
      trading_name: "",
      permitted_use: "",
      nia_sqft: v.sqft || null,
      gia_sqft: v.sqft || null,
      passing_rent_pa: null,
      erv_pa: v.asking_rent || null,
      status: v.marketing_status || "AVA",
      is_vacant: true,
      available_unit_id: v.available_unit_id,
      deal_id: v.deal_id,
      deal_ref: v.deal_ref,
    }));

    // Compute unexpired-term (months) on the fly. `unexpired_term` runs to
    // lease expiry; `unexpired_term_before_break` runs to the earliest of
    // expiry / tenant break / landlord break. Keeps the value fresh without
    // a daily cron — client sees today's number every render.
    const now = Date.now();
    const monthsBetween = (iso: string | Date | null | undefined): number | null => {
      if (!iso) return null;
      const t = new Date(iso).getTime();
      if (!t || isNaN(t)) return null;
      const diffMs = t - now;
      return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24 * 30.4375)));
    };
    const earliest = (...dates: (string | Date | null | undefined)[]): Date | null => {
      let min: number | null = null;
      for (const d of dates) {
        if (!d) continue;
        const t = new Date(d).getTime();
        if (!t || isNaN(t)) continue;
        if (min === null || t < min) min = t;
      }
      return min === null ? null : new Date(min);
    };
    // term_years computed from lease_start → lease_expiry when missing.
    // 365.25 days per year keeps leap-year drift out of the fixed term.
    const yearsBetween = (start: string | Date | null | undefined, end: string | Date | null | undefined): number | null => {
      if (!start || !end) return null;
      const a = new Date(start).getTime();
      const b = new Date(end).getTime();
      if (!a || !b || isNaN(a) || isNaN(b) || b < a) return null;
      return Math.round(((b - a) / (1000 * 60 * 60 * 24 * 365.25)) * 10) / 10;
    };
    const withComputed = occupied.rows.map((r: any) => ({
      ...r,
      unexpired_term: r.unexpired_term ?? monthsBetween(r.lease_expiry),
      // Client expects `unexpired_term_break` — months to the earliest of
      // expiry / tenant break / landlord break. Always recomputed so today's
      // value is current.
      unexpired_term_break: monthsBetween(earliest(r.lease_expiry, r.break_date, r.landlord_break_date)),
      term_years: (r.term_years && Number(r.term_years) > 0) ? r.term_years : yearsBetween(r.lease_start, r.lease_expiry),
    }));

    res.json([...withComputed, ...derivedVacant]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Full list of columns the API accepts on create/update. Mirrors the
// Landsec-aligned schema in server/index.ts auto-migrate. Used by both POST
// (create) and PUT (update) below + by the xlsx import header → field mapper.
const TENANCY_FIELDS = [
  // Unit Details
  "grouping", "floor_level", "premises", "unit_number", "permitted_use", "status", "am_initiative",
  // Tenant Details
  "tenant_name", "trading_name", "tenant_mix",
  // Lease Details
  "lease_start", "break_date", "break_type", "break_details", "break_notice", "lease_expiry",
  "term_years", "unexpired_term_break", "unexpired_term", "next_review_date",
  "outside_lt_act", "measurement_type",
  // Areas — GIA
  "area_basement_gia", "area_ground_gia", "area_first_gia", "area_other_gia",
  // Areas — NIA
  "area_basement_nia", "area_ground_nia", "area_first_nia", "area_first_sales_nia", "area_other_nia",
  // Areas — ITZA + totals
  "area_ground_itza", "gia_sqft", "nia_sqft", "itza_sqft", "units_applied",
  // Rental Income
  "passing_rent_pa", "marketing_rent_pa", "turnover_rent_payable", "erv_profile",
  "erv_pa", "rent_free_value", "capex_value",
  // Rates
  "rateable_value", "rates_payable",
  // Occ Costs
  "service_charge", "service_charge_cap", "insurance",
  // Shortfalls
  "shortfall_liability", "rental_shortfalls",
  // NOI
  "topped_up_noi", "noi_pa",
  // Comments
  "comments", "leasing_comments", "target_tenants", "target_company_ids", "underwriting_comments",
  // BGP integration
  "epc_rating", "rent_psf", "turnover_percent", "blended_erv",
  "deal_id", "letting_tracker_unit_id", "in_leasing_schedule", "sort_order",
  // Landsec Bluewater feed additions
  "landlord_break_date", "credit_rating", "deposit_held", "arrears_balance",
];

const NUMERIC_FIELDS = new Set([
  "term_years", "unexpired_term_break", "unexpired_term",
  "area_basement_gia", "area_ground_gia", "area_first_gia", "area_other_gia",
  "area_basement_nia", "area_ground_nia", "area_first_nia", "area_first_sales_nia", "area_other_nia",
  "area_ground_itza", "gia_sqft", "nia_sqft", "itza_sqft", "units_applied",
  "passing_rent_pa", "marketing_rent_pa", "turnover_rent_payable",
  "erv_pa", "rent_free_value", "capex_value",
  "rateable_value", "rates_payable",
  "service_charge", "service_charge_cap", "insurance",
  "rental_shortfalls", "topped_up_noi", "noi_pa",
  "rent_psf", "turnover_percent", "blended_erv", "sort_order",
  "deposit_held", "arrears_balance",
]);

const DATE_FIELDS = new Set([
  "lease_start", "break_date", "lease_expiry", "next_review_date", "landlord_break_date",
  "break_notice",
]);

function normaliseFieldValue(field: string, raw: any): any {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") {
    return NUMERIC_FIELDS.has(field) ? null : DATE_FIELDS.has(field) ? null : null;
  }
  if (NUMERIC_FIELDS.has(field)) {
    if (typeof raw === "number") return raw;
    const n = Number(String(raw).replace(/[£,]/g, ""));
    return isNaN(n) ? null : n;
  }
  if (DATE_FIELDS.has(field)) {
    const dt = new Date(raw);
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  }
  if (field === "in_leasing_schedule") return Boolean(raw);
  if (field === "target_company_ids") return Array.isArray(raw) ? raw : null;
  return String(raw);
}

router.post("/api/tenancy-schedule/unit", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const d = req.body;
    if (!d?.property_id) return res.status(400).json({ error: "property_id required" });

    const cols: string[] = ["property_id"];
    const placeholders: string[] = ["$1"];
    const values: any[] = [d.property_id];
    let idx = 2;
    for (const f of TENANCY_FIELDS) {
      if (!(f in d)) continue;
      const v = normaliseFieldValue(f, d[f]);
      if (v === undefined) continue;
      cols.push(f);
      placeholders.push(`$${idx++}`);
      values.push(v);
    }
    // Default status if not given — Vacant unless tenant_name provided.
    if (!cols.includes("status")) {
      cols.push("status");
      placeholders.push(`$${idx++}`);
      values.push(d.tenant_name && d.tenant_name !== "Vacant" ? "Occupied" : "Vacant");
    }
    const result = await pool.query(
      `INSERT INTO tenancy_schedule_units (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
      values
    );

    // Stamp brand FK from the new row's tenant name. Best-effort.
    const newId = result.rows[0]?.id;
    if (newId && (d.tenant_name || d.trading_name)) {
      await pool.query(
        `UPDATE tenancy_schedule_units
            SET tenant_company_id = ${resolveBrandIdSubquery("coalesce(trading_name, tenant_name, '')")}
          WHERE id = $1 AND tenant_company_id IS NULL`,
        [newId]
      ).catch((e: any) => console.warn("[tenancy] auto-resolve on insert failed:", e?.message));
    }

    // Auto-knit: any existing leasing / available / deal rows on the
    // same property with a matching unit_number should attach to the
    // new spine row. Drops the "Promote orphans" pressure since the
    // attachment now happens at insert time. Each table is updated
    // independently so a failure on one doesn't block the others;
    // each failure is logged with the table name so we can spot
    // patterns in production logs.
    if (newId) {
      const newRow = result.rows[0];
      const unitNum = (newRow?.unit_number || "").trim().toLowerCase();
      if (unitNum) {
        const knit = async (label: string, sql: string, params: any[]) => {
          try { await pool.query(sql, params); }
          catch (e: any) { console.warn(`[tenancy] auto-knit ${label} failed:`, e?.message); }
        };
        await Promise.all([
          knit(
            "leasing",
            `UPDATE leasing_schedule_units SET tenancy_unit_id = $1
              WHERE property_id = $2 AND tenancy_unit_id IS NULL
                AND lower(trim(coalesce(unit_name, ''))) = $3`,
            [newId, d.property_id, unitNum]
          ),
          knit(
            "available",
            `UPDATE available_units SET tenancy_unit_id = $1
              WHERE property_id = $2 AND tenancy_unit_id IS NULL
                AND lower(trim(coalesce(unit_name, ''))) = $3`,
            [newId, d.property_id, unitNum]
          ),
          // property_units lookup is scoped to the same property as
          // the deal — a different property_units row that happens
          // to share an id (e.g. legacy duplicate) cannot match here.
          knit(
            "deals",
            `UPDATE crm_deals d SET tenancy_unit_id = $1
              WHERE d.property_id = $2 AND d.tenancy_unit_id IS NULL
                AND lower(trim(coalesce(
                  (SELECT unit_name FROM property_units pu WHERE pu.id = d.unit_id AND pu.property_id = $2), ''))) = $3`,
            [newId, d.property_id, unitNum]
          ),
        ]);
      }
    }

    res.json(result.rows[0]);
  } catch (e: any) {
    console.error("[tenancy] create unit failed:", e?.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/api/tenancy-schedule/unit/:id", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { id } = req.params;
    const d = req.body;
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    // Allow 'status' alongside the shared TENANCY_FIELDS list.
    const updatable = [...TENANCY_FIELDS, "status"];
    for (const f of updatable) {
      if (!(f in d)) continue;
      const v = normaliseFieldValue(f, d[f]);
      if (v === undefined) continue;
      fields.push(`${f} = $${idx++}`);
      values.push(v);
    }
    if (fields.length === 0) return res.json({ ok: true });
    fields.push(`updated_at = NOW()`);
    values.push(id);
    const result = await pool.query(
      `UPDATE tenancy_schedule_units SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );

    // If the edit touched the tenant name or trading name, re-resolve
    // the brand FK so the row immediately points at the right brand
    // board (or NULL if no match). Cheap single-row update.
    if ("tenant_name" in d || "trading_name" in d) {
      await pool.query(
        `UPDATE tenancy_schedule_units
            SET tenant_company_id = ${resolveBrandIdSubquery("coalesce(trading_name, tenant_name, '')")}
          WHERE id = $1`,
        [id]
      ).catch((e: any) => console.warn("[tenancy] re-resolve failed:", e?.message));
    }

    // If the unit_number was renamed, re-knit downstream projections:
    // detach rows still pointing at the old name, attach rows whose
    // unit_name matches the new one. Keeps the spine ↔ projection
    // joins coherent without a manual re-resolve.
    if ("unit_number" in d) {
      const newRow = result.rows[0];
      const propId = newRow?.property_id;
      const newUnit = (newRow?.unit_number || "").trim().toLowerCase();
      if (propId) {
        await Promise.all([
          // Detach rows whose unit_name no longer matches the spine row.
          pool.query(
            `UPDATE leasing_schedule_units SET tenancy_unit_id = NULL
              WHERE tenancy_unit_id = $1
                AND lower(trim(coalesce(unit_name, ''))) <> $2`,
            [id, newUnit]
          ),
          pool.query(
            `UPDATE available_units SET tenancy_unit_id = NULL
              WHERE tenancy_unit_id = $1
                AND lower(trim(coalesce(unit_name, ''))) <> $2`,
            [id, newUnit]
          ),
          // Attach rows on the same property whose unit_name matches
          // the new value and that don't yet have a tenancy_unit_id.
          newUnit ? pool.query(
            `UPDATE leasing_schedule_units SET tenancy_unit_id = $1
              WHERE property_id = $2 AND tenancy_unit_id IS NULL
                AND lower(trim(coalesce(unit_name, ''))) = $3`,
            [id, propId, newUnit]
          ) : Promise.resolve(),
          newUnit ? pool.query(
            `UPDATE available_units SET tenancy_unit_id = $1
              WHERE property_id = $2 AND tenancy_unit_id IS NULL
                AND lower(trim(coalesce(unit_name, ''))) = $3`,
            [id, propId, newUnit]
          ) : Promise.resolve(),
        ]).catch((e: any) => console.warn("[tenancy] rename re-knit failed:", e?.message));
      }
    }

    res.json(result.rows[0]);
  } catch (e: any) {
    console.error("[tenancy] update unit failed:", e?.message);
    res.status(500).json({ error: e.message });
  }
});

router.delete("/api/tenancy-schedule/unit/:id", requireAuth, async (req, res) => {
  const pool = await getPool();
  // Atomic cascade: clear downstream FKs and delete the spine row in
  // a single transaction so we can never end up with FKs cleared and
  // the row still present (or vice versa).
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE leasing_schedule_units SET tenancy_unit_id = NULL WHERE tenancy_unit_id = $1`, [req.params.id]);
    await client.query(`UPDATE available_units       SET tenancy_unit_id = NULL WHERE tenancy_unit_id = $1`, [req.params.id]);
    await client.query(`UPDATE crm_deals             SET tenancy_unit_id = NULL WHERE tenancy_unit_id = $1`, [req.params.id]);
    await client.query("DELETE FROM tenancy_schedule_units WHERE id = $1", [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => { /* best-effort */ });
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

function excelDateToISO(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (!lower || lower === 'n/a' || lower === 'none' || lower === '-' || lower === 'taw' || lower === 'holding over') return null;
    const parsed = new Date(val);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
    return null;
  }
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  }
  return null;
}

function numVal(v: any): number {
  if (v == null || v === '' || v === 'n/a' || v === 'N/A') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function strVal(v: any): string {
  if (v == null) return '';
  return String(v).trim();
}

// Normalise an arbitrary header string so we can match it against the alias
// map regardless of capitalisation, punctuation, whitespace or multi-line
// labels. "Basement (sq ft) - GIA" → "basement sq ft gia".
function normaliseHeader(h: any): string {
  return String(h || "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Header text → DB field. Covers Landsec column names, BGP legacy template
// names, and common variations. Extend here as new templates surface.
const HEADER_ALIASES: Record<string, string> = {
  // Unit
  "grouping": "grouping",
  "zone": "grouping",                 // Zone heading (Wintergarden / Plaza)
  "floor": "floor_level",             // Landsec Bluewater feed "Floor 100/101"
  "floor level": "floor_level",
  "unit": "unit_number",
  "unit name": "unit_number",   // Landsec Bluewater feed
  "unit number": "unit_number",
  "use": "permitted_use",
  "unit type": "permitted_use", // Landsec Bluewater feed
  "permitted use": "permitted_use",
  "status": "status",
  "void status": "status",      // Landsec Bluewater feed
  "am initiative": "am_initiative",
  // Tenant
  "tenant": "tenant_name",
  "tenant name": "tenant_name",
  "tenant account": "tenant_name", // Landsec Bluewater feed
  "trading as": "trading_name",
  "trading name": "trading_name",
  "tenant mix": "tenant_mix",
  "future tenant": "target_tenants", // Landsec Bluewater feed
  // Lease
  "start": "lease_start",
  "lease start": "lease_start",
  "letting start date": "lease_start", // Landsec Bluewater feed
  "break date": "break_date",
  "earliest tenant break": "break_date",  // Landsec Bluewater feed
  "earliest landlord break": "landlord_break_date", // Landsec Bluewater feed
  "details": "break_details",
  "notice note": "break_notice",
  "expiry": "lease_expiry",
  "lease expiry": "lease_expiry",
  "letting expiry date": "lease_expiry", // Landsec Bluewater feed
  "term": "term_years",
  "term yrs": "term_years",
  "unexp term break": "unexpired_term_break",
  "unexp term expiry": "unexpired_term",
  "months to expiry": "unexpired_term",  // Landsec feed gives months not years
  "next review": "next_review_date",
  "review basis": "erv_profile",   // Landsec Bluewater feed
  "l t act": "outside_lt_act",
  "outside l t act": "outside_lt_act",
  "measurement": "measurement_type",
  // Areas — GIA per floor
  "basement sq ft gia": "area_basement_gia",
  "ground sq ft gia": "area_ground_gia",
  "first sq ft gia": "area_first_gia",
  "other sq ft gia": "area_other_gia",
  // Areas — NIA per floor
  "basement sq ft nia": "area_basement_nia",
  "ground sq ft nia": "area_ground_nia",
  "first sq ft nia": "area_first_nia",
  "first sales sq ft nia": "area_first_sales_nia",
  "other sq ft nia": "area_other_nia",
  // Areas — totals + ITZA
  "ground itza": "area_ground_itza",
  "gia sq ft": "gia_sqft",
  "nia sq ft": "nia_sqft",
  "unit lettable area": "nia_sqft",   // Landsec Bluewater feed
  "itza itgf sq ft": "itza_sqft",
  "itza sq ft": "itza_sqft",
  "units applied": "units_applied",
  // Rental — Landsec's "Target Rent" is the ERV not the passing rent, so it
  // lands in erv_pa. If a feed labels its real passing rent explicitly we'll
  // still pick it up.
  "rent pa": "passing_rent_pa",
  "passing rent pa": "passing_rent_pa",
  "target rent": "erv_pa",            // Landsec Bluewater feed — ERV not passing
  "marketing rent pa": "marketing_rent_pa",
  "t o rent payable": "turnover_rent_payable",
  "t o": "turnover_percent",          // Landsec "T/O %" column
  "erv profile": "erv_profile",
  "erv pa": "erv_pa",
  "rent free value": "rent_free_value",
  "capex value": "capex_value",
  "target rent psf": "rent_psf",      // Landsec Bluewater feed
  // Rates
  "rateable value": "rateable_value",
  "unit rateable value": "rateable_value",  // Landsec Bluewater feed
  "rates payable pa": "rates_payable",
  "rates payable": "rates_payable",
  "unit rates payable": "rates_payable",  // Landsec Bluewater feed
  // Occ costs
  "service charge pa": "service_charge",
  "service charge": "service_charge",
  "unit service charge": "service_charge",  // Landsec Bluewater feed
  "service charge cap pa": "service_charge_cap",
  "service charge cap": "service_charge_cap",
  "insurance pa": "insurance",
  "insurance": "insurance",
  "unit insurance": "insurance",      // Landsec Bluewater feed
  // Landsec Bluewater feed — covenant fields
  "credit check rating": "credit_rating",
  "deposit held": "deposit_held",
  "total arrears": "arrears_balance",
  // Shortfalls
  "shortfall liability l t": "shortfall_liability",
  "shortfall liability": "shortfall_liability",
  "total ll shortfalls pa": "rental_shortfalls",
  "total ll shortfalls": "rental_shortfalls",
  "rental shortfalls": "rental_shortfalls",
  // NOI
  "topped up noi pa": "topped_up_noi",
  "topped up noi": "topped_up_noi",
  "noi pa": "noi_pa",
  "noi": "noi_pa",
  // Comments
  "comments": "comments",
  "leasing comments": "leasing_comments",
  "target tenants": "target_tenants",
  "underwriting comments queries": "underwriting_comments",
  "underwriting comments": "underwriting_comments",
  // BGP extras
  "epc rating": "epc_rating",
  "epc": "epc_rating",
  "rent psf": "rent_psf",
  "rent £psf": "rent_psf",
  "rent psf £": "rent_psf",
  "turnover percent": "turnover_percent",
  "turnover": "turnover_percent",
  "blended erv": "blended_erv",
};

router.post("/api/tenancy-schedule/import-excel", requireAuth, upload.single("file"), async (req: any, res) => {
  try {
    const pool = await getPool();
    const propertyId = req.body.propertyId;
    if (!propertyId) return res.status(400).json({ error: "propertyId required" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const XLSX = await import("xlsx");
    const wb = XLSX.read(req.file.buffer);
    // Prefer a sheet named "TS" / "Tenancy Schedule"; fall back to the first.
    const sheetName =
      wb.SheetNames.find((s: string) => /tenancy\s*schedule/i.test(s))
      || wb.SheetNames.find((s: string) => s === "TS")
      || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[];

    // Landsec template has a CATEGORY band above the actual column headers
    // (Unit Details / Tenant Details / etc), so we scan the first ~15 rows
    // for the row that matches the most field aliases.
    let bestHeaderIdx = -1;
    let bestHits = 0;
    for (let i = 0; i < Math.min(15, data.length); i++) {
      const row = data[i] || [];
      let hits = 0;
      for (const cell of row) {
        if (cell == null) continue;
        if (HEADER_ALIASES[normaliseHeader(cell)]) hits++;
      }
      if (hits > bestHits) {
        bestHits = hits;
        bestHeaderIdx = i;
      }
    }
    if (bestHeaderIdx === -1 || bestHits < 3) {
      return res.status(400).json({
        error: "Could not find a recognisable header row. Expected columns like 'Tenant', 'Unit', 'Rent (pa)', etc.",
      });
    }

    // Build column index → DB field map for this sheet.
    const headerRow = data[bestHeaderIdx] || [];
    const colToField: Record<number, string> = {};
    for (let c = 0; c < headerRow.length; c++) {
      const field = HEADER_ALIASES[normaliseHeader(headerRow[c])];
      if (field) colToField[c] = field;
    }

    const clearExisting = req.body.clearExisting === "true";
    if (clearExisting) {
      await pool.query("DELETE FROM tenancy_schedule_units WHERE property_id = $1", [propertyId]);
    }

    let imported = 0;
    let sortOrder = 0;
    let currentGrouping = ""; // Landsec tracks a "Grouping" header band

    for (let i = bestHeaderIdx + 1; i < data.length; i++) {
      const row = data[i] || [];
      if (row.length === 0) continue;

      // Build a partial record from whichever columns we recognise.
      const rec: Record<string, any> = {};
      for (const [colIdxStr, field] of Object.entries(colToField)) {
        const colIdx = Number(colIdxStr);
        const raw = row[colIdx];
        if (raw == null) continue;
        // Dates from xlsx may arrive as Excel-serial numbers
        if (DATE_FIELDS.has(field) && typeof raw === "number") {
          const dt = new Date((raw - 25569) * 86400 * 1000);
          if (!isNaN(dt.getTime())) {
            rec[field] = dt.toISOString().slice(0, 10);
            continue;
          }
        }
        rec[field] = normaliseFieldValue(field, raw);
      }

      // Grouping row carry-forward — if only the grouping cell has a value
      // and there's no tenant or unit, treat as a band header.
      const hasUnit = rec.unit_number || rec.tenant_name;
      if (rec.grouping && !hasUnit) {
        currentGrouping = String(rec.grouping);
        continue;
      }
      if (!hasUnit) continue;

      if (!rec.grouping && currentGrouping) rec.grouping = currentGrouping;
      if (!rec.status) {
        const tn = (rec.tenant_name || "").toString().toLowerCase();
        rec.status = !tn || tn === "vacant" ? "Vacant" : "Occupied";
      }
      sortOrder++;
      rec.sort_order = sortOrder;

      const cols = ["property_id", ...Object.keys(rec)];
      const placeholders = cols.map((_, idx) => `$${idx + 1}`);
      const values = [propertyId, ...Object.values(rec)];

      try {
        await pool.query(
          `INSERT INTO tenancy_schedule_units (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`,
          values
        );
        imported++;
      } catch (e: any) {
        console.warn(`[tenancy-import] row ${i + 1} skipped: ${e.message}`);
      }
    }

    // Auto-resolve tenant → brand FKs across the freshly imported rows
    // so the property page lights up without a manual click. Failures
    // here are non-fatal: the import is already committed and the user
    // can still hit "Resolve unmatched tenants" later.
    let resolution: { total: number; resolved: number; unresolved: number } | null = null;
    try {
      resolution = await backfillPropertyTenants(propertyId);
    } catch (e: any) {
      console.warn("[tenancy-import] resolver pass failed:", e?.message);
    }

    res.json({
      imported,
      headerRow: bestHeaderIdx + 1,
      mappedColumns: Object.values(colToField),
      resolution,
      message: `${imported} units imported${resolution ? ` · ${resolution.resolved}/${resolution.total} tenants resolved` : ""}`,
    });
  } catch (e: any) {
    console.error("[tenancy-import] failed:", e);
    res.status(500).json({ error: e.message });
  }
});

// Landsec-aligned column definition for the export. Each column has:
//   field — DB column name
//   label — header shown in the spreadsheet
//   band  — category band (drawn as a merged header above the column row)
//   width — column width in Excel "characters"
//   fmt   — "currency" | "currency_psf" | "pct" | "num" | "date" | undefined
const EXPORT_COLUMNS: Array<{ field: string; label: string; band: string; width: number; fmt?: string }> = [
  // Unit Details
  { field: "__idx",       label: "#",            band: "Unit Details", width: 5  },
  { field: "grouping",    label: "Grouping",     band: "Unit Details", width: 18 },
  { field: "unit_number", label: "Unit",         band: "Unit Details", width: 12 },
  { field: "permitted_use", label: "Use",        band: "Unit Details", width: 16 },
  { field: "status",      label: "Status",       band: "Unit Details", width: 12 },
  { field: "am_initiative", label: "AM Initiative?", band: "Unit Details", width: 18 },
  // Tenant Details
  { field: "tenant_name", label: "Tenant",       band: "Tenant Details", width: 24 },
  { field: "trading_name", label: "Trading As",  band: "Tenant Details", width: 20 },
  { field: "tenant_mix",  label: "Tenant Mix",   band: "Tenant Details", width: 16 },
  // Lease Details
  { field: "lease_start", label: "Start",        band: "Lease Details", width: 12, fmt: "date" },
  { field: "break_date",  label: "Break Date",   band: "Lease Details", width: 12, fmt: "date" },
  { field: "break_details", label: "Break Details", band: "Lease Details", width: 22 },
  { field: "break_notice", label: "Notice/Note", band: "Lease Details", width: 18 },
  { field: "lease_expiry", label: "Expiry",      band: "Lease Details", width: 12, fmt: "date" },
  { field: "term_years",  label: "Term",         band: "Lease Details", width: 8,  fmt: "num" },
  { field: "unexpired_term_break", label: "Unexp. Term (Break)", band: "Lease Details", width: 12, fmt: "num" },
  { field: "unexpired_term", label: "Unexp. Term (Expiry)", band: "Lease Details", width: 12, fmt: "num" },
  { field: "next_review_date", label: "Next Review", band: "Lease Details", width: 12, fmt: "date" },
  { field: "outside_lt_act", label: "L&T Act",   band: "Lease Details", width: 14 },
  { field: "measurement_type", label: "Measurement", band: "Lease Details", width: 14 },
  // Areas — GIA
  { field: "area_basement_gia", label: "Basement (GIA)", band: "Areas (sq ft) — GIA", width: 12, fmt: "num" },
  { field: "area_ground_gia",   label: "Ground (GIA)",   band: "Areas (sq ft) — GIA", width: 12, fmt: "num" },
  { field: "area_first_gia",    label: "First (GIA)",    band: "Areas (sq ft) — GIA", width: 12, fmt: "num" },
  { field: "area_other_gia",    label: "Other (GIA)",    band: "Areas (sq ft) — GIA", width: 12, fmt: "num" },
  // Areas — NIA
  { field: "area_basement_nia",     label: "Basement (NIA)",     band: "Areas (sq ft) — NIA", width: 12, fmt: "num" },
  { field: "area_ground_nia",       label: "Ground (NIA)",       band: "Areas (sq ft) — NIA", width: 12, fmt: "num" },
  { field: "area_ground_itza",      label: "Ground (ITZA)",      band: "Areas (sq ft) — NIA", width: 12, fmt: "num" },
  { field: "area_first_sales_nia",  label: "First Sales (NIA)",  band: "Areas (sq ft) — NIA", width: 12, fmt: "num" },
  { field: "area_first_nia",        label: "First (NIA)",        band: "Areas (sq ft) — NIA", width: 12, fmt: "num" },
  { field: "area_other_nia",        label: "Other (NIA)",        band: "Areas (sq ft) — NIA", width: 12, fmt: "num" },
  { field: "gia_sqft",  label: "GIA",            band: "Areas — Totals", width: 12, fmt: "num" },
  { field: "nia_sqft",  label: "NIA",            band: "Areas — Totals", width: 12, fmt: "num" },
  { field: "itza_sqft", label: "ITZA / ITGF",    band: "Areas — Totals", width: 12, fmt: "num" },
  { field: "units_applied", label: "Units Applied", band: "Areas — Totals", width: 12, fmt: "num" },
  // Rental Income
  { field: "passing_rent_pa",       label: "Rent (pa)",          band: "Rental Income", width: 14, fmt: "currency" },
  { field: "marketing_rent_pa",     label: "Marketing Rent (pa)", band: "Rental Income", width: 14, fmt: "currency" },
  { field: "turnover_rent_payable", label: "T/O Rent Payable",   band: "Rental Income", width: 14, fmt: "currency" },
  { field: "erv_profile",           label: "ERV Profile",        band: "Rental Income", width: 14 },
  { field: "erv_pa",                label: "ERV (pa)",           band: "Rental Income", width: 14, fmt: "currency" },
  { field: "rent_free_value",       label: "Rent Free Value",    band: "Rental Income", width: 14, fmt: "currency" },
  { field: "capex_value",           label: "Capex Value",        band: "Rental Income", width: 14, fmt: "currency" },
  // Rates
  { field: "rateable_value", label: "Rateable Value",      band: "MLA",  width: 14, fmt: "currency" },
  { field: "rates_payable",  label: "Rates Payable (pa)",  band: "MLA",  width: 14, fmt: "currency" },
  // Occ Costs
  { field: "service_charge",    label: "Service Charge (pa)",     band: "Occupational Costs", width: 14, fmt: "currency" },
  { field: "service_charge_cap", label: "Service Charge Cap (pa)", band: "Occupational Costs", width: 14, fmt: "currency" },
  { field: "insurance",         label: "Insurance (pa)",          band: "Occupational Costs", width: 14, fmt: "currency" },
  // Shortfalls
  { field: "shortfall_liability", label: "Shortfall Liability (L/T)", band: "Shortfalls", width: 16 },
  { field: "rental_shortfalls",   label: "Total LL Shortfalls (pa)", band: "Shortfalls", width: 16, fmt: "currency" },
  // NOI
  { field: "topped_up_noi", label: "Topped Up NOI (pa)", band: "NOI", width: 14, fmt: "currency" },
  { field: "noi_pa",        label: "NOI (pa)",           band: "NOI", width: 14, fmt: "currency" },
  // Comments
  { field: "comments",              label: "Comments",            band: "Comments", width: 28 },
  { field: "leasing_comments",      label: "Leasing Comments",    band: "Comments", width: 28 },
  { field: "target_tenants",        label: "Target Tenants",      band: "Comments", width: 28 },
  { field: "underwriting_comments", label: "Underwriting Comments", band: "Comments", width: 28 },
];

router.get("/api/tenancy-schedule/property/:propertyId/export-excel", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.params;

    const propResult = await pool.query("SELECT name FROM crm_properties WHERE id = $1", [propertyId]);
    const propertyName = propResult.rows[0]?.name || "Property";

    const result = await pool.query(
      "SELECT * FROM tenancy_schedule_units WHERE property_id = $1 ORDER BY grouping NULLS LAST, premises NULLS LAST, sort_order, id",
      [propertyId]
    );

    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "Bruce Gillingham Pollard";
    wb.created = new Date();

    // Brand palette — matches BGP house style used elsewhere in the app.
    const DARK_BLUE = "FF082861";
    const WARM_GREY = "FFE8E6DF";
    const LIGHT_GREY_ALT = "FFF7F6F2";
    const BAND_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_BLUE } };
    const COL_HEADER_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FF13396B" } };
    const ALT_ROW_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GREY_ALT } };
    const GROUPING_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: WARM_GREY } };
    const TOTAL_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: WARM_GREY } };
    const THIN_BORDER: any = {
      top: { style: "thin", color: { argb: "FFDDDFE0" } },
      left: { style: "thin", color: { argb: "FFDDDFE0" } },
      bottom: { style: "thin", color: { argb: "FFDDDFE0" } },
      right: { style: "thin", color: { argb: "FFDDDFE0" } },
    };
    const CURRENCY_FMT = '£#,##0';
    const CURRENCY_PSF_FMT = '£#,##0.00';
    const NUM_FMT = '#,##0';
    const DATE_FMT = 'dd-mmm-yyyy';

    const safeSheetName = propertyName.replace(/[\\/*?\[\]:]/g, "").slice(0, 31) || "Tenancy";
    const ws = wb.addWorksheet(safeSheetName, { views: [{ state: "frozen", ySplit: 4, xSplit: 3 }] });

    const totalCols = EXPORT_COLUMNS.length;

    // Row 1: Title
    const titleRow = ws.addRow([`${propertyName} — Tenancy Schedule`]);
    ws.mergeCells(titleRow.number, 1, titleRow.number, totalCols);
    const titleCell = ws.getCell(titleRow.number, 1);
    titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell.fill = BAND_FILL;
    titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(titleRow.number).height = 36;

    // Row 2: Exported date / footer line
    const dateRow = ws.addRow([
      `Bruce Gillingham Pollard  ·  Exported ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}  ·  ${result.rows.length} units`,
    ]);
    ws.mergeCells(dateRow.number, 1, dateRow.number, totalCols);
    const dateCell = ws.getCell(dateRow.number, 1);
    dateCell.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF596264" } };
    dateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARM_GREY } };
    dateCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(dateRow.number).height = 20;

    // Row 3: Category bands — merge contiguous columns sharing the same band.
    const bandRow = ws.addRow(EXPORT_COLUMNS.map(c => c.band));
    bandRow.height = 22;
    let mergeStart = 1;
    for (let i = 1; i <= totalCols; i++) {
      const curr = EXPORT_COLUMNS[i - 1].band;
      const next = i === totalCols ? null : EXPORT_COLUMNS[i].band;
      if (curr !== next) {
        if (mergeStart !== i) ws.mergeCells(bandRow.number, mergeStart, bandRow.number, i);
        const c = ws.getCell(bandRow.number, mergeStart);
        c.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
        c.fill = BAND_FILL;
        c.alignment = { vertical: "middle", horizontal: "center" };
        c.border = THIN_BORDER;
        mergeStart = i + 1;
      }
    }

    // Row 4: Column headers
    const headerRow = ws.addRow(EXPORT_COLUMNS.map(c => c.label));
    headerRow.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = COL_HEADER_FILL;
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = THIN_BORDER;
    });
    headerRow.height = 36;

    // Column widths
    ws.columns = EXPORT_COLUMNS.map(c => ({ width: c.width }));

    function formatDate(d: any): any {
      if (!d) return null;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return null;
      return dt;
    }

    // Data rows — group by `grouping` and emit a band row whenever it changes
    // so the export mirrors the Landsec layout.
    let idx = 0;
    let lastGrouping = "__none__";
    const totals: Record<string, number> = {};
    const numericFields = EXPORT_COLUMNS.filter(c => c.fmt === "currency" || c.fmt === "currency_psf" || c.fmt === "num").map(c => c.field);
    for (const f of numericFields) totals[f] = 0;

    for (const u of result.rows) {
      // Grouping band row
      const g = (u.grouping || "").trim();
      if (g && g !== lastGrouping) {
        const gRow = ws.addRow([g]);
        ws.mergeCells(gRow.number, 1, gRow.number, totalCols);
        const gc = ws.getCell(gRow.number, 1);
        gc.font = { name: "Calibri", size: 11, bold: true, color: { argb: DARK_BLUE } };
        gc.fill = GROUPING_FILL;
        gc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        gc.border = {
          top: { style: "medium", color: { argb: DARK_BLUE } },
          bottom: { style: "thin", color: { argb: DARK_BLUE } },
        } as any;
        gRow.height = 22;
        lastGrouping = g;
      }

      idx++;
      const values = EXPORT_COLUMNS.map(c => {
        if (c.field === "__idx") return idx;
        const raw = u[c.field];
        if (raw == null || raw === "") return null;
        if (c.fmt === "date") return formatDate(raw);
        if (c.fmt === "currency" || c.fmt === "currency_psf" || c.fmt === "num") {
          const n = Number(raw);
          if (!isNaN(n)) {
            totals[c.field] = (totals[c.field] || 0) + n;
            return n;
          }
          return null;
        }
        return raw;
      });

      const row = ws.addRow(values);
      const isAlt = idx % 2 === 0;
      row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
        const col = EXPORT_COLUMNS[colNumber - 1];
        cell.font = { name: "Calibri", size: 10 };
        cell.alignment = { vertical: "middle", wrapText: col?.fmt === undefined && col?.width > 20 };
        cell.border = THIN_BORDER;
        if (isAlt) cell.fill = ALT_ROW_FILL;
        if (col?.fmt === "currency") cell.numFmt = CURRENCY_FMT;
        else if (col?.fmt === "currency_psf") cell.numFmt = CURRENCY_PSF_FMT;
        else if (col?.fmt === "num") cell.numFmt = NUM_FMT;
        else if (col?.fmt === "date") cell.numFmt = DATE_FMT;
      });
      row.height = 20;
    }

    // Totals row
    if (result.rows.length > 0) {
      const totalValues = EXPORT_COLUMNS.map(c => {
        if (c.field === "__idx") return "";
        if (c.field === "tenant_name") return "TOTAL";
        if (totals[c.field] !== undefined) return totals[c.field] || null;
        return "";
      });
      const totalRow = ws.addRow(totalValues);
      totalRow.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
        const col = EXPORT_COLUMNS[colNumber - 1];
        cell.font = { name: "Calibri", size: 10, bold: true };
        cell.fill = TOTAL_FILL;
        cell.alignment = { vertical: "middle" };
        cell.border = {
          top: { style: "medium", color: { argb: DARK_BLUE } },
          left: { style: "thin", color: { argb: "FFDDDFE0" } },
          bottom: { style: "medium", color: { argb: DARK_BLUE } },
          right: { style: "thin", color: { argb: "FFDDDFE0" } },
        };
        if (col?.fmt === "currency") cell.numFmt = CURRENCY_FMT;
        else if (col?.fmt === "currency_psf") cell.numFmt = CURRENCY_PSF_FMT;
        else if (col?.fmt === "num") cell.numFmt = NUM_FMT;
      });
      totalRow.height = 24;
    }

    // Auto-filter on the column-header row, frozen pane keeps title + bands visible.
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: totalCols } };

    const buffer = await wb.xlsx.writeBuffer();
    const safeName = propertyName.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_Tenancy_Schedule.xlsx"`);
    res.send(Buffer.from(buffer as ArrayBuffer));
  } catch (e: any) {
    console.error("[tenancy-export] failed:", e?.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/tenancy-schedule/property/:propertyId/links", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.params;

    const deals = await pool.query(
      "SELECT id, name, status, tenant_id, rent_pa FROM crm_deals WHERE property_id = $1",
      [propertyId]
    );

    const lettingUnits = await pool.query(
      "SELECT id, unit_name, marketing_status, \"dealId\" FROM available_units WHERE property_id = $1",
      [propertyId]
    );

    res.json({
      deals: deals.rows,
      lettingUnits: lettingUnits.rows
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/tenancy-schedule/bulk-delete", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.body;
    if (!propertyId) return res.status(400).json({ error: "propertyId required" });
    await pool.query("DELETE FROM tenancy_schedule_units WHERE property_id = $1", [propertyId]);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Audit: how many rows have non-null data in each column we're considering
// dropping as part of the Landsec-template alignment. Tells us if any of the
// legacy columns has live data we'd need to migrate before removing.
router.get("/api/tenancy-schedule/audit-legacy-columns", requireAuth, async (_req, res) => {
  const pool = await getPool();
  try {
    // First: does the table even exist?
    const exists = await pool.query(
      `SELECT to_regclass('public.tenancy_schedule_units') AS reg`
    );
    if (!exists.rows[0]?.reg) {
      return res.json({ error: "Table tenancy_schedule_units does not exist", existing_columns: [] });
    }

    // Get every column actually in the table so we don't query for ones
    // that aren't there.
    const colsResult = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tenancy_schedule_units'
        ORDER BY ordinal_position`
    );
    const existingColumns: string[] = colsResult.rows.map((r: any) => r.column_name);

    const legacyCols = [
      "area_basement", "area_ground", "area_first", "area_second", "area_other",
      "landlord_shortfall", "net_income", "total_occ_costs", "occ_costs_psf",
      "wault_rent_percent", "break_type",
      "rent_review_1_date", "rent_review_1_amount",
      "rent_review_2_date", "rent_review_2_amount",
      "rent_review_3_date", "rent_review_3_amount",
      "rent_review_4_date", "rent_review_4_amount",
    ];
    const total = await pool.query("SELECT COUNT(*)::int AS n FROM tenancy_schedule_units");
    const out: Array<{ column: string; exists: boolean; nonNullRows: number; sampleValues: string[] }> = [];
    for (const col of legacyCols) {
      if (!existingColumns.includes(col)) {
        out.push({ column: col, exists: false, nonNullRows: 0, sampleValues: ["(column does not exist)"] });
        continue;
      }
      try {
        const c = await pool.query(
          `SELECT COUNT(*)::int AS n FROM tenancy_schedule_units
            WHERE ${col} IS NOT NULL AND ${col}::text <> '' AND ${col}::text <> '0'`
        );
        const samples = await pool.query(
          `SELECT DISTINCT ${col}::text AS v FROM tenancy_schedule_units
            WHERE ${col} IS NOT NULL AND ${col}::text <> '' AND ${col}::text <> '0' LIMIT 3`
        );
        out.push({
          column: col,
          exists: true,
          nonNullRows: c.rows[0]?.n ?? 0,
          sampleValues: samples.rows.map((r: any) => String(r.v)),
        });
      } catch (e: any) {
        out.push({ column: col, exists: true, nonNullRows: -1, sampleValues: [`query error: ${e.message}`] });
      }
    }
    out.sort((a, b) => b.nonNullRows - a.nonNullRows);
    res.json({ totalRows: total.rows[0]?.n ?? 0, existingColumns, columns: out });
  } catch (e: any) {
    res.status(500).json({ error: e.message, stack: e.stack?.split("\n").slice(0, 3) });
  }
});

// One-click backfill — runs the tenant→brand resolver AND the
// tenancy_unit_id resolver across every tenancy / leasing / available
// row on the property where the FKs are still NULL. UI surfaces this
// on the property linkage card so the team can resolve everything in
// one go.
router.post("/api/properties/:propertyId/resolve-tenants", requireAuth, async (req, res) => {
  try {
    const { propertyId } = req.params;
    const [tenants, units] = await Promise.all([
      backfillPropertyTenants(propertyId),
      backfillPropertyUnitFks(propertyId),
    ]);
    res.json({ ...tenants, ...units });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// List of tenants on this property that the resolver couldn't match
// — surfaces the exact strings the team needs to either (a) create a
// CRM brand for, or (b) add as a trading-entity alias on an existing
// brand. Counts the same row once even if it appears in multiple
// schedules — the lease counterparty is what matters.
router.get("/api/properties/:propertyId/unresolved-tenants", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.params;
    const { rows } = await pool.query(
      `SELECT DISTINCT
              coalesce(NULLIF(trim(trading_name), ''), trim(tenant_name)) AS name,
              COUNT(*) AS units
         FROM tenancy_schedule_units
        WHERE property_id = $1
          AND tenant_company_id IS NULL
          AND coalesce(NULLIF(trim(trading_name), ''), trim(tenant_name), '') <> ''
          AND lower(coalesce(NULLIF(trim(trading_name), ''), trim(tenant_name), '')) NOT IN ('vacant', 'void', '—', '-')
        GROUP BY 1
        ORDER BY 2 DESC, 1`,
      [propertyId]
    );
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Manual assignment — when a tenancy row's tenant name doesn't match
// any brand, the team picks a brand from the CRM and we stamp the FK
// onto every row on this property sharing that exact tenant name.
// Also, optionally, adds the tenant name as a trading-entity alias on
// the chosen brand so future imports auto-resolve.
router.post("/api/properties/:propertyId/assign-tenant-brand", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.params;
    const { tenantName, brandCompanyId, addAsTradingEntity } = req.body as {
      tenantName: string; brandCompanyId: string; addAsTradingEntity?: boolean;
    };
    if (!tenantName || !brandCompanyId) {
      return res.status(400).json({ error: "tenantName and brandCompanyId are required" });
    }

    const updated = await pool.query(
      `UPDATE tenancy_schedule_units
          SET tenant_company_id = $1
        WHERE property_id = $2
          AND tenant_company_id IS NULL
          AND lower(trim(coalesce(NULLIF(trim(trading_name), ''), tenant_name, ''))) = lower(trim($3))`,
      [brandCompanyId, propertyId, tenantName]
    );

    // Mirror onto the leasing schedule + available_units on the same
    // tenant string so the team's one click resolves the whole row
    // family.
    await pool.query(
      `UPDATE leasing_schedule_units
          SET tenant_company_id = $1
        WHERE property_id = $2
          AND tenant_company_id IS NULL
          AND lower(trim(coalesce(tenant_name, ''))) = lower(trim($3))`,
      [brandCompanyId, propertyId, tenantName]
    );

    if (addAsTradingEntity) {
      // Append to crm_companies.trading_entities — dedupe by lowered name.
      await pool.query(
        `UPDATE crm_companies
            SET trading_entities = COALESCE(trading_entities, '[]'::jsonb) ||
              jsonb_build_array(jsonb_build_object('name', trim($2), 'added_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ')))
          WHERE id = $1
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(trading_entities, '[]'::jsonb)) AS e
               WHERE lower(trim(coalesce(e->>'name', ''))) = lower(trim($2))
            )`,
        [brandCompanyId, tenantName]
      );
    }

    res.json({ updated: updated.rowCount || 0 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Promote downstream orphans into the tenancy spine. When the team
// has leasing-schedule rows or available_units rows on a property
// that don't yet exist on the tenancy schedule (i.e. tenancy_unit_id
// is NULL because no matching unit_number was found), create the
// missing tenancy_schedule_units row from the leasing/available data
// and stamp tenancy_unit_id back. The tenancy schedule becomes the
// complete spine in one click.
//
// Vacant units come across with status='Vacant', occupied leasing
// rows come across as Occupied. Either way the row is on the spine
// and the dashboard sees the unit consistently from then on.
router.post("/api/properties/:propertyId/promote-orphans-to-tenancy", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.params;

    // Leasing rows without a matching tenancy unit on the same
    // property. Create one tenancy row per distinct unit_name, then
    // stamp the FK back on the leasing rows that match. When more
    // than one leasing row shares the same unit_name we pick the
    // most-recently-updated row's data (deterministic + most current
    // tenant / rent / expiry survives).
    const leasingPromoted = await pool.query(
      `WITH orphans AS (
         SELECT DISTINCT ON (lower(trim(u.unit_name)))
                u.unit_name, u.tenant_name, u.positioning, u.zone,
                u.sqft AS nia_sqft, u.rent_pa AS passing_rent_pa,
                u.lease_expiry, u.lease_break, u.tenant_company_id
           FROM leasing_schedule_units u
          WHERE u.property_id = $1
            AND u.tenancy_unit_id IS NULL
            AND coalesce(trim(u.unit_name), '') <> ''
            AND NOT EXISTS (
              SELECT 1 FROM tenancy_schedule_units ts
               WHERE ts.property_id = $1
                 AND lower(trim(ts.unit_number)) = lower(trim(u.unit_name))
            )
          ORDER BY lower(trim(u.unit_name)), u.updated_at DESC NULLS LAST, u.id
       )
       INSERT INTO tenancy_schedule_units (
         property_id, unit_number, premises, tenant_name, permitted_use,
         nia_sqft, passing_rent_pa, lease_expiry, break_date,
         status, tenant_company_id
       )
       SELECT $1, o.unit_name, o.zone, o.tenant_name, o.positioning,
              o.nia_sqft, o.passing_rent_pa, o.lease_expiry, o.lease_break,
              CASE WHEN coalesce(trim(o.tenant_name), '') = '' OR lower(o.tenant_name) IN ('vacant', 'void') THEN 'Vacant' ELSE 'Occupied' END,
              o.tenant_company_id
         FROM orphans o
       RETURNING id`,
      [propertyId]
    );

    // Same for available_units — vacant rows on the tracker that
    // aren't on the tenancy spine. NOT EXISTS also excludes rows
    // whose unit_name already got promoted in the leasing pass above
    // (the leasing INSERT committed within this transaction is
    // visible to subsequent queries on the same connection).
    const availablePromoted = await pool.query(
      `WITH orphans AS (
         SELECT DISTINCT ON (lower(trim(au.unit_name)))
                au.unit_name, au.floor, au.sqft, au.use_class, au.asking_rent
           FROM available_units au
          WHERE au.property_id = $1
            AND au.tenancy_unit_id IS NULL
            AND coalesce(trim(au.unit_name), '') <> ''
            AND NOT EXISTS (
              SELECT 1 FROM tenancy_schedule_units ts
               WHERE ts.property_id = $1
                 AND lower(trim(ts.unit_number)) = lower(trim(au.unit_name))
            )
          ORDER BY lower(trim(au.unit_name)), au.updated_at DESC NULLS LAST, au.id
       )
       INSERT INTO tenancy_schedule_units (
         property_id, unit_number, floor_level, permitted_use,
         nia_sqft, erv_pa, status, tenant_name
       )
       SELECT $1, o.unit_name, o.floor, o.use_class,
              o.sqft, o.asking_rent, 'Vacant', 'VACANT'
         FROM orphans o
       RETURNING id`,
      [propertyId]
    );

    // Now backfill tenancy_unit_id on every leasing / available row
    // — same resolver as the normal backfill path.
    const units = await backfillPropertyUnitFks(propertyId);

    res.json({
      tenancy_rows_created: (leasingPromoted.rowCount || 0) + (availablePromoted.rowCount || 0),
      leasing_promoted: leasingPromoted.rowCount || 0,
      available_promoted: availablePromoted.rowCount || 0,
      ...units,
    });
  } catch (e: any) {
    console.error("[promote-orphans]", e?.message);
    res.status(500).json({ error: e.message });
  }
});

// Re-point tenant FKs after a brand merge. When a brand is merged
// into another (crm_companies.merged_into_id set), every tenancy /
// leasing / available row that still points at the merged-away
// brand needs to follow the chain to the surviving (non-merged)
// brand. Walks the full chain in case of multi-step merges
// (A → B → C → D, where D is the ultimate survivor).
//
// SURVIVORS_CTE builds a (old_id → new_id) map where new_id is the
// deepest reachable brand starting from each merged row. We track
// depth and use DISTINCT ON (root) ORDER BY depth DESC to keep only
// the deepest hop, which is the survivor.
const SURVIVORS_CTE = `
  WITH RECURSIVE walk AS (
    -- Base: every directly-merged brand. step is what it points at.
    SELECT id AS root, merged_into_id AS step, 1 AS depth
      FROM crm_companies WHERE merged_into_id IS NOT NULL
    UNION ALL
    -- Recursive: if step is itself a merged brand, walk one more hop.
    SELECT w.root, c.merged_into_id, w.depth + 1
      FROM walk w
      JOIN crm_companies c ON c.id = w.step
     WHERE c.merged_into_id IS NOT NULL
       AND w.depth < 20  -- guardrail against cycles
  ),
  survivors AS (
    SELECT DISTINCT ON (root) root AS old_id, step AS new_id
      FROM walk
     ORDER BY root, depth DESC
  )`;
router.post("/api/properties/:propertyId/repoint-merged-brands", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.params;
    const moved = {
      tenancy: (await pool.query(
        `${SURVIVORS_CTE}
         UPDATE tenancy_schedule_units t
            SET tenant_company_id = s.new_id
           FROM survivors s
          WHERE t.property_id = $1 AND t.tenant_company_id = s.old_id`,
        [propertyId]
      )).rowCount || 0,
      leasing: (await pool.query(
        `${SURVIVORS_CTE}
         UPDATE leasing_schedule_units u
            SET tenant_company_id = s.new_id
           FROM survivors s
          WHERE u.property_id = $1 AND u.tenant_company_id = s.old_id`,
        [propertyId]
      )).rowCount || 0,
      available: (await pool.query(
        `${SURVIVORS_CTE}
         UPDATE available_units au
            SET tenant_company_id = s.new_id
           FROM survivors s
          WHERE au.property_id = $1 AND au.tenant_company_id = s.old_id`,
        [propertyId]
      )).rowCount || 0,
      deals: (await pool.query(
        `${SURVIVORS_CTE}
         UPDATE crm_deals d
            SET tenant_id = s.new_id
           FROM survivors s
          WHERE (d.property_id = $1 OR EXISTS (SELECT 1 FROM property_units pu WHERE pu.id = d.unit_id AND pu.property_id = $1))
            AND d.tenant_id = s.old_id`,
        [propertyId]
      )).rowCount || 0,
    };
    res.json({ ok: true, moved });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Duplicate unit_numbers on the tenancy schedule for this property.
// Returns clusters of rows that share a normalised unit_number, so
// the team can spot typos / "Unit 8 vs Unit 8a" cases and merge or
// rename them.
router.get("/api/properties/:propertyId/duplicate-units", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.params;
    const { rows } = await pool.query(
      `WITH dups AS (
         SELECT lower(trim(unit_number)) AS key
           FROM tenancy_schedule_units
          WHERE property_id = $1 AND coalesce(trim(unit_number), '') <> ''
          GROUP BY 1 HAVING COUNT(*) > 1
       )
       SELECT t.id, t.unit_number, t.premises, t.tenant_name, t.trading_name,
              t.tenant_company_id, t.status, t.nia_sqft, t.gia_sqft,
              t.passing_rent_pa, t.lease_expiry,
              lower(trim(t.unit_number)) AS key
         FROM tenancy_schedule_units t
         JOIN dups d ON d.key = lower(trim(t.unit_number))
        WHERE t.property_id = $1
        ORDER BY lower(trim(t.unit_number)), t.id`,
      [propertyId]
    );
    // Bucket into clusters keyed by normalised name
    const clusters: Record<string, any[]> = {};
    for (const r of rows) {
      const key = r.key;
      if (!clusters[key]) clusters[key] = [];
      clusters[key].push(r);
    }
    res.json({ clusters });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Merge a duplicate tenancy row INTO a primary row. Moves all
// downstream FKs (leasing/available/deals) from `secondaryId` →
// `primaryId`, then deletes the secondary. Both must be on the same
// property as a safety guard. Use case: "Unit 8" and "Unit 8 (Pret)"
// resolve to the same physical shop → pick one as canonical, merge
// the other in.
router.post("/api/properties/:propertyId/merge-tenancy-units", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.params;
    const { primaryId, secondaryId } = req.body as { primaryId: string; secondaryId: string };
    if (!primaryId || !secondaryId) return res.status(400).json({ error: "primaryId and secondaryId required" });
    if (primaryId === secondaryId) return res.status(400).json({ error: "primary and secondary must differ" });

    const check = await pool.query(
      `SELECT id, property_id FROM tenancy_schedule_units WHERE id IN ($1, $2)`,
      [primaryId, secondaryId]
    );
    if (check.rows.length !== 2) return res.status(404).json({ error: "one or both rows not found" });
    for (const row of check.rows) {
      if (row.property_id !== propertyId) return res.status(400).json({ error: "rows must be on the same property" });
    }

    // Move FKs. Best-effort per table.
    const moved = {
      leasing: (await pool.query(`UPDATE leasing_schedule_units SET tenancy_unit_id = $1 WHERE tenancy_unit_id = $2`, [primaryId, secondaryId])).rowCount || 0,
      available: (await pool.query(`UPDATE available_units SET tenancy_unit_id = $1 WHERE tenancy_unit_id = $2`, [primaryId, secondaryId])).rowCount || 0,
      deals: (await pool.query(`UPDATE crm_deals SET tenancy_unit_id = $1 WHERE tenancy_unit_id = $2`, [primaryId, secondaryId])).rowCount || 0,
    };

    await pool.query(`DELETE FROM tenancy_schedule_units WHERE id = $1`, [secondaryId]);
    res.json({ ok: true, moved });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
