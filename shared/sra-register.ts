// The SRA's own data on the law firms on its register (Woody, 21 November
// 2026: "ive done the solcitors api btw"). One call to the SRA's data share,
// GET datashare/api/V1/organisation/GetAll, made with the subscription key
// Woody took out on the SRA's developer portal (product "Data Sharing",
// subscription "Chat BGP"): about 25,000 organisations in one answer of about
// 24 MB, which the SRA refreshes every 24 hours. Read on 21 November 2026:
// 25,310 entries, 10,791 of them firms the SRA authorises or authorised.
//
// The SRA's terms (Firm data web service, last updated 1 July 2020): free; the
// data may be combined with other information and shown in a product; where it
// is used, its source is acknowledged with a link to the SRA's attribution
// statement; nothing may suggest the SRA endorses BGP; the key is kept
// confidential. The status words below are the SRA's own register's words for
// each kind of entry (its organisation pages, read the same day).
//
// Pure: server/sra-register.ts reads and keeps the data; shared/solicitor-aml.ts
// turns a firm into the AML box's solicitors check.

export const SRA_DATASHARE_HOST = "sra-prod-apim.azure-api.net";
export const SRA_DATASHARE_URL = `https://${SRA_DATASHARE_HOST}/datashare/api/V1/organisation/GetAll`;
export const SRA_ATTRIBUTION_URL = "https://www.sra.org.uk/sra/how-we-work/privacy-data-information/data-sharing/attribution/";
export const SRA_ATTRIBUTION_WORDS = "ChatBGP includes data supplied by the Solicitors Regulation Authority";
export const SRA_REGISTER_SEARCH_URL = "https://www.sra.org.uk/consumers/register/";
export const sraRegisterPage = (sraNumber: string) => `https://www.sra.org.uk/consumers/register/organisation/?sraNumber=${encodeURIComponent(sraNumber)}`;

export interface SraOffice {
  address: string;
  town: string | null;
  postcode: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

export interface SraFirm {
  sraNumber: string;
  name: string;
  tradingNames: string[];
  previousNames: string[];
  /** The SRA's own word for the entry, e.g. RecognisedBodyAuthorised, LicensedBodyIntervened. */
  type: string;
  /** AuthorisationStatus: YES, CONDITION, CEASE, REVOKE or INTERVENE; null when the SRA does not authorise it. */
  status: string | null;
  /** RECBODY, LICBODY, RECSOLE or NOTSRA-F. */
  authorisationType: string | null;
  authorisedOn: string | null;
  statusOn: string | null;
  /** SRA, or another approved regulator (CLC, BSB, CILEX, IPRB, ACCA, MF, CLSB). */
  regulator: string | null;
  companyNumber: string | null;
  offices: number;
  headOffice: SraOffice | null;
  websites: string[];
  workAreas: string[];
  /** Web and email domains from the firm's websites and offices, to find it by an address. */
  domains: string[];
}

const str = (v: unknown): string => typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
const strs = (v: unknown): string[] => Array.isArray(v) ? v.map(str).filter(Boolean) : [];
const isoDay = (v: unknown): string | null => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(str(v)); return m ? m[1] : null; };

/** Companies House's eight characters: "7219165" is 07219165, "OC306185" stays. */
export function companyNumberOf(v: unknown): string | null {
  const t = str(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) return null;
  if (/^\d{1,8}$/.test(t)) return t.padStart(8, "0");
  if (/^[A-Z]{2}\d{1,6}$/.test(t)) return t.slice(0, 2) + t.slice(2).padStart(6, "0");
  return t.length <= 10 ? t : null;
}

/** The domain of a web address or an email address: "www.forsters.co.uk" and "x@forsters.co.uk" are forsters.co.uk. */
export function domainOf(v: unknown): string | null {
  const words = str(v).toLowerCase().replace(/[<>"'()]/g, " ").split(" ").filter(Boolean);
  const email = words.find(w => w.includes("@"));
  let t = email ? email.slice(email.lastIndexOf("@") + 1) : words[0] || "";
  if (!t) return null;
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\d?\./, "").split(/[/?#:]/)[0].replace(/[.,;]+$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t) ? t : null;
}
const sameSite = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

function readOffice(o: any): SraOffice {
  const parts: string[] = [];
  for (const p of [o?.Address1, o?.Address2, o?.Address3, o?.Address4, o?.Town, o?.County, o?.Postcode, o?.Country].map(str)) {
    if (p && !parts.some(q => q.toLowerCase() === p.toLowerCase())) parts.push(p);
  }
  return {
    address: parts.join(", "),
    town: str(o?.Town) || null,
    postcode: str(o?.Postcode).toUpperCase() || null,
    country: str(o?.Country) || null,
    phone: str(o?.PhoneNumber) || null,
    email: str(o?.Email) || null,
    website: str(o?.Website) || null,
  };
}

/** One organisation from the SRA's answer, or null when it has no SRA number or name. */
export function readSraFirm(raw: any): SraFirm | null {
  if (!raw || typeof raw !== "object") return null;
  const sraNumber = str(raw.SraNumber).replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
  const name = str(raw.PracticeName).slice(0, 200);
  if (!sraNumber || !name) return null;
  const offices: any[] = Array.isArray(raw.Offices) ? raw.Offices : [];
  const head = offices.find(o => str(o?.OfficeType).toUpperCase() === "HO") || offices[0] || null;
  const websites = strs(raw.Websites).slice(0, 12);
  const domains = new Set<string>();
  for (const v of [...websites, ...offices.flatMap(o => [o?.Website, o?.Email])]) {
    const d = domainOf(v);
    if (d) domains.add(d);
  }
  const offCount = Number(raw.NoOfOffices);
  return {
    sraNumber,
    name,
    tradingNames: strs(raw.TradingNames).slice(0, 40),
    previousNames: strs(raw.PreviousNames).slice(0, 20),
    type: str(raw.Type),
    status: str(raw.AuthorisationStatus).toUpperCase() || null,
    authorisationType: str(raw.AuthorisationType).toUpperCase() || null,
    authorisedOn: isoDay(raw.AuthorisationDate),
    statusOn: isoDay(raw.AuthorisationStatusDate),
    regulator: str(raw.Regulator).toUpperCase() || null,
    companyNumber: companyNumberOf(raw.CompanyRegNo),
    offices: Number.isFinite(offCount) && offCount > 0 ? offCount : offices.length,
    headOffice: head ? readOffice(head) : null,
    websites,
    workAreas: strs(raw.WorkArea).slice(0, 30),
    domains: [...domains].slice(0, 20),
  };
}

// ── Names. A firm is found by its name the way a person types it: case, "&",
// punctuation and the legal form ("LLP", "Limited") do not matter, and the
// looser form also leaves out words every law firm uses ("Solicitors", "Law",
// "& Co", "UK", "International"), so "Gowling WLG" finds Gowling WLG (UK) LLP.
const LEGAL_FORMS = new Set(["llp", "limited", "ltd", "plc", "lp", "llc", "inc", "incorporated"]);
const GENERIC = new Set(["solicitors", "solicitor", "law", "legal", "lawyers", "and", "co", "company", "uk", "services", "practice", "firm", "international", "the", "of"]);

export function sraNameKey(name: unknown): string {
  return str(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\bl\.\s*l\.\s*p\b\.?/g, " llp ")
    .replace(/[&+]/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ")
    .split(" ").filter(w => w && !LEGAL_FORMS.has(w)).join(" ")
    .replace(/^the /, "");
}
export function sraLooseWords(name: unknown): string[] {
  return sraNameKey(name).split(" ").filter(w => w && !GENERIC.has(w));
}

interface Entry {
  firm: SraFirm;
  key: string;
  loose: string;
  otherKeys: string[];
  otherLoose: string[];
  /** Every loose word of every name, padded with spaces for whole-word tests. */
  words: string;
}
export interface SraIndex { entries: Entry[]; byNumber: Map<string, Entry>; count: number }

export function buildSraIndex(firms: SraFirm[]): SraIndex {
  const entries: Entry[] = [];
  const byNumber = new Map<string, Entry>();
  for (const firm of firms) {
    const others = [...firm.tradingNames, ...firm.previousNames];
    const allWords = new Set<string>();
    for (const n of [firm.name, ...others]) for (const w of sraLooseWords(n)) allWords.add(w);
    const e: Entry = {
      firm,
      key: sraNameKey(firm.name),
      loose: sraLooseWords(firm.name).join(" "),
      otherKeys: others.map(sraNameKey).filter(Boolean),
      otherLoose: others.map(n => sraLooseWords(n).join(" ")).filter(Boolean),
      words: ` ${[...allWords].join(" ")} `,
    };
    entries.push(e);
    if (!byNumber.has(firm.sraNumber)) byNumber.set(firm.sraNumber, e);
  }
  return { entries, byNumber, count: entries.length };
}

/** An SRA number typed on its own ("SRA 400249", "400249"), or null. */
export function sraNumberIn(q: unknown): string | null {
  const t = str(q).toLowerCase().replace(/\b(sra|no|number|id|ref)\b\.?/g, " ").replace(/[#:]/g, " ").replace(/\s+/g, "");
  return /^\d{4,8}$/.test(t) ? t.replace(/^0+(?=\d)/, "") : null;
}

export const sraAuthorised = (f: SraFirm) => f.status === "YES" || f.status === "CONDITION";
/** A regulated firm or lawyer: authorised by the SRA, an SRA-regulated freelance, or regulated by another approved regulator. */
export const sraRegulated = (f: SraFirm) => sraAuthorised(f)
  || /^practicenotseparatelyauthorised/i.test(f.type)
  || (!f.status && !!f.regulator && f.regulator !== "SRA");
/** On the register only because SRA-regulated people work there: not a firm regulated for legal services. */
export const sraNotForLegalServices = (f: SraFirm) => !f.status && !sraRegulated(f) && (f.authorisationType === "NOTSRA-F" || /^unregulatedpractice/i.test(f.type));

export type SraHow = "sra_number" | "website" | "name" | "other_name";
export interface SraLookup {
  query: string;
  /** The firm the name is taken to mean, when one stands out; else null and the person chooses. */
  firm: SraFirm | null;
  how: SraHow | null;
  /** Other entries that match, best first: the choices when nothing stands out. */
  candidates: SraFirm[];
  more: number;
}

const MAX_CANDIDATES = 8;

/**
 * Which firm a name means. A firm stands out when it is the one regulated
 * firm under exactly that name (the SRA, or for a few another approved
 * regulator such as the CLC); else the one SRA firm under exactly that name
 * that has closed, is closing or was closed down (its status is the finding);
 * else, when the only entries under the exact name are not regulated for
 * legal services (an international partnership, an office abroad), the one
 * regulated firm whose name differs only by words like "UK" or "(International)"
 * ("Eversheds Sutherland" is Eversheds Sutherland (International) LLP), or that
 * entry itself when there is no regulated firm near; else the one entry under
 * a looser form of the name; else the one firm that trades or traded under it
 * ("VWV"). Anything else is the person's choice. Some firms are not on the
 * SRA's list under the name people use (Taylor Wessing's firm in England and
 * Wales was not, on 21 November 2026), so a firm the check settles on that is
 * not regulated always offers the other entries.
 */
export function findSraFirm(index: SraIndex, raw: unknown, opts: { sraNumber?: string | null } = {}): SraLookup {
  const query = str(raw).slice(0, 160);
  const number = opts.sraNumber ? str(opts.sraNumber).replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "") : sraNumberIn(query);
  if (number) {
    const e = index.byNumber.get(number);
    return { query, firm: e?.firm || null, how: e ? "sra_number" : null, candidates: [], more: 0 };
  }
  const domain = /\s/.test(query) ? null : domainOf(query);
  if (domain && /\.[a-z]{2,}$/.test(domain)) {
    const hits = index.entries.filter(e => e.firm.domains.some(d => sameSite(d, domain)));
    return decide(query, hits, [], [], "website");
  }
  let found = byName(index, query);
  if (!found.firm && !found.candidates.length) {
    // "Forsters LLP (Jane Doe)", "Forsters - property team": the firm's name before the rest.
    const head = query.split(/\s[-–—|/]\s|[(,;]/)[0].trim();
    if (head && head !== query && head.replace(/[^a-z0-9]/gi, "").length >= 3) found = { ...byName(index, head), query };
  }
  return found;
}

function byName(index: SraIndex, query: string): SraLookup {
  const key = sraNameKey(query);
  const loose = sraLooseWords(query);
  const looseKey = loose.join(" ");
  if (!key) return { query, firm: null, how: null, candidates: [], more: 0 };
  const strong: Entry[] = [], other: Entry[] = [], words: Entry[] = [];
  for (const e of index.entries) {
    if (e.key === key || (looseKey && e.loose === looseKey)) strong.push(e);
    else if (e.otherKeys.includes(key) || (looseKey && e.otherLoose.includes(looseKey))) other.push(e);
    else if (loose.length && loose.every(w => e.words.includes(` ${w} `))) words.push(e);
  }
  return decide(query, strong, other, words, "name", key);
}

function decide(query: string, strong: Entry[], other: Entry[], words: Entry[], how: SraHow, key?: string): SraLookup {
  const exact = key === undefined ? strong : strong.filter(e => e.key === key);
  const looser = strong.filter(e => !exact.includes(e));
  const rest = [...other, ...words];
  const stands = (e: Entry) => sraRegulated(e.firm);
  const forLegalServices = (e: Entry) => !sraNotForLegalServices(e.firm);
  let pick: Entry | null = null;
  let pickHow: SraHow | null = how;
  const one = <T>(xs: T[]) => (xs.length === 1 ? xs[0] : null);
  if (exact.length) {
    const regulated = exact.filter(stands);
    const firms = exact.filter(forLegalServices);
    if (regulated.length) pick = one(regulated);
    else if (firms.length) pick = !looser.some(stands) ? one(firms) : null;
    else pick = one(looser.filter(stands)) || (!looser.some(stands) && !rest.some(stands) ? one(exact) : null);
  } else if (looser.length) {
    pick = one(looser.filter(stands)) || (!looser.some(stands) && !rest.some(stands) ? one(looser) : null);
  } else if (other.length === 1 && !words.some(stands)) {
    pick = other[0];
    pickHow = "other_name";
  }
  if (!pick) pickHow = null;
  // Authorised firms first: those under the name itself, then the rest by size
  // (a former or trading name, or the name's words in a longer name).
  const tier = (e: Entry) => (sraRegulated(e.firm) ? 0 : 2) + (strong.includes(e) ? 0 : 1);
  const ranked = [...strong, ...other, ...words]
    .filter(e => e !== pick)
    .sort((a, b) => tier(a) - tier(b) || b.firm.offices - a.firm.offices || a.firm.name.length - b.firm.name.length || a.firm.name.localeCompare(b.firm.name));
  const limit = pick ? 5 : MAX_CANDIDATES;
  return { query, firm: pick?.firm || null, how: pickHow, candidates: ranked.slice(0, limit).map(e => e.firm), more: Math.max(0, ranked.length - limit) };
}

/** An entry as a choice for the person: its name, number, status and where it is. */
export interface SraChoice {
  sraNumber: string;
  name: string;
  label: string;
  tone: SraTone;
  place: string | null;
  offices: number;
  /** The other name the query matched: "formerly Hewitsons", "trading as VWV". */
  alsoKnownAs: string | null;
}

export function sraChoice(f: SraFirm, query?: string): SraChoice {
  const st = sraStatus(f);
  const ho = f.headOffice;
  const abroad = ho?.country && !/^(england|wales|united kingdom|uk)$/i.test(ho.country) ? ho.country : null;
  const place = [ho?.town, ho?.postcode, abroad].filter(Boolean).join(", ") || null;
  let alsoKnownAs: string | null = null;
  if (query) {
    const key = sraNameKey(query), loose = sraLooseWords(query).join(" ");
    const hit = (n: string) => sraNameKey(n) === key || (!!loose && sraLooseWords(n).join(" ") === loose);
    const t = f.tradingNames.find(hit), p = f.previousNames.find(hit);
    alsoKnownAs = !hit(f.name) ? (t ? `trading as ${t}` : p ? `formerly ${p}` : null) : null;
  }
  return { sraNumber: f.sraNumber, name: f.name, label: st.label, tone: st.tone, place, offices: f.offices, alsoKnownAs };
}

// ── What the entry means, in the SRA register's own words.
const REGULATORS: Record<string, string> = {
  SRA: "the Solicitors Regulation Authority",
  CLC: "the Council for Licensed Conveyancers",
  BSB: "the Bar Standards Board",
  CILEX: "CILEx Regulation",
  IPRB: "the Intellectual Property Regulation Board",
  ACCA: "the ACCA",
  MF: "the Master of the Faculties (notaries)",
  CLSB: "the Costs Lawyer Standards Board",
  ICAEW: "the ICAEW",
};
const BODIES: Record<string, string> = { RECBODY: "recognised body", LICBODY: "licensed body", RECSOLE: "recognised sole practice" };

export function sraDayWords(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}

export type SraTone = "ok" | "attention" | "info";
export interface SraStatusWords {
  /** The SRA register's own heading for the entry. */
  label: string;
  tone: SraTone;
  /** A line for the AML box and the AML file. */
  line: string;
  /** What it means for the deal, when there is something to say. */
  explain: string | null;
}

export function sraStatus(f: SraFirm): SraStatusWords {
  const t = f.type.toLowerCase();
  const since = f.authorisedOn ? ` since ${sraDayWords(f.authorisedOn)}` : "";
  const on = f.statusOn ? ` on ${sraDayWords(f.statusOn)}` : "";
  const body = f.authorisationType ? BODIES[f.authorisationType] : undefined;
  const regulator = f.regulator ? REGULATORS[f.regulator] || f.regulator : null;
  if (f.status === "INTERVENE" || t.endsWith("intervened")) {
    return {
      label: "Closed down by the SRA", tone: "attention",
      line: `closed down by the SRA (an intervention${on})`,
      explain: "The SRA closed this firm down to protect the public: an intervention takes over the firm's client money and files, and the firm cannot act. Find out who is acting for the other side now, and tell the Nominated Officer.",
    };
  }
  if (f.status === "REVOKE" || t.endsWith("closurecomplete")) {
    return {
      label: "Firm has closed", tone: "attention",
      line: `closed${on}: no longer authorised by the SRA`,
      explain: "A closed firm cannot act. Check the name, and who is acting for the other side now.",
    };
  }
  if (f.status === "CEASE" || t.endsWith("closureinprogress")) {
    return {
      label: "Firm is closing", tone: "info",
      line: `closing${on}: still regulated by the SRA for its existing clients`,
      explain: "The SRA says a closing firm is still regulated to provide services to existing clients. Check it will carry on acting on this transaction.",
    };
  }
  if (f.status === "CONDITION" || t.endsWith("authorisedwithconditions")) {
    return {
      label: "SRA-regulated firm, conditions apply", tone: "attention",
      line: `an SRA-regulated firm with conditions on what it can do${body ? `, ${body}${since}` : ""}`,
      explain: "'Conditions apply' means the SRA restricts what the firm can do. Read the conditions on its SRA page and tell the Nominated Officer.",
    };
  }
  if (f.status === "YES" || /(body|practice)authorised$/.test(t)) {
    return { label: "SRA-regulated firm", tone: "ok", line: `an SRA-regulated firm${body ? `, ${body}${since}` : since}`, explain: null };
  }
  if (t === "practicenotseparatelyauthorised") {
    return { label: "SRA-regulated freelance", tone: "ok", line: "an SRA-regulated freelance lawyer, regulated to provide all legal services", explain: "One SRA-regulated lawyer working on their own, not a firm." };
  }
  if (t === "practicenotseparatelyauthorisedcompfund") {
    return { label: "SRA-regulated freelance", tone: "info", line: "an SRA-regulated freelance lawyer who can only offer some legal services", explain: "One SRA-regulated lawyer working on their own, who the SRA says can only offer some legal services. Check they can act on this kind of transaction." };
  }
  if (regulator && f.regulator !== "SRA") {
    return { label: "Regulated by an approved regulator for legal services", tone: "ok", line: `not an SRA-regulated firm; regulated by ${regulator}`, explain: null };
  }
  if (t === "unregulatedpracticenotsraauthorised102a") {
    return {
      label: "Not an SRA-regulated firm", tone: "info",
      line: "not an SRA-regulated firm (on the SRA's register because its owner is an SRA-regulated person)",
      explain: "The SRA does not regulate the practice, and it cannot provide reserved legal activities such as conveyancing. Check who is acting on the transaction.",
    };
  }
  if (f.authorisationType === "NOTSRA-F" || t.startsWith("unregulatedpractice")) {
    return {
      label: "Not regulated by an approved regulator for legal services", tone: "info",
      line: "not regulated for legal services (on the SRA's register because SRA-regulated people work there)",
      explain: "The SRA does not regulate it, and it is not regulated to provide reserved legal activities such as conveyancing. Big firms often have an entry like this for an international partnership or an office abroad besides their firm in England and Wales: choose that firm if it is theirs, or look it up on the SRA's register.",
    };
  }
  return { label: f.type || "On the SRA's register", tone: "info", line: `on the SRA's register (${f.type || "status not given"})`, explain: null };
}
