// Shared AML / KYC counterparty gate. Used by PUT /api/crm/deals/:id, the
// deal-stages.ts SOL+ transition handler, the available-units promote
// and the bulk-status update. Each warns and lets the move through, and
// each refuses a counterparty the MLRO has rejected.
//
// KYC scope (since 18 November 2026, step 2 of the deal page review; Woody:
// "go ahead with your suggestions"): a party with no company that signs is
// judged on its brand (crm_companies.kyc_*), as before. A party whose deal
// names the company that signs (crm_deals.<role>_trading_entity_id, set from
// the deal's parties, server/deal-parties.ts) is judged on that company's
// own check (crm_entity_kyc), or the brand's while it has none and is the
// brand's own legal company. A brand the MLRO rejected still blocks. The
// rule is shared/party-kyc.ts. The `*EntityId` columns (landlordEntityId
// etc.) are Xero ContactIDs and are never read here.
import { pool } from "./db";
import { kycVerdict, partyKycState, type PartyKycState } from "@shared/party-kyc";

export type AmlGateInput = {
  landlordId?: string | null;
  tenantId?: string | null;
  vendorId?: string | null;
  purchaserId?: string | null;
  // The company that signs for each party: given here, or read from the deal
  // named by dealId. Counted only when it is filed under that party's brand,
  // so a party changed in the same save drops the old one.
  landlordTradingEntityId?: string | null;
  tenantTradingEntityId?: string | null;
  vendorTradingEntityId?: string | null;
  purchaserTradingEntityId?: string | null;
  dealId?: string | null;
};

const GATE_ROLES = ["landlord", "tenant", "vendor", "purchaser"] as const;
type Querier = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

// The company that signs for each role: as given, else as the deal stores it.
async function signingCompanies(deal: AmlGateInput): Promise<Record<string, string | null>> {
  const given = (role: string) => (deal as any)[`${role}TradingEntityId`] as string | null | undefined;
  const stored = deal.dealId && GATE_ROLES.some(r => given(r) === undefined)
    ? (await pool.query(
        `SELECT landlord_trading_entity_id, tenant_trading_entity_id, vendor_trading_entity_id, purchaser_trading_entity_id
           FROM crm_deals WHERE id = $1`, [deal.dealId]).catch(() => ({ rows: [] as any[] }))).rows[0] || null
    : null;
  const out: Record<string, string | null> = {};
  for (const role of GATE_ROLES) {
    const g = given(role);
    out[role] = g !== undefined ? (g || null) : (stored?.[`${role}_trading_entity_id`] || null);
  }
  return out;
}

/** Each party's AML state by role: the brand, or the company that signs (shared/party-kyc.ts). */
export async function loadPartyKyc(q: Querier, parties: Array<{ role: string; brandId: string; entityId: string | null }>): Promise<Record<string, PartyKycState>> {
  const brandIds = [...new Set(parties.map(p => p.brandId).filter(Boolean))];
  const entityIds = [...new Set(parties.map(p => p.entityId).filter((x): x is string => !!x))];
  const brands = brandIds.length ? (await q.query(
    `SELECT id, name, uk_entity_name, companies_house_number, companies_house_data->>'company_name' AS ch_name,
            kyc_status, kyc_expires_at, kyc_approved_by, kyc_checked_at
       FROM crm_companies WHERE id = ANY($1::varchar[])`, [brandIds])).rows : [];
  const entities = entityIds.length ? (await q.query(
    `SELECT id, parent_company_id, name, companies_house_number FROM crm_trading_entities WHERE id = ANY($1::varchar[])`, [entityIds])).rows : [];
  // A failed read of the companies' own checks reads as "no checks run":
  // never as approved.
  const checks = entityIds.length ? (await q.query(
    `SELECT entity_id, kyc_status, expires_at, approved_by, approved_at FROM crm_entity_kyc
      WHERE entity_kind = 'trading_entity' AND entity_id = ANY($1::text[])`, [entityIds]).catch(() => ({ rows: [] as any[] }))).rows : [];
  const out: Record<string, PartyKycState> = {};
  for (const p of parties) {
    const b = brands.find((r: any) => r.id === p.brandId);
    if (!b) { out[p.role] = { name: `(unknown ${p.role})`, source: "brand", status: null, expiresAt: null, approvedBy: null }; continue; }
    const e = p.entityId ? entities.find((r: any) => r.id === p.entityId && r.parent_company_id === p.brandId) : null;
    const k = e ? checks.find((r: any) => r.entity_id === e.id) : null;
    out[p.role] = partyKycState({
      brand: { id: b.id, name: b.name, companiesHouseNumber: b.companies_house_number || null, legalName: b.uk_entity_name || b.ch_name || null,
        status: b.kyc_status || null, expiresAt: b.kyc_expires_at || null, approvedBy: b.kyc_approved_by || null, approvedAt: b.kyc_checked_at || null },
      company: e ? { id: e.id, name: e.name, companiesHouseNumber: e.companies_house_number || null,
        kyc: k ? { status: k.kyc_status || null, expiresAt: k.expires_at || null, approvedBy: k.approved_by || null, approvedAt: k.approved_at || null } : null } : null,
    });
  }
  return out;
}

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

  const signs = await signingCompanies(deal);
  const states = await loadPartyKyc(pool, pairs.map(p => ({ role: p.role, brandId: p.parentId, entityId: signs[p.role] })));
  const notReady: AmlNotReady[] = [];
  for (const p of pairs) {
    const state = states[p.role];
    const verdict = kycVerdict(state);
    if (!verdict.approved) notReady.push({ name: state.name || `(unknown ${p.role})`, reason: verdict.reason || "no checks run", role: p.role });
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
/** What a client login is told when the MLRO's block stops a deal: that it
 *  is held, never which party was rejected or why (the Letting Tracker's
 *  rule, used wherever the block answers a client). BGP staff get the detail. */
export const AML_HELD_FOR_CLIENT = "This deal cannot move on yet. BGP's compliance team has to clear it first: ask BGP.";

export function amlGateOutcome(result: AmlGateResult): { block: string | null; warning: string | null } {
  const rejected = result.notReady.filter(c => c.reason === "rejected");
  if (rejected.length) return { block: `AML: ${rejected.map(c => `${c.name} (${c.role})`).join(", ")} rejected by the MLRO — the deal can't progress until the MLRO clears it.`, warning: null };
  return { block: null, warning: formatAmlWarning(result) };
}

/** Record a let-through warning: deal audit event + MLRO queue item per outstanding company. */
export async function recordAmlGateWarning(dealId: string, deal: AmlGateInput, result: AmlGateResult, ctx: { targetStatus: string; actorId?: string | null; actorName?: string | null }): Promise<void> {
  const warning = formatAmlWarning(result);
  if (!warning) return;
  // One warning per deal/target/hour: the endpoint gate and the mirror
  // backstop both run this on the same edit, and that must not double the
  // audit trail.
  await pool.query(
    `INSERT INTO deal_events (deal_id, event_type, payload, actor_id, actor_name)
     SELECT $1::varchar, 'aml_gate_warning', $2, $3, $4
      WHERE NOT EXISTS (
        SELECT 1 FROM deal_events
         WHERE deal_id = $1::varchar AND event_type = 'aml_gate_warning'
           AND payload::jsonb ->> 'targetStatus' = $5
           AND occurred_at > NOW() - interval '1 hour')`,
    [dealId, JSON.stringify({ targetStatus: ctx.targetStatus, warning, notReady: result.notReady }), ctx.actorId || null, ctx.actorName || null, ctx.targetStatus])
    .catch((e: any) => console.error("[aml-gate] warning not recorded on deal", dealId, e?.message));
  const roleIds: Record<string, string | null | undefined> = { landlord: deal.landlordId, tenant: deal.tenantId, vendor: deal.vendorId, purchaser: deal.purchaserId };
  for (const c of result.notReady) {
    const companyId = roleIds[c.role];
    if (!companyId) continue;
    await pool.query(
      `INSERT INTO aml_recheck_reminders (deal_id, company_id, entity_name, recheck_type, due_date, notes)
       SELECT $1, $2::varchar, $3, 'cdd_outstanding', NOW(), $4
        WHERE NOT EXISTS (SELECT 1 FROM aml_recheck_reminders WHERE company_id=$2::varchar AND recheck_type='cdd_outstanding' AND completed_at IS NULL)`,
      [dealId, companyId, c.name, `Deal moved to ${ctx.targetStatus} with CDD outstanding (${c.reason}) — MLRO to complete before exchange`])
      .catch((e: any) => console.error("[aml-gate] reminder not recorded for deal", dealId, e?.message));
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
    `SELECT id, landlord_id, tenant_id, vendor_id, purchaser_id, kyc_approved,
            landlord_trading_entity_id, tenant_trading_entity_id, vendor_trading_entity_id, purchaser_trading_entity_id
       FROM crm_deals
      WHERE landlord_id = $1 OR tenant_id = $1 OR vendor_id = $1 OR purchaser_id = $1`,
    [companyId],
  );
  return recomputeDeals(deals, approvedBy);
}

// The deals that name a company that signs, when that company's own check
// changes (BGP sign-off, KYC4U's result on it).
export async function recomputeDealsForTradingEntity(entityId: string, approvedBy?: string | null): Promise<number> {
  if (!entityId) return 0;
  const { rows: deals } = await pool.query(
    `SELECT id, landlord_id, tenant_id, vendor_id, purchaser_id, kyc_approved,
            landlord_trading_entity_id, tenant_trading_entity_id, vendor_trading_entity_id, purchaser_trading_entity_id
       FROM crm_deals
      WHERE landlord_trading_entity_id = $1 OR tenant_trading_entity_id = $1 OR vendor_trading_entity_id = $1 OR purchaser_trading_entity_id = $1`,
    [entityId],
  );
  return recomputeDeals(deals, approvedBy);
}

async function recomputeDeals(deals: any[], approvedBy?: string | null): Promise<number> {
  let changed = 0;
  for (const d of deals as any[]) {
    const result = await checkCounterpartyAml({
      landlordId: d.landlord_id,
      tenantId: d.tenant_id,
      vendorId: d.vendor_id,
      purchaserId: d.purchaser_id,
      landlordTradingEntityId: d.landlord_trading_entity_id || null,
      tenantTradingEntityId: d.tenant_trading_entity_id || null,
      vendorTradingEntityId: d.vendor_trading_entity_id || null,
      purchaserTradingEntityId: d.purchaser_trading_entity_id || null,
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

// Senior approvers for COM/INV transitions — single source, shared with the
// deal PUT in crm.ts and the board mirrors.
export const SENIOR_APPROVER_EMAILS = new Set([
  "woody@brucegillinghampollard.com",
  "charlotte@brucegillinghampollard.com",
  "rupert@brucegillinghampollard.com",
  "jack@brucegillinghampollard.com",
]);

export type TransitionDenial = { status: number; error: string; code?: string };

// The senior-approval and AML gates the deal PUT enforces, in a form the
// board mirrors and other side doors can call before writing crm_deals.status.
// Returns null when the transition may proceed (and records an AML warning
// where the PUT would). actorUserId null/undefined = system/no user → treated
// as NOT senior.
export async function dealStatusTransitionDenial(
  actorUserId: string | null | undefined,
  dealId: string,
  newStatusRaw: string,
): Promise<TransitionDenial | null> {
  const { legacyToCode, CLOSED_STATUSES } = await import("../shared/deal-status");
  const deal = (await pool.query(
    `SELECT status, landlord_id, tenant_id, vendor_id, purchaser_id, aml_check_completed FROM crm_deals WHERE id = $1`,
    [dealId],
  )).rows[0];
  if (!deal) return null;
  const targetCode = legacyToCode(newStatusRaw);
  const currentCode = legacyToCode(deal.status);
  if (!targetCode || targetCode === currentCode) return null;
  // Closed deals never move through a board edit — the mirror skips the
  // write and starts a fresh cycle instead (INV stays INV, COM may only
  // advance to INV). Nothing will be written, so there is nothing to deny:
  // a 403 here would block routine unit edits on every invoiced letting.
  if (currentCode && CLOSED_STATUSES.includes(currentCode)
      && !(currentCode === "COM" && targetCode === "INV")) {
    return null;
  }

  let actorName = "System";
  let isSenior = false;
  if (actorUserId) {
    const u = (await pool.query(`SELECT name, email, username, is_admin FROM users WHERE id = $1 LIMIT 1`, [actorUserId])).rows[0];
    if (u) {
      actorName = u.name || u.email || u.username || actorName;
      isSenior = !!u.is_admin || SENIOR_APPROVER_EMAILS.has((u.email || "").toLowerCase());
    }
  }
  if (["COM", "INV"].includes(targetCode) && !isSenior) {
    return { status: 403, error: `Senior approval required to mark deals as ${newStatusRaw}` };
  }
  if (["SOL", "EXC", "COM", "INV"].includes(targetCode) && deal.aml_check_completed !== "YES") {
    const parties: AmlGateInput = {
      landlordId: deal.landlord_id, tenantId: deal.tenant_id,
      vendorId: deal.vendor_id, purchaserId: deal.purchaser_id, dealId,
    };
    const amlResult = await checkCounterpartyAml(parties);
    const outcome = amlGateOutcome(amlResult);
    if (outcome.block) return { status: 409, error: outcome.block, code: "AML_GATE_FAILED" };
    if (outcome.warning) {
      await recordAmlGateWarning(dealId, parties, amlResult, { targetStatus: newStatusRaw, actorId: actorUserId || null, actorName }).catch(() => {});
    }
  }
  return null;
}
