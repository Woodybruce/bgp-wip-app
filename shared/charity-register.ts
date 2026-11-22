// The Charity Commission for England and Wales's register of charities, read
// in BGP's checks before asking (Woody, 21 November 2026: "We need screening
// on GLEIF and foundations in the uk as I'm trying to set this up without
// using kyc4u"). A UK foundation is a charity: a charitable trust, a
// charitable company or a charitable incorporated organisation (CIO). The
// register says which, whether it is still registered, and who its trustees
// are; the trustees are the people who control it, so they are screened.
//
// The Commission publishes the whole register for anyone to download, once a
// day (server/charity-register.ts reads it). Pure rules here: the shape kept,
// how a charity is picked for a party, and what the register's facts mean.

export const CHARITY_REGISTER_WORDS = "the Charity Commission's register of charities (England and Wales)";
export const CHARITY_ATTRIBUTION = "Contains information from the register of charities kept by the Charity Commission for England and Wales.";

export interface CharityRecord {
  // The register's own key for the charity (its page on the register is keyed by it).
  organisationNumber: number;
  // The registered charity number, and the suffix of a linked charity (0 for the charity itself).
  number: string;
  linked: number;
  name: string;
  // Trust, CIO, Charitable company, Other, Previously excepted (none for many older charities).
  type: string | null;
  status: "registered" | "removed";
  registeredOn: string | null;
  removedOn: string | null;
  // The register's reporting status: Submission Received, Submission Overdue, Submission Double Default, ...
  reporting: string | null;
  accountsTo: string | null;
  income: number | null;
  companyNumber: string | null;
  insolvent: boolean;
  inAdministration: boolean;
  cio: boolean;
  cioDissolved: boolean;
  address: string | null;
  web: string | null;
  activities: string | null;
}

export interface CharityTrustee { name: string; chair: boolean; organisation: boolean; appointedOn: string | null }

/** What one party's look-up asks for: its charity number, its Companies House number, or its names. */
export interface CharityQuery { number?: string | null; companyNumber?: string | null; names?: string[] }

export type CharityLookupStatus = "found" | "not_found" | "ambiguous" | "error" | "skipped";

export interface PrecheckCharity {
  status: CharityLookupStatus;
  // What was looked for, in words: "the charity number 200051 (from GLEIF)".
  lookedFor: string;
  // How it was found. trustee: the party is the corporate trustee of the
  // charity (THE WELLCOME TRUST LIMITED is the trustee of the WELLCOME TRUST).
  via: "number" | "company" | "name" | "trustee" | null;
  candidates: number;
  error: string | null;
  charity: CharityRecord | null;
  otherNames: string[];
  trustees: CharityTrustee[];
  // The charities the register lists the party as a trustee of, by its exact name.
  trusteeOf?: CharityTrusteeOf[];
  // The date the register's download was made.
  extractDate: string | null;
}

export interface CharityTrusteeOf { name: string; number: string; organisationNumber: number; status: "registered" | "removed" }

const text = (v: unknown, max = 300): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const day = (v: unknown): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ""));
  return m ? m[1] : null;
};

/** A registered charity number: digits only, no leading zeros ("0200051" is 200051). */
export function charityNumberKey(v: unknown): string {
  const s = String(v ?? "").trim().replace(/-\d+$/, "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return s.length >= 5 && s.length <= 8 ? s : "";
}

/** A Companies House number as the register writes it: eight characters, digits padded ("2711000" is 02711000). */
export function companyNumberKey(v: unknown): string {
  const s = String(v ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{1,8}$/.test(s)) return "";
  return /^\d+$/.test(s) ? s.padStart(8, "0") : s;
}

/**
 * A charity's name as the look-up compares it: accents, case, punctuation and
 * a leading "The" aside, "&" read as "and" ("Esmée Fairbairn Foundation" is
 * ESMEE FAIRBAIRN FOUNDATION). Nothing else is dropped: "X Trust" and "X
 * Foundation" are two charities.
 */
export function charityNameKey(name: unknown): string {
  return String(name ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/^the\s+/, "").replace(/\s+/g, " ");
}

/** One line of the register's charity file, as the app keeps it; null for anything that is not a charity. */
export function charityRecordFrom(raw: any): CharityRecord | null {
  const org = Number(raw?.organisation_number);
  const number = charityNumberKey(raw?.registered_charity_number);
  const name = text(raw?.charity_name, 200);
  if (!Number.isFinite(org) || org <= 0 || !number || !name) return null;
  const address = [raw.charity_contact_address1, raw.charity_contact_address2, raw.charity_contact_address3, raw.charity_contact_address4, raw.charity_contact_address5, raw.charity_contact_postcode]
    .map(v => text(v, 80)).filter(Boolean).join(", ");
  const income = Number(raw.latest_income);
  return {
    organisationNumber: org,
    number,
    linked: Number(raw.linked_charity_number) || 0,
    name,
    type: text(raw.charity_type, 40) || null,
    status: /^removed$/i.test(text(raw.charity_registration_status)) ? "removed" : "registered",
    registeredOn: day(raw.date_of_registration),
    removedOn: day(raw.date_of_removal),
    reporting: text(raw.charity_reporting_status, 60) || null,
    accountsTo: day(raw.latest_acc_fin_period_end_date),
    income: raw.latest_income == null || !Number.isFinite(income) ? null : income,
    companyNumber: companyNumberKey(raw.charity_company_registration_number) || null,
    insolvent: raw.charity_insolvent === true,
    inAdministration: raw.charity_in_administration === true,
    cio: raw.charity_is_cio === true || /^cio$/i.test(text(raw.charity_type)),
    cioDissolved: raw.cio_is_dissolved === true,
    address: address || null,
    web: text(raw.charity_contact_web, 200) || null,
    activities: text(raw.charity_activities, 400) || null,
  };
}

/** One line of the register's trustee file: the charity it is for, and the trustee. */
export function charityTrusteeFrom(raw: any): { organisationNumber: number; trustee: CharityTrustee } | null {
  const org = Number(raw?.organisation_number);
  const name = text(raw?.trustee_name, 160);
  if (!Number.isFinite(org) || org <= 0 || !name) return null;
  return {
    organisationNumber: org,
    trustee: { name, chair: raw.trustee_is_chair === true, organisation: String(raw.individual_or_organisation || "").toUpperCase() === "O", appointedOn: day(raw.trustee_date_of_appointment) },
  };
}

/** One line of the register's other-names file (a working or previous name). */
export function charityOtherNameFrom(raw: any): { organisationNumber: number; name: string; kind: string | null } | null {
  const org = Number(raw?.organisation_number);
  const name = text(raw?.charity_name, 200);
  if (!Number.isFinite(org) || org <= 0 || !name) return null;
  return { organisationNumber: org, name, kind: text(raw.charity_name_type, 40) || null };
}

/** Whether a register line could answer a query (the scan keeps these, then picks). */
export function charityMatches(rec: CharityRecord, q: CharityQuery, otherNameOrgs: ReadonlySet<number> = new Set()): boolean {
  if (rec.linked !== 0) return false;
  const number = charityNumberKey(q.number);
  if (number && rec.number === number) return true;
  const company = companyNumberKey(q.companyNumber);
  if (company && rec.companyNumber === company) return true;
  const keys = (q.names || []).map(charityNameKey).filter(Boolean);
  return keys.includes(charityNameKey(rec.name)) || otherNameOrgs.has(rec.organisationNumber);
}

/**
 * The one charity a party is. By its charity number; else by its Companies
 * House number (a charitable company); else exactly its name (or a working or
 * previous name). A charity still registered wins over one removed; two of
 * either is ambiguous and none is picked: a name shared by two charities
 * needs the charity number.
 */
export function pickCharity(q: CharityQuery, records: CharityRecord[], otherNameOrgs: ReadonlySet<number> = new Set(), trusteeOf: CharityRecord[] = []): { pick: CharityRecord | null; status: "found" | "not_found" | "ambiguous"; via: PrecheckCharity["via"]; candidates: number } {
  const main = records.filter(r => r.linked === 0);
  const choose = (list: CharityRecord[], via: PrecheckCharity["via"]) => {
    const registered = list.filter(r => r.status === "registered");
    if (registered.length === 1) return { pick: registered[0], status: "found" as const, via, candidates: 1 };
    if (registered.length > 1) return { pick: null, status: "ambiguous" as const, via, candidates: registered.length };
    if (list.length === 1) return { pick: list[0], status: "found" as const, via, candidates: 1 };
    return { pick: null, status: list.length ? "ambiguous" as const : "not_found" as const, via: list.length ? via : null, candidates: list.length };
  };
  const number = charityNumberKey(q.number);
  if (number) {
    const hit = choose(main.filter(r => r.number === number), "number");
    if (hit.status !== "not_found") return hit;
  }
  const company = companyNumberKey(q.companyNumber);
  if (company) {
    const hit = choose(main.filter(r => r.companyNumber === company), "company");
    if (hit.status !== "not_found") return hit;
  }
  const keys = (q.names || []).map(charityNameKey).filter(Boolean);
  const byName = keys.length ? choose(main.filter(r => keys.includes(charityNameKey(r.name)) || otherNameOrgs.has(r.organisationNumber)), "name") : null;
  if (byName && byName.status !== "not_found") return byName;
  // Not a charity itself: the one charity the register lists it as the trustee of.
  const trusteed = choose(trusteeOf.filter(r => r.linked === 0), "trustee");
  if (trusteed.status !== "not_found") return trusteed;
  return { pick: null, status: "not_found", via: null, candidates: 0 };
}

/** What the look-up asked for, in words. */
export function charityLookedFor(q: CharityQuery, from: string | null = null): string {
  const parts = [
    charityNumberKey(q.number) ? `the charity number ${charityNumberKey(q.number)}${from ? ` (${from})` : ""}` : "",
    companyNumberKey(q.companyNumber) ? `the Companies House number ${companyNumberKey(q.companyNumber)}` : "",
    (q.names || []).filter(Boolean).length ? `the name ${[...new Set((q.names || []).map(n => text(n, 160)).filter(Boolean))].join(" or ")}` : "",
  ].filter(Boolean);
  return parts.join(", then ") || "nothing to look for";
}

export const charityRegisterUrl = (organisationNumber: number): string =>
  `https://register-of-charities.charitycommission.gov.uk/charity-search/-/charity-details/${organisationNumber}`;

const longDay = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
};
const money = (n: number | null): string => n == null ? "" : `£${Math.round(n).toLocaleString("en-GB")}`;

export interface CharityConcern { key: string; label: string; red: boolean }

/**
 * What the register's facts mean for the checks. Removed from the register,
 * insolvent, in administration or a dissolved CIO are red flags; accounts or
 * returns overdue are warnings to weigh.
 */
export function charityConcerns(c: CharityRecord | null | undefined): CharityConcern[] {
  if (!c) return [];
  const out: CharityConcern[] = [];
  if (c.status === "removed") out.push({ key: "removed", label: `Removed from the register of charities${c.removedOn ? ` on ${longDay(c.removedOn)}` : ""}`, red: true });
  if (c.insolvent) out.push({ key: "insolvent", label: "The register records the charity as insolvent", red: true });
  if (c.inAdministration) out.push({ key: "administration", label: "The register records the charity as in administration", red: true });
  if (c.cioDissolved) out.push({ key: "cio_dissolved", label: "The register records the CIO as dissolved", red: true });
  if (/double default/i.test(c.reporting || "")) out.push({ key: "double_default", label: "In double default at the Charity Commission: its accounts or annual returns have not been filed for two years", red: false });
  else if (/overdue/i.test(c.reporting || "")) out.push({ key: "overdue", label: "Accounts or annual return overdue at the Charity Commission", red: false });
  return out;
}

const KIND_WORDS: Record<string, string> = {
  trust: "a charitable trust",
  cio: "a charitable incorporated organisation (CIO)",
  "charitable company": "a charitable company",
  "previously excepted": "a charity previously excepted from registration",
};
/** The kind of charity, in words ("a charitable company"); null when the register does not say. */
export function charityKindWords(c: Pick<CharityRecord, "type" | "cio" | "companyNumber">): string | null {
  if (c.cio) return KIND_WORDS.cio;
  if (c.companyNumber) return KIND_WORDS["charitable company"];
  return KIND_WORDS[String(c.type || "").toLowerCase()] || null;
}

/** The trustees in order: the chair first, then as the register lists them. */
export const trusteesInOrder = (trustees: CharityTrustee[]): CharityTrustee[] =>
  [...trustees.filter(t => t.chair), ...trustees.filter(t => !t.chair)];

/** The look-up, in lines: the deal card, KYC4U's note, the AML file. */
export function charityLines(pc: PrecheckCharity | null | undefined): string[] {
  if (!pc) return [];
  if (pc.status === "skipped") return pc.error ? [`The Charity Commission's register was not read: ${pc.error}.`] : [];
  if (pc.status === "error") return [`The Charity Commission's register could not be read (${pc.error || "no reason given"}).`];
  const trusteeLine = (pc.trusteeOf || []).length
    ? [`The register lists it as a trustee of ${pc.trusteeOf!.length === 1 ? "" : `${pc.trusteeOf!.length} charities: `}${pc.trusteeOf!.slice(0, 6).map(t => `${t.name} (${t.number}${t.status === "removed" ? ", removed" : ""})`).join(", ")}${pc.trusteeOf!.length > 6 ? ", and more" : ""}.`]
    : [];
  if (pc.status === "not_found") return [`Not on the Charity Commission's register under ${pc.lookedFor}.`, ...trusteeLine];
  if (pc.status === "ambiguous") {
    return pc.via === "trustee"
      ? [...trusteeLine, "The charity number is needed to say which one the transaction is for."]
      : [`${pc.candidates} charities on the Charity Commission's register match ${pc.lookedFor}: the charity number is needed to choose.`, ...trusteeLine];
  }
  const c = pc.charity!;
  const kind = charityKindWords(c);
  const trustees = trusteesInOrder(pc.trustees);
  const others = (pc.trusteeOf || []).filter(t => t.organisationNumber !== c.organisationNumber);
  return [
    ...(pc.via === "trustee" ? [`The Charity Commission's register lists it as a trustee of ${c.name} (charity ${c.number}): it acts for that charity.`] : []),
    `${c.name}, registered charity ${c.number}${kind ? `, ${kind}` : ""}: ${c.status === "removed" ? `removed from the register${c.removedOn ? ` on ${longDay(c.removedOn)}` : ""}` : `registered${c.registeredOn ? ` since ${longDay(c.registeredOn)}` : ""}`} (Charity Commission, found by ${pc.via === "number" ? "its charity number" : pc.via === "company" ? "its Companies House number" : pc.via === "trustee" ? "its trustee's name" : "its name"}).`,
    ...(c.companyNumber ? [`Companies House number ${c.companyNumber}.`] : []),
    ...(c.accountsTo ? [`Latest accounts to ${longDay(c.accountsTo)}${c.income != null ? `, income ${money(c.income)}` : ""}${c.reporting ? ` (${c.reporting.toLowerCase()})` : ""}.`] : []),
    trustees.length
      ? `Trustees on the register (${trustees.length}): ${trustees.slice(0, 20).map(t => `${t.name}${t.chair ? " (chair)" : ""}${t.organisation ? " (an organisation)" : ""}`).join(", ")}${trustees.length > 20 ? `, and ${trustees.length - 20} more` : ""}.`
      : "The register lists no trustees for it.",
    ...(pc.otherNames.length ? [`Other names on the register: ${pc.otherNames.slice(0, 6).join(", ")}.`] : []),
    ...(others.length ? [`Also a trustee of: ${others.slice(0, 6).map(t => `${t.name} (${t.number}${t.status === "removed" ? ", removed" : ""})`).join(", ")}.`] : []),
    ...charityConcerns(c).map(x => `${x.label}.`),
  ];
}

export interface CharityFacts {
  state: CharityLookupStatus;
  lookedFor: string;
  name: string | null;
  number: string | null;
  kind: string | null;
  status: string | null;
  registeredOn: string | null;
  companyNumber: string | null;
  accounts: string | null;
  address: string | null;
  web: string | null;
  activities: string | null;
  trustees: Array<{ name: string; chair: boolean; organisation: boolean }>;
  otherNames: string[];
  // The party is the charity's trustee, not the charity (in words).
  actsAsTrustee: string | null;
  warnings: string[];
  registerUrl: string | null;
  error: string | null;
  candidates: number;
}

/** What the AML box shows of the look-up. */
export function charityFacts(pc: PrecheckCharity | null | undefined): CharityFacts | null {
  if (!pc || pc.status === "skipped") return null;
  const c = pc.charity;
  return {
    state: pc.status,
    lookedFor: pc.lookedFor,
    name: c?.name || null,
    number: c?.number || null,
    kind: c ? charityKindWords(c) : null,
    status: c ? (c.status === "removed" ? `Removed${c.removedOn ? ` ${longDay(c.removedOn)}` : ""}` : "Registered") : null,
    registeredOn: c?.registeredOn ? longDay(c.registeredOn) : null,
    companyNumber: c?.companyNumber || null,
    accounts: c?.accountsTo ? `To ${longDay(c.accountsTo)}${c.income != null ? `, income ${money(c.income)}` : ""}` : null,
    address: c?.address || null,
    web: c?.web || null,
    activities: c?.activities || null,
    trustees: trusteesInOrder(pc.trustees).map(t => ({ name: t.name, chair: t.chair, organisation: t.organisation })),
    otherNames: pc.otherNames.slice(0, 8),
    actsAsTrustee: pc.via === "trustee" && c ? `The register lists the party as a trustee of ${c.name}: it acts for that charity.` : null,
    warnings: charityConcerns(c).map(x => x.label),
    registerUrl: c ? charityRegisterUrl(c.organisationNumber) : null,
    error: pc.error,
    candidates: pc.candidates,
  };
}

// Words that make a UK name read as a charity or foundation, for when to look
// it up: never by themselves a reason to treat it as one.
const CHARITY_WORDS = /\b(charity|charities|charitable|foundation|trust|trustees|endowment|almshouses?|benevolent|cio)\b/i;
export const readsLikeCharity = (name: unknown): boolean => CHARITY_WORDS.test(String(name ?? ""));

// Companies House types that a charitable company or CIO has: a company
// limited by guarantee (no share capital), and the CIO types.
export const chTypeMayBeCharity = (type: unknown): boolean =>
  /^(private-limited-guarant-nsc(-limited-exemption)?|charitable-incorporated-organisation|scottish-charitable-incorporated-organisation)$/.test(String(type ?? "").trim());

// A trustee's name as a person's name: the register keeps titles and letters
// ("Professor David Hill", "Sir John Smith OBE"); the screens want the name.
// Ambiguous letters ("MA", "BA") are left alone: they are also surnames.
const HONORIFICS = /^(?:(?:the\s+)?(?:rt\.?\s+hon\.?|right\s+honourable|hon\.?|honourable|very\s+rev(?:erend|d)?\.?|rev(?:erend|d)?\.?|ven(?:erable)?\.?|canon|prof(?:essor)?\.?|dr\.?|sir|dame|lord|lady|baroness|baron|viscountess|viscount|earl|countess|duchess|duke|marquess|cllr\.?|councillor|rabbi|imam|mrs\.?|mr\.?|ms\.?|miss|mx\.?)\s+)+/i;
const POST_NOMINALS = /(?:[\s,]+(?:obe|mbe|cbe|kbe|dbe|gbe|cmg|kcmg|cvo|lvo|mvo|kcvo|dcvo|qc|kc|frs|frsa|frcp|frcs|freng|fmedsci|fba|phd|dphil|mba|msc|bsc|llb|llm|bt|bart|frics|mrics|fca|aca|cta|frse)\.?)+$/i;
export function trusteePersonName(raw: unknown): string {
  const original = text(raw, 160);
  let n = original;
  for (let i = 0; i < 3; i++) n = n.replace(HONORIFICS, "").replace(POST_NOMINALS, "").trim();
  return n.split(/\s+/).length >= 2 ? n : original;
}
