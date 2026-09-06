// ─────────────────────────────────────────────────────────────────────────
// Tenant → Brand resolver.
//
// Tenancy / leasing schedules and lease imports carry the lease's legal
// counterparty in `tenant_name` / `trading_name` (free text from Excel).
// The canonical brand row lives in crm_companies, with optional aliases
// in crm_companies.trading_entities[] (legal entities that all roll up
// into the same brand — "Pret a Manger UK Ltd" / "Pret a Manger Europe
// Limited" all map to the Pret brand).
//
// Resolution is normalised: lowercase, strip Ltd/Plc/Group/UK/Holdings
// suffixes, collapse punctuation. We match the schedule's tenant name
// against EITHER the brand's own name OR any of its trading-entity
// aliases. First match wins.
//
// Pattern: resolve once at write-time, store the FK, and the read path
// just JOINs on the FK. The query-time normaliser stays as a safety net
// for unresolved rows so the page still works while we backfill.
// ─────────────────────────────────────────────────────────────────────────
import { pool } from "./db";

// SQL fragment that, given a free-text tenant string, returns the
// matched brand's crm_companies.id (or NULL). Inlined into UPDATE
// statements during backfill + at import time. Uses the same regex
// normalisation as the read path so the two sides always agree.
//
// Usage: `... = (${RESOLVE_BRAND_ID_SQL})` with the tenant string as
// the only parameter via the surrounding query's $N.
export function resolveBrandIdSubquery(tenantParam: string): string {
  // CTE names are deliberately namespaced (__rbi_*) so this subquery
  // can be inlined into outer queries that might also use common CTE
  // names like `input` or `brand_keys` without colliding.
  return `(
    WITH __rbi_input AS (
      SELECT trim(regexp_replace(
        regexp_replace(lower(trim(coalesce(${tenantParam}, ''))),
          '\\s+(ltd|limited|plc|llp|inc|incorporated|corp|corporation|holdings|group|uk|gb|company|co)\\.?$',
          '', 'g'),
        '[^a-z0-9]+', ' ', 'g')) AS norm_tenant
    ),
    __rbi_brand_keys AS (
      SELECT id AS brand_id, lower(trim(name)) AS raw FROM crm_companies WHERE merged_into_id IS NULL
      UNION ALL
      SELECT c.id, lower(trim(entity->>'name'))
        FROM crm_companies c,
             jsonb_array_elements(
               CASE WHEN jsonb_typeof(c.trading_entities) = 'array'
                    THEN c.trading_entities
                    ELSE '[]'::jsonb
               END
             ) AS entity
       WHERE c.merged_into_id IS NULL
         AND entity->>'name' IS NOT NULL
         AND length(trim(entity->>'name')) > 0
    ),
    __rbi_brand_keys_norm AS (
      SELECT brand_id,
             trim(regexp_replace(
               regexp_replace(raw,
                 '\\s+(ltd|limited|plc|llp|inc|incorporated|corp|corporation|holdings|group|uk|gb|company|co)\\.?$',
                 '', 'g'),
               '[^a-z0-9]+', ' ', 'g')) AS norm_key
        FROM __rbi_brand_keys
    )
    SELECT bkn.brand_id
      FROM __rbi_brand_keys_norm bkn, __rbi_input i
     WHERE bkn.norm_key = i.norm_tenant
       AND bkn.norm_key <> ''
     LIMIT 1
  )`;
}

// Backfill tenant_company_id on every tenancy_schedule_units row for a
// property where it's currently NULL. Returns counts so the UI can
// report what got resolved vs what still needs human attention.
export async function backfillPropertyTenants(propertyId: string): Promise<{
  total: number; resolved: number; unresolved: number;
}> {
  // Try to write the FK on every NULL row. The resolver subquery
  // returns NULL when nothing matches — UPDATE skips those naturally
  // because COALESCE'd back to NULL is a no-op (we filter WHERE
  // tenant_company_id IS NULL AND new_id IS NOT NULL effectively by
  // re-checking via the resolver again).
  await pool.query(
    `UPDATE tenancy_schedule_units t
        SET tenant_company_id = ${resolveBrandIdSubquery("coalesce(t.trading_name, t.tenant_name, '')")}
      WHERE t.property_id = $1
        AND t.tenant_company_id IS NULL
        AND ${resolveBrandIdSubquery("coalesce(t.trading_name, t.tenant_name, '')")} IS NOT NULL`,
    [propertyId]
  );

  // Mirror the same fill on the leasing schedule.
  await pool.query(
    `UPDATE leasing_schedule_units u
        SET tenant_company_id = ${resolveBrandIdSubquery("coalesce(u.tenant_name, '')")}
      WHERE u.property_id = $1
        AND u.tenant_company_id IS NULL
        AND ${resolveBrandIdSubquery("coalesce(u.tenant_name, '')")} IS NOT NULL`,
    [propertyId]
  );

  // available_units has no tenant_name column (vacant by definition),
  // so we can't backfill tenant_company_id from a tenant string here.
  // The FK is still useful for the rare case a row is converted to
  // an occupied unit — set by the deal-link path, not by this
  // backfill.

  // Report back. "Unresolved" = tenancy rows with a tenant name but no
  // FK — these are the ones the team needs to map manually (typically
  // because the brand doesn't yet have a CRM row or a trading-entity
  // alias for the legal entity on the lease).
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE coalesce(trim(tenant_name), '') <> '' OR coalesce(trim(trading_name), '') <> '') AS total,
       COUNT(*) FILTER (WHERE tenant_company_id IS NOT NULL) AS resolved,
       COUNT(*) FILTER (WHERE tenant_company_id IS NULL
                          AND (coalesce(trim(tenant_name), '') <> '' OR coalesce(trim(trading_name), '') <> ''))
                AS unresolved
       FROM tenancy_schedule_units
      WHERE property_id = $1`,
    [propertyId]
  );

  return {
    total: Number(rows[0].total) || 0,
    resolved: Number(rows[0].resolved) || 0,
    unresolved: Number(rows[0].unresolved) || 0,
  };
}

// Single-row resolver, used at import time. Returns the matched brand
// id or null. Cheap enough to call per row during Excel imports.
export async function resolveBrandIdForTenantName(tenantName: string): Promise<string | null> {
  if (!tenantName || !tenantName.trim()) return null;
  const { rows } = await pool.query(
    `SELECT ${resolveBrandIdSubquery("$1")} AS brand_id`,
    [tenantName]
  );
  return rows[0]?.brand_id || null;
}

// SQL twin of evidence-plan's normaliseUnitRef: uppercase, strip the
// words UNIT/STORE/SHOP, collapse punctuation, drop leading zeros in
// letter-digit tokens — so "Unit A01", "UNIT A1" and "A1" all meet.
// Every unit-name join in the app should match through this, not raw
// lower(trim()) equality (Woody, 2026-09-04: "they all need to be
// matched" — the MRI import spells units differently from the tracker).
export function normUnitSql(expr: string): string {
  return `nullif(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(upper(coalesce(${expr}, '')), '\\m(UNIT|STORE|SHOP)\\M', ' ', 'g'), '[^A-Z0-9/&-]+', ' ', 'g'), '([A-Z]+)0+([0-9])', '\\1\\2', 'g'), ' +', ' ', 'g')), '')`;
}

// SQL fragment that resolves a free-text unit reference (unit_name /
// premises) on a given property to a tenancy_schedule_units.id —
// the canonical unit FK. Used to backfill tenancy_unit_id on deals,
// available_units, and leasing_schedule_units. Soft match by
// normalised unit_number; collisions return any matching
// row (no good way to disambiguate without manual help).
//
// Pass the property param name as $propertyParam and the unit-name
// param as $unitParam (caller's $N placeholders).
export function resolveTenancyUnitIdSubquery(propertyParam: string, unitParam: string): string {
  return `(
    SELECT id FROM tenancy_schedule_units
     WHERE property_id = ${propertyParam}
       AND ${normUnitSql("unit_number")} = ${normUnitSql(unitParam)}
     LIMIT 1
  )`;
}

// Property-wide backfill of crm_deals.tenancy_unit_id + the same on
// available_units. Matches by unit_name on the deal/vacant row →
// tenancy_schedule_units.unit_number on the same property. Returns
// the count linked so the UI can show progress.
export async function backfillPropertyUnitFks(propertyId: string): Promise<{
  deals_linked: number; available_linked: number; leasing_linked: number;
}> {
  // Deals: link via property_units.unit_name → tenancy.unit_number.
  // Only deals that already point at a property_units row on THIS
  // property get a tenancy_unit_id — without the property scope on
  // the inner subquery, a deal whose unit_id happens to match a
  // property_units row on a different property could cross-attach.
  const deals = await pool.query(
    `UPDATE crm_deals d
        SET tenancy_unit_id = (
          SELECT ts.id FROM tenancy_schedule_units ts
           WHERE ts.property_id = $1
             AND ${normUnitSql("ts.unit_number")} = ${normUnitSql("(SELECT unit_name FROM property_units pu WHERE pu.id = d.unit_id AND pu.property_id = $1)")}
           LIMIT 1
        )
      WHERE (d.property_id = $1 OR EXISTS (
              SELECT 1 FROM property_units pu WHERE pu.id = d.unit_id AND pu.property_id = $1
            ))
        AND d.unit_id IS NOT NULL
        AND d.tenancy_unit_id IS NULL`,
    [propertyId]
  );

  const available = await pool.query(
    `UPDATE available_units au
        SET tenancy_unit_id = ${resolveTenancyUnitIdSubquery("$1", "au.unit_name")}
      WHERE au.property_id = $1
        AND au.tenancy_unit_id IS NULL
        AND coalesce(trim(au.unit_name), '') <> ''`,
    [propertyId]
  );

  const leasing = await pool.query(
    `UPDATE leasing_schedule_units u
        SET tenancy_unit_id = ${resolveTenancyUnitIdSubquery("$1", "u.unit_name")}
      WHERE u.property_id = $1
        AND u.tenancy_unit_id IS NULL
        AND coalesce(trim(u.unit_name), '') <> ''`,
    [propertyId]
  );

  return {
    deals_linked: deals.rowCount || 0,
    available_linked: available.rowCount || 0,
    leasing_linked: leasing.rowCount || 0,
  };
}
