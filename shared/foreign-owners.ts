// Companies owned from abroad: tracing the chain past Companies House (Woody,
// 21 November 2026). Asked how KYC4U do it, the LEGO pack showed four steps:
// Creditsafe's group structure for the UK company, the parent's own register
// page printed by hand, the family foundation's register page, and the owner
// verified from public sources. "let's make sure all of that is built".
//
// The free route the app takes, in this file's rules (pure, no I/O):
// - the parent note in the UK company's own accounts (Companies Act 2006
//   s.409 and the accounts regulations: the ultimate parent, the parents of
//   the largest and smallest groups that consolidate it, and the ultimate
//   controlling party), read from the accounts' text by rules, or from the
//   pages of a scanned filing by the reader with the words it read;
// - GLEIF, the free worldwide register of legal entity identifiers (LEIs),
//   which records each entity's direct and ultimate accounting parent, or
//   why there is none (owned by individuals, not consolidated, not public);
// - the client's own structure chart, compared with what the app found.
//
// None of it decides anything: what it finds is shown with its source, and
// the people at the top are added by a person, who then verifies them.

import { nameTokens, ownerRegister, personNamesMatch, sameToken } from "./kyc-prechecks";
import { PARENT_ROLE_WORDS, gleifTraceWords, parentLineWords, parentRolesWords } from "./foreign-owner-words";

export { PARENT_ROLE_WORDS, gleifTraceWords, parentLineWords, parentRolesWords };

// ── The parent note in the accounts ─────────────────────────────────────────

export type ParentRole = "immediate" | "ultimate" | "parent" | "largest_group" | "smallest_group" | "controlling_party";

// Most significant first: a name the note gives in several roles is shown by the first.
const ROLE_ORDER: ParentRole[] = ["ultimate", "controlling_party", "immediate", "parent", "largest_group", "smallest_group"];

export type ParentKind = "company" | "person" | "people";

export interface ParentNoteLine {
  roles: ParentRole[];
  // Empty for "there is no ultimate controlling party".
  name: string;
  kind: ParentKind;
  country: string | null;
  // The note's own words.
  words: string;
  // The page it was read from (a scanned filing), when known.
  page: number | null;
  // The note says there is no such party.
  none?: boolean;
}

export interface AccountsParentNote {
  // The accounts on the party's KYC record, and Companies House's id for the
  // filing (a later run reuses the reading of the same filing).
  documentId: string | null;
  chDocumentId: string | null;
  madeUpTo: string | null;
  // text: the filing's own text, read by rules; scan: its pages, read by the reader.
  via: "text" | "scan" | null;
  lines: ParentNoteLine[];
  // found, none (read: no parent note), unread (with why).
  status: "found" | "none" | "unread";
  unread: string | null;
  readAt: string;
}

const COMPANY_WORD = /\b(limited|ltd|plc|llp|lp|llc|inc|incorporated|corp|corporation|company|co|holdings?|group|gmbh|ag|se|sa|s\.a|sas|sarl|s\.?a\.?r\.?l|s\.?à\.?\s?r\.?l|bv|b\.v|nv|n\.v|a\/s|aps|ab|asa|oy|oyj|spa|s\.p\.a|srl|s\.r\.l|kg|kgaa|pte|pty|sl|s\.l|scp|sci|sc|fund|trust|foundation|fonden|stiftung|partnership|partners|investments?|capital|ventures|bank|associates)\b\.?/i;
const TITLE = /^(mr|mrs|ms|miss|mx|dr|sir|dame|lord|lady|prof|professor|hrh|sheikh|sheikha)\.?\s+/i;
const PEOPLE = /\b(family|families|trustees|shareholders|directors|members|partners|individuals)\b/i;

/** "A company", "a person" or "people" (a family, the trustees): what a named party is. */
export function parentKind(name: string, role: ParentRole): ParentKind {
  const n = String(name || "").trim();
  if (TITLE.test(n)) return "person";
  if (PEOPLE.test(n) && !COMPANY_WORD.test(n.replace(PEOPLE, " "))) return "people";
  if (COMPANY_WORD.test(n)) return "company";
  // A controlling party with no company word, two to four capitalised words: a person.
  const words = n.split(/\s+/).filter(Boolean);
  if (role === "controlling_party" && words.length >= 2 && words.length <= 4 && words.every(w => /^[A-Z][a-zA-Z'’.-]*$/.test(w))) return "person";
  return "company";
}

// Places a note names after "incorporated in", longest first so "England and
// Wales" wins over "England". The value is the ISO 3166 code GLEIF files an
// entity's country under ("GB" for the UK).
const PLACES: Array<[string, string]> = [
  ["england and wales", "GB"], ["united kingdom", "GB"], ["great britain", "GB"], ["northern ireland", "GB"], ["england", "GB"], ["scotland", "GB"], ["wales", "GB"], ["uk", "GB"],
  ["isle of man", "IM"], ["jersey", "JE"], ["guernsey", "GG"], ["gibraltar", "GI"],
  ["republic of ireland", "IE"], ["ireland", "IE"],
  ["united states of america", "US"], ["united states", "US"], ["usa", "US"], ["u.s.a", "US"], ["state of delaware", "US"], ["delaware", "US"], ["new york", "US"], ["california", "US"], ["nevada", "US"], ["texas", "US"], ["florida", "US"], ["illinois", "US"], ["massachusetts", "US"], ["washington", "US"],
  ["canada", "CA"], ["mexico", "MX"], ["brazil", "BR"], ["argentina", "AR"], ["chile", "CL"], ["colombia", "CO"], ["peru", "PE"],
  ["denmark", "DK"], ["kingdom of denmark", "DK"], ["sweden", "SE"], ["norway", "NO"], ["finland", "FI"], ["iceland", "IS"],
  ["germany", "DE"], ["federal republic of germany", "DE"], ["austria", "AT"], ["switzerland", "CH"], ["liechtenstein", "LI"],
  ["the netherlands", "NL"], ["netherlands", "NL"], ["holland", "NL"], ["belgium", "BE"], ["grand duchy of luxembourg", "LU"], ["luxembourg", "LU"],
  ["france", "FR"], ["monaco", "MC"], ["spain", "ES"], ["portugal", "PT"], ["andorra", "AD"], ["italy", "IT"], ["san marino", "SM"], ["malta", "MT"], ["greece", "GR"], ["cyprus", "CY"],
  ["poland", "PL"], ["czech republic", "CZ"], ["czechia", "CZ"], ["slovakia", "SK"], ["hungary", "HU"], ["romania", "RO"], ["bulgaria", "BG"], ["croatia", "HR"], ["slovenia", "SI"], ["serbia", "RS"],
  ["estonia", "EE"], ["latvia", "LV"], ["lithuania", "LT"], ["ukraine", "UA"], ["russia", "RU"], ["russian federation", "RU"], ["turkey", "TR"], ["türkiye", "TR"], ["turkiye", "TR"],
  ["israel", "IL"], ["united arab emirates", "AE"], ["uae", "AE"], ["dubai", "AE"], ["abu dhabi", "AE"], ["saudi arabia", "SA"], ["qatar", "QA"], ["kuwait", "KW"], ["bahrain", "BH"], ["oman", "OM"], ["egypt", "EG"],
  ["south africa", "ZA"], ["nigeria", "NG"], ["kenya", "KE"], ["mauritius", "MU"], ["morocco", "MA"],
  ["india", "IN"], ["pakistan", "PK"], ["china", "CN"], ["people's republic of china", "CN"], ["hong kong", "HK"], ["macau", "MO"], ["taiwan", "TW"], ["japan", "JP"], ["south korea", "KR"], ["republic of korea", "KR"], ["singapore", "SG"], ["malaysia", "MY"], ["thailand", "TH"], ["indonesia", "ID"], ["philippines", "PH"], ["vietnam", "VN"],
  ["australia", "AU"], ["new zealand", "NZ"],
  ["british virgin islands", "VG"], ["bvi", "VG"], ["cayman islands", "KY"], ["bermuda", "BM"], ["bahamas", "BS"], ["the bahamas", "BS"], ["panama", "PA"], ["seychelles", "SC"], ["belize", "BZ"], ["marshall islands", "MH"], ["anguilla", "AI"], ["turks and caicos islands", "TC"], ["curacao", "CW"], ["curaçao", "CW"], ["barbados", "BB"],
].sort((a, b) => b[0].length - a[0].length) as Array<[string, string]>;

const placeKey = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^the\s+/, "").replace(/[^a-z0-9.' ]+/g, " ").replace(/\s+/g, " ").trim();

/** The ISO country code GLEIF uses for a place a register or a note gives, or null. */
export function countryCode(place: string | null | undefined): string | null {
  const key = placeKey(String(place || ""));
  if (!key) return null;
  for (const [name, code] of PLACES) {
    const n = placeKey(name);
    if (key === n || key.startsWith(`${n} `) || key.endsWith(` ${n}`) || key.includes(` ${n} `)) return code;
  }
  return null;
}

const titleCase = (s: string) => s.length <= 3 || /\./.test(s) ? s.toUpperCase()
  : s.replace(/\b([a-z])/g, (_m, c: string) => c.toUpperCase()).replace(/\b(And|Of|The)\b/g, w => w.toLowerCase());

/** The place a note's words give after "incorporated in" (or in brackets), as it names it. */
function placeAfter(tail: string): string | null {
  const m = /^\s*(?:,\s*)?(?:\(?\s*(?:a|an)\s+(?:company|private\s+company|public\s+company|limited\s+company|entity|partnership|undertaking)\s+)?(?:which\s+is\s+)?\(?\s*(?:incorporated|registered|domiciled|established|organi[sz]ed|formed)(?:\s+and\s+(?:domiciled|registered|incorporated))?\s+(?:in|under\s+the\s+laws\s+of)\s+(?:the\s+)?([A-Za-zÀ-ÿ.' -]{2,60})/i.exec(tail)
    || /^\s*\(\s*([A-Za-zÀ-ÿ.' -]{3,40})\s*\)/.exec(tail);
  if (!m) return null;
  const raw = m[1].replace(/\s+/g, " ").trim();
  const key = placeKey(raw);
  for (const [name] of PLACES) {
    const n = placeKey(name);
    if (key === n || key.startsWith(`${n} `) || key.startsWith(`${n}.`)) return titleCase(name.replace(/^the /, ""));
  }
  // Not a place the list knows: up to the first stop, at most four words.
  const short = raw.split(/[.,;()]/)[0].trim().split(/\s+/).slice(0, 4).join(" ");
  return /^[A-Z]/.test(short) && short.length >= 3 ? short : null;
}

// A name ends at the first of these: a comma, a bracket, a clause.
const NAME_STOP = /,|;|\(|\s+(?:a|an)\s+(?:company|private|public|limited|partnership|entity|body|undertaking)\b|\s+(?:incorporated|registered|domiciled|established|organi[sz]ed|formed|which|whose|who|being|having|by\s+virtue|copies|and\s+copies|and\s+the|and\s+its|under\s+the|is|was|with\s+(?:its|a)|the\s+registered|its\s+registered)\b/i;
// A full stop after one of these keeps the stop as part of the name ("Inditex S.A.").
const SUFFIX_DOT = /(?:^|\s)(?:ltd|inc|co|corp|plc|llc|s\.a|b\.v|n\.v|s\.p\.a|s\.r\.l|s\.à\s?r\.l|s\.a\.r\.l|a\.g|bros|cie|pty|pte)$/i;
// A full stop after one of these does not end the name ("Mr J. Smith").
const NOT_AN_END = /^(?:[A-Z]|mr|mrs|ms|dr|st|no|prof)$/i;
const NOT_A_NAME = /^(?:not\b|no\b|none\b|unknown\b|considered\b|regarded\b|deemed\b|controlled\b|owned\b|held\b|that\b|which\b|as\b|(?:the|its|this)\s+(?:company|group|directors|board|shareholders|members)$|(?:company|group|directors|board)$)/i;

/** The name a note gives at the start of `rest`, and where it ends. */
function nameFrom(rest: string): { name: string; end: number } | null {
  const s = rest.slice(0, 220);
  const stop = NAME_STOP.exec(s);
  let end = stop ? stop.index : s.length;
  let keepDot = false;
  for (let i = s.indexOf("."); i >= 0 && i < end; i = s.indexOf(".", i + 1)) {
    const next = s.slice(i + 1);
    // Inside a dotted legal form ("S.A", "B.V") the next character is not a space.
    if (next && !/^\s/.test(next) && !/^[,;)]/.test(next)) continue;
    const word = (s.slice(0, i).match(/(\S+)$/) || ["", ""])[1];
    if (NOT_AN_END.test(word) && /^\s+[A-Z]/.test(next)) continue;
    end = i;
    keepDot = SUFFIX_DOT.test(s.slice(0, i).trim());
    break;
  }
  let name = s.slice(0, end + (keepDot ? 1 : 0)).replace(/\s+/g, " ").trim();
  if (NOT_A_NAME.test(name)) return null;
  name = name.replace(/^the\s+(?=[A-Z])/i, "").replace(/[\s,;:]+$/g, "").replace(/^["'“‘]|["'”’]$/g, "").trim();
  if (!name || name.length > 110 || name.split(/\s+/).length > 12) return null;
  if (!/[A-Z0-9]/.test(name) || NOT_A_NAME.test(name)) return null;
  return { name, end: end + (keepDot ? 1 : 0) };
}

const ROLE_PATTERNS: Array<{ re: RegExp; roles: ParentRole[] }> = [
  // "The ultimate parent undertaking and largest group to consolidate these financial statements is KIRKBI A/S"
  { re: /\bultimate\s+(?:parent|holding)(?:\s+(?:undertaking|company|entity|parent))?[^.]{0,150}?\b(?:is|was)\s+(?:considered\s+(?:by\s+the\s+directors\s+)?to\s+be\s+|regarded\s+as\s+|deemed\s+to\s+be\s+)?(?:that\s+headed\s+by\s+)?/gi, roles: ["ultimate"] },
  { re: /\bimmediate\s+(?:and\s+ultimate\s+)?(?:parent|holding)(?:\s+(?:undertaking|company|entity))?[^.]{0,100}?\b(?:is|was)\s+/gi, roles: ["immediate"] },
  { re: /\b(?:ultimate\s+)?controlling\s+part(?:y|ies)(?:\s+of\s+(?:the|this)\s+(?:company|group))?[^.]{0,60}?\b(?:is|was|are|were)\s+(?:considered\s+(?:by\s+the\s+directors\s+)?to\s+be\s+|deemed\s+to\s+be\s+)?/gi, roles: ["controlling_party"] },
  { re: /\b(?:company|group)\s+is\s+(?:ultimately\s+)?controlled\s+by\s+/gi, roles: ["controlling_party"] },
  { re: /\blargest\b(?=[^.]{0,150}?\b(?:group|consolidat))[^.]{0,150}?\b(?:is|was)\s+(?:that\s+headed\s+by\s+|those\s+of\s+)?/gi, roles: ["largest_group"] },
  { re: /\bsmallest\b(?=[^.]{0,150}?\b(?:group|consolidat))[^.]{0,150}?\b(?:is|was)\s+(?:that\s+headed\s+by\s+|those\s+of\s+)?/gi, roles: ["smallest_group"] },
  { re: /\b(?:company|entity)\s+is\s+a\s+(?:wholly[- ]owned\s+|direct\s+|indirect\s+)?subsidiary\s+(?:undertaking\s+|company\s+)?of\s+/gi, roles: ["parent"] },
];

const NO_CONTROLLER = /\bno\s+(?:single\s+|one\s+|individual\s+|overall\s+|ultimate\s+)*controlling\s+part(?:y|ies)\b|\bcontrolling\s+party\s+is\s+not\s+(?:known|identifiable)\b|\bno\s+(?:single\s+|one\s+|individual\s+)*(?:party|person|shareholder|entity)\s+(?:has|exercises|holds)\s+(?:overall\s+|ultimate\s+)?control\b/i;

// The words a match came from: its sentence, without a note heading run into it.
function wordsAround(text: string, start: number, end: number): string {
  const before = text.slice(Math.max(0, start - 240), start);
  const stop = before.lastIndexOf(". ");
  let from = stop >= 0 ? start - before.length + stop + 2 : Math.max(0, start - 80);
  // A line with no full stop before it (an address) runs into the sentence: start at its "The".
  const lead = text.slice(from, start);
  const the = lead.lastIndexOf(" The ");
  if (the > 0) from += the + 1;
  // A name that closed its sentence ("XYZ Ltd.") ends the words.
  const closed = text[end - 1] === "." && /^\s/.test(text.slice(end, end + 1));
  const after = text.slice(end, end + 200);
  const close = closed ? 0 : after.search(/\.(?:\s|$)/);
  const words = text.slice(from, close >= 0 ? end + close + (closed ? 0 : 1) : end).replace(/\s+/g, " ").trim();
  return words.replace(/^\d{1,3}\.?\s+[A-Z][A-Za-z ,&'-]{3,80}?\s+(?=(?:The|In the opinion)\s)/, "").slice(0, 400);
}

/** The parent note in a UK company's accounts, from their text. */
export function readParentNote(rawText: string): ParentNoteLine[] {
  const text = String(rawText || "").replace(/\u00ad/g, "").replace(/(\w)-\s*\n\s*(\w)/g, "$1$2").replace(/\s+/g, " ").slice(0, 2_000_000);
  const lines: ParentNoteLine[] = [];
  const add = (line: ParentNoteLine) => {
    const same = lines.find(l => !l.none && !line.none && nameTokens(l.name).join(" ") === nameTokens(line.name).join(" "));
    if (same) {
      for (const r of line.roles) if (!same.roles.includes(r)) same.roles.push(r);
      same.roles.sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
      if (!same.country && line.country) same.country = line.country;
      return;
    }
    if (line.none && lines.some(l => l.none)) return;
    lines.push(line);
  };
  for (const { re, roles } of ROLE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const at = m.index + m[0].length;
      const found = nameFrom(text.slice(at));
      if (!found) continue;
      const tail = text.slice(at + found.end, at + found.end + 160);
      // One sentence can give several roles ("the ultimate parent undertaking and controlling party").
      const head = m[0].toLowerCase();
      const all: ParentRole[] = [...roles];
      if (roles[0] === "ultimate" && /controlling\s+part/.test(head)) all.push("controlling_party");
      if (roles[0] === "ultimate" && /\blargest\b/.test(head)) all.push("largest_group");
      if (roles[0] === "ultimate" && /\bsmallest\b/.test(head)) all.push("smallest_group");
      if (roles[0] === "immediate" && /\bultimate\b/.test(head)) all.push("ultimate");
      if (roles[0] === "largest_group" && /\bsmallest\b/.test(head)) all.push("smallest_group");
      if (roles[0] === "smallest_group" && /\blargest\b/.test(head)) all.push("largest_group");
      const sorted = [...new Set(all)].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
      const kind = parentKind(found.name, sorted.includes("controlling_party") && !sorted.includes("ultimate") ? "controlling_party" : sorted[0]);
      add({ roles: sorted, name: found.name, kind, country: kind === "company" ? placeAfter(tail) : null, words: wordsAround(text, m.index, at + found.end), page: null });
    }
  }
  const none = NO_CONTROLLER.exec(text);
  if (none && !lines.some(l => l.roles.includes("controlling_party"))) {
    add({ roles: ["controlling_party"], name: "", kind: "people", country: null, words: wordsAround(text, none.index, none.index + none[0].length), page: null, none: true });
  }
  return lines.slice(0, 8);
}

/** Whether the accounts note (or anything else) gives the register's country as abroad. */
export const placeIsAbroad = (place: string | null | undefined): boolean => ownerRegister(place) === "abroad";

// The reader's answer for a scanned filing, kept only where it holds together:
// each name in the words it gives, a country only when the words name it, a
// page among those it was sent.
export function checkParentNoteAnswer(raw: unknown, pages: number[]): ParentNoteLine[] {
  const items = Array.isArray((raw as any)?.lines) ? (raw as any).lines : [];
  const out: ParentNoteLine[] = [];
  for (const it of items.slice(0, 10)) {
    const roles = (Array.isArray(it?.roles) ? it.roles : [it?.role]).filter((r: unknown): r is ParentRole => typeof r === "string" && (ROLE_ORDER as string[]).includes(r));
    const words = String(it?.words || "").replace(/\s+/g, " ").trim().slice(0, 400);
    const none = it?.none === true;
    const name = none ? "" : String(it?.name || "").replace(/\s+/g, " ").trim().slice(0, 110);
    if (!roles.length || !words) continue;
    if (!none) {
      const tn = nameTokens(name), tw = nameTokens(words);
      if (!tn.length || !tn.every(t => tw.some(w => sameToken(w, t)))) continue;
    }
    const country = String(it?.country || "").trim();
    const countryOk = country && nameTokens(country).every(t => nameTokens(words).some(w => sameToken(w, t)));
    const page = Number(it?.page);
    const sorted = [...new Set(roles as ParentRole[])].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
    out.push({
      roles: sorted, name, kind: none ? "people" : parentKind(name, sorted.includes("controlling_party") ? "controlling_party" : sorted[0]),
      country: countryOk ? country.slice(0, 60) : null, words, page: pages.includes(page) ? page : null, ...(none ? { none: true } : {}),
    });
  }
  return out;
}

/** The companies registered abroad that a reading names as a parent. */
export const foreignParentsIn = (note: AccountsParentNote | null | undefined): ParentNoteLine[] =>
  (note?.lines || []).filter(l => !l.none && l.kind === "company" && !!l.country && placeIsAbroad(l.country));

// ── GLEIF ───────────────────────────────────────────────────────────────────

export interface GleifEntity {
  lei: string;
  name: string;
  jurisdiction: string | null;
  country: string | null;
  registeredAs: string | null;
  // ACTIVE or INACTIVE (the entity), ISSUED or LAPSED (its LEI).
  status: string | null;
  leiStatus: string | null;
  lastUpdate: string | null;
}

export type GleifTopKind = "company" | "people" | "no_known_person" | "not_consolidated" | "undisclosed" | "unknown";

export interface GleifTop { kind: GleifTopKind; reason: string | null; words: string }

export interface GleifTrace {
  status: "found" | "not_found" | "ambiguous" | "error" | "skipped";
  entity: GleifEntity | null;
  // Its parents in order, the direct parent first.
  parents: GleifEntity[];
  // What is at the top of the chain.
  top: GleifTop | null;
  candidates: number;
  error: string | null;
}

export interface AbroadTrace {
  name: string;
  country: string;
  registrationNumber: string | null;
  // register: a person with significant control of the party; chain: found
  // up the UK chain; accounts: named in the party's accounts; party: the
  // party itself, a company with no UK record (21 November 2026).
  via: "register" | "chain" | "accounts" | "party";
  foundAt: string | null;
  gleif: GleifTrace;
}

export interface PrecheckAbroad {
  accounts: AccountsParentNote | null;
  traced: AbroadTrace[];
  checkedAt: string;
  // The party is a company with no UK record: it was itself looked up in GLEIF.
  party?: boolean;
}

/** The fields the GLEIF API gives a record, as the app keeps them. */
export function gleifEntityFrom(record: any): GleifEntity | null {
  const a = record?.attributes;
  const lei = String(record?.id || a?.lei || "").trim();
  if (!/^[A-Z0-9]{20}$/.test(lei) || !a?.entity) return null;
  const e = a.entity;
  return {
    lei,
    name: String(e.legalName?.name || "").replace(/\s+/g, " ").trim().slice(0, 200),
    jurisdiction: e.jurisdiction ? String(e.jurisdiction).slice(0, 10) : null,
    country: e.legalAddress?.country ? String(e.legalAddress.country).slice(0, 4) : null,
    registeredAs: e.registeredAs ? String(e.registeredAs).slice(0, 60) : null,
    status: e.status ? String(e.status).slice(0, 20) : null,
    leiStatus: a.registration?.status ? String(a.registration.status).slice(0, 20) : null,
    lastUpdate: a.registration?.lastUpdateDate ? String(a.registration.lastUpdateDate).slice(0, 10) : null,
  };
}

const regKey = (s: string | null | undefined) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+(?=\d)/, "");
const nameKey = (s: string) => nameTokens(s, true).sort().join(" ");
const sameCountry = (code: string | null, e: GleifEntity) => !code || (e.jurisdiction || "").toUpperCase().split("-")[0] === code || (e.country || "").toUpperCase() === code;

/**
 * The one GLEIF record a company is: by its registration number in its
 * country, else by exactly its name there. Two records of that name are
 * "ambiguous" and none is picked.
 */
export function pickGleifRecord(query: { name: string; country: string | null; registrationNumber: string | null }, records: GleifEntity[]): { pick: GleifEntity | null; status: "found" | "not_found" | "ambiguous"; candidates: number } {
  const code = countryCode(query.country);
  const reg = regKey(query.registrationNumber);
  if (reg) {
    const byNumber = records.filter(r => regKey(r.registeredAs) === reg && sameCountry(code, r));
    if (byNumber.length === 1) return { pick: byNumber[0], status: "found", candidates: 1 };
  }
  const key = nameKey(query.name);
  if (!key) return { pick: null, status: "not_found", candidates: 0 };
  const byName = records.filter(r => nameKey(r.name) === key && sameCountry(code, r));
  // Of several, one still active with a live LEI is not enough to choose: the same name twice is two companies.
  if (byName.length === 1) return { pick: byName[0], status: "found", candidates: 1 };
  return { pick: null, status: byName.length > 1 ? "ambiguous" : "not_found", candidates: byName.length };
}

const EXCEPTION_WORDS: Record<string, { kind: GleifTopKind; words: string }> = {
  NATURAL_PERSONS: { kind: "people", words: "owned or controlled by individuals; GLEIF does not name them" },
  NO_KNOWN_PERSON: { kind: "no_known_person", words: "no known person owns or controls it, as it reported to GLEIF" },
  NON_CONSOLIDATING: { kind: "not_consolidated", words: "its owner does not consolidate it in group accounts, so GLEIF does not name the owner" },
  NON_PUBLIC: { kind: "undisclosed", words: "its parent is not made public" },
  BINDING_LEGAL_COMMITMENTS: { kind: "undisclosed", words: "its parent is not disclosed (binding legal commitments)" },
  LEGAL_OBSTACLES: { kind: "undisclosed", words: "its parent is not disclosed (legal obstacles)" },
  DISCLOSURE_DETRIMENTAL: { kind: "undisclosed", words: "its parent is not disclosed (disclosure would harm it)" },
  CONSENT_NOT_OBTAINED: { kind: "undisclosed", words: "its parent is not disclosed (the parent did not consent)" },
  DETRIMENT_NOT_EXCLUDED: { kind: "undisclosed", words: "its parent is not disclosed (harm could not be ruled out)" },
};

/** What the top of a GLEIF chain means: a company, or the reason it reports no parent. */
export function gleifTop(top: GleifEntity | null, exception: string | null | undefined): GleifTop {
  if (top) return { kind: "company", reason: null, words: `its ultimate parent in GLEIF is ${top.name}${top.jurisdiction ? ` (${top.jurisdiction})` : ""}` };
  const reason = String(exception || "").trim().toUpperCase();
  const known = EXCEPTION_WORDS[reason];
  if (known) return { kind: known.kind, reason, words: known.words };
  return { kind: "unknown", reason: reason || null, words: reason ? `GLEIF records no parent (${reason.toLowerCase().replace(/_/g, " ")})` : "GLEIF records no parent and gives no reason" };
}

// ── Strict company names ───────────────────────────────────────────────────
// The loose match drops legal forms, so "LEGO A/S" and "LEGO Company Limited"
// read as one company. Here the legal form counts: the same words, legal form
// included, written either way ("Ltd" and "Limited", "A/S" and "AS").
const FORM_WORDS: Array<[RegExp, string]> = [
  // Accents are gone by now, so "S.à r.l." reads "s.a r.l.": before "s.a".
  [/\bs\.a\.?\s?r\.l\b\.?/g, "sarl"],
  [/\bltd\b\.?/g, "limited"], [/\bco\b\.?/g, "company"], [/\bcorp\b\.?/g, "corporation"], [/\binc\b\.?/g, "incorporated"],
  [/\bp\.l\.c\b\.?/g, "plc"], [/\bpublic limited company\b/g, "plc"], [/\ba\/s\b/g, "as"], [/\bs\.a\b\.?/g, "sa"], [/\bb\.v\b\.?/g, "bv"],
  [/\bn\.v\b\.?/g, "nv"], [/\bs\.p\.a\b\.?/g, "spa"], [/\bs\.r\.l\b\.?/g, "srl"], [/&/g, " and "],
];
export function strictCompanyKey(name: string): string {
  let t = String(name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  for (const [re, to] of FORM_WORDS) t = t.replace(re, to);
  return t.replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w && w !== "the").join(" ");
}
/** The same company, legal form included (a letter out in a long word allowed). */
export function sameCompany(a: string, b: string): boolean {
  const ka = strictCompanyKey(a).split(" ").filter(Boolean), kb = strictCompanyKey(b).split(" ").filter(Boolean);
  if (!ka.length || ka.length !== kb.length) return false;
  const rest = [...kb];
  for (const w of ka) {
    const i = rest.findIndex(x => sameToken(x, w));
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  return true;
}

// ── Evidence and people behind a company abroad ─────────────────────────────

export type AbroadRecordKind = "register_page" | "document" | "chart" | "note" | "person";

/** A piece of evidence, or a person, recorded against a company abroad that owns the party. */
export interface AbroadRecord {
  id: string;
  ownerName: string;
  ownerCountry: string | null;
  kind: AbroadRecordKind;
  documentId: string | null;
  sourceUrl: string | null;
  note: string | null;
  person: { name: string; detail: string; nationality: string | null; dob: { month: number | null; year: number | null } | null } | null;
  by: string;
  at: string;
}

export const ABROAD_NOTE_MIN = 10;
export const ABROAD_PERSON_DETAIL_MIN = 5;

/** The records about one company abroad (the same company by name). */
export const recordsFor = (ownerName: string, records: AbroadRecord[]): AbroadRecord[] =>
  records.filter(r => sameCompany(r.ownerName, ownerName));

export interface AbroadStatus {
  name: string;
  country: string;
  // What was found about it, each with where it came from.
  found: string[];
  people: string[];
  evidence: number;
  // What is still needed, or null.
  needs: string | null;
}

/**
 * Where each company abroad stands: what the accounts, GLEIF and the records
 * show, and whether the people behind it are still to find. It is done for
 * this list once someone is recorded behind it, or the client's chart arrived
 * (the people then come from it).
 */
export function abroadStatus(input: {
  owners: Array<{ name: string; country: string; via?: AbroadTrace["via"]; foundAt?: string | null }>;
  abroad: PrecheckAbroad | null | undefined;
  records: AbroadRecord[];
  chartReceived: boolean;
}): AbroadStatus[] {
  const traced = input.abroad?.traced || [];
  const parents = input.abroad?.accounts?.lines || [];
  return input.owners.map(o => {
    const t = traced.find(x => sameCompany(x.name, o.name)) || null;
    const recs = recordsFor(o.name, input.records);
    const people = recs.filter(r => r.kind === "person" && r.person).map(r => r.person!.name);
    const found: string[] = [];
    if (o.via === "accounts") found.push("Named in the accounts as its parent; the register names no owner");
    else if (o.foundAt) found.push(`On the register of ${o.foundAt}`);
    else found.push("On the company's register of people with significant control");
    const named = parents.find(p => !p.none && sameCompany(p.name, o.name));
    if (named && o.via !== "accounts") found.push(`The accounts name it as the ${parentRolesWords(named.roles)}`);
    if (t) found.push(gleifTraceWords(t).replace(/^[^:]+:\s*/, "GLEIF: "));
    const evidence = recs.filter(r => r.kind === "register_page" || r.kind === "document" || r.kind === "chart").length;
    const needs = people.length ? null
      : input.chartReceived ? "the people behind it, from the client's structure chart"
      : t?.gleif.top?.kind === "company" ? `the people behind ${t.gleif.top.words.replace(/^its ultimate parent in GLEIF is /, "")}: from its own register, the client's structure chart or a Creditsafe report`
      : "the people behind it: from its own register, the client's structure chart or a Creditsafe report";
    return { name: o.name, country: o.country, found, people, evidence, needs };
  });
}

// ── The client's structure chart ────────────────────────────────────────────

export type ChartEntityKind = "company" | "person" | "trust" | "foundation" | "fund" | "other";

export interface ChartEntity { name: string; kind: ChartEntityKind; country: string | null; owns: Array<{ name: string; percent: string | null }> }

export interface ChartReading {
  read: boolean;
  unreadable: string | null;
  entities: ChartEntity[];
  readAt: string;
}

const CHART_KINDS: ChartEntityKind[] = ["company", "person", "trust", "foundation", "fund", "other"];

/** The reader's answer, kept to what a chart can say. */
export function cleanChartReading(raw: unknown, readAt: string): ChartReading {
  const items = Array.isArray((raw as any)?.entities) ? (raw as any).entities : [];
  const entities: ChartEntity[] = [];
  for (const it of items.slice(0, 40)) {
    const name = String(it?.name || "").replace(/\s+/g, " ").trim().slice(0, 140);
    if (!name || !/[A-Za-z]/.test(name)) continue;
    const kind = (CHART_KINDS as string[]).includes(it?.kind) ? it.kind as ChartEntityKind : "other";
    const owns = (Array.isArray(it?.owns) ? it.owns : []).slice(0, 12).map((o: any) => ({
      name: String(o?.name || "").replace(/\s+/g, " ").trim().slice(0, 140),
      percent: o?.percent == null || o.percent === "" ? null : String(o.percent).replace(/\s+/g, " ").trim().slice(0, 20),
    })).filter((o: { name: string }) => !!o.name);
    if (entities.some(e => e.name.toLowerCase() === name.toLowerCase())) continue;
    entities.push({ name, kind, country: it?.country ? String(it.country).trim().slice(0, 60) : null, owns });
  }
  return { read: true, unreadable: null, entities, readAt };
}

export const unreadableChart = (why: string, readAt: string): ChartReading => ({ read: false, unreadable: why, entities: [], readAt });

export interface ChartFoundName { name: string; person: boolean; via: string }

export interface ChartComparison {
  matched: Array<{ chart: string; found: string; via: string }>;
  // On the chart, not found by the app.
  chartOnly: Array<{ name: string; kind: ChartEntityKind; country: string | null }>;
  // Found by the app, not on the chart.
  foundOnly: ChartFoundName[];
}

const looksLikePerson = (e: ChartEntity) => e.kind === "person";

/** The names on the client's chart against the names the app found. Never decides: it lists. */
export function compareChart(chart: ChartEntity[], found: ChartFoundName[], partyName: string): ChartComparison {
  const matched: ChartComparison["matched"] = [];
  const used = new Set<number>();
  const chartOnly: ChartComparison["chartOnly"] = [];
  for (const e of chart) {
    if (!looksLikePerson(e) && sameCompany(e.name, partyName)) continue;
    const idx = found.findIndex((f, i) => !used.has(i) && (f.person || looksLikePerson(e)
      ? (f.person && (looksLikePerson(e) || e.kind === "other")) && personNamesMatch(f.name, e.name)
      : sameCompany(f.name, e.name)));
    if (idx >= 0) { used.add(idx); matched.push({ chart: e.name, found: found[idx].name, via: found[idx].via }); }
    else chartOnly.push({ name: e.name, kind: e.kind, country: e.country });
  }
  const foundOnly = found.filter((f, i) => !used.has(i) && !sameCompany(f.name, partyName));
  return { matched, chartOnly, foundOnly };
}
