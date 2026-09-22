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

/**
 * staff_profiles.salary_current is a mixed bag: the salary-change flow writes
 * genuine pence, but the bulk import that populated it wrote POUNDS (Tom
 * Cater 65000 = £65,000, Charlotte 145000 = £145,000). Read as pence, a
 * £65,000 salary produced a £163 monthly review target instead of £16,250
 * (Woody, 2026-09-10: "this target number isnt coreect? it should be 3 times
 * the salary pro rata").
 *
 * No real BGP salary is under £10,000, and £10,000 in pence is 1,000,000 —
 * so anything below that is pounds. Self-correcting either way, so the
 * numbers stay right if the column is normalised later.
 */
export function salaryToPence(raw: number | string | null | undefined): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1_000_000 ? Math.round(n * 100) : Math.round(n);
}

/** 3× salary, pro-rated to the period the review covers. */
export function targetPenceFor(kind: string, salaryPence: number | null): number | null {
  if (!salaryPence) return null;
  const annual = salaryPence * 3;
  if (kind === "monthly") return Math.round(annual / 12);
  if (kind === "midyear") return Math.round(annual / 2);
  return annual;
}

export interface SyncReviewResult {
  reviewId: string;
  userId: string;
  userName: string | null;
  kind: string;
  changes: {
    fees_target_pence: number | null;
    fees_achieved_pence: number;
    pipeline_under_offer_pence?: number;
    pipeline_negotiating_pence?: number;
    // Monthly 1:1 only
    wip_actual_pence?: number;
    exchanged_actual?: number;
  };
  wipSummary?: {
    negotiating_pence: number;
    hots_pence: number;
    solicitors_pence: number;
    exchanged_pence: number;
    invoiced_pence: number;
    exchanged_deals: number;
    wip_total_pence: number;
    salary_pence: number | null;
  };
  matchedAllocations: number;
}

// Monthly one-to-one figures (template: £ fees / WIP figure / exchanged
// deals, target vs actual). "Actual" for the month means:
//   fees      = fee allocations on INV deals invoiced during that month
//   WIP       = the agent's current WIP — allocations on AVA/NEG/HOT/SOL/EXC/COM
//               deals (invoiced deals have left WIP)
//   exchanged = distinct deals the agent is allocated on with exchanged_at
//               inside the month
interface MonthlyTotals {
  invoicedGbp: number;
  wipGbp: number;
  exchangedDeals: number;
  matchCount: number;
  // Live book split by stage — what the 1:1 actually talks through
  // (Woody, 2026-09-10: "we just need the WIP summaries ie in solicitors,
  // neg, invoiced, exchanged"). Fee value the agent is credited with on
  // deals sitting at each stage right now.
  negGbp: number;
  solGbp: number;
  hotGbp: number;
  excGbp: number;
}

function agentNameVariants(userName: string): string[] {
  const variants = new Set<string>();
  const name = userName.trim();
  variants.add(name);
  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    variants.add(parts[parts.length - 1]);
    variants.add(`${parts[0]} ${parts[parts.length - 1][0]}`);
    variants.add(`${parts[0][0]}. ${parts[parts.length - 1]}`);
    variants.add(`${parts[0][0]} ${parts[parts.length - 1]}`);
  }
  return Array.from(variants).map((v) => v.toLowerCase().trim());
}

async function getAgentMonthlyTotals(userName: string, year: number, month: number): Promise<MonthlyTotals> {
  const from = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const to = new Date(Date.UTC(year, month, 1)).toISOString();
  const r = await pool.query<{ invoiced_gbp: string; wip_gbp: string; exchanged_deals: string; match_count: string; neg_gbp: string; sol_gbp: string; hot_gbp: string; exc_gbp: string }>(
    `WITH normalised AS (
       SELECT
         a.deal_id,
         d.status,
         d.exchanged_at,
         COALESCE(d.invoiced_at, d.completed_at, d.updated_at) AS invoiced_on,
         LOWER(TRIM(REGEXP_REPLACE(a.agent_name, '\\s*\\(\\s*BGP\\s*House\\s*\\)\\s*$', '', 'i'))) AS agent_norm,
         CASE
           WHEN a.allocation_type = 'fixed' THEN COALESCE(a.fixed_amount, 0)
           WHEN a.allocation_type = 'percentage' AND a.percentage IS NOT NULL AND d.fee IS NOT NULL
             THEN d.fee * a.percentage / 100.0
           ELSE 0
         END AS gbp
       FROM deal_fee_allocations a
       JOIN crm_deals d ON d.id = a.deal_id
     )
     SELECT
       COALESCE(SUM(gbp) FILTER (WHERE status = 'INV' AND invoiced_on >= $2::timestamptz AND invoiced_on < $3::timestamptz), 0)::text AS invoiced_gbp,
       COALESCE(SUM(gbp) FILTER (WHERE status IN ('AVA','NEG','HOT','SOL','EXC','COM')), 0)::text AS wip_gbp,
       COUNT(DISTINCT deal_id) FILTER (WHERE exchanged_at >= $2::timestamptz AND exchanged_at < $3::timestamptz)::text AS exchanged_deals,
       COUNT(*)::text AS match_count,
       COALESCE(SUM(gbp) FILTER (WHERE status = 'NEG'), 0)::text AS neg_gbp,
       COALESCE(SUM(gbp) FILTER (WHERE status = 'SOL'), 0)::text AS sol_gbp,
       COALESCE(SUM(gbp) FILTER (WHERE status = 'HOT'), 0)::text AS hot_gbp,
       COALESCE(SUM(gbp) FILTER (WHERE status IN ('EXC','COM')), 0)::text AS exc_gbp
     FROM normalised
     WHERE agent_norm = ANY($1::text[])`,
    [agentNameVariants(userName), from, to],
  );
  const row = r.rows[0];
  return {
    invoicedGbp: Number(row?.invoiced_gbp) || 0,
    wipGbp: Number(row?.wip_gbp) || 0,
    exchangedDeals: Number(row?.exchanged_deals) || 0,
    matchCount: Number(row?.match_count) || 0,
    negGbp: Number(row?.neg_gbp) || 0,
    solGbp: Number(row?.sol_gbp) || 0,
    hotGbp: Number(row?.hot_gbp) || 0,
    excGbp: Number(row?.exc_gbp) || 0,
  };
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
  const r = await pool.query<{ id: string; user_id: string; current_salary_pence: string | null; salary_current: string | null; name: string | null; kind: string; period: string }>(
    `SELECT sr.id, sr.user_id, sr.current_salary_pence, sr.kind, sr.period, u.name,
            sp.salary_current
       FROM staff_reviews sr
       LEFT JOIN users u ON u.id = sr.user_id
       LEFT JOIN staff_profiles sp ON sp.user_id = sr.user_id
      WHERE sr.id = $1`,
    [reviewId],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (!row.name) {
    console.warn(`[review-wip-sync] review ${reviewId} has no user name — skipped`);
    return null;
  }

  // Monthly 1:1 — period is monthly_YYYY_MM. Target for the month defaults
  // to (3 × salary) / 12 when nothing has been typed in; actuals come from
  // the WIP data for that month.
  const monthly = row.kind === "monthly" ? row.period.match(/^monthly_(\d{4})_(\d{2})$/) : null;
  if (monthly) {
    const year = Number(monthly[1]);
    const month = Number(monthly[2]);
    const totals = await getAgentMonthlyTotals(row.name, year, month);
    // Target is a FORMULA (3× salary pro rata), not a typed field, so it is
    // recomputed every sync — the old COALESCE pinned the first (wrong)
    // value forever. Read the live HR salary rather than the row's snapshot.
    const salaryPence = salaryToPence(row.salary_current ?? row.current_salary_pence);
    const monthlyTargetPence = targetPenceFor("monthly", salaryPence);
    const achievedPence = Math.round(totals.invoicedGbp * 100);
    const wipPence = Math.round(totals.wipGbp * 100);
    await pool.query(
      `UPDATE staff_reviews
          SET fees_target_pence          = $1::bigint,
              fees_achieved_pence        = $2::bigint,
              wip_actual_pence           = $3::bigint,
              exchanged_actual           = $4::integer,
              pipeline_negotiating_pence = $6::bigint,
              pipeline_under_offer_pence = $7::bigint,
              current_salary_pence       = COALESCE($8::bigint, current_salary_pence),
              updated_at = now()
        WHERE id = $5`,
      [
        monthlyTargetPence, achievedPence, wipPence, totals.exchangedDeals, reviewId,
        Math.round(totals.negGbp * 100), Math.round(totals.solGbp * 100), salaryPence,
      ],
    );
    console.log(
      `[review-wip-sync] ${row.name} 1:1 ${row.period}: invoiced=£${totals.invoicedGbp} wip=£${totals.wipGbp} exchanged=${totals.exchangedDeals} (${totals.matchCount} allocations matched)`,
    );
    return {
      reviewId: row.id,
      userId: row.user_id,
      userName: row.name,
      kind: row.kind,
      changes: {
        fees_target_pence: monthlyTargetPence,
        fees_achieved_pence: achievedPence,
        wip_actual_pence: wipPence,
        exchanged_actual: totals.exchangedDeals,
      },
      // The stage strip the 1:1 reads off — live book by stage, plus what
      // was invoiced in the review month. Computed, never typed.
      wipSummary: {
        negotiating_pence: Math.round(totals.negGbp * 100),
        hots_pence: Math.round(totals.hotGbp * 100),
        solicitors_pence: Math.round(totals.solGbp * 100),
        exchanged_pence: Math.round(totals.excGbp * 100),
        invoiced_pence: achievedPence,
        exchanged_deals: totals.exchangedDeals,
        wip_total_pence: wipPence,
        salary_pence: salaryPence,
      },
      matchedAllocations: totals.matchCount,
    };
  }

  const totals = await getAgentAllocationTotals(row.name);
  const salaryPence = salaryToPence(row.salary_current ?? row.current_salary_pence);
  const targetPence = targetPenceFor(row.kind, salaryPence);
  const achievedPence = Math.round(totals.inv * 100);
  const underOfferPence = Math.round(totals.sol * 100);
  const negotiatingPence = Math.round(totals.neg * 100);

  await pool.query(
    `UPDATE staff_reviews
        SET fees_target_pence          = COALESCE($1::bigint, fees_target_pence),
            fees_achieved_pence        = $2::bigint,
            pipeline_under_offer_pence = $3::bigint,
            pipeline_negotiating_pence = $4::bigint,
            current_salary_pence       = COALESCE($6::bigint, current_salary_pence),
            updated_at = now()
      WHERE id = $5`,
    [targetPence, achievedPence, underOfferPence, negotiatingPence, reviewId, salaryPence],
  );

  console.log(
    `[review-wip-sync] ${row.name} (review ${reviewId}): target=£${(targetPence || 0) / 100} achieved=£${totals.inv} sol=£${totals.sol} neg=£${totals.neg} (${totals.matchCount} allocations matched)`,
  );

  return {
    reviewId: row.id,
    userId: row.user_id,
    userName: row.name,
    kind: row.kind,
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
