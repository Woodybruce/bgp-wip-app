// Account resolver (Delivery 2) — read-only assembler for the account view.
//
// Given a company, gathers the confirmed entity tree (parent/subsidiary via
// crm_companies.parent_company_id + crm_trading_entities), the portfolio
// (landlord_id FK ∪ crm_company_properties ∪ freeholder/long-leaseholder),
// BGP instructions vs related market activity, contacts and the BGP account
// team. Ownership, BGP representation and permission scope stay distinct:
// a tenant-rep deal at the account's centre is related market activity, NOT
// an instruction; subsidiary work rolls up only through confirmed links.
//
// The resolver only SELECTs. scopeCompanyId (the already-resolved client
// scope from resolveCompanyScope — staff pass null) filters output exactly
// as the brand-profile queries do; it never adds rows, and nothing here is
// consulted by isPropertyInScope / isDealInScope.
//
// The Task-1 columns (crm_properties.country, crm_company_properties
// relationship_*) are additive migrations that may not be applied yet, so
// queries that touch them fall back to a legacy shape on undefined_column.

import { isCompletedDealStatus } from "./brand-profile-deals";

export type RelationshipRole = "owner" | "jv" | "manager" | "unknown";
export type RelationshipConfidence = "confirmed" | "inferred" | "unresolved";

export interface AccountEntity {
  companyId: string;
  name: string;
  companyType: string | null;
  companiesHouseNumber: string | null;
  relation: "self" | "parent" | "subsidiary" | "trading_entity";
  relationConfidence: RelationshipConfidence; // parent_company_id link => confirmed; name-only => unresolved
  evidence: string;                           // "crm_companies.parent_company_id" | "crm_trading_entities"
}

export interface AccountProperty {
  propertyId: string;
  name: string;
  postcode: string | null;
  country: string | null;                     // ISO-2, from crm_properties.country (Task 1)
  relationshipRole: RelationshipRole;         // from crm_company_properties.relationship_role; landlord_id FK => owner
  ownershipStakePct: number | null;
  owningEntityId: string | null;              // which AccountEntity the link hangs off
  confidence: RelationshipConfidence;
  sources: string[];                          // ["landlord_id","company_property_link","freeholder_id"]
  unitCount: number;
}

export interface AccountInstruction {         // BGP is instructed BY the account
  dealId: string; name: string; status: string | null; propertyId: string | null;
  partyEntityId: string;                      // which account entity is the counterparty
  instructedAt: string | null;
}

export interface RelatedMarketActivity {      // BGP activity AT the account's property, not FOR the account
  dealId: string; name: string; status: string | null; propertyId: string;
  activityKind: "tenant_rep" | "investment" | "other";
  counterpartyName: string | null;            // the tenant we acted for, etc.
}

export interface AccountContact {
  contactId: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  avatarUrl: string | null;
  employerCompanyId: string | null;
  via: string[];                              // ["employer","property","property_client"]
  interactionCount: number;
  lastInteractionAt: string | null;
}

export interface AccountTeamMember {
  userId: string;
  name: string | null;
  email: string | null;
  role: string | null;
  teamGroup: string | null;
  sources: string[];                          // ["curated","property_agent","deal_contributor"]
}

export interface AccountView {
  root: AccountEntity;
  entities: AccountEntity[];                  // cycle-safe confirmed tree
  properties: AccountProperty[];              // portfolio destinations
  instructions: AccountInstruction[];
  relatedMarketActivity: RelatedMarketActivity[];
  contacts: AccountContact[];                 // employer ∪ property/account relationships, deduped by contact id
  team: AccountTeamMember[];                  // curated ∪ property agents ∪ evidenced deal contributors
  totals: { deals: number; completedDeals: number };
}

// Minimal queryable so tests can inject a spy pool without DATABASE_URL.
export type Querier = { query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number | null }> };

async function defaultPool(): Promise<Querier> {
  const { pool } = await import("./db");
  return pool;
}

// The Task-1 columns may not exist until the migrations are applied; on
// undefined_column retry with the legacy column set so the read path keeps
// working either way (new fields come back NULL-equivalent).
async function queryWithFallback(q: Querier, sql: string, legacySql: string, params: any[]) {
  try {
    return await q.query(sql, params);
  } catch (e: any) {
    if (e?.code === "42703") return q.query(legacySql, params);
    throw e;
  }
}

// ─── Pure assembly (unit-tested without a database) ──────────────────────

export interface CompanyGraphRow {
  id: string;
  name: string;
  company_type: string | null;
  companies_house_number: string | null;
  parent_company_id: string | null;
  merged_into_id: string | null;
}

export interface TradingEntityGraphRow {
  id: string;
  name: string;
  companies_house_number: string | null;
  parent_company_id: string;
}

const TREE_DEPTH_CAP = 8;

// Walk the confirmed entity tree: up from the root to the top ancestor via
// parent_company_id (following merged_into_id at most once, only to read
// the surviving row's parent), then descendants breadth-first, then trading
// entities as leaves. A parent loop (A→B→A) terminates on the second visit;
// the row that would close the loop stays in the output flagged unresolved
// with evidence "cycle detected" so bad data is visible rather than silently
// dropped or infinitely recursed.
export function walkEntityTree(
  rows: CompanyGraphRow[],
  tradingRows: TradingEntityGraphRow[],
  rootId: string,
): AccountEntity[] {
  const byId = new Map(rows.map(r => [r.id, r]));
  const root = byId.get(rootId);
  if (!root) return [];

  const out: AccountEntity[] = [];
  const outById = new Map<string, AccountEntity>();
  const push = (row: { id: string; name: string; company_type?: string | null; companies_house_number?: string | null },
    relation: AccountEntity["relation"], confidence: RelationshipConfidence, evidence: string) => {
    const entity: AccountEntity = {
      companyId: row.id,
      name: row.name,
      companyType: row.company_type ?? null,
      companiesHouseNumber: row.companies_house_number ?? null,
      relation,
      relationConfidence: confidence,
      evidence,
    };
    out.push(entity);
    outById.set(row.id, entity);
    return entity;
  };
  const flagCycle = (id: string) => {
    const closing = outById.get(id);
    if (closing) {
      closing.relationConfidence = "unresolved";
      closing.evidence = "cycle detected";
    }
  };

  const visited = new Set<string>([rootId]);
  push(root, "self", "confirmed", "crm_companies.id");

  // Up-walk to the top ancestor.
  let cur = root;
  let mergedFollowed = false;
  for (let depth = 0; depth < TREE_DEPTH_CAP; depth++) {
    let nextId = cur.parent_company_id;
    if (!nextId && cur.id === rootId && cur.merged_into_id && !mergedFollowed) {
      mergedFollowed = true;
      nextId = byId.get(cur.merged_into_id)?.parent_company_id ?? null;
    }
    if (!nextId) break;
    if (visited.has(nextId)) { flagCycle(nextId); break; }
    const next = byId.get(nextId);
    if (!next) break;
    visited.add(nextId);
    push(next, "parent", "confirmed", "crm_companies.parent_company_id");
    cur = next;
  }

  // Descendants breadth-first. The queue starts from every visited node, not
  // just the top ancestor — mid-chain ancestors (like the root) have children
  // of their own that still need collecting. Nodes visited by the up-walk are
  // skipped silently (their parent link was already confirmed there); a
  // revisit of a BFS-discovered node is a descendant-side cycle.
  const upChain = new Set(visited);
  const queue: Array<{ id: string; depth: number }> = [...visited].map(id => ({ id, depth: 0 }));
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= TREE_DEPTH_CAP) continue;
    for (const row of rows) {
      if (row.parent_company_id !== id) continue;
      if (visited.has(row.id)) {
        if (!upChain.has(row.id)) flagCycle(row.id);
        continue;
      }
      visited.add(row.id);
      push(row, "subsidiary", "confirmed", "crm_companies.parent_company_id");
      queue.push({ id: row.id, depth: depth + 1 });
    }
  }

  // Trading entities hang off every company in the confirmed set.
  const companyIds = new Set(out.map(e => e.companyId));
  for (const t of tradingRows) {
    if (!companyIds.has(t.parent_company_id) || visited.has(t.id)) continue;
    visited.add(t.id);
    push(t, "trading_entity", "confirmed", "crm_trading_entities");
  }

  return out;
}

export interface PropertyOwnershipRow {
  id: string;
  name: string;
  postcode: string | null;
  country?: string | null;
  landlord_id: string | null;
  freeholder_id: string | null;
  long_leaseholder_id: string | null;
  unit_count: number | null;
}

export interface PropertyLinkRow {
  property_id: string;
  company_id: string;
  relationship_role?: string | null;
  ownership_stake_pct?: number | null;
  relationship_confidence?: string | null;
  relationship_source?: string | null;
  name: string;
  postcode: string | null;
  country?: string | null;
  unit_count: number | null;
}

const ROLE_RANK: RelationshipRole[] = ["owner", "jv", "manager", "unknown"];
const CONFIDENCE_RANK: RelationshipConfidence[] = ["confirmed", "inferred", "unresolved"];

function bestBy<T extends string>(values: T[], rank: T[]): T {
  return rank.find(r => values.includes(r)) ?? rank[rank.length - 1];
}

// Merge the three ownership evidences per property, deduping by propertyId
// and merging sources. NULL link role renders as "unknown" (never assumed
// "owner"); landlord_id reached via the tree is "inferred" unless it hangs
// off the root itself.
export function assembleProperties(
  ownershipRows: PropertyOwnershipRow[],
  linkRows: PropertyLinkRow[],
  rootId: string,
): AccountProperty[] {
  const byProperty = new Map<string, AccountProperty & { _roles: RelationshipRole[]; _confidences: RelationshipConfidence[] }>();
  const ensure = (id: string, seed: { name: string; postcode: string | null; country?: string | null; unit_count: number | null }) => {
    if (!byProperty.has(id)) {
      byProperty.set(id, {
        propertyId: id,
        name: seed.name,
        postcode: seed.postcode ?? null,
        country: seed.country ?? null,
        relationshipRole: "unknown",
        ownershipStakePct: null,
        owningEntityId: null,
        confidence: "unresolved",
        sources: [],
        unitCount: Number(seed.unit_count ?? 0),
        _roles: [],
        _confidences: [],
      });
    }
    return byProperty.get(id)!;
  };

  for (const row of ownershipRows) {
    const p = ensure(row.id, row);
    const evidences: Array<[entityId: string | null, source: string, confidence: RelationshipConfidence]> = [
      [row.landlord_id, "landlord_id", row.landlord_id === rootId ? "confirmed" : "inferred"],
      [row.freeholder_id, "freeholder_id", "confirmed"],
      [row.long_leaseholder_id, "long_leaseholder_id", "confirmed"],
    ];
    for (const [entityId, source, confidence] of evidences) {
      if (!entityId) continue;
      if (!p.sources.includes(source)) p.sources.push(source);
      p._roles.push("owner");
      p._confidences.push(confidence);
      if (!p.owningEntityId || confidence === "confirmed") p.owningEntityId = entityId;
    }
  }

  for (const row of linkRows) {
    const p = ensure(row.property_id, row);
    if (!p.sources.includes("company_property_link")) p.sources.push("company_property_link");
    const role = (ROLE_RANK as string[]).includes(row.relationship_role ?? "")
      ? (row.relationship_role as RelationshipRole)
      : "unknown";
    const confidence = (CONFIDENCE_RANK as string[]).includes(row.relationship_confidence ?? "")
      ? (row.relationship_confidence as RelationshipConfidence)
      : "unresolved";
    p._roles.push(role);
    p._confidences.push(confidence);
    if (row.ownership_stake_pct != null && p.ownershipStakePct == null) p.ownershipStakePct = row.ownership_stake_pct;
    if (!p.owningEntityId) p.owningEntityId = row.company_id;
  }

  return Array.from(byProperty.values()).map(({ _roles, _confidences, ...p }) => ({
    ...p,
    relationshipRole: bestBy(_roles, ROLE_RANK),
    confidence: bestBy(_confidences, CONFIDENCE_RANK),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export interface AccountDealRow {
  id: string;
  name: string;
  status: string | null;
  property_id: string | null;
  landlord_id: string | null;
  tenant_id: string | null;
  vendor_id: string | null;
  purchaser_id: string | null;
  bgp_acting_for: string | null;
  created_at: string | null;
  completed_at: string | null;
  tenant_name?: string | null;
  linked_entity_ids?: string[] | null;
}

export type DealClassification =
  | { bucket: "instruction"; partyEntityId: string }
  | { bucket: "related"; activityKind: "tenant_rep" | "investment" | "other" }
  | null;

// Instruction vs related market activity. BGP is instructed BY the account
// when the party BGP acts for (per bgp_acting_for; landlord is the default
// and also covers investment mandates where the account is vendor/purchaser)
// is an account entity. A tenant-rep letting at an account property where
// the tenant is NOT an account entity is related market activity — never an
// instruction. Explicit crm_company_deals links join the instruction list
// when no FK rule contradicts.
export function classifyDealForAccount(
  deal: AccountDealRow,
  entityIds: Set<string>,
  portfolioIds: Set<string>,
): DealClassification {
  const isEntity = (id: string | null): id is string => id != null && entityIds.has(id);
  const actingFor = (deal.bgp_acting_for || "landlord").toLowerCase();
  const atPortfolioProperty = deal.property_id != null && portfolioIds.has(deal.property_id);

  if (actingFor === "tenant") {
    if (isEntity(deal.tenant_id)) return { bucket: "instruction", partyEntityId: deal.tenant_id };
    if (atPortfolioProperty) return { bucket: "related", activityKind: "tenant_rep" };
  } else {
    if (isEntity(deal.landlord_id)) return { bucket: "instruction", partyEntityId: deal.landlord_id };
    if (isEntity(deal.vendor_id)) return { bucket: "instruction", partyEntityId: deal.vendor_id };
    if (isEntity(deal.purchaser_id)) return { bucket: "instruction", partyEntityId: deal.purchaser_id };
  }

  const linked = (deal.linked_entity_ids || []).filter(id => entityIds.has(id));
  if (linked.length > 0) return { bucket: "instruction", partyEntityId: linked[0] };

  if (atPortfolioProperty) {
    const activityKind = actingFor === "tenant"
      ? "tenant_rep"
      : (deal.vendor_id || deal.purchaser_id) ? "investment" : "other";
    return { bucket: "related", activityKind };
  }
  return null;
}

// ─── DB-backed assembly ──────────────────────────────────────────────────

export async function resolveAccountView(
  companyId: string,
  opts: { scopeCompanyId?: string | null } = {},
  deps: { pool?: Querier } = {},
): Promise<AccountView> {
  const q = deps.pool ?? await defaultPool();
  const scopeCompanyId = opts.scopeCompanyId ?? null;

  // 1. Entity tree — fetch the rows that can participate (ancestors via
  //    parent walk, descendants via BFS), then assemble purely so cycle
  //    flagging is deterministic and testable.
  const { rows: rootRows } = await q.query(
    `SELECT id, name, company_type, companies_house_number, parent_company_id, merged_into_id
       FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const root = rootRows[0] as CompanyGraphRow | undefined;
  if (!root) throw new Error("company not found");

  const collected = new Map<string, CompanyGraphRow>([[root.id, root]]);
  const fetchCompany = async (id: string): Promise<CompanyGraphRow | undefined> => {
    if (collected.has(id)) return collected.get(id);
    const { rows } = await q.query(
      `SELECT id, name, company_type, companies_house_number, parent_company_id, merged_into_id
         FROM crm_companies WHERE id = $1`,
      [id]
    );
    const row = rows[0] as CompanyGraphRow | undefined;
    if (row) collected.set(id, row);
    return row;
  };

  // Up-walk (merged_into_id followed at most once, for the surviving row's parent).
  {
    let cur = root;
    let mergedFollowed = false;
    for (let depth = 0; depth < TREE_DEPTH_CAP; depth++) {
      let nextId = cur.parent_company_id;
      if (!nextId && cur.id === root.id && cur.merged_into_id && !mergedFollowed) {
        mergedFollowed = true;
        const surviving = await fetchCompany(cur.merged_into_id);
        nextId = surviving?.parent_company_id ?? null;
      }
      if (!nextId || collected.has(nextId)) break;
      const next = await fetchCompany(nextId);
      if (!next) break;
      cur = next;
    }
  }
  // BFS down from every collected row (the up-walk leaves the top ancestor in the set).
  {
    const queue = [...collected.keys()];
    let hops = 0;
    while (queue.length > 0 && hops < 500) {
      const id = queue.shift()!;
      hops++;
      const { rows } = await q.query(
        `SELECT id, name, company_type, companies_house_number, parent_company_id, merged_into_id
           FROM crm_companies WHERE parent_company_id = $1`,
        [id]
      );
      for (const row of rows as CompanyGraphRow[]) {
        if (collected.has(row.id)) continue;
        collected.set(row.id, row);
        queue.push(row.id);
      }
    }
  }

  const entityIdsSoFar = [...collected.keys()];
  const { rows: tradingRows } = await q.query(
    `SELECT id, name, companies_house_number, parent_company_id
       FROM crm_trading_entities WHERE parent_company_id = ANY($1::text[])`,
    [entityIdsSoFar]
  ).catch(() => ({ rows: [] as any[] }));

  const entities = walkEntityTree([...collected.values()], tradingRows as TradingEntityGraphRow[], companyId);
  const rootEntity = entities.find(e => e.relation === "self")!;
  const companyIds = entities.filter(e => e.relation !== "trading_entity").map(e => e.companyId);

  // 2. Properties — landlord_id ∪ freeholder/long_leaseholder ∪ company links.
  const ownershipSql = `SELECT p.id, p.name, p.postcode, p.country,
             p.landlord_id, p.freeholder_id, p.long_leaseholder_id,
             (SELECT COUNT(*) FROM leasing_schedule_units u WHERE u.property_id = p.id)::int AS unit_count
        FROM crm_properties p
       WHERE p.landlord_id = ANY($1::text[]) OR p.freeholder_id = ANY($1::text[]) OR p.long_leaseholder_id = ANY($1::text[])`;
  const ownershipLegacySql = `SELECT p.id, p.name, p.postcode, NULL AS country,
             p.landlord_id, p.freeholder_id, p.long_leaseholder_id,
             (SELECT COUNT(*) FROM leasing_schedule_units u WHERE u.property_id = p.id)::int AS unit_count
        FROM crm_properties p
       WHERE p.landlord_id = ANY($1::text[]) OR p.freeholder_id = ANY($1::text[]) OR p.long_leaseholder_id = ANY($1::text[])`;
  const linkSql = `SELECT cp.company_id, cp.relationship_role, cp.ownership_stake_pct,
             cp.relationship_confidence, cp.relationship_source,
             p.id AS property_id, p.name, p.postcode, p.country,
             (SELECT COUNT(*) FROM leasing_schedule_units u WHERE u.property_id = p.id)::int AS unit_count
        FROM crm_company_properties cp
        JOIN crm_properties p ON p.id = cp.property_id
       WHERE cp.company_id = ANY($1::text[])`;
  const linkLegacySql = `SELECT cp.company_id, NULL AS relationship_role, NULL AS ownership_stake_pct,
             NULL AS relationship_confidence, NULL AS relationship_source,
             p.id AS property_id, p.name, p.postcode, NULL AS country,
             (SELECT COUNT(*) FROM leasing_schedule_units u WHERE u.property_id = p.id)::int AS unit_count
        FROM crm_company_properties cp
        JOIN crm_properties p ON p.id = cp.property_id
       WHERE cp.company_id = ANY($1::text[])`;

  const [ownershipRes, linkRes] = await Promise.all([
    queryWithFallback(q, ownershipSql, ownershipLegacySql, [companyIds]),
    queryWithFallback(q, linkSql, linkLegacySql, [companyIds]),
  ]);
  let properties = assembleProperties(
    ownershipRes.rows as PropertyOwnershipRow[],
    linkRes.rows as PropertyLinkRow[],
    companyId,
  );

  // 6. Client scoping — own rows only, the same rule as isPropertyInScope.
  //    Filters output; never adds rows.
  if (scopeCompanyId) {
    const { rows: scopeRows } = await q.query(
      `SELECT property_id AS id FROM crm_company_properties WHERE company_id = $1
        UNION SELECT id FROM crm_properties WHERE landlord_id = $1`,
      [scopeCompanyId]
    );
    const scopedIds = new Set(scopeRows.map((r: any) => r.id));
    properties = properties.filter(p => scopedIds.has(p.propertyId));
  }
  const portfolioIds = new Set(properties.map(p => p.propertyId));

  // 3. Instructions vs related market activity. The scoped fragment is the
  //    exact counterparty rule dealsClientScope uses on the brand profile.
  const dealsScope = scopeCompanyId
    ? ` AND (d.landlord_id = $2 OR d.vendor_id = $2 OR d.purchaser_id = $2)`
    : "";
  const dealsParams: any[] = scopeCompanyId ? [companyIds, scopeCompanyId] : [companyIds];
  const { rows: dealRows } = await q.query(
    `SELECT d.id, d.name, d.status, d.property_id,
            d.landlord_id, d.tenant_id, d.vendor_id, d.purchaser_id,
            d.bgp_acting_for, d.created_at, d.completed_at,
            tc.name AS tenant_name,
            (SELECT ARRAY(SELECT cd.company_id FROM crm_company_deals cd
              WHERE cd.deal_id = d.id AND cd.company_id = ANY($1::text[]))) AS linked_entity_ids
       FROM crm_deals d
       LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
      WHERE (d.landlord_id = ANY($1::text[]) OR d.tenant_id = ANY($1::text[])
         OR d.vendor_id = ANY($1::text[]) OR d.purchaser_id = ANY($1::text[])
         OR d.id IN (SELECT cd2.deal_id FROM crm_company_deals cd2 WHERE cd2.company_id = ANY($1::text[])))${dealsScope}`,
    dealsParams
  );

  const entityIdSet = new Set(companyIds);
  const instructions: AccountInstruction[] = [];
  const relatedMarketActivity: RelatedMarketActivity[] = [];
  for (const deal of dealRows as AccountDealRow[]) {
    const cls = classifyDealForAccount(deal, entityIdSet, portfolioIds);
    if (cls?.bucket === "instruction") {
      instructions.push({
        dealId: deal.id,
        name: deal.name,
        status: deal.status,
        propertyId: deal.property_id,
        partyEntityId: cls.partyEntityId,
        instructedAt: deal.created_at,
      });
    } else if (cls?.bucket === "related") {
      relatedMarketActivity.push({
        dealId: deal.id,
        name: deal.name,
        status: deal.status,
        propertyId: deal.property_id!,
        activityKind: cls.activityKind,
        counterpartyName: deal.tenant_name ?? null,
      });
    }
  }

  // Totals over the deduped counterparty deal set, classified with the
  // canonical vocabulary (COM/INV completed) from brand-profile-deals. JS
  // aggregation over DISTINCT deal ids — a deal shared by two entities
  // (e.g. parent + subsidiary) must not count twice.
  const counterpartyDeals = (dealRows as AccountDealRow[]).filter(d =>
    entityIdSet.has(d.landlord_id ?? "") || entityIdSet.has(d.tenant_id ?? "") ||
    entityIdSet.has(d.vendor_id ?? "") || entityIdSet.has(d.purchaser_id ?? ""));
  const totals = {
    deals: counterpartyDeals.length,
    completedDeals: counterpartyDeals.filter(d => isCompletedDealStatus(d.status) || d.completed_at != null).length,
  };

  // 4. Contacts — employer ∪ property/account relationships, deduped by
  //    contact id. Scoped viewers: employer contacts collapse to their own
  //    company, property contacts follow the scoped portfolio, and
  //    interaction stats are emptied.
  const contactEntityIds = scopeCompanyId ? [scopeCompanyId] : companyIds;
  const portfolioIdList = [...portfolioIds];
  const { rows: contactRows } = await q.query(
    `SELECT ct.id, ct.name, ct.role, ct.email, ct.phone, ct.linkedin_url, ct.avatar_url, ct.company_id,
            (ct.company_id = ANY($1::text[])) AS via_employer,
            EXISTS (SELECT 1 FROM crm_contact_properties cp
                     WHERE cp.contact_id = ct.id AND cp.property_id = ANY($2::text[])) AS via_property,
            EXISTS (SELECT 1 FROM crm_property_clients pc
                     WHERE pc.contact_id = ct.id AND pc.property_id = ANY($2::text[])) AS via_property_client
       FROM crm_contacts ct
      WHERE ct.company_id = ANY($1::text[])
         OR ct.id IN (SELECT cp.contact_id FROM crm_contact_properties cp WHERE cp.property_id = ANY($2::text[]))
         OR ct.id IN (SELECT pc.contact_id FROM crm_property_clients pc WHERE pc.property_id = ANY($2::text[]))
      ORDER BY ct.name ASC`,
    [contactEntityIds, portfolioIdList]
  ).catch(() => ({ rows: [] as any[] }));

  const contactIds = contactRows.map((r: any) => r.id);
  const statsByContact = new Map<string, { touches: number; last_touch: string | null }>();
  if (!scopeCompanyId && contactIds.length > 0) {
    const { rows: statRows } = await q.query(
      `SELECT contact_id, COUNT(*)::int AS touches, MAX(interaction_date) AS last_touch
         FROM crm_interactions
        WHERE contact_id = ANY($1::text[])
          AND interaction_date <= NOW()
        GROUP BY contact_id`,
      [contactIds]
    ).catch(() => ({ rows: [] as any[] }));
    for (const r of statRows) statsByContact.set(r.contact_id, { touches: r.touches, last_touch: r.last_touch });
  }
  const contacts: AccountContact[] = contactRows.map((r: any) => ({
    contactId: r.id,
    name: r.name,
    role: r.role,
    email: r.email,
    phone: r.phone,
    linkedinUrl: r.linkedin_url,
    avatarUrl: r.avatar_url,
    employerCompanyId: r.company_id,
    via: [
      r.via_employer ? "employer" : null,
      r.via_property ? "property" : null,
      r.via_property_client ? "property_client" : null,
    ].filter(Boolean) as string[],
    interactionCount: statsByContact.get(r.id)?.touches || 0,
    lastInteractionAt: statsByContact.get(r.id)?.last_touch || null,
  }));

  // 5. Team — curated board (across same-named sibling rows, the
  //    client-teams pattern) ∪ property agents over the portfolio ∪
  //    evidenced recent deal contributors. Display-only; changes no
  //    permissions. Stripped for scoped viewers along with fees.
  let team: AccountTeamMember[] = [];
  if (!scopeCompanyId) {
    const instructionIds = instructions.map(i => i.dealId);
    const [curatedRes, agentsRes, contributorsRes] = await Promise.all([
      q.query(
        `SELECT DISTINCT m.user_id, m.team_group, m.role
           FROM crm_client_team_members m
          WHERE m.client_company_id IN (
            SELECT id FROM crm_companies WHERE id = ANY($1::text[])
            UNION
            SELECT c2.id FROM crm_companies c1
              JOIN crm_companies c2
                ON lower(trim(c2.name)) = lower(trim(c1.name)) AND c2.id <> c1.id
             WHERE c1.id = ANY($1::text[]) AND c2.merged_into_id IS NULL
          )`,
        [companyIds]
      ).catch(() => ({ rows: [] as any[] })),
      portfolioIdList.length > 0
        ? q.query(
            `SELECT DISTINCT user_id, role FROM crm_property_agents WHERE property_id = ANY($1::text[])`,
            [portfolioIdList]
          ).catch(() => ({ rows: [] as any[] }))
        : Promise.resolve({ rows: [] as any[] }),
      instructionIds.length > 0
        ? q.query(
            `SELECT DISTINCT uid FROM (
               SELECT unnest(d.internal_agent_ids) AS uid
                 FROM crm_deals d
                WHERE d.id = ANY($1::text[])
                  AND d.updated_at >= now() - interval '24 months'
               UNION
               SELECT fa.agent_user_id AS uid
                 FROM deal_fee_allocations fa
                 JOIN crm_deals d ON d.id = fa.deal_id
                WHERE fa.deal_id = ANY($1::text[])
                  AND d.updated_at >= now() - interval '24 months'
             ) u WHERE uid IS NOT NULL`,
            [instructionIds]
          ).catch(() => ({ rows: [] as any[] }))
        : Promise.resolve({ rows: [] as any[] }),
    ]);

    const byUser = new Map<string, AccountTeamMember>();
    const addSource = (userId: string, source: string, extra: { role?: string | null; teamGroup?: string | null } = {}) => {
      if (!userId) return;
      if (!byUser.has(userId)) byUser.set(userId, { userId, name: null, email: null, role: null, teamGroup: null, sources: [] });
      const m = byUser.get(userId)!;
      if (!m.sources.includes(source)) m.sources.push(source);
      if (extra.role && !m.role) m.role = extra.role;
      if (extra.teamGroup && !m.teamGroup) m.teamGroup = extra.teamGroup;
    };
    for (const r of curatedRes.rows) addSource(r.user_id, "curated", { role: r.role, teamGroup: r.team_group });
    for (const r of agentsRes.rows) addSource(r.user_id, "property_agent", { role: r.role });
    for (const r of contributorsRes.rows) addSource(r.uid, "deal_contributor");

    const userIds = [...byUser.keys()];
    if (userIds.length > 0) {
      const { rows: userRows } = await q.query(
        `SELECT id, COALESCE(name, username, email) AS name, email FROM users WHERE id = ANY($1::text[])`,
        [userIds]
      ).catch(() => ({ rows: [] as any[] }));
      for (const u of userRows) {
        const m = byUser.get(u.id);
        if (m) { m.name = u.name; m.email = u.email; }
      }
    }
    team = [...byUser.values()].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }

  return {
    root: rootEntity,
    entities,
    properties,
    instructions,
    relatedMarketActivity,
    contacts,
    team,
    totals,
  };
}
