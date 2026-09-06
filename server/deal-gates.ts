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

// Auto-derive crm_deals.kyc_approved (the flag that gates invoicing) from the
// real counterparty KYC state, for every deal that has `companyId` as a
// counterparty. Previously kyc_approved was ONLY ever set by hand, so deals
// sat invoice-locked even when every party was approved. Call this whenever a
// company's KYC status changes (approve/reject) to keep linked deals in sync.
export async function recomputeDealKycApproved(companyId: string, approvedBy?: string | null): Promise<number> {
  if (!companyId) return 0;
  const { rows: deals } = await pool.query(
    `SELECT id, landlord_id, tenant_id, vendor_id, purchaser_id, kyc_approved
       FROM crm_deals
      WHERE landlord_id = $1 OR tenant_id = $1 OR vendor_id = $1 OR purchaser_id = $1`,
    [companyId],
  );
  let changed = 0;
  for (const d of deals as any[]) {
    const result = await checkCounterpartyAml({
      landlordId: d.landlord_id,
      tenantId: d.tenant_id,
      vendorId: d.vendor_id,
      purchaserId: d.purchaser_id,
    });
    const shouldApprove = result.hasCounterparties && result.notReady.length === 0;
    if (!!d.kyc_approved === shouldApprove) continue; // already in sync
    if (shouldApprove) {
      await pool.query(
        `UPDATE crm_deals SET kyc_approved = true, kyc_approved_at = NOW(),
                kyc_approved_by = $2, updated_at = NOW() WHERE id = $1`,
        [d.id, approvedBy || "auto: all counterparties KYC-approved"],
      );
    } else {
      await pool.query(
        `UPDATE crm_deals SET kyc_approved = false, updated_at = NOW() WHERE id = $1`,
        [d.id],
      );
    }
    changed++;
  }
  return changed;
}
