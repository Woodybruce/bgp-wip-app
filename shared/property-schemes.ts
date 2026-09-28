// Schemes — the named parts of one estate or centre (Canary Wharf: Jubilee
// Place, Cabot Place, Crossrail Place…). A unit carries its scheme as a
// plain label (tenancy grouping, leasing zone, available_units.scheme,
// crm_deals.scheme); property_schemes holds the facts per scheme. These
// helpers are the one way labels are compared, client and server.

/** "The Jubilee Place" / "jubilee-place" / "JUBILEE PLACE" → "jubilee place". */
export function schemeKey(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^\s*the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function sameScheme(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = schemeKey(a);
  return !!ka && ka === schemeKey(b);
}

/** The scheme a label names: the same name, or — when only one scheme
 *  fits — a whole-word short form ("Crossrail" for "Crossrail Place"). */
export function findScheme<T extends { name: string }>(schemes: readonly T[], label: string | null | undefined): T | undefined {
  const key = schemeKey(label);
  if (!key) return undefined;
  const exact = schemes.find(s => schemeKey(s.name) === key);
  if (exact) return exact;
  const partial = schemes.filter(s => {
    const k = schemeKey(s.name);
    return k.startsWith(`${key} `) || key.startsWith(`${k} `);
  });
  return partial.length === 1 ? partial[0] : undefined;
}

/** The scheme a unit's own name mentions ("Unit 4 Cabot Place"); the
 *  longest match wins ("One Canada Square" over a "Canada" scheme). */
export function schemeInName<T extends { name: string }>(schemes: readonly T[], name: string | null | undefined): T | undefined {
  const text = ` ${schemeKey(name)} `;
  if (!text.trim()) return undefined;
  return schemes
    .filter(s => { const k = schemeKey(s.name); return k.length >= 3 && text.includes(` ${k} `); })
    .sort((a, b) => schemeKey(b.name).length - schemeKey(a.name).length)[0];
}

/** A unit's scheme: its label (grouping / zone / scheme) when that names one,
 *  else the scheme its own name mentions. */
export function unitScheme<T extends { name: string }>(schemes: readonly T[], label: string | null | undefined, unitName?: string | null): T | undefined {
  return findScheme(schemes, label) || (unitName ? schemeInName(schemes, unitName) : undefined);
}

// Generic words a centre's name carries that its units' names often drop:
// "Canary Wharf Estate, London E14, UK" is "Canary Wharf" to the team.
const ESTATE_SUFFIX = /\s+(estate|shopping cent(?:re|er)|cent(?:re|er)|retail park|shopping park|quarter|development)$/i;

/** The short name of an estate: the first part of the name, without a
 *  leading "The" or a generic suffix. */
export function estateCoreName(name: string | null | undefined): string {
  const first = String(name || "").split(/[,(]/)[0].replace(/^\s*the\s+/i, "").trim();
  const core = first.replace(ESTATE_SUFFIX, "").trim();
  return core || first;
}

export type UnitLikeName = { kind: string; ref: string; label: string; rest: string };

// "Unit 48 Jubilee Place", "Unit RS315 Canary Wharf", "Kiosk 3 Wharf Kitchen",
// "Units 29/30, Jubilee Place", "Shop 4a at Cabot Place". The ref must carry
// a digit so "Unit Street" isn't read as a unit.
const UNIT_LIKE = /^(units?|kiosks?|shops?|suites?|stores?)\s+(?:no\.?\s*)?([a-z0-9][a-z0-9./:-]*(?:\s*(?:&|and|\/|-)\s*[a-z0-9][a-z0-9./:-]*)?)\s*(?:[,–—-]\s*|\s+(?:at|@)\s+|\s+)(.+)$/i;

/** A property name that is really a unit of somewhere else, split into the
 *  unit and the rest; null for an ordinary name. */
export function parseUnitLikeName(name: string | null | undefined): UnitLikeName | null {
  const text = String(name || "").replace(/\s+/g, " ").trim();
  const m = text.match(UNIT_LIKE);
  if (!m || !/\d/.test(m[2])) return null;
  const rest = m[3].replace(/^\s*the\s+/i, "").replace(/[\s,.–—-]+$/, "").trim();
  if (schemeKey(rest).length < 3) return null;
  const word = m[1].toLowerCase();
  const kind = word.charAt(0).toUpperCase() + word.slice(1);
  const ref = m[2].replace(/\s+/g, " ").replace(/\band\b/gi, "&").toUpperCase();
  return { kind, ref, label: `${kind} ${ref}`, rest };
}

export type EstateCandidate = {
  propertyId: string;
  propertyName: string;
  aliases?: unknown;
  schemes?: Array<{ name: string }>;
};

export type EstateMatch = { propertyId: string; propertyName: string; scheme: string | null };

/** Which existing estate a unit-like name belongs to: the rest of the name
 *  is the estate's name (or short name or an alias) or one of its schemes.
 *  Only an unambiguous answer counts. */
export function matchEstate(parsed: UnitLikeName, candidates: readonly EstateCandidate[]): EstateMatch | null {
  const restKeys = new Set([schemeKey(parsed.rest), schemeKey(parsed.rest.split(",")[0])].filter(k => k.length >= 3));
  const hits = new Map<string, EstateMatch>();
  for (const c of candidates) {
    if (parseUnitLikeName(c.propertyName)) continue; // another unit-named record, not the estate
    const names = [c.propertyName, c.propertyName.split(/[,(]/)[0], estateCoreName(c.propertyName),
      ...(Array.isArray(c.aliases) ? c.aliases.map(a => String(a || "")) : [])];
    const scheme = (c.schemes || []).find(s => restKeys.has(schemeKey(s.name)));
    if (scheme) { hits.set(c.propertyId, { propertyId: c.propertyId, propertyName: c.propertyName, scheme: scheme.name }); continue; }
    if (names.some(n => restKeys.has(schemeKey(n)))) {
      hits.set(c.propertyId, { propertyId: c.propertyId, propertyName: c.propertyName, scheme: null });
    }
  }
  return hits.size === 1 ? [...hits.values()][0] : null;
}

/** Order-free key for comparing unit references across naming styles:
 *  "Unit 4 Cabot Place", "Cabot Place Unit 04" and "cabot place 4" agree. */
export function unitRefKey(value: string | null | undefined): string {
  return String(value || "")
    .toUpperCase()
    .replace(/\b(UNITS?|STORE|SHOP)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(token => token.replace(/^0+(?=\d)/, "").replace(/([A-Z]+)0+(\d)/g, "$1$2"))
    .sort()
    .join(" ");
}

/** The unit's name as it sits on the estate: the scheme appended when the
 *  unit ref alone would repeat across schemes ("Unit 1" is in Cabot Place
 *  and Jubilee Place). */
export function estateUnitName(label: string, scheme: string | null | undefined): string {
  const l = String(label || "").trim();
  if (!scheme || schemeKey(l).includes(schemeKey(scheme))) return l;
  return `${l} ${String(scheme).trim()}`;
}
