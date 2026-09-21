// Canonical group/entity view (Delivery 5, Task 6) — ONE deduplicated list
// of the legal entities around an account, merging the three places an
// entity can be represented:
//   1. child companies (crm_companies.parent_company_id),
//   2. crm_trading_entities rows,
//   3. the legacy crm_companies.trading_entities jsonb entries.
// The confirmed tree comes from resolveAccountView (cycle-safe, depth-capped)
// — never a second account-scope SQL. Merging is by lower(trim(name)) +
// Companies House number; every representation conflict is REPORTED on the
// entity, never auto-resolved (no crm_trading_entities rows are created
// from jsonb, no jsonb is edited).
//
// KYC state: crm_entity_kyc is canonical. For entityKind='company' with no
// row, the live crm_companies.kyc_* state is shown as THAT company's own
// status — it is never projected onto any other entity (an approved parent
// beside an unchecked child leaves the child unchecked).

import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { resolveAccountView, type AccountView, type Querier } from "./account-resolver";

// ─── Types ───────────────────────────────────────────────────────────────

export interface GroupEntityKyc {
  status: string;                          // pending | in_review | approved | rejected | expired
  approvedBy: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
  nextReviewAt: string | null;
  outstanding: { key: string; label: string }[];
  lastCheckedAt: string | null;
  source: "crm_entity_kyc" | "crm_companies";
}

export interface GroupEntity {
  entityKind: "company" | "trading_entity";
  entityId: string | null;                 // canonical row id — null for jsonb-only entries (no invented ids)
  name: string;
  companiesHouseNumber: string | null;
  relation: "self" | "parent" | "subsidiary" | "trading_entity";
  relationConfidence: string;
  evidence: string[];                      // every source that mentions this entity
  representationConflicts: string[];       // reported, never resolved by code
  kyc: GroupEntityKyc | null;
  groupRollupBlocks: boolean;              // true when the entity is not approved-and-current
}

export type EntityBucket = "current" | "expired" | "inReview" | "rejected" | "unchecked";

export interface GroupEntitySummary {
  total: number;
  current: number;
  inReview: number;
  unchecked: number;
  expired: number;
  rejected: number;
}

export interface AccountEntitiesReport {
  accountId: string;
  accountName: string;
  entities: GroupEntity[];
  summary: GroupEntitySummary;
}

// ─── Merge (pure — tested without a DB) ──────────────────────────────────

interface EntityMention {
  source: "company" | "crm_trading_entities" | "trading_entities_jsonb";
  name: string;
  companiesHouseNumber: string | null;
  entityId: string | null;
  relation: GroupEntity["relation"] | null;
  relationConfidence: string | null;
  evidence: string;
}

const normName = (s: string) => String(s || "").trim().toLowerCase();
const normCh = (s: string | null | undefined) => String(s || "").trim() || null;

// One GroupEntity per legal entity. Records merge on lower(trim(name)); a
// Companies House number is identity evidence — two mentions with the same
// name but DIFFERENT non-empty numbers still merge (same display name) but
// surface "CH number differs" as a conflict for a human, never a silent pick.
export function mergeEntityMentions(mentions: EntityMention[]): GroupEntity[] {
  const byName = new Map<string, EntityMention[]>();
  for (const m of mentions) {
    const key = normName(m.name);
    if (!key) continue;
    const list = byName.get(key) || [];
    list.push(m);
    byName.set(key, list);
  }

  const entities: GroupEntity[] = [];
  for (const list of byName.values()) {
    const company = list.find(m => m.source === "company");
    const tradingRow = list.find(m => m.source === "crm_trading_entities");
    const jsonb = list.filter(m => m.source === "trading_entities_jsonb");
    const canonical = company || tradingRow || list[0];

    const chNumbers = [...new Set(list.map(m => normCh(m.companiesHouseNumber)).filter(Boolean))] as string[];
    const conflicts: string[] = [];
    if (jsonb.length > 0 && !tradingRow) {
      conflicts.push("jsonb entry has no crm_trading_entities row");
    }
    if (chNumbers.length > 1) {
      conflicts.push(`Companies House number differs across representations (${chNumbers.join(" vs ")})`);
    }

    entities.push({
      entityKind: company ? "company" : "trading_entity",
      entityId: canonical.entityId,
      name: canonical.name,
      companiesHouseNumber: normCh(canonical.companiesHouseNumber) || chNumbers[0] || null,
      relation: canonical.relation || "trading_entity",
      relationConfidence: canonical.relationConfidence || "unresolved",
      evidence: [...new Set(list.map(m => m.evidence))],
      representationConflicts: conflicts,
      kyc: null,                            // layered on by getAccountEntities
      groupRollupBlocks: true,              // recomputed once kyc is known
    });
  }

  // Deterministic order: self, parent, subsidiaries, trading entities; then name.
  const rank = (r: GroupEntity["relation"]) => ({ self: 0, parent: 1, subsidiary: 2, trading_entity: 3 })[r];
  return entities.sort((a, b) => rank(a.relation) - rank(b.relation) || a.name.localeCompare(b.name));
}

// ─── Buckets (pure) ──────────────────────────────────────────────────────

export function entityBucket(kyc: GroupEntityKyc | null, now: Date): EntityBucket {
  if (!kyc) return "unchecked";
  const expires = kyc.expiresAt ? new Date(kyc.expiresAt).getTime() : null;
  if (kyc.status === "approved") {
    return expires == null || expires > now.getTime() ? "current" : "expired";
  }
  if (kyc.status === "expired") return "expired";
  if (kyc.status === "in_review") return "inReview";
  if (kyc.status === "rejected") return "rejected";
  return "unchecked";
}

export function summariseEntities(entities: Pick<GroupEntity, "kyc">[], now: Date): GroupEntitySummary {
  const summary: GroupEntitySummary = { total: entities.length, current: 0, inReview: 0, unchecked: 0, expired: 0, rejected: 0 };
  for (const e of entities) summary[entityBucket(e.kyc, now)]++;
  return summary;
}

// ─── Assembly ────────────────────────────────────────────────────────────

async function defaultPool(): Promise<Querier> {
  const { pool } = await import("./db");
  return pool;
}

function parseOutstanding(raw: any): { key: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(o => o && typeof o === "object")
    .map(o => ({ key: String(o.key ?? ""), label: String(o.label ?? o.key ?? "") }))
    .filter(o => o.key);
}

const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);

export async function getAccountEntities(
  companyId: string,
  opts: { scopeCompanyId?: string | null } = {},
  deps: { pool?: Querier; view?: AccountView; now?: () => Date } = {},
): Promise<AccountEntitiesReport> {
  const q = deps.pool ?? await defaultPool();
  const now = deps.now ? deps.now() : new Date();
  const view = deps.view ?? await resolveAccountView(companyId, { scopeCompanyId: opts.scopeCompanyId ?? null }, { pool: q });

  const companyIds = view.entities.filter(e => e.relation !== "trading_entity").map(e => e.companyId);
  const tradingIds = view.entities.filter(e => e.relation === "trading_entity").map(e => e.companyId);

  // Live company-side state: legacy trading_entities jsonb + this company's
  // OWN kyc_* (fallback display for company rows only — never projected).
  const { rows: companyRows } = companyIds.length
    ? await q.query(
        `SELECT id, trading_entities, kyc_status, kyc_checked_at, kyc_approved_by, kyc_expires_at
           FROM crm_companies WHERE id = ANY($1::text[])`,
        [companyIds],
      )
    : { rows: [] as any[] };
  const companyById = new Map(companyRows.map((r: any) => [r.id, r]));

  // Canonical per-entity KYC rows.
  const { rows: kycRows } = await q.query(
    `SELECT entity_kind, entity_id, kyc_status, checked_at, approved_by, approved_at,
            expires_at, next_review_at, outstanding, last_check_job_at
       FROM crm_entity_kyc
      WHERE (entity_kind = 'company' AND entity_id = ANY($1::text[]))
         OR (entity_kind = 'trading_entity' AND entity_id = ANY($2::text[]))`,
    [companyIds, tradingIds],
  ).catch((e: any) => (e?.code === "42P01" ? { rows: [] as any[] } : Promise.reject(e)));
  const kycByEntity = new Map(kycRows.map((r: any) => [`${r.entity_kind}|${r.entity_id}`, r]));

  // 1. Mentions from the resolver's confirmed entity set (self included).
  const mentions: EntityMention[] = view.entities.map(e => ({
    source: e.relation === "trading_entity" ? "crm_trading_entities" as const : "company" as const,
    name: e.name,
    companiesHouseNumber: e.companiesHouseNumber,
    entityId: e.companyId,
    relation: e.relation,
    relationConfidence: e.relationConfidence,
    evidence: e.evidence,
  }));

  // 2. Legacy trading_entities jsonb entries on every company in the set.
  for (const companyId2 of companyIds) {
    const raw = companyById.get(companyId2)?.trading_entities;
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      if (!entry || typeof entry !== "object" || !entry.name) continue;
      mentions.push({
        source: "trading_entities_jsonb",
        name: String(entry.name),
        companiesHouseNumber: normCh(entry.companies_house_number),
        entityId: null,                    // never invent an id for a jsonb entry
        relation: "trading_entity",
        relationConfidence: "unresolved",
        evidence: "crm_companies.trading_entities",
      });
    }
  }

  const entities = mergeEntityMentions(mentions);

  // 3. Layer KYC state on top.
  for (const entity of entities) {
    let kyc: GroupEntityKyc | null = null;
    const row = entity.entityId ? kycByEntity.get(`${entity.entityKind}|${entity.entityId}`) : null;
    if (row) {
      kyc = {
        status: row.kyc_status || "pending",
        approvedBy: row.approved_by ?? null,
        approvedAt: iso(row.approved_at),
        expiresAt: iso(row.expires_at),
        nextReviewAt: iso(row.next_review_at),
        outstanding: parseOutstanding(row.outstanding),
        lastCheckedAt: iso(row.checked_at || row.last_check_job_at),
        source: "crm_entity_kyc",
      };
    } else if (entity.entityKind === "company" && entity.entityId) {
      const live = companyById.get(entity.entityId);
      if (live?.kyc_status) {
        kyc = {
          status: live.kyc_status,
          approvedBy: live.kyc_approved_by ?? null,
          approvedAt: null,
          expiresAt: iso(live.kyc_expires_at),
          nextReviewAt: null,
          outstanding: [],
          lastCheckedAt: iso(live.kyc_checked_at),
          source: "crm_companies",
        };
      }
    }
    entity.kyc = kyc;
    entity.groupRollupBlocks = entityBucket(kyc, now) !== "current";
  }

  return {
    accountId: companyId,
    accountName: view.root.name,
    entities,
    summary: summariseEntities(entities, now),
  };
}

// ─── Route ───────────────────────────────────────────────────────────────

// Staff-only guard — same shape as reconciliationDeniedForScope.
export function groupEntitiesDeniedForScope(scopeCompanyId: string | null | undefined): boolean {
  return scopeCompanyId != null;
}

const router = Router();

router.get("/api/accounts/:id/entities", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    const scopeCompanyId = await resolveCompanyScope(req);
    if (groupEntitiesDeniedForScope(scopeCompanyId)) {
      return res.status(403).json({ error: "Group entity reports are staff-only" });
    }
    const report = await getAccountEntities(String(req.params.id));
    res.json(report);
  } catch (e: any) {
    if (e?.message === "company not found") return res.status(404).json({ error: "Company not found" });
    res.status(500).json({ error: e.message });
  }
});

export default router;
