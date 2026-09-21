// Shadow deal gate (Delivery 5, Task 9) — computes BOTH AML gate outcomes
// for a deal WITHOUT changing any live behaviour:
//
//   current  — checkCounterpartyAml (server/deal-gates.ts), brand-level,
//              imported and used byte-identical. Nothing here touches its
//              call sites; entity gating is shadow-only.
//   proposed — entity-aware: each counterparty role resolves through
//              crm_deal_entities where a contracting entity is linked
//              (falling back to the brand FK), and the entity is checked
//              against crm_entity_kyc first / the company's own
//              crm_companies.kyc_* for entity_kind='company' — the same
//              read rule as the group view, never projected across entities.
//
// An empty link set means proposed == current, stated explicitly in the
// row. The shadow report exists BEFORE any deal-gate logic change; flipping
// the live gate is a post-Delivery-5 decision with this report as evidence.

import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "./auth";
import { pool } from "./db";
import { checkCounterpartyAml, type AmlGateInput, type AmlGateResult, type AmlNotReady } from "./deal-gates";
import { isActiveDealStatus } from "./brand-profile-deals";
import type { Querier } from "./account-resolver";

export type ShadowChange = "newly_blocked" | "newly_passing" | "same";

export interface ShadowGateOutcome {
  pass: boolean;
  notReady: AmlNotReady[];
}

export interface ShadowGateRow {
  dealId: string;
  name: string | null;
  current: ShadowGateOutcome;
  proposed: ShadowGateOutcome;
  changed: ShadowChange;
  reasons: string[];
}

const ROLES = ["landlord", "tenant", "vendor", "purchaser"] as const;
type Role = typeof ROLES[number];

function toOutcome(result: AmlGateResult): ShadowGateOutcome {
  return { pass: result.hasCounterparties && result.notReady.length === 0, notReady: result.notReady };
}

interface EntityLink { role: string; entity_kind: "company" | "trading_entity"; entity_id: string }

// approved-and-current under the entity read rule (shared vocab with the
// group view): status 'approved' AND (no expiry OR expiry in the future).
function entityApproved(status: string | null, expiresAt: any, now: Date): { approved: boolean; reason: string | null } {
  if (status !== "approved") return { approved: false, reason: status || "no checks run" };
  if (expiresAt && new Date(expiresAt) < now) return { approved: false, reason: "expired" };
  return { approved: true, reason: null };
}

// The proposed (entity-aware) outcome, computed from the same deal input
// plus the crm_deal_entities links. Exported for tests.
export async function computeProposedOutcome(
  deal: AmlGateInput & { id?: string },
  links: EntityLink[],
  deps: { pool: Querier; now?: Date },
): Promise<{ outcome: ShadowGateOutcome; reasons: string[] }> {
  const q = deps.pool;
  const now = deps.now ?? new Date();
  const reasons: string[] = [];

  const companyIds = [...new Set(links.filter(l => l.entity_kind === "company").map(l => l.entity_id))];
  const tradingIds = [...new Set(links.filter(l => l.entity_kind === "trading_entity").map(l => l.entity_id))];

  const { rows: kycRows } = companyIds.length + tradingIds.length
    ? await q.query(
        `SELECT entity_kind, entity_id, kyc_status, expires_at FROM crm_entity_kyc
          WHERE (entity_kind = 'company' AND entity_id = ANY($1::text[]))
             OR (entity_kind = 'trading_entity' AND entity_id = ANY($2::text[]))`,
        [companyIds, tradingIds],
      )
    : { rows: [] as any[] };
  const kycByEntity = new Map(kycRows.map((r: any) => [`${r.entity_kind}|${r.entity_id}`, r]));

  const { rows: companyRows } = companyIds.length
    ? await q.query(`SELECT id, name, kyc_status, kyc_expires_at FROM crm_companies WHERE id = ANY($1::text[])`, [companyIds])
    : { rows: [] as any[] };
  const companyById = new Map(companyRows.map((r: any) => [r.id, r]));

  const { rows: tradingRows } = tradingIds.length
    ? await q.query(`SELECT id, name FROM crm_trading_entities WHERE id = ANY($1::text[])`, [tradingIds])
    : { rows: [] as any[] };
  const tradingById = new Map(tradingRows.map((r: any) => [r.id, r]));

  // Brand-level counterparties for the roles without a link.
  const brandIds = ROLES.map(r => (deal as any)[`${r}Id`]).filter(Boolean);
  const { rows: brandRows } = brandIds.length
    ? await q.query(`SELECT id, name, kyc_status, kyc_expires_at FROM crm_companies WHERE id = ANY($1::varchar[])`, [[...new Set(brandIds)]])
    : { rows: [] as any[] };
  const brandById = new Map(brandRows.map((r: any) => [r.id, r]));

  const notReady: AmlNotReady[] = [];
  let hasCounterparties = false;

  for (const role of ROLES) {
    const link = links.find(l => l.role === role);
    const brandId = (deal as any)[`${role}Id`] || null;
    if (!link && !brandId) continue;
    hasCounterparties = true;

    if (link) {
      const kycRow = kycByEntity.get(`${link.entity_kind}|${link.entity_id}`);
      let name: string;
      let status: string | null;
      let expiresAt: any;
      if (link.entity_kind === "company") {
        const company = companyById.get(link.entity_id);
        name = company?.name || `(unknown ${role} entity)`;
        // crm_entity_kyc is canonical; the company's OWN live kyc_* is the
        // fallback for company rows only (never projected across entities).
        status = kycRow ? kycRow.kyc_status : company?.kyc_status ?? null;
        expiresAt = kycRow ? kycRow.expires_at : company?.kyc_expires_at ?? null;
      } else {
        name = tradingById.get(link.entity_id)?.name || `(unknown ${role} entity)`;
        status = kycRow?.kyc_status ?? null;
        expiresAt = kycRow?.expires_at ?? null;
      }
      const verdict = entityApproved(status, expiresAt, now);
      if (!verdict.approved) {
        notReady.push({ name, reason: verdict.reason!, role });
        reasons.push(`${role}: linked entity "${name}" is ${verdict.reason} — the entity-aware gate would block here`);
      } else {
        reasons.push(`${role}: linked entity "${name}" is approved`);
      }
    } else {
      const brand = brandById.get(brandId);
      const verdict = entityApproved(brand?.kyc_status ?? null, brand?.kyc_expires_at ?? null, now);
      if (!verdict.approved) {
        notReady.push({ name: brand?.name || `(unknown ${role})`, reason: verdict.reason!, role });
      }
    }
  }

  return { outcome: { pass: hasCounterparties && notReady.length === 0, notReady }, reasons };
}

export async function checkCounterpartyAmlShadow(
  dealId: string,
  deps: { pool?: Querier; now?: Date; currentGate?: (input: AmlGateInput) => Promise<AmlGateResult> } = {},
): Promise<ShadowGateRow> {
  const q = deps.pool ?? pool;
  const { rows: dealRows } = await q.query(
    `SELECT id, name, landlord_id, tenant_id, vendor_id, purchaser_id FROM crm_deals WHERE id = $1`,
    [dealId],
  );
  const deal = dealRows[0];
  if (!deal) throw new Error("deal not found");

  const input: AmlGateInput = {
    landlordId: deal.landlord_id, tenantId: deal.tenant_id,
    vendorId: deal.vendor_id, purchaserId: deal.purchaser_id,
  };
  const current = toOutcome(await (deps.currentGate ?? checkCounterpartyAml)(input));

  const { rows: links } = await q.query(
    `SELECT role, entity_kind, entity_id FROM crm_deal_entities WHERE deal_id = $1`,
    [dealId],
  ).catch((e: any) => (e?.code === "42P01" ? { rows: [] as any[] } : Promise.reject(e)));

  const { outcome: proposed, reasons } = await computeProposedOutcome(
    { id: deal.id, ...input }, links as EntityLink[], { pool: q, now: deps.now },
  );
  if ((links as any[]).length === 0) {
    reasons.push("No crm_deal_entities links — proposed equals current");
  }

  const changed: ShadowChange =
    current.pass && !proposed.pass ? "newly_blocked"
    : !current.pass && proposed.pass ? "newly_passing"
    : "same";

  return { dealId: deal.id, name: deal.name ?? null, current, proposed, changed, reasons };
}

// Changed rows first (newly_blocked ahead of newly_passing), then by name.
export function sortShadowRows<T extends { changed: ShadowChange; name: string | null }>(rows: T[]): T[] {
  const rank = (c: ShadowChange) => (c === "newly_blocked" ? 0 : c === "newly_passing" ? 1 : 2);
  return [...rows].sort((a, b) => rank(a.changed) - rank(b.changed) || (a.name || "").localeCompare(b.name || ""));
}

export function summariseShadowRows(rows: { changed: ShadowChange }[]) {
  return {
    total: rows.length,
    newlyBlocked: rows.filter(r => r.changed === "newly_blocked").length,
    newlyPassing: rows.filter(r => r.changed === "newly_passing").length,
    same: rows.filter(r => r.changed === "same").length,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────

const router = Router();

// Admin: evaluate every active deal and persist the snapshot.
router.post("/api/aml/shadow-gate-report/run", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { rows: deals } = await pool.query(`SELECT id, name, status FROM crm_deals`);
    const active = deals.filter((d: any) => isActiveDealStatus(d.status));

    const rows: ShadowGateRow[] = [];
    for (const deal of active) {
      rows.push(await checkCounterpartyAmlShadow(deal.id));
    }

    const generatedBy = (req.session as any)?.userId || (req as any).tokenUserId || null;
    const { rows: inserted } = await pool.query(
      `INSERT INTO aml_shadow_gate_runs (generated_by, rows) VALUES ($1, $2::jsonb) RETURNING id, generated_at`,
      [generatedBy, JSON.stringify(rows)],
    );
    res.json({ runId: inserted[0].id, generatedAt: inserted[0].generated_at, summary: summariseShadowRows(rows) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Staff: the latest snapshot, changed rows first.
router.get("/api/aml/shadow-gate-report", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    const scopeCompanyId = await resolveCompanyScope(req);
    if (scopeCompanyId != null) {
      return res.status(403).json({ error: "The shadow gate report is staff-only" });
    }
    const { rows } = await pool.query(
      `SELECT id, generated_at, generated_by, rows FROM aml_shadow_gate_runs ORDER BY generated_at DESC LIMIT 1`,
    );
    if (!rows[0]) return res.status(404).json({ error: "No shadow gate report has been generated yet" });
    const reportRows = sortShadowRows((rows[0].rows || []) as ShadowGateRow[]);
    res.json({
      runId: rows[0].id,
      generatedAt: rows[0].generated_at,
      generatedBy: rows[0].generated_by,
      summary: summariseShadowRows(reportRows),
      rows: reportRows,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
