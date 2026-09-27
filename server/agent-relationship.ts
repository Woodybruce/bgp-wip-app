// An agent firm's relationship with BGP (Woody, 2026-09-26: "think about
// agents and how we deal with them across the app — there are different
// types of agents"). Everything the app knows about one agent firm, across
// the records agents attach to, with the roles they play derived from that
// evidence (shared/agent-roles.ts). Staff only — it spans every client.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import type { Querier } from "./account-resolver";
import { DEAL_AGENT_ROLES, roleFromAgentType, roleFromSpecialty, teamForRole, teamFromSpecialty, AGENT_TEAMS, type AgentRole } from "@shared/agent-roles";


async function rows(q: Querier, sql: string, params: any[]): Promise<any[]> {
  try { return (await q.query(sql, params)).rows; }
  catch (e: any) { console.warn("[agent-relationship]", e?.message); return []; }
}

export async function getAgentRelationship(firmId: string, deps: { pool?: Querier } = {}) {
  const q = deps.pool ?? (await import("./db")).pool;
  const [firm] = await rows(q, `SELECT id, name, company_type, agent_type FROM crm_companies WHERE id = $1`, [firmId]);
  if (!firm) throw new Error("company not found");
  const people = await rows(q, `SELECT id, name, role, email, contact_type, agent_specialty FROM crm_contacts WHERE company_id = $1 ORDER BY name`, [firmId]);
  const contactIds = people.map((p: any) => p.id);

  const representing = await rows(q, `SELECT r.id, r.agent_type, r.region, r.start_date, r.end_date, r.brand_company_id, r.primary_contact_id AS person_id,
      c.name AS client_name, c.company_type AS client_type, pc.name AS contact_name
    FROM brand_agent_representations r
    JOIN crm_companies c ON c.id = r.brand_company_id
    LEFT JOIN crm_contacts pc ON pc.id = r.primary_contact_id
    WHERE (r.agent_company_id = $1 OR (r.agent_company_id IS NULL AND r.primary_contact_id = ANY($2::text[])))
      AND (r.end_date IS NULL OR r.end_date >= NOW())
    ORDER BY c.name`, [firmId, contactIds]);

  const deals: any[] = [];
  for (const r of DEAL_AGENT_ROLES) {
    const found = await rows(q, `SELECT d.id, d.name, d.status, d.deal_type, d.bgp_acting_for, d.property_id, d.updated_at, d.${r.contactColumn} AS person_id,
        p.name AS property_name, pc.name AS contact_name
      FROM crm_deals d
      LEFT JOIN crm_properties p ON p.id = d.property_id
      LEFT JOIN crm_contacts pc ON pc.id = d.${r.contactColumn}
      WHERE d.${r.column} = $1 OR d.${r.contactColumn} = ANY($2::text[])
      ORDER BY d.updated_at DESC NULLS LAST LIMIT 40`, [firmId, contactIds]);
    for (const d of found) deals.push({ ...d, role: r.role, roleLabel: r.label, open: !/^(COM|INV|WIT|Completed|Invoiced|Withdrawn|Lost|Dead)$/i.test(d.status || "") });
  }

  const leasingRequirements = await rows(q, `SELECT r.id, r.status, r.size, r.requirement_locations, r.updated_at, c.id AS brand_id, r.agent_contact_id AS person_id,
      COALESCE(c.name, r.name) AS brand_name, ac.name AS agent_name
    FROM crm_requirements_leasing r
    LEFT JOIN crm_companies c ON c.id = r.company_id
    LEFT JOIN crm_contacts ac ON ac.id = r.agent_contact_id
    WHERE r.agent_contact_id = ANY($1::text[])
    ORDER BY (r.status IS NULL OR r.status = 'Active') DESC, r.updated_at DESC NULLS LAST LIMIT 60`, [contactIds]);
  const investmentRequirements = await rows(q, `SELECT r.id, r.name, r.status, r.size_range, r.requirement_locations, c.id AS client_id, c.name AS client_name, r.agent_contact_id AS person_id
    FROM crm_requirements_investment r LEFT JOIN crm_companies c ON c.id = r.company_id
    WHERE r.agent_contact_id = ANY($1::text[]) ORDER BY r.updated_at DESC NULLS LAST LIMIT 30`, [contactIds]);

  const competing = await rows(q, `SELECT p.id, p.name, p.competitor_agent_status, p.competitor_agent_instructed_at, l.id AS landlord_id, l.name AS landlord_name
    FROM crm_properties p LEFT JOIN crm_companies l ON l.id = p.landlord_id
    WHERE p.competitor_agent_id = $1 ORDER BY p.name LIMIT 60`, [firmId]);

  const sellingFor = await rows(q, `SELECT id, asset_name, board_type, status, guide_price, vendor, deal_id, vendor_agent_id AS person_id
    FROM investment_tracker WHERE vendor_agent_id = ANY($1::text[]) ORDER BY updated_at DESC NULLS LAST LIMIT 30`, [contactIds]);
  const bids = await rows(q, `SELECT o.id, o.offer_price, o.status, o.offer_date, t.id AS tracker_id, t.asset_name, t.deal_id, o.contact_id AS person_id
    FROM investment_offers o JOIN investment_tracker t ON t.id = o.tracker_id
    WHERE o.company_id = $1 OR o.contact_id = ANY($2::text[]) ORDER BY o.offer_date DESC NULLS LAST LIMIT 30`, [firmId, contactIds]);
  const sentSales = await rows(q, `SELECT s.id, s.sent_date, s.response, t.asset_name, t.deal_id, s.contact_id AS person_id
    FROM investment_distributions s JOIN investment_tracker t ON t.id = s.tracker_id
    WHERE s.company_id = $1 OR s.contact_id = ANY($2::text[]) ORDER BY s.sent_date DESC NULLS LAST LIMIT 30`, [firmId, contactIds]);

  const otherSide = await rows(q, `SELECT m.id, m.matter_type, m.status, m.acting_for, m.agreed_rent, m.quoting_rent, m.counter_quoting_rent, m.other_side_contact_id AS person_id,
      p.name AS property_name, c.name AS surveyor_name
    FROM pla_matters m LEFT JOIN crm_properties p ON p.id = m.property_id LEFT JOIN crm_contacts c ON c.id = m.other_side_contact_id
    WHERE m.other_side_company_id = $1 OR m.other_side_contact_id = ANY($2::text[])
    ORDER BY m.opened_at DESC NULLS LAST LIMIT 30`, [firmId, contactIds]);

  const viewings = await rows(q, `SELECT v.id, v.viewing_date, v.status, v.outcome, COALESCE(b.name, v.company_name) AS brand_name, v.agent_contact_id AS person_id,
      au.unit_name, p.name AS property_name, ac.name AS agent_name
    FROM unit_viewings v
    LEFT JOIN available_units au ON au.id = v.unit_id
    LEFT JOIN crm_properties p ON p.id = au.property_id
    LEFT JOIN crm_companies b ON b.id = v.company_id
    LEFT JOIN crm_contacts ac ON ac.id = v.agent_contact_id
    WHERE v.agent_contact_id = ANY($1::text[]) ORDER BY v.viewing_date DESC NULLS LAST LIMIT 30`, [contactIds]);

  // Roles, from the evidence (count per role).
  const roles = new Map<AgentRole, number>();
  const bump = (r: AgentRole | null, n = 1) => { if (r && n > 0) roles.set(r, (roles.get(r) || 0) + n); };
  for (const r of representing) bump(roleFromAgentType(r.agent_type));
  for (const d of deals) bump(d.role);
  bump("tenant_rep", leasingRequirements.length + viewings.length);
  bump("investment_buy", investmentRequirements.length + bids.length);
  bump("letting", competing.length);
  bump("investment_sell", sellingFor.length);
  bump("lease_advisory", otherSide.length);
  if (!roles.size) {
    bump(roleFromAgentType(firm.agent_type));
    for (const p of people) bump(roleFromSpecialty(p.agent_specialty));
  }

  // Each piece of evidence credited to the individual agent: the capacity
  // they acted in, per person. A person's team is their recorded specialty,
  // or — when blank — the team their work points to (marked inferred).
  const capacities = new Map<string, Record<string, number>>();
  const credit = (personId: any, role: AgentRole | null) => {
    if (!personId || !role) return;
    const m = capacities.get(personId) || {};
    m[role] = (m[role] || 0) + 1;
    capacities.set(personId, m);
  };
  for (const r of representing) credit(r.person_id, roleFromAgentType(r.agent_type));
  for (const d of deals) credit(d.person_id, d.role);
  for (const r of leasingRequirements) credit(r.person_id, "tenant_rep");
  for (const v of viewings) credit(v.person_id, "tenant_rep");
  for (const r of investmentRequirements) credit(r.person_id, "investment_buy");
  for (const b of bids) credit(b.person_id, "investment_buy");
  for (const t of sentSales) credit(t.person_id, "investment_buy");
  for (const t of sellingFor) credit(t.person_id, "investment_sell");
  for (const m of otherSide) credit(m.person_id, "lease_advisory");
  const team = (p: any, caps: Record<string, number>) => {
    const recorded = teamFromSpecialty(p.agent_specialty);
    if (recorded) return { team: recorded, inferred: false };
    const byTeam: Record<string, number> = {};
    for (const [role, n] of Object.entries(caps)) { const t = teamForRole(role as AgentRole); if (t) byTeam[t] = (byTeam[t] || 0) + n; }
    const top = Object.entries(byTeam).sort((a, b) => b[1] - a[1])[0];
    return top ? { team: top[0], inferred: true } : { team: null, inferred: false };
  };
  const teamPeople = people.map((p: any) => {
    const caps = capacities.get(p.id) || {};
    return { id: p.id, name: p.name, title: p.role, email: p.email, capacities: caps, activity: Object.values(caps).reduce((a, b) => a + b, 0), ...team(p, caps) };
  });
  const teams = [...AGENT_TEAMS, null].map(t => ({
    team: t,
    people: teamPeople.filter((p: any) => p.team === t).sort((a: any, b: any) => b.activity - a.activity || String(a.name).localeCompare(String(b.name))),
  })).filter(g => g.people.length > 0);
  const specialtyGroups: Record<string, any[]> = {};
  for (const p of people) {
    const key = roleFromSpecialty(p.agent_specialty) || "unassigned";
    (specialtyGroups[key] ||= []).push({ id: p.id, name: p.name, role: p.role, email: p.email });
  }

  return {
    firm: { id: firm.id, name: firm.name },
    roles: [...roles.entries()].sort((a, b) => b[1] - a[1]).map(([role, count]) => ({ role, count })),
    representing,
    deals,
    openDeals: deals.filter(d => d.open).length,
    leasingRequirements,
    investmentRequirements,
    competing,
    investment: { sellingFor, bids, sentSales },
    otherSide,
    viewings,
    people: { total: people.length, bySpecialty: specialtyGroups },
    teams,
  };
}

const router = Router();

router.get("/api/agents/:id/relationship", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    if (await resolveCompanyScope(req)) return res.status(403).json({ error: "Available in the staff view." });
    res.json(await getAgentRelationship(String(req.params.id)));
  } catch (e: any) {
    if (e?.message === "company not found") return res.status(404).json({ error: "Company not found" });
    res.status(500).json({ error: e.message });
  }
});

export default router;
