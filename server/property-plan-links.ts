import { isValidPolygon } from "../shared/plan-geometry";

type PlanDatabase = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };
export class PropertyPlanInputError extends Error {
  status = 400;
}

export function validatePropertyPlanPolygon(value: unknown): { points: Array<[number, number]> } {
  const points = (value as any)?.points;
  if (!Array.isArray(points) || points.some(p => !Array.isArray(p) || p.length !== 2)
    || !isValidPolygon(points.map(p => ({ x: p[0], y: p[1] })))) {
    throw new PropertyPlanInputError("Draw a closed, non-crossing unit boundary inside the plan (3–256 points).");
  }
  return { points: points.map(p => [p[0], p[1]]) };
}

function linkId(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 100) throw new PropertyPlanInputError("Invalid unit link.");
  return value;
}

// This validates identity, never infers a tenant by a mutable unit/brand name.
// Use inside the caller's transaction so the linked rows remain stable until save.
export async function validatePlanUnitLink(db: PlanDatabase, propertyId: string, link: { unit_id?: unknown; tenancy_unit_id?: unknown }): Promise<{ unit_id: string | null; tenancy_unit_id: string | null }> {
  let unitId = linkId(link.unit_id);
  const tenancyId = linkId(link.tenancy_unit_id);
  if (tenancyId) {
    const { rows } = await db.query("SELECT id, property_unit_id FROM tenancy_schedule_units WHERE id = $1 AND property_id = $2 FOR SHARE", [tenancyId, propertyId]);
    if (!rows[0]) throw new PropertyPlanInputError("Choose a tenancy row belonging to this property.");
    if (unitId && unitId !== rows[0].property_unit_id) throw new PropertyPlanInputError("The tenancy and physical unit links do not describe the same unit.");
    unitId = rows[0].property_unit_id || null;
  }
  if (unitId) {
    const { rows } = await db.query("SELECT id FROM property_units WHERE id = $1 AND property_id = $2 FOR SHARE", [unitId, propertyId]);
    if (!rows[0]) throw new PropertyPlanInputError("Choose a physical unit belonging to this property.");
  }
  return { unit_id: unitId, tenancy_unit_id: tenancyId };
}

// A schedule row need not have a physical master yet to be linked to a plan.
// GET is deliberately read-only: opening the picker must not create units.
export async function queryPickableUnits(db: PlanDatabase, propertyId: string): Promise<any[]> {
  const { rows } = await db.query(`
    SELECT t.id, t.id AS tenancy_unit_id, pu.id AS unit_id,
           COALESCE(NULLIF(btrim(t.unit_number), ''), NULLIF(btrim(t.premises), ''), pu.unit_name, 'Unnamed unit') AS unit_name,
           COALESCE(t.floor_level, pu.floor) AS floor,
           COALESCE(t.nia_sqft, t.gia_sqft, pu.sqft) AS sqft,
           COALESCE(NULLIF(btrim(t.trading_name), ''), t.tenant_name) AS tenant_name,
           t.status AS lease_status, t.permitted_use
      FROM tenancy_schedule_units t
      LEFT JOIN property_units pu ON pu.id = t.property_unit_id AND pu.property_id = t.property_id
     WHERE t.property_id = $1
    UNION ALL
    SELECT pu.id, NULL AS tenancy_unit_id, pu.id AS unit_id, pu.unit_name, pu.floor, pu.sqft,
           NULL AS tenant_name, NULL AS lease_status, pu.use_class AS permitted_use
      FROM property_units pu
     WHERE pu.property_id = $1
       AND NOT EXISTS (SELECT 1 FROM tenancy_schedule_units t WHERE t.property_id = pu.property_id AND t.property_unit_id = pu.id)
    ORDER BY unit_name, floor, id`, [propertyId]);
  return rows;
}

// Lateral single-row joins prevent multiple marketing/schedule projections
// multiplying a drawn outline. A saved canonical link always wins, including
// its deliberately blank lease values; old leasing values cannot refill them.
export async function queryPropertyPlanUnits(db: PlanDatabase, planId: string): Promise<any[]> {
  const { rows } = await db.query(`
    SELECT ppu.id, ppu.plan_id, CASE WHEN ts.id IS NOT NULL THEN ts.property_unit_id ELSE ppu.unit_id END AS unit_id,
           ppu.tenancy_unit_id AS stored_tenancy_unit_id, ts.id AS tenancy_unit_id,
           ppu.label, ppu.polygon, ppu.status_override,
           CASE WHEN ts.id IS NOT NULL THEN 'linked'
                WHEN tc.candidates > 1 OR lc.candidates > 1 THEN 'ambiguous'
                WHEN lsu.id IS NOT NULL THEN 'legacy'
                ELSE 'unlinked' END AS link_state,
           CASE WHEN ts.id IS NOT NULL THEN COALESCE(NULLIF(btrim(ts.unit_number), ''), NULLIF(btrim(ts.premises), ''), pu.unit_name) ELSE pu.unit_name END AS unit_name,
           CASE WHEN ts.id IS NOT NULL THEN COALESCE(ts.nia_sqft, ts.gia_sqft, pu.sqft) ELSE pu.sqft END AS unit_sqft,
           pu.use_class, COALESCE(ts.floor_level, pu.floor) AS unit_floor,
           CASE WHEN ts.id IS NOT NULL THEN COALESCE(NULLIF(btrim(ts.trading_name), ''), ts.tenant_name) ELSE lsu.tenant_name END AS tenant_name,
           CASE WHEN ts.id IS NOT NULL THEN ts.passing_rent_pa ELSE lsu.rent_pa END AS rent_pa,
           to_char(CASE WHEN ts.id IS NOT NULL THEN ts.lease_expiry ELSE lsu.lease_expiry END, 'YYYY-MM-DD') AS lease_expiry,
           to_char(CASE WHEN ts.id IS NOT NULL THEN ts.break_date ELSE lsu.lease_break END, 'YYYY-MM-DD') AS lease_break,
           to_char(CASE WHEN ts.id IS NOT NULL THEN ts.next_review_date ELSE lsu.rent_review END, 'YYYY-MM-DD') AS rent_review,
           CASE WHEN ts.id IS NOT NULL THEN ts.status ELSE lsu.status END AS lease_status,
           ts.occupancy_status, lsu.id AS leasing_schedule_unit_id,
           au.id AS available_unit_id, au.marketing_status, au.asking_rent,
           (SELECT json_agg(json_build_object('id', d.id, 'name', d.name, 'status', d.status,
                     'tenant_id', d.tenant_id, 'deal_type', d.deal_type))
              FROM crm_deals d
             WHERE d.property_id = p.property_id AND (d.unit_id = pu.id OR (ts.id IS NOT NULL AND d.tenancy_unit_id = ts.id))
               AND COALESCE(d.status, '') NOT IN ('WIT', 'COM', 'INV')) AS active_deals
      FROM property_plan_units ppu
      JOIN property_plans p ON p.id = ppu.plan_id
      LEFT JOIN LATERAL (
        SELECT count(*) AS candidates, min(t.id) AS only_id
          FROM tenancy_schedule_units t
         WHERE t.property_id = p.property_id
           AND ((ppu.tenancy_unit_id IS NOT NULL AND t.id = ppu.tenancy_unit_id)
             OR (ppu.tenancy_unit_id IS NULL AND ppu.unit_id IS NOT NULL AND t.property_unit_id = ppu.unit_id))
      ) tc ON true
      LEFT JOIN tenancy_schedule_units ts ON tc.candidates = 1 AND ts.id = tc.only_id
      LEFT JOIN property_units pu ON pu.id = CASE WHEN ts.id IS NOT NULL THEN ts.property_unit_id ELSE ppu.unit_id END AND pu.property_id = p.property_id
      LEFT JOIN LATERAL (
        SELECT count(*) AS candidates, min(l.id) AS only_id
          FROM leasing_schedule_units l
         WHERE ppu.tenancy_unit_id IS NULL AND tc.candidates = 0
           AND l.property_id = p.property_id AND l.tenancy_unit_id IS NULL AND NULLIF(btrim(pu.unit_name), '') IS NOT NULL
           AND lower(btrim(l.unit_name)) = lower(btrim(pu.unit_name))
           AND NOT EXISTS (SELECT 1 FROM tenancy_schedule_units t WHERE t.property_id = p.property_id
             AND (t.property_unit_id = pu.id OR lower(btrim(COALESCE(NULLIF(btrim(t.unit_number), ''), t.premises))) = lower(btrim(pu.unit_name))))
      ) lc ON true
      LEFT JOIN leasing_schedule_units lsu ON lc.candidates = 1 AND lsu.id = lc.only_id
      LEFT JOIN LATERAL (
        SELECT a.id, a.marketing_status, a.asking_rent
          FROM available_units a
         WHERE a.property_id = p.property_id
           AND ((ts.id IS NOT NULL AND a.tenancy_unit_id = ts.id)
             OR (a.tenancy_unit_id IS NULL AND a.unit_id = pu.id AND tc.candidates <= 1))
         ORDER BY (a.tenancy_unit_id IS NOT NULL) DESC, a.updated_at DESC NULLS LAST, a.id
         LIMIT 1
      ) au ON true
     WHERE ppu.plan_id = $1
     ORDER BY ppu.created_at, ppu.id`, [planId]);
  return rows;
}

export function propertyPlanUnitStatus(row: any, now = Date.now()): string {
  if (row.status_override) return row.status_override;
  if (Array.isArray(row.active_deals) && row.active_deals.length) return "deal_in_progress";
  const marketing = String(row.marketing_status || "").trim().toLowerCase();
  const lease = String(row.lease_status || "").trim().toLowerCase();
  if (["hot", "sol", "under offer", "under_offer"].includes(marketing) || lease === "under offer") return "under_offer";
  const vacant = ["ava", "available", "vacant", "void", "marketing"];
  const occupied = ["occupied", "trading", "let", "holding over", "taw", "not vacant", "lease event", "lease event pending"];
  // The schedule editor currently writes status; occupancy_status was an
  // additive historical backfill and is not maintained by that editor.
  const occupancy = [...vacant, ...occupied].includes(lease) ? lease : String(row.occupancy_status || "").trim().toLowerCase();
  if (vacant.includes(occupancy) || !occupied.includes(occupancy) && vacant.includes(marketing)) return "vacant";
  const upcoming = [row.lease_expiry, row.lease_break].filter(Boolean).map(value => new Date(value).getTime()).filter(time => Number.isFinite(time) && time > now);
  if (upcoming.some(time => time - now < 18 * 30 * 24 * 60 * 60 * 1000)) return "lease_event";
  if (occupied.includes(occupancy) || row.tenant_name && !/^(vacant|void|available|[-—])$/i.test(String(row.tenant_name).trim())) return "occupied";
  if (!row.unit_id && !row.tenancy_unit_id) return "unlinked";
  return "unknown";
}
