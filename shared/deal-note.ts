// The deal itself, read from the New Deal form's "Describe the deal" box
// (Woody, 20 November 2026, on a note that filled nothing but the terms:
// "Need to improve the autofill as doesn't search the adress? Also didn't
// pick up the tenant and couldn't add landlord or tenant once worked out they
// are not in the CRM?", "also didnt change the deal typ to new letting",
// "also didnt help with the billing entiryies either").
//
// The box's first reading is the letting note reader's, read as an offer: it
// knows rents and lease terms, never a property, a landlord, a tenant company
// or a kind of deal. This is the second reading, of those four things:
//
//   - the kind of deal (one of DEAL_NOTE_TYPES),
//   - the property's address or name, and a unit the note names,
//   - each party the note names (landlord, tenant, vendor, purchaser).
//
// Every value is the note's own words: a party's name and an address must be
// inside the words they were read from, and those words must be in the note.
// A kind of deal must be one of the list. What fails is left out with its
// reason. The server (server/deal-note-reader.ts) then looks each one up: the
// address among the CRM's properties, each party among the CRM's companies and
// the companies filed under them (crm_trading_entities, the billing entities),
// and at Companies House when the CRM holds no company for it. Nothing is
// saved by any of it: the form fills what is sure and lists the rest to pick
// or add, and the form's own Create is the only save. Pure, so it is tested
// without a database (server/deal-note.test.ts).
import { ADVISORY_UNIT_TYPES, LETTING_DEAL_TYPES, TENANT_REP_TYPES } from "./letting-rules";
import { agentFirmKey, agentFirmSearchWord } from "./pipnet-agents";

/** The kinds of deal a note can set: the deal form's own list for a deal with a property. */
export const DEAL_NOTE_TYPES: readonly string[] = [...LETTING_DEAL_TYPES, ...TENANT_REP_TYPES, ...ADVISORY_UNIT_TYPES, "Purchase", "Sale"];

export const DEAL_NOTE_ROLES = ["landlord", "tenant", "vendor", "purchaser"] as const;
export type DealNoteRole = (typeof DEAL_NOTE_ROLES)[number];
export const DEAL_NOTE_ROLE_WORDS: Record<DealNoteRole, string> = { landlord: "Landlord", tenant: "Tenant", vendor: "Vendor", purchaser: "Purchaser" };
/** The company type a party added from the note is made with: the deal form's own (makeCompanyCreator). */
export const DEAL_NOTE_ROLE_TYPES: Record<DealNoteRole, string> = { landlord: "Landlord", tenant: "Tenant", vendor: "Vendor", purchaser: "Purchaser" };

export interface DealNoteValue { value: string; quote: string }
export interface DealNoteProposal {
  dealType: DealNoteValue | null;
  address: DealNoteValue | null;
  unit: DealNoteValue | null;
  parties: Array<{ role: DealNoteRole; name: string; quote: string }>;
}
export interface DealNoteDrop { what: string; value: string; reason: string }

/** A CRM company a party's name is, with the company filed under it that the name is (its billing entity), when there is one. */
export interface DealNoteCandidate {
  companyId: string; companyName: string; companyType: string | null;
  entityId: string | null; entityName: string | null; entityNumber: string | null;
}
/** A company at Companies House of the party's name. */
export interface DealNoteRegisterHit { number: string; name: string; status: string | null; address: string | null }
export interface DealNoteParty {
  role: DealNoteRole;
  name: string;
  quote: string;
  candidates: DealNoteCandidate[];
  register: DealNoteRegisterHit[];
  /** Why Companies House was not read, or what went wrong; null when it was read or was not needed. */
  registerNote: string | null;
}
export interface DealNotePlaceHit { id: string; name: string; address: string | null }
export interface DealNotePlace {
  text: string;
  quote: string;
  unit: DealNoteValue | null;
  properties: DealNotePlaceHit[];
  /** True when nothing matched every word and these are a looser match (never filled by themselves). */
  approximate: boolean;
}
/** What the server sends back as `deal` beside the offer reading. */
export interface DealNoteRead {
  dealType: DealNoteValue | null;
  place: DealNotePlace | null;
  parties: DealNoteParty[];
  usedAi: boolean;
  dropped: DealNoteDrop[];
}

// ── The note's own words ────────────────────────────────────────────────────

const squash = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();
const lower = (s: unknown): string => squash(s).toLowerCase();

/** The words are in the note (case and spacing aside). */
export function inNote(note: string, quote: string): boolean {
  const q = lower(quote);
  return q.length > 0 && lower(note).includes(q);
}

/** The value is inside the words it was read from (case and spacing aside). */
export function inQuote(value: string, quote: string): boolean {
  const v = lower(value);
  return v.length > 0 && lower(quote).includes(v);
}

const canonicalType = (value: unknown): string | null => {
  const v = lower(value);
  return DEAL_NOTE_TYPES.find(t => t.toLowerCase() === v) || null;
};

// A word that names a role, not a party: "Landlord is the landlord" fills nothing.
const NOT_A_NAME = new Set(["landlord", "tenant", "vendor", "purchaser", "buyer", "seller", "client", "the client", "the landlord", "the tenant",
  "tbc", "tba", "unknown", "n/a", "na", "none", "same", "us", "them"]);

/** A party's name as the note gives it, or null when it is no name at all. */
export function cleanPartyName(raw: unknown): string | null {
  const name = squash(raw).replace(/^[\s,;:.'"“”‘’-]+|[\s,;:'"“”‘’-]+$/g, "").replace(/\.$/, "");
  if (name.length < 2 || name.length > 120) return null;
  if (!/[a-z0-9]/i.test(name)) return null;
  if (NOT_A_NAME.has(name.toLowerCase())) return null;
  return name;
}

/**
 * The checks every value a reader proposes must pass before anything looks it
 * up. The provider's answer and the rules' both go through it.
 */
export function checkDealNoteAnswer(note: string, raw: unknown): { proposal: DealNoteProposal; dropped: DealNoteDrop[] } {
  const r: Record<string, any> = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
  const dropped: DealNoteDrop[] = [];
  const proposal: DealNoteProposal = { dealType: null, address: null, unit: null, parties: [] };
  const read = (key: string, what: string, max: number): DealNoteValue | null => {
    const item = r[key];
    if (!item || typeof item !== "object") return null;
    const value = squash(item.value), quote = squash(item.quote);
    if (!value) return null;
    if (!inNote(note, quote)) { dropped.push({ what, value, reason: "the words it came from are not in the note" }); return null; }
    if (!inQuote(value, quote)) { dropped.push({ what, value, reason: "it is not in the words it came from" }); return null; }
    if (value.length > max) { dropped.push({ what, value, reason: "too long to be one" }); return null; }
    return { value, quote };
  };

  const type = r.deal_type;
  if (type && typeof type === "object" && squash(type.value)) {
    const value = canonicalType(type.value), quote = squash(type.quote);
    if (!value) dropped.push({ what: "Deal type", value: squash(type.value), reason: "not one of the deal form's types" });
    else if (!inNote(note, quote)) dropped.push({ what: "Deal type", value, reason: "the words it came from are not in the note" });
    else proposal.dealType = { value, quote };
  }
  proposal.address = read("address", "Address", 160);
  proposal.unit = read("unit", "Unit", 60);

  for (const role of DEAL_NOTE_ROLES) {
    const got = read(role, DEAL_NOTE_ROLE_WORDS[role], 120);
    if (!got) continue;
    const name = cleanPartyName(got.value);
    if (!name) { dropped.push({ what: DEAL_NOTE_ROLE_WORDS[role], value: got.value, reason: "not a name" }); continue; }
    // The address is never a party.
    if (proposal.address && lower(proposal.address.value) === lower(name)) {
      dropped.push({ what: DEAL_NOTE_ROLE_WORDS[role], value: name, reason: "it is the address" });
      continue;
    }
    proposal.parties.push({ role, name, quote: got.quote });
  }
  // One name in two roles is a misreading of one of them: neither is used.
  for (const party of [...proposal.parties]) {
    const key = agentFirmKey(party.name);
    const twins = proposal.parties.filter(p => agentFirmKey(p.name) === key);
    if (twins.length > 1) {
      proposal.parties = proposal.parties.filter(p => agentFirmKey(p.name) !== key);
      for (const t of twins) dropped.push({ what: DEAL_NOTE_ROLE_WORDS[t.role], value: t.name, reason: `it was read as more than one party (${twins.map(x => DEAL_NOTE_ROLE_WORDS[x.role].toLowerCase()).join(" and ")})` });
    }
  }
  return { proposal, dropped };
}

// ── The rules, when there is no provider ────────────────────────────────────

// One kind of deal per pattern; a note matching two kinds sets none.
const TYPE_RULES: Array<[RegExp, string]> = [
  [/\bsub[- ]?let(?:ting)?\b/i, "Sub-Letting"],
  [/\btemp(?:orary)?\s+(?:lease|letting)\b/i, "Temp Lease"],
  [/\blicen[cs]e\s+(?:to\s+occupy|agreement)\b/i, "Licence"],
  [/\blease\s+disposal\b|\bassignment\s+of\s+(?:the\s+)?lease\b/i, "Lease Disposal"],
  [/\blease\s+acquisition\b|\bacquiring\s+(?:a\s+|the\s+)?(?:unit|shop|space|lease)\b/i, "Lease Acquisition"],
  [/\brent\s+review\b/i, "Rent Review"],
  [/\blease\s+renewal\b/i, "Lease Renewal"],
  [/\bre-?gear\b/i, "Regear"],
  // "lettering on 55 Wells Street" is "letting" autocorrected (Woody's note, 20 November 2026).
  [/\b(?:new\s+)?letting\b|\blet\s+to\b|\blettering\s+(?:of|on|at)\b/i, "New Letting"],
];

/** The kind of deal the note's own words say, by the rules alone: one kind, or none. */
export function dealTypeFromWords(note: string): DealNoteValue | null {
  const hits: DealNoteValue[] = [];
  for (const [re, value] of TYPE_RULES) {
    const m = re.exec(note);
    if (!m) continue;
    // "Sub-letting" is not also a new letting.
    if (value === "New Letting" && hits.some(h => h.value === "Sub-Letting" || h.value === "Temp Lease")) continue;
    if (!hits.some(h => h.value === value)) hits.push({ value, quote: m[0] });
  }
  return hits.length === 1 ? hits[0] : null;
}

const LEGAL_END = /^(.*?\b(?:ltd|limited|plc|llp|lp|llc|inc)\b\.?)/i;
// A name runs to the first word that starts the terms.
const NAME_STOP = /\s+(?:rent|term|lease|for|on|at|with|break|premium|fee|deposit|sq\s?ft|sqft|psf|pax|p\.?a\.?|from|who|which|and\s+(?:the\s+)?(?:landlord|tenant|vendor|purchaser))\b|\s*£|\s+\d/i;

function trimName(raw: string): string | null {
  let name = squash(raw);
  const legal = LEGAL_END.exec(name);
  if (legal) name = legal[1];
  else {
    const stop = NAME_STOP.exec(name);
    if (stop) name = name.slice(0, stop.index);
  }
  return cleanPartyName(name);
}

const PARTY_RULES: Array<[DealNoteRole, RegExp]> = [
  ["landlord", /\b(?:landlord|LL)\s*(?:is|:|-|=|will\s+be)\s*([^.;\n]+)/i],
  ["tenant", /\b(?:tenant|TT)\s*(?:is|:|-|=|will\s+be)\s*([^.;\n]+)/i],
  ["vendor", /\b(?:vendor|seller)\s*(?:is|:|-|=)\s*([^.;\n]+)/i],
  ["purchaser", /\b(?:purchaser|buyer)\s*(?:is|:|-|=)\s*([^.;\n]+)/i],
  // "letting of 55 Wells Street to X": the space is let to the tenant.
  ["tenant", /\blet(?:ting|tering)?\b[^.;\n]*?\bto\s+([^.;\n]+)/i],
  ["purchaser", /\b(?:sale|selling|sold)\b[^.;\n]*?\bto\s+([^.;\n]+)/i],
  ["vendor", /\b(?:purchase|buying|bought)\b[^.;\n]*?\bfrom\s+([^.;\n]+)/i],
];

const STREET_WORDS = "street|st|road|rd|avenue|ave|lane|ln|place|pl|square|sq|row|way|court|ct|gardens|gdns|terrace|tce|crescent|cres|hill|walk|parade|mews|yard|close|drive|dr|grove|park|green|gate|circus|broadway|market|wharf|quay|embankment|passage";
const ADDRESS_RULE = new RegExp(`\\b\\d+[a-z]?(?:\\s*[-–]\\s*\\d+[a-z]?)?\\s+(?:[a-z'’.]+\\s+){0,4}?(?:${STREET_WORDS})\\b(?:,?\\s+london\\b)?`, "i");
const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
const UNIT_RULE = /\b(?:unit|shop|suite)\s+[a-z]?\d+[a-z]?\b|\b(?:ground|first|second|third|lower\s+ground|upper\s+ground|basement)\s+floor\b/i;

/** What the rules alone read: for a note when there is no provider, or the provider is not used. */
export function readDealNoteRules(note: string): DealNoteProposal {
  const raw: Record<string, DealNoteValue> = {};
  const type = dealTypeFromWords(note);
  if (type) raw.deal_type = type;
  const address = ADDRESS_RULE.exec(note) || POSTCODE.exec(note);
  if (address) raw.address = { value: squash(address[0]), quote: squash(address[0]) };
  const unit = UNIT_RULE.exec(note);
  if (unit) raw.unit = { value: squash(unit[0]), quote: squash(unit[0]) };
  for (const [role, re] of PARTY_RULES) {
    if (raw[role]) continue;
    const m = re.exec(note);
    if (!m) continue;
    const name = trimName(m[1]);
    if (!name) continue;
    // The words quoted run from the cue to the end of the name, not to the end of the sentence.
    const lead = m[0].slice(0, m[0].length - m[1].length);
    const at = m[1].toLowerCase().indexOf(name.toLowerCase());
    raw[role] = { value: name, quote: squash(at >= 0 ? lead + m[1].slice(0, at + name.length) : m[0]) };
  }
  return checkDealNoteAnswer(note, raw).proposal;
}

// ── Looking an address up ───────────────────────────────────────────────────

const SUFFIX_GROUPS: string[][] = [
  ["street", "st"], ["road", "rd"], ["avenue", "ave"], ["lane", "ln"], ["place", "pl"], ["square", "sq"], ["court", "ct"],
  ["gardens", "gdns"], ["terrace", "tce"], ["crescent", "cres"], ["drive", "dr"],
];
const SUFFIXES = new Set(STREET_WORDS.split("|"));
const FILLER = new Set(["the", "of", "and", "at", "on", "in", "uk"]);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The word patterns an address is looked up by (Postgres regular
 * expressions, each a whole word: "55" never matches "155"), and its postcode.
 * The town after a street ("London") is left out: an address held without it
 * still matches. "Street" also finds "St".
 */
export function addressSearch(address: string): { patterns: string[]; loose: string[]; postcode: string | null } {
  const pc = POSTCODE.exec(address)?.[0]?.replace(/\s+/g, "").toUpperCase() || null;
  const words = lower(address.replace(POSTCODE, " ")).replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  const suffixAt = words.findIndex(w => SUFFIXES.has(w));
  const kept = (suffixAt >= 0 ? words.slice(0, suffixAt + 1) : words).filter(w => !FILLER.has(w));
  const pattern = (w: string) => {
    const group = SUFFIX_GROUPS.find(g => g.includes(w));
    if (group) return `\\m(${group.join("|")})\\M`;
    const range = /^(\d+[a-z]?)-\d+[a-z]?$/.exec(w);
    return `\\m${escapeRegex(range ? range[1] : w)}\\M`;
  };
  const patterns = kept.map(pattern);
  // Looser: without the house number, for a building held by its street name.
  const loose = kept.filter(w => !/^\d/.test(w)).map(pattern);
  return { patterns, loose: loose.length && loose.length < patterns.length ? loose : [], postcode: pc };
}

// ── Looking a party up ──────────────────────────────────────────────────────

/** The key two names are the same company by: "Brucecap Ltd" is "brucecap", "BRUCE GILLINGHAM POLLARD LIMITED" is "Bruce Gillingham Pollard Ltd". */
export const partyNameKey = (name: string | null | undefined): string => agentFirmKey(name);
/** The one word a database search narrows the candidates by. */
export const partySearchWord = (name: string | null | undefined): string | null => agentFirmSearchWord(name);
/** The name ends in a legal form, so it names a registered company rather than a brand. */
export const namesALegalCompany = (name: string): boolean => /\b(?:ltd|limited|plc|llp|lp|llc|inc)\.?\s*$/i.test(squash(name));

/**
 * The CRM's candidates for one party: each matching company once, with the
 * company filed under it that the name is, when one is. A company filed under
 * a brand that is not itself a match brings its brand along.
 */
export function partyCandidates(
  name: string,
  companies: ReadonlyArray<{ id: string; name: string; company_type?: string | null }>,
  entities: ReadonlyArray<{ id: string; name: string; companies_house_number?: string | null; brand_id: string; brand_name: string; brand_type?: string | null }>,
): DealNoteCandidate[] {
  const key = partyNameKey(name);
  if (!key) return [];
  const out: DealNoteCandidate[] = [];
  for (const c of companies) {
    if (partyNameKey(c.name) !== key || out.some(o => o.companyId === String(c.id))) continue;
    out.push({ companyId: String(c.id), companyName: c.name, companyType: c.company_type ?? null, entityId: null, entityName: null, entityNumber: null });
  }
  for (const e of entities) {
    if (partyNameKey(e.name) !== key) continue;
    const brand = out.find(o => o.companyId === String(e.brand_id));
    if (brand) {
      // Two companies of the name under one brand: the brand stays, the company is for the person to pick.
      if (brand.entityId && brand.entityId !== String(e.id)) { brand.entityId = null; brand.entityName = null; brand.entityNumber = null; continue; }
      if (!brand.entityId) Object.assign(brand, { entityId: String(e.id), entityName: e.name, entityNumber: e.companies_house_number || null });
      continue;
    }
    out.push({ companyId: String(e.brand_id), companyName: e.brand_name, companyType: e.brand_type ?? null,
      entityId: String(e.id), entityName: e.name, entityNumber: e.companies_house_number || null });
  }
  return out;
}

/** Companies House results that are the party's name and are not closed, best first. */
export function registerHits(name: string, items: ReadonlyArray<{ company_number?: string; title?: string; company_status?: string | null; address_snippet?: string | null }>): DealNoteRegisterHit[] {
  const key = partyNameKey(name);
  if (!key) return [];
  const closed = new Set(["dissolved", "converted-closed", "removed", "closed", "liquidation"]);
  return items
    .filter(i => i && i.company_number && i.title && partyNameKey(i.title) === key && !closed.has(String(i.company_status || "").toLowerCase()))
    .slice(0, 3)
    .map(i => ({ number: String(i.company_number), name: String(i.title), status: i.company_status ?? null, address: i.address_snippet ?? null }));
}

// ── The first reading, tidied for the deal form ─────────────────────────────

const PARTY_FIELDS = ["brandName", "brandId", "moreBrands", "agentName", "agentCompanyName", "agentCompanyId", "contactName"] as const;

/**
 * The offer reading, with what the deal reading answers better taken out: a
 * brand or agent that is one of the parties, a "brand" that is the address,
 * and "not a brand on this unit" (a new deal has no unit). Anything the note
 * names beyond the parties (another agent, a contact) stays. Changes the
 * reading in place.
 */
export function tidyOfferReadingForDeal(reading: { fields: Record<string, any>; quotes?: Record<string, any>; unsure?: Array<{ field: string; value: unknown; quote?: string | null }>; dropped?: Array<{ field: string; reason?: string }>; unplaced?: string[] }, deal: DealNoteRead): void {
  const keys = new Set(deal.parties.map(p => partyNameKey(p.name)).filter(Boolean));
  const placeText = deal.place ? lower(deal.place.text) : "";
  const isParty = (v: unknown) => { const k = partyNameKey(typeof v === "string" ? v : ""); return !!k && keys.has(k); };
  const aboutPlace = (v: unknown) => !!placeText && typeof v === "string" && (lower(v).includes(placeText) || placeText.includes(lower(v)));
  const brandTaken = deal.parties.length > 0;
  const fields = reading.fields || {};
  for (const f of PARTY_FIELDS) {
    const v = fields[f];
    if (v === undefined) continue;
    const isBrand = f === "brandName" || f === "brandId" || f === "moreBrands";
    if ((isBrand && brandTaken) || isParty(v) || aboutPlace(v)) {
      delete fields[f];
      if (reading.quotes) delete reading.quotes[f];
    }
  }
  reading.unsure = (reading.unsure || []).filter(u => !((PARTY_FIELDS as readonly string[]).includes(u.field)
    && ((brandTaken && (u.field === "brandName" || u.field === "moreBrands")) || isParty(u.value) || aboutPlace(u.value))));
  reading.dropped = (reading.dropped || []).filter(d => d.field !== "brandName" && d.field !== "moreBrands");
  const named = deal.parties.map(p => lower(p.name));
  reading.unplaced = (reading.unplaced || []).filter(u => !named.some(n => lower(u).includes(n)) && !(placeText && lower(u).includes(placeText)));
}

/** An address as one line, from the property's stored address (an object or a string) and postcode. */
export function placeAddressText(address: unknown, postcode?: string | null): string {
  let a: any = address;
  if (typeof a === "string") { try { a = JSON.parse(a); } catch { return a; } }
  if (!a || typeof a !== "object") return postcode || "";
  // A part already inside an earlier one ("London", the postcode in a formatted address) is not said twice.
  const bare = (s: string) => s.toLowerCase().replace(/[\s,]+/g, "");
  const out: string[] = [];
  for (const part of [a.formatted || a.street || a.line1, a.city, a.postcode || postcode].filter(Boolean).map(String)) {
    if (!out.some(o => bare(o).includes(bare(part)))) out.push(part);
  }
  return out.join(", ");
}

/**
 * Two readings of one note made one: the provider's values stand, and the
 * rules fill only what it left out (a kind of deal, an address, a unit, or a
 * party whose name the provider did not give any role). One name in two
 * roles is then dropped, as in a single reading.
 */
export function mergeDealProposals(note: string, ai: DealNoteProposal, rules: DealNoteProposal): { proposal: DealNoteProposal; dropped: DealNoteDrop[] } {
  const keys = new Set(ai.parties.map(p => partyNameKey(p.name)));
  const roles = new Set(ai.parties.map(p => p.role));
  const raw: Record<string, DealNoteValue> = {};
  const put = (key: string, v: DealNoteValue | null) => { if (v) raw[key] = v; };
  put("deal_type", ai.dealType || rules.dealType);
  put("address", ai.address || rules.address);
  put("unit", ai.unit || rules.unit);
  for (const p of ai.parties) raw[p.role] = { value: p.name, quote: p.quote };
  for (const p of rules.parties) if (!roles.has(p.role) && !keys.has(partyNameKey(p.name))) raw[p.role] = { value: p.name, quote: p.quote };
  return checkDealNoteAnswer(note, raw);
}