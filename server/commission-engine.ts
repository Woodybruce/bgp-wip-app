// BGP commission engine — Woody's scheme, encoded:
//
//   1. 15% of every deal fee goes to BGP House first; the remaining
//      allocation (the deal's fee-split rows) is the agent's BILLING.
//   2. A deal's billing sits in the financial year of its fee-due event —
//      exchange or completion (earliest of the two that exists). The
//      commission FY runs 1 May → 30 April.
//   3. Tiers per agent per FY, thresholds on salary multiples:
//        billings ≤ 2× salary          → 0%
//        2× → 3× salary                → 30% of billing in the band
//        3× → 4× salary                → 40% of billing in the band
//        beyond 4× salary              → 50%, uncapped
//      A single deal can straddle bands — it's split at the thresholds.
//   4. Commission becomes PAYABLE in month-end payroll once the client has
//      paid (deal's Xero invoice(s) fully paid). Until then it's accrued.
//   5. Mid-year salary changes count pro-rata: the threshold salary is the
//      time-weighted salary across the FY (salary_history effective dates).
//
// Agent identity: fee-allocation rows carry agent_user_id (rename-safe,
// preferred) with agent_name as the legacy fallback — same convention as
// the HR commission endpoint. There is deliberately NO equal-split
// fallback for deals without allocation rows: the backfill gave every
// historic deal explicit rows, so a missing split is the correct signal
// that the split needs entering, not something to guess.

import { pool } from "./db";
import { legacyToCode } from "../shared/deal-status";

const TIERS = [
  { fromMultiple: 2, toMultiple: 3, rate: 0.3 },
  { fromMultiple: 3, toMultiple: 4, rate: 0.4 },
  { fromMultiple: 4, toMultiple: Infinity, rate: 0.5 },
];

export function commissionFyStart(today = new Date()): Date {
  const y = today.getUTCMonth() >= 4 ? today.getUTCFullYear() : today.getUTCFullYear() - 1; // May = month 4
  return new Date(Date.UTC(y, 4, 1));
}

// Tier commission on cumulative billings B against threshold salary S —
// both in the same unit (£ or pence, as long as they match).
export function tierCommission(B: number, S: number): number {
  if (S <= 0 || B <= 0) return 0;
  let c = 0;
  for (const t of TIERS) {
    const lo = t.fromMultiple * S;
    const hi = t.toMultiple * S;
    if (B > lo) c += (Math.min(B, hi) - lo) * t.rate;
  }
  return c;
}

// Time-weighted annual salary across the FY (pro-rata rule). History rows
// are effective-dated; the salary in force on each day of the FY counts
// for that day. Projected to the full year using the latest known salary.
export function proRataSalary(history: Array<{ salaryPence: number; effectiveDate: string }>, current: number | null, fyStart: Date): number {
  const fyEnd = new Date(Date.UTC(fyStart.getUTCFullYear() + 1, 4, 1));
  const rows = history
    .map(h => ({ pence: h.salaryPence, at: new Date(h.effectiveDate) }))
    .filter(h => !isNaN(h.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (rows.length === 0) return (current || 0) / 100;

  let weighted = 0;
  const totalMs = fyEnd.getTime() - fyStart.getTime();
  for (let i = 0; i < rows.length; i++) {
    const from = Math.max(rows[i].at.getTime(), fyStart.getTime());
    const to = Math.min(i + 1 < rows.length ? rows[i + 1].at.getTime() : fyEnd.getTime(), fyEnd.getTime());
    if (to > from) weighted += rows[i].pence * (to - from);
  }
  // Days before the first history row fall back to that first salary.
  const firstAt = rows[0].at.getTime();
  if (firstAt > fyStart.getTime()) {
    weighted += rows[0].pence * (Math.min(firstAt, fyEnd.getTime()) - fyStart.getTime());
  }
  return weighted / totalMs / 100;
}

// Commission on the billing between cumulative positions [fromB, toB],
// given threshold salary S — integrates the tier bands.
function bandCommission(fromB: number, toB: number, S: number): { amount: number; topRate: number } {
  if (S <= 0 || toB <= fromB) return { amount: 0, topRate: 0 };
  let amount = 0;
  let topRate = 0;
  for (const t of TIERS) {
    const lo = Math.max(fromB, t.fromMultiple * S);
    const hi = Math.min(toB, t.toMultiple * S);
    if (hi > lo) {
      amount += (hi - lo) * t.rate;
      topRate = t.rate;
    }
  }
  return { amount, topRate };
}

export interface CommissionDealRow {
  id: string;
  name: string;
  status: string | null;
  feeDue: string | null;
  billing: number;
  commission: number;
  clientPaid: boolean;
}

export interface AgentStatement {
  agent: string;
  userId: string | null;
  salary: number | null;          // effective (pro-rated) annual salary, £
  billings: number;               // FY billings credited (fee allocations), £
  billingsPaid: number;           // … the slice where the client has paid
  billingsAwaiting: number;       // … the slice still awaiting client payment
  multiple: number | null;        // billings / salary
  currentRate: number;            // marginal rate the agent is on now
  earned: number;                 // commission earned FYTD (accrual basis)
  payable: number;                // earned AND client has paid — due in payroll
  awaitingPayment: number;        // earned but client hasn't paid yet
  nextThreshold: { multiple: number; rate: number; billingsAway: number } | null;
  deals: CommissionDealRow[];     // most recent first, capped for the Finance UI
  allDeals: CommissionDealRow[];  // every FY deal, fee-due order
}

export async function buildCommissionStatements(): Promise<{ fyStart: string; statements: AgentStatement[]; assumptions: string[] }> {
  const fyStart = commissionFyStart();
  const fyStartIso = fyStart.toISOString().slice(0, 10);

  // One row per (qualifying deal × non-house allocation): the deal's fee
  // fell due this FY (exchange, completion or invoice date, earliest) at EXC/COM/INV,
  // with paid state from synced Xero invoices. agent_user_id preferred,
  // agent_name kept for display + legacy rows.
  const rowsRes = await pool.query(`
    SELECT d.id AS "dealId", d.name AS "dealName", d.status,
           LEAST(
             COALESCE(d.exchanged_at, 'infinity'::timestamp),
             COALESCE(d.completed_at, 'infinity'::timestamp),
             COALESCE(d.invoiced_at, 'infinity'::timestamp)
           ) AS fee_due,
           inv.invoice_count AS "invoiceCount",
           inv.paid_count AS "paidCount",
           dfa.agent_user_id AS "agentUserId",
           dfa.agent_name AS "agentName",
           (CASE WHEN dfa.fixed_amount IS NOT NULL AND dfa.fixed_amount <> 0
                 THEN dfa.fixed_amount
                 ELSE d.fee * COALESCE(dfa.percentage, 0) / 100.0
            END)::float AS billing
      FROM crm_deals d
      JOIN deal_fee_allocations dfa
        ON dfa.deal_id = d.id AND COALESCE(dfa.is_bgp_house, false) = false
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS invoice_count,
               COUNT(*) FILTER (WHERE xi.status = 'PAID')::int AS paid_count
          FROM xero_invoices xi
         WHERE xi.deal_id = d.id AND COALESCE(xi.status, '') <> 'ERROR'
      ) inv ON TRUE
     WHERE d.fee IS NOT NULL AND d.fee > 0
       AND (d.exchanged_at IS NOT NULL OR d.completed_at IS NOT NULL OR d.invoiced_at IS NOT NULL)
  `);

  // Salary lookups: by user id (preferred) and by name (legacy rows).
  const usersRes = await pool.query(`
    SELECT u.id, u.name, sp.salary_current AS "salaryCurrent"
      FROM users u
      LEFT JOIN staff_profiles sp ON sp.user_id = u.id
  `);
  const userById = new Map(usersRes.rows.map((u: any) => [u.id, u]));
  const userByName = new Map(usersRes.rows.map((u: any) => [String(u.name || "").trim().toLowerCase(), u]));
  const historyRes = await pool.query(`SELECT user_id AS "userId", salary_pence AS "salaryPence", effective_date AS "effectiveDate" FROM salary_history`);
  const historyByUser = new Map<string, any[]>();
  for (const h of historyRes.rows) {
    if (!historyByUser.has(h.userId)) historyByUser.set(h.userId, []);
    historyByUser.get(h.userId)!.push(h);
  }

  // Per-agent billing events, chronological (the order matters — bands fill
  // in fee-due order). Keyed by user id when the allocation has one,
  // otherwise by normalised name.
  type Event = { dealId: string; dealName: string; status: string | null; feeDue: Date; billing: number; clientPaid: boolean };
  const eventsByKey = new Map<string, { user: any | null; displayName: string; events: Event[] }>();

  for (const r of rowsRes.rows) {
    const code = legacyToCode(r.status);
    if (code !== "EXC" && code !== "COM" && code !== "INV") continue;
    const feeDue = r.fee_due && r.fee_due !== "infinity" ? new Date(r.fee_due) : null;
    if (!feeDue || isNaN(feeDue.getTime()) || feeDue < fyStart) continue;
    const billing = Number(r.billing) || 0;
    if (billing <= 0) continue;

    const user = (r.agentUserId && userById.get(r.agentUserId))
      || userByName.get(String(r.agentName || "").trim().toLowerCase())
      || null;
    const key = user ? `u:${user.id}` : `n:${String(r.agentName || "").trim().toLowerCase()}`;
    if (!key.slice(2)) continue;
    if (!eventsByKey.has(key)) {
      eventsByKey.set(key, { user, displayName: user?.name || r.agentName || "Unassigned", events: [] });
    }
    eventsByKey.get(key)!.events.push({
      dealId: r.dealId,
      dealName: r.dealName,
      status: code,
      feeDue,
      billing,
      clientPaid: r.invoiceCount > 0 && r.paidCount >= r.invoiceCount,
    });
  }

  const statements: AgentStatement[] = [];
  for (const { user, displayName, events } of eventsByKey.values()) {
    const agent = displayName;
    events.sort((a, b) => a.feeDue.getTime() - b.feeDue.getTime());
    const salary = user
      ? proRataSalary(historyByUser.get(user.id) || [], user.salaryCurrent, fyStart)
      : null;

    let cum = 0;
    let earned = 0, payable = 0, awaiting = 0;
    let billingsPaid = 0, billingsAwaiting = 0;
    const dealRows: CommissionDealRow[] = [];
    for (const e of events) {
      const from = cum;
      cum += e.billing;
      const { amount } = salary && salary > 0 ? bandCommission(from, cum, salary) : { amount: 0 };
      earned += amount;
      if (e.clientPaid) { payable += amount; billingsPaid += e.billing; }
      else { awaiting += amount; billingsAwaiting += e.billing; }
      dealRows.push({
        id: e.dealId, name: e.dealName, status: e.status, feeDue: e.feeDue.toISOString().slice(0, 10),
        billing: Math.round(e.billing), commission: Math.round(amount), clientPaid: e.clientPaid,
      });
    }

    const multiple = salary && salary > 0 ? cum / salary : null;
    let currentRate = 0;
    let nextThreshold: AgentStatement["nextThreshold"] = null;
    if (salary && salary > 0) {
      for (const t of TIERS) if (cum >= t.fromMultiple * salary) currentRate = t.rate;
      const next = TIERS.find(t => cum < t.fromMultiple * salary);
      if (next) nextThreshold = { multiple: next.fromMultiple, rate: next.rate, billingsAway: Math.round(next.fromMultiple * salary - cum) };
    }

    statements.push({
      agent,
      userId: user?.id || null,
      salary: salary != null ? Math.round(salary) : null,
      billings: Math.round(cum),
      billingsPaid: Math.round(billingsPaid),
      billingsAwaiting: Math.round(billingsAwaiting),
      multiple: multiple != null ? Math.round(multiple * 100) / 100 : null,
      currentRate,
      earned: Math.round(earned),
      payable: Math.round(payable),
      awaitingPayment: Math.round(awaiting),
      nextThreshold,
      deals: dealRows.slice(-10).reverse(),
      allDeals: dealRows,
    });
  }

  statements.sort((a, b) => b.billings - a.billings);
  return {
    fyStart: fyStartIso,
    statements: statements.map(s => ({ ...s })),
    assumptions: [
      "Billing = the agent's fee-allocation share (BGP House 15% excluded); deals with no explicit split default to 85% across the deal's agents.",
      "A deal counts in the FY of its fee-due date — the earlier of exchange / completion.",
      "Tiers: 0% to 2× salary, 30% to 3×, 40% to 4×, 50% beyond — applied in fee-due order, deals split across thresholds.",
      "Payable = client's Xero invoice(s) fully paid; paid in the month-end payroll run.",
      "Mid-year salary changes pro-rated from salary history.",
    ],
  };
}

// Single-agent view for the HR profile's Commission tab — same engine, same
// numbers as the Finance dashboard, just filtered to one person. Matches by
// user id first, then by the user's name for legacy allocation rows.
export async function buildCommissionStatementForUser(userId: string): Promise<{ fyStart: string; statement: AgentStatement | null; assumptions: string[] }> {
  const all = await buildCommissionStatements();
  let statement = all.statements.find(s => s.userId === userId) || null;
  if (!statement) {
    const u = await pool.query(`SELECT name FROM users WHERE id = $1`, [userId]);
    const name = String(u.rows[0]?.name || "").trim().toLowerCase();
    if (name) {
      statement = all.statements.find(s => s.agent.trim().toLowerCase() === name) || null;
      // Loose fallback: allocations sometimes carry a first name only
      // ("Tracey" vs "Tracey Pollard"). Only accept when exactly one
      // unclaimed statement matches, to avoid crediting the wrong person.
      if (!statement) {
        const candidates = all.statements.filter(s => {
          if (s.userId) return false; // already resolved to a different user
          const agent = s.agent.trim().toLowerCase();
          return name.startsWith(agent + " ") || agent.startsWith(name.split(" ")[0] + " ") || agent === name.split(" ")[0];
        });
        if (candidates.length === 1) statement = candidates[0];
      }
    }
  }
  return { fyStart: all.fyStart, statement, assumptions: all.assumptions };
}
