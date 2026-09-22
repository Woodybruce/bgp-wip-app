export interface ViewingContact {
  id: string;
  name: string;
  email: string | null;
  companyId: string | null;
  companyName: string | null;
  companyType: string | null;
}

export interface ViewingBrandLink {
  contactId: string;
  brandId: string;
  brandName: string;
  requirementId?: string | null;
  kind: "agent" | "principal";
}

export interface ViewingBrandMatch {
  brandId: string | null;
  brandName: string | null;
  contactId: string | null;
  contactName: string | null;
  agentContactId: string | null;
  requirementId: string | null;
  candidateBrandIds: string[];
  reasons: string[];
}

export const normalizeViewingEmail = (email: string) => email.trim().toLowerCase();

export interface ViewingTrackerUnit { id: string; unitName: string; propertyId: string; propertyName: string }
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsName = (text: string, name: string) => new RegExp(`(?:^|[^a-z0-9])${escapePattern(name)}(?:$|[^a-z0-9])`, "i").test(text);

export function matchViewingUnits(text: string, units: ViewingTrackerUnit[]): { units: ViewingTrackerUnit[]; issues: string[] } {
  const properties = [...new Map(units.map(unit => [unit.propertyId, unit.propertyName])).entries()];
  const named = properties.filter(([, name]) => {
    const fullName = name.split(",")[0].trim();
    if (fullName.length >= 5 && containsName(text, fullName)) return true;
    const firstWord = name.split(/[\s,]+/)[0];
    return firstWord.length >= 6 && properties.filter(([, other]) => other.split(/[\s,]+/)[0].toLowerCase() === firstWord.toLowerCase()).length === 1 && containsName(text, firstWord);
  });
  if (named.length > 1) return { units: [], issues: ["Confirm the property: more than one is named"] };
  const propertyUnits = named.length === 1 ? units.filter(unit => unit.propertyId === named[0][0]) : units;
  const matched = propertyUnits.filter(unit => {
    const name = unit.unitName.split(",")[0].trim();
    if (name.length < 2) return false;
    if (!named.length) {
      if (/^(unit|kiosk|shop|suite|store|room)\s*\d{1,3}[a-z]?$/i.test(name)) return false;
      if (!((name.length >= 4 && /\d/.test(name)) || name.length >= 8)) return false;
    }
    return containsName(text, name);
  });
  // Duplicate tracker names never justify attaching an event to both records.
  if (new Set(matched.map(unit => unit.unitName.split(",")[0].trim().toLowerCase())).size !== matched.length) {
    return { units: [], issues: ["Confirm the tracker unit: this name appears more than once"] };
  }
  if (!named.length && new Set(matched.map(unit => unit.propertyId)).size > 1) return { units: [], issues: ["Confirm the property for the named units"] };
  if (matched.length) return { units: matched, issues: [] };
  if (named.length === 1 && propertyUnits.length === 1) return { units: propertyUnits, issues: [] };
  return { units: [], issues: [named.length ? "Choose which tracker units are being viewed" : "Identify the property and tracker unit"] };
}

// A named agent relationship outranks old, incorrectly imported employment.
// Every attendee contributes evidence; picking the first matching email can
// silently turn an agency, contractor or one of several brands into the tenant.
export function matchViewingBrand(
  emails: string[], contacts: ViewingContact[], links: ViewingBrandLink[],
): ViewingBrandMatch {
  const external = [...new Set(emails.map(normalizeViewingEmail).filter(email => email && !email.endsWith("@brucegillinghampollard.com")))];
  const reasons: string[] = [];
  const matched: ViewingContact[] = [];
  const candidates = new Map<string, string>();
  const personBrands: Set<string>[] = [];
  for (const email of external) {
    const people = contacts.filter(c => c.email && normalizeViewingEmail(c.email) === email);
    if (people.length !== 1) {
      reasons.push(people.length ? "duplicate_contact_email" : "unmatched_attendee");
      continue;
    }
    const person = people[0];
    matched.push(person);
    const namedLinks = links.filter(link => link.contactId === person.id);
    const personCandidates = new Set<string>();
    for (const link of namedLinks) {
      candidates.set(link.brandId, link.brandName);
      personCandidates.add(link.brandId);
    }
    if (!namedLinks.some(link => link.kind === "agent") && person.companyId && /^tenant(?:\s|-|$)/i.test(person.companyType || "")) {
      candidates.set(person.companyId, person.companyName || "");
      personCandidates.add(person.companyId);
    }
    if (personCandidates.size) personBrands.push(personCandidates);
    else reasons.push("unconfirmed_attendee_role");
  }
  if (!external.length) reasons.push("missing_external_contact");
  // A direct brand contact can disambiguate an agent with several clients,
  // but two unrelated brands or agents with conflicting clients cannot.
  const common = [...candidates.keys()].filter(id => personBrands.every(set => set.has(id)));
  const brandId = common.length === 1 ? common[0] : null;
  if (!brandId) reasons.push(candidates.size ? "ambiguous_brand" : "missing_brand");
  const matchingLinks = brandId ? links.filter(link => link.brandId === brandId && matched.some(person => person.id === link.contactId)) : [];
  const agents = [...new Set(matchingLinks.filter(link => link.kind === "agent").map(link => link.contactId))];
  const direct = matched.filter(person => person.companyId === brandId && !agents.includes(person.id));
  const contact = direct.length === 1 ? direct[0] : null;
  const requirements = [...new Set(matchingLinks.map(link => link.requirementId).filter((id): id is string => !!id))];
  return {
    brandId, brandName: brandId ? candidates.get(brandId) || null : null,
    contactId: contact?.id || null, contactName: contact?.name || (agents.length === 1 ? matched.find(person => person.id === agents[0])?.name : null) || null,
    agentContactId: agents.length === 1 ? agents[0] : null,
    requirementId: requirements.length === 1 ? requirements[0] : null,
    candidateBrandIds: [...candidates.keys()].sort(), reasons: [...new Set(reasons)],
  };
}

export function parseGraphDateTime(start: { dateTime: string; timeZone: string }): Date {
  const raw = start.dateTime;
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  // Calendar capture requests UTC in the HTTP Prefer header. Do not interpret
  // a timezone-less non-UTC value in the server's own timezone.
  if (!hasOffset && start.timeZone.toUpperCase() !== "UTC") throw new Error(`Calendar returned an unexpected timezone: ${start.timeZone}`);
  const date = new Date(hasOffset ? raw : `${raw}Z`);
  if (!Number.isFinite(date.getTime())) throw new Error("Calendar returned an invalid start time");
  return date;
}

export function londonViewingDateTime(start: { dateTime: string; timeZone: string }): { date: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(parseGraphDateTime(start)).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function isLeasingViewing(subject?: string | null, categories?: string[] | null): boolean {
  const text = `${subject || ""} ${(categories || []).join(" ")}`;
  if (/\b(contractor|maintenance|repair|survey|valuation|fire|safety|inspection)\b/i.test(text)) return false;
  return /\bviewing\b/i.test(text);
}
