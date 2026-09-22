// Firm fee policy — who gets what off the top of a deal fee.
//
// Default: BGP House (firm overhead) takes 15% of every deal fee before the
// agents split the remainder. Some deal types are firm income with no agent
// split at all — Secondment (Woody, 2026-09-09: "the fee needs to be 100% to
// BGP House") — so the house slice is the whole fee and no agent rows exist.
// Shared by the fee-split editor (client), the allocation save validation
// and the boot-time normalisation (server).

export const BGP_HOUSE_PCT = 15;

export const FIRM_ONLY_DEAL_TYPES = ["Secondment"];

export function isFirmOnlyDealType(dealType: string | null | undefined): boolean {
  const dt = String(dealType || "").trim().toLowerCase();
  return FIRM_ONLY_DEAL_TYPES.some((t) => t.toLowerCase() === dt);
}

export function bgpHousePctFor(dealType: string | null | undefined): number {
  return isFirmOnlyDealType(dealType) ? 100 : BGP_HOUSE_PCT;
}
