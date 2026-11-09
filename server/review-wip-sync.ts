/**
 * Auto-link review-form numbers from the WIP report.
 *
 * Mapping (Woody's spec, 14 May 2026):
 *   fees_target_pence            = current_salary_pence * 3
 *   fees_achieved_pence          = the agent's share of INV-status deals
 *   pipeline_under_offer_pence   = share of SOL-status deals  (a.k.a. Solicitors / Under Offer)
 *   pipeline_negotiating_pence   = share of NEG-status deals  (a.k.a. Negotiating)
 *
 * The share of a deal is the WIP report's own calculation (see agentBook):
 * fixed amounts win over percentages, splits are rescaled to the deal fee,
 * a deal with no split is divided equally between its internal agents, and
 * BGP House slices never count. Results are multiplied by 100 (£ → pence).
 *
 * Agent → allocation match is agent_user_id first, then the user's name in
 * its usual spellings (full name, surname, "R. Bentley-Smith", ...).
 */

import { pool } from "./db";
import { WIP_STATUSES, isProvisionalFee, legacyToCode, statusSpellingsFor, type DealStatusCode } from "@shared/deal-status";

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
//   fees      = the agent's share of INV deals invoiced during that month
//   WIP       = the agent's current WIP — shares of AVA/NEG/HOT/SOL/EXC/COM
//               deals (invoiced deals have left WIP)
//   exchanged = distinct deals the agent is credited on with exchanged_at
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

interface ReviewAgent { id: string | null; name: string }

interface BookDeal {
  id: string;
  code: DealStatusCode;
  shareGbp: number;      // the agent's share of the deal fee
  exchangedAt: Date | null;
  invoicedOn: Date | null;
  matches: number;       // allocation rows (or internal-agent names) that credited the agent
}

/**
 * The agent's share of every WIP-status deal, worked out exactly as the WIP
 * report does (crm.ts /api/wip, agent-summary and agent-drilldown): a fixed
 * amount wins over a percentage, every split is rescaled so the shares add
 * up to the deal fee, and a deal with no split at all is divided equally
 * between its internal agents. BGP House slices are the firm's cut, never
 * the agent's. Until 9 Nov 2026 this file summed raw allocation rows by
 * allocation_type and ignored deals without a split, so the 1:1 figures
 * disagreed with the WIP report (Woody: "these fees are not adding up").
 */
async function agentBook(agent: ReviewAgent): Promise<BookDeal[]> {
  const variants = new Set(agentNameVariants(agent.name));
  const nameMatches = (raw: string | null | undefined) =>
    !!raw && variants.has(String(raw).toLowerCase().trim());
  const houseSuffix = /\s*\(\s*BGP\s*House\s*\)\s*$/i;

  const wipSpellings = statusSpellingsFor(WIP_STATUSES);
  const dealsRes = await pool.query<{
    id: string; status: string | null; fee: string | null; internal_agent: unknown;
    exchanged_at: string | null; invoiced_on: string | null;
  }>(
    `SELECT d.id, d.status, d.fee, d.internal_agent, d.exchanged_at,
            COALESCE(d.invoiced_at, d.completed_at, d.updated_at) AS invoiced_on
       FROM crm_deals d
      WHERE LOWER(TRIM(COALESCE(d.status, ''))) = ANY($1::text[])`,
    [wipSpellings],
  );
  if (!dealsRes.rows.length) return [];
  const allocRes = await pool.query<{
    deal_id: string; agent_name: string | null; agent_user_id: string | null;
    percentage: string | null; fixed_amount: string | null; is_bgp_house: boolean | null;
  }>(
    `SELECT a.deal_id, a.agent_name, a.agent_user_id, a.percentage, a.fixed_amount, a.is_bgp_house
       FROM deal_fee_allocations a
      WHERE a.deal_id = ANY($1::text[])`,
    [dealsRes.rows.map((d) => d.id)],
  );
  const allocsByDeal = new Map<string, typeof allocRes.rows>();
  for (const a of allocRes.rows) {
    if (!allocsByDeal.has(a.deal_id)) allocsByDeal.set(a.deal_id, []);
    allocsByDeal.get(a.deal_id)!.push(a);
  }

  const book: BookDeal[] = [];
  for (const d of dealsRes.rows) {
    const code = legacyToCode(d.status);
    if (!code || !WIP_STATUSES.includes(code)) continue;
    const totalFee = Number(d.fee) || 0;
    const allocs = allocsByDeal.get(d.id);
    let shareGbp = 0;
    let matches = 0;
    if (allocs && allocs.length > 0) {
      const rawWeight = (a: (typeof allocs)[number]) => {
        const fixed = a.fixed_amount == null ? null : Number(a.fixed_amount);
        return fixed != null && fixed !== 0 ? fixed : totalFee * ((Number(a.percentage) || 0) / 100);
      };
      const weightTotal = allocs.reduce((sum, a) => sum + rawWeight(a), 0);
      for (const a of allocs) {
        if (a.is_bgp_house || houseSuffix.test(a.agent_name || "")) continue;
        const mine = (agent.id && a.agent_user_id === agent.id) || nameMatches(a.agent_name);
        if (!mine) continue;
        const share = weightTotal > 0 ? rawWeight(a) / weightTotal : 1 / allocs.length;
        shareGbp += Math.round(totalFee * share * 100) / 100;
        matches += 1;
      }
    } else {
      const names = Array.isArray(d.internal_agent) ? d.internal_agent as string[] : d.internal_agent ? [String(d.internal_agent)] : [];
      if (names.length && names.some(nameMatches)) {
        shareGbp = totalFee / names.length;
        matches = 1;
      }
    }
    if (!matches) continue;
    const exchangedAt = d.exchanged_at ? new Date(d.exchanged_at) : null;
    const invoicedOn = d.invoiced_on ? new Date(d.invoiced_on) : null;
    book.push({ id: d.id, code, shareGbp, exchangedAt, invoicedOn, matches });
  }
  return book;
}

async function getAgentMonthlyTotals(agent: ReviewAgent, year: number, month: number): Promise<MonthlyTotals> {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const inMonth = (d: Date | null) => !!d && !isNaN(d.getTime()) && d >= from && d < to;
  const book = await agentBook(agent);
  const totals: MonthlyTotals = { invoicedGbp: 0, wipGbp: 0, exchangedDeals: 0, matchCount: 0, negGbp: 0, solGbp: 0, hotGbp: 0, excGbp: 0 };
  for (const deal of book) {
    totals.matchCount += deal.matches;
    if (inMonth(deal.exchangedAt)) totals.exchangedDeals += 1;
    if (deal.code === "INV") {
      if (inMonth(deal.invoicedOn)) totals.invoicedGbp += deal.shareGbp;
      continue;
    }
    // NEG/HOT/AVA stay visible in their own buckets but are provisional —
    // they never add to the WIP total (shared/deal-status.ts, 2026-11-09).
    if (!isProvisionalFee(deal.code)) totals.wipGbp += deal.shareGbp;
    if (deal.code === "NEG") totals.negGbp += deal.shareGbp;
    else if (deal.code === "SOL") totals.solGbp += deal.shareGbp;
    else if (deal.code === "HOT") totals.hotGbp += deal.shareGbp;
    else if (deal.code === "EXC" || deal.code === "COM") totals.excGbp += deal.shareGbp;
  }
  return totals;
}

interface AllocationTotals {
  inv: number; // £
  sol: number; // £
  neg: number; // £
  matchCount: number;
}

// Mid-year / annual forms: the agent's whole book at INV / SOL / NEG, same
// share maths as the monthly 1:1 and the WIP report.
async function getAgentAllocationTotals(agent: ReviewAgent): Promise<AllocationTotals> {
  const book = await agentBook(agent);
  const out: AllocationTotals = { inv: 0, sol: 0, neg: 0, matchCount: 0 };
  for (const deal of book) {
    if (deal.code === "INV") out.inv += deal.shareGbp;
    else if (deal.code === "SOL") out.sol += deal.shareGbp;
    else if (deal.code === "NEG") out.neg += deal.shareGbp;
    else continue;
    out.matchCount += deal.matches;
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
    const totals = await getAgentMonthlyTotals({ id: row.user_id, name: row.name }, year, month);
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

  const totals = await getAgentAllocationTotals({ id: row.user_id, name: row.name });
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
