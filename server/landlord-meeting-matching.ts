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

export function landlordNameMention(text: string, name: string): boolean {
  text = text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ').replace(/\S+@\S+/g, ' ')
    .replace(/\b[a-z\d-]+(?:\.[a-z\d-]+)+\b/gi, ' ');
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length < 5 && !/^[A-Z\d]{3,4}$/.test(clean)) return false;
  if (/^(investor|developer|landlord|capital|property|properties|fund|funds|estate|estates|investment|investments)$/i.test(clean)) return false;
  return new RegExp(`(?:^|[^a-z0-9])${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i').test(text);
}

export function matchLandlordMeeting(
  subject: string,
  people: LandlordMeetingPerson[],
  catalogue: LandlordCatalogueEntry[],
): Array<{ company: LandlordCatalogueEntry; reasons: string[] }> {
  catalogue = catalogue.filter(company => !String(company.company_type || '').trim().toLowerCase().startsWith('tenant'));
  const matches = new Map<string, { company: LandlordCatalogueEntry; reasons: string[] }>();
  const add = (company: LandlordCatalogueEntry, reason: string) => {
    const match = matches.get(company.id) || { company, reasons: [] };
    if (!match.reasons.includes(reason)) match.reasons.push(reason);
    matches.set(company.id, match);
  };
  for (const person of people) {
    const email = person.email.trim().toLowerCase();
    const exact = catalogue.filter(company => company.contacts.some(contact => contact.email?.trim().toLowerCase() === email));
    if (exact.length === 1) { add(exact[0], `Contact: ${person.name || email}`); continue; }
    if (exact.length > 1) continue;
    const domains = catalogue.flatMap(company => landlordDomains(company)
      .filter(domain => domainMatchesLandlord(email, domain)).map(domain => ({ company, domain })));
    const longest = Math.max(0, ...domains.map(match => match.domain.length));
    const specific = domains.filter(match => match.domain.length === longest);
    if (new Set(specific.map(match => match.company.id)).size === 1) {
      add(specific[0].company, `Invitation domain: ${email.split('@')[1]}`);
    }
  }
  for (const company of catalogue) {
    if (landlordNameMention(subject, company.name)
      && catalogue.filter(other => other.name.toLowerCase() === company.name.toLowerCase()).length === 1) {
      add(company, `Named in invitation: ${company.name}`);
    }
  }
  return [...matches.values()];
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
