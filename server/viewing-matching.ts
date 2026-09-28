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

export interface ViewingTrackerUnit { id: string; unitName: string; propertyId: string; propertyName: string; propertyAliases?: string[] }
export interface ViewingProperty { id: string; name: string; aliases?: string[] }
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsName = (text: string, name: string) => new RegExp(`(?:^|[^a-z0-9])${escapePattern(name)}(?:$|[^a-z0-9])`, "i").test(text);

// crm_properties.aliases is free-form jsonb: an array of strings, or a string.
export function propertyAliasList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return list.filter((alias): alias is string => typeof alias === "string" && !!alias.trim()).map(alias => alias.trim());
}

// Diary subjects say "Brixton market viewing" or "GP x Brixton Village
// Viewing", so aliases count as names and a longer named needle beats one it
// contains ("Brixton" inside "Brixton market") (Woody, 2026-09-28).
function namedProperties(text: string, properties: ViewingProperty[], firstWordRule: boolean) {
  const found: { property: ViewingProperty; needle: string }[] = [];
  for (const property of properties) {
    const needles = [property.name.split(",")[0].trim(), ...(property.aliases || [])]
      .filter(needle => needle.length >= 5 && (firstWordRule || /\S\s+\S/.test(needle)));
    let needle = needles.filter(n => containsName(text, n)).sort((a, b) => b.length - a.length)[0] || "";
    if (!needle && firstWordRule) {
      const firstWord = property.name.split(/[\s,]+/)[0];
      if (firstWord.length >= 6 && properties.filter(other => other.name.split(/[\s,]+/)[0].toLowerCase() === firstWord.toLowerCase()).length === 1 && containsName(text, firstWord)) needle = firstWord;
    }
    if (needle) found.push({ property, needle });
  }
  return found.filter(entry => !found.some(other => other.property.id !== entry.property.id && other.needle.length > entry.needle.length && other.needle.toLowerCase().includes(entry.needle.toLowerCase())));
}

export function matchViewingUnits(text: string, units: ViewingTrackerUnit[], options: { location?: string; properties?: ViewingProperty[] } = {}): { units: ViewingTrackerUnit[]; issues: string[]; property: { id: string; name: string } | null } {
  const properties = [...new Map(units.map(unit => [unit.propertyId, { id: unit.propertyId, name: unit.propertyName, aliases: unit.propertyAliases || [] }])).values()];
  const fullText = options.location ? `${text} ${options.location}` : text;
  // The subject outranks the location: "GP x Brixton Village Viewing" at
  // "Market Row entrance" is a Brixton Village viewing (Woody, 2026-09-28).
  // A property with no tracker units yet can still be named for the task,
  // but only by a multi-word name or alias — and when the subject names one,
  // a tracker property in the location does not override it.
  const trackerIds = new Set(properties.map(entry => entry.id));
  const others = (options.properties || []).filter(entry => !trackerIds.has(entry.id));
  const namedOther = (hay: string) => {
    const found = namedProperties(hay, others, false);
    return found.length === 1 ? { id: found[0].property.id, name: found[0].property.name } : null;
  };
  // "Brixton market" names Brixton Market, not Market Row by its first word.
  const subjectOthers = namedProperties(text, others, false);
  let namedEntries = namedProperties(text, properties, true)
    .filter(entry => !subjectOthers.some(other => other.needle.length > entry.needle.length && other.needle.toLowerCase().includes(entry.needle.toLowerCase())));
  const subjectOther = namedEntries.length ? null : namedOther(text);
  if (!namedEntries.length && !subjectOther && options.location) namedEntries = namedProperties(fullText, properties, true);
  const named = namedEntries.map(entry => [entry.property.id, entry.property.name] as const);
  if (named.length > 1) return { units: [], issues: ["Confirm the property: more than one is named"], property: null };
  let property = named.length === 1 ? { id: named[0][0], name: named[0][1] } : subjectOther;
  if (!property && others.length) property = namedOther(fullText);
  if (subjectOther) return { units: [], issues: ["Choose which tracker units are being viewed"], property };
  const propertyUnits = named.length === 1 ? units.filter(unit => unit.propertyId === named[0][0]) : units;
  const matched = propertyUnits.filter(unit => {
    const name = unit.unitName.split(",")[0].trim();
    if (name.length < 2) return false;
    if (!named.length) {
      if (/^(unit|kiosk|shop|suite|store|room)\s*\d{1,3}[a-z]?$/i.test(name)) return false;
      if (!((name.length >= 4 && /\d/.test(name)) || name.length >= 8)) return false;
    }
    return containsName(fullText, name);
  });
  // Duplicate tracker names never justify attaching an event to both records.
  if (new Set(matched.map(unit => unit.unitName.split(",")[0].trim().toLowerCase())).size !== matched.length) {
    return { units: [], issues: ["Confirm the tracker unit: this name appears more than once"], property };
  }
  if (!named.length && new Set(matched.map(unit => unit.propertyId)).size > 1) return { units: [], issues: ["Confirm the property for the named units"], property: null };
  if (matched.length) return { units: matched, issues: [], property: named.length ? property : { id: matched[0].propertyId, name: matched[0].propertyName } };
  if (named.length === 1 && propertyUnits.length === 1) return { units: propertyUnits, issues: [], property };
  return { units: [], issues: [property ? "Choose which tracker units are being viewed" : "Identify the property and tracker unit"], property };
}

export interface ViewingBrandCandidate { id: string; name: string; domains?: string[] }
export interface ViewingBrandIndex { byToken: Map<string, ViewingBrandCandidate[]>; byDomain: Map<string, ViewingBrandCandidate[]>; propertyNames: string[] }
export interface ViewingInferredBrand { brandId: string; brandName: string; reason: "brand_from_invitation" | "brand_from_domain" }

// Words that are also somebody's brand name somewhere in the directory.
const COMMON_NAME_WORDS = new Set(("the and of at with for x re fw fwd viewing viewings view visit tour site inspection meeting meet call "
  + "lunch coffee drinks dinner breakfast unit units shop store retail space office market village estate street road lane square "
  + "place yard row arch arches hall house centre center park london city town west east north south new old kitchen bar cafe food "
  + "studio group team today tomorrow entrance outside second first final brand tenant agent leasing").split(" "));
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "live.co.uk",
  "icloud.com", "me.com", "yahoo.com", "yahoo.co.uk", "aol.com", "btinternet.com", "sky.com", "msn.com", "protonmail.com"]);
const nameTokens = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export function viewingCompanyDomain(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:\s]/)[0] || "";
}

export function buildViewingBrandIndex(brands: ViewingBrandCandidate[], propertyNames: string[] = []): ViewingBrandIndex {
  const properties = [...new Set(propertyNames.map(name => name.split(",")[0].trim().toLowerCase()).filter(Boolean))];
  const propertySet = new Set(properties);
  const byToken = new Map<string, ViewingBrandCandidate[]>(), byDomain = new Map<string, ViewingBrandCandidate[]>();
  for (const brand of brands) {
    const name = (brand.name || "").trim().replace(/\s+/g, " ");
    const tokens = nameTokens(name);
    const usableName = name.length >= 4 && tokens.length && !tokens.every(token => COMMON_NAME_WORDS.has(token))
      && !/bruce gillingham|^bgp$/i.test(name) && !propertySet.has(name.toLowerCase());
    if (usableName) {
      const list = byToken.get(tokens[0]) || [];
      list.push({ ...brand, name });
      byToken.set(tokens[0], list);
    }
    for (const domain of new Set((brand.domains || []).map(viewingCompanyDomain))) {
      if (!domain.includes(".") || FREE_MAIL.has(domain) || domain === "brucegillinghampollard.com") continue;
      const list = byDomain.get(domain) || [];
      list.push(brand);
      byDomain.set(domain, list);
    }
  }
  return { byToken, byDomain, propertyNames: properties };
}

// Used only when attendees give no brand (Goyard: organiser only, brand in
// the subject). Exactly one directory brand named in the invitation, or one
// brand owning an unknown attendee's email domain; never a guess between
// several (Woody, 2026-09-28).
export function inferViewingBrand(text: string, unknownEmails: string[], index: ViewingBrandIndex, allowedIds: string[] = []): ViewingInferredBrand | null {
  const words = new Set(nameTokens(text));
  const named: ViewingBrandCandidate[] = [];
  for (const token of words) {
    for (const brand of index.byToken.get(token) || []) {
      if (!containsName(text, brand.name)) continue;
      // "Market Row" the brand inside "Market Row" the property is the place.
      const lower = brand.name.toLowerCase();
      if (index.propertyNames.some(property => property.includes(lower) && containsName(text, property))) continue;
      named.push(brand);
    }
  }
  const longest = named.filter(brand => !named.some(other => other.id !== brand.id && other.name.length > brand.name.length && other.name.toLowerCase().includes(brand.name.toLowerCase())));
  const byDomain: ViewingBrandCandidate[] = [];
  for (const email of unknownEmails) {
    const domain = normalizeViewingEmail(email).split("@")[1] || "";
    const parent = domain.split(".").slice(1).join(".");
    byDomain.push(...(index.byDomain.get(domain) || []), ...(parent.includes(".") ? index.byDomain.get(parent) || [] : []));
  }
  const allowed = (brands: ViewingBrandCandidate[]) => allowedIds.length ? brands.filter(brand => allowedIds.includes(brand.id)) : brands;
  const nameIds = [...new Set(allowed(longest).map(brand => brand.id))];
  const domainIds = [...new Set(allowed(byDomain).map(brand => brand.id))];
  const ids = [...new Set([...nameIds, ...domainIds])];
  if (ids.length !== 1) return null;
  const brand = [...longest, ...byDomain].find(candidate => candidate.id === ids[0])!;
  return { brandId: brand.id, brandName: brand.name, reason: nameIds.length ? "brand_from_invitation" : "brand_from_domain" };
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

/** Clearly not a leasing viewing — contractors, surveys, valuations, fire
 *  safety. Inspections, site tours and walk-arounds are NOT in this list:
 *  they are viewings (Woody, 2026-08-04) and are captured for a person to
 *  classify. */
export function isNonLeasingVisit(subject?: string | null): boolean {
  return /\b(contractor|maintenance|repair|survey|valuation|fire|safety)\b/i.test(String(subject || ""));
}

export function isLeasingViewing(subject?: string | null, categories?: string[] | null): boolean {
  const text = `${subject || ""} ${(categories || []).join(" ")}`;
  if (/\b(contractor|maintenance|repair|survey|valuation|fire|safety|inspection)\b/i.test(text)) return false;
  return /\bviewing\b/i.test(text);
}
