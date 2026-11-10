import type { LandlordMeetingPerson } from "../shared/landlord-meetings";
import { GENERIC_EMAIL_DOMAINS, isExternalDomain, normaliseCompanyDomain } from "./tracker-correspondence";

export interface LandlordCatalogueEntry {
  id: string;
  name: string;
  company_type: string | null;
  domain: string | null;
  domain_url: string | null;
  contacts: Array<{ id: string; name: string; email: string | null }>;
}

export const LANDLORD_CATALOGUE_PREDICATE = `c.merged_into_id IS NULL
  AND LOWER(COALESCE(c.company_type, '')) NOT LIKE 'tenant%'
  AND (
    LOWER(COALESCE(c.company_type, '')) IN ('landlord','landlord/freeholder','investor','reit','developer','fund','asset manager')
    OR EXISTS (SELECT 1 FROM crm_deals d WHERE d.landlord_id = c.id AND d.status <> 'ARCH')
    OR EXISTS (SELECT 1 FROM crm_properties p WHERE p.freeholder_id = c.id OR p.long_leaseholder_id = c.id OR p.asset_manager_id = c.id)
  )`;

export function landlordDomains(company: LandlordCatalogueEntry): string[] {
  return [...new Set([company.domain, company.domain_url]
    .map(normaliseCompanyDomain).filter((domain): domain is string => isExternalDomain(domain)
      && domain!.split('.').length >= 2
      && !['co.uk', 'org.uk', 'com.au', 'com', 'net', 'org'].includes(domain!)
      && ![...GENERIC_EMAIL_DOMAINS].some(generic => domain === generic || domain!.endsWith(`.${generic}`))))];
}

export function domainMatchesLandlord(address: string, domain: string): boolean {
  const host = address.trim().toLowerCase().split('@')[1] || '';
  return host === domain || host.endsWith(`.${domain}`);
}

export function landlordMentionText(text: string): string {
  return text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ').replace(/\S+@\S+/g, ' ')
    .replace(/\b[a-z\d-]+(?:\.[a-z\d-]+)+\b/gi, ' ');
}

/** The compiled "is this landlord named in the text" test, or null when the
 *  name is too short or generic to be trusted. Text must already be cleaned
 *  with landlordMentionText. */
export function landlordNameTester(name: string): ((text: string) => boolean) | null {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length < 5 && !/^[A-Z\d]{3,4}$/.test(clean)) return null;
  if (/^(investor|developer|landlord|capital|property|properties|fund|funds|estate|estates|investment|investments)$/i.test(clean)) return null;
  const re = new RegExp(`(?:^|[^a-z0-9])${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i');
  return text => re.test(text);
}

export function landlordNameMention(text: string, name: string): boolean {
  const test = landlordNameTester(name);
  return !!test && test(landlordMentionText(text));
}

// One index per catalogue, built once and reused for every event: the
// per-event version rebuilt every landlord's domain list and name regex
// for every calendar event, which took a diary pass past 30 seconds and
// stalled the whole server (AEW page, 2 Nov 2026: "Invitations could not
// be loaded", 504s on every other request while it ran).
export type LandlordMatcher = (subject: string, people: LandlordMeetingPerson[]) => Array<{ company: LandlordCatalogueEntry; reasons: string[] }>;

export function createLandlordMatcher(catalogue: LandlordCatalogueEntry[]): LandlordMatcher {
  const companies = catalogue.filter(company => !String(company.company_type || '').trim().toLowerCase().startsWith('tenant'));
  const byEmail = new Map<string, LandlordCatalogueEntry[]>();
  const byDomain = new Map<string, LandlordCatalogueEntry[]>();
  const nameCount = new Map<string, number>();
  for (const company of companies) {
    for (const contact of company.contacts) {
      const email = contact.email?.trim().toLowerCase();
      if (!email) continue;
      const list = byEmail.get(email) || [];
      if (!list.includes(company)) list.push(company);
      byEmail.set(email, list);
    }
    for (const domain of landlordDomains(company)) {
      const list = byDomain.get(domain) || [];
      if (!list.includes(company)) list.push(company);
      byDomain.set(domain, list);
    }
    const key = company.name.toLowerCase();
    nameCount.set(key, (nameCount.get(key) || 0) + 1);
  }
  const named = companies.filter(company => nameCount.get(company.name.toLowerCase()) === 1)
    .map(company => ({ company, test: landlordNameTester(company.name) }))
    .filter((entry): entry is { company: LandlordCatalogueEntry; test: (text: string) => boolean } => !!entry.test);
  return (subject, people) => {
    const matches = new Map<string, { company: LandlordCatalogueEntry; reasons: string[] }>();
    const add = (company: LandlordCatalogueEntry, reason: string) => {
      const match = matches.get(company.id) || { company, reasons: [] };
      if (!match.reasons.includes(reason)) match.reasons.push(reason);
      matches.set(company.id, match);
    };
    for (const person of people) {
      const email = person.email.trim().toLowerCase();
      const exact = byEmail.get(email) || [];
      if (exact.length === 1) { add(exact[0], `Contact: ${person.name || email}`); continue; }
      if (exact.length > 1) continue;
      // Every suffix of the host is a candidate domain ("a.b.co.uk" → "a.b.co.uk", "b.co.uk", "co.uk").
      const host = email.split('@')[1] || '';
      const parts = host.split('.');
      const domains: Array<{ company: LandlordCatalogueEntry; domain: string }> = [];
      for (let i = 0; i < parts.length; i++) {
        const domain = parts.slice(i).join('.');
        for (const company of byDomain.get(domain) || []) domains.push({ company, domain });
      }
      const longest = Math.max(0, ...domains.map(match => match.domain.length));
      const specific = domains.filter(match => match.domain.length === longest);
      if (new Set(specific.map(match => match.company.id)).size === 1) {
        add(specific[0].company, `Invitation domain: ${host}`);
      }
    }
    const text = landlordMentionText(subject);
    for (const { company, test } of named) if (test(text)) add(company, `Named in invitation: ${company.name}`);
    return [...matches.values()];
  };
}

const matcherCache = new WeakMap<LandlordCatalogueEntry[], LandlordMatcher>();
export function matchLandlordMeeting(
  subject: string,
  people: LandlordMeetingPerson[],
  catalogue: LandlordCatalogueEntry[],
): Array<{ company: LandlordCatalogueEntry; reasons: string[] }> {
  let matcher = matcherCache.get(catalogue);
  if (!matcher) { matcher = createLandlordMatcher(catalogue); matcherCache.set(catalogue, matcher); }
  return matcher(subject, people);
}

export function londonWeek(now: Date): { start: string; end: string; timeZone: 'Europe/London' } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const pick = (type: string) => parts.find(part => part.type === type)!.value;
  const date = new Date(`${pick('year')}-${pick('month')}-${pick('day')}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const midnight = (day: Date) => {
    const guess = new Date(day);
    const offset = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' }).formatToParts(guess).find(part => part.type === 'timeZoneName')!.value;
    return new Date(guess.getTime() - (offset === 'GMT+1' ? 3600000 : 0)).toISOString();
  };
  const end = new Date(date); end.setUTCDate(end.getUTCDate() + 7);
  return { start: midnight(date), end: midnight(end), timeZone: 'Europe/London' };
}
