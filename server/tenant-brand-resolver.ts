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
  return `(
    WITH input AS (
      SELECT trim(regexp_replace(
        regexp_replace(lower(trim(coalesce(${tenantParam}, ''))),
          '\\s+(ltd|limited|plc|llp|inc|incorporated|corp|corporation|holdings|group|uk|gb|company|co)\\.?$',
          '', 'g'),
        '[^a-z0-9]+', ' ', 'g')) AS norm_tenant
    ),
    brand_keys AS (
      SELECT id AS brand_id, lower(trim(name)) AS raw FROM crm_companies WHERE merged_into_id IS NULL
      UNION ALL
      SELECT c.id, lower(trim(entity->>'name'))
        FROM crm_companies c,
             jsonb_array_elements(coalesce(c.trading_entities, '[]'::jsonb)) AS entity
       WHERE c.merged_into_id IS NULL
         AND entity->>'name' IS NOT NULL
         AND length(trim(entity->>'name')) > 0
    ),
    brand_keys_norm AS (
      SELECT brand_id,
             trim(regexp_replace(
               regexp_replace(raw,
                 '\\s+(ltd|limited|plc|llp|inc|incorporated|corp|corporation|holdings|group|uk|gb|company|co)\\.?$',
                 '', 'g'),
               '[^a-z0-9]+', ' ', 'g')) AS norm_key
        FROM brand_keys
    )
    SELECT bkn.brand_id
      FROM brand_keys_norm bkn, input i
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

  // Same on available_units — fills tenant_company_id when the row
  // carries any tenant_name hint (some import paths set it). Most
  // available_units rows are vacant so this rarely applies but the
  // column needs to be live for the rare cases that do.
  await pool.query(
    `UPDATE available_units au
        SET tenant_company_id = ${resolveBrandIdSubquery("coalesce(au.tenant_name, '')")}
      WHERE au.property_id = $1
        AND au.tenant_company_id IS NULL
        AND ${resolveBrandIdSubquery("coalesce(au.tenant_name, '')")} IS NOT NULL`,
    [propertyId]
  );

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
