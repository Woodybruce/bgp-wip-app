// Shared AML / KYC counterparty gate. Used by PUT /api/crm/deals/:id, the
// deal-stages.ts SOL+ transition handler, the available-units promote
// (warn-but-allow), and the bulk-status update.
//
// KYC scope: brand-level only. The deal table carries `*EntityId` columns
// (landlordEntityId etc.) for Xero billing context — those are Xero
// ContactID GUIDs per the schema comment at shared/schema.ts:845. They
// are NOT linked to crm_trading_entities, so this gate doesn't attempt
// an entity-level KYC lookup. (Earlier versions queried
// crm_trading_entities by id and silently always missed because of the
// id-shape mismatch; the entity-aware branch was dead code that masked
// the brand-level result.)
import { pool } from "./db";

export type AmlGateInput = {
  landlordId?: string | null;
  tenantId?: string | null;
  vendorId?: string | null;
  purchaserId?: string | null;
};

export type AmlNotReady = { name: string; reason: string; role: string };

export type AmlGateResult = {
  hasCounterparties: boolean;
  notReady: AmlNotReady[];
};

export async function checkCounterpartyAml(deal: AmlGateInput): Promise<AmlGateResult> {
  const pairs: { role: string; parentId: string }[] = [
    { role: "landlord",  parentId: deal.landlordId  ?? "" },
    { role: "tenant",    parentId: deal.tenantId    ?? "" },
    { role: "vendor",    parentId: deal.vendorId    ?? "" },
    { role: "purchaser", parentId: deal.purchaserId ?? "" },
  ].filter(p => p.parentId);

  if (pairs.length === 0) {
    return { hasCounterparties: false, notReady: [] };
  }

  const parentIds = Array.from(new Set(pairs.map(p => p.parentId)));
  const parentRes = await pool.query(
    `SELECT id, name, kyc_status, kyc_expires_at FROM crm_companies WHERE id = ANY($1::varchar[])`,
    [parentIds]
  );
  const parentById = new Map(parentRes.rows.map((r: any) => [r.id, r]));

  const notReady: AmlNotReady[] = [];
  for (const p of pairs) {
    const parent = parentById.get(p.parentId);
    const kycStatus = parent?.kyc_status ?? null;
    const kycExpiresAt = parent?.kyc_expires_at ?? null;
    const displayName = parent?.name || `(unknown ${p.role})`;
    if (kycStatus !== "approved") {
      notReady.push({ name: displayName, reason: kycStatus || "no checks run", role: p.role });
    } else if (kycExpiresAt && new Date(kycExpiresAt) < new Date()) {
      notReady.push({ name: displayName, reason: "expired", role: p.role });
    }
  }

  return { hasCounterparties: true, notReady };
}

export function formatAmlWarning(result: AmlGateResult): string | null {
  if (!result.hasCounterparties) return "Deal has no counterparties linked — AML can't run.";
  if (result.notReady.length === 0) return null;
  return `AML not complete: ${result.notReady.map(c => `${c.name} (${c.reason})`).join(", ")}.`;
}
