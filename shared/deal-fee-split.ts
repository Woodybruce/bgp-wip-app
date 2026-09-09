/**
 * How a deal's fee splits across agents — ONE derivation, shared by every
 * surface that reports it.
 *
 * The rule (BGP's fee-allocation editor is the door that writes it): if the
 * deal has `deal_fee_allocations` rows, those ARE the split — a fixed amount
 * where given, otherwise the percentage of the fee. Only a deal with no
 * allocations at all falls back to an even split across `internal_agent`.
 *
 * This lived twice: once in `/api/wip/agent-summary` (correct) and once in
 * the Board Report .xlsx export (which always did the even split and never
 * read the allocations at all, so a 60/25/15 split left the building as
 * 50/50 with the BGP House slice missing).
 */

export interface DealFeeAllocationLike {
  agentName: string;
  allocationType?: string | null;
  percentage?: number | null;
  fixedAmount?: number | null;
}

export interface AgentFeeShare {
  agentName: string;
  amount: number;
}

/**
 * @param allowAgent optional gate applied BEFORE the split, so a caller that
 *   hides an agent also removes them from the even-split divisor.
 */
export function splitDealFee(
  fee: number,
  allocations: DealFeeAllocationLike[] | undefined,
  internalAgents: string[] | string | null | undefined,
  allowAgent: (agentName: string) => boolean = () => true,
): AgentFeeShare[] {
  const allocs = (allocations || []).filter((a) => a.agentName && allowAgent(a.agentName));
  if ((allocations || []).length > 0) {
    return allocs.map((a) => ({
      agentName: a.agentName,
      amount: a.fixedAmount || Math.round(fee * ((a.percentage || 0) / 100) * 100) / 100,
    }));
  }
  const names = (Array.isArray(internalAgents) ? internalAgents : internalAgents ? [internalAgents] : [])
    .map((n) => String(n || "").trim())
    .filter((n) => n.length > 0)
    .filter(allowAgent);
  if (names.length === 0) return [];
  const perAgent = fee / names.length;
  return names.map((agentName) => ({ agentName, amount: perAgent }));
}
