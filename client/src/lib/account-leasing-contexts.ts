import type { AccountLeasingAgent } from "@shared/account-leasing";
import { canonicalBgpRole } from "@shared/bgp-account-roles";

type LeasingContext = AccountLeasingAgent["contexts"][number];
const BASIS_ORDER = { saved_role: 0, property_team: 1, deal_record: 2 } as const;

export interface LeasingContextGroup {
  key: string;
  primary: LeasingContext;
  evidence: LeasingContext[];
  dealEvidence: LeasingContext[];
  savedEvidence: LeasingContext[];
  historyOnly: boolean;
}

/** One visible property/role row, without promoting deal history to a saved role. */
export function groupLeasingContexts(contexts: readonly LeasingContext[]): LeasingContextGroup[] {
  const grouped = new Map<string, LeasingContext[]>();
  for (const context of contexts) {
    const role = canonicalBgpRole(context.role) || context.role.trim().toLowerCase();
    const key = JSON.stringify([context.propertyId, role]);
    const entries = grouped.get(key) || [];
    if (!entries.some(entry => entry.basis === context.basis && entry.href === context.href
      && entry.role === context.role && entry.label === context.label)) entries.push(context);
    grouped.set(key, entries);
  }
  return [...grouped.entries()].map(([key, entries]) => {
    const evidence = [...entries].sort((a, b) => BASIS_ORDER[a.basis] - BASIS_ORDER[b.basis]
      || a.label.localeCompare(b.label) || a.href.localeCompare(b.href));
    const savedEvidence = evidence.filter(entry => entry.basis !== "deal_record");
    return {key, primary: evidence[0], evidence, savedEvidence,
      dealEvidence: evidence.filter(entry => entry.basis === "deal_record"), historyOnly: savedEvidence.length === 0};
  }).sort((a, b) => BASIS_ORDER[a.primary.basis] - BASIS_ORDER[b.primary.basis]
    || (a.primary.propertyName || "").localeCompare(b.primary.propertyName || "")
    || a.primary.role.localeCompare(b.primary.role));
}
