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

/**
 * What the gate does with a move into SOL/EXC/COM/INV (Woody, 2026-09-23:
 * "fix the AML issues but don't stop deals moving"). Incomplete CDD never
 * blocks: the move goes through, the warning is recorded on the deal, and
 * each outstanding counterparty lands on the MLRO's queue. Only a
 * counterparty the MLRO has REJECTED blocks — as it did before.
 */
export function amlGateOutcome(result: AmlGateResult): { block: string | null; warning: string | null } {
  const rejected = result.notReady.filter(c => c.reason === "rejected");
  if (rejected.length) return { block: `AML: ${rejected.map(c => `${c.name} (${c.role})`).join(", ")} rejected by the MLRO — the deal can't progress until the MLRO clears it.`, warning: null };
  return { block: null, warning: formatAmlWarning(result) };
}

/** Record a let-through warning: deal audit event + MLRO queue item per outstanding company. */
export async function recordAmlGateWarning(dealId: string, deal: AmlGateInput, result: AmlGateResult, ctx: { targetStatus: string; actorId?: string | null; actorName?: string | null }): Promise<void> {
  const warning = formatAmlWarning(result);
  if (!warning) return;
  await pool.query(`INSERT INTO deal_events (deal_id, event_type, payload, actor_id, actor_name) VALUES ($1, 'aml_gate_warning', $2, $3, $4)`,
    [dealId, JSON.stringify({ targetStatus: ctx.targetStatus, warning, notReady: result.notReady }), ctx.actorId || null, ctx.actorName || null]).catch(() => {});
  const roleIds: Record<string, string | null | undefined> = { landlord: deal.landlordId, tenant: deal.tenantId, vendor: deal.vendorId, purchaser: deal.purchaserId };
  for (const c of result.notReady) {
    const companyId = roleIds[c.role];
    if (!companyId) continue;
    await pool.query(
      `INSERT INTO aml_recheck_reminders (deal_id, company_id, entity_name, recheck_type, due_date, notes)
       SELECT $1, $2, $3, 'cdd_outstanding', NOW(), $4
        WHERE NOT EXISTS (SELECT 1 FROM aml_recheck_reminders WHERE company_id=$2 AND recheck_type='cdd_outstanding' AND completed_at IS NULL)`,
      [dealId, companyId, c.name, `Deal moved to ${ctx.targetStatus} with CDD outstanding (${c.reason}) — MLRO to complete before exchange`]).catch(() => {});
  }
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
