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

import { requireMlro } from "./aml-authority";
import { Router, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "./auth";
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
  tradingAs?: string;                      // brand name when the row is the brand's own legal entity
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
  // A trading-entity row carrying the SAME Companies House number as a CRM
  // company is that company's legal entity, not a second entity (Honest
  // Greens = HGUK RESTAURANTS LIMITED, CH 14583139, showed twice — once
  // "no CH no."). Fold it into the company row under its legal name.
  const companyKeyByCh = new Map<string, string>();
  for (const m of mentions) {
    const ch = normCh(m.companiesHouseNumber);
    if (m.source === "company" && ch && !companyKeyByCh.has(ch)) companyKeyByCh.set(ch, normName(m.name));
  }
  const companyNameKeys = new Set(mentions.filter(m => m.source === "company").map(m => normName(m.name)));
  const legalNameByCompanyKey = new Map<string, string>();
  const keyOf = (m: EntityMention) => {
    const ch = normCh(m.companiesHouseNumber);
    const companyKey = ch ? companyKeyByCh.get(ch) : undefined;
    if (m.source !== "company" && companyKey && !companyNameKeys.has(normName(m.name))) {
      if (!legalNameByCompanyKey.has(companyKey)) legalNameByCompanyKey.set(companyKey, m.name);
      return companyKey;
    }
    return normName(m.name);
  };
  const byName = new Map<string, EntityMention[]>();
  for (const m of mentions) {
    const key = keyOf(m);
    if (!key) continue;
    const list = byName.get(key) || [];
    list.push(m);
    byName.set(key, list);
  }

  const entities: GroupEntity[] = [];
  for (const [key, list] of byName.entries()) {
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

    const legalName = company ? legalNameByCompanyKey.get(key) : undefined;
    entities.push({
      entityKind: company ? "company" : "trading_entity",
      entityId: canonical.entityId,
      name: legalName || canonical.name,
      ...(legalName && legalName.toLowerCase() !== canonical.name.toLowerCase() ? { tradingAs: canonical.name } : {}),
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

// ─── Per-entity KYC writes (Task 7) ──────────────────────────────────────
//
// Canonical state is crm_entity_kyc, keyed (entity_kind, entity_id). Every
// write touches EXACTLY ONE entity's row — an approve on a child never
// modifies the parent, and nothing here calls recomputeDealKycApproved
// (deal-level effects are the Task-9 shadow report's evidence, not a side
// effect of entity review). Approver identity is the session user's NAME,
// the same representation rule as aml-compliance.ts (:829-832).

export type EntityKind = "company" | "trading_entity";

export function parseEntityKind(raw: string): EntityKind | null {
  return raw === "company" || raw === "trading_entity" ? raw : null;
}

async function loadEntityRow(q: Querier, kind: EntityKind, id: string): Promise<{ id: string; name: string } | null> {
  const table = kind === "company" ? "crm_companies" : "crm_trading_entities";
  const { rows } = await q.query(`SELECT id, name FROM ${table} WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Regulator-facing trail on the shared kyc_audit_log — the entity columns
// (migration 0046) record entity-level actions without a parallel log.
async function entityAudit(
  q: Querier,
  kind: EntityKind,
  id: string,
  action: string,
  performedBy: string | null,
  notes: string | null,
): Promise<void> {
  await q.query(
    `INSERT INTO kyc_audit_log (company_id, action, performed_by, notes, entity_kind, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [kind === "company" ? id : null, action, performedBy, notes, kind, id],
  ).catch((e: any) => console.warn("[entity-kyc-audit] insert failed:", e?.message));
}

async function recheckIntervalDays(q: Querier): Promise<number> {
  try {
    const s = await q.query("SELECT recheck_interval_days FROM aml_settings ORDER BY id LIMIT 1");
    const configured = parseInt(s.rows[0]?.recheck_interval_days, 10);
    if (Number.isFinite(configured) && configured > 0) return configured;
  } catch {}
  return 182;
}

// MLRO checklist-style update: the entity moves to in_review with the
// outstanding-items list and evidence notes merged into any existing
// evidence. Creates the crm_entity_kyc row on first touch.
export async function putEntityKyc(
  kind: EntityKind,
  id: string,
  input: { outstanding?: { key: string; label: string }[]; evidenceNotes?: string | null },
  actorName: string | null,
  deps: { pool?: Querier } = {},
): Promise<{ status: number; body: any }> {
  const q = deps.pool ?? await defaultPool();
  const entity = await loadEntityRow(q, kind, id);
  if (!entity) return { status: 404, body: { error: "Entity not found" } };

  const outstanding = Array.isArray(input.outstanding) ? input.outstanding : [];
  const evidence = input.evidenceNotes ? { notes: String(input.evidenceNotes) } : {};
  const { rows } = await q.query(
    `INSERT INTO crm_entity_kyc (entity_kind, entity_id, kyc_status, outstanding, evidence, updated_at)
     VALUES ($1, $2, 'in_review', $3::jsonb, $4::jsonb, now())
     ON CONFLICT (entity_kind, entity_id) DO UPDATE SET
       kyc_status = 'in_review',
       outstanding = $3::jsonb,
       evidence = COALESCE(crm_entity_kyc.evidence, '{}'::jsonb) || $4::jsonb,
       updated_at = now()
     RETURNING *`,
    [kind, id, JSON.stringify(outstanding), JSON.stringify(evidence)],
  );
  await entityAudit(q, kind, id, "entity_kyc_updated", actorName,
    `${outstanding.length} outstanding item${outstanding.length === 1 ? "" : "s"}`);
  return { status: 200, body: rows[0] };
}

export async function approveEntityKyc(
  kind: EntityKind,
  id: string,
  actorName: string | null,
  deps: { pool?: Querier } = {},
): Promise<{ status: number; body: any }> {
  const q = deps.pool ?? await defaultPool();
  const entity = await loadEntityRow(q, kind, id);
  if (!entity) return { status: 404, body: { error: "Entity not found" } };

  // MLR 2017 Reg 28: the cadence is the MLRO's configurable
  // recheck_interval_days (default 182 ≈ the historic 6-month policy).
  const intervalDays = await recheckIntervalDays(q);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + intervalDays);

  const { rows } = await q.query(
    `INSERT INTO crm_entity_kyc (entity_kind, entity_id, kyc_status, checked_at, approved_by, approved_at,
                                 expires_at, next_review_at, outstanding, updated_at)
     VALUES ($1, $2, 'approved', now(), $3, now(), $4, $4, '[]'::jsonb, now())
     ON CONFLICT (entity_kind, entity_id) DO UPDATE SET
       kyc_status = 'approved', checked_at = now(), approved_by = $3, approved_at = now(),
       expires_at = $4, next_review_at = $4, outstanding = '[]'::jsonb, updated_at = now()
     RETURNING *`,
    [kind, id, actorName, expiresAt],
  );
  await entityAudit(q, kind, id, "entity_kyc_approved", actorName,
    `Re-check due ${expiresAt.toISOString().slice(0, 10)} (${intervalDays}-day cycle)`);
  try {
    await q.query(
      `INSERT INTO aml_recheck_reminders (company_id, entity_name, recheck_type, due_date, notes)
       VALUES ($1, $2, 'periodic_cdd', $3, $4)`,
      [id, entity.name, expiresAt, `Auto-generated on entity KYC approval (${kind}) — ${intervalDays}-day re-check`],
    );
  } catch (e: any) {
    console.warn("[entity-kyc-approve] reminder insert failed:", e?.message);
  }
  return { status: 200, body: rows[0] };
}

export async function rejectEntityKyc(
  kind: EntityKind,
  id: string,
  reason: string | null,
  actorName: string | null,
  deps: { pool?: Querier } = {},
): Promise<{ status: number; body: any }> {
  const q = deps.pool ?? await defaultPool();
  const entity = await loadEntityRow(q, kind, id);
  if (!entity) return { status: 404, body: { error: "Entity not found" } };

  const { rows } = await q.query(
    `INSERT INTO crm_entity_kyc (entity_kind, entity_id, kyc_status, checked_at, approved_by, updated_at)
     VALUES ($1, $2, 'rejected', now(), $3, now())
     ON CONFLICT (entity_kind, entity_id) DO UPDATE SET
       kyc_status = 'rejected', checked_at = now(), approved_by = $3, updated_at = now()
     RETURNING *`,
    [kind, id, actorName],
  );
  await entityAudit(q, kind, id, "entity_kyc_rejected", actorName, reason);
  return { status: 200, body: rows[0] };
}

// Session user's NAME (the approve/reject representation rule), resolved
// the same way aml-compliance.ts does it.
async function sessionActor(req: Request, q: Querier): Promise<{ id: string | null; name: string | null }> {
  const id = (req.session as any)?.userId || (req as any).tokenUserId || null;
  if (!id) return { id: null, name: null };
  try {
    const r = await q.query("SELECT name FROM users WHERE id = $1", [id]);
    return { id, name: r.rows[0]?.name || null };
  } catch {
    return { id, name: null };
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────

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

// Writes are requireAdmin, matching the company-level approve/reject routes
// (server/aml-compliance.ts:784,827).
router.put("/api/entities/:kind/:id/kyc", requireAdmin, async (req: Request, res: Response) => {
  const kind = parseEntityKind(String(req.params.kind));
  if (!kind) return res.status(400).json({ error: "kind must be company | trading_entity" });
  try {
    const q = await defaultPool();
    const actor = await sessionActor(req, q);
    const { status, body } = await putEntityKyc(kind, String(req.params.id), {
      outstanding: req.body?.outstanding,
      evidenceNotes: req.body?.evidenceNotes ?? req.body?.notes ?? null,
    }, actor.name || actor.id, { pool: q });
    res.status(status).json(body);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/entities/:kind/:id/kyc/approve", requireMlro, async (req: Request, res: Response) => {
  const kind = parseEntityKind(String(req.params.kind));
  if (!kind) return res.status(400).json({ error: "kind must be company | trading_entity" });
  try {
    const q = await defaultPool();
    const actor = await sessionActor(req, q);
    const approverName: string | null = req.body?.approverName || actor.name || actor.id;
    const { status, body } = await approveEntityKyc(kind, String(req.params.id), approverName, { pool: q });
    res.status(status).json(body);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/entities/:kind/:id/kyc/reject", requireMlro, async (req: Request, res: Response) => {
  const kind = parseEntityKind(String(req.params.kind));
  if (!kind) return res.status(400).json({ error: "kind must be company | trading_entity" });
  try {
    const q = await defaultPool();
    const actor = await sessionActor(req, q);
    const { status, body } = await rejectEntityKyc(kind, String(req.params.id), req.body?.reason || null, actor.name || actor.id, { pool: q });
    res.status(status).json(body);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
