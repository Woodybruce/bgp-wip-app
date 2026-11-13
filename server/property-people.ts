// The property page's People tab (docs/contacts-board-plan-2026-11-13.md): one
// read of everyone tied to a property, by evidence, grouped by
// PEOPLE_GROUPS, each relationship carrying the schedule row and tracker row
// it is on. It runs a fixed number of queries per property, never one per
// unit or per person, and writes nothing.
//
// What a login is sent is decided by recordPersonForViewer
// (shared/record-people.ts) on every entry: BGP staff (contactViewer) get the
// whole entry; a client login on its own property gets the allow-list only,
// without BGP's contact history, the CRM plan, viewings or offers.
//
// The one write is a person's role at the property (crm_property_clients),
// BGP staff only and only for the owner's own people.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { clientBrandSliceSql, resolveCompanyScope } from "./company-scope";
import { contactViewer } from "./contact-viewer";
import { PLAN_COMPANY_PREDICATE, planForCompanies } from "./crm-engagement";
import { evidence, OCCUPIER_CTES } from "./portfolio-contacts";
import { BGP_ACCOUNT_TEAM_SQL, BGP_DEAL_AGENTS_SQL, propertyBgpTeam } from "./property-asset-brief";
import { propertyReadBlocked } from "./property-units";
import { normUnitSql } from "./tenant-brand-resolver";
import { CLOSED_STATUSES, statusSpellingsFor } from "@shared/deal-status";
import { BRIEF_PERSON_ROLES } from "@shared/unit-brief";
import {
  PROPERTY_CLIENT_ROLES, recordPersonForViewer, recordViewer, sortRecordPeople,
  type PeopleGroup, type RecordPeopleReply, type RecordPerson, type RecordPersonSource, type RecordPlan, type RecordRelationship,
} from "@shared/record-people";

type Db = { query: (sql: string, values?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type TransactionDb = Db & { connect: () => Promise<Db & { release: () => void }> };

const STAFF_DOMAIN = "@brucegillinghampollard.com";
const sqlList = (values: readonly string[]) => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
const LIVE_DEAL = `lower(btrim(COALESCE(d.status, ''))) NOT IN (${sqlList(statusSpellingsFor(CLOSED_STATUSES))})`;
// Tracker units with a party worth listing: NEG through EXC, as the classic card.
const ACTIVE_UNIT = (a: string) => `lower(btrim(COALESCE(${a}.marketing_status, ''))) IN (${sqlList(statusSpellingsFor(["NEG", "HOT", "SOL", "EXC"]))})`;
const CONSULTANT = (co: string) => `(${["%consult%", "%architect%", "%advis%", "%planning%", "%project man%", "%engineer%", "%solicitor%", "%lawyer%"]
  .map(t => `COALESCE(${co}.company_type, '') ILIKE '${t}'`).join(" OR ")})`;
const AGENT_FIRM = (co: string) => `(COALESCE(${co}.company_type, '') ILIKE 'Agent%' OR ${co}.agent_type IS NOT NULL)`;
const BGP_USER = (u: string) => `(lower(COALESCE(${u}.email, '')) LIKE '%${STAFF_DOMAIN}' AND COALESCE(${u}.role, '') <> 'Client' AND ${u}.is_active IS DISTINCT FROM false)`;
const LABEL = (t: string) => `COALESCE(NULLIF(btrim(${t}.unit_number), ''), NULLIF(btrim(${t}.premises), ''))`;
const BRIEF_ROLE = `CASE bp.role ${BRIEF_PERSON_ROLES.map(r => `WHEN '${r.key}' THEN '${r.label}'`).join(" ")} ELSE 'Involved' END`;

// The owner companies: the property's landlord, freeholder and long
// leaseholder, and any linked company that is not a tenant, an agent or an
// adviser. $1 is the property id.
const OWNERS_SQL = `SELECT x.id FROM crm_properties p
    CROSS JOIN LATERAL (VALUES (p.landlord_id), (p.freeholder_id), (p.long_leaseholder_id)) x(id)
   WHERE p.id = $1 AND x.id IS NOT NULL
  UNION
  SELECT co.id FROM crm_company_properties cp JOIN crm_companies co ON co.id = cp.company_id
   WHERE cp.property_id = $1 AND COALESCE(co.company_type, '') NOT ILIKE 'tenant%'
     AND NOT ${AGENT_FIRM("co")} AND NOT ${CONSULTANT("co")}`;

// Every relationship branch has the same columns in the same order: the
// portfolio's evidence() columns, then these.
const rel = (select: Record<string, string>, from: string) => evidence({
  role: "NULL", role_source: "'derived'", visibility: "'all'", schedule_row_id: "NULL", added_by: "NULL", firm: "NULL", ...select,
}, from);

export function buildPropertyPeopleQuery(propertyId: string, scopeCompanyId: string | null, brandSliceSql: string, hasOverrides: boolean) {
  // Hidden on THIS property: always the page's $1, so a contact hidden here
  // stays hidden when a deal reaches the property only through its unit.
  const visible = (contact: string, property: string) => `NOT EXISTS (
    SELECT 1 FROM overrides o WHERE o.contact_id = ${contact} AND o.property_id = ${property} AND o.kind = 'hide'
  )`;
  const dealFields = { deal_id: "d.id", schedule_row_id: "d.schedule_row_id", tracker_id: "d.tracker_id", unit_name: "d.unit_name", status: "d.status" };
  const trackerFields = { schedule_row_id: "a.schedule_row_id", tracker_id: "a.tracker_id", unit_name: "a.label", status: "a.marketing_status" };
  const briefPerson = (group: PeopleGroup, role: string, where: string) => rel({
    user_id: "bp.user_id", contact_id: "CASE WHEN bp.user_id IS NULL THEN bp.contact_id END",
    fallback_id: "CASE WHEN bp.user_id IS NULL AND bp.contact_id IS NULL THEN 'brief:' || bp.id END", fallback_name: "bp.name", firm: "NULLIF(btrim(bp.firm), '')",
    group_key: `'${group}'`, source: "'brief'", role, role_source: "'set'", ...trackerFields,
  }, `FROM unit_brief_people bp JOIN unit_briefs b ON b.id = bp.brief_id JOIN tracker_rows a ON a.tracker_id = b.unit_id
      WHERE ${where} AND ${visible("bp.contact_id", "$1")}`);
  const named = (columns: Array<[string, string]>) => `FROM pdeals d CROSS JOIN LATERAL (VALUES
        ${columns.map(([column, label]) => `(d.${column}, '${label}')`).join(", ")}
      ) named(contact_id, role) JOIN crm_contacts c ON c.id = named.contact_id WHERE ${visible("c.id", "$1")}`;
  const notOwner = (company: string) => `NOT EXISTS (SELECT 1 FROM owners ow WHERE ow.id = ${company})`;

  const links = [
    // BGP team
    rel({ user_id: "pa.user_id", group_key: "'bgp'", source: "'assigned'", role: "COALESCE(NULLIF(btrim(pa.role), ''), 'Agent')",
      role_source: "CASE WHEN NULLIF(btrim(pa.role), '') IS NULL THEN 'derived' ELSE 'set' END" },
      "FROM crm_property_agents pa WHERE pa.property_id = $1"),
    briefPerson("bgp", "'BGP agent on ' || COALESCE(a.label, 'the unit''s') || ' brief'", "bp.role = 'bgp_agent' AND bp.user_id IS NOT NULL"),
    // Client's team
    rel({ contact_id: "pc.contact_id", group_key: "'client'", role: "COALESCE(NULLIF(btrim(pc.role), ''), 'Client''s team')",
      role_source: "CASE WHEN NULLIF(btrim(pc.role), '') IS NULL THEN 'derived' ELSE 'set' END" },
      `FROM crm_property_clients pc WHERE pc.property_id = $1 AND ${visible("pc.contact_id", "$1")}`),
    briefPerson("client", BRIEF_ROLE, "bp.role IN ('client_leasing', 'senior_asset_manager', 'asset_manager')"),
    // Landlord and owner
    rel({ contact_id: "c.id", group_key: "'owner'", role: "'Director'" },
      `FROM crm_contacts c JOIN owners ow ON ow.id = c.company_id WHERE lower(COALESCE(c.role, '')) LIKE '%director%' AND ${visible("c.id", "$1")}`),
    rel({ contact_id: "c.id", group_key: "'owner'", role: "'Linked to this property'" },
      `FROM crm_contact_properties cpx JOIN crm_contacts c ON c.id = cpx.contact_id JOIN owners ow ON ow.id = c.company_id
      WHERE cpx.property_id = $1 AND ${visible("c.id", "$1")}`),
    rel({ contact_id: "c.id", group_key: "'owner'", role: "'In touch with BGP'", visibility: "'staff'" },
      `FROM crm_contacts c JOIN owners ow ON ow.id = c.company_id WHERE c.last_interaction IS NOT NULL AND ${visible("c.id", "$1")}`),
    // Tenants and agents, by unit
    rel({ company_id: "t.resolved_company_id", fallback_id: "CASE WHEN t.resolved_company_id IS NULL THEN 'tenancy:' || t.id END", fallback_name: "t.occupier_name",
      group_key: "'units'", role: "'Tenant'", source: "'Occupier · ' || t.match_source", schedule_row_id: "t.id", unit_name: LABEL("t"), status: "t.status", confirmed: "t.confirmed" },
      "FROM resolved_occupiers t"),
    rel({ contact_id: "c.id", group_key: "'units'", role: "named.role", ...dealFields },
      named([["tenant_contact_id", "Tenant"], ["leasing_agent_contact_id", "Leasing agent"]])),
    rel({ company_id: "d.tenant_id", group_key: "'units'", role: "'Tenant'", source: "'Tenant on a live deal'", ...dealFields },
      `FROM pdeals d WHERE ${LIVE_DEAL} AND d.tenant_id IS NOT NULL`),
    rel({ company_id: "party.company_id", group_key: "'units'", role: "'Tenant'", source: "'Tracker · ' || party.source",
      visibility: "CASE WHEN party.source = 'latest offer' THEN 'staff' ELSE 'all' END", ...trackerFields },
      `FROM tracker_rows a JOIN tracker_parties party ON party.tracker_id = a.tracker_id WHERE ${notOwner("party.company_id")}`),
    briefPerson("units", "'Joint agent'", "bp.role = 'joint_agent'"),
    rel({ contact_id: "c.id", group_key: "'units'", role: "vc.role", visibility: "'staff'", source: "'viewing'", ...trackerFields },
      `FROM unit_viewings v JOIN tracker_rows a ON a.tracker_id = v.unit_id
      CROSS JOIN LATERAL (VALUES (v.contact_id, 'Viewed'), (v.agent_contact_id, 'Agent at a viewing')) vc(contact_id, role)
      JOIN crm_contacts c ON c.id = vc.contact_id
      WHERE v.deleted_at IS NULL AND COALESCE(v.status, '') NOT IN ('cancelled', 'not_leasing')
        AND (c.company_id IS NULL OR ${notOwner("c.company_id")}) AND ${visible("c.id", "$1")}`),
    rel({ contact_id: "c.id", group_key: "'units'", role: "'Offer'", visibility: "'staff'", source: "'offer'", ...trackerFields },
      `FROM unit_offers uo JOIN tracker_rows a ON a.tracker_id = uo.unit_id JOIN crm_contacts c ON c.id = uo.contact_id
      WHERE (c.company_id IS NULL OR ${notOwner("c.company_id")}) AND ${visible("c.id", "$1")}`),
    // Others on deals
    rel({ contact_id: "c.id", group_key: "'deals'", role: "named.role", ...dealFields },
      named([["client_contact_id", "Client"], ["landlord_contact_id", "Landlord"], ["vendor_contact_id", "Vendor"], ["purchaser_contact_id", "Purchaser"],
        ["vendor_agent_contact_id", "Vendor agent"], ["acquisition_agent_contact_id", "Acquisition agent"], ["purchaser_agent_contact_id", "Purchaser agent"]])),
    rel({ company_id: "co.id", group_key: "'deals'", role: "'Agent firm'" },
      `FROM crm_company_properties cp JOIN crm_companies co ON co.id = cp.company_id WHERE cp.property_id = $1 AND ${AGENT_FIRM("co")}`),
    // Advisers
    rel({ contact_id: "c.id", group_key: "'advisers'", role: "COALESCE(NULLIF(btrim(co.company_type), ''), 'Adviser')" },
      `FROM crm_company_properties cp JOIN crm_companies co ON co.id = cp.company_id JOIN crm_contacts c ON c.company_id = co.id
      WHERE cp.property_id = $1 AND ${CONSULTANT("co")} AND NOT ${AGENT_FIRM("co")} AND ${visible("c.id", "$1")}`),
    rel({ contact_id: "c.id", group_key: "'advisers'", role: "COALESCE(NULLIF(btrim(co.company_type), ''), 'Adviser')" },
      `FROM crm_contact_properties cpx JOIN crm_contacts c ON c.id = cpx.contact_id JOIN crm_companies co ON co.id = c.company_id
      WHERE cpx.property_id = $1 AND ${CONSULTANT("co")} AND ${visible("c.id", "$1")}`),
    // Added by the team
    rel({ contact_id: "o.contact_id", group_key: "'added'", role: "'Added by the team'", added_by: "o.created_by" },
      "FROM overrides o WHERE o.kind = 'pin'"),
    rel({ contact_id: "c.id", group_key: "'added'", role: "'Linked to this property'" },
      `FROM crm_contact_properties cpx JOIN crm_contacts c ON c.id = cpx.contact_id LEFT JOIN crm_companies co ON co.id = c.company_id
      WHERE cpx.property_id = $1 AND (c.company_id IS NULL OR ${notOwner("c.company_id")}) AND NOT ${CONSULTANT("co")} AND ${visible("c.id", "$1")}`),
  ];

  return {
    values: [propertyId, scopeCompanyId],
    text: `WITH props AS (SELECT p.id, p.name FROM crm_properties p WHERE p.id = $1),
    owners AS (${OWNERS_SQL}),
    overrides AS (${hasOverrides
      ? "SELECT o.property_id, o.contact_id, o.kind, o.created_by FROM property_contact_overrides o WHERE o.property_id = $1"
      : "SELECT NULL::varchar AS property_id, NULL::varchar AS contact_id, NULL::text AS kind, NULL::varchar AS created_by WHERE false"}),
    schedule_names AS MATERIALIZED (
      SELECT ts.id, ts.property_id, ts.unit_number, ts.premises, ts.letting_tracker_unit_id, ts.property_unit_id, ts.sort_order,
             ${normUnitSql("coalesce(nullif(trim(ts.unit_number), ''), ts.premises)")} AS norm_label
        FROM tenancy_schedule_units ts WHERE ts.property_id = $1
    ),
    tracker_names AS MATERIALIZED (
      SELECT au.id, au.property_id, au.unit_name, au.unit_id, au.tenancy_unit_id, au.deal_id, au.tenant_company_id, au.marketing_status, au.created_at,
             ${normUnitSql("au.unit_name")} AS norm_name
        FROM available_units au WHERE au.property_id = $1
    ),
    tracker_rows AS (
      SELECT au.id AS tracker_id, au.deal_id, au.tenant_company_id, au.marketing_status, au.created_at,
             sched.id AS schedule_row_id, COALESCE(${LABEL("sched")}, au.unit_name) AS label
        FROM tracker_names au
        LEFT JOIN LATERAL (
          SELECT ts.id, ts.unit_number, ts.premises FROM schedule_names ts
           WHERE ts.property_id = au.property_id
             AND (
               ts.id::text = au.tenancy_unit_id::text
               OR ts.letting_tracker_unit_id = au.id
               OR (au.tenancy_unit_id IS NULL AND au.unit_id IS NOT NULL AND ts.property_unit_id = au.unit_id)
               OR (au.tenancy_unit_id IS NULL
                   AND (au.unit_id IS NULL OR ts.property_unit_id IS NULL)
                   AND au.norm_name <> ''
                   AND ts.norm_label = au.norm_name)
             )
           ORDER BY (ts.id::text = au.tenancy_unit_id::text) DESC NULLS LAST, (ts.letting_tracker_unit_id = au.id) DESC NULLS LAST,
                    (ts.property_unit_id = au.unit_id) DESC NULLS LAST, ts.sort_order NULLS LAST, ts.id
           LIMIT 1
        ) sched ON TRUE
    ),
    pdeals AS (
      SELECT d.id, d.name, d.status, d.tenant_id,
        d.client_contact_id, d.tenant_contact_id, d.landlord_contact_id, d.vendor_contact_id, d.purchaser_contact_id,
        d.vendor_agent_contact_id, d.acquisition_agent_contact_id, d.purchaser_agent_contact_id, d.leasing_agent_contact_id,
        COALESCE(CASE WHEN ts.property_id = $1 THEN ts.id END, dtr.schedule_row_id, pus.id) AS schedule_row_id,
        dtr.tracker_id,
        COALESCE(CASE WHEN ts.property_id = $1 THEN ${LABEL("ts")} END, dtr.label, pu.unit_name) AS unit_name,
        $1::text AS here_property_id
      FROM crm_deals d
      LEFT JOIN property_units pu ON pu.id = d.unit_id
      LEFT JOIN tenancy_schedule_units ts ON ts.id = d.tenancy_unit_id
      LEFT JOIN LATERAL (SELECT tr.tracker_id, tr.schedule_row_id, tr.label FROM tracker_rows tr WHERE tr.deal_id = d.id
        ORDER BY tr.created_at DESC NULLS LAST, tr.tracker_id LIMIT 1) dtr ON TRUE
      LEFT JOIN LATERAL (SELECT s.id FROM tenancy_schedule_units s WHERE s.property_id = $1 AND s.property_unit_id = d.unit_id
        ORDER BY s.sort_order NULLS LAST, s.id LIMIT 1) pus ON TRUE
      WHERE d.property_id = $1 OR pu.property_id = $1 OR ts.property_id = $1
    ),
    tracker_parties AS (
      SELECT a.tracker_id, co.id AS company_id, 'recorded brand'::text AS source
      FROM tracker_rows a JOIN crm_companies co ON co.id = a.tenant_company_id WHERE ${ACTIVE_UNIT("a")}
      UNION SELECT a.tracker_id, co.id, 'linked deal' FROM tracker_rows a
      JOIN pdeals d ON d.id = a.deal_id JOIN crm_companies co ON co.id = d.tenant_id WHERE ${ACTIVE_UNIT("a")}
      UNION SELECT a.tracker_id, latest.company_id, 'latest offer' FROM tracker_rows a
      JOIN LATERAL (SELECT o.company_id FROM unit_offers o JOIN crm_companies co ON co.id = o.company_id
        WHERE o.unit_id = a.tracker_id ORDER BY o.offer_date DESC NULLS LAST, o.id LIMIT 1) latest ON true
      WHERE ${ACTIVE_UNIT("a")}
    ),
    ${OCCUPIER_CTES},
    links AS (${links.join("\nUNION ALL\n")}),
    plan_cos AS (
      SELECT c.id FROM crm_companies c
       WHERE c.id IN (SELECT COALESCE(cc.company_id, l.company_id) FROM links l LEFT JOIN crm_contacts cc ON cc.id = l.contact_id)
         AND ${PLAN_COMPANY_PREDICATE}
    ),
    latest_contact AS (
      SELECT DISTINCT ON (c.company_id) c.company_id, c.id, c.name, c.last_interaction FROM crm_contacts c
       WHERE c.last_interaction IS NOT NULL
         AND c.company_id IN (SELECT l.company_id FROM links l WHERE l.contact_id IS NULL AND l.user_id IS NULL)
         AND ${visible("c.id", "$1")}
       ORDER BY c.company_id, c.last_interaction DESC, c.id
    )
    SELECT CASE WHEN u.id IS NOT NULL THEN 'user:' || u.id WHEN c.id IS NOT NULL THEN 'contact:' || c.id
             WHEN co.id IS NOT NULL THEN 'company:' || co.id ELSE l.fallback_id END AS entry_id,
      CASE WHEN u.id IS NOT NULL OR c.id IS NOT NULL OR l.fallback_id LIKE 'brief:%' THEN 'person' ELSE 'company' END AS kind,
      COALESCE(u.name, c.name, co.name, l.fallback_name) AS name,
      CASE WHEN u.id IS NULL THEN c.role END AS job_title,
      COALESCE(u.email, c.email) AS email,
      CASE WHEN u.id IS NOT NULL THEN NULLIF(btrim(u.phone), '') ELSE COALESCE(NULLIF(btrim(c.phone_mobile), ''), NULLIF(btrim(c.phone), '')) END AS phone,
      c.id AS contact_id, u.id AS user_id, co.id AS company_id, COALESCE(co.name, l.firm) AS company_name,
      c.id IS NOT NULL AND ($2::varchar IS NULL OR co.id = $2 OR co.company_type ILIKE 'Agent%' OR ${brandSliceSql}) AS can_open_contact,
      co.id IS NOT NULL AND ($2::varchar IS NULL OR co.id = $2 OR co.company_type ILIKE 'Agent%' OR ${brandSliceSql}
        OR co.agent_type = 'tenant_rep' OR EXISTS (SELECT 1 FROM brand_agent_representations r
          WHERE r.agent_company_id = co.id AND r.end_date IS NULL AND r.agent_type = 'tenant_rep')) AS can_open_company,
      l.group_key, l.role, l.role_source, l.visibility, l.source,
      d.id AS deal_id, d.name AS deal_name, l.schedule_row_id, l.tracker_id, l.unit_name, l.status,
      ab.name AS added_by,
      CASE WHEN pk.id IS NULL THEN 'other' WHEN co.company_type ILIKE 'tenant%' THEN 'brand' ELSE 'landlord' END AS company_kind,
      (c.id IS NOT NULL AND EXISTS (SELECT 1 FROM owners ow WHERE ow.id = c.company_id)) AS owner_person,
      CASE WHEN c.id IS NOT NULL THEN c.last_interaction WHEN u.id IS NULL THEN lc.last_interaction END AS last_interaction,
      CASE WHEN c.id IS NULL AND u.id IS NULL THEN lc.id END AS last_contact_id,
      CASE WHEN c.id IS NULL AND u.id IS NULL THEN lc.name END AS last_contact_name,
      lft.left_at
    FROM links l
    LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN crm_contacts c ON c.id = l.contact_id
    LEFT JOIN crm_companies co ON co.id = COALESCE(c.company_id, l.company_id)
    LEFT JOIN pdeals d ON d.id = l.deal_id
    LEFT JOIN users ab ON ab.id = l.added_by
    LEFT JOIN plan_cos pk ON pk.id = co.id
    LEFT JOIN latest_contact lc ON lc.company_id = co.id
    LEFT JOIN contact_left_companies lft ON lft.contact_id = c.id AND lft.company_id = c.company_id
    WHERE (l.user_id IS NULL OR (u.id IS NOT NULL AND u.is_active IS DISTINCT FROM false AND (l.group_key <> 'bgp' OR ${BGP_USER("u")})))
      AND (c.id IS NOT NULL OR u.id IS NOT NULL OR co.id IS NOT NULL OR l.fallback_id IS NOT NULL)`,
  };
}

const text = (value: unknown): string | null => { const s = String(value ?? "").trim(); return s || null; };
const iso = (value: unknown): string | null => {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : text(value);
};
const SOURCE_RANK = ["assigned", "deals", "account", "brief", "evidence"] as const;

// The rows of the main query as entries, before the client rule.
export function mapPropertyPeopleRows(rows: any[]): Map<string, RecordPersonSource> {
  const entries = new Map<string, RecordPersonSource>();
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.entry_id || !row.name) continue;
    let entry = entries.get(row.entry_id);
    if (!entry) {
      entry = {
        id: row.entry_id, kind: row.kind === "company" ? "company" : "person", name: row.name,
        jobTitle: text(row.job_title), email: text(row.email), phone: text(row.phone), contactId: row.contact_id || null,
        company: row.company_name ? { id: row.company_id || null, name: row.company_name } : null,
        canOpenContact: row.can_open_contact === true, canOpenCompany: row.can_open_company === true,
        group: "added", side: "other", roleOnRecord: "", roleSource: "derived", relationships: [],
        companyKind: row.company_kind === "landlord" || row.company_kind === "brand" ? row.company_kind : "other",
        ownerPerson: row.owner_person === true, source: "evidence", via: null,
        lastContactAt: iso(row.last_interaction),
        lastContactPerson: row.last_contact_id && row.last_contact_name ? { id: row.last_contact_id, name: row.last_contact_name } : null,
        plan: null, addedBy: null, leftAt: iso(row.left_at),
      };
      entries.set(row.entry_id, entry);
      seen.set(row.entry_id, new Set());
    }
    if (row.added_by && !entry.addedBy) entry.addedBy = row.added_by;
    const source = row.source === "assigned" || row.source === "brief" ? row.source : null;
    if (source && SOURCE_RANK.indexOf(source) < SOURCE_RANK.indexOf(entry.source!)) entry.source = source;
    const relation: RecordRelationship = {
      group: row.group_key, role: row.role || "", roleSource: row.role_source === "set" ? "set" : "derived",
      visibility: row.visibility === "staff" ? "staff" : "all", source: row.source || null,
      deal: row.deal_id && row.deal_name ? { id: row.deal_id, name: row.deal_name } : null,
      scheduleRowId: row.schedule_row_id || null, trackerId: row.tracker_id || null, unitName: row.unit_name || null, status: row.status || null,
    };
    const key = JSON.stringify([relation.group, relation.role, relation.roleSource, relation.visibility, relation.source, relation.deal?.id, relation.scheduleRowId, relation.trackerId, relation.unitName, relation.status]);
    if (!seen.get(row.entry_id)!.has(key)) { seen.get(row.entry_id)!.add(key); entry.relationships.push(relation); }
  }
  return entries;
}

// The BGP agents on the property's deals and the owner's account team, as
// the classic card finds them (propertyBgpTeam), added to the BGP group.
export function addBgpTeam(entries: Map<string, RecordPersonSource>, dealAgents: any[], accountTeam: any[]) {
  const explicit = [...entries.values()].filter(e => e.source === "assigned" && e.id.startsWith("user:")).map(e => ({
    id: e.id.slice(5), name: e.name, email: e.email,
    agent_role: e.relationships.find(r => r.source === "assigned")?.role || null,
  }));
  const phones = new Map([...dealAgents, ...accountTeam].map(r => [String(r.id), text(r.phone)]));
  for (const member of propertyBgpTeam(explicit, dealAgents, accountTeam)) {
    const id = `user:${member.user_id}`;
    let entry = entries.get(id);
    if (member.source === "property") { if (entry) entry.via = member.via; continue; }
    if (!entry) {
      entry = {
        id, kind: "person", name: member.name, jobTitle: null, email: member.email, phone: phones.get(member.user_id) || null, contactId: null,
        company: null, canOpenContact: false, canOpenCompany: false,
        group: "bgp", side: "bgp", roleOnRecord: "", roleSource: "derived", relationships: [],
        companyKind: "other", ownerPerson: false, source: member.source, via: member.via,
        lastContactAt: null, lastContactPerson: null, plan: null, addedBy: null, leftAt: null,
      };
      entries.set(id, entry);
    } else {
      if (SOURCE_RANK.indexOf(member.source) < SOURCE_RANK.indexOf(entry.source!)) entry.source = member.source;
      entry.via = entry.via || member.via;
    }
    entry.relationships.push({ group: "bgp", role: member.role, roleSource: "derived", visibility: "all", source: member.source === "deals" ? "on deals" : member.via,
      deal: null, scheduleRowId: null, trackerId: null, unitName: null, status: null });
  }
}

export type PropertyPeopleViewer = { staff: boolean; scopeCompanyId: string | null; brandSliceSql: string };

// As on the classic Contacts card: if BGP's own team cannot be read, the
// rest of the property's people still load.
const bgpTeamUnread = (e: any) => { console.warn("[property-people] BGP team read failed:", e?.message); return { rows: [] as any[] }; };

export async function loadPropertyPeople(db: Db, propertyId: string, viewer: PropertyPeopleViewer): Promise<RecordPeopleReply> {
  const bgpOnly = (sql: string) => `SELECT x.*, bu.phone FROM (${sql}) x JOIN users bu ON bu.id = x.id WHERE ${BGP_USER("bu")}`;
  const [table, dealAgents, accountTeam] = await Promise.all([
    db.query("SELECT to_regclass('property_contact_overrides') IS NOT NULL AS present"),
    db.query(bgpOnly(BGP_DEAL_AGENTS_SQL), [propertyId]).catch(bgpTeamUnread),
    db.query(bgpOnly(BGP_ACCOUNT_TEAM_SQL), [propertyId]).catch(bgpTeamUnread),
  ]);
  const hasOverrides = table.rows[0]?.present === true;
  const query = buildPropertyPeopleQuery(propertyId, viewer.staff ? null : viewer.scopeCompanyId, viewer.staff ? "(FALSE)" : viewer.brandSliceSql, hasOverrides);
  const none = Promise.resolve({ rows: [] as any[] });
  const [main, hidden, scheduleRows] = await Promise.all([
    db.query(query.text, query.values),
    hasOverrides
      ? db.query("SELECT count(*)::int AS n FROM property_contact_overrides WHERE property_id = $1 AND kind = 'hide'", [propertyId])
      : Promise.resolve({ rows: [{ n: 0 }] }),
    viewer.staff ? db.query("SELECT id FROM tenancy_schedule_units WHERE property_id = $1", [propertyId]) : none,
  ]);
  const entries = mapPropertyPeopleRows(main.rows);
  addBgpTeam(entries, dealAgents.rows, accountTeam.rows);

  let plan: "ok" | "unavailable" | undefined;
  if (viewer.staff) {
    const companyIds = [...new Set([...entries.values()].map(e => e.company?.id).filter((id): id is string => !!id))];
    const tenancyUnitIds = scheduleRows.rows.map(r => String(r.id));
    try {
      const plans = await planForCompanies(db, companyIds, { propertyId, tenancyUnitIds });
      for (const entry of entries.values()) {
        const found = entry.company?.id ? plans.get(entry.company.id) : undefined;
        entry.plan = found ? (found as RecordPlan) : null;
      }
      plan = "ok";
    } catch (error: any) {
      console.error("[property-people] CRM plan read failed:", error?.message);
      plan = "unavailable";
    }
  }

  const people = sortRecordPeople([...entries.values()]
    .map(entry => recordPersonForViewer(entry, { staff: viewer.staff }))
    .filter((person): person is RecordPerson => !!person));
  // A company a client login may not open is not named by its id anywhere,
  // the entry's own id included.
  let unopened = 0;
  for (const person of people) {
    if (!viewer.staff && person.kind === "company" && person.id.startsWith("company:") && !person.company?.id) person.id = `company-entry:${++unopened}`;
  }
  return { people, hiddenCount: Number(hidden.rows[0]?.n || 0), viewer: recordViewer(viewer.staff), ...(viewer.staff ? { plan } : {}) };
}

export class PropertyRoleError extends Error { constructor(public status: number, message: string) { super(message); } }

async function withRoleLock<T>(db: TransactionDb, propertyId: string, contactId: string, work: (q: Db) => Promise<T>): Promise<T> {
  const q = await db.connect();
  try {
    await q.query("BEGIN");
    await q.query("SELECT pg_advisory_xact_lock(hashtext($1::text || ':' || $2::text))", [propertyId, contactId]);
    const result = await work(q);
    await q.query("COMMIT");
    return result;
  } catch (error) {
    await q.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    q.release();
  }
}

// A person's role at the property. null clears the role and keeps the person
// on the client's team. Only the owner's own people may be given one.
export async function setPropertyClientRole(db: TransactionDb, propertyId: string, contactId: string, role: unknown) {
  if (role !== null && !(typeof role === "string" && (PROPERTY_CLIENT_ROLES as readonly string[]).includes(role))) {
    throw new PropertyRoleError(400, "Pick a role from the list");
  }
  return withRoleLock(db, propertyId, contactId, async q => {
    const owner = await q.query(`SELECT 1 FROM crm_contacts c WHERE c.id = $2 AND c.company_id IN (${OWNERS_SQL})`, [propertyId, contactId]);
    if (!owner.rows.length) throw new PropertyRoleError(400, "A role at this property is for the owner's own people");
    const updated = await q.query("UPDATE crm_property_clients SET role = $3 WHERE property_id = $1 AND contact_id = $2", [propertyId, contactId, role]);
    if (!updated.rowCount) {
      await q.query(`INSERT INTO crm_property_clients (property_id, contact_id, role)
        SELECT $1::varchar, $2::varchar, $3::text WHERE NOT EXISTS (SELECT 1 FROM crm_property_clients WHERE property_id = $1 AND contact_id = $2)`, [propertyId, contactId, role]);
    }
    return { ok: true, role };
  });
}

export async function removePropertyClientRole(db: TransactionDb, propertyId: string, contactId: string) {
  return withRoleLock(db, propertyId, contactId, async q => {
    const removed = await q.query("DELETE FROM crm_property_clients WHERE property_id = $1 AND contact_id = $2", [propertyId, contactId]);
    return { ok: true, removed: removed.rowCount || 0 };
  });
}

const router = Router();

router.get("/api/properties/:id/people", requireAuth, async (req: Request, res: Response) => {
  try {
    const propertyId = String(req.params.id);
    if (await propertyReadBlocked(req, propertyId)) return res.status(403).json({ message: "This property is not on your account" });
    const { staff } = await contactViewer(req);
    const scopeCompanyId = staff ? null : await resolveCompanyScope(req);
    const brandSliceSql = staff ? "(FALSE)" : await clientBrandSliceSql(scopeCompanyId, "co.id");
    res.json(await loadPropertyPeople(pool, propertyId, { staff, scopeCompanyId, brandSliceSql }));
  } catch (error: any) {
    console.error("[property-people]", error?.message);
    res.status(500).json({ message: "The people on this property could not be loaded" });
  }
});

router.put("/api/properties/:id/people/:contactId/client-role", requireAuth, async (req: Request, res: Response) => {
  try {
    const { staff } = await contactViewer(req);
    if (!staff) return res.status(403).json({ message: "Only BGP staff can set a role at a property" });
    if (!req.body || !("role" in req.body)) return res.status(400).json({ message: "Pick a role from the list" });
    res.json(await setPropertyClientRole(pool, String(req.params.id), String(req.params.contactId), req.body.role));
  } catch (error: any) {
    if (error instanceof PropertyRoleError) return res.status(error.status).json({ message: error.message });
    console.error("[property-people] role", error?.message);
    res.status(500).json({ message: "The role could not be saved" });
  }
});

router.delete("/api/properties/:id/people/:contactId/client-role", requireAuth, async (req: Request, res: Response) => {
  try {
    const { staff } = await contactViewer(req);
    if (!staff) return res.status(403).json({ message: "Only BGP staff can change the client's team" });
    res.json(await removePropertyClientRole(pool, String(req.params.id), String(req.params.contactId)));
  } catch (error: any) {
    console.error("[property-people] remove role", error?.message);
    res.status(500).json({ message: "The person could not be removed from the client's team" });
  }
});

export const propertyPeopleRouter = router;
