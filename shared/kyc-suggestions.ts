// Suggested sub companies for a company (Woody, 24 November 2026: "if we put
// the top company in then using our search facility to be able to have a
// suggestion of sub companies or linked companies? Not exhaustive but
// helpful prompts"). Pure rules: the name stems searched, how candidates from
// each source are merged and ranked, and the words of each reason. The reads
// are server/kyc-suggestions.ts. A suggestion is only ever a prompt: a person
// ticks and adds it, and nothing is checked until they press KYC.

export type KycSuggestionSource = "companies_house" | "land_registry" | "gleif";

export interface KycSuggestion {
  key: string;
  name: string;
  number: string | null;        // a UK Companies House number when known
  status: string | null;        // its status at Companies House when read
  country: string | null;       // where it is registered, for one registered abroad
  reasons: string[];
  sources: KycSuggestionSource[];
  score: number;
}

export interface KycSuggestionCandidate {
  name: string;
  number: string | null;
  status?: string | null;
  country?: string | null;
  source: KycSuggestionSource;
  // What links it to the company:
  ownedBy?: string | null;          // its person with significant control at Companies House is the company, one filed under it, or another suggestion
  sharedOfficers?: string[];        // officers it shares with the company
  sharedCorporateOfficer?: string | null;
  sameOffice?: boolean;             // the same registered office
  titles?: number;                  // Land Registry titles it owns
  gleifParent?: string | null;      // GLEIF records it as a subsidiary of this
  nameMatch?: boolean;              // its name starts with the company's
}

const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/** A Companies House number as the register writes it: eight characters, digits padded. */
export function normaliseCompanyNumber(n: unknown): string | null {
  const s = clean(n).toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  if (/^\d{1,8}$/.test(s)) return s.padStart(8, "0");
  if (/^[A-Z]{2}\d{1,6}$/.test(s)) return s.slice(0, 2) + s.slice(2).padStart(6, "0");
  return s;
}

const LEGAL = /\b(limited|ltd|plc|p\.l\.c|llp|lp|llc|inc|company|co|the)\b\.?/g;
const GROUPISH = /\b(group|holdings?|uk|gb|international)\b/g;

/** The words a company's group companies usually start with ("Land Securities Group PLC" → "land securities"). */
export function nameStems(names: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const base = clean(raw).toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9&' ]+/g, " ").replace(LEGAL, " ").replace(GROUPISH, " ").replace(/\s+/g, " ").trim();
    if (!base) continue;
    const words = base.split(" ").filter(Boolean);
    const stem = words.slice(0, 2).join(" ");
    // Too short to tell group companies from strangers ("abc", "one").
    if (stem.replace(/[^a-z0-9]/g, "").length < 5) continue;
    if (!out.includes(stem)) out.push(stem);
  }
  return out.slice(0, 3);
}

/** Does a company name start with one of the stems, word for word? */
export function startsWithStem(name: string, stems: string[]): boolean {
  const n = ` ${clean(name).toLowerCase().replace(/[^a-z0-9&' ]+/g, " ").replace(/\s+/g, " ").trim().replace(/^the /, "")} `;
  return stems.some(s => n.startsWith(` ${s} `));
}

const DEAD = /dissolved|closed|converted-closed|liquidation|removed|struck/i;

/** Merge the candidates from every source into one list, strongest first, leaving out the company itself, what is filed, and dissolved companies. */
export function rankSuggestions(candidates: KycSuggestionCandidate[], known: { numbers: string[]; names: string[] }, limit = 12): KycSuggestion[] {
  const knownNumbers = new Set(known.numbers.map(normaliseCompanyNumber).filter((x): x is string => !!x));
  const knownNames = new Set(known.names.map(n => clean(n).toLowerCase()));
  const merged = new Map<string, KycSuggestion & { ownedBy: string | null; shared: Set<string>; corporate: string | null; office: boolean; titles: number; gleif: string | null; nameMatch: boolean }>();
  for (const c of candidates) {
    const number = normaliseCompanyNumber(c.number);
    const name = clean(c.name);
    if (!name) continue;
    if ((number && knownNumbers.has(number)) || knownNames.has(name.toLowerCase())) continue;
    const key = number || name.toLowerCase();
    const m = merged.get(key) || { key, name, number, status: null, country: null, reasons: [], sources: [], score: 0, ownedBy: null, shared: new Set<string>(), corporate: null, office: false, titles: 0, gleif: null, nameMatch: false };
    if (c.status && !m.status) m.status = c.status;
    if (c.country && !m.country) m.country = clean(c.country);
    if (!m.sources.includes(c.source)) m.sources.push(c.source);
    if (c.ownedBy) m.ownedBy = c.ownedBy;
    for (const o of c.sharedOfficers || []) m.shared.add(o);
    if (c.sharedCorporateOfficer) m.corporate = c.sharedCorporateOfficer;
    if (c.sameOffice) m.office = true;
    if (c.titles) m.titles = Math.max(m.titles, c.titles);
    if (c.gleifParent) m.gleif = c.gleifParent;
    if (c.nameMatch) m.nameMatch = true;
    merged.set(key, m);
  }
  const out: KycSuggestion[] = [];
  for (const m of merged.values()) {
    if (m.status && DEAD.test(m.status)) continue;
    const reasons: string[] = [];
    let score = 0;
    if (m.ownedBy) { reasons.push(`Owned or controlled by ${m.ownedBy} (Companies House)`); score += 100; }
    if (m.gleif) { reasons.push(`A subsidiary of ${m.gleif} (GLEIF)`); score += 50; }
    if (m.corporate) { reasons.push(`${m.corporate} is an officer of both (Companies House)`); score += 45; }
    const shared = [...m.shared];
    if (shared.length >= 2) { reasons.push(`Shares ${shared.length} directors with the company${m.office ? ", and its registered office" : ""} (Companies House)`); score += 20 * Math.min(shared.length, 4); }
    else if (shared.length === 1) { reasons.push(`Shares a director, ${shared[0]}${m.office ? ", and the registered office" : ""} (Companies House)`); score += 15; }
    else if (m.office) { reasons.push("Same registered office (Companies House)"); score += 25; }
    if (m.titles) { reasons.push(`Owns ${m.titles} title${m.titles === 1 ? "" : "s"} in England and Wales (Land Registry)`); score += 20 + Math.min(m.titles, 10); }
    // A name is a prompt, never proof: said whenever nothing stronger ties it to the company.
    if (m.nameMatch && !m.ownedBy && !m.gleif) reasons.push("Its name starts like the company's");
    if (m.nameMatch) score += 8;
    // A name alone, or one shared director alone, is too weak to suggest.
    if (score < 20) continue;
    out.push({ key: m.key, name: m.name, number: m.number, status: m.status, country: m.country, reasons, sources: m.sources, score });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "en-GB")).slice(0, limit);
}
