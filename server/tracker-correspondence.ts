// Who BGP is actually emailing about an investment-board asset, from the
// synced mailboxes (Woody, 2026-09-28: "Purchase for Appley is Ares — Jack is
// doing a load of work for them … work out why the app hasn't"). The
// tracker's client came from a spreadsheet import and hand edits; nothing
// read the correspondence. On the Royal Exchange Jack's models, data-room
// access and inspections all go to Appley's team, and Ares — the capital
// Appley buys for, copied on Appley's own threads — showed nothing at all.
//
// The organisation BGP writes to and meets on an asset outranks a name typed
// into a row: this ranks the firms on the asset's recent threads (by their
// email domain → CRM company), suggests the client when the row has none or
// names someone else, and lists the firms copied alongside that client on
// its own threads (a capital partner behind an operating partner). It only
// suggests — staff confirm from the edit dialog.
import type { Querier } from "./account-resolver";

export const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "hotmail.co.uk", "outlook.com",
  "icloud.com", "me.com", "aol.com", "live.com", "live.co.uk", "msn.com", "btinternet.com",
]);
// BGP's own mailboxes, typo'd variants included (bucegillinghampollard.com,
// brucegillinhampollard.com both sit in the synced participants).
export const INTERNAL_DOMAIN_RE = /gill?ing?hampollard\.com$/i;
// Firms that are never the principal on an investment deal: agents, lawyers,
// news — and occupiers, whose threads on a building are its lettings (the
// Royal Exchange's Mr Foggs letting out-mailed every bidder).
const NON_PRINCIPAL_TYPES = new Set(["agent", "solicitor", "other", "comparable", "contact"]);
const isPrincipalType = (type: string | null) => {
  const t = String(type || "").trim().toLowerCase();
  return !NON_PRINCIPAL_TYPES.has(t) && !t.startsWith("tenant");
};

export interface CorrespondenceRow {
  subject: string | null;
  direction: string | null;   // outbound | inbound | upcoming | past
  type: string | null;        // email | meeting
  participants: unknown;
  bgp_user: string | null;
  interaction_date: string | Date;
}
export interface DomainCompany { id: string; name: string; company_type: string | null }
export interface Correspondent {
  companyId: string;
  name: string;
  companyType: string | null;
  domain: string;
  messages: number;
  outbound: number;
  meetings: number;
  lastDate: string;
  bgpUsers: string[];
  subjects: string[];
  score: number;
}

export function emailDomain(address: unknown): string | null {
  const s = String(address || "").trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at < 1) return null;
  const d = s.slice(at + 1).replace(/^www\./, "");
  return d.includes(".") ? d : null;
}
export function isExternalDomain(domain: string | null): domain is string {
  return !!domain && !GENERIC_EMAIL_DOMAINS.has(domain) && !INTERNAL_DOMAIN_RE.test(domain);
}
// A company's own domain as stored ("https://www.appley.net/" → appley.net).
export function normaliseCompanyDomain(value: unknown): string | null {
  const s = String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return s && s.includes(".") && !s.includes("@") && !/\s/.test(s) ? s : null;
}

// Search terms for an asset: its names and aliases, without a leading "The".
// Short all-caps aliases ("REX") count; other short words are too common.
export function assetTerms(names: Array<string | null | undefined>): string[] {
  const out = new Map<string, string>();
  for (const raw of names) {
    const n = String(raw || "").replace(/\s+/g, " ").trim().replace(/^the\s+/i, "");
    if (!n) continue;
    if (n.length < 5 && !/^[A-Z0-9]{3,4}$/.test(n)) continue;
    out.set(n.toLowerCase(), n);
  }
  return [...out.values()];
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function subjectMatches(subject: string | null, terms: string[]): boolean {
  const s = String(subject || "");
  return terms.some(t => new RegExp(`(^|[^a-z0-9])${escapeRe(t)}($|[^a-z0-9])`, "i").test(s));
}

const participantsOf = (row: CorrespondenceRow): string[] => {
  const p = row.participants;
  if (Array.isArray(p)) return p.map(String);
  if (typeof p === "string") { try { const j = JSON.parse(p); return Array.isArray(j) ? j.map(String) : []; } catch { return []; } }
  return [];
};
const normSubject = (s: string | null) => String(s || "").replace(/^\s*((re|fw|fwd|accepted|declined|tentative)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().toLowerCase();
// The same email sits once per matched contact and once per BGP mailbox it
// reached — one message is its thread subject at that minute.
export function messageKey(row: CorrespondenceRow): string {
  const d = new Date(row.interaction_date);
  return `${normSubject(row.subject)}|${isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16)}`;
}
const isOutbound = (row: CorrespondenceRow) => row.direction === "outbound";
const isMeeting = (row: CorrespondenceRow) => row.type === "meeting";

// Rank the principal firms on these rows. A firm counts only when BGP wrote
// to it or met it (a newsletter or a cold approach never does); recent work
// outweighs a spring enquiry that went nowhere.
export function rankCorrespondents(
  rows: CorrespondenceRow[],
  companiesByDomain: Map<string, DomainCompany>,
  opts: { excludeCompanyIds?: Iterable<string>; now?: Date; halfLifeDays?: number } = {},
): Correspondent[] {
  const exclude = new Set(opts.excludeCompanyIds || []);
  const now = (opts.now || new Date()).getTime();
  const halfLife = opts.halfLifeDays ?? 30;
  const byCompany = new Map<string, Correspondent & { keys: Set<string> }>();
  for (const row of rows) {
    const key = messageKey(row);
    const when = new Date(row.interaction_date);
    const domains = new Set(participantsOf(row).map(emailDomain).filter(isExternalDomain));
    for (const domain of domains) {
      const co = companiesByDomain.get(domain);
      if (!co || exclude.has(co.id) || !isPrincipalType(co.company_type)) continue;
      let c = byCompany.get(co.id);
      if (!c) {
        c = { companyId: co.id, name: co.name, companyType: co.company_type, domain, messages: 0, outbound: 0, meetings: 0, lastDate: "", bgpUsers: [], subjects: [], score: 0, keys: new Set() };
        byCompany.set(co.id, c);
      }
      if (row.bgp_user && !c.bgpUsers.includes(row.bgp_user)) c.bgpUsers.push(row.bgp_user);
      if (c.keys.has(key)) continue;
      c.keys.add(key);
      c.messages++;
      if (isOutbound(row)) c.outbound++;
      if (isMeeting(row)) c.meetings++;
      const iso = isNaN(when.getTime()) ? "" : when.toISOString();
      if (iso > c.lastDate) c.lastDate = iso;
      const subj = String(row.subject || "").trim();
      if (subj && c.subjects.length < 3 && !c.subjects.some(s => normSubject(s) === normSubject(subj))) c.subjects.push(subj);
      const ageDays = isNaN(when.getTime()) ? 365 : Math.max(0, (now - when.getTime()) / 864e5);
      c.score += (isMeeting(row) ? 3 : isOutbound(row) ? 2 : 1) * Math.pow(0.5, ageDays / halfLife);
    }
  }
  return [...byCompany.values()]
    .filter(c => c.outbound + c.meetings > 0)
    .map(({ keys: _keys, ...c }) => ({ ...c, score: Math.round(c.score * 100) / 100 }))
    .sort((a, b) => b.score - a.score || b.messages - a.messages);
}

export interface ClientSuggestion {
  // partner: the work is with a firm that copies a current client on its
  // own threads — an operating partner buying for that client, not a
  // different client.
  kind: "no_client" | "mismatch" | "partner";
  company: Correspondent;
  currentClient: string | null;
}
// The row's client should be the firm BGP is working with on it. Suggest
// only on real work (several messages, the last within three months) and
// never when a current client is itself among the leading correspondents.
export function suggestClient(
  ranked: Correspondent[],
  clientIds: string[],
  currentClient: string | null,
  opts: { now?: Date; minMessages?: number; recentDays?: number } = {},
): ClientSuggestion | null {
  const top = ranked[0];
  if (!top) return null;
  const now = (opts.now || new Date()).getTime();
  if (top.messages < (opts.minMessages ?? 3)) return null;
  if (!top.lastDate || now - new Date(top.lastDate).getTime() > (opts.recentDays ?? 90) * 864e5) return null;
  const clients = new Set(clientIds.filter(Boolean));
  if (clients.has(top.companyId)) return null;
  if (ranked.some(c => clients.has(c.companyId) && c.score >= top.score * 0.5)) return null;
  return { kind: clients.size ? "mismatch" : "no_client", company: top, currentClient };
}

export interface CopiedFirm { companyId: string; name: string; companyType: string | null; domain: string; messages: number; subjects: string[] }
// Firms copied alongside the anchor firm on its own threads — the capital
// partner behind an operating partner (Ares on Appley's emails). Mass
// mailings (a lunch invite to twenty landlords) don't count.
export function copiedAlongside(
  rows: CorrespondenceRow[],
  anchorDomain: string,
  companiesByDomain: Map<string, DomainCompany>,
  opts: { excludeCompanyIds?: Iterable<string>; minMessages?: number; maxDomains?: number } = {},
): CopiedFirm[] {
  const exclude = new Set(opts.excludeCompanyIds || []);
  const anchor = companiesByDomain.get(anchorDomain);
  if (anchor) exclude.add(anchor.id);
  const byCompany = new Map<string, CopiedFirm & { keys: Set<string> }>();
  for (const row of rows) {
    const domains = new Set(participantsOf(row).map(emailDomain).filter(isExternalDomain));
    if (!domains.has(anchorDomain) || domains.size > (opts.maxDomains ?? 3)) continue;
    const key = messageKey(row);
    for (const domain of domains) {
      if (domain === anchorDomain) continue;
      const co = companiesByDomain.get(domain);
      if (!co || exclude.has(co.id) || !isPrincipalType(co.company_type)) continue;
      let c = byCompany.get(co.id);
      if (!c) { c = { companyId: co.id, name: co.name, companyType: co.company_type, domain, messages: 0, subjects: [], keys: new Set() }; byCompany.set(co.id, c); }
      if (c.keys.has(key)) continue;
      c.keys.add(key);
      c.messages++;
      const subj = String(row.subject || "").trim();
      if (subj && c.subjects.length < 3 && !c.subjects.some(s => normSubject(s) === normSubject(subj))) c.subjects.push(subj);
    }
  }
  return [...byCompany.values()]
    .filter(c => c.messages >= (opts.minMessages ?? 2))
    .map(({ keys: _keys, ...c }) => c)
    .sort((a, b) => b.messages - a.messages);
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);

async function companiesForDomains(q: Querier, domains: string[]): Promise<Map<string, DomainCompany>> {
  const map = new Map<string, DomainCompany>();
  if (!domains.length) return map;
  // Top-level records first, so a subsidiary sharing the group's domain
  // doesn't stand in for the group.
  const { rows } = await q.query(
    `SELECT id, name, company_type, domain, domain_url, parent_company_id FROM crm_companies
      WHERE merged_into_id IS NULL AND (lower(domain) = ANY($1::text[]) OR lower(regexp_replace(regexp_replace(COALESCE(domain_url, ''), '^https?://(www\\.)?', ''), '[/?#].*$', '')) = ANY($1::text[]))
      ORDER BY (parent_company_id IS NULL) DESC, name`,
    [domains]);
  for (const r of rows) {
    for (const d of [normaliseCompanyDomain(r.domain), normaliseCompanyDomain(r.domain_url)]) {
      if (d && domains.includes(d) && !map.has(d)) map.set(d, { id: r.id, name: r.name, company_type: r.company_type });
    }
  }
  return map;
}

// The firms on the other side of the table. On a purchase that is the
// vendor, its agent and everyone in the building's ownership chain — owner,
// freeholder, lenders, and the owner's asset manager (Pave runs the Royal
// Exchange for Ardent and is on hundreds of its threads) — plus the
// vendor's and owner's group companies. On a sale, the buyer.
export function otherSideIds(t: Record<string, any>, sale: boolean): string[] {
  const ids = sale
    ? [t.buyer_id]
    : [t.vendor_id, t.vendor_agent_company_id, t.property_landlord_id, t.property_freeholder_id, t.property_long_leaseholder_id,
       t.property_senior_lender_id, t.property_junior_lender_id, t.property_asset_manager_id, t.property_competitor_agent_id,
       ...(t.other_side_group_ids || [])];
  return [...new Set(ids.filter(Boolean).map(String))];
}

export async function trackerCorrespondence(trackerId: string, deps: { pool?: Querier; now?: Date } = {}) {
  const q = deps.pool ?? (await import("./db")).pool;
  const { rows: [t] } = await q.query(
    `SELECT t.id, t.asset_name, t.board_type, t.client, t.client_id, t.vendor_id, t.buyer_id,
            (SELECT c.company_id FROM crm_contacts c WHERE c.id = t.vendor_agent_id) AS vendor_agent_company_id,
            p.name AS property_name, p.aliases AS property_aliases, p.landlord_id AS property_landlord_id,
            p.freeholder_id AS property_freeholder_id, p.long_leaseholder_id AS property_long_leaseholder_id,
            p.senior_lender_id AS property_senior_lender_id, p.junior_lender_id AS property_junior_lender_id,
            p.asset_manager_id AS property_asset_manager_id, p.competitor_agent_id AS property_competitor_agent_id,
            COALESCE((SELECT array_agg(g.id) FROM crm_companies g, crm_companies o
                       WHERE o.id IN (t.vendor_id, p.landlord_id, p.freeholder_id)
                         AND (g.id = o.parent_company_id OR g.parent_company_id = o.id
                              OR (o.parent_company_id IS NOT NULL AND g.parent_company_id = o.parent_company_id))), '{}') AS other_side_group_ids,
            COALESCE((SELECT array_agg(tc.company_id) FROM investment_tracker_clients tc WHERE tc.tracker_id = t.id), '{}') AS extra_client_ids
       FROM investment_tracker t LEFT JOIN crm_properties p ON p.id = t.property_id
      WHERE t.id = $1`, [trackerId]);
  if (!t) return null;
  const aliases = Array.isArray(t.property_aliases) ? t.property_aliases : [];
  const terms = assetTerms([t.asset_name, t.property_name, ...aliases]);
  const empty = { trackerId, terms, correspondents: [] as Correspondent[], suggestion: null as ClientSuggestion | null, copied: [] as CopiedFirm[], copiedWith: null as string | null };
  if (!terms.length) return empty;

  const { rows } = await q.query(
    `SELECT subject, direction, type, participants, bgp_user, interaction_date
       FROM crm_interactions
      WHERE interaction_date >= NOW() - INTERVAL '12 months' AND subject ILIKE ANY($1::text[])
      ORDER BY interaction_date DESC LIMIT 4000`,
    [terms.map(term => `%${likeEscape(term)}%`)]);
  const onAsset = (rows as CorrespondenceRow[]).filter(r => subjectMatches(r.subject, terms));
  const domains = [...new Set(onAsset.flatMap(r => participantsOf(r).map(emailDomain).filter(isExternalDomain)))];
  const companies = await companiesForDomains(q, domains);

  const sale = (t.board_type || "Purchases") === "Sales";
  const otherSide = otherSideIds(t, sale);
  const ranked = rankCorrespondents(onAsset, companies, { excludeCompanyIds: otherSide, now: deps.now });
  const clientIds: string[] = [t.client_id, ...(t.extra_client_ids || [])].filter(Boolean);
  let suggestion = suggestClient(ranked, clientIds, t.client || null, { now: deps.now });

  // The firm the work is with — the suggested client, else the current one.
  const anchor = suggestion?.company || ranked.find(c => clientIds.includes(c.companyId)) || null;
  let copied: CopiedFirm[] = [];
  if (anchor) {
    const { rows: anchorRows } = await q.query(
      `SELECT subject, direction, type, participants, bgp_user, interaction_date
         FROM crm_interactions
        WHERE interaction_date >= NOW() - INTERVAL '12 months' AND participants::text ILIKE $1
        ORDER BY interaction_date DESC LIMIT 2000`,
      [`%@${likeEscape(anchor.domain)}"%`]);
    const anchorDomains = [...new Set((anchorRows as CorrespondenceRow[]).flatMap(r => participantsOf(r).map(emailDomain).filter(isExternalDomain)))];
    const anchorCompanies = await companiesForDomains(q, anchorDomains);
    const alongside = copiedAlongside(anchorRows as CorrespondenceRow[], anchor.domain, anchorCompanies, { excludeCompanyIds: otherSide });
    // The row names Ares and the work is with Appley, who copy Ares on
    // their own threads: Appley is buying for the client, not replacing it.
    if (suggestion?.kind === "mismatch" && alongside.some(c => clientIds.includes(c.companyId))) suggestion = { ...suggestion, kind: "partner" };
    copied = alongside.filter(c => !clientIds.includes(c.companyId));
  }
  return { ...empty, correspondents: ranked.slice(0, 6), suggestion, copied: copied.slice(0, 4), copiedWith: anchor?.name || null };
}
