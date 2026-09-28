// The roles a BGP person can hold on an account — a fixed list (it was free
// text) so each maps onto a Team view tab (Woody, 2026-09-28: "this add role
// function is just free text rather than role… needs to be linked to team
// view").
export const BGP_ACCOUNT_ROLES = [
  { role: "Relationship lead", tab: null },
  { role: "Investment", tab: "investment" },
  { role: "Leasing", tab: "tenantRep" },
  { role: "Tenant rep", tab: "tenantRep" },
  { role: "Lease advisory", tab: "leaseAdvisory" },
  { role: "Development", tab: null },
  { role: "Support", tab: null },
] as const;
export type BgpAccountRole = typeof BGP_ACCOUNT_ROLES[number]["role"];
export type TeamViewTab = "investment" | "tenantRep" | "agents" | "leaseAdvisory";

/** Old free-text roles ("Investment lead", "leasing") read onto the list. */
export function canonicalBgpRole(value: string | null | undefined): BgpAccountRole | null {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  const exact = BGP_ACCOUNT_ROLES.find(r => r.role.toLowerCase() === v);
  if (exact) return exact.role;
  if (/\blead\b|relationship|account (?:lead|owner|manager)/.test(v) && !/invest|leas|tenant|advis/.test(v)) return "Relationship lead";
  if (/invest|capital markets|sales|acquisition/.test(v)) return "Investment";
  if (/tenant ?rep|acquisitions? for/.test(v)) return "Tenant rep";
  if (/lease advis|rent review|renewal|pla\b/.test(v)) return "Lease advisory";
  if (/leas|letting|agency/.test(v)) return "Leasing";
  if (/develop/.test(v)) return "Development";
  if (/support|analyst|assist/.test(v)) return "Support";
  return null;
}

export function teamTabForRole(value: string | null | undefined): TeamViewTab | null {
  const role = canonicalBgpRole(value);
  return (BGP_ACCOUNT_ROLES.find(r => r.role === role)?.tab as TeamViewTab | null) ?? null;
}
