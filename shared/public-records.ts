// Verified from public sources: the search and its suggestion (Woody, 23
// November 2026: "the verified for public records button should search and
// pull out what it can to actually verify for public records can it also then
// make a suggestion if thats a reasonable amount or have to ask for further
// info"). The web search is server/public-records.ts; this file keeps only
// what a read source said, and suggests. The officer decides: nothing here
// records a verification.

export const PUBLIC_RECORD_FACT_KINDS = ["role", "company", "age", "nationality", "residence", "other"] as const;
export type PublicRecordFactKind = (typeof PUBLIC_RECORD_FACT_KINDS)[number];

export interface PublicRecordFact {
  kind: PublicRecordFactKind;
  fact: string;            // what the source says, in a sentence
  url: string;
  source: string | null;   // the publication or site
  sameIdentity: "likely" | "unsure";
}

export interface PublicRecordsResult {
  profile: "high" | "some" | "none";
  facts: PublicRecordFact[];
  // Facts the search gave with no source it read: counted, never shown.
  unsourced: number;
}

export interface PublicRecordsSuggestion {
  enough: boolean;
  // "Enough to verify from public sources: 3 sources tie Claude Bosi to Brasserie Bordelaise Limited."
  words: string;
  reasons: string[];
}

const host = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};
// Sites that are one source however many pages they have (a company's own
// site counts once). A country's second level (co.uk, com.au) is part of the name.
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "ltd", "plc", "me", "edu", "nhs", "sch", "police", "mod"]);
const siteOf = (url: string) => {
  const parts = host(url).split(".");
  return parts.slice(parts.length >= 3 && SECOND_LEVEL.has(parts[parts.length - 2]) ? -3 : -2).join(".");
};

/** The search's answer made safe: only facts whose page the search actually read. */
export function checkPublicRecordsAnswer(raw: unknown, citations: Array<{ url: string } | string>): PublicRecordsResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const read = new Set(citations.map(c => typeof c === "string" ? c : c?.url).filter(Boolean).map(u => String(u).replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase()));
  const readHosts = new Set([...read].map(u => host(u)));
  const profile = r.profile === "high" || r.profile === "some" ? r.profile : "none";
  let unsourced = 0;
  const facts: PublicRecordFact[] = [];
  for (const f of Array.isArray(r.facts) ? r.facts : []) {
    const x = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    const fact = typeof x.fact === "string" ? x.fact.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    const url = typeof x.url === "string" ? x.url.trim() : "";
    if (!fact) continue;
    const key = url.replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();
    if (!/^https?:\/\//i.test(url) || (!read.has(key) && !readHosts.has(host(url)))) { unsourced++; continue; }
    facts.push({
      kind: (PUBLIC_RECORD_FACT_KINDS as readonly string[]).includes(String(x.kind)) ? x.kind as PublicRecordFactKind : "other",
      fact, url, source: typeof x.source === "string" && x.source.trim() ? x.source.trim().slice(0, 120) : host(url) || null,
      sameIdentity: x.sameIdentity === "unsure" ? "unsure" : "likely",
    });
  }
  return { profile: facts.length ? profile : "none", facts: facts.slice(0, 12), unsourced };
}

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
const LEGAL = new Set(["ltd", "limited", "plc", "llp", "lp", "group", "holdings", "the", "and", "co", "company", "uk"]);
/** A fact names the company: every telling word of its name is in the fact. */
export function factNamesCompany(fact: string, company: string): boolean {
  const want = words(company).filter(w => !LEGAL.has(w) && w.length > 1);
  if (!want.length) return false;
  const have = new Set(words(fact));
  return want.every(w => have.has(w));
}

/** A year of birth a fact gives: "born in 1976", "(b. 1976)", "aged 49" (against today's year). */
export function yearOfBirthIn(fact: string, today: Date): number | null {
  const born = fact.match(/\b(?:born|b\.)\s*(?:in\s+)?(?:[a-z]+\s+)?(?:\d{1,2}\s+)?(?:[a-z]+\s+)?(19\d{2}|20[01]\d)\b/i);
  if (born) return Number(born[1]);
  const aged = fact.match(/\baged?\s+(\d{2})\b|\b(\d{2})[-\s]year[-\s]old\b/i);
  const age = aged ? Number(aged[1] || aged[2]) : NaN;
  return Number.isFinite(age) && age >= 18 && age <= 110 ? today.getUTCFullYear() - age : null;
}

/**
 * Whether what was found is a reasonable amount to verify the person from
 * public sources (KYC4U's "Public figure" method: copies of reliable public
 * sources showing who they are): at least two separate sites that are about
 * them, at least one tying them to the company, and nothing that gives
 * another age than the register's. Otherwise: ask for their ID.
 */
export function publicRecordsSuggestion(
  result: PublicRecordsResult,
  person: { name: string; dob?: { year?: number | null } | null },
  company: string | null,
  today: Date,
): PublicRecordsSuggestion {
  const sure = result.facts.filter(f => f.sameIdentity === "likely");
  const sites = new Set(sure.map(f => siteOf(f.url)));
  const tied = !!company && sure.some(f => (f.kind === "role" || f.kind === "company") && factNamesCompany(f.fact, company));
  const years = sure.map(f => yearOfBirthIn(f.fact, today)).filter((y): y is number => y != null);
  const registerYear = person.dob?.year || null;
  const clash = !!registerYear && years.some(y => Math.abs(y - registerYear) > 1);
  const reasons: string[] = [];
  if (!sure.length) reasons.push("Nothing reliable was found about them");
  else {
    if (sites.size < 2) reasons.push(`Only ${sites.size === 1 ? "one source" : "no source"} is about them`);
    if (!tied) reasons.push(company ? `No source ties them to ${company}` : "No source ties them to the company");
    if (clash) reasons.push(`The age in the sources does not match the register's (born ${registerYear})`);
  }
  if (result.profile === "none" && sure.length) reasons.push("They have little public profile");
  const enough = !reasons.length;
  return {
    enough,
    words: enough
      ? `Enough to verify from public sources: ${sites.size} sources tie ${person.name} to ${company}.`
      : "Ask for their ID: the public sources are not enough.",
    reasons,
  };
}

/** A note for the officer to check and save: what the sources show. */
export function publicRecordsNote(result: PublicRecordsResult, person: string): string {
  const sure = result.facts.filter(f => f.sameIdentity === "likely").slice(0, 4);
  if (!sure.length) return "";
  return `${person}: ${sure.map(f => `${f.fact.replace(/\.$/, "")} (${f.source || host(f.url)})`).join("; ")}.`.slice(0, 1000);
}
