// Account workspace (Delivery 3, Task 2) — the read model behind the
// landlord workspace's People & team / next-actions / investment-strategy
// sections.
//
// The account resolver (Delivery 2) is the single source for the account
// scope: entity set, portfolio, instruction/related deal ids, contacts and
// the base team all come from resolveAccountView. This module layers four
// read-only enrichments on top:
//   1. team      — resolver team (curated ∪ property agents ∪ deal
//                  contributors) plus is_lead, per-person portfolio property
//                  names, and a "recent_contributor" source evidenced by
//                  crm_interactions.bgp_user matched to users by EXACT
//                  lower(name)/lower(email) — unmatched strings contribute
//                  nothing rather than a guessed identity.
//   2. contacts  — resolver contacts (employer ∪ property ∪ property_client,
//                  already deduped) plus employerName and the portfolio
//                  property names that link them. No contact creation logic.
//   3. nextActions — open user_tasks linked to the account via deal /
//                  portfolio property / account contact, with owner + due
//                  date. Tasks are BGP-internal: staff only.
//   4. investmentRequirements — crm_requirements_investment rows for the
//                  entity set, only ever real records; buying intent is
//                  never inferred from ownership.
//
// Permissions never widen: scopeCompanyId flows into the resolver exactly
// as Delivery 2; for scoped viewers the resolver already strips the team
// and interaction stats, and nextActions come back empty here too.

import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { resolveAccountView, type AccountContact, type AccountTeamMember, type Querier } from "./account-resolver";

async function defaultPool(): Promise<Querier> {
  const { pool } = await import("./db");
  return pool;
}

export interface WorkspaceTeamMember extends AccountTeamMember {
  isLead: boolean;
  propertyNames: string[];
  lastContributionAt: string | null;
}

export interface WorkspaceContact extends AccountContact {
  employerName: string | null;
  propertyNames: string[];
}

export interface WorkspaceNextAction {
  taskId: string;
  title: string;
  status: string | null;
  priority: string | null;
  dueDate: string | null;
  ownerName: string | null;
  linkKind: "deal" | "property" | "contact";
  linkId: string;
  linkLabel: string | null;
}

export interface WorkspaceInvestmentRequirement {
  id: string;
  name: string;
  status: string | null;
  use: string[] | null;
  size: string[] | null;
  locations: string[] | null;
  updatedAt: string | null;
}

export interface AccountWorkspace {
  team: WorkspaceTeamMember[];
  contacts: WorkspaceContact[];
  nextActions: WorkspaceNextAction[];
  investmentRequirements: WorkspaceInvestmentRequirement[];
  totals: { deals: number; completedDeals: number };
}

// Pure merge: one deduplicated row per user across every evidence source.
// The resolver already unions curated / property_agent / deal_contributor;
// this adds is_lead, property names, and the interaction-evidenced
// recent_contributor source. Exported for tests.
export function assembleWorkspaceTeam(
  base: AccountTeamMember[],
  extras: {
    leads?: Set<string>;
    propertyNamesByUser?: Map<string, string[]>;
    recentContributors?: Map<string, string>; // userId → ISO last interaction date
  },
): WorkspaceTeamMember[] {
  const byUser = new Map<string, WorkspaceTeamMember>();
  for (const m of base) {
    byUser.set(m.userId, {
      ...m,
      sources: [...m.sources],
      isLead: extras.leads?.has(m.userId) ?? false,
      propertyNames: extras.propertyNamesByUser?.get(m.userId) ?? [],
      lastContributionAt: null,
    });
  }
  for (const [userId, at] of extras.recentContributors ?? []) {
    const m = byUser.get(userId);
    if (m) {
      if (!m.sources.includes("recent_contributor")) m.sources.push("recent_contributor");
      if (!m.lastContributionAt || at > m.lastContributionAt) m.lastContributionAt = at;
    }
  }
  return [...byUser.values()].sort((a, b) =>
    Number(b.isLead) - Number(a.isLead) || (a.name || "").localeCompare(b.name || ""));
}

export async function getAccountWorkspace(
  companyId: string,
  opts: { scopeCompanyId?: string | null } = {},
  deps: { pool?: Querier } = {},
): Promise<AccountWorkspace> {
  const q = deps.pool ?? await defaultPool();
  const scopeCompanyId = opts.scopeCompanyId ?? null;
  const staff = scopeCompanyId == null;

  const view = await resolveAccountView(companyId, { scopeCompanyId }, { pool: q });
  const entityIds = view.entities.filter(e => e.relation !== "trading_entity").map(e => e.companyId);
  const entityNames = new Map(view.entities.map(e => [e.companyId, e.name]));
  const portfolioIds = view.properties.map(p => p.propertyId);

  // ── Team (staff only — the resolver strips it for scoped viewers) ──────
  let team: WorkspaceTeamMember[] = [];
  if (staff && view.team.length > 0) {
    const [leadRes, agentPropRes, interactionRes] = await Promise.all([
      // is_lead across the same same-named sibling expansion client-teams
      // reads (server/client-teams.ts boardCompanyIds).
      q.query(
        `SELECT m.user_id, bool_or(COALESCE(m.is_lead, false)) AS is_lead
           FROM crm_client_team_members m
          WHERE m.client_company_id IN (
            SELECT id FROM crm_companies WHERE id = ANY($1::text[])
            UNION
            SELECT c2.id FROM crm_companies c1
              JOIN crm_companies c2
                ON lower(trim(c2.name)) = lower(trim(c1.name)) AND c2.id <> c1.id
             WHERE c1.id = ANY($1::text[]) AND c2.merged_into_id IS NULL
          )
          GROUP BY m.user_id`,
        [entityIds]
      ).catch(() => ({ rows: [] as any[] })),
      portfolioIds.length > 0
        ? q.query(
            `SELECT pa.user_id, p.name
               FROM crm_property_agents pa
               JOIN crm_properties p ON p.id = pa.property_id
              WHERE pa.property_id = ANY($1::text[])
              ORDER BY p.name`,
            [portfolioIds]
          ).catch(() => ({ rows: [] as any[] }))
        : Promise.resolve({ rows: [] as any[] }),
      // Recent contributors evidenced by interactions on the account.
      // bgp_user is free text; match to users by exact lower(name/email).
      q.query(
        `SELECT lower(trim(i.bgp_user)) AS key, MAX(i.interaction_date) AS last_at
           FROM crm_interactions i
          WHERE i.company_id = ANY($1::text[])
            AND i.bgp_user IS NOT NULL AND btrim(i.bgp_user) <> ''
            AND i.interaction_date <= NOW()
            AND i.interaction_date >= now() - interval '24 months'
          GROUP BY 1`,
        [entityIds]
      ).catch(() => ({ rows: [] as any[] })),
    ]);

    const leads = new Set<string>(
      (leadRes.rows as any[]).filter(r => r.is_lead).map(r => r.user_id)
    );
    const propertyNamesByUser = new Map<string, string[]>();
    for (const r of agentPropRes.rows as any[]) {
      if (!r.user_id || !r.name) continue;
      const list = propertyNamesByUser.get(r.user_id) ?? [];
      if (!list.includes(r.name)) list.push(r.name);
      propertyNamesByUser.set(r.user_id, list);
    }

    const knownUsers = new Map<string, string>(); // lower(name|email) → userId
    for (const m of view.team) {
      if (m.name) knownUsers.set(m.name.trim().toLowerCase(), m.userId);
      if (m.email) knownUsers.set(m.email.trim().toLowerCase(), m.userId);
    }
    const recentContributors = new Map<string, string>();
    for (const r of interactionRes.rows as any[]) {
      const userId = knownUsers.get(String(r.key ?? ""));
      if (!userId) continue; // unmatched strings contribute nothing
      const at = r.last_at ? new Date(r.last_at).toISOString() : null;
      if (!at) continue;
      const prev = recentContributors.get(userId);
      if (!prev || at > prev) recentContributors.set(userId, at);
    }

    team = assembleWorkspaceTeam(view.team, { leads, propertyNamesByUser, recentContributors });
  }

  // ── Contacts — resolver list + employer name + linking portfolio props ──
  const contactPropertyNames = new Map<string, string[]>();
  if (portfolioIds.length > 0 && view.contacts.length > 0) {
    const { rows: linkRows } = await q.query(
      `SELECT x.contact_id, p.name
         FROM (
           SELECT contact_id, property_id FROM crm_contact_properties WHERE property_id = ANY($1::text[])
           UNION
           SELECT contact_id, property_id FROM crm_property_clients WHERE property_id = ANY($1::text[])
         ) x
         JOIN crm_properties p ON p.id = x.property_id
        ORDER BY p.name`,
      [portfolioIds]
    ).catch(() => ({ rows: [] as any[] }));
    for (const r of linkRows as any[]) {
      const list = contactPropertyNames.get(r.contact_id) ?? [];
      if (!list.includes(r.name)) list.push(r.name);
      contactPropertyNames.set(r.contact_id, list);
    }
  }
  // Employers can sit outside the entity set (contacts reached via a
  // property link), so resolve any missing names with one small lookup.
  const employerIds = [...new Set(view.contacts.map(c => c.employerCompanyId).filter((x): x is string => !!x))];
  const missingEmployerIds = employerIds.filter(id => !entityNames.has(id));
  const employerNames = new Map(entityNames);
  if (missingEmployerIds.length > 0) {
    const { rows: employerRows } = await q.query(
      `SELECT id, name FROM crm_companies WHERE id = ANY($1::text[])`,
      [missingEmployerIds]
    ).catch(() => ({ rows: [] as any[] }));
    for (const r of employerRows as any[]) employerNames.set(r.id, r.name);
  }
  const contacts: WorkspaceContact[] = view.contacts.map(c => ({
    ...c,
    employerName: c.employerCompanyId ? employerNames.get(c.employerCompanyId) ?? null : null,
    propertyNames: contactPropertyNames.get(c.contactId) ?? [],
  }));

  // ── Next actions — open user_tasks touching the account (staff only) ────
  let nextActions: WorkspaceNextAction[] = [];
  if (staff) {
    const dealIds = [...view.instructions.map(i => i.dealId), ...view.relatedMarketActivity.map(r => r.dealId)];
    const contactIds = view.contacts.map(c => c.contactId);
    const { rows: taskRows } = await q.query(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date,
              t.linked_deal_id, t.linked_property_id, t.linked_contact_id,
              COALESCE(u.name, u.username, u.email) AS owner_name,
              d.name AS deal_name, p.name AS property_name, c.name AS contact_name
         FROM user_tasks t
         LEFT JOIN users u ON u.id = t.user_id
         LEFT JOIN crm_deals d ON d.id = t.linked_deal_id
         LEFT JOIN crm_properties p ON p.id = t.linked_property_id
         LEFT JOIN crm_contacts c ON c.id = t.linked_contact_id
        WHERE t.status IS DISTINCT FROM 'done'
          AND t.completed_at IS NULL
          AND (t.linked_deal_id = ANY($1::text[])
            OR t.linked_property_id = ANY($2::text[])
            OR t.linked_contact_id = ANY($3::text[]))
        ORDER BY t.due_date ASC NULLS LAST, t.created_at ASC
        LIMIT 50`,
      [dealIds, portfolioIds, contactIds]
    ).catch(() => ({ rows: [] as any[] }));
    nextActions = (taskRows as any[]).map(t => {
      const link = t.linked_deal_id
        ? { linkKind: "deal" as const, linkId: t.linked_deal_id, linkLabel: t.deal_name ?? null }
        : t.linked_property_id
          ? { linkKind: "property" as const, linkId: t.linked_property_id, linkLabel: t.property_name ?? null }
          : { linkKind: "contact" as const, linkId: t.linked_contact_id, linkLabel: t.contact_name ?? null };
      return {
        taskId: t.id,
        title: t.title,
        status: t.status ?? null,
        priority: t.priority ?? null,
        dueDate: t.due_date ?? null,
        ownerName: t.owner_name ?? null,
        ...link,
      };
    });
  }

  // ── Investment requirements — real records only, never inferred ─────────
  // Scoped viewers see their own company's records only — same collapse the
  // resolver applies to contacts (the entity tree itself is not a permission
  // grant onto sibling entities' requirements).
  const reqEntityIds = scopeCompanyId ? [scopeCompanyId] : entityIds;
  const { rows: reqRows } = await q.query(
    `SELECT id, name, status, use_types AS use, size_range AS size,
            requirement_locations AS locations, updated_at
       FROM crm_requirements_investment
      WHERE company_id = ANY($1::text[])
      ORDER BY updated_at DESC NULLS LAST, name ASC`,
    [reqEntityIds]
  ).catch(() => ({ rows: [] as any[] }));
  const investmentRequirements: WorkspaceInvestmentRequirement[] = (reqRows as any[]).map(r => ({
    id: r.id,
    name: r.name,
    status: r.status ?? null,
    use: r.use ?? null,
    size: r.size ?? null,
    locations: r.locations ?? null,
    updatedAt: r.updated_at ?? null,
  }));

  return {
    team,
    contacts,
    nextActions,
    investmentRequirements,
    totals: view.totals,
  };
}

// ─── Route ───────────────────────────────────────────────────────────────
// GET /api/accounts/:id/workspace — team view, unified contacts, next
// actions, investment requirements. Scope flows into the resolver; team and
// next actions are staff-only.

const router = Router();

router.get("/api/accounts/:id/workspace", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    const scopeCompanyId = await resolveCompanyScope(req);
    const companyId = String(req.params.id);
    const workspace = await getAccountWorkspace(companyId, { scopeCompanyId });
    res.json(workspace);
  } catch (e: any) {
    if (e?.message === "company not found") return res.status(404).json({ error: "Company not found" });
    res.status(500).json({ error: e.message });
  }
});

export default router;
