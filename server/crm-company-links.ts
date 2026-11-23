// What a CRM company is tied to in BGP's work (Woody, 2026-11-23: "we need
// brands linked to BGP leasing instructions and the Landlords linked to their
// buildings / ownership", "agents need to be linked to brands they are acting
// for and also building they are leasing"). Read from the records the app
// already holds, never stored: one fixed set of queries, each allowed to fail
// on its own (its part is then null). BGP staff only: the route is on the CRM
// hub router (`staffOnly`). Types in shared/crm-hub.ts (`CrmCompanyLinks`).
import type { CrmCompanyLinks } from "@shared/crm-hub";
import { closedStatusSqlList, TRACKER_LIVE_STATUSES, LETTING_STATUS_LABELS } from "@shared/letting-rules";
import { legacyToCode } from "@shared/deal-status";

type Queryable = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };
const OPEN_DEAL = `lower(trim(COALESCE(d.status, ''))) NOT IN (${closedStatusSqlList()})`;
// A tracker unit still being let, by the tracker's own live list.
const unitStage = (status: unknown) => { const code = legacyToCode(String(status || "")); return { live: !!code && TRACKER_LIVE_STATUSES.includes(code), label: code ? (LETTING_STATUS_LABELS as any)[code] || code : (status ? String(status) : null) }; };

const ROLE_WORDS: Record<string, string> = {
  landlord: "Landlord", freeholder: "Freeholder", long_leaseholder: "Long leaseholder", asset_manager: "Asset manager",
  senior_lender: "Senior lender", junior_lender: "Junior lender", competitor_agent: "Letting agent",
};

export async function companyLinks(q: Queryable, companyId: string): Promise<CrmCompanyLinks | null> {
  const company = (await q.query(`SELECT id, name FROM crm_companies WHERE id = $1 AND merged_into_id IS NULL`, [companyId])).rows[0];
  if (!company) return null;
  const part = (sql: string) => q.query(sql, [companyId]).then(r => r.rows).catch((e: any) => { console.warn(`[crm-company-links] ${e?.message}`); return null as any[] | null; });
  const [owned, linked, unitTies, wanted, dealTies, actingFor, agentDeals, agentUnits] = await Promise.all([
    // Buildings by the role a property record gives the company.
    part(`SELECT p.id, p.name, r.role FROM crm_properties p
      CROSS JOIN LATERAL (VALUES ('landlord', p.landlord_id), ('freeholder', p.freeholder_id), ('long_leaseholder', p.long_leaseholder_id),
        ('asset_manager', p.asset_manager_id), ('senior_lender', p.senior_lender_id), ('junior_lender', p.junior_lender_id),
        ('competitor_agent', p.competitor_agent_id)) AS r(role, company_id)
      WHERE r.company_id = $1 ORDER BY p.name`),
    part(`SELECT p.id, p.name, cp.relationship_role AS role, cp.ownership_stake_pct AS stake FROM crm_company_properties cp
      JOIN crm_properties p ON p.id = cp.property_id WHERE cp.company_id = $1 AND (cp.valid_to IS NULL OR cp.valid_to >= now()) ORDER BY p.name`),
    // A brand on a BGP letting: a target, interest, a viewing or an offer on a tracker unit.
    part(`SELECT x.how, u.id AS unit_id, u.unit_name, u.marketing_status, u.deal_id, p.id AS property_id, p.name AS property_name
      FROM (
        SELECT 'Target' AS how, unit_id FROM target_tenants WHERE company_id = $1 AND COALESCE(status, '') <> 'rejected'
        UNION SELECT 'Interest', unit_id FROM unit_interest WHERE company_id = $1
        UNION SELECT 'Viewing', unit_id FROM unit_viewings WHERE company_id = $1 AND deleted_at IS NULL
        UNION SELECT 'Offer', unit_id FROM unit_offers WHERE company_id = $1
      ) x JOIN available_units u ON u.id = x.unit_id LEFT JOIN crm_properties p ON p.id = u.property_id`),
    part(`SELECT t.id, t.unit_label, p.id AS property_id, p.name AS property_name FROM brand_scheme_targets t
      JOIN crm_properties p ON p.id = t.property_id WHERE t.company_id = $1 AND t.ruled_out_at IS NULL`),
    // Live deals the company is a party to, with the building.
    part(`SELECT d.id, d.name, d.status, d.deal_type, p.id AS property_id, p.name AS property_name,
        CASE WHEN d.tenant_id = $1 THEN 'Tenant' WHEN d.landlord_id = $1 THEN 'Landlord' WHEN d.vendor_id = $1 THEN 'Vendor'
             WHEN d.purchaser_id = $1 THEN 'Purchaser' ELSE 'Agent' END AS side
      FROM crm_deals d LEFT JOIN crm_properties p ON p.id = d.property_id
      WHERE ${OPEN_DEAL} AND $1 IN (d.tenant_id, d.landlord_id, d.vendor_id, d.purchaser_id, d.vendor_agent_id, d.acquisition_agent_id, d.purchaser_agent_id, d.leasing_agent_id, d.joint_agent_id)
      ORDER BY d.updated_at DESC NULLS LAST LIMIT 40`),
    // An agent firm: the brands it acts for now.
    part(`SELECT b.id, b.name, r.agent_type, r.region FROM brand_agent_representations r JOIN crm_companies b ON b.id = r.brand_company_id
      WHERE r.agent_company_id = $1 AND r.end_date IS NULL AND b.merged_into_id IS NULL ORDER BY b.name`),
    part(`SELECT DISTINCT p.id, p.name FROM crm_deals d JOIN crm_properties p ON p.id = d.property_id
      WHERE ${OPEN_DEAL} AND $1 IN (d.leasing_agent_id, d.joint_agent_id, d.vendor_agent_id)`),
    // An agent bringing a brand to a BGP letting.
    part(`SELECT DISTINCT u.id AS unit_id, u.unit_name, p.id AS property_id, p.name AS property_name, i.company_name AS brand
      FROM unit_interest i JOIN available_units u ON u.id = i.unit_id LEFT JOIN crm_properties p ON p.id = u.property_id
      WHERE i.agent_company_id = $1`),
  ]);

  let buildings: CrmCompanyLinks["buildings"] = null;
  if (owned || linked) {
    const byId = new Map<string, { propertyId: string; name: string; roles: string[] }>();
    const add = (id: string, name: string, role: string) => {
      const b = byId.get(id) || { propertyId: id, name, roles: [] };
      if (role && !b.roles.includes(role)) b.roles.push(role);
      byId.set(id, b);
    };
    for (const r of owned || []) add(String(r.id), String(r.name || ""), ROLE_WORDS[r.role] || r.role);
    for (const r of linked || []) add(String(r.id), String(r.name || ""), [r.role ? String(r.role).replace(/_/g, " ") : "Linked", r.stake ? `${Number(r.stake)}%` : ""].filter(Boolean).join(" "));
    buildings = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  let instructions: CrmCompanyLinks["instructions"] = null;
  if (unitTies || wanted || dealTies) {
    const byUnit = new Map<string, NonNullable<CrmCompanyLinks["instructions"]>[number]>();
    for (const r of unitTies || []) {
      const key = `unit:${r.unit_id}`;
      const stage = unitStage(r.marketing_status);
      const line = byUnit.get(key) || { key, unitId: String(r.unit_id), unit: r.unit_name || null, propertyId: r.property_id || null, propertyName: r.property_name || null,
        stage: stage.label, dealId: r.deal_id || null, live: stage.live, how: [] as string[] };
      if (!line.how.includes(r.how)) line.how.push(r.how);
      byUnit.set(key, line);
    }
    for (const r of wanted || []) {
      const key = `wish:${r.id}`;
      byUnit.set(key, { key, unitId: null, unit: r.unit_label || null, propertyId: r.property_id, propertyName: r.property_name, stage: null, dealId: null, live: true, how: ["Wanted"] });
    }
    for (const r of dealTies || []) {
      if (r.side !== "Tenant") continue;
      const key = `deal:${r.id}`;
      byUnit.set(key, { key, unitId: null, unit: r.name || null, propertyId: r.property_id || null, propertyName: r.property_name || null, stage: r.status || null, dealId: String(r.id), live: true, how: ["Tenant on the deal"] });
    }
    instructions = [...byUnit.values()].sort((a, b) => Number(b.live) - Number(a.live) || String(a.propertyName || "").localeCompare(String(b.propertyName || "")));
  }

  let leasing: CrmCompanyLinks["leasing"] = null;
  if (owned || agentDeals || agentUnits) {
    const byId = new Map<string, { propertyId: string; name: string; how: string[] }>();
    const add = (id: string, name: string, how: string) => {
      const b = byId.get(id) || { propertyId: id, name, how: [] };
      if (!b.how.includes(how)) b.how.push(how);
      byId.set(id, b);
    };
    for (const r of owned || []) if (r.role === "competitor_agent") add(String(r.id), String(r.name || ""), "Letting agent on the building");
    for (const r of agentDeals || []) add(String(r.id), String(r.name || ""), "Agent on a live deal");
    for (const r of agentUnits || []) if (r.property_id) add(String(r.property_id), String(r.property_name || ""), r.brand ? `Brought ${r.brand} to ${r.unit_name || "a unit"}` : `Interest on ${r.unit_name || "a unit"}`);
    leasing = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    id: String(company.id), name: String(company.name),
    buildings, instructions,
    actingFor: actingFor ? actingFor.map(r => ({ id: String(r.id), name: String(r.name || ""), detail: [r.agent_type, r.region].filter(Boolean).join(" · ") || null })) : null,
    leasing,
    deals: dealTies ? dealTies.map(r => ({ id: String(r.id), name: String(r.name || ""), status: r.status || null, side: String(r.side), propertyId: r.property_id || null, propertyName: r.property_name || null })) : null,
  };
}
