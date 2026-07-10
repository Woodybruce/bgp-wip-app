/**
 * Auto-link review-form numbers from the WIP report.
 *
 * Mapping (Woody's spec, 14 May 2026):
 *   fees_target_pence            = current_salary_pence * 3
 *   fees_achieved_pence          = sum of fee allocations on INV-status deals
 *   pipeline_under_offer_pence   = sum on SOL-status deals  (a.k.a. Solicitors / Under Offer)
 *   pipeline_negotiating_pence   = sum on NEG-status deals  (a.k.a. Negotiating)
 *
 * Per-agent allocation calc:
 *   - allocation_type='fixed'      → fixed_amount (£)
 *   - allocation_type='percentage' → deal.fee * percentage / 100 (£)
 *
 * Result is multiplied by 100 to convert £ → pence before writing.
 *
 * Agent → user match is lower-case trim, with the "(BGP House)" suffix
 * stripped (Sage import tags BGP's own-account slices with this suffix).
 * Misses are logged so spelling variations can be turned into an alias
 * table later. For v1 the BGP team is small enough that the full-name
 * match catches everyone.
 */

import { pool } from "./db";

export interface SyncReviewResult {
  reviewId: string;
  userId: string;
  userName: string | null;
  changes: {
    fees_target_pence: number | null;
    fees_achieved_pence: number;
    pipeline_under_offer_pence: number;
    pipeline_negotiating_pence: number;
  };
  matchedAllocations: number;
}

interface AllocationTotals {
  inv: number; // £
  sol: number; // £
  neg: number; // £
  matchCount: number;
}

async function getAgentAllocationTotals(userName: string): Promise<AllocationTotals> {
  // Try multiple spellings: exact match, with BGP House suffix stripped,
  // and trimmed punctuation. Sage agent names come in flavours like
  // "Charlotte Roberts", "Charlotte Roberts (BGP House)", "C. Roberts".
  const variants = new Set<string>();
  const name = userName.trim();
  variants.add(name);
  // First name + last initial: "Charlotte R"
  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    variants.add(parts[parts.length - 1]); // last name only
    variants.add(`${parts[0]} ${parts[parts.length - 1][0]}`); // first + last initial
    variants.add(`${parts[0][0]}. ${parts[parts.length - 1]}`); // first initial + last
    variants.add(`${parts[0][0]} ${parts[parts.length - 1]}`); // no dot variant
  }

  // Match on:
  //   1. exact lower(trim) match against any variant
  //   2. variant matches when "(BGP House)" suffix is stripped
  // We do this in SQL so we don't have to pull every allocation row.
  const variantList = Array.from(variants);
  const r = await pool.query<{ status: string; total_gbp: string }>(
    `WITH normalised AS (
       SELECT
         d.status,
         LOWER(TRIM(REGEXP_REPLACE(a.agent_name, '\\s*\\(\\s*BGP\\s*House\\s*\\)\\s*$', '', 'i'))) AS agent_norm,
         CASE
           WHEN a.allocation_type = 'fixed' THEN COALESCE(a.fixed_amount, 0)
           WHEN a.allocation_type = 'percentage' AND a.percentage IS NOT NULL AND d.fee IS NOT NULL
             THEN d.fee * a.percentage / 100.0
           ELSE 0
         END AS gbp
       FROM deal_fee_allocations a
       JOIN crm_deals d ON d.id = a.deal_id
       WHERE d.status IN ('INV', 'SOL', 'NEG')
     )
     SELECT status, COALESCE(SUM(gbp), 0)::text AS total_gbp
       FROM normalised
      WHERE agent_norm = ANY($1::text[])
      GROUP BY status`,
    [variantList.map((v) => v.toLowerCase().trim())],
  );

  // Also count matched rows for diagnostics.
  const countRes = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM deal_fee_allocations a
       JOIN crm_deals d ON d.id = a.deal_id
      WHERE d.status IN ('INV', 'SOL', 'NEG')
        AND LOWER(TRIM(REGEXP_REPLACE(a.agent_name, '\\s*\\(\\s*BGP\\s*House\\s*\\)\\s*$', '', 'i'))) = ANY($1::text[])`,
    [variantList.map((v) => v.toLowerCase().trim())],
  );

  const out: AllocationTotals = { inv: 0, sol: 0, neg: 0, matchCount: Number(countRes.rows[0]?.n || 0) };
  for (const row of r.rows) {
    const gbp = Number(row.total_gbp) || 0;
    if (row.status === "INV") out.inv = gbp;
    else if (row.status === "SOL") out.sol = gbp;
    else if (row.status === "NEG") out.neg = gbp;
  }
  return out;
}

/**
 * Sync one review row. Returns the new field values + match count.
 * Persists to the staff_reviews row.
 */
export async function syncReviewFromWip(reviewId: string): Promise<SyncReviewResult | null> {
  const r = await pool.query<{ id: string; user_id: string; current_salary_pence: string | null; name: string | null }>(
    `SELECT sr.id, sr.user_id, sr.current_salary_pence, u.name
       FROM staff_reviews sr
       LEFT JOIN users u ON u.id = sr.user_id
      WHERE sr.id = $1`,
    [reviewId],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (!row.name) {
    console.warn(`[review-wip-sync] review ${reviewId} has no user name — skipped`);
    return null;
  }

  const totals = await getAgentAllocationTotals(row.name);
  const salaryPence = row.current_salary_pence ? Number(row.current_salary_pence) : null;
  const targetPence = salaryPence ? salaryPence * 3 : null;
  const achievedPence = Math.round(totals.inv * 100);
  const underOfferPence = Math.round(totals.sol * 100);
  const negotiatingPence = Math.round(totals.neg * 100);

  await pool.query(
    `UPDATE staff_reviews
        SET fees_target_pence          = COALESCE($1::bigint, fees_target_pence),
            fees_achieved_pence        = $2::bigint,
            pipeline_under_offer_pence = $3::bigint,
            pipeline_negotiating_pence = $4::bigint,
            updated_at = now()
      WHERE id = $5`,
    [targetPence, achievedPence, underOfferPence, negotiatingPence, reviewId],
  );

  console.log(
    `[review-wip-sync] ${row.name} (review ${reviewId}): target=£${(targetPence || 0) / 100} achieved=£${totals.inv} sol=£${totals.sol} neg=£${totals.neg} (${totals.matchCount} allocations matched)`,
  );

  return {
    reviewId: row.id,
    userId: row.user_id,
    userName: row.name,
    changes: {
      fees_target_pence: targetPence,
      fees_achieved_pence: achievedPence,
      pipeline_under_offer_pence: underOfferPence,
      pipeline_negotiating_pence: negotiatingPence,
    },
    matchedAllocations: totals.matchCount,
  };
}

/**
 * Bulk sync — every review whose period matches a substring.
 * For "all 2027 tax year review forms" pass periodMatch='2027'.
 */
export async function syncReviewsFromWipByPeriod(periodMatch: string): Promise<{
  scanned: number;
  updated: number;
  details: SyncReviewResult[];
}> {
  const reviewRows = await pool.query<{ id: string }>(
    `SELECT id FROM staff_reviews WHERE period ILIKE $1`,
    [`%${periodMatch}%`],
  );
  const details: SyncReviewResult[] = [];
  for (const r of reviewRows.rows) {
    try {
      const result = await syncReviewFromWip(r.id);
      if (result) details.push(result);
    } catch (err: any) {
      console.error(`[review-wip-sync] failed for review ${r.id}:`, err?.message);
    }
  }
  return { scanned: reviewRows.rows.length, updated: details.length, details };
}
