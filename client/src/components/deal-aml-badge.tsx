import type { CrmCompany, CrmDeal } from "@shared/schema";

export type AmlDealStatus = "complete" | "incomplete" | "no_counterparties";

export interface AmlCheckCompany {
  id: string;
  name: string;
  kycStatus: string | null;
  kycExpiresAt: Date | string | null;
}

// Derives whether a deal is AML-complete from its linked counterparties.
// Mirrors the server-side gate in server/crm.ts (PUT /api/crm/deals/:id)
// and server/deal-stages.ts (POST /api/deal/:id/stage): every linked
// counterparty must have kyc_status === 'approved' and not be expired.
//
// Returns the status plus the list of counterparties that aren't ready
// (used to drive the tooltip). Skipped counterparties (no kyc_status)
// count as "incomplete" — the regulator doesn't care that we just
// haven't run them yet.
export function computeDealAmlStatus(
  deal: Pick<CrmDeal, "landlordId" | "tenantId"> & {
    vendorId?: string | null;
    purchaserId?: string | null;
  },
  companyById: Map<string, AmlCheckCompany>,
): { status: AmlDealStatus; missing: { id: string; name: string; reason: string }[] } {
  const counterpartyIds = [
    deal.landlordId,
    deal.tenantId,
    (deal as any).vendorId,
    (deal as any).purchaserId,
  ].filter((id): id is string => !!id);

  if (counterpartyIds.length === 0) {
    return { status: "no_counterparties", missing: [] };
  }

  const missing: { id: string; name: string; reason: string }[] = [];
  for (const id of Array.from(new Set(counterpartyIds))) {
    const c = companyById.get(id);
    if (!c) {
      missing.push({ id, name: `(unknown ${id.slice(0, 6)}…)`, reason: "company not loaded" });
      continue;
    }
    if (c.kycStatus !== "approved") {
      missing.push({ id, name: c.name, reason: c.kycStatus || "no checks run" });
      continue;
    }
    if (c.kycExpiresAt && new Date(c.kycExpiresAt) < new Date()) {
      missing.push({ id, name: c.name, reason: "expired" });
    }
  }
  return { status: missing.length === 0 ? "complete" : "incomplete", missing };
}

// Convenience: build the lookup map from a flat companies list. Picks
// out only the fields the AML check needs so the type stays narrow.
export function buildAmlCompanyMap(companies: CrmCompany[]): Map<string, AmlCheckCompany> {
  const map = new Map<string, AmlCheckCompany>();
  for (const c of companies) {
    map.set(c.id, {
      id: c.id,
      name: c.name,
      kycStatus: (c as any).kycStatus ?? null,
      kycExpiresAt: (c as any).kycExpiresAt ?? null,
    });
  }
  return map;
}

interface DealAmlBadgeProps {
  status: AmlDealStatus;
  missing: { id: string; name: string; reason: string }[];
  /** Inline label next to the dot ("AML"). Off by default so the badge fits in tight rows. */
  withLabel?: boolean;
  size?: "sm" | "md";
}

// Visual dot + accessible tooltip. Green = AML complete on every
// counterparty. Amber = at least one counterparty missing or expired.
// Grey = no counterparties linked yet (we can't run AML on nothing).
export function DealAmlBadge({ status, missing, withLabel = false, size = "sm" }: DealAmlBadgeProps) {
  const dotSize = size === "md" ? "w-2.5 h-2.5" : "w-2 h-2";
  if (status === "complete") {
    return (
      <span className="inline-flex items-center gap-1" title="AML complete on every counterparty">
        <span className={`${dotSize} rounded-full bg-emerald-500`} aria-label="AML complete" />
        {withLabel && <span className="text-[10px] text-emerald-700 font-medium">AML</span>}
      </span>
    );
  }
  if (status === "no_counterparties") {
    return (
      <span className="inline-flex items-center gap-1" title="No counterparties linked yet — AML not applicable">
        <span className={`${dotSize} rounded-full bg-zinc-300`} aria-label="No counterparties" />
        {withLabel && <span className="text-[10px] text-muted-foreground font-medium">AML</span>}
      </span>
    );
  }
  // incomplete
  const tooltip = missing.length > 0
    ? `AML incomplete:\n${missing.map(m => `  • ${m.name} — ${m.reason}`).join("\n")}\n\nMoves to SOL+ will be blocked until every party is approved.`
    : "AML incomplete";
  return (
    <span className="inline-flex items-center gap-1" title={tooltip}>
      <span className={`${dotSize} rounded-full bg-amber-500`} aria-label="AML incomplete" />
      {withLabel && <span className="text-[10px] text-amber-700 font-medium">AML</span>}
    </span>
  );
}
