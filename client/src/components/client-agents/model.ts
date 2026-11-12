// Filtering and row shaping for the client Agents page. Pure functions: the
// components only render what these return.
import type {
  ClientAgentBrand, ClientAgentContact, ClientAgentDirectoryEntry, ClientAgentScheme,
  ClientBgpPerson, ClientJointAgentFirm, ClientOwnPerson, ClientOwnRole,
} from "@shared/client-agent-directory";

export type SectionKey = "bgp" | "joint" | "reps";

// One table row of the tenant rep section: a named agent, or a firm's brand
// links that have no named agent (contact null).
export interface RepRow {
  key: string;
  contact: ClientAgentContact | null;
  brands: ClientAgentBrand[];
}

export interface RepFirm {
  entry: ClientAgentDirectoryEntry;
  rows: RepRow[];
}

const has = (value: string | null | undefined, q: string) => !!value && value.toLowerCase().includes(q);
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

// How a brand link is known, one line per source. Regions belong to the
// recorded representation.
export function sourceLines(brand: ClientAgentBrand): string[] {
  return brand.sources.map(s => s === "requirement"
    ? "Current requirement"
    : brand.regions.length > 0 ? `Recorded representation · ${brand.regions.join(", ")}` : "Recorded representation");
}

// An agent's brands grouped by how the link is known, so "Acts for" and
// "How we know" stay on the same line.
export function groupBySource(brands: ClientAgentBrand[]): { label: string; lines: string[]; brands: ClientAgentBrand[] }[] {
  const groups: { label: string; lines: string[]; brands: ClientAgentBrand[] }[] = [];
  for (const brand of brands) {
    const lines = sourceLines(brand);
    const label = lines.join(" · ");
    const group = groups.find(g => g.label === label);
    if (group) group.brands.push(brand);
    else groups.push({ label, lines, brands: [brand] });
  }
  return groups;
}

// Firms in alphabetical order, then people whose firm is not confirmed.
export function buildRepFirms(entries: ClientAgentDirectoryEntry[]): RepFirm[] {
  const firms = entries.map(entry => {
    const named = new Set(entry.contacts.flatMap(c => c.represents.map(b => b.brandId)));
    const firmOnly = entry.represents.filter(b => !named.has(b.brandId));
    const rows: RepRow[] = entry.contacts.map(contact => ({ key: contact.id, contact, brands: contact.represents }));
    if (firmOnly.length > 0) rows.push({ key: `${entry.id}:firm`, contact: null, brands: firmOnly });
    return { entry, rows };
  }).filter(f => f.rows.length > 0);
  return firms.sort((a, b) => Number(a.entry.kind === "contact") - Number(b.entry.kind === "contact") || byName(a.entry, b.entry));
}

// q is already trimmed and lower-cased. brandOk narrows to brands tied to
// the chosen scheme (null = no narrowing).
export function filterRepFirms(firms: RepFirm[], q: string, brandOk: ((brandId: string) => boolean) | null): RepFirm[] {
  const result: RepFirm[] = [];
  for (const firm of firms) {
    let rows = firm.rows;
    if (brandOk) {
      rows = rows.map(r => ({ ...r, brands: r.brands.filter(b => brandOk(b.brandId)) })).filter(r => r.brands.length > 0);
    }
    if (q && !(firm.entry.kind === "firm" && has(firm.entry.name, q))) {
      rows = rows.filter(r =>
        (r.contact && [r.contact.name, r.contact.role, r.contact.specialty, r.contact.email, r.contact.phone].some(v => has(v, q)))
        || r.brands.some(b => has(b.brandName, q)));
    }
    if (rows.length > 0) result.push({ entry: firm.entry, rows });
  }
  return result;
}

export const repAgentCount = (firms: RepFirm[]) => new Set(firms.flatMap(f => f.rows.filter(r => r.contact).map(r => r.contact!.id))).size;

const BGP_FIRM_WORDS = ["bgp", "bruce gillingham pollard"];

export function filterBgp(
  people: ClientBgpPerson[], schemeNames: Map<string, string>, q: string, scheme: string | null,
): ClientBgpPerson[] {
  let rows = people;
  if (scheme) {
    rows = rows.filter(p => p.lead.includes(scheme) || p.support.includes(scheme));
    rows = [...rows].sort((a, b) => Number(b.lead.includes(scheme)) - Number(a.lead.includes(scheme)));
  }
  if (q && !BGP_FIRM_WORDS.some(w => w.includes(q))) {
    rows = rows.filter(p => [p.name, p.title, p.email, p.phone, ...p.covers,
      ...[...p.lead, ...p.support].map(k => schemeNames.get(k))].some(v => has(v, q)));
  }
  return rows;
}

export function filterJoint(
  firms: ClientJointAgentFirm[], schemeNames: Map<string, string>, q: string, scheme: string | null,
): ClientJointAgentFirm[] {
  const result: ClientJointAgentFirm[] = [];
  for (const firm of firms) {
    let people = firm.people;
    if (scheme) people = people.filter(p => p.schemes.includes(scheme));
    if (q && !has(firm.name, q)) {
      people = people.filter(p => [p.name, p.role, p.email, p.phone, ...p.schemes.map(k => schemeNames.get(k))].some(v => has(v, q)));
    }
    if (people.length > 0) result.push({ ...firm, people });
  }
  return result;
}

export const jointPeopleCount = (firms: ClientJointAgentFirm[]) => firms.reduce((n, f) => n + f.people.length, 0);

// Fold a list of groups so about `limit` rows show; always at least one group.
export function foldGroups<T>(groups: T[], rowsOf: (g: T) => number, limit: number): T[] {
  const shown: T[] = [];
  let rows = 0;
  for (const g of groups) {
    if (shown.length > 0 && rows + rowsOf(g) > limit) break;
    shown.push(g);
    rows += rowsOf(g);
  }
  return shown;
}

// The client's own people (the "<client> Contacts" tab).
export const OWN_ROLE_LABEL: Record<ClientOwnRole, string> = { leasing: "Leasing", asset_management: "Asset management" };

export function filterOwnPeople(
  people: ClientOwnPerson[], schemeNames: Map<string, string>, q: string, scheme: string | null,
): ClientOwnPerson[] {
  let rows = people;
  if (scheme) rows = rows.filter(p => p.schemes.includes(scheme));
  if (q) {
    rows = rows.filter(p => [p.name, p.title, p.company, p.email, p.phone,
      ...p.roles.map(r => OWN_ROLE_LABEL[r]), ...p.schemes.map(k => schemeNames.get(k))].some(v => has(v, q)));
  }
  return rows;
}

// A person's schemes as short text. Someone on every scheme reads "All 14
// schemes"; on a long list a whole group reads "North (all 4)".
export function ownSchemeNames(keys: string[], schemes: ClientAgentScheme[]): { key: string; name: string }[] {
  if (schemes.length > 1 && keys.length === schemes.length) return [{ key: "all", name: `All ${schemes.length} schemes` }];
  const mine = new Set(keys);
  const names: { key: string; name: string }[] = [];
  for (const group of [...new Set(schemes.map(s => s.group))]) {
    const inGroup = schemes.filter(s => s.group === group);
    const covered = inGroup.filter(s => mine.has(s.key));
    if (keys.length > 4 && inGroup.length > 1 && covered.length === inGroup.length) names.push({ key: `group:${group}`, name: `${group} (all\u00a0${inGroup.length})` });
    else names.push(...covered.map(s => ({ key: s.key, name: s.name })));
  }
  return names;
}
