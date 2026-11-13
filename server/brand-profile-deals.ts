// Deal-total helpers for the brand/company profile endpoint.
//
// The profile's deal list is capped at LIMIT 20 for display, so portfolio-wide
// totals (count / completed / fees / team) must come from a separate aggregate
// query over the FULL scoped set. Status classification uses the canonical
// vocabulary in shared/deal-status.ts — never a hand-rolled string list.
import {
  CLOSED_STATUSES,
  TERMINAL_STATUSES,
  legacyToCode,
  type DealStatusCode,
} from "../shared/deal-status";

// "Completed" = closed but not withdrawn → COM and INV per shared/deal-status.ts.
export const COMPLETED_DEAL_STATUSES: DealStatusCode[] = CLOSED_STATUSES.filter(
  (s) => !(TERMINAL_STATUSES as readonly string[]).includes(s),
);

// JS-side classification — legacy free-text and lowercase variants resolve
// through legacyToCode, so "completed", "let", "com" etc. all count.
export function isCompletedDealStatus(raw: string | null | undefined): boolean {
  const code = legacyToCode(raw);
  return code !== null && COMPLETED_DEAL_STATUSES.includes(code);
}

// Active = anything that isn't fully closed (WIT/COM/INV). Unknown, legacy or
// empty statuses stay active — same convention the profile used before.
export function isActiveDealStatus(raw: string | null | undefined): boolean {
  const code = legacyToCode(raw);
  return code === null || !(CLOSED_STATUSES as readonly string[]).includes(code);
}

function sqlStringList(values: readonly string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
}

// SQL fragments — status compared case-insensitively against canonical codes
// (post-migration rows are canonical; UPPER covers lowercase stragglers).
export function completedStatusSql(column: string): string {
  return `UPPER(BTRIM(COALESCE(${column}, ''))) IN (${sqlStringList(COMPLETED_DEAL_STATUSES)})`;
}

export function closedStatusSql(column: string): string {
  return `UPPER(BTRIM(COALESCE(${column}, ''))) IN (${sqlStringList(CLOSED_STATUSES)})`;
}

// Full-set aggregate over the SAME scoped deal set as the capped list query —
// identical WHERE, including the client-counterparty scope clause, no LIMIT.
// `clientScope` must be the exact fragment the list query appends ("" for
// staff, the bpScope AND-clause for clients). `propertyScope` is the same
// scheme limit the deal list takes (BRAND_DEAL_PROPERTY_SCOPE, on $3), so a
// scheme-limited Landsec login's counts cover its own schemes only.
export function dealTotalsSql(clientScope: string, propertyScope = ""): string {
  return `WITH scoped AS (
     SELECT d.status, d.fee, d.team, d.internal_agent, d.completed_at
       FROM crm_deals d
      WHERE (d.tenant_id = $1 OR d.landlord_id = $1 OR d.vendor_id = $1 OR d.purchaser_id = $1)${clientScope}${propertyScope}
   )
   SELECT COUNT(*)::int AS total,
          (COUNT(*) FILTER (WHERE ${completedStatusSql("status")} OR completed_at IS NOT NULL))::int AS completed,
          (COUNT(*) FILTER (WHERE NOT ${closedStatusSql("status")}))::int AS active,
          COALESCE(SUM(fee), 0)::float AS total_fees,
          COALESCE(ARRAY(
            SELECT DISTINCT m
              FROM scoped s,
                   LATERAL (SELECT unnest(s.team) AS m
                             UNION
                            SELECT unnest(s.internal_agent)) u
             WHERE btrim(u.m) <> ''
             ORDER BY 1
          ), '{}'::text[]) AS team
     FROM scoped`;
}

// ── The brand deals card ─────────────────────────────────────────────────
// The 20 most recent deals the company is a party to, with its role, the
// property and unit, the stage and the last update. The full-set counts come
// from the same statement (window counts over the same WHERE), so "20 of N"
// and "N live" are always true to the scope the rows were read under.
//
// `clientScope` must be the exact fragment the profile's other deal queries
// append ("" for staff, the counterparty AND-clause on $2 for a client), so a
// client login is never shown a deal the profile does not already give it.
// `propertyScope` narrows further for a scheme-limited Landsec login (asset
// manager): only deals at the properties passed as $3.
export const BRAND_DEAL_LIST_LIMIT = 20;
export const BRAND_DEAL_PROPERTY_SCOPE = ` AND d.property_id = ANY($3::varchar[])`;

export function brandDealListSql(clientScope: string, propertyScope = ""): string {
  return `SELECT d.id, d.deal_ref, d.name, d.deal_type, d.status, d.updated_at, d.property_id,
          CASE
            WHEN d.tenant_id    = $1 THEN 'tenant'
            WHEN d.landlord_id  = $1 THEN 'landlord'
            WHEN d.vendor_id    = $1 THEN 'vendor'
            WHEN d.purchaser_id = $1 THEN 'purchaser'
          END AS role,
          p.name AS property_name,
          COALESCE(pu.unit_name, tsu.unit_number, tsu.premises) AS unit_name,
          (COUNT(*) OVER ())::int AS total,
          (COUNT(*) FILTER (WHERE NOT ${closedStatusSql("d.status")}) OVER ())::int AS live,
          (COUNT(*) FILTER (WHERE ${completedStatusSql("d.status")} OR d.completed_at IS NOT NULL) OVER ())::int AS completed
     FROM crm_deals d
     LEFT JOIN crm_properties p ON p.id = d.property_id
     LEFT JOIN property_units pu ON pu.id = d.unit_id
     LEFT JOIN tenancy_schedule_units tsu ON tsu.id = d.tenancy_unit_id
    WHERE (d.tenant_id = $1 OR d.landlord_id = $1 OR d.vendor_id = $1 OR d.purchaser_id = $1)${clientScope}${propertyScope}
    ORDER BY d.updated_at DESC NULLS LAST, d.id
    LIMIT ${BRAND_DEAL_LIST_LIMIT}`;
}

// ── Live tenancies on the profile ("Live tenancies", "Tenant at") ─────────
// Every property where the brand is the resolved tenant on a tenancy
// schedule row, with the unit count, passing rent and next expiry. The
// statement has no client parameter: for a scheme-limited Landsec login the
// viewer's own properties are $2 and nothing else is returned; every other
// viewer runs it with $1 alone.
export const BRAND_LIVE_LOCATIONS_PROPERTY_SCOPE = `
          AND p.id = ANY($2::varchar[])`;

export function brandLiveLocationsSql(schemeLimited: boolean): string {
  return `SELECT p.id, p.name, p.address, p.postcode,
              NULLIF(p.latitude, '')::float8 AS lat,
              NULLIF(p.longitude, '')::float8 AS lng,
              COUNT(t.id) AS units,
              SUM(COALESCE(t.passing_rent_pa, 0)) AS total_rent_pa,
              MIN(t.lease_expiry) AS next_expiry
         FROM tenancy_schedule_units t
         JOIN crm_properties p ON p.id = t.property_id
        WHERE t.tenant_company_id = $1
          AND (t.status IS NULL OR t.status NOT IN ('Vacant', 'Void'))${schemeLimited ? BRAND_LIVE_LOCATIONS_PROPERTY_SCOPE : ""}
        GROUP BY p.id
        ORDER BY units DESC, p.name`;
}

// What a scheme-limited Landsec login is sent of the viewer-limited lists on
// the profile. The scheme properties are always a subset of the client's own
// portfolio, so this fragment (on $3, after the client's own-estate clause on
// $2) only ever narrows.
export const BRAND_SCHEME_PROPERTY_SCOPE = ` AND p.id = ANY($3::varchar[])`;

export interface BrandDealListRow {
  id: string;
  deal_ref: number | null;
  name: string;
  deal_type: string | null;
  status: string | null;
  role: "tenant" | "landlord" | "vendor" | "purchaser" | null;
  property_id: string | null;
  property_name: string | null;
  unit_name: string | null;
  updated_at: string | null;
}

export interface BrandDealList {
  rows: BrandDealListRow[];
  total: number;
  live: number;
  completed: number;
}

// What leaves the server: these named fields and nothing else. The card has
// no use for the fee, the fee split or the BGP team, so they are never sent
// to anyone from here, whatever a later edit adds to the SELECT.
export function brandDealList(rows: any[]): BrandDealList {
  const first = rows[0] || {};
  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      deal_ref: r.deal_ref == null ? null : Number(r.deal_ref),
      name: r.name || "",
      deal_type: r.deal_type || null,
      status: r.status || null,
      role: r.role || null,
      property_id: r.property_id || null,
      property_name: r.property_name || null,
      unit_name: r.unit_name || null,
      updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at || null,
    })),
    total: Number(first.total) || 0,
    live: Number(first.live) || 0,
    completed: Number(first.completed) || 0,
  };
}
