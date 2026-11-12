// The client Agents page in three sections (Woody, 2026-11-12: "CRM for
// agents a mess.. needs sorting out for landsec its Joint agents ie us and
// then the other joint agents and then the rest are tenant rep agents").
//
//   BGP           — the BGP people on the account. For Landsec: the names on
//                   the personnel sheet (shared/landsec-personnel.ts), shown
//                   ONLY where a current active staff record matches, with
//                   every detail from HR (users + staff_profiles). For other
//                   clients: the client's BGP team board and property agents
//                   (the same people /api/client-teams already shows them).
//   Joint agents  — Landsec only: the other joint agency people per scheme,
//                   from the personnel sheet and the joint-agent logins.
//   Tenant reps   — the existing directory (server/client-agent-directory.ts,
//                   rule unchanged), minus anyone already shown above.
//
// Nothing here is typed in: a name with no matching record shows without
// contact details, and a firm name only ever comes from recorded data.
import type { Request } from "express";
import { LANDSEC_SCHEME_TEAMS, type LandsecSchemeTeam } from "../shared/landsec-personnel";
import type {
  ClientAgentDirectoryEntry, ClientAgentsOverview, ClientAgentScheme, ClientBgpPerson,
  ClientJointAgentFirm, ClientJointAgentPerson, ClientJointFirmSource,
} from "../shared/client-agent-directory";

export interface SchemeRef { key: string; name: string; group: string }

export interface StaffRecord {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
}

export interface JointAgentLogin {
  name: string;
  email: string | null;
  phone: string | null;
  firm: string | null;
  schemes: string[];
}

export interface JointAgentContact {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  companyIsAgent: boolean;
}

// A person already listed in the BGP or Joint agents section.
export interface ShownPerson { name: string; emails: string[]; firms: string[] }

export const personKey = (value: unknown) => String(value || "")
  .normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

const firmKey = (value: unknown) => String(value || "").toLowerCase()
  .replace(/\b(ltd|limited|llp|plc|inc|uk)\b\.?/g, " ").replace(/[^a-z0-9]/g, "");

export function sameFirm(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = firmKey(a), kb = firmKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return Math.min(ka.length, kb.length) >= 4 && (ka.startsWith(kb) || kb.startsWith(ka));
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "person";
const clean = (value: unknown) => { const s = String(value ?? "").trim(); return s || null; };
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
// "Managing Director - Board" style suffixes are dropped, as on the website
// team list and the business cards (server/website-content.ts).
const cleanTitle = (value: unknown) => clean(String(value || "").split(/\s+[-–—|]\s+/)[0]);

// The personnel sheet has one row for the London offices; the instruction
// lists them as four schemes. The sheet's own matcher names each of them
// (One New Change, New Street Square, Lucent, and Cardinal Place / 123
// Victoria / Victoria Street for the Victoria scheme).
const TEAM_KEY_FOR_SCHEME: Record<string, string> = {
  "one-new-change": "london-offices",
  "new-street-square": "london-offices",
  lucent: "london-offices",
  victoria: "london-offices",
};

export function schemeTeam(schemeKey: string): LandsecSchemeTeam | null {
  const key = TEAM_KEY_FOR_SCHEME[schemeKey] || schemeKey;
  return LANDSEC_SCHEME_TEAMS.find(t => t.key === key) || null;
}

// docs/landsec-pitch-plan.md ("From last year's deck"): the joint agent is
// "CBRE on most; Starka at Liverpool ONE; Culverwell at Buchanan Galleries".
// Applied only to a scheme whose personnel row names a joint agency team.
const NAMED_JOINT_AGENCY: Record<string, string> = { "liverpool-one": "Starka", "buchanan-galleries": "Culverwell" };
const JOINT_AGENCY_ON_MOST = "CBRE";

const FIRM_SOURCE_ORDER: ClientJointFirmSource[] = ["login", "crm", "scheme"];

export function namedJointAgencyFor(schemeKey: string): string | null {
  const team = schemeTeam(schemeKey);
  if (!team || team.jointAgents.length === 0) return null;
  return NAMED_JOINT_AGENCY[schemeKey] || JOINT_AGENCY_ON_MOST;
}

// BGP people on the Landsec schemes. A sheet name is dropped unless exactly
// one current staff record carries it; the record supplies every detail.
export function buildLandsecBgpTeam(schemes: SchemeRef[], staff: StaffRecord[]): ClientBgpPerson[] {
  const staffByName = new Map<string, StaffRecord[]>();
  for (const s of staff) {
    const k = personKey(s.name);
    if (k) staffByName.set(k, [...(staffByName.get(k) || []), s]);
  }
  const people = new Map<string, ClientBgpPerson>();
  const add = (name: string, schemeKey: string, role: "lead" | "support") => {
    const k = personKey(name);
    const hits = staffByName.get(k) || [];
    if (hits.length !== 1) return;
    let person = people.get(k);
    if (!person) {
      const hr = hits[0];
      person = {
        key: slug(hr.name), name: hr.name, title: hr.title, email: hr.email, phone: hr.phone,
        photoUrl: hr.photoUrl, lead: [], support: [], isLead: false, covers: [],
      };
      people.set(k, person);
    }
    if (role === "lead") {
      if (!person.lead.includes(schemeKey)) person.lead.push(schemeKey);
      person.support = person.support.filter(s => s !== schemeKey);
    } else if (!person.lead.includes(schemeKey) && !person.support.includes(schemeKey)) {
      person.support.push(schemeKey);
    }
  };
  for (const scheme of schemes) {
    const team = schemeTeam(scheme.key);
    if (!team) continue;
    for (const name of team.bgpLead) add(name, scheme.key, "lead");
    for (const name of team.bgpSupport) add(name, scheme.key, "support");
  }
  const result = [...people.values()];
  for (const p of result) p.isLead = p.lead.length > 0;
  return result.sort((a, b) => Number(b.isLead) - Number(a.isLead) || byName(a, b));
}

// The other joint agency people, grouped by firm. A person's firm is, in
// order: the firm on their joint-agent login; else the named joint agency of
// their scheme(s) when those all name one firm; else the CRM company of a
// matching contact at an agent firm; else "firm not confirmed" (name null).
// A CRM contact is only taken as the same person when its email is the
// login's, or it is the one contact of that name at the expected firm.
export function buildLandsecJointAgents(
  schemes: SchemeRef[],
  logins: JointAgentLogin[],
  contacts: JointAgentContact[],
): ClientJointAgentFirm[] {
  const order = new Map(schemes.map((s, i) => [s.key, i]));
  const drafts = new Map<string, { name: string; schemes: Set<string>; login: JointAgentLogin | null }>();
  for (const scheme of schemes) {
    for (const name of schemeTeam(scheme.key)?.jointAgents || []) {
      const k = personKey(name);
      if (!k) continue;
      if (!drafts.has(k)) drafts.set(k, { name, schemes: new Set(), login: null });
      drafts.get(k)!.schemes.add(scheme.key);
    }
  }
  for (const login of logins) {
    const k = personKey(login.name);
    if (!k) continue;
    if (!drafts.has(k)) drafts.set(k, { name: login.name, schemes: new Set(), login: null });
    const d = drafts.get(k)!;
    if (!d.login) d.login = login;
    for (const s of login.schemes || []) if (order.has(s)) d.schemes.add(s);
  }

  const firms: ClientJointAgentFirm[] = [];
  const usedKeys = new Set<string>();
  for (const [k, d] of drafts) {
    const personSchemes = [...d.schemes].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const schemeFirms = [...new Set(personSchemes.map(namedJointAgencyFor).filter((f): f is string => !!f))];
    const schemeFirm = schemeFirms.length === 1 ? schemeFirms[0] : null;
    const loginFirm = clean(d.login?.firm);
    const expected = loginFirm || schemeFirm;
    const loginEmail = clean(d.login?.email)?.toLowerCase() || null;

    const emailHits = loginEmail ? contacts.filter(c => clean(c.email)?.toLowerCase() === loginEmail) : [];
    const nameHits = contacts.filter(c => personKey(c.name) === k);
    const firmHits = expected
      ? nameHits.filter(c => sameFirm(c.companyName, expected))
      : nameHits.filter(c => c.companyIsAgent && clean(c.companyName));
    const contact = emailHits.length === 1 ? emailHits[0] : firmHits.length === 1 ? firmHits[0] : null;

    let firmName: string | null = null;
    const sources: ClientJointFirmSource[] = [];
    if (loginFirm) {
      firmName = schemeFirm && sameFirm(schemeFirm, loginFirm) ? schemeFirm : loginFirm;
      sources.push("login");
      if (schemeFirm && sameFirm(schemeFirm, loginFirm)) sources.push("scheme");
    } else if (schemeFirm) {
      firmName = schemeFirm;
      sources.push("scheme");
    } else if (contact && contact.companyIsAgent && clean(contact.companyName)) {
      firmName = clean(contact.companyName);
    }
    if (contact && firmName && sameFirm(contact.companyName, firmName)) sources.push("crm");

    const email = clean(contact?.email) || clean(d.login?.email);
    const phone = clean(contact?.phone) || clean(d.login?.phone);
    let key = slug(d.name);
    for (let n = 2; usedKeys.has(key); n++) key = `${slug(d.name)}-${n}`;
    usedKeys.add(key);
    const person: ClientJointAgentPerson = {
      key, name: clean(contact?.name) || d.name, role: clean(contact?.role), email, phone, schemes: personSchemes,
      detailSource: !email && !phone ? null : contact && (clean(contact.email) || clean(contact.phone)) ? "crm" : "login",
      firmSources: FIRM_SOURCE_ORDER.filter(src => sources.includes(src)),
    };

    let firm = firms.find(f => (firmName ? !!f.name && sameFirm(f.name, firmName) : f.name === null));
    if (!firm) {
      firm = { key: firmName ? slug(firmName) : "unconfirmed", name: firmName, firmSources: [], schemes: [], people: [] };
      firms.push(firm);
    }
    firm.people.push(person);
    for (const s of sources) if (!firm.firmSources.includes(s)) firm.firmSources.push(s);
    for (const s of personSchemes) if (!firm.schemes.includes(s)) firm.schemes.push(s);
  }
  for (const firm of firms) {
    firm.firmSources = FIRM_SOURCE_ORDER.filter(src => firm.firmSources.includes(src));
    firm.people.sort(byName);
    firm.schemes.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }
  return firms.sort((a, b) => Number(a.name === null) - Number(b.name === null)
    || b.schemes.length - a.schemes.length
    || String(a.name).localeCompare(String(b.name), "en", { sensitivity: "base" }));
}

// Same person as one already shown? The same email always is. The same name
// is too, unless the two are at different known firms (then it is a
// namesake, and stays listed). With the firm unknown on either side the
// name alone decides.
function isShown(contact: { name: string; email: string | null }, firmName: string | null, shown: ShownPerson[]): boolean {
  const email = clean(contact.email)?.toLowerCase() || null;
  const k = personKey(contact.name);
  return shown.some(p => {
    if (email && p.emails.includes(email)) return true;
    if (!k || personKey(p.name) !== k) return false;
    if (!firmName || p.firms.length === 0) return true;
    return p.firms.some(f => sameFirm(f, firmName));
  });
}

// The tenant rep directory without the people listed in the sections above.
// A firm keeps its other named agents and its firm-level brand links; a firm
// (or an unconfirmed-firm person) left with nothing is dropped.
export function withoutShownPeople(entries: ClientAgentDirectoryEntry[], shown: ShownPerson[]): ClientAgentDirectoryEntry[] {
  if (shown.length === 0) return entries;
  const result: ClientAgentDirectoryEntry[] = [];
  for (const entry of entries) {
    const firmName = entry.kind === "firm" ? entry.name : null;
    const contacts = entry.contacts.filter(c => !isShown(c, firmName, shown));
    if (contacts.length === entry.contacts.length) { result.push(entry); continue; }
    if (entry.kind === "contact") continue;
    const namedBefore = new Set(entry.contacts.flatMap(c => c.represents.map(b => b.brandId)));
    const keep = new Set(contacts.flatMap(c => c.represents.map(b => b.brandId)));
    const represents = entry.represents.filter(b => keep.has(b.brandId) || !namedBefore.has(b.brandId));
    if (represents.length === 0) continue;
    result.push({ ...entry, contacts, represents });
  }
  return result;
}

const BGP_FIRM_NAMES = ["BGP", "Bruce Gillingham Pollard"];

// Website headshots are public files; any other stored photo path stays out
// of a client's response.
const publicPhoto = (value: unknown) => {
  const s = String(value || "");
  return /^\/headshots\/[\w.-]+$/.test(s) ? s : null;
};

export async function loadClientAgentsOverview(req: Request): Promise<ClientAgentsOverview> {
  const { pool } = await import("./db");
  const { resolveCompanyScope, clientBrandSliceSql, NO_ACCESS_SCOPE } = await import("./company-scope");
  const { buildClientAgentDirectoryQuery, mapClientAgentDirectoryRows } = await import("./client-agent-directory");
  const { isLandsecCompany, resolveLandsecPortfolio, LANDSEC_SCHEMES } = await import("./landsec-schemes");

  // Same scope and brand slice as GET /api/client/agent-directory.
  const requirementScope = await resolveCompanyScope(req);
  const brandScope = requirementScope || ((req.query as any).companyId ? String((req.query as any).companyId) : null);
  const brandSliceSql = await clientBrandSliceSql(brandScope);
  const query = buildClientAgentDirectoryQuery(brandSliceSql, requirementScope, NO_ACCESS_SCOPE);
  const directory = mapClientAgentDirectoryRows((await pool.query(query.text, query.values)).rows);

  const companyId = brandScope && brandScope !== NO_ACCESS_SCOPE ? brandScope : null;
  const landsec = !!companyId && (await isLandsecCompany(companyId));

  // Current BGP staff, from HR. Leavers, inactive logins, client logins and
  // non-BGP addresses never match.
  const staffRows = companyId ? (await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.profile_pic_url, sp.title
       FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.id
      WHERE COALESCE(u.is_active, true)
        AND COALESCE(u.role, '') <> 'Client'
        AND lower(u.email) LIKE '%@brucegillinghampollard.com'
        AND COALESCE(sp.status, 'active') <> 'leaver'
        AND (sp.end_date IS NULL OR sp.end_date !~ '^\\d{4}-\\d{2}-\\d{2}' OR sp.end_date > to_char(now(), 'YYYY-MM-DD'))`
  )).rows : [];
  const staffRecord = (u: any): StaffRecord => ({
    name: String(u.name || "").trim(), title: cleanTitle(u.title) || cleanTitle(u.role),
    email: clean(u.email), phone: clean(u.phone), photoUrl: publicPhoto(u.profile_pic_url),
  });

  let schemes: ClientAgentScheme[] = [];
  let bgp: ClientBgpPerson[] = [];
  let jointAgents: ClientJointAgentFirm[] = [];
  const schemeByProperty = new Map<string, string>();

  if (landsec && companyId) {
    const refs: SchemeRef[] = LANDSEC_SCHEMES.map(s => ({ key: s.key, name: s.name, group: s.group }));
    const portfolio = await resolveLandsecPortfolio(companyId);
    schemes = refs;
    for (const s of portfolio.schemes) for (const p of s.properties) schemeByProperty.set(p.id, s.key);
    bgp = buildLandsecBgpTeam(refs, staffRows.map(staffRecord).filter(s => s.name));

    // Joint-agent logins (landsec_access): name and email from the login,
    // firm and schemes from the access row. The table may be missing.
    const logins: JointAgentLogin[] = (await pool.query(
      `SELECT u.name, u.email, u.phone, a.firm, a.schemes
         FROM landsec_access a JOIN users u ON u.id = a.user_id
        WHERE a.landsec_role = 'joint_agent' AND COALESCE(u.is_active, true) AND u.role = 'Client'`
    ).catch(() => ({ rows: [] as any[] }))).rows
      .map((r: any) => ({ name: String(r.name || "").trim(), email: clean(r.email), phone: clean(r.phone), firm: clean(r.firm), schemes: r.schemes || [] }))
      .filter((l: JointAgentLogin) => l.name);

    const names = new Set<string>(logins.map(l => personKey(l.name)));
    for (const s of refs) for (const n of schemeTeam(s.key)?.jointAgents || []) names.add(personKey(n));
    const emails = logins.map(l => l.email?.toLowerCase()).filter((e): e is string => !!e);
    const contacts: JointAgentContact[] = names.size === 0 ? [] : (await pool.query(
      `SELECT ct.name, ct.role, ct.email, COALESCE(NULLIF(ct.phone_mobile, ''), ct.phone) AS phone,
              c.name AS company_name, c.company_type
         FROM crm_contacts ct
         LEFT JOIN crm_companies c ON c.id = ct.company_id AND c.merged_into_id IS NULL
        WHERE regexp_replace(lower(ct.name), '[^a-z]', '', 'g') = ANY($1::text[])
           OR (ct.email IS NOT NULL AND lower(ct.email) = ANY($2::text[]))`,
      [[...names].filter(Boolean), emails]
    )).rows.map((r: any) => ({
      name: String(r.name || "").trim(), role: clean(r.role), email: clean(r.email), phone: clean(r.phone),
      companyName: clean(r.company_name), companyIsAgent: /^agent/i.test(String(r.company_type || "")),
    }));
    jointAgents = buildLandsecJointAgents(refs, logins, contacts);
  } else if (companyId) {
    // Another client's BGP team: the team board plus the agents on their
    // properties, read across same-named sibling company rows as
    // /api/client-teams does. Current staff only.
    const staffById = new Map<string, any>(staffRows.map((u: any) => [u.id, u]));
    const team = await pool.query(
      `WITH board_companies AS (
         SELECT id FROM crm_companies WHERE id = $1
         UNION
         SELECT c2.id FROM crm_companies c1
           JOIN crm_companies c2 ON lower(trim(c2.name)) = lower(trim(c1.name)) AND c2.id <> c1.id
          WHERE c1.id = $1 AND c2.merged_into_id IS NULL
       ), scoped_props AS (
         SELECT id, name FROM crm_properties WHERE landlord_id IN (SELECT id FROM board_companies)
         UNION
         SELECT p.id, p.name FROM crm_company_properties cp JOIN crm_properties p ON p.id = cp.property_id
          WHERE cp.company_id IN (SELECT id FROM board_companies)
       ), agent_props AS (
         SELECT pa.user_id, pa.role, s.name AS property_name
           FROM crm_property_agents pa JOIN scoped_props s ON s.id = pa.property_id
       ), members AS (
         SELECT m.user_id, bool_or(COALESCE(m.is_lead, false)) AS is_lead, MIN(COALESCE(m.sort_order, 0)) AS sort_order
           FROM crm_client_team_members m
          WHERE m.client_company_id IN (SELECT id FROM board_companies) AND m.user_id IS NOT NULL
          GROUP BY m.user_id
         UNION ALL
         SELECT ap.user_id, bool_or(ap.role = 'Lead'), 999
           FROM agent_props ap
          WHERE ap.user_id IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM crm_client_team_members m2
                   WHERE m2.client_company_id IN (SELECT id FROM board_companies) AND m2.user_id = ap.user_id)
          GROUP BY ap.user_id
       )
       SELECT mem.user_id, mem.is_lead, mem.sort_order,
              (SELECT array_agg(DISTINCT ap.property_name ORDER BY ap.property_name) FROM agent_props ap
                WHERE ap.user_id = mem.user_id) AS properties
         FROM members mem
        ORDER BY mem.is_lead DESC, mem.sort_order`,
      [companyId]
    );
    const usedKeys = new Set<string>();
    for (const row of team.rows) {
      const u = staffById.get(row.user_id);
      if (!u) continue;
      const hr = staffRecord(u);
      if (!hr.name) continue;
      let key = slug(hr.name);
      for (let n = 2; usedKeys.has(key); n++) key = `${slug(hr.name)}-${n}`;
      usedKeys.add(key);
      bgp.push({
        key, name: hr.name, title: hr.title, email: hr.email, phone: hr.phone, photoUrl: hr.photoUrl,
        lead: [], support: [], isLead: !!row.is_lead, covers: (row.properties || []).filter(Boolean),
      });
    }
  }

  const shown: ShownPerson[] = [
    ...bgp.map(p => ({ name: p.name, emails: p.email ? [p.email.toLowerCase()] : [], firms: BGP_FIRM_NAMES })),
    ...jointAgents.flatMap(f => f.people.map(p => ({
      name: p.name, emails: p.email ? [p.email.toLowerCase()] : [], firms: f.name ? [f.name] : [],
    }))),
  ];

  const tenantReps = withoutShownPeople(directory, shown);

  // Which schemes each listed brand is being targeted at: every target
  // record at the scheme's properties (the Brand Directory's "targeted at"
  // sources, without its cap of eight per brand). Only brands already in the
  // tenant rep list are read, so the brand slice is the one applied above.
  const brandSchemes: Record<string, string[]> = {};
  const brandIds = [...new Set(tenantReps.flatMap(e => e.represents.map(b => b.brandId)))];
  if (schemeByProperty.size > 0 && brandIds.length > 0) {
    const targets = await pool.query(
      `SELECT cid AS company_id, u.property_id
         FROM leasing_schedule_units u CROSS JOIN LATERAL unnest(u.target_company_ids) AS cid
        WHERE u.property_id = ANY($1::text[]) AND cid = ANY($2::text[])
       UNION
       SELECT tt.company_id, u2.property_id
         FROM target_tenants tt JOIN leasing_schedule_units u2 ON u2.id = tt.unit_id
        WHERE u2.property_id = ANY($1::text[]) AND tt.company_id = ANY($2::text[]) AND COALESCE(tt.status, '') <> 'rejected'
       UNION
       SELECT uto.company_id, au.property_id
         FROM unit_target_operators uto
         JOIN unit_briefs ub ON ub.id = uto.brief_id
         JOIN available_units au ON au.id = ub.unit_id
        WHERE au.property_id = ANY($1::text[]) AND uto.company_id = ANY($2::text[]) AND COALESCE(uto.status, '') NOT IN ('Passed')`,
      [[...schemeByProperty.keys()], brandIds]
    );
    const order = new Map(schemes.map((s, i) => [s.key, i]));
    for (const row of targets.rows) {
      const key = schemeByProperty.get(row.property_id);
      if (!key) continue;
      const list = brandSchemes[row.company_id] || (brandSchemes[row.company_id] = []);
      if (!list.includes(key)) list.push(key);
    }
    for (const list of Object.values(brandSchemes)) list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  return {
    viewer: landsec ? "landsec" : "client",
    schemes, bgp, jointAgents, tenantReps, brandSchemes,
  };
}
