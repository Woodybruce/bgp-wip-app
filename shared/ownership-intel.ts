// Who owns the brand: the London Food Money Matrix as a standing source of
// brand intel (Woody, 2026-11-15: "This is good intel let's keep using this
// app for contacts and intel on brands"). The page is a public map of London
// restaurants, cafés and pubs that says, for each, whether it is private
// equity backed, venture backed, corporate owned or independent, who the
// owner is, since when, and links the source it took that from.
//
// This file is the pure half: reading the page, matching its names to the
// brand directory, and deciding what may be written. The rules:
//   - a name is matched only to exactly ONE visible tenant brand; a brand is
//     never created from the page;
//   - the owner is kept as the page's reading, in its own saved field, with
//     the source link and the date read: it is never presented as BGP's own;
//   - the page is about food and drink, so a brand recorded as another kind
//     of business (Tenant - Retail with no food word) is not matched by name
//     alone: it is listed for a person;
//   - Backers is filled only for a private equity or venture owner, and only
//     when it is blank (or still holds exactly what an earlier read put
//     there); a value a person or another reader set is never overwritten,
//     and a disagreement is listed for a person;
//   - a corporate parent or an independent's founders are not backers: they
//     are shown on the owner line and Backers is left alone;
//   - a read that looks cut short changes nothing.

export const OWNERSHIP_SOURCE_NAME = "London Food Money Matrix";
export const OWNERSHIP_SOURCE_URL = "https://london-food-money-matrix.vercel.app/";
// The key under crm_companies.ai_generated_fields. It is on no client list,
// so no client login is sent it.
export const OWNERSHIP_INTEL_KEY = "ownership_intel";

export type OwnershipKind = "pe" | "vc" | "corp" | "ind";
export const OWNERSHIP_KIND_LABEL: Record<OwnershipKind, string> = {
  pe: "private equity", vc: "venture capital", corp: "corporate owner", ind: "independent",
};

export interface OwnershipPlace {
  name: string; kind: OwnershipKind; owner: string; since: number | null;
  note: string; source: string | null; area: string;
}

// What is saved on the brand: the page's reading, attributed and dated.
export interface OwnershipIntel {
  owner: string; kind: OwnershipKind; since: number | null; note: string; source: string | null;
  via: string; viaUrl: string; readAt: string; firstSeenAt: string;
  // Backers was blank and this read filled it with `owner`.
  filledBackers?: boolean;
  // The owner the page gave before the one it gives now.
  previous?: { owner: string; kind: OwnershipKind; until: string };
}

const clean = (value: unknown, max: number) => typeof value === "string"
  ? value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
const KINDS = new Set<string>(["pe", "vc", "corp", "ind"]);

// The page holds its list as one array literal, `PLACES = [ {...}, ... ]`,
// written as JSON. Anything else (a redesign, an error page) reads as null.
export function readOwnershipPage(html: string, now = new Date()): OwnershipPlace[] | null {
  const at = html.search(/\bPLACES\s*=\s*\[/);
  if (at < 0) return null;
  const start = html.indexOf("[", at);
  let depth = 0, inString = false, escaped = false, end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) { end = i; break; }
  }
  if (end < 0) return null;
  let rows: unknown;
  try { rows = JSON.parse(html.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(rows)) return null;
  const maxYear = now.getUTCFullYear() + 1;
  const places: OwnershipPlace[] = [];
  for (const row of rows as any[]) {
    if (!row || typeof row !== "object") continue;
    const name = clean(row.n, 120), kind = String(row.c || "");
    if (!name || !KINDS.has(kind)) continue;
    const year = typeof row.y === "number" ? row.y : /^\d{4}$/.test(String(row.y || "").trim()) ? Number(row.y) : NaN;
    const src = typeof row.src === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(row.src.trim()) ? row.src.trim().slice(0, 500) : null;
    places.push({
      name, kind: kind as OwnershipKind, owner: clean(row.o, 200),
      since: Number.isInteger(year) && year >= 1800 && year <= maxYear ? year : null,
      note: clean(row.note, 400), source: src, area: clean(row.area, 80),
    });
  }
  return places;
}

// One spelling per name: case, accents, apostrophes and punctuation ignored,
// "&" read as "and", a leading "The" and a trailing Ltd / Limited / plc / UK
// dropped. Nothing else is stripped: "Monmouth Coffee" is not "Monmouth".
export function ownershipNameKey(name: string): string {
  const plain = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[’'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/^the\s+/, "").replace(/\s+(ltd|limited|plc|uk)$/g, "");
  return plain.replace(/\s+/g, "");
}

// Does our Backers text already name the page's owner? Any one of the names
// the page gives is enough: each owner it lists, and a group it names in
// brackets ("Epiris (The Big Table Group)"). A trailing Credit / Capital /
// Partners / Group / Holdings is not needed to agree ("Bain Capital Credit"
// against our "Bain Capital").
const OWNER_TAIL = /\s+(credit|capital|partners|group|holdings|equity|investments?|plc|llp|inc|corp)$/;
export function sameOwner(ours: string, theirs: string): boolean {
  const have = ownershipNameKey(ours);
  if (!have) return false;
  const names = [...theirs.replace(/\(.*?\)/g, " ").split(/[,;+/]|\s+and\s+|&/i), ...[...theirs.matchAll(/\(([^)]*)\)/g)].map(match => match[1])];
  for (const raw of names) {
    let name = raw.replace(/[~\d%]+|\b(minority|majority|stake|via|owner of|backed by)\b/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
    for (let i = 0; i < 3; i++) {
      const key = ownershipNameKey(name);
      if (key.length >= 3 && have.includes(key)) return true;
      const shorter = name.replace(OWNER_TAIL, "");
      if (shorter === name) break;
      name = shorter;
    }
  }
  return false;
}

// The page lists restaurants, cafés, bakeries, bars and pubs. A brand whose
// type and industry say nothing is taken on its name; one recorded as
// another kind of business is not.
const FOOD_WORDS = /(restaurant|caf[eé]|food|f\s*&\s*b|fnb|bakery|coffee|qsr|quick.?service|fast.?food|dining|kitchen|\bpubs?\b|\bbars?\b|brewery|hospitality|takeaway|dessert|ice.?cream|juice|sandwich|pizza|burger|chicken|sushi|noodle|drink|beverage)/i;
export function ownershipKindFits(companyType: string | null | undefined, industry: string | null | undefined): boolean {
  const type = String(companyType || "").replace(/^tenant\b[\s\-–]*/i, "").trim();
  const sector = String(industry || "").trim();
  return (!type && !sector) || FOOD_WORDS.test(`${type} ${sector}`);
}

// A read with under 100 places, or under 60% of the last good read, is
// treated as cut short: nothing is written from it.
export function ownershipReadCutShort(count: number, lastCount: number | null): boolean {
  return count < 100 || (lastCount != null && lastCount > 0 && count < lastCount * 0.6);
}

export interface OwnershipBrand {
  id: string; name: string; backers: string | null; hidden: boolean;
  // Recorded as food and drink, or as nothing in particular (ownershipKindFits).
  fits: boolean; recordedAs?: string;
  intel: OwnershipIntel | null;
}
export interface OwnershipWrite { id: string; name: string; intel: OwnershipIntel; setBackers: string | null; backersWas: string }
export interface OwnershipReport {
  readAt: string; sourceUrl: string; places: number;
  byKind: Record<OwnershipKind, number>;
  matched: number; filledBackers: number; unchanged: number;
  // Our Backers names someone else: a person decides.
  differs: Array<{ id: string; name: string; ours: string; theirs: string; kind: OwnershipKind; source: string | null }>;
  // The page now names a different owner from the one it gave at the last read.
  ownerChanges: Array<{ id: string; name: string; was: string; now: string; kind: OwnershipKind; source: string | null }>;
  // Backed operators the directory does not hold (never added by the read).
  notInDirectory: Array<{ name: string; owner: string; kind: OwnershipKind; area: string; source: string | null }>;
  independentsNotInDirectory: number;
  // A name that fits several records, a hidden brand, or two places under one name.
  skipped: Array<{ name: string; why: string }>;
}

export function planOwnership(places: OwnershipPlace[], brands: OwnershipBrand[], readAt: string, sourceUrl = OWNERSHIP_SOURCE_URL): { writes: OwnershipWrite[]; report: OwnershipReport } {
  const byKey = new Map<string, OwnershipBrand[]>();
  for (const brand of brands) {
    const key = ownershipNameKey(brand.name);
    if (key) byKey.set(key, [...(byKey.get(key) || []), brand]);
  }
  const placesByKey = new Map<string, OwnershipPlace[]>();
  for (const place of places) {
    const key = ownershipNameKey(place.name);
    if (key) placesByKey.set(key, [...(placesByKey.get(key) || []), place]);
  }
  const report: OwnershipReport = {
    readAt, sourceUrl, places: places.length, byKind: { pe: 0, vc: 0, corp: 0, ind: 0 },
    matched: 0, filledBackers: 0, unchanged: 0, differs: [], ownerChanges: [], notInDirectory: [], independentsNotInDirectory: 0, skipped: [],
  };
  for (const place of places) report.byKind[place.kind]++;
  const writes: OwnershipWrite[] = [];
  for (const [key, group] of placesByKey) {
    const place = group[0];
    if (group.length > 1 && group.some(other => other.owner !== place.owner || other.kind !== place.kind)) {
      report.skipped.push({ name: place.name, why: "listed more than once with different owners" });
      continue;
    }
    const found = byKey.get(key) || [];
    const visible = found.filter(brand => !brand.hidden);
    if (!found.length) {
      if (place.kind === "ind") report.independentsNotInDirectory++;
      else report.notInDirectory.push({ name: place.name, owner: place.owner, kind: place.kind, area: place.area, source: place.source });
      continue;
    }
    if (visible.length !== 1) {
      report.skipped.push({ name: place.name, why: visible.length ? "fits more than one brand record" : "the brand is hidden" });
      continue;
    }
    const brand = visible[0];
    if (!brand.fits) {
      report.skipped.push({ name: place.name, why: `the brand of that name is recorded as ${brand.recordedAs || "another kind of business"}` });
      continue;
    }
    report.matched++;
    const before = brand.intel;
    const ours = String(brand.backers || "").trim();
    // Only an outside investor is a backer: a corporate parent and an
    // independent's founders are shown on the owner line, not in Backers.
    const backed = (place.kind === "pe" || place.kind === "vc") && !!place.owner;
    // Backers is ours to set while it is blank, or while it still holds
    // exactly what an earlier read put there.
    const oursToSet = backed && (!ours || (!!before?.filledBackers && ours === before.owner));
    const ownerMoved = !!before && !!before.owner && before.owner !== place.owner;
    const intel: OwnershipIntel = {
      owner: place.owner, kind: place.kind, since: place.since, note: place.note, source: place.source,
      via: OWNERSHIP_SOURCE_NAME, viaUrl: sourceUrl, readAt, firstSeenAt: before?.firstSeenAt || readAt,
      ...(oursToSet ? { filledBackers: true } : {}),
      ...(ownerMoved ? { previous: { owner: before!.owner, kind: before!.kind, until: readAt } } : before?.previous ? { previous: before.previous } : {}),
    };
    if (ownerMoved) report.ownerChanges.push({ id: brand.id, name: brand.name, was: before!.owner, now: place.owner, kind: place.kind, source: place.source });
    if (backed && ours && !oursToSet && !sameOwner(ours, place.owner)) {
      report.differs.push({ id: brand.id, name: brand.name, ours, theirs: place.owner, kind: place.kind, source: place.source });
    }
    const setBackers = oursToSet && ours !== place.owner ? place.owner : null;
    if (setBackers) report.filledBackers++;
    const same = !!before && before.owner === intel.owner && before.kind === intel.kind && before.since === intel.since
      && before.note === intel.note && before.source === intel.source && !!before.filledBackers === !!intel.filledBackers;
    if (same && !setBackers) { report.unchanged++; continue; }
    writes.push({ id: brand.id, name: brand.name, intel, setBackers, backersWas: ours });
  }
  // Private equity first, then venture, then corporate parents; by name within each.
  const kindOrder: Record<OwnershipKind, number> = { pe: 0, vc: 1, corp: 2, ind: 3 };
  report.notInDirectory.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name));
  return { writes, report };
}

// "private equity since 2018": the words after the owner on a brand's page.
export function ownershipKindLine(intel: Pick<OwnershipIntel, "kind" | "since">): string {
  return `${OWNERSHIP_KIND_LABEL[intel.kind]}${intel.since ? ` since ${intel.since}` : ""}`;
}
