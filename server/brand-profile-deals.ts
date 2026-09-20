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
// staff, the bpScope AND-clause for clients).
export function dealTotalsSql(clientScope: string): string {
  return `WITH scoped AS (
     SELECT d.status, d.fee, d.team, d.internal_agent, d.completed_at
       FROM crm_deals d
      WHERE (d.tenant_id = $1 OR d.landlord_id = $1 OR d.vendor_id = $1 OR d.purchaser_id = $1)${clientScope}
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
