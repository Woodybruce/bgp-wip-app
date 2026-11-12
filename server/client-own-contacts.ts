// The client "<client> Contacts" tab (Woody, 2026-11-12: "what is this
// madeness" — the tab listed all 3,326 contacts the login may see). It now
// lists ONLY the people recorded at the client's own company:
//
//   own company   — the login's scope company row, plus a row the data links
//                   to it (same name, the same Landsec name rule the rest of
//                   the app uses, or a recorded parent / subsidiary) WHERE
//                   GET /api/crm/contacts already serves that row's contacts
//                   to this login. Nothing is shown that the list route does
//                   not already return.
//   Landsec       — the people are grouped from the team sheet
//                   (shared/landsec-personnel.ts): Leasing, Asset management,
//                   then everyone else. A sheet name with no contact record
//                   is listed without contact details. The sheet reaches a
//                   Landsec viewer only (isLandsecCompany, as on the Agents
//                   page).
//   elsewhere     — a record on the client's own row whose email address is at
//                   another organisation is kept, but listed apart, is not
//                   counted as one of the client's people and is never taken
//                   for a person on the team sheet.
//   mailboxes     — shared mailboxes and system addresses are kept, at the end.
//
// Brand contacts stay on brand pages and agents on the Agents tab.
import type { Request } from "express";
import type { ClientAgentScheme, ClientOwnContacts, ClientOwnPerson, ClientOwnRole } from "../shared/client-agent-directory";
import { LANDSEC_TEAM_SHEET_DATE } from "../shared/landsec-personnel";
import { personKey, schemeTeam, type SchemeRef } from "./client-agents-overview";

export interface OwnContactRow {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  updatedAt: Date | string | null;
  companyId: string;
  companyName: string | null; // null when it is the client's own row
  editable: boolean;
}

const clean = (value: unknown) => { const s = String(value ?? "").trim(); return s || null; };
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
const letters = (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z]/g, "");
const localPart = (email: string | null) => (email && email.includes("@") ? email.slice(0, email.indexOf("@")).replace(/\+.*$/, "") : "");
const time = (value: Date | string | null) => (value ? new Date(value).getTime() || 0 : 0);
const emailDomain = (email: string | null | undefined) => {
  const e = String(email || "").trim().toLowerCase();
  return e.lastIndexOf("@") > 0 ? e.slice(e.lastIndexOf("@") + 1).replace(/[^a-z0-9.-]/g, "") : "";
};

// Whether an email address is the client's own: at the company's recorded
// domain, at a domain named after the company (landsec.com.au and
// landsec-uandi.com for Landsec), or at the commonest domain on its own row.
// No address counts as its own: there is nothing to tell by.
export function ownEmailTest(rows: OwnContactRow[], companyDomain: string | null, names: (string | null)[]): (email: string | null) => boolean {
  const known = new Set<string>();
  const recorded = String(companyDomain || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  if (recorded.includes(".")) known.add(recorded);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const d = r.companyName === null ? emailDomain(r.email) : "";
    if (d) counts.set(d, (counts.get(d) || 0) + 1);
  }
  const most = Math.max(0, ...counts.values());
  for (const [d, n] of counts) if (n === most) known.add(d);
  const stems = names.map(letters).filter(stem => stem.length >= 4);
  return email => {
    const d = emailDomain(email);
    if (!d || known.has(d) || [...known].some(k => d.endsWith(`.${k}`))) return true;
    return d.split(".").slice(0, -1).some(label => stems.some(stem => letters(label).startsWith(stem)));
  };
}

// Words a shared mailbox or system address is made of. A name or address
// counts only when it is made of nothing else and has at least one of the
// longer words, so "Na Do" or "Al Press-Jones" stay people.
const MAILBOX_WORDS = [
  "accounts?", "payables?", "receivables?", "payments?", "remittances?", "invoices?", "invoicing", "billing",
  "finance", "ledger", "purchase", "sales", "credit", "control", "statements?", "info", "information", "admin",
  "administrator", "enquiry", "enquiries", "inquiry", "inquiries", "hello", "contact", "office", "reception",
  "mailbox", "mailer", "daemon", "postmaster", "webmaster", "support", "helpdesk", "servicedesk", "services?",
  "customer", "reply", "noreply", "donotreply", "notifications?", "alerts?", "system", "automated", "general",
  "shared", "files?", "unknown", "undefined", "newsletter", "marketing", "press", "media", "careers", "jobs",
  "recruitment", "lettings", "leasing",
];
const MAILBOX_SHORT_WORDS = ["no", "do", "not", "run", "team", "mail", "email", "post", "news", "help", "test", "auto", "desk", "the", "and", "uk", "ap", "ar", "hr", "it", "pr"];
const MAILBOX_ONLY = new RegExp(`^(?:${[...MAILBOX_WORDS, ...MAILBOX_SHORT_WORDS].join("|")})+$`);
const MAILBOX_WORD = new RegExp(MAILBOX_WORDS.join("|"));
const mailboxText = (value: string) => { const s = letters(value); return !!s && s.length <= 40 && MAILBOX_ONLY.test(s) && MAILBOX_WORD.test(s); };

// A record that is a shared mailbox or a system address, not a person:
// "Accountspayable", accounts.payable@, no-reply@, "A1propertysmart (info@)",
// "898 02 File", or a name that is only a one-word email local part
// ("jsmith" for jsmith@). A first.last address is a person whose name was
// not typed in, and stays with the people.
export function isSharedMailbox(name: string | null | undefined, email: string | null | undefined): boolean {
  const n = String(name || "").trim();
  const local = localPart(clean(email)?.toLowerCase() || null);
  if (local && mailboxText(local)) return true;
  if (!/\p{L}/u.test(n)) return true;
  if (n.includes("@")) {
    const before = n.slice(0, n.indexOf("@")).split(/[^a-z0-9._-]+/i).pop() || "";
    return !before || mailboxText(before) || !/^[a-z]{2,}([._-][a-z]{2,})+$/i.test(before);
  }
  if (mailboxText(n)) return true;
  const plain = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !!local && !/\s/.test(n) && !/[._-]/.test(local) && plain(n) === plain(local) && (n === n.toLowerCase() || /\d/.test(n));
}

// The list route's companyId narrowing keeps one record per name at a
// company, the most recently updated (storage.getCrmContacts). Same here.
function onePerName(rows: OwnContactRow[]): OwnContactRow[] {
  const seen = new Map<string, OwnContactRow>();
  for (const r of rows) {
    const key = `${r.name.trim().toLowerCase()}__${r.companyId}`;
    const existing = seen.get(key);
    if (!existing || time(r.updatedAt) > time(existing.updatedAt)) seen.set(key, r);
  }
  return [...seen.values()];
}

// One listed person from the record(s) that are that person. The first
// record supplies the row; a detail it lacks is taken from the others.
function toPerson(records: OwnContactRow[], sheet?: { name: string; roles: ClientOwnRole[]; schemes: string[] }): ClientOwnPerson {
  const first = records[0];
  const pick = (get: (r: OwnContactRow) => string | null) => { for (const r of records) { const v = clean(get(r)); if (v) return v; } return null; };
  // The sheet's spelling stands unless the record has the same name typed
  // out ("rob.hardie" and "Gemma" for gemma.casey@ read as the sheet has them).
  const name = first && (!sheet || (personKey(first.name) === personKey(sheet.name) && typedName(first))) ? first.name.trim() : sheet!.name;
  return {
    key: first ? first.id : `sheet:${personKey(sheet!.name)}`,
    contactId: first ? first.id : null,
    name,
    title: pick(r => r.role),
    companyId: first ? first.companyId : null,
    company: first ? first.companyName : null,
    email: pick(r => r.email),
    phone: pick(r => r.phone),
    editable: !!first?.editable,
    // What that one record itself holds: the edit form opens on these, so
    // saving unchanged never writes the sheet's spelling or another
    // record's details onto it.
    record: first ? { name: first.name.trim(), title: clean(first.role), email: clean(first.email), phone: clean(first.phone) } : null,
    roles: sheet?.roles || [],
    schemes: sheet?.schemes || [],
  };
}

const typedName = (r: OwnContactRow) => /\s/.test(r.name.trim());
const detailRank = (r: OwnContactRow) => Number(!!clean(r.email)) * 4 + Number(!!clean(r.phone)) * 2 + Number(!!clean(r.role));

// Records sharing an email address are one person (or one mailbox): the
// fullest name leads.
function mergeByEmail(rows: OwnContactRow[]): ClientOwnPerson[] {
  const groups = new Map<string, OwnContactRow[]>();
  for (const r of rows) {
    const key = clean(r.email)?.toLowerCase() || `id:${r.id}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  return [...groups.values()].map(group => toPerson([...group].sort((a, b) =>
    b.name.trim().split(/\s+/).length - a.name.trim().split(/\s+/).length || detailRank(b) - detailRank(a) || time(b.updatedAt) - time(a.updatedAt))));
}

export interface OwnPeopleGroups {
  leasing: ClientOwnPerson[];
  assetManagement: ClientOwnPerson[];
  others: ClientOwnPerson[];
  elsewhere: ClientOwnPerson[];
  mailboxes: ClientOwnPerson[];
}

// schemes = the Landsec scheme registry for a Landsec viewer, null for any
// other client (no team sheet is read and no groups are made). isOwnEmail
// (ownEmailTest) tells the client's own addresses from another organisation's.
export function buildOwnPeople(rows: OwnContactRow[], schemes: SchemeRef[] | null, isOwnEmail: (email: string | null) => boolean = () => true): OwnPeopleGroups {
  const records = onePerName(rows.filter(r => r.name && r.name.trim()));
  // Recorded on the client's own row with another organisation's address. A
  // person at a linked company already has that company's name under theirs.
  const outside = (r: OwnContactRow) => r.companyName === null && !isOwnEmail(r.email);
  const leasing: ClientOwnPerson[] = [];
  const assetManagement: ClientOwnPerson[] = [];
  const taken = new Set<string>();

  if (schemes) {
    const order = new Map(schemes.map((s, i) => [s.key, i]));
    const sheet = new Map<string, { name: string; roles: Set<ClientOwnRole>; schemes: Set<string> }>();
    const add = (name: string, role: ClientOwnRole, schemeKey: string) => {
      const k = personKey(name);
      if (!k) return;
      if (!sheet.has(k)) sheet.set(k, { name, roles: new Set(), schemes: new Set() });
      const entry = sheet.get(k)!;
      entry.roles.add(role);
      entry.schemes.add(schemeKey);
    };
    for (const scheme of schemes) {
      const team = schemeTeam(scheme.key);
      if (!team) continue;
      for (const name of team.leasing) add(name, "leasing", scheme.key);
      for (const name of team.assetManagers) add(name, "asset_management", scheme.key);
    }
    // A record is the sheet's person when its name is the sheet name, or its
    // email address is that name (mark.warne@ for Mark Warne).
    const matches = new Map<string, OwnContactRow[]>();
    for (const r of records) {
      if (outside(r)) continue;
      const byNameKey = personKey(r.name);
      const byEmailKey = letters(localPart(clean(r.email)));
      const k = sheet.has(byNameKey) ? byNameKey : sheet.has(byEmailKey) ? byEmailKey : null;
      if (!k) continue;
      matches.set(k, [...(matches.get(k) || []), r]);
      taken.add(r.id);
    }
    for (const [k, entry] of sheet) {
      const found = [...(matches.get(k) || [])].sort((a, b) =>
        Number(personKey(b.name) === k && typedName(b)) - Number(personKey(a.name) === k && typedName(a))
        || detailRank(b) - detailRank(a) || time(b.updatedAt) - time(a.updatedAt));
      const roles: ClientOwnRole[] = (["leasing", "asset_management"] as const).filter(role => entry.roles.has(role));
      const person = toPerson(found, {
        name: entry.name, roles,
        schemes: [...entry.schemes].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
      });
      (roles[0] === "leasing" ? leasing : assetManagement).push(person);
    }
  }

  const rest = records.filter(r => !taken.has(r.id));
  const people = rest.filter(r => !isSharedMailbox(r.name, r.email));
  return {
    leasing: leasing.sort(byName),
    assetManagement: assetManagement.sort(byName),
    others: mergeByEmail(people.filter(r => !outside(r))).sort(byName),
    elsewhere: mergeByEmail(people.filter(outside)).sort(byName),
    mailboxes: mergeByEmail(rest.filter(r => isSharedMailbox(r.name, r.email))).sort(byName),
  };
}

export async function loadClientOwnContacts(req: Request): Promise<ClientOwnContacts> {
  const { pool } = await import("./db");
  const { resolveCompanyScope, clientBrandSliceSql, NO_ACCESS_SCOPE } = await import("./company-scope");
  const { isLandsecCompany, LANDSEC_SCHEMES } = await import("./landsec-schemes");

  const scope = await resolveCompanyScope(req);
  const companyId = scope || ((req.query as any).companyId ? String((req.query as any).companyId) : null);
  const empty: ClientOwnContacts = {
    viewer: "client", companyName: null, schemes: [], sheetDate: null, leasing: [], assetManagement: [], others: [], elsewhere: [], mailboxes: [], peopleCount: 0,
  };
  if (!companyId || companyId === NO_ACCESS_SCOPE) return empty;

  const landsec = await isLandsecCompany(companyId);
  // "allowed" is word for word what GET /api/crm/contacts serves a client:
  // its own row, agent companies and the brand slice. A linked company is
  // listed only when it is in that set.
  const slice = await clientBrandSliceSql(companyId, "c.id");
  const result = await pool.query(
    `WITH me AS (SELECT id, name, domain, parent_company_id FROM crm_companies WHERE id = $1),
     own AS (
       SELECT c.id, c.name, (c.id = me.id) AS is_scope,
              (c.id = me.id OR (${slice} AND c.archived_at IS NULL)) AS editable
         FROM crm_companies c CROSS JOIN me
        WHERE c.id = me.id
           OR (c.merged_into_id IS NULL
               AND (c.company_type ILIKE 'Agent%' OR ${slice})
               AND (lower(trim(c.name)) = lower(trim(me.name))
                    OR c.id = me.parent_company_id
                    OR c.parent_company_id = me.id
                    OR ($2::boolean AND regexp_replace(lower(c.name), '[^a-z]', '', 'g') IN ('landsec', 'landsecurities'))))
     )
     SELECT ct.id, ct.name, ct.role, ct.email, COALESCE(NULLIF(ct.phone_mobile, ''), ct.phone) AS phone, ct.updated_at,
            own.id AS company_id, own.name AS company_name, own.is_scope, own.editable,
            (SELECT name FROM me) AS scope_name, (SELECT domain FROM me) AS scope_domain
       FROM crm_contacts ct JOIN own ON own.id = ct.company_id`,
    [companyId, landsec]
  );
  const nameRow = result.rows[0]?.scope_name
    ?? (await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [companyId])).rows[0]?.name ?? null;

  const rows: OwnContactRow[] = result.rows.map((r: any) => ({
    id: r.id, name: String(r.name || ""), role: clean(r.role), email: clean(r.email), phone: clean(r.phone),
    updatedAt: r.updated_at, companyId: r.company_id,
    companyName: r.is_scope || String(r.company_name || "").trim().toLowerCase() === String(nameRow || "").trim().toLowerCase() ? null : clean(r.company_name),
    editable: !!r.editable,
  }));

  const schemes: ClientAgentScheme[] = landsec ? LANDSEC_SCHEMES.map(s => ({ key: s.key, name: s.name, group: s.group })) : [];
  const isOwnEmail = ownEmailTest(rows, clean(result.rows[0]?.scope_domain), [nameRow, ...(landsec ? ["landsec", "landsecurities"] : [])]);
  const groups = buildOwnPeople(rows, landsec ? schemes : null, isOwnEmail);
  return {
    viewer: landsec ? "landsec" : "client",
    companyName: nameRow,
    schemes,
    sheetDate: landsec ? LANDSEC_TEAM_SHEET_DATE : null,
    ...groups,
    peopleCount: groups.leasing.length + groups.assetManagement.length + groups.others.length,
  };
}
