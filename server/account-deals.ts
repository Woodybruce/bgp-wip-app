// Account deal list (Delivery 3, Task 1) — the paginated, filterable deal
// board for the landlord workspace.
//
// The account resolver (Delivery 2) is the single source for the account
// scope: the deal universe is `view.instructions ∪ view.relatedMarketActivity`
// — already deduped by deal id and already classified, so a tenant-rep
// letting at the account's centre arrives as related market activity and can
// never be labelled a client instruction here. This module only enriches
// those ids with display columns, applies the caller's filters, and slices
// the requested page; totals are computed over the filtered set BEFORE
// slicing, so they are independent of page size by construction.
//
// Permissions: scopeCompanyId (the already-resolved client scope from
// resolveCompanyScope — staff pass null) flows into the resolver untouched.
// Fees, BGP team names and task-based next actions are staff-only, the same
// rule as the brand-profile fee strip (server/brand-profile.ts) — for
// scoped viewers the `fee` key is omitted entirely and `feesVisible` is
// false. Completed deals are never deleted from the universe; they are a
// stage filter away.

import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { resolveAccountView, type Querier } from "./account-resolver";
import { isCompletedDealStatus } from "./brand-profile-deals";
import { legacyToCode } from "../shared/deal-status";

async function defaultPool(): Promise<Querier> {
  const { pool } = await import("./db");
  return pool;
}

export interface AccountDealNextAction {
  taskId: string;
  title: string;
  ownerName: string | null;
  dueDate: string | null;
}

export interface AccountDealListItem {
  dealId: string;
  name: string;
  bucket: "instruction" | "related";
  activityKind: "tenant_rep" | "investment" | "other" | null;
  partyEntityId: string | null;
  propertyId: string | null;
  propertyName: string | null;
  unitName: string | null;
  counterparty: string | null;        // the counterparty that is NOT the account
  service: string | null;             // crm_deals.deal_type
  status: string | null;
  stage: string | null;               // crm_deals.stage
  team: string[];                     // staff only; [] for scoped viewers
  lastActivityAt: string | null;      // crm_deals.updated_at
  instructedAt: string | null;
  targetDate: string | null;
  completedAt: string | null;
  fee?: number | null;                // staff only — key absent for scoped viewers
  nextAction: AccountDealNextAction | null;
}

export interface AccountDealFilters {
  bucket?: string;         // all | instruction | related
  propertyId?: string;
  entityId?: string;       // resolver partyEntityId
  service?: string;        // deal_type, case-insensitive exact
  stage?: string;          // d.stage OR canonical status code OR raw status, case-insensitive
  person?: string;         // BGP team member name, case-insensitive exact
  from?: string;           // ISO date, on updated_at (inclusive)
  to?: string;             // ISO date, on updated_at (inclusive)
}

export interface EnrichedDealRow {
  id: string;
  name: string;
  deal_type: string | null;
  status: string | null;
  stage: string | null;
  property_id: string | null;
  property_name: string | null;
  unit_name: string | null;
  tenancy_unit_name: string | null;
  landlord_id: string | null;
  tenant_id: string | null;
  vendor_id: string | null;
  purchaser_id: string | null;
  landlord_name: string | null;
  tenant_name: string | null;
  vendor_name: string | null;
  purchaser_name: string | null;
  team: string[] | null;
  internal_agent: string[] | null;
  updated_at: string | null;
  instructed_at: string | null;
  target_date: string | null;
  completed_at: string | null;
  fee: number | null;
}

// The counterparty that is NOT the account: the tenant on a landlord
// instruction, the landlord on a tenant instruction, the other side of an
// investment mandate. Related activity countersigns the tenant BGP acted
// for (the resolver's counterpartyName).
export function dealCounterparty(
  row: Pick<EnrichedDealRow, "landlord_id" | "tenant_id" | "vendor_id" | "purchaser_id" | "landlord_name" | "tenant_name" | "vendor_name" | "purchaser_name">,
  partyEntityId: string | null,
  relatedCounterpartyName: string | null,
): string | null {
  if (partyEntityId == null) return relatedCounterpartyName ?? null;
  if (partyEntityId === row.landlord_id) return row.tenant_name ?? row.vendor_name ?? row.purchaser_name ?? null;
  if (partyEntityId === row.tenant_id) return row.landlord_name ?? null;
  if (partyEntityId === row.vendor_id) return row.purchaser_name ?? null;
  if (partyEntityId === row.purchaser_id) return row.vendor_name ?? null;
  return relatedCounterpartyName ?? null;
}

// Pure filter step — every filter is AND-ed; unset filters pass. Stage
// matches the free-text stage column, the canonical status code, or the raw
// status, so both "sols"-era rows and post-migration "SOL" rows are found.
export function filterAccountDeals<T extends {
  bucket: string; partyEntityId: string | null; propertyId: string | null;
  service: string | null; status: string | null; stage: string | null;
  team: string[]; lastActivityAt: string | null;
}>(rows: T[], f: AccountDealFilters): T[] {
  const eq = (a: string | null | undefined, b: string | undefined) =>
    (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  return rows.filter(r => {
    if (f.bucket && f.bucket !== "all" && r.bucket !== f.bucket) return false;
    if (f.propertyId && r.propertyId !== f.propertyId) return false;
    if (f.entityId && r.partyEntityId !== f.entityId) return false;
    if (f.service && !eq(r.service, f.service)) return false;
    if (f.stage) {
      const code = legacyToCode(r.status);
      const wantCode = legacyToCode(f.stage);
      if (!eq(r.stage, f.stage) && !eq(r.status, f.stage) && !(code && wantCode && code === wantCode)) return false;
    }
    if (f.person && !r.team.some(t => eq(t, f.person))) return false;
    if (f.from || f.to) {
      const ts = r.lastActivityAt ? new Date(r.lastActivityAt).getTime() : NaN;
      if (!Number.isFinite(ts)) return false;
      if (f.from && ts < new Date(f.from).getTime()) return false;
      // `to` is a date, inclusive — cover the whole day.
      if (f.to && ts > new Date(`${f.to}T23:59:59.999Z`).getTime()) return false;
    }
    return true;
  });
}

export interface AccountDealListResponse {
  deals: AccountDealListItem[];
  total: number;           // over the filtered set, before slicing
  completedTotal: number;  // canonical COM/INV over the filtered set
  page: number;
  pageSize: number;
  feesVisible: boolean;
  entities: Array<{ companyId: string; name: string }>;
  properties: Array<{ propertyId: string; name: string }>;
  services: string[];      // distinct filter options over the unfiltered universe
  stages: string[];
  people: string[];
}

export async function listAccountDeals(
  companyId: string,
  opts: { scopeCompanyId?: string | null; page?: number; pageSize?: number; filters?: AccountDealFilters } = {},
  deps: { pool?: Querier } = {},
): Promise<AccountDealListResponse> {
  const q = deps.pool ?? await defaultPool();
  const scopeCompanyId = opts.scopeCompanyId ?? null;
  const staff = scopeCompanyId == null;
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 25)));
  const filters = opts.filters ?? {};

  const view = await resolveAccountView(companyId, { scopeCompanyId }, { pool: q });

  // Classification metadata keyed by deal id — the resolver's lists are the
  // only classification source; a deal shared by parent + subsidiary lands
  // in exactly one list entry, so the universe is deduped by construction.
  const meta = new Map<string, { bucket: "instruction" | "related"; activityKind: AccountDealListItem["activityKind"]; partyEntityId: string | null; counterpartyName: string | null }>();
  for (const i of view.instructions) {
    meta.set(i.dealId, { bucket: "instruction", activityKind: null, partyEntityId: i.partyEntityId, counterpartyName: null });
  }
  for (const r of view.relatedMarketActivity) {
    meta.set(r.dealId, { bucket: "related", activityKind: r.activityKind, partyEntityId: null, counterpartyName: r.counterpartyName });
  }
  const dealIds = [...meta.keys()];

  const base: AccountDealListResponse = {
    deals: [], total: 0, completedTotal: 0, page, pageSize, feesVisible: staff,
    entities: view.entities.map(e => ({ companyId: e.companyId, name: e.name })),
    properties: view.properties.map(p => ({ propertyId: p.propertyId, name: p.name })),
    services: [], stages: [], people: [],
  };
  if (dealIds.length === 0) return base;

  const { rows } = await q.query(
    `SELECT d.id, d.name, d.deal_type, d.status, d.stage, d.bgp_acting_for,
            d.property_id, d.unit_id, d.tenancy_unit_id,
            d.team, d.internal_agent,
            d.updated_at, d.instructed_at, d.target_date, d.completed_at, d.fee,
            d.landlord_id, d.tenant_id, d.vendor_id, d.purchaser_id,
            p.name AS property_name,
            pu.unit_name AS unit_name,
            COALESCE(tsu.unit_number, tsu.premises) AS tenancy_unit_name,
            lc.name AS landlord_name, tc.name AS tenant_name,
            vc.name AS vendor_name, pc.name AS purchaser_name
       FROM crm_deals d
       LEFT JOIN crm_properties p ON p.id = d.property_id
       LEFT JOIN property_units pu ON pu.id = d.unit_id
       LEFT JOIN tenancy_schedule_units tsu ON tsu.id = d.tenancy_unit_id
       LEFT JOIN crm_companies lc ON lc.id = d.landlord_id
       LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
       LEFT JOIN crm_companies vc ON vc.id = d.vendor_id
       LEFT JOIN crm_companies pc ON pc.id = d.purchaser_id
      WHERE d.id = ANY($1::text[])`,
    [dealIds]
  );

  // Next action per deal — the earliest-due open user_task linked to it.
  // Tasks are BGP-internal to-do lists: staff only.
  const nextByDeal = new Map<string, AccountDealNextAction>();
  if (staff) {
    const { rows: taskRows } = await q.query(
      `SELECT t.id, t.title, t.due_date, t.linked_deal_id,
              COALESCE(u.name, u.username, u.email) AS owner_name
         FROM user_tasks t
         LEFT JOIN users u ON u.id = t.user_id
        WHERE t.linked_deal_id = ANY($1::text[])
          AND t.status IS DISTINCT FROM 'done'
          AND t.completed_at IS NULL
        ORDER BY t.due_date ASC NULLS LAST, t.created_at ASC`,
      [dealIds]
    ).catch(() => ({ rows: [] as any[] }));
    for (const t of taskRows) {
      if (!t.linked_deal_id || nextByDeal.has(t.linked_deal_id)) continue;
      nextByDeal.set(t.linked_deal_id, {
        taskId: t.id,
        title: t.title,
        ownerName: t.owner_name ?? null,
        dueDate: t.due_date ?? null,
      });
    }
  }

  const universe: AccountDealListItem[] = (rows as EnrichedDealRow[]).map(row => {
    const m = meta.get(row.id)!;
    const team = staff
      ? [...new Set([...(row.team || []), ...(row.internal_agent || [])].map(s => String(s).trim()).filter(Boolean))]
      : [];
    const item: AccountDealListItem = {
      dealId: row.id,
      name: row.name,
      bucket: m.bucket,
      activityKind: m.activityKind,
      partyEntityId: m.partyEntityId,
      propertyId: row.property_id,
      propertyName: row.property_name ?? null,
      unitName: row.unit_name ?? row.tenancy_unit_name ?? null,
      counterparty: dealCounterparty(row, m.partyEntityId, m.counterpartyName),
      service: row.deal_type ?? null,
      status: row.status,
      stage: row.stage ?? null,
      team,
      lastActivityAt: row.updated_at ?? null,
      instructedAt: row.instructed_at ?? null,
      targetDate: row.target_date ?? null,
      completedAt: row.completed_at ?? null,
      nextAction: nextByDeal.get(row.id) ?? null,
    };
    if (staff) item.fee = row.fee ?? null;
    return item;
  });

  // Filter options come from the unfiltered universe so choosing a filter
  // never collapses the option lists.
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()).map(x => x.trim()))].sort((a, b) => a.localeCompare(b));
  base.services = uniq(universe.map(d => d.service));
  base.stages = uniq(universe.flatMap(d => [d.stage, legacyToCode(d.status)]));
  base.people = uniq(universe.flatMap(d => d.team));

  const filtered = filterAccountDeals(universe, filters);
  filtered.sort((a, b) => {
    const ta = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
    const tb = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
    return tb - ta || a.name.localeCompare(b.name) || a.dealId.localeCompare(b.dealId);
  });

  base.total = filtered.length;
  base.completedTotal = filtered.filter(d => isCompletedDealStatus(d.status) || d.completedAt != null).length;
  base.deals = filtered.slice((page - 1) * pageSize, page * pageSize);
  return base;
}

// ─── Route ───────────────────────────────────────────────────────────────
// GET /api/accounts/:id/deals — paginated, filterable account deal list.
// Client scope flows into the resolver; fees/team/tasks are staff-only.

const router = Router();

router.get("/api/accounts/:id/deals", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    const scopeCompanyId = await resolveCompanyScope(req);
    const companyId = String(req.params.id);
    const q = req.query;
    const filters: AccountDealFilters = {
      bucket: q.bucket ? String(q.bucket) : undefined,
      propertyId: q.propertyId ? String(q.propertyId) : undefined,
      entityId: q.entityId ? String(q.entityId) : undefined,
      service: q.service ? String(q.service) : undefined,
      stage: q.stage ? String(q.stage) : undefined,
      person: q.person ? String(q.person) : undefined,
      from: q.from ? String(q.from) : undefined,
      to: q.to ? String(q.to) : undefined,
    };
    const result = await listAccountDeals(companyId, {
      scopeCompanyId,
      page: q.page ? Number(q.page) : 1,
      pageSize: q.pageSize ? Number(q.pageSize) : 25,
      filters,
    });
    res.json(result);
  } catch (e: any) {
    if (e?.message === "company not found") return res.status(404).json({ error: "Company not found" });
    res.status(500).json({ error: e.message });
  }
});

export default router;
