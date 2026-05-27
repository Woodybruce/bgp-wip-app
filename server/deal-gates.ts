// Shared AML / KYC counterparty gate. Both PUT /api/crm/deals/:id and the
// deal-stages.ts SOL+ transition handler enforce this as a blocking check;
// the promote-unit (AVA → SOL) flow uses it in warn-but-allow mode so
// promotions still go through but Layla gets a heads-up about which
// counterparties are missing KYC.
import { pool } from "./db";

export type AmlGateInput = {
  landlordId?: string | null;
  tenantId?: string | null;
  vendorId?: string | null;
  purchaserId?: string | null;
  landlordEntityId?: string | null;
  tenantEntityId?: string | null;
  vendorEntityId?: string | null;
  purchaserEntityId?: string | null;
};

export type AmlNotReady = { name: string; reason: string; role: string };

export type AmlGateResult = {
  hasCounterparties: boolean;
  notReady: AmlNotReady[];
};

export async function checkCounterpartyAml(deal: AmlGateInput): Promise<AmlGateResult> {
  const pairs: { role: string; parentId: string | null; entityId: string | null }[] = [
    { role: "landlord",  parentId: deal.landlordId  ?? null, entityId: deal.landlordEntityId  ?? null },
    { role: "tenant",    parentId: deal.tenantId    ?? null, entityId: deal.tenantEntityId    ?? null },
    { role: "vendor",    parentId: deal.vendorId    ?? null, entityId: deal.vendorEntityId    ?? null },
    { role: "purchaser", parentId: deal.purchaserId ?? null, entityId: deal.purchaserEntityId ?? null },
  ].filter(p => p.parentId);

  if (pairs.length === 0) {
    return { hasCounterparties: false, notReady: [] };
  }

  const parentIds = Array.from(new Set(pairs.map(p => p.parentId!).filter(Boolean)));
  const entityIds = Array.from(new Set(pairs.map(p => p.entityId).filter(Boolean) as string[]));

  const [parentRes, entityRes] = await Promise.all([
    pool.query(
      `SELECT id, name, kyc_status, kyc_expires_at FROM crm_companies WHERE id = ANY($1::varchar[])`,
      [parentIds]
    ),
    entityIds.length > 0
      ? pool.query(
          `SELECT id, name, kyc_status, kyc_expires_at FROM crm_trading_entities WHERE id = ANY($1::varchar[])`,
          [entityIds]
        )
      : Promise.resolve({ rows: [] as any[] }),
  ]);

  const parentById = new Map(parentRes.rows.map((r: any) => [r.id, r]));
  const entityById = new Map(entityRes.rows.map((r: any) => [r.id, r]));

  const notReady: AmlNotReady[] = [];
  for (const p of pairs) {
    const entity = p.entityId ? entityById.get(p.entityId) : null;
    const parent = p.parentId ? parentById.get(p.parentId) : null;
    const kycStatus = entity?.kyc_status ?? parent?.kyc_status ?? null;
    const kycExpiresAt = entity?.kyc_expires_at ?? parent?.kyc_expires_at ?? null;
    const displayName = entity?.name || parent?.name || `(unknown ${p.role})`;
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
