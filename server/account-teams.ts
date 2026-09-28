// Team views of a landlord account (Woody, 2026-09-26: the landlord page
// "works great for leasing instructions — what about the investment team
// tracking buildings they own they might sell and their investment
// requirements? ... the tenant rep team tracking properties and landlords
// they want to put a tenant into? ... lease advisory — what they are working
// on but also landlords and their lease events"). One read per landlord for
// the three non-leasing teams, scoped to the resolver's portfolio
// (landlord_id ∪ freeholder / long leaseholder ∪ company links, across the
// entity tree) rather than landlord_id alone. Staff only — it carries BGP's
// pipeline for other clients (tenant-rep brands, investment interest).
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { resolveAccountView, type Querier } from "./account-resolver";
import { requirementFitsUnit } from "@shared/requirement-fit";
import { DEAL_AGENT_ROLES, roleFromAgentType } from "@shared/agent-roles";

const LEASE_WINDOW_MONTHS = 18;
const OPEN_DEAL = `COALESCE(d.status, '') NOT IN ('COM','INV','WIT','Completed','Invoiced','Withdrawn','Lost','Dead')`;

async function rows(q: Querier, sql: string, params: any[]): Promise<any[]> {
  try { return (await q.query(sql, params)).rows; }
  catch (e: any) { console.warn("[account-teams]", e?.message); return []; }
}

// Vacant and marketing space on these properties with the brands whose live
// leasing requirement fits each unit (size plus use or location; ★ = BGP acts
// for the brand). Shared by the landlord Team view and the property page.
export async function spaceFitsFor(q: Querier, propertyIds: string[]) {
  const units = await rows(q, `SELECT au.id, au.property_id, au.unit_name, au.sqft, au.asking_rent, au.marketing_status, au.use_class,
      p.name AS property_name, COALESCE(p.address::text, '') || ' ' || COALESCE(p.postcode, '') || ' ' || p.name AS property_text
    FROM available_units au JOIN crm_properties p ON p.id = au.property_id
    WHERE au.property_id = ANY($1::text[]) AND au.marketing_status IN ('OPP','AVA','NEG')
    ORDER BY p.name, au.unit_name LIMIT 80`, [propertyIds]);
  const scheduleVacancies = await rows(q, `SELECT lu.id, lu.property_id, lu.unit_name, lu.sqft, lu.status,
      p.name AS property_name, COALESCE(p.address::text, '') || ' ' || COALESCE(p.postcode, '') || ' ' || p.name AS property_text
    FROM leasing_schedule_units lu JOIN crm_properties p ON p.id = lu.property_id
    WHERE lu.property_id = ANY($1::text[]) AND lu.status IN ('Vacant','Opportunity')
      AND NOT EXISTS (SELECT 1 FROM available_units au WHERE au.leasing_schedule_unit_id = lu.id)
    ORDER BY p.name, lu.unit_name LIMIT 60`, [propertyIds]);
  // Brands looking for space: live leasing requirements, with the brands BGP
  // acts for (a live tenant-rep deal or search) marked and listed first.
  const requirementsLive = await rows(q, `SELECT r.id, r.company_id, COALESCE(c.name, r.name) AS brand_name, r.size, r.use, r.requirement_locations
    FROM crm_requirements_leasing r LEFT JOIN crm_companies c ON c.id = r.company_id
    WHERE r.status IS NULL OR r.status = 'Active'`, []);
  const bgpClients = new Set((await rows(q, `SELECT DISTINCT d.tenant_id AS id FROM crm_deals d
      WHERE d.bgp_acting_for = 'tenant' AND d.tenant_id IS NOT NULL AND ${OPEN_DEAL}
    UNION SELECT DISTINCT company_id FROM tenant_rep_searches
      WHERE company_id IS NOT NULL AND COALESCE(status, '') NOT IN ('Complete','Completed','Archived','Lost','On Hold')`, [])).map((r: any) => r.id));
  const space = [
    ...units.map((u: any) => ({ id: u.id, kind: "marketing" as const, propertyId: u.property_id, propertyName: u.property_name, unitName: u.unit_name, sqft: u.sqft, askingRent: u.asking_rent, status: u.marketing_status, text: u.property_text, unitText: `${u.unit_name || ""} ${u.use_class || ""}` })),
    ...scheduleVacancies.map((u: any) => ({ id: u.id, kind: "schedule" as const, propertyId: u.property_id, propertyName: u.property_name, unitName: u.unit_name, sqft: u.sqft, askingRent: null, status: u.status, text: u.property_text, unitText: u.unit_name || "" })),
  ].map(({ text, unitText, ...u }) => {
    const fits = requirementsLive.filter((r: any) => requirementFitsUnit(r, { sqft: u.sqft, unit_text: unitText, property_text: text }))
      .map((r: any) => ({ requirementId: r.id, companyId: r.company_id, name: r.brand_name, bgpClient: bgpClients.has(r.company_id) }))
      .sort((a: any, b: any) => Number(b.bgpClient) - Number(a.bgpClient));
    const seen = new Set<string>();
    return { ...u, fits: fits.filter((f: any) => { const k = f.companyId || f.name; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6), fitCount: fits.length };
  }).sort((a, b) => Number(b.fits.some((f: any) => f.bgpClient)) - Number(a.fits.some((f: any) => f.bgpClient)) || b.fits.length - a.fits.length);
  return { space, bgpClients, liveRequirements: requirementsLive.length };
}

export async function getAccountTeams(companyId: string, deps: { pool?: Querier } = {}) {
  const q = deps.pool ?? (await import("./db")).pool;
  const view = await resolveAccountView(companyId, {}, { pool: q });
  const entityIds = view.entities.filter(e => e.relation !== "trading_entity").map(e => e.companyId);
  const propertyIds = view.properties.map(p => p.propertyId);
  const propertyName = new Map(view.properties.map(p => [p.propertyId, p.name]));

  // ── Investment ──
  const [flags] = await rows(q, `SELECT disposing_now, disposing_now_notes, acquiring_now, acquiring_now_notes,
      distress_flag, distress_notes, investment_hunter_flag, investment_hunter_notes,
      mandate_asset_class, mandate_lot_size_min, mandate_lot_size_max, mandate_geographies, capital_source, aum
    FROM crm_companies WHERE id = $1`, [companyId]);
  const tracker = await rows(q, `SELECT id, asset_name, board_type, status, guide_price, niy, property_id, deal_id,
      client, client_id, vendor, vendor_id, buyer, buyer_id, bid_deadline, completion_date, updated_at
    FROM investment_tracker
    WHERE client_id = ANY($1::text[]) OR vendor_id = ANY($1::text[]) OR buyer_id = ANY($1::text[]) OR property_id = ANY($2::text[])
    ORDER BY updated_at DESC NULLS LAST LIMIT 40`, [entityIds, propertyIds]);
  const salesCandidates = await rows(q, `SELECT p.id, p.name, p.status, p.bgp_engagement, p.asset_class
    FROM crm_properties p
    WHERE p.id = ANY($1::text[])
      AND (p.status ILIKE '%sale%' OR 'Investment' = ANY(COALESCE(p.bgp_engagement, ARRAY[]::text[])))
    ORDER BY p.name LIMIT 40`, [propertyIds]);
  const debtEvents = await rows(q, `SELECT id, property_id, event_type, event_date, lender, amount, notes
    FROM landlord_debt_events WHERE landlord_id = ANY($1::text[])
    ORDER BY event_date DESC NULLS LAST LIMIT 20`, [entityIds]);
  const comps = await rows(q, `SELECT id, property_name, property_id, city, price, cap_rate, transaction_date,
      CASE WHEN seller_company_id = ANY($1::text[]) THEN 'sold' ELSE 'bought' END AS side
    FROM investment_comps
    WHERE buyer_company_id = ANY($1::text[]) OR seller_company_id = ANY($1::text[])
    ORDER BY transaction_date DESC NULLS LAST LIMIT 12`, [entityIds]);
  // Sales they've been sent and bids they've made (the investment board's
  // Sent To and Offers, linked by company since 2026-09-26).
  const sentToThem = await rows(q, `SELECT s.id, s.sent_date, s.response, t.id AS tracker_id, t.asset_name, t.deal_id, t.status
    FROM investment_distributions s JOIN investment_tracker t ON t.id = s.tracker_id
    WHERE s.company_id = ANY($1::text[]) ORDER BY s.sent_date DESC NULLS LAST LIMIT 20`, [entityIds]);
  const theirBids = await rows(q, `SELECT o.id, o.offer_price, o.status, o.offer_date, t.id AS tracker_id, t.asset_name, t.deal_id
    FROM investment_offers o JOIN investment_tracker t ON t.id = o.tracker_id
    WHERE o.company_id = ANY($1::text[]) ORDER BY o.offer_date DESC NULLS LAST LIMIT 20`, [entityIds]);
  const theirViewings = await rows(q, `SELECT v.id, v.viewing_date, v.outcome, v.contact, t.id AS tracker_id, t.asset_name, t.deal_id
    FROM investment_viewings v JOIN investment_tracker t ON t.id = v.tracker_id
    WHERE v.company_id = ANY($1::text[]) ORDER BY v.viewing_date DESC NULLS LAST LIMIT 20`, [entityIds]);
  // Buildings of theirs on BGP's Sales board (live) — a sale is a moment to
  // approach the tenants (lease advisory, tenant rep).
  const forSale = await rows(q, `SELECT property_id FROM investment_tracker
    WHERE board_type = 'Sales' AND property_id = ANY($1::text[]) AND COALESCE(status, '') NOT IN ('COM','INV','WIT')`, [propertyIds]);
  const forSalePropertyIds = [...new Set(forSale.map((r: any) => r.property_id))];
  const requirements = await rows(q, `SELECT id, name, status, use_types, requirement_types, size_range, requirement_locations, locations, comments, requirement_date, updated_at
    FROM crm_requirements_investment WHERE company_id = ANY($1::text[])
    ORDER BY updated_at DESC NULLS LAST LIMIT 20`, [entityIds]);

  // ── Tenant rep ──
  const { space, bgpClients, liveRequirements } = await spaceFitsFor(q, propertyIds);
  const tenantRepDeals = await rows(q, `SELECT d.id, d.name, d.status, d.deal_type, d.property_id, t.name AS tenant_name, d.tenant_id
    FROM crm_deals d LEFT JOIN crm_companies t ON t.id = d.tenant_id
    WHERE d.property_id = ANY($1::text[]) AND d.bgp_acting_for = 'tenant' AND ${OPEN_DEAL}
    ORDER BY d.updated_at DESC NULLS LAST LIMIT 30`, [propertyIds]);

  // ── Lease advisory ──
  const matters = await rows(q, `SELECT m.id, m.matter_type, m.status, m.acting_for, m.property_id, m.expiry_date, m.break_date,
      m.current_rent_review_date, u.name AS lead_name
    FROM pla_matters m LEFT JOIN users u ON u.id = m.lead_user_id
    WHERE (m.property_id = ANY($1::text[]) OR m.client_company_id = ANY($2::text[]))
      AND COALESCE(m.status, '') NOT IN ('COM','WIT','INV')
    ORDER BY m.opened_at DESC NULLS LAST LIMIT 30`, [propertyIds, entityIds]);
  const tracked = await rows(q, `SELECT id, property_id, unit_ref, tenant, event_type, event_date, status, matter_id, deal_id
    FROM lease_events
    WHERE property_id = ANY($1::text[]) AND event_date >= NOW() - INTERVAL '1 month'
      AND event_date <= NOW() + INTERVAL '${LEASE_WINDOW_MONTHS} months'`, [propertyIds]);
  const tenancy = await rows(q, `SELECT id, property_id, COALESCE(unit_number, premises) AS unit, COALESCE(trading_name, tenant_name) AS tenant,
      lease_expiry, break_date, next_review_date
    FROM tenancy_schedule_units
    WHERE property_id = ANY($1::text[]) AND (
      lease_expiry BETWEEN NOW() - INTERVAL '1 month' AND NOW() + INTERVAL '${LEASE_WINDOW_MONTHS} months'
      OR break_date BETWEEN NOW() - INTERVAL '1 month' AND NOW() + INTERVAL '${LEASE_WINDOW_MONTHS} months'
      OR next_review_date BETWEEN NOW() - INTERVAL '1 month' AND NOW() + INTERVAL '${LEASE_WINDOW_MONTHS} months')`, [propertyIds]);
  const leasing = await rows(q, `SELECT id, property_id, unit_name AS unit, tenant_name AS tenant, lease_expiry, lease_break, rent_review
    FROM leasing_schedule_units
    WHERE property_id = ANY($1::text[]) AND (
      lease_expiry BETWEEN NOW() - INTERVAL '1 month' AND NOW() + INTERVAL '${LEASE_WINDOW_MONTHS} months'
      OR lease_break BETWEEN NOW() - INTERVAL '1 month' AND NOW() + INTERVAL '${LEASE_WINDOW_MONTHS} months'
      OR rent_review BETWEEN NOW() - INTERVAL '1 month' AND NOW() + INTERVAL '${LEASE_WINDOW_MONTHS} months')`, [propertyIds]);

  const inWindow = (d: any) => {
    if (!d) return false;
    const t = new Date(d).getTime();
    return !isNaN(t) && t >= Date.now() - 31 * 864e5 && t <= Date.now() + LEASE_WINDOW_MONTHS * 30.5 * 864e5;
  };
  const events = new Map<string, any>();
  const key = (propertyId: string, unit: string | null, type: string, date: any) =>
    `${propertyId}|${String(unit || "").toLowerCase().replace(/\s+/g, "")}|${type}|${new Date(date).toISOString().slice(0, 7)}`;
  const add = (propertyId: string, unit: string | null, tenant: string | null, type: string, date: any, source: string) => {
    if (!inWindow(date)) return;
    const k = key(propertyId, unit, type, date);
    if (!events.has(k)) events.set(k, { propertyId, propertyName: propertyName.get(propertyId) || null, unit, tenant, type, date: new Date(date).toISOString(), source, trackedId: null, trackedStatus: null, matterId: null });
  };
  for (const t of tracked) {
    const k = key(t.property_id, t.unit_ref, t.event_type, t.event_date);
    events.set(k, { propertyId: t.property_id, propertyName: propertyName.get(t.property_id) || null, unit: t.unit_ref, tenant: t.tenant, type: t.event_type, date: new Date(t.event_date).toISOString(), source: "lease_events", trackedId: t.id, trackedStatus: t.status, matterId: t.matter_id });
  }
  for (const u of tenancy) {
    add(u.property_id, u.unit, u.tenant, "Lease Expiry", u.lease_expiry, "tenancy_schedule");
    add(u.property_id, u.unit, u.tenant, "Break Option", u.break_date, "tenancy_schedule");
    add(u.property_id, u.unit, u.tenant, "Rent Review", u.next_review_date, "tenancy_schedule");
  }
  for (const u of leasing) {
    add(u.property_id, u.unit, u.tenant, "Lease Expiry", u.lease_expiry, "leasing_schedule");
    add(u.property_id, u.unit, u.tenant, "Break Option", u.lease_break, "leasing_schedule");
    add(u.property_id, u.unit, u.tenant, "Rent Review", u.rent_review, "leasing_schedule");
  }
  const allLeaseEvents = [...events.values()].sort((a, b) => a.date.localeCompare(b.date));
  const leaseEvents = allLeaseEvents.slice(0, 150);
  // The landlord's side of each investment-board asset: they're selling when
  // they're the vendor (whichever BGP board it sits on — a Purchases-board
  // asset with Landsec as vendor is Landsec disposing), or BGP's client on
  // the Sales board; buying when they're the client on the Purchases board.
  const entitySet = new Set(entityIds);
  const nameKey = (v: any) => String(v || "").toLowerCase().replace(/\b(plc|ltd|limited|group|properties|property)\b/g, "").replace(/[^a-z0-9]/g, "");
  const entityNames = new Set([view.root.name, ...view.entities.map(e => e.name)].map(nameKey).filter(Boolean));
  const GENERIC_NAME_WORDS = /^(the|and|plc|ltd|limited|llp|group|properties|property|capital|estate|estates|holdings|investments?|assets?|management|real|reit|trust|partners|fund|funds|company|international|land|london|british|great|city|centre|centres|retail)$/;
  const ownTokens = new Set([view.root.name, ...view.entities.map(e => e.name)]
    .flatMap(n => String(n || "").toLowerCase().split(/[^a-z0-9]+/)).filter(w => w.length >= 4 && !GENERIC_NAME_WORDS.test(w)));
  const isUs = (id: any, name: any) => entitySet.has(id) || (!id && !!name && entityNames.has(nameKey(name)));
  // No party of theirs named: the asset is here because it's one of their
  // properties — they're the owner, so the selling side. Touchwood (Ardent's,
  // on BGP's Purchases board with no parties) read as Ardent buying it
  // (Woody, 2026-09-28).
  const side = (t: any) => isUs(t.buyer_id, t.buyer) ? "buying" : isUs(t.vendor_id, t.vendor) ? "selling"
    : isUs(t.client_id, t.client) ? (t.board_type === "Sales" ? "selling" : "buying")
    : "selling";

  // ── Agents across their estate: who represents them, who is instructed
  // instead of BGP on their properties, and the agents on deals at their
  // schemes (by role) — one row per firm, linking to the agent page.
  const agentMap = new Map<string, any>();
  const agentRow = (id: string, name: string) => {
    if (!agentMap.has(id)) agentMap.set(id, { firmId: id, name, roles: {} as Record<string, number>, represents: [] as string[], competing: [] as string[], deals: 0, openDeals: 0 });
    return agentMap.get(id);
  };
  const reps = await rows(q, `SELECT r.agent_company_id, a.name AS agent_name, r.agent_type, r.region
    FROM brand_agent_representations r JOIN crm_companies a ON a.id = r.agent_company_id
    WHERE r.brand_company_id = ANY($1::text[]) AND (r.end_date IS NULL OR r.end_date >= NOW())`, [entityIds]);
  for (const r of reps) {
    const row = agentRow(r.agent_company_id, r.agent_name);
    const role = roleFromAgentType(r.agent_type) || "letting";
    row.roles[role] = (row.roles[role] || 0) + 1;
    row.represents.push([r.agent_type === "landlord_rep" ? "Letting" : r.agent_type === "investment" ? "Investment" : r.agent_type, r.region].filter(Boolean).join(" · "));
  }
  const competitorRows = await rows(q, `SELECT p.id, p.name, p.competitor_agent_id, a.name AS agent_name
    FROM crm_properties p JOIN crm_companies a ON a.id = p.competitor_agent_id
    WHERE p.id = ANY($1::text[])`, [propertyIds]);
  for (const r of competitorRows) {
    const row = agentRow(r.competitor_agent_id, r.agent_name);
    row.roles.letting = (row.roles.letting || 0) + 1;
    row.competing.push(r.name);
  }
  for (const r of DEAL_AGENT_ROLES) {
    const found = await rows(q, `SELECT d.${r.column} AS firm_id, a.name AS agent_name, COUNT(*)::int AS n,
        COUNT(*) FILTER (WHERE COALESCE(d.status, '') NOT IN ('COM','INV','WIT','Completed','Invoiced','Withdrawn','Lost','Dead'))::int AS open
      FROM crm_deals d JOIN crm_companies a ON a.id = d.${r.column}
      WHERE d.property_id = ANY($1::text[]) AND d.${r.column} IS NOT NULL
      GROUP BY d.${r.column}, a.name`, [propertyIds]);
    for (const f of found) {
      const row = agentRow(f.firm_id, f.agent_name);
      row.roles[r.role] = (row.roles[r.role] || 0) + f.n;
      row.deals += f.n; row.openDeals += f.open;
    }
  }
  // Tenant-rep agents who brought brands to view their units.
  const viewingAgents = await rows(q, `SELECT ac.company_id AS firm_id, a.name AS agent_name, COUNT(*)::int AS n
    FROM unit_viewings v
    JOIN available_units au ON au.id = v.unit_id
    JOIN crm_contacts ac ON ac.id = v.agent_contact_id
    JOIN crm_companies a ON a.id = ac.company_id
    WHERE au.property_id = ANY($1::text[])
    GROUP BY ac.company_id, a.name`, [propertyIds]);
  for (const f of viewingAgents) {
    const row = agentRow(f.firm_id, f.agent_name);
    row.roles.tenant_rep = (row.roles.tenant_rep || 0) + f.n;
    row.viewings = (row.viewings || 0) + f.n;
  }
  const agents = [...agentMap.values()].sort((a, b) =>
    Number(b.represents.length > 0) - Number(a.represents.length > 0) || (b.openDeals - a.openDeals) || (b.competing.length + b.deals) - (a.competing.length + a.deals));

  return {
    landlordName: view.root.name,
    agents,
    portfolioCount: propertyIds.length,
    investment: {
      flags: flags || null,
      tracker: tracker.map((t: any) => ({ ...t, side: side(t), property_name: propertyName.get(t.property_id) || null })),
      // 103 Mount Street sat under Selling (Withdrawn) AND Might sell — a site
      // already on the investment boards (any status) isn't a "might sell"
      // (Woody, 2026-09-28).
      salesCandidates: salesCandidates.filter((p: any) => !tracker.some((t: any) => t.property_id === p.id || (!!t.asset_name && nameKey(t.asset_name) === nameKey(p.name)))),
      debtEvents: debtEvents.map((e: any) => ({ ...e, property_name: e.property_id ? propertyName.get(e.property_id) || null : null })),
      comps,
      // Rows were titled with the landlord's own name ("British Land") — the
      // name only adds something when it isn't them (Woody, 2026-09-28).
      // "Capco Shaftesbury" under Shaftesbury Capital, or a bare "Investment
      // requirement", also said nothing — any distinctive word of theirs in
      // the title counts as their name (Woody, 2026-09-28).
      requirements: requirements.map((r: any) => ({ ...r, ownName: entityNames.has(nameKey(r.name)) || /^investment requirements?$/i.test(String(r.name || "").trim())
        || String(r.name || "").toLowerCase().split(/[^a-z0-9]+/).some(w => ownTokens.has(w)) })),
      sentToThem,
      theirBids,
      theirViewings,
    },
    forSalePropertyIds,
    tenantRep: {
      space,
      liveRequirements,
      bgpClients: bgpClients.size,
      deals: tenantRepDeals.map((d: any) => ({ ...d, property_name: propertyName.get(d.property_id) || null })),
    },
    leaseAdvisory: {
      matters: matters.map((m: any) => ({ ...m, property_name: propertyName.get(m.property_id) || null })),
      events: leaseEvents,
      eventsTotal: allLeaseEvents.length,
    },
    // The account's BGP team with their role and the Team view tab it
    // covers — each tab names who's on it (Woody, 2026-09-28).
    bgpTeam: await (async () => {
      const { canonicalBgpRole, teamTabForRole } = await import("@shared/bgp-account-roles");
      const members = await rows(q, `SELECT u.id, COALESCE(u.name, u.username, u.email) AS name, r.role
          FROM crm_companies c
          CROSS JOIN LATERAL unnest(COALESCE(c.bgp_contact_user_ids, ARRAY[]::text[])) AS m(user_id)
          JOIN users u ON u.id = m.user_id
          LEFT JOIN crm_company_bgp_roles r ON r.user_id = u.id AND r.company_id = c.id
         WHERE c.id = $1 ORDER BY u.name`, [companyId]);
      return members.map((m: any) => ({ userId: m.id, name: m.name, role: canonicalBgpRole(m.role) || m.role || null, tab: teamTabForRole(m.role) }));
    })(),
  };
}

const router = Router();

// One property's vacant / marketing space with the brands that fit it.
router.get("/api/properties/:id/space-fits", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    if (await resolveCompanyScope(req)) return res.status(403).json({ error: "Available in the staff view." });
    const { pool } = await import("./db");
    const { space } = await spaceFitsFor(pool, [String(req.params.id)]);
    res.json({ space });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/api/accounts/:id/teams", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    if (await resolveCompanyScope(req)) return res.status(403).json({ error: "Available in the staff view." });
    res.json(await getAccountTeams(String(req.params.id)));
  } catch (e: any) {
    if (e?.message === "company not found") return res.status(404).json({ error: "Company not found" });
    res.status(500).json({ error: e.message });
  }
});

export default router;
