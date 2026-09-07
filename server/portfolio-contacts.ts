import type { PortfolioContactEntry, PortfolioContactRelationship, PortfolioContactsResponse, PortfolioRecordRef } from "@shared/portfolio-contacts";

type QueryClient = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };

export interface PortfolioContactEvidenceRow {
  entry_id: string;
  kind: PortfolioContactEntry["kind"];
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  contact_id: string | null;
  company_id: string | null;
  company_name: string | null;
  can_open_contact: boolean;
  can_open_company: boolean;
  side: PortfolioContactEntry["side"] | null;
  relationship: PortfolioContactRelationship;
}

const PROPERTIES = `SELECT p.id, p.name FROM crm_properties p
  WHERE p.landlord_id = $1 OR EXISTS (
    SELECT 1 FROM crm_company_properties cp WHERE cp.company_id = $1 AND cp.property_id = p.id
  )`;

// These are SQL expressions chosen below, never request-supplied identifiers.
function evidence(select: Record<string, string>, from: string): string {
  const columns = {
    contact_id: "NULL", company_id: "NULL", user_id: "NULL", fallback_id: "NULL", fallback_name: "NULL",
    group_key: "'deals'", source: "NULL", property_id: "NULL", deal_id: "NULL", unit_id: "NULL",
    tracker_id: "NULL", unit_name: "NULL", status: "NULL", confirmed: "true", ...select,
  };
  return `SELECT ${Object.entries(columns).map(([key, value]) => `${value}::${key === "confirmed" ? "boolean" : "text"} AS ${key}`).join(", ")} ${from}`;
}

export function buildPortfolioContactsQuery(companyId: string, scopeCompanyId: string | null, brandSliceSql: string, hasOverrides: boolean) {
  const visible = (contact: string, property: string) => `NOT EXISTS (
    SELECT 1 FROM overrides o WHERE o.contact_id = ${contact} AND o.property_id = ${property} AND o.kind = 'hide'
  )`;
  const liveDeal = "COALESCE(d.status, '') NOT IN ('WIT','COM','INV')";
  const unitFields = { property_id: "a.property_id", unit_id: "a.unit_id", tracker_id: "a.id", unit_name: "a.unit_name", status: "a.marketing_status" };
  const dealFields = { property_id: "d.property_id", deal_id: "d.id", unit_id: "d.unit_id", unit_name: "d.unit_name", status: "d.status" };
  const links = [
    evidence({ user_id: "pa.user_id", group_key: "'internal'", source: "'Assigned BGP team · ' || COALESCE(pa.role, 'Agent')", property_id: "pa.property_id" },
      "FROM crm_property_agents pa JOIN props p ON p.id = pa.property_id"),
    evidence({ contact_id: "c.id", group_key: "'internal'", source: "'Client company director'" },
      "FROM crm_contacts c WHERE c.company_id = $1 AND lower(COALESCE(c.role, '')) LIKE '%director%'"),
    evidence({ contact_id: "pc.contact_id", group_key: "'internal'", source: "'Named property contact' || CASE WHEN NULLIF(pc.role, '') IS NULL THEN '' ELSE ' · ' || pc.role END", property_id: "pc.property_id" },
      `FROM crm_property_clients pc JOIN props p ON p.id = pc.property_id WHERE ${visible("pc.contact_id", "pc.property_id")}`),
    evidence({ contact_id: "o.contact_id", group_key: "CASE WHEN c.company_id = $1 THEN 'internal' ELSE 'deals' END", source: "'Pinned on property'", property_id: "o.property_id" },
      "FROM overrides o JOIN crm_contacts c ON c.id = o.contact_id WHERE o.kind = 'pin'"),
    evidence({ contact_id: "named.contact_id", group_key: "CASE WHEN c.company_id = $1 THEN 'internal' ELSE 'deals' END", source: "'Named deal contact · ' || named.role", ...dealFields },
      `FROM pdeals d CROSS JOIN LATERAL (VALUES
        (d.client_contact_id, 'Client'), (d.tenant_contact_id, 'Tenant'), (d.landlord_contact_id, 'Landlord'),
        (d.vendor_contact_id, 'Vendor'), (d.purchaser_contact_id, 'Purchaser'),
        (d.vendor_agent_contact_id, 'Vendor agent'), (d.acquisition_agent_contact_id, 'Acquisition agent'),
        (d.purchaser_agent_contact_id, 'Purchaser agent'), (d.leasing_agent_contact_id, 'Leasing agent')
      ) named(contact_id, role) JOIN crm_contacts c ON c.id = named.contact_id
      WHERE ${visible("c.id", "d.property_id")}`),
    evidence({ contact_id: "c.id", source: "'Contact at tenant company · live deal'", ...dealFields },
      `FROM pdeals d JOIN crm_contacts c ON c.company_id = d.tenant_id
      WHERE ${liveDeal} AND c.last_interaction IS NOT NULL AND ${visible("c.id", "d.property_id")}`),
    evidence({ company_id: "d.tenant_id", source: "'Tenant on live deal · no named contact shown'", ...dealFields },
      `FROM pdeals d WHERE ${liveDeal} AND d.tenant_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM crm_contacts c WHERE c.company_id = d.tenant_id
         AND ${visible("c.id", "d.property_id")} AND (c.last_interaction IS NOT NULL OR c.id IN (
           d.client_contact_id, d.tenant_contact_id, d.landlord_contact_id, d.vendor_contact_id,
           d.purchaser_contact_id, d.vendor_agent_contact_id, d.acquisition_agent_contact_id,
           d.purchaser_agent_contact_id, d.leasing_agent_contact_id)))`),
    evidence({ contact_id: "c.id", company_id: "CASE WHEN c.id IS NULL THEN party.company_id END", source: "CASE WHEN c.id IS NULL THEN 'Tracker company · no visible contact' ELSE 'Contact at tracker company' END || ' · ' || party.source", ...unitFields },
      `FROM active_units a JOIN tracker_parties party ON party.tracker_id = a.id
      LEFT JOIN crm_contacts c ON c.company_id = party.company_id AND ${visible("c.id", "a.property_id")}`),
    evidence({ fallback_id: "'tracker:' || a.id", fallback_name: "a.unit_name", source: "'Tracker unit · no brand linked'", ...unitFields },
      "FROM active_units a WHERE NOT EXISTS (SELECT 1 FROM tracker_parties party WHERE party.tracker_id = a.id)"),
    evidence({ contact_id: "v.contact_id", source: "'Named viewing contact'", property_id: "a.property_id", unit_id: "a.unit_id", tracker_id: "a.id", unit_name: "a.unit_name" },
      `FROM unit_viewings v JOIN portfolio_units a ON a.id = v.unit_id JOIN crm_contacts c ON c.id = v.contact_id WHERE ${visible("c.id", "a.property_id")}`),
    evidence({ contact_id: "o.contact_id", source: "'Named offer contact'", property_id: "a.property_id", unit_id: "a.unit_id", tracker_id: "a.id", unit_name: "a.unit_name" },
      `FROM unit_offers o JOIN portfolio_units a ON a.id = o.unit_id JOIN crm_contacts c ON c.id = o.contact_id WHERE ${visible("c.id", "a.property_id")}`),
    evidence({ contact_id: "c.id", company_id: "CASE WHEN c.id IS NULL THEN t.resolved_company_id END", fallback_id: "CASE WHEN t.resolved_company_id IS NULL THEN 'tenancy:' || t.id END", fallback_name: "t.occupier_name", group_key: "'tenants'",
      source: "CASE WHEN c.id IS NOT NULL THEN 'Contact at occupier company · ' ELSE 'Occupier · ' END || t.match_source",
      property_id: "t.property_id", unit_id: "NULLIF(to_jsonb(t)->>'property_unit_id', '')", unit_name: "COALESCE(NULLIF(t.unit_number, ''), NULLIF(t.premises, ''))", status: "t.status", confirmed: "t.confirmed" },
      `FROM resolved_occupiers t LEFT JOIN crm_contacts c ON c.company_id = t.resolved_company_id AND ${visible("c.id", "t.property_id")}`),
    evidence({ contact_id: "c.id", group_key: "'consultants'", source: "'Contact at linked consultancy · ' || COALESCE(co.company_type, 'Consultant')", property_id: "cp.property_id" },
      `FROM crm_company_properties cp JOIN props p ON p.id = cp.property_id
      JOIN crm_companies co ON co.id = cp.company_id JOIN crm_contacts c ON c.company_id = co.id
      WHERE (co.company_type ILIKE '%consult%' OR co.company_type ILIKE '%architect%'
        OR co.company_type ILIKE '%advis%' OR co.company_type ILIKE '%planning%'
        OR co.company_type ILIKE '%project man%' OR co.company_type ILIKE '%engineer%'
        OR co.company_type ILIKE '%solicitor%' OR co.company_type ILIKE '%lawyer%')
        AND ${visible("c.id", "cp.property_id")}`),
  ];
  return {
    values: [companyId, scopeCompanyId],
    text: `WITH props AS (${PROPERTIES}),
    overrides AS (${hasOverrides
      ? "SELECT o.property_id, o.contact_id, o.kind FROM property_contact_overrides o JOIN props p ON p.id = o.property_id"
      : "SELECT NULL::varchar AS property_id, NULL::varchar AS contact_id, NULL::text AS kind WHERE false"}),
    pdeals AS (
      SELECT d.id, d.name, d.status, d.property_id, d.unit_id, d.tenant_id,
        d.client_contact_id, d.tenant_contact_id, d.landlord_contact_id, d.vendor_contact_id, d.purchaser_contact_id,
        d.vendor_agent_contact_id, d.acquisition_agent_contact_id, d.purchaser_agent_contact_id, d.leasing_agent_contact_id,
        COALESCE(pu.unit_name, NULLIF(ts.unit_number, ''), ts.premises) AS unit_name
      FROM crm_deals d JOIN props p ON p.id = d.property_id
      LEFT JOIN property_units pu ON pu.id = d.unit_id AND pu.property_id = d.property_id
      LEFT JOIN tenancy_schedule_units ts ON ts.id = d.tenancy_unit_id AND ts.property_id = d.property_id
    ),
    portfolio_units AS (SELECT a.* FROM available_units a JOIN props p ON p.id = a.property_id),
    active_units AS (SELECT * FROM portfolio_units WHERE lower(COALESCE(marketing_status,'')) ~ '(neg|offer|sol|exc|hots|terms)'),
    tracker_parties AS (
      SELECT a.id AS tracker_id, co.id AS company_id, 'recorded brand'::text AS source
      FROM active_units a JOIN crm_companies co ON co.id = a.tenant_company_id
      UNION SELECT a.id, co.id, 'linked portfolio deal' FROM active_units a
      JOIN pdeals d ON d.id = a.deal_id JOIN crm_companies co ON co.id = d.tenant_id
      UNION SELECT a.id, latest.company_id, 'latest offer' FROM active_units a
      JOIN LATERAL (SELECT o.company_id FROM unit_offers o JOIN crm_companies co ON co.id = o.company_id
        WHERE o.unit_id = a.id ORDER BY o.offer_date DESC NULLS LAST, o.id LIMIT 1) latest ON true
    ),
    tenancy AS (
      SELECT ts.*, COALESCE(NULLIF(btrim(ts.trading_name), ''), NULLIF(btrim(ts.tenant_name), ''), 'Unresolved occupier') AS occupier_name
      FROM tenancy_schedule_units ts JOIN props p ON p.id = ts.property_id
      WHERE ts.tenant_company_id IS NOT NULL OR (
        COALESCE(NULLIF(btrim(ts.trading_name), ''), NULLIF(btrim(ts.tenant_name), '')) IS NOT NULL
        AND lower(btrim(COALESCE(ts.status, ''))) NOT IN ('vacant', 'void', 'available')
        AND lower(btrim(COALESCE(NULLIF(ts.trading_name, ''), ts.tenant_name, ''))) NOT IN ('vacant', 'void', 'available')
      )
    ),
    resolved_occupiers AS (
      SELECT t.*, COALESCE(canonical.id, matched.company_id) AS resolved_company_id,
        canonical.id IS NOT NULL AS confirmed,
        CASE WHEN canonical.id IS NOT NULL THEN 'recorded tenancy link'
             WHEN matched.company_id IS NOT NULL THEN 'name match; CRM link unconfirmed'
             WHEN t.tenant_company_id IS NOT NULL THEN 'recorded company missing; CRM link needs checking'
             ELSE 'unresolved name; CRM link needed' END AS match_source
      FROM tenancy t LEFT JOIN crm_companies canonical ON canonical.id = t.tenant_company_id
      LEFT JOIN LATERAL (
        SELECT CASE WHEN count(*) = 1 THEN min(candidate.id) END AS company_id
        FROM (
          SELECT co.id, rank() OVER (ORDER BY CASE
            WHEN lower(co.name) IN (lower(COALESCE(t.tenant_name, '')), lower(COALESCE(t.trading_name, ''))) THEN 0 ELSE 1 END) AS preference
          FROM crm_companies co WHERE t.tenant_company_id IS NULL AND (
            lower(co.name) IN (lower(COALESCE(t.tenant_name, '')), lower(COALESCE(t.trading_name, '')))
            OR (length(co.name) >= 5 AND lower(COALESCE(t.tenant_name, '')) LIKE lower(co.name) || ' %'))
        ) candidate WHERE candidate.preference = 1
      ) matched ON true
    ),
    links AS (${links.join("\nUNION ALL\n")})
    SELECT CASE WHEN c.id IS NOT NULL THEN 'contact:' || c.id WHEN u.id IS NOT NULL THEN 'user:' || u.id
             WHEN co.id IS NOT NULL THEN 'company:' || co.id ELSE l.fallback_id END AS entry_id,
      CASE WHEN c.id IS NOT NULL OR u.id IS NOT NULL THEN 'person' WHEN l.fallback_id LIKE 'tracker:%' THEN 'unit' ELSE 'company' END AS kind,
      COALESCE(c.name, u.name, co.name, l.fallback_name) AS name,
      CASE WHEN u.id IS NOT NULL THEN 'BGP team' ELSE c.role END AS role,
      COALESCE(c.email, u.email) AS email, COALESCE(NULLIF(btrim(c.phone_mobile), ''), NULLIF(btrim(c.phone), ''), NULLIF(btrim(u.phone), '')) AS phone,
      c.id AS contact_id, co.id AS company_id, co.name AS company_name,
      c.id IS NOT NULL AND ($2::varchar IS NULL OR co.id = $2 OR co.company_type ILIKE 'Agent%' OR ${brandSliceSql}) AS can_open_contact,
      co.id IS NOT NULL AND ($2::varchar IS NULL OR co.id = $2 OR co.company_type ILIKE 'Agent%' OR ${brandSliceSql}
        OR co.agent_type = 'tenant_rep' OR EXISTS (SELECT 1 FROM brand_agent_representations r
          WHERE r.agent_company_id = co.id AND r.end_date IS NULL AND r.agent_type = 'tenant_rep')) AS can_open_company,
      CASE WHEN u.id IS NOT NULL THEN 'bgp' WHEN c.company_id = $1 THEN 'client' END AS side,
      jsonb_build_object('group', l.group_key, 'source', l.source,
        'property', CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id',p.id,'name',p.name) END,
        'deal', CASE WHEN d.id IS NOT NULL THEN jsonb_build_object('id',d.id,'name',d.name) END,
        'unit', CASE WHEN pu.id IS NOT NULL THEN jsonb_build_object('id',pu.id,'name',pu.unit_name) END,
        'trackerId', l.tracker_id, 'unitName', l.unit_name, 'status', l.status, 'confirmed', l.confirmed) AS relationship
    FROM links l LEFT JOIN crm_contacts c ON c.id = l.contact_id
    LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN crm_companies co ON co.id = COALESCE(c.company_id, l.company_id)
    LEFT JOIN props p ON p.id = l.property_id
    LEFT JOIN pdeals d ON d.id = l.deal_id
    LEFT JOIN property_units pu ON pu.id = l.unit_id AND pu.property_id = l.property_id
    WHERE c.id IS NOT NULL OR u.id IS NOT NULL OR co.id IS NOT NULL OR l.fallback_id IS NOT NULL`,
  };
}

const compare = (a: string, b: string) => a.localeCompare(b, "en-GB", { sensitivity: "base", numeric: true }) || a.localeCompare(b, "en-GB");

export function mapPortfolioContactRows(rows: PortfolioContactEvidenceRow[], properties: PortfolioRecordRef[]): PortfolioContactsResponse {
  const entries = new Map<string, PortfolioContactEntry>();
  const relationships = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.entry_id || !row.name) continue;
    let entry = entries.get(row.entry_id);
    if (!entry) {
      entry = {
        id: row.entry_id, kind: row.kind, name: row.name, role: row.role, email: row.email, phone: row.phone,
        contactId: row.contact_id, company: row.company_id && row.company_name ? { id: row.company_id, name: row.company_name } : null,
        canOpenContact: row.can_open_contact === true, canOpenCompany: row.can_open_company === true,
        ...(row.side ? { side: row.side } : {}), relationships: [],
      };
      entries.set(row.entry_id, entry);
      relationships.set(row.entry_id, new Set());
    }
    const relation = row.relationship;
    const key = JSON.stringify([relation.group, relation.source, relation.property?.id, relation.deal?.id, relation.unit?.id, relation.trackerId, relation.unitName, relation.status, relation.confirmed]);
    if (!relationships.get(row.entry_id)!.has(key)) {
      entry.relationships.push(relation);
      relationships.get(row.entry_id)!.add(key);
    }
  }
  for (const entry of entries.values()) entry.relationships.sort((a, b) =>
    compare(a.property?.name || "", b.property?.name || "") || compare(a.group, b.group)
    || compare(a.deal?.name || "", b.deal?.name || "") || compare(a.unitName || "", b.unitName || "")
    || compare(a.source, b.source) || compare(JSON.stringify(a), JSON.stringify(b)));
  return {
    entries: [...entries.values()].sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id)),
    properties: [...new Map(properties.map(p => [p.id, p])).values()].sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id)),
  };
}

export async function loadPortfolioContacts(client: QueryClient, companyId: string, scopeCompanyId: string | null, brandSliceSql: string): Promise<PortfolioContactsResponse> {
  const [properties, table] = await Promise.all([
    client.query(PROPERTIES, [companyId]),
    client.query("SELECT to_regclass('property_contact_overrides') IS NOT NULL AS present"),
  ]);
  const query = buildPortfolioContactsQuery(companyId, scopeCompanyId, brandSliceSql, table.rows[0]?.present === true);
  const evidence = await client.query(query.text, query.values);
  return mapPortfolioContactRows(evidence.rows, properties.rows);
}
