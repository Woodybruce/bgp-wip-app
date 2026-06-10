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
// Agent identity: fee-allocation rows store agent NAMES; we map to users
// by exact name match (the same convention review-wip-sync uses) to reach
// staff_profiles / salary_history.

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

// Time-weighted annual salary across the FY (pro-rata rule). History rows
// are effective-dated; the salary in force on each day of the FY counts
// for that day. Projected to the full year using the latest known salary.
function proRataSalary(history: Array<{ salaryPence: number; effectiveDate: string }>, current: number | null, fyStart: Date): number {
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

export interface AgentStatement {
  agent: string;
  userId: string | null;
  salary: number | null;          // effective (pro-rated) annual salary, £
  billings: number;               // FY billings credited (fee allocations), £
  multiple: number | null;        // billings / salary
  currentRate: number;            // marginal rate the agent is on now
  earned: number;                 // commission earned FYTD (accrual basis)
  payable: number;                // earned AND client has paid — due in payroll
  awaitingPayment: number;        // earned but client hasn't paid yet
  nextThreshold: { multiple: number; rate: number; billingsAway: number } | null;
  deals: Array<{ id: string; name: string; feeDue: string | null; billing: number; commission: number; clientPaid: boolean }>;
}

export async function buildCommissionStatements(): Promise<{ fyStart: string; statements: AgentStatement[]; assumptions: string[] }> {
  const fyStart = commissionFyStart();
  const fyStartIso = fyStart.toISOString().slice(0, 10);

  // Deals whose fee fell due this FY (exchange or completion, earliest),
  // with their paid state from synced Xero invoices.
  const dealsRes = await pool.query(`
    SELECT d.id, d.name, d.status, d.fee::float AS fee,
           d.internal_agent AS "internalAgent",
           LEAST(
             COALESCE(d.exchanged_at, 'infinity'::timestamp),
             COALESCE(d.completed_at, 'infinity'::timestamp)
           ) AS fee_due,
           inv.invoice_count AS "invoiceCount",
           inv.paid_count AS "paidCount"
      FROM crm_deals d
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS invoice_count,
               COUNT(*) FILTER (WHERE xi.status = 'PAID')::int AS paid_count
          FROM xero_invoices xi
         WHERE xi.deal_id = d.id AND COALESCE(xi.status, '') <> 'ERROR'
      ) inv ON TRUE
     WHERE d.fee IS NOT NULL AND d.fee > 0
       AND (d.exchanged_at IS NOT NULL OR d.completed_at IS NOT NULL)
  `);

  const deals = dealsRes.rows
    .map((d: any) => ({
      ...d,
      code: legacyToCode(d.status),
      feeDue: d.fee_due && d.fee_due !== "infinity" ? new Date(d.fee_due) : null,
    }))
    .filter((d: any) =>
      (d.code === "EXC" || d.code === "COM" || d.code === "INV") &&
      d.feeDue && !isNaN(d.feeDue.getTime()) && d.feeDue >= fyStart,
    )
    .sort((a: any, b: any) => a.feeDue.getTime() - b.feeDue.getTime());

  const dealIds = deals.map((d: any) => d.id);
  const allocRes = dealIds.length
    ? await pool.query(
        `SELECT deal_id AS "dealId", agent_name AS "agentName",
                percentage::float AS percentage, fixed_amount::float AS "fixedAmount",
                is_bgp_house AS "isBgpHouse"
           FROM deal_fee_allocations
          WHERE deal_id = ANY($1)`,
        [dealIds],
      )
    : { rows: [] as any[] };
  const allocsByDeal = new Map<string, any[]>();
  for (const a of allocRes.rows) {
    if (!allocsByDeal.has(a.dealId)) allocsByDeal.set(a.dealId, []);
    allocsByDeal.get(a.dealId)!.push(a);
  }

  // Salary lookups: agent name → user → staff profile + history.
  const usersRes = await pool.query(`
    SELECT u.id, u.name, sp.salary_current AS "salaryCurrent"
      FROM users u
      LEFT JOIN staff_profiles sp ON sp.user_id = u.id
  `);
  const userByName = new Map(usersRes.rows.map((u: any) => [String(u.name || "").trim().toLowerCase(), u]));
  const historyRes = await pool.query(`SELECT user_id AS "userId", salary_pence AS "salaryPence", effective_date AS "effectiveDate" FROM salary_history`);
  const historyByUser = new Map<string, any[]>();
  for (const h of historyRes.rows) {
    if (!historyByUser.has(h.userId)) historyByUser.set(h.userId, []);
    historyByUser.get(h.userId)!.push(h);
  }

  // Per-agent billing events, chronological (the order matters — bands fill
  // in fee-due order).
  type Event = { dealId: string; dealName: string; feeDue: Date; billing: number; clientPaid: boolean };
  const eventsByAgent = new Map<string, Event[]>();
  const pushEvent = (agent: string, e: Event) => {
    const key = agent.trim();
    if (!key) return;
    if (!eventsByAgent.has(key)) eventsByAgent.set(key, []);
    eventsByAgent.get(key)!.push(e);
  };

  for (const d of deals) {
    const clientPaid = d.invoiceCount > 0 && d.paidCount >= d.invoiceCount;
    const allocs = (allocsByDeal.get(d.id) || []).filter((a: any) => !a.isBgpHouse);
    if (allocs.length > 0) {
      for (const a of allocs) {
        const billing = a.fixedAmount != null && a.fixedAmount !== 0
          ? Number(a.fixedAmount)
          : (Number(d.fee) || 0) * ((Number(a.percentage) || 0) / 100);
        if (billing > 0) pushEvent(a.agentName, { dealId: d.id, dealName: d.name, feeDue: d.feeDue, billing, clientPaid });
      }
    } else {
      // No explicit split — default scheme: 85% to the deal's agents,
      // equally if there's more than one.
      const agents: string[] = Array.isArray(d.internalAgent) ? d.internalAgent.filter(Boolean) : [];
      if (agents.length > 0) {
        const per = ((Number(d.fee) || 0) * 0.85) / agents.length;
        for (const agent of agents) pushEvent(agent, { dealId: d.id, dealName: d.name, feeDue: d.feeDue, billing: per, clientPaid });
      }
    }
  }

  const statements: AgentStatement[] = [];
  for (const [agent, events] of eventsByAgent.entries()) {
    events.sort((a, b) => a.feeDue.getTime() - b.feeDue.getTime());
    const user = userByName.get(agent.toLowerCase()) || null;
    const salary = user
      ? proRataSalary(historyByUser.get(user.id) || [], user.salaryCurrent, fyStart)
      : null;

    let cum = 0;
    let earned = 0, payable = 0, awaiting = 0;
    const dealRows: AgentStatement["deals"] = [];
    for (const e of events) {
      const from = cum;
      cum += e.billing;
      const { amount } = salary && salary > 0 ? bandCommission(from, cum, salary) : { amount: 0 };
      earned += amount;
      if (e.clientPaid) payable += amount; else awaiting += amount;
      dealRows.push({
        id: e.dealId, name: e.dealName, feeDue: e.feeDue.toISOString().slice(0, 10),
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
      multiple: multiple != null ? Math.round(multiple * 100) / 100 : null,
      currentRate,
      earned: Math.round(earned),
      payable: Math.round(payable),
      awaitingPayment: Math.round(awaiting),
      nextThreshold,
      deals: dealRows.slice(-10).reverse(),
    });
  }

  statements.sort((a, b) => b.billings - a.billings);
  return {
    fyStart: fyStartIso,
    statements,
    assumptions: [
      "Billing = the agent's fee-allocation share (BGP House 15% excluded); deals with no explicit split default to 85% across the deal's agents.",
      "A deal counts in the FY of its fee-due date — the earlier of exchange / completion.",
      "Tiers: 0% to 2× salary, 30% to 3×, 40% to 4×, 50% beyond — applied in fee-due order, deals split across thresholds.",
      "Payable = client's Xero invoice(s) fully paid; paid in the month-end payroll run.",
      "Mid-year salary changes pro-rated from salary history.",
    ],
  };
}
