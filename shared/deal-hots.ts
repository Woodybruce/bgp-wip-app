// Heads of terms read on the transaction page (Woody, 23 November 2026, on
// Bill's · Unit 7a's Parties & AML, at "To do · Set the company that signs":
// "where is the upload HOTs place? so can populate?"). The reading names each
// party's legal company and its Companies House number, the guarantor and the
// terms; the screen offers each as a choice and saves nothing by itself.
//
// This file holds the rules and the checks: what may be read, that every value
// is in the document's own words, the rules reader that fills what the
// provider leaves out, and how a term compares with the transaction. The
// reading and the look-ups are server/deal-hots.ts; the screen is
// client/src/components/deal-hots.tsx.
import { partyNameKey, readDealNoteRules, type DealNoteCandidate, type DealNoteRegisterHit } from "./deal-note";
import { readShorthand } from "./letting-note-parse";
import type { DealPartyRole } from "./deal-parties";

export const HOTS_PARTY_ROLES = ["landlord", "tenant", "vendor", "purchaser", "guarantor"] as const;
export type HotsPartyRole = (typeof HOTS_PARTY_ROLES)[number];
export const HOTS_ROLE_WORDS: Record<HotsPartyRole, string> = {
  landlord: "Landlord", tenant: "Tenant", vendor: "Vendor", purchaser: "Purchaser", guarantor: "Guarantor",
};

/** A party as the heads of terms name it, with the words it was read from. */
export interface HotsParty {
  role: HotsPartyRole;
  name: string;
  /** The Companies House number the document gives, tidied (eight characters); null when it gives none. */
  number: string | null;
  quote: string;
  /** False when the document had no text to check it against (a scan): check it by eye. */
  checked: boolean;
}

export type HotsTermKey = "pricing" | "rentPa" | "leaseLength" | "breakOption" | "rentFree" | "capitalContribution" | "totalAreaSqft" | "targetDate";
export type HotsTermKind = "money" | "years" | "months" | "sqft" | "text" | "date";
export interface HotsTerm { key: HotsTermKey; value: number | string; quote: string; checked: boolean }
export interface HotsDrop { what: string; value: string; reason: string }
export interface HotsReading {
  parties: HotsParty[];
  terms: HotsTerm[];
  /** Each side's solicitors and agents, from the contact sheet or the clauses (23 November 2026). */
  contacts: HotsContact[];
  /** The provider read it (as well as the rules). */
  usedAi: boolean;
  /** The document had no text to check the reading against. */
  scanned: boolean;
  dropped: HotsDrop[];
  /** Why the provider did not read it, when it did not. */
  note: string | null;
}

/**
 * The terms the transaction holds, in the units it stores them: rent and price
 * a year in pounds, the lease in years, rent free in months, the break in words.
 * investment: only on a sale or purchase; letting: never on one.
 */
export const HOTS_TERMS: ReadonlyArray<{ key: HotsTermKey; label: string; kind: HotsTermKind; investment?: true; letting?: true }> = [
  { key: "pricing", label: "Price", kind: "money", investment: true },
  { key: "rentPa", label: "Rent a year", kind: "money", letting: true },
  { key: "leaseLength", label: "Lease (years)", kind: "years", letting: true },
  { key: "breakOption", label: "Break", kind: "text", letting: true },
  { key: "rentFree", label: "Rent free (months)", kind: "months", letting: true },
  { key: "capitalContribution", label: "Capital contribution", kind: "money", letting: true },
  { key: "totalAreaSqft", label: "Area (sq ft)", kind: "sqft" },
  { key: "targetDate", label: "Target date", kind: "date" },
];
export const hotsTermDef = (key: HotsTermKey) => HOTS_TERMS.find(t => t.key === key)!;
export const isInvestmentDeal = (dealType: string | null | undefined): boolean => dealType === "Sale" || dealType === "Purchase" || dealType === "Investment";
/** The terms shown for a transaction of this type. */
export const hotsTermsFor = (dealType: string | null | undefined) => {
  const investment = isInvestmentDeal(dealType);
  return HOTS_TERMS.filter(t => (investment ? !t.letting : !t.investment));
};
/** The parties the transaction carries for its type: vendor and purchaser on a sale or purchase, landlord and tenant otherwise. */
export const hotsDealRoles = (dealType: string | null | undefined): Array<"landlord" | "tenant" | "vendor" | "purchaser"> =>
  isInvestmentDeal(dealType) ? ["vendor", "purchaser"] : ["landlord", "tenant"];

// ── Words ───────────────────────────────────────────────────────────────────

const squash = (s: unknown): string => String(s ?? "")
  .normalize("NFKC")
  .replace(/[‘’‛′´`]/g, "'")
  .replace(/[“”″]/g, '"')
  .replace(/[‐-―−]/g, "-")
  .replace(/ /g, " ")
  .toLowerCase();
/** Letters and digits only: how a quote is found in a document whose line breaks and spacing differ. */
export const alnum = (s: unknown): string => squash(s).replace(/[^a-z0-9]+/g, "");
const oneLine = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * The key two registered company names are the same company by: case,
 * punctuation and the legal form aside ("Bill's Restaurants Ltd" is "BILL'S
 * RESTAURANTS LIMITED"), but every word kept, a bracketed one too
 * ("Braeburn Estates (Holdings) Limited" is another company).
 */
export function legalNameKey(name: unknown): string {
  let s = squash(name).replace(/&/g, " and ").replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the\s+/, "");
  for (let i = 0; i < 2; i++) s = s.replace(/\s*\b(?:limited|ltd|public limited company|plc|llp|limited liability partnership|lp|llc|inc|incorporated)\s*$/, "").trim();
  return s.replace(/\s+/g, "");
}

/** Words that say little about which company it is. */
const GENERIC_NAME_WORDS = new Set([
  "the", "and", "of", "for", "uk", "gb", "england", "london", "british", "group", "holdings", "holding", "company", "co",
  "limited", "ltd", "plc", "llp", "lp", "llc", "inc", "incorporated", "services", "international", "trading",
  "properties", "property", "estates", "estate", "investments", "investment", "developments", "development", "management",
  "enterprises", "ventures", "partners", "partnership", "capital", "assets", "land", "homes", "retail", "restaurants",
  "restaurant", "nominees", "nominee", "no",
]);

const nameWords = (name: unknown): string[] =>
  squash(name).replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(w => w.length >= 2);

/**
 * The company a document's number names could be the company it names: the
 * same legal name, or a word in common that tells companies apart ("Bill's
 * Restaurants Limited" and BILLS RESTAURANTS LTD.). With none, the number is
 * another company's: 06327384 given for Braeburn Estates Limited was AUSTIN
 * BARBER DESIGN LIMITED at Companies House (live check, 23 November 2026).
 * A name made only of common words is compared on all its words.
 */
/**
 * The person a party line names, when the name reads as a person's and not a
 * company's ("Caitlin Johal", "Mr John Smith"): titles and "trading as" taken
 * off. Null for anything that may be a company. It only decides what the
 * heads of terms dialog offers first (Woody, 23 November 2026: "read hots and
 * click choose company and it went back to previous board nothing saved");
 * the person is saved only when someone presses.
 */
export function hotsPersonName(raw: unknown): string | null {
  let s = oneLine(raw).replace(/\s*[,(]?\s*(?:t\/a|trading as)\b.*$/i, "").replace(/[),\s]+$/, "").trim();
  s = s.replace(/^(?:mr|mrs|ms|miss|mx|dr|sir|dame)\.?\s+/i, "");
  if (!s || /\d/.test(s) || /\b(?:ltd|limited|plc|llp|lp|llc|inc)\.?\s*$/i.test(s)) return null;
  const words = s.split(" ");
  if (words.length < 2 || words.length > 4 || /^the$/i.test(words[0])) return null;
  if (!words.every(w => /^[A-Z][A-Za-z'’-]*$/.test(w) || /^(?:van|von|de|da|di|du|la|le|bin|al)$/i.test(w))) return null;
  if (/\b(?:ag|bv|nv|sa|sas|sarl|gmbh|solicitors|law|legal|partners|partnership|property|properties|estates?|group|holdings?|associates|company|co|trust|trustees|foundation|fund|capital|investments?|ventures|management|retail|restaurants?|cafe|café|bakery|deli|bar|kitchen|foods?|trading|enterprises|international|uk|services|council|club|developments?|homes|hotels?|leisure)\b/i.test(s)) return null;
  return s;
}

export function hotsNamesClose(a: unknown, b: unknown): boolean {
  const ka = legalNameKey(a);
  if (ka && ka === legalNameKey(b)) return true;
  const pick = (ws: string[]) => {
    const kept = ws.filter(w => !GENERIC_NAME_WORDS.has(w));
    return kept.length ? kept : ws.filter(w => !["the", "and", "of", "limited", "ltd", "plc", "llp"].includes(w));
  };
  const x = new Set(pick(nameWords(a)));
  return pick(nameWords(b)).some(w => x.has(w));
}

/**
 * The document has enough text to check a reading against (not a scan). A
 * note a person typed is its own text, however short.
 */
export const documentHasText = (text: string | null | undefined, opts: HotsTextOptions = {}): boolean =>
  alnum(text).length >= (opts.note ? 3 : 200);
/** note: the text is a note a person typed, not a document's extracted text. */
export interface HotsTextOptions { note?: boolean }
/** The quote is the document's own words (spacing and punctuation aside). */
export function quoteInDocument(quote: string, text: string): boolean {
  const q = alnum(quote);
  return q.length >= 3 && alnum(text).includes(q);
}

/** A Companies House number as eight characters ("5211343" is "05211343", "SC 123456" is "SC123456"); null when it is not one. */
export function cleanCompanyNumber(raw: unknown): string | null {
  const s = String(raw ?? "").toUpperCase().replace(/[\s.\-/]/g, "");
  if (/^(?:SC|NI|OC|SO|NC|R0|LP|SL|NL|FC|SF|NF|IP|SP|RS|SI|NP|NO|IC|SE|CE|CS)\d{6}$/.test(s)) return s;
  if (/^\d{6,8}$/.test(s)) return s.padStart(8, "0");
  return null;
}
/** The number is in the words it was read from: as written, or without its leading zeros. */
export function numberInQuote(number: string, quote: string): boolean {
  const q = squash(quote);
  const n = number.toLowerCase();
  if (alnum(q).includes(n)) return true;
  const short = n.replace(/^0+/, "");
  if (short.length < 5 || /[a-z]/.test(short)) return false;
  return new RegExp(`(?:^|[^0-9])${short}(?![0-9])`).test(q.replace(/\s+/g, ""));
}
/** The name is in the words it was read from. */
export const nameInQuote = (name: string, quote: string): boolean => {
  const n = alnum(name);
  return n.length >= 2 && alnum(quote).includes(n);
};

// ── Figures in words ────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  "twenty-one": 21, "twenty-two": 22, "twenty-three": 23, "twenty-four": 24, "twenty-five": 25, thirty: 30, "thirty-five": 35, forty: 40,
};

/** The sums of money the words give, in pounds: "£85,000", "£85k", "£1.25m". */
export function moneyIn(words: string): number[] {
  const out: number[] = [];
  const re = /(£|gbp\s*)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:(k|m|mn|million|thousand)(?=pax\b|pa\b|p\.a\b|\b))?/gi;
  for (const m of squash(words).matchAll(re)) {
    let n = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const unit = (m[3] || "").toLowerCase();
    if (unit === "k" || unit === "thousand") n *= 1_000;
    else if (unit === "m" || unit === "mn" || unit === "million") n *= 1_000_000;
    // A bare small figure is not a sum unless it carries a £ or a unit.
    if (!m[1] && !unit && n < 1_000) continue;
    out.push(Math.round(n * 100) / 100);
  }
  return out;
}
/** The counts of a unit the words give: "10 years", "ten (10) year", "a 15 year lease", "6 months". */
export function countsIn(words: string, unit: "years" | "months"): number[] {
  // "momnths" is months typed in a hurry: a word of m, up to three letters, then "nths".
  const unitRe = unit === "years" ? "(?:years?|yrs?)" : "(?:months?|mths?|mos?|m[a-z]{1,3}nths?)";
  const out: number[] = [];
  const s = squash(words);
  for (const m of s.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?|[a-z]+(?:-[a-z]+)?)\\s*(?:\\(\\s*\\d+\\s*\\)\\s*)?${unitRe}\\b`, "g"))) {
    const v = /^\d/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}
/** The areas the words give in square feet. */
export function areasIn(words: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|sqft|square\s+feet|sq\s+feet|ft2|ft²|sf\b)/gi;
  for (const m of squash(words).matchAll(re)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}
const same = (a: number, b: number) => Math.abs(a - b) < 0.5;

/** A term's value is one the words give, in the unit the transaction stores. Null = fine; else why not. */
function termProblem(kind: HotsTermKind, value: unknown, quote: string): string | null {
  switch (kind) {
    case "money": {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return "not a sum of money";
      return moneyIn(quote).some(m => same(m, n)) ? null : "the sum is not in the words it came from";
    }
    case "years":
    case "months": {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0 || n > (kind === "years" ? 999 : 120)) return `not a number of ${kind}`;
      return countsIn(quote, kind).some(c => same(c, n)) ? null : `the number of ${kind} is not in the words it came from`;
    }
    case "sqft": {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return "not an area";
      return areasIn(quote).some(a => same(a, n)) ? null : "the area in square feet is not in the words it came from";
    }
    case "date": {
      const s = String(value ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) return "not a date";
      return alnum(quote).includes(s.slice(0, 4)) ? null : "the date is not in the words it came from";
    }
    case "text":
      return oneLine(value).length >= 2 ? null : "empty";
  }
}

// ── Checking a reading ──────────────────────────────────────────────────────

const ROLE_ALIASES: Record<string, HotsPartyRole> = {
  landlord: "landlord", lessor: "landlord", tenant: "tenant", lessee: "tenant", guarantor: "guarantor", surety: "guarantor",
  vendor: "vendor", seller: "vendor", purchaser: "purchaser", buyer: "purchaser",
};
export const hotsRole = (raw: unknown): HotsPartyRole | null => ROLE_ALIASES[String(raw ?? "").trim().toLowerCase()] || null;

/**
 * The provider's answer, kept only where the document's own words carry it:
 * each quote is in the document, each name is in its quote, each number and
 * figure is in its quote. A scanned document (no text) cannot be checked: its
 * values are kept and marked to check by eye.
 */
export function checkHotsAnswer(raw: unknown, documentText: string, opts: HotsTextOptions = {}): Omit<HotsReading, "usedAi" | "note"> {
  const answer = raw && typeof raw === "object" ? raw as Record<string, any> : {};
  const text = documentText || "";
  const checkable = documentHasText(text, opts);
  const dropped: HotsDrop[] = [];
  const parties: HotsParty[] = [];
  for (const p of Array.isArray(answer.parties) ? answer.parties.slice(0, 12) : []) {
    const role = hotsRole(p?.role);
    const name = oneLine(p?.name).slice(0, 160);
    const quote = oneLine(p?.quote).slice(0, 400);
    if (!role || name.length < 2) continue;
    if (checkable && !quoteInDocument(quote, text)) { dropped.push({ what: HOTS_ROLE_WORDS[role], value: name, reason: "its words are not in the document" }); continue; }
    if (checkable && !nameInQuote(name, quote)) { dropped.push({ what: HOTS_ROLE_WORDS[role], value: name, reason: "the name is not in the words it came from" }); continue; }
    let number = cleanCompanyNumber(p?.company_number ?? p?.number);
    if (number && checkable && !numberInQuote(number, quote) && !numberInQuote(number, text)) {
      dropped.push({ what: `${HOTS_ROLE_WORDS[role]}'s company number`, value: number, reason: "the number is not in the document" });
      number = null;
    }
    // One reading per party, a guarantor apart.
    if (role !== "guarantor" && parties.some(x => x.role === role)) continue;
    if (parties.some(x => x.role === role && alnum(x.name) === alnum(name))) continue;
    parties.push({ role, name, number, quote, checked: checkable });
  }
  const terms: HotsTerm[] = [];
  const rawTerms = answer.terms && typeof answer.terms === "object" ? answer.terms as Record<string, any> : {};
  for (const def of HOTS_TERMS) {
    const t = rawTerms[def.key];
    if (!t || typeof t !== "object" || t.value === null || t.value === undefined || t.value === "") continue;
    const quote = oneLine(t.quote).slice(0, 400);
    const value = def.kind === "text" || def.kind === "date" ? oneLine(t.value).slice(0, 200) : Number(String(t.value).replace(/[£,\s]/g, ""));
    if (checkable && !quoteInDocument(quote, text)) { dropped.push({ what: def.label, value: String(value), reason: "its words are not in the document" }); continue; }
    // The value is one its own words give, whether or not the document could be checked.
    const problem = termProblem(def.kind, value, quote);
    if (problem) { dropped.push({ what: def.label, value: String(value), reason: problem }); continue; }
    terms.push({ key: def.key, value, quote, checked: checkable });
  }
  const contacts = checkHotsContacts(answer.contacts, text, checkable, dropped);
  return { parties, terms, contacts, scanned: !checkable, dropped };
}

// ── The rules reader ────────────────────────────────────────────────────────
// Heads of terms are mostly "Label: value" lines, or a two-column table whose
// label sits on its own line above the value. The rules read the parties and
// the plain terms from that layout; the provider reads the rest.

const LEGAL_END = /\b(?:limited|ltd|plc|llp|l\.l\.p\.|lp|llc|inc|incorporated|s\.?a\.?r\.?l|gmbh|a\/s|b\.?v|n\.?v|s\.?a|ag|sas|spa|s\.p\.a)\.?$/i;
const NUMBER_PHRASE = /\b(?:company|co\.?|registration|registered|reg\.?|crn)\s*(?:registration\s+)?(?:no\.?|number|nos?\.?|#)?\s*[:.]?\s*((?:SC|NI|OC|SO|NC|FC|LP|SL)\s?\d{6}|\d{6,8})\b/i;
const NAME_STOPS = /\s*(?:\(|,\s*(?:a\s+company|company|registered|whose|incorporated|of\s)|\bwhose\b|\bregistered\s+(?:office|in|number)|\bincorporated\b|\bcompany\s+(?:no|number|registration)|\bco\.?\s+no\b|;|\bt\/a\b|\btrading\s+as\b)/i;

function nameFrom(value: string): string {
  const cut = value.split(NAME_STOPS)[0] || value;
  return oneLine(cut).replace(/[.;:,\s]+$/, "").replace(/^(?:the\s+)?(?:landlord|tenant|guarantor|vendor|seller|purchaser|buyer)\s*[:\-]\s*/i, "").slice(0, 160);
}

const NOT_A_PARTY = /^(?:to be confirmed|tbc|tba|n\/a|none|nil|not\s+(?:applicable|required|needed)|no\s+guarantor|\[)/i;
const CLAUSE_WORDS = /\b(?:break|fit[\s-]?out|works|covenants?|repairs?|repairing|insurance|alienation|deposit|option|obligations?|costs?|solicitors?|agents?|shall|will|may|to\s+be|responsible|consent|rights?)\b/i;
const LEAD = String.raw`^\s*(?:\d+(?:\.\d+)*\.?\s+)?`;
const SEP = String.raw`\s*(?:[:\-–—]|\t|\s{2,}|$)\s*(.*)$`;
const PARTY_WORD = String.raw`(?:the\s+)?(landlord|lessor|tenant|lessee|guarantor|surety|vendor|seller|purchaser|buyer)s?`;
const LABEL_LINE = new RegExp(`${LEAD}${PARTY_WORD}(?:'s)?(?:\\s*\\([^)]*\\))?${SEP}`, "i");
// A table read out of a PDF runs the label into its value with one space
// ("Tenant Bill's Restaurants Limited"): taken only when the value opens with
// a capital, a figure or a bracket, and never after a possessive
// ("Landlord's Solicitors Herbert Smith Freehills LLP" is not the landlord).
const LABEL_RUN = new RegExp(`${LEAD}${PARTY_WORD} (.+)$`, "i");
const opensValue = (v: string) => /^[A-Z0-9£$"'(“‘]/.test(v);

const TERM_LABEL_WORDS: Array<{ key: HotsTermKey; label: string }> = [
  { key: "pricing", label: String.raw`(?:(?:purchase|sale|agreed)\s+)?(?:price|consideration)` },
  { key: "rentPa", label: String.raw`(?:(?:initial|annual|base|basic|contracted|headline|passing)\s+)?rent(?:al)?(?:\s+\(?pa\)?)?(?!\s+(?:reviews?|free|deposit|commencement|payments?|payable|period|days?|smoothing)\b)` },
  { key: "leaseLength", label: String.raw`(?:lease\s+)?(?:term|length\s+of\s+(?:lease|term)|lease\s+length|duration)` },
  { key: "breakOption", label: String.raw`(?:(?:tenant'?s?|landlord'?s?|mutual)\s+)?break(?:\s+(?:clause|option|right))?s?` },
  { key: "rentFree", label: String.raw`rent[\s-]free(?:\s+period)?` },
  { key: "capitalContribution", label: String.raw`(?:(?:landlord'?s?\s+)?capital\s+contribution|landlord'?s?\s+contribution)` },
  { key: "totalAreaSqft", label: String.raw`(?:(?:net\s+internal\s+|gross\s+internal\s+|floor\s+)?area|size|accommodation|nia|gia)` },
];
const TERM_LABELS: Array<{ key: HotsTermKey; re: RegExp; run: RegExp }> = TERM_LABEL_WORDS.map(t => ({
  key: t.key,
  re: new RegExp(`${LEAD}${t.label}${SEP}`, "i"),
  run: new RegExp(`${LEAD}${t.label} (.+)$`, "i"),
}));

/** A line that is a party's label, and what follows it. */
function partyLabel(line: string): { role: HotsPartyRole; value: string } | null {
  const m = LABEL_LINE.exec(line);
  if (m) { const role = hotsRole(m[1]); return role ? { role, value: m[2] || "" } : null; }
  const r = LABEL_RUN.exec(line);
  if (r && opensValue(r[2])) { const role = hotsRole(r[1]); return role ? { role, value: r[2] } : null; }
  return null;
}
/** A line that is a term's label, and what follows it. */
function termLabel(line: string, t: (typeof TERM_LABELS)[number]): string | null {
  const m = t.re.exec(line);
  if (m) return m[1] || "";
  const r = t.run.exec(line);
  return r && opensValue(r[1]) ? r[1] : null;
}

const NUMBERED = /^\s*\d+(?:\.\d+)*\.?\s+\S/;
const isLabel = (l: string) => !!partyLabel(l) || TERM_LABELS.some(t => termLabel(l, t) !== null);
// A wrapped line of the same entry: it opens with a bracket, a small letter or
// the words a company's description runs on with.
const continues = (l: string) => !!l && /^\s*(?:\(|[a-z]|(?:Company|Registered|Whose|Incorporated|Reg|Co)\b)/.test(l) && !NUMBERED.test(l) && !isLabel(l);

/** The value a label line carries: on its own line, or (a table) on the next lines. */
function valueAfter(lines: string[], i: number, own: string): string {
  if (oneLine(own).length >= 3) {
    const next = oneLine(lines[i + 1] || "");
    return oneLine(continues(next) ? `${own} ${next}` : own).slice(0, 400);
  }
  const next: string[] = [];
  for (let j = i + 1; j < lines.length && next.length < 3; j++) {
    const l = oneLine(lines[j]);
    if (!l) { if (next.length) break; continue; }
    if (NUMBERED.test(l) || isLabel(l)) break;
    next.push(l);
  }
  return oneLine(next.join(" ")).slice(0, 400);
}

/** What the rules read from the document's text. They never guess: a value they cannot place is left out. */
export function readHotsByRules(documentText: string, opts: HotsTextOptions = {}): Pick<HotsReading, "parties" | "terms"> {
  const text = String(documentText || "");
  const lines = text.split(/\r?\n/);
  const checkable = documentHasText(text, opts);
  const parties: HotsParty[] = [];
  const terms: HotsTerm[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const party = partyLabel(line);
    if (party) {
      const role = party.role;
      const value = valueAfter(lines, i, party.value);
      const name = nameFrom(value);
      if (role && name.length >= 2 && !NOT_A_PARTY.test(name) && !(role !== "guarantor" && parties.some(p => p.role === role))) {
        const numberMatch = NUMBER_PHRASE.exec(value);
        const number = numberMatch ? cleanCompanyNumber(numberMatch[1]) : null;
        // A clause that starts with the word ("Tenant fit out", "Landlord's works") is not the party.
        if (number || LEGAL_END.test(name) || (name.split(/\s+/).length <= 8 && !CLAUSE_WORDS.test(name))) {
          parties.push({ role, name, number, quote: value, checked: checkable });
          continue;
        }
      }
      // Not a party after all ("Tenant break …"): it may be a term's label.
    }
    for (const t of TERM_LABELS) {
      if (terms.some(x => x.key === t.key)) continue;
      const own = termLabel(line, t);
      if (own === null) continue;
      const value = valueAfter(lines, i, own);
      if (!value) continue;
      const def = hotsTermDef(t.key);
      let v: number | string | null = null;
      if (def.kind === "money") { const sums = moneyIn(value); v = sums.length ? sums[0] : null; }
      else if (def.kind === "years" || def.kind === "months") { const c = countsIn(value, def.kind); v = c.length ? c[0] : null; }
      // One area, or the total of several; never one floor of several.
      else if (def.kind === "sqft") { const a = areasIn(value); v = a.length === 1 ? a[0] : a.length > 1 && /\btotal\b/i.test(value) ? a[a.length - 1] : null; }
      else if (def.kind === "text") v = value.length >= 2 ? value.slice(0, 200) : null;
      if (v === null) continue;
      terms.push({ key: t.key, value: v, quote: value, checked: checkable });
      break;
    }
  }
  return { parties, terms };
}

// ── A note a person typed ───────────────────────────────────────────────────
// The transaction page's box takes a note as well as a document (Woody,
// 23 November 2026: "drop HOTS or type it out?"). A note is read by the rules
// New Deal's box uses for its parties ("Landlord is Brucecap Ltd", "letting
// ... to X") and by the letting note's shorthand for its terms ("300,000 pax",
// "10 yrs", "6 MRF"), then checked as a provider's answer is.

const NUMBER_IN_BRACKETS = /^\s*,?\s*\(\s*((?:SC|NI|OC|SO|NC|FC|LP|SL)\s?\d{6}|\d{7,8})\s*\)/i;

/** A company number written just after a name: "(Company No. 05211343)", "company number 5211343" or "(05211343)". */
export function numberAfterName(text: string, name: string): string | null {
  const s = String(text || "");
  const at = s.toLowerCase().indexOf(String(name || "").toLowerCase());
  if (!name || at < 0) return null;
  const after = s.slice(at + name.length, at + name.length + 80);
  const phrase = NUMBER_PHRASE.exec(after);
  if (phrase && phrase.index <= 30) return cleanCompanyNumber(phrase[1]);
  const bracket = NUMBER_IN_BRACKETS.exec(after);
  return bracket ? cleanCompanyNumber(bracket[1]) : null;
}

const NOTE_TERM_FIELDS: Array<[HotsTermKey, "rentPa" | "termYears" | "rentFreeMonths" | "breakOption" | "fittingOutContribution"]> = [
  ["rentPa", "rentPa"], ["leaseLength", "termYears"], ["rentFree", "rentFreeMonths"], ["breakOption", "breakOption"], ["capitalContribution", "fittingOutContribution"],
];

/** What the rules read from a typed note, in the shape of the provider's answer, for checkHotsAnswer. */
export function readHotsNoteRules(note: string, today: string): { parties: Array<{ role: string; name: string; company_number: string | null; quote: string }>; terms: Record<string, { value: unknown; quote: string }> } {
  const parties = readDealNoteRules(note).parties.map(p => ({ role: p.role, name: p.name, company_number: numberAfterName(note, p.name), quote: p.quote }));
  const terms: Record<string, { value: unknown; quote: string }> = {};
  try {
    const short = readShorthand(note, { kind: "offer", today });
    for (const [key, field] of NOTE_TERM_FIELDS) {
      const value = (short.fields as Record<string, unknown>)[field];
      const quote = (short.quotes as Record<string, string | undefined>)[field];
      if (value !== undefined && value !== null && value !== "" && quote) terms[key] = { value, quote };
    }
  } catch { /* a note the shorthand cannot read gives no terms */ }
  return { parties, terms };
}

/**
 * The provider's reading, with the rules filling what it left out: a party it
 * did not name, a party's number when the rules read the same name with one,
 * a term it did not give.
 */
export function mergeHotsReadings(ai: Pick<HotsReading, "parties" | "terms"> | null, rules: Pick<HotsReading, "parties" | "terms">): Pick<HotsReading, "parties" | "terms"> {
  if (!ai) return { parties: rules.parties, terms: rules.terms };
  const parties = ai.parties.map(p => {
    if (p.number) return p;
    const r = rules.parties.find(x => x.role === p.role && x.number && partyNameKey(x.name) === partyNameKey(p.name));
    return r ? { ...p, number: r.number, quote: r.quote } : p;
  });
  for (const r of rules.parties) {
    if (r.role === "guarantor" ? !parties.some(p => p.role === "guarantor" && partyNameKey(p.name) === partyNameKey(r.name)) : !parties.some(p => p.role === r.role)) parties.push(r);
  }
  const terms = [...ai.terms];
  for (const r of rules.terms) if (!terms.some(t => t.key === r.key)) terms.push(r);
  return { parties, terms };
}

// ── A term against the transaction ──────────────────────────────────────────

export type HotsTermState = "blank" | "same" | "differs";
/** Whether the transaction holds nothing, the same, or something else for a term. */
export function hotsTermState(kind: HotsTermKind, current: unknown, value: number | string): HotsTermState {
  if (current === null || current === undefined || current === "" || (typeof current === "number" && !Number.isFinite(current))) return "blank";
  if (kind === "text") return alnum(current) === alnum(value) ? "same" : "differs";
  if (kind === "date") return String(current).slice(0, 10) === String(value).slice(0, 10) ? "same" : "differs";
  const a = Number(current), b = Number(value);
  if (!Number.isFinite(a) || a === 0) return "blank";
  return same(a, b) ? "same" : "differs";
}

/** A term as the transaction's save takes it. */
export function hotsTermPatch(key: HotsTermKey, value: number | string): Record<string, number | string> {
  const def = hotsTermDef(key);
  if (def.kind === "text" || def.kind === "date") return { [key]: String(value) };
  return { [key]: Number(value) };
}

/** A term as words for the screen. */
export function hotsTermWords(kind: HotsTermKind, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  switch (kind) {
    case "money": return Number.isFinite(n) ? `£${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}` : String(value);
    case "years": return Number.isFinite(n) ? `${n} year${n === 1 ? "" : "s"}` : String(value);
    case "months": return Number.isFinite(n) ? `${n} month${n === 1 ? "" : "s"}` : String(value);
    case "sqft": return Number.isFinite(n) ? `${n.toLocaleString("en-GB")} sq ft` : String(value);
    case "date": {
      const d = new Date(String(value).slice(0, 10) + "T00:00:00Z");
      return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    }
    default: return String(value);
  }
}

// ── What the server sends back ─────────────────────────────────────────────

export interface HotsCompany { id: string; name: string; number: string | null }
export type HotsRegisterHit = DealNoteRegisterHit & { agrees: boolean };
export interface HotsOtherCompany { number: string; name: string; status: string | null }
export type HotsMatchState = "signs" | "filed" | "register" | "choose" | "not_found" | "no_company" | "no_party" | "guarantor";
export interface HotsPartyMatch {
  read: HotsParty;
  /** The transaction's party this is; null for a guarantor. */
  role: DealPartyRole | null;
  /** The transaction's party now, when it has one. */
  brand: { id: string; name: string } | null;
  /** The company that signs for that party now. */
  signing: HotsCompany | null;
  state: HotsMatchState;
  /** The company filed under the party that the heads of terms name. */
  filed: HotsCompany | null;
  /** Companies House: by the number the document gives, else by the exact name. agrees = its name is the one the document gives. */
  register: HotsRegisterHit[];
  registerNote: string | null;
  /** The number the document gives is this other company's at Companies House: never offered, the name is looked up instead. */
  numberIsAnother?: HotsOtherCompany | null;
  /** Found at Companies House by its name, not the number the document gives: offered, never set by itself (23 November 2026). */
  byName?: boolean;
  /** The CRM records of that name, when the transaction has no party there yet. */
  candidates: DealNoteCandidate[];
  /**
   * A guarantor (23 November 2026): the party it stands behind (the tenant, or a
   * sale's buyer) and that party's brand, and whether it is already the
   * transaction's guarantor. filed is then a company filed under that brand.
   */
  guarantees?: { role: "tenant" | "purchaser"; brand: { id: string; name: string } | null; set: boolean } | null;
}
export interface HotsTermView extends HotsTerm { label: string; kind: HotsTermKind; current: number | string | null; state: HotsTermState }
export interface HotsFiling { unitId: string; unitName: string; onFile: string | null }
/** POST /api/deals/:id/heads-of-terms/read (and …/match, without the reading). */
export interface HotsReadReply {
  fileName?: string | null;
  /** What was read: the heads of terms as a file, or a note typed in the box. */
  source?: "file" | "note";
  reading?: HotsReading;
  parties: HotsPartyMatch[];
  terms: HotsTermView[];
  contacts?: HotsContactView[];
  dealType: string | null;
  filing: HotsFiling | null;
}

// ── Solicitors and agents (Woody, 23 November 2026: "the HOTs upload / drop
// didnt pick up their solcitors or ours or their agent") ─────────────────────
// Heads of terms name each side's solicitors and agents, often in a contact
// sheet at the end ("Landlord Solicitors | GT - GreenbergTraurig | FAO:
// <partner> | T: ... | Email: ..."). They are not parties: the screen
// offers to put each on the transaction, and nothing is saved by a reading.

// A manager is the side's asset manager, property manager or managing agent: the
// people who look after the building for its owner and speak for it, never a
// letting agent (Woody, 23 November 2026: "it pulled out the Landlord contact and
// wanted to add it as joint agent but its the client contact because they are the
// asset managers for the building ... they are often the person to ask for docs").
export type HotsContactKind = "solicitor" | "agent" | "manager";
export type HotsContactSide = "landlord" | "tenant" | "vendor" | "purchaser";
export interface HotsContact {
  side: HotsContactSide;
  kind: HotsContactKind;
  /** A manager's role in the document's words: asset manager, property manager, managing agent. */
  role?: string | null;
  /** The firm as the document writes it. */
  firm: string;
  person: string | null;
  email: string | null;
  phone: string | null;
  quote: string;
  checked: boolean;
}

export const HOTS_CONTACT_SIDE_WORDS: Record<HotsContactSide, string> = { landlord: "Landlord", tenant: "Tenant", vendor: "Seller", purchaser: "Buyer" };
export const hotsContactLabel = (c: Pick<HotsContact, "side" | "kind"> & { role?: string | null }): string =>
  `${HOTS_CONTACT_SIDE_WORDS[c.side]}'s ${c.kind === "solicitor" ? "solicitors" : c.kind === "manager" ? c.role || "asset manager" : "agent"}`;

/**
 * A contact's firm is the party itself: the same name with the legal form left
 * out, or one name of two words or more held whole in the other ("Hondo
 * Enterprises" and "Hondo Enterprises Holdings Ltd"). One word alone is never
 * enough: Savills the agent is not Savills Investment Management the landlord.
 */
export function hotsFirmIsParty(firm: string, partyName: string): boolean {
  const words = (v: string) => {
    let s = squash(v).replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the\s+/, "");
    for (let i = 0; i < 2; i++) s = s.replace(/\s*\b(?:limited|ltd|public limited company|plc|llp|limited liability partnership|lp|llc|inc|incorporated|b ?v|n ?v|gmbh|s ?a|s ?a ?r ?l|sarl|ag)\s*$/, "").trim();
    return s ? s.split(" ") : [];
  };
  const a = words(firm), b = words(partyName);
  if (!a.length || !b.length) return false;
  if (a.join(" ") === b.join(" ")) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 2) return false;
  for (let i = 0; i + short.length <= long.length; i++) if (short.every((w, j) => long[i + j] === w)) return true;
  return false;
}

/** A manager's role in a few plain words, from the document's label or the reader's. */
export function hotsManagerRole(raw: unknown): string {
  const s = String(raw ?? "").toLowerCase();
  if (/managing\s*agent/.test(s)) return "managing agent";
  if (/property\s*manag/.test(s)) return "property manager";
  if (/estate\s*manag/.test(s)) return "estate manager";
  if (/fund\s*manag/.test(s)) return "fund manager";
  if (/investment\s*manag/.test(s)) return "investment manager";
  return "asset manager";
}

const CONTACT_SIDES: Record<string, HotsContactSide> = {
  landlord: "landlord", lessor: "landlord", tenant: "tenant", lessee: "tenant",
  vendor: "vendor", seller: "vendor", purchaser: "purchaser", buyer: "purchaser",
};
export const hotsContactSide = (raw: unknown): HotsContactSide | null => CONTACT_SIDES[String(raw ?? "").trim().toLowerCase()] || null;
export function hotsContactKind(raw: unknown): HotsContactKind | null {
  const s = String(raw ?? "").toLowerCase();
  // Before "agent": a managing agent is the owner's manager, not a letting agent.
  if (/asset\s*manag|property\s*manag|managing\s*agent|estate\s*manag|fund\s*manag|investment\s*manag|\bmanager\b/.test(s)) return "manager";
  if (/solicitor|lawyer|legal|law\s*firm|conveyanc/.test(s)) return "solicitor";
  if (/agent|surveyor/.test(s)) return "agent";
  return null;
}

/** BGP itself: Bruce Gillingham Pollard, or an address at its domain. */
export function isBgpContact(c: Pick<HotsContact, "firm" | "email">): boolean {
  return /\bbruce\s+gillingham\s+pollard\b|^\s*bgp\b/i.test(c.firm || "") || /@brucegillinghampollard\.com$/i.test(c.email || "");
}

/** Where the transaction keeps each side's agent (the firm and its person). */
export const HOTS_AGENT_FIELDS: Record<HotsContactSide, { firm: string; person: string }> = {
  landlord: { firm: "leasingAgentId", person: "leasingAgentContactId" },
  tenant: { firm: "acquisitionAgentId", person: "acquisitionAgentContactId" },
  vendor: { firm: "vendorAgentId", person: "vendorAgentContactId" },
  purchaser: { firm: "purchaserAgentId", person: "purchaserAgentContactId" },
};

const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;
const PHONE_LINE = /^(?:t|tel|telephone|m|mob|mobile|phone|dd|ddi|direct(?:\s+line)?)\s*[:.]?\s*(\+?[\d\s()-]{9,})$/i;
const digitsOf = (s: unknown): string => String(s ?? "").replace(/\D+/g, "");

/** The provider's contacts, kept only where the document's own words carry them. */
function checkHotsContacts(raw: unknown, text: string, checkable: boolean, dropped: HotsDrop[]): HotsContact[] {
  const out: HotsContact[] = [];
  const textKey = alnum(text);
  const textDigits = digitsOf(text);
  const lower = text.toLowerCase();
  for (const c of Array.isArray(raw) ? raw.slice(0, 12) : []) {
    const side = hotsContactSide(c?.side);
    const quote = oneLine(c?.quote).slice(0, 400);
    // An "agent" whose own words say asset manager or managing agent is the owner's manager.
    const kind = hotsContactKind(c?.kind) === "agent" && MANAGER_WORDS.test(quote) ? "manager" : hotsContactKind(c?.kind);
    const role = kind === "manager" ? hotsManagerRole(MANAGER_WORDS.test(quote) ? quote : c?.role || c?.kind) : null;
    const firm = oneLine(c?.firm).slice(0, 160);
    if (!side || !kind || firm.length < 2 || NOT_A_PARTY.test(firm)) continue;
    const what = hotsContactLabel({ side, kind, role });
    if (checkable && !quoteInDocument(quote, text)) { dropped.push({ what, value: firm, reason: "its words are not in the document" }); continue; }
    if (checkable && !textKey.includes(alnum(firm))) { dropped.push({ what, value: firm, reason: "the firm is not in the document" }); continue; }
    let person: string | null = oneLine(c?.person).slice(0, 120) || null;
    if (person && checkable && !textKey.includes(alnum(person))) person = null;
    let email: string | null = (EMAIL_RE.exec(String(c?.email ?? "")) || [])[0] || null;
    if (email && checkable && !lower.includes(email.toLowerCase())) email = null;
    let phone: string | null = oneLine(c?.phone).slice(0, 40) || null;
    if (phone && (digitsOf(phone).length < 9 || (checkable && !textDigits.includes(digitsOf(phone))))) phone = null;
    if (out.some(x => x.side === side && x.kind === kind)) continue;
    out.push({ side, kind, ...(role ? { role } : {}), firm, person, email, phone, quote, checked: checkable });
  }
  return out;
}

// The words that make a contact the owner's manager rather than a letting agent.
const MANAGER_WORDS = /asset\s+manag|property\s+manag|managing\s+agent|estate\s+manag/i;

// "Landlord Solicitors", "Landlord's Agent", "Tenant's Solicitors: ...", "12. Purchaser's solicitors".
// After the label: a separator and the firm, the firm itself (a PDF flattens a
// contact sheet's row onto one line), or nothing (the firm is on the next lines).
const CONTACT_LABEL = new RegExp(String.raw`^\s*(?:\d+(?:\.\d+)*\.?\s+)?(?:the\s+)?(landlord|lessor|tenant|lessee|vendor|seller|purchaser|buyer)(?:'s|s'|s)?\s+((?:letting\s+|leasing\s+|acquiring\s+|acquisition\s+|joint\s+|selling\s+|buying\s+)?(?:solicitors?|lawyers?|legal\s+advisers?|asset\s+managers?|asset\s+management|property\s+managers?|property\s+management|estate\s+managers?|estate\s+management|managing\s+agents?|investment\s+managers?|fund\s+managers?|agents?|surveyors?))\b\s*(?:([:\-–—|])\s*)?(.*)$`, "i");
const SIDE_HEADING = /^(?:the\s+)?(?:landlord|lessor|tenant|lessee|vendor|seller|purchaser|buyer|guarantor)s?\s*:?$/i;
// A line of a contact's own details (as opposed to the next clause's "Term: 10 years").
const CONTACT_FIELD = /^(?:fao|f\.a\.o\.?|for the attention of|attention|attn|contact|company|firm|organisation|organization|name|address|tel|telephone|t|m|mob|mobile|phone|dd|ddi|direct(?:\s+line)?|e-?mail(?:\s+address)?|dx|ref|reference)\s*[:.]/i;
const OTHER_LABEL = /^[A-Za-z][A-Za-z'’ ]{1,40}\s*:\s*\S/;
// Words of a heads of terms clause heading: "Rent Free" or "Service Charge" is never a person.
const HEADING_WORDS = /\b(?:rent|free|review|reviews|break|option|service|charge|term|use|user|class|lease|capital|contribution|deposit|guarantor|guarantee|insurance|repair|repairs|alienation|costs?|completion|exchange|conditions?|premises|property|demise|signage|rates|outgoings|vat|fit|works|planning|licence|access|schedule|timing|date|vacant|possession|subject|contract|landlord|tenant|vendor|purchaser|price|area|floor|unit|street|road|lane|square|house|centre|park)\b/i;
const looksLikePerson = (l: string): boolean =>
  /^[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,3}$/.test(l) && !LEGAL_END.test(l) && !HEADING_WORDS.test(l)
  && !/\b(?:llp|solicitors|law|legal|partners|limited|ltd|plc|agents?|property|properties|estates?|group|associates|company|surveyors)\b/i.test(l);
// A firm written on the label's own line with no separator: a few capitalised words, never a sentence.
const SMALL_WORDS = new Set(["and", "&", "of", "the", "de", "la", "le", "du", "von", "van", "-", "–", "+"]);
export function firmLike(raw: string): boolean {
  const s = oneLine(raw);
  if (!s || !/^[A-Z0-9]/.test(s)) return false;
  const words = s.split(" ");
  if (words.length > 8) return false;
  return words.every(w => SMALL_WORDS.has(w.toLowerCase()) || /^[A-Z0-9(\["'&]/.test(w));
}
const barePhone = (l: string): boolean => /^\+?[\d\s()-]{9,}$/.test(l) && digitsOf(l).length >= 9;
// The keyword in any case, the name capitalised.
const INLINE_FAO = /(?:\b[Ff]\.?[Aa]\.?[Oo]\b\.?|\b(?:[Ff]or the attention of|FOR THE ATTENTION OF|[Aa]ttention|ATTENTION|[Aa]ttn|ATTN|[Cc]ontact|CONTACT)\b)\s*[:.]?\s*([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,3})/;

/** One contact block's firm, person, email and phone. */
function contactFromBlock(block: string[]): { firm: string; person: string | null; email: string | null; phone: string | null } | null {
  let firm: string | null = null;
  let person: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  const plain: string[] = [];
  for (const raw of block) {
    const l = raw.replace(/^[-•*]\s*/, "").trim();
    if (!l) continue;
    const e = EMAIL_RE.exec(l);
    if (e) {
      email = email || e[0];
      if (/^(?:e-?mail(?:\s+address)?)\s*[:.]/i.test(l) || l === e[0]) continue;
    }
    const ph = PHONE_LINE.exec(l);
    if (ph) { phone = phone || oneLine(ph[1]); continue; }
    if (barePhone(l)) { phone = phone || l; continue; }
    const fao = /^(?:fao|f\.a\.o\.?|for the attention of|attention|attn|contact|name)\s*[:.]?\s*(.+)$/i.exec(l);
    if (fao) { person = person || oneLine(fao[1]); continue; }
    const co = /^(?:company|firm|organisation|organization)\s*[:.]\s*(.+)$/i.exec(l);
    if (co) { firm = firm || oneLine(co[1]); continue; }
    if (/^(?:address|tel|t|m|mobile|phone|e-?mail|dx|ref|reference)\s*[:.]/i.test(l)) continue;
    plain.push(l);
  }
  // With no "Company:" line the first plain line is the firm, and a name under it the person.
  for (const l of plain) {
    if (!firm) { firm = l; continue; }
    if (!person && looksLikePerson(l)) { person = l; continue; }
  }
  // "Shoosmiths LLP (FAO Jane Smith)": the person written beside the firm.
  if (!person) for (const l of block) { const f = INLINE_FAO.exec(l); if (f && !HEADING_WORDS.test(f[1])) { person = f[1]; break; } }
  if (!firm) return null;
  firm = oneLine(firm.split(/\s*[,(;]\s*/)[0]).replace(/[.:\s]+$/, "");
  if (firm.length < 2 || NOT_A_PARTY.test(firm) || EMAIL_RE.test(firm)) return null;
  return { firm: firm.slice(0, 160), person: person ? person.slice(0, 120) : null, email, phone };
}

/** What the rules read of each side's solicitors and agents: a label, then its lines up to the next label or clause. */
export function readHotsContactsByRules(documentText: string, opts: HotsTextOptions = {}): HotsContact[] {
  const text = String(documentText || "");
  const checkable = documentHasText(text, opts);
  const lines = text.split(/\r?\n/).map(l => oneLine(l.replace(/[‘’‛′]/g, "'")));
  const out: HotsContact[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = CONTACT_LABEL.exec(lines[i]);
    if (!m) continue;
    const side = hotsContactSide(m[1]);
    const kind = hotsContactKind(m[2]);
    const rest = oneLine(m[4]);
    // Words after the label with no separator are the firm only when they read as a firm name
    // ("Landlord Solicitors GT - GreenbergTraurig"), never a sentence ("the Landlord's solicitors will ...").
    if (!m[3] && rest && !firmLike(rest)) continue;
    if (!side || !kind || out.some(x => x.side === side && x.kind === kind)) continue;
    const block: string[] = rest ? [rest] : [];
    for (let j = i + 1; j < lines.length && block.length < 8; j++) {
      const l = lines[j];
      if (!l) continue;
      // The next label, a row's number, the next side's heading or the next clause ends the block
      // (a telephone number on a line of its own is the contact's).
      if (!barePhone(l) && (CONTACT_LABEL.test(l) || /^\d{1,3}\.?$/.test(l) || SIDE_HEADING.test(l) || NUMBERED.test(l))) break;
      if (OTHER_LABEL.test(l) && !CONTACT_FIELD.test(l)) break;
      block.push(l);
    }
    const c = contactFromBlock(block);
    if (!c) continue;
    out.push({ side, kind, ...(kind === "manager" ? { role: hotsManagerRole(m[2]) } : {}), ...c, quote: oneLine(block.join(" ")).slice(0, 400), checked: checkable });
  }
  return out;
}

/** The provider's contacts first, its blanks filled from the rules' reading of the same firm; the rules' others after. */
export function mergeHotsContacts(ai: HotsContact[] | null | undefined, rules: HotsContact[]): HotsContact[] {
  const out: HotsContact[] = [];
  for (const a of ai || []) {
    const r = rules.find(x => x.side === a.side && x.kind === a.kind);
    const same = r && (alnum(r.firm).includes(alnum(a.firm)) || alnum(a.firm).includes(alnum(r.firm)));
    out.push(same ? { ...a, role: a.role || r!.role, person: a.person || r!.person, email: a.email || r!.email, phone: a.phone || r!.phone } : a);
  }
  for (const r of rules) if (!out.some(x => x.side === r.side && x.kind === r.kind)) out.push(r);
  return out;
}

/** A contact read beside what the transaction holds for it (server/deal-hots.ts hotsContactViews). */
export interface HotsContactView {
  read: HotsContact;
  /** The side on this transaction (a sale's landlord is its seller). */
  side: HotsContactSide;
  /** Bruce Gillingham Pollard itself: nothing to set. */
  us: boolean;
  /** The side BGP acts for. */
  clientSide: boolean;
  /** What the transaction holds for it now: the agent firm, or our client's solicitors. */
  onDeal: string | null;
  /** Already that firm. */
  same: boolean;
  /** Solicitors: checked at the SRA on this transaction. */
  checked: boolean;
  /**
   * Speaks for the party: its asset manager, property manager or managing agent,
   * or someone at the party's own company. Offered as the person to ask for the
   * party's documents, never as an agent (23 November 2026).
   */
  forParty?: boolean;
  /** At the party's own company (its brand, or a company filed under it). */
  own?: boolean;
  /** Who the party's person to ask is now, by name. */
  asked?: string | null;
  /** That person is this contact already. */
  askIsThem?: boolean;
}

/** Contacts the screen sends back, kept only in the shape the reader makes. */
export function contactsFromBody(raw: unknown): HotsContact[] {
  const out: HotsContact[] = [];
  for (const c of Array.isArray(raw) ? raw.slice(0, 12) : []) {
    const side = hotsContactSide(c?.side);
    const kind = hotsContactKind(c?.kind);
    const firm = oneLine(c?.firm).slice(0, 160);
    if (!side || !kind || firm.length < 2 || out.some(x => x.side === side && x.kind === kind)) continue;
    const email = (EMAIL_RE.exec(String(c?.email ?? "")) || [])[0] || null;
    out.push({
      side, kind, ...(kind === "manager" ? { role: hotsManagerRole(c?.role || c?.kind) } : {}),
      firm, person: oneLine(c?.person).slice(0, 120) || null, email,
      phone: oneLine(c?.phone).slice(0, 40) || null, quote: oneLine(c?.quote).slice(0, 400), checked: !!c?.checked,
    });
  }
  return out;
}
