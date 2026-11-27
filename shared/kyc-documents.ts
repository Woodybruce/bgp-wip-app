// Documents BGP uploads on a party (Woody, 23 November 2026: "the documents
// upload button for KYC4U can that be just upload documents but also add the
// drag and drop function in the new box we have done so can upload certified
// documents, the app must read these and check they are acceptable"). Each
// file is read (server/kyc-documents.ts) and set against the people to check:
// an identity document counts for the person it names when it is in date and
// certified (or an agent saw the original), a proof of address by the proof
// of address rules (shared/kyc-address-proof.ts), and anything else is kept
// on the party's record. The people to check count a document that passes,
// or one the Nominated Officer or a Deputy accepted (shared/kyc-people.ts).
// Pure rules.
import { personDisplayName } from "./kyc-prechecks";
import { ADDRESS_PROOF_KINDS, addressNameMatches, addressProofDateWords, checkAddressProof, type AddressProofReading } from "./kyc-address-proof";
import { checkRegisterExtract, type ExtractSubject } from "./foreign-company";

export const IDENTITY_DOC_KINDS = ["passport", "driving_licence", "national_id", "firearms_certificate", "residence_permit"] as const;
export const COMPANY_DOC_KINDS = ["certificate_of_incorporation", "register_extract", "structure_chart", "accounts", "authority_letter", "source_of_funds", "terms_of_engagement"] as const;
export const KYC_DOCUMENT_KINDS = [...IDENTITY_DOC_KINDS, ...ADDRESS_PROOF_KINDS, ...COMPANY_DOC_KINDS, "other"] as const;
export type KycDocumentKind = (typeof KYC_DOCUMENT_KINDS)[number];

export const KYC_DOCUMENT_KIND_WORDS: Record<KycDocumentKind, string> = {
  passport: "Passport",
  driving_licence: "Driving licence",
  national_id: "National identity card",
  firearms_certificate: "Firearms or shotgun certificate",
  residence_permit: "Residence permit",
  utility_bill: "Utility bill",
  bank_statement: "Bank statement",
  building_society_statement: "Building society statement",
  mortgage_statement: "Mortgage statement",
  council_tax_bill: "Council tax bill",
  certificate_of_incorporation: "Certificate of incorporation",
  register_extract: "Company register extract",
  structure_chart: "Structure chart",
  accounts: "Accounts",
  authority_letter: "Letter of authority to act",
  source_of_funds: "Source of funds",
  terms_of_engagement: "Signed terms of engagement",
  other: "Another document",
};

// The type the party's KYC record files it under (kyc_documents.doc_type).
export const KYC_DOCUMENT_DOC_TYPE: Record<KycDocumentKind, string> = {
  passport: "passport", driving_licence: "driving_licence", national_id: "id_document", firearms_certificate: "id_document", residence_permit: "id_document",
  utility_bill: "proof_of_address", bank_statement: "proof_of_address", building_society_statement: "proof_of_address",
  mortgage_statement: "proof_of_address", council_tax_bill: "proof_of_address",
  certificate_of_incorporation: "company_cert", register_extract: "register_extract", structure_chart: "structure_chart",
  accounts: "company_accounts", authority_letter: "authority_to_act", source_of_funds: "source_of_funds",
  terms_of_engagement: "terms_of_engagement", other: "other",
};

export const isIdentityKind = (k: string | null | undefined): boolean => (IDENTITY_DOC_KINDS as readonly string[]).includes(String(k));
export const isAddressKind = (k: string | null | undefined): boolean => (ADDRESS_PROOF_KINDS as readonly string[]).includes(String(k));

export interface KycDocumentReading {
  readAt: string;
  read: boolean;
  // Why it could not be read (empty, a format the reader cannot open, the
  // reader off or out of today's allowance).
  unreadable: string | null;
  kind: KycDocumentKind | null;
  kindWords: string | null;            // what it says it is: "British passport"
  issuer: string | null;
  names: string[];                     // the people it names, as printed
  dob: string | null;                  // yyyy-mm-dd
  issued: string | null;               // yyyy-mm-dd
  expires: string | null;              // yyyy-mm-dd
  date: string | null;                 // a bill or statement's date (yyyy-mm-dd)
  address: string | null;
  // A copy certified as a true copy of the original, with what the
  // certification says and who gave it.
  certified: boolean;
  certification: {
    words: string | null;
    name: string | null;
    profession: string | null;         // solicitor, accountant, ...
    firm: string | null;
    date: string | null;               // yyyy-mm-dd
    // HMRC (AMLG11400) also asks for the certifier's address and telephone
    // number, and their signature. Absent on a reading made before
    // 23 November 2026: read it again.
    address?: string | null;
    phone?: string | null;
    signed?: boolean | null;
  } | null;
  // Since 23 November 2026 (Woody: everything in the app, translation
  // included). Absent on a reading made before then: read it again.
  // The language it is written in, in English ("German"), and whether that is English.
  language?: string | null;
  english?: boolean | null;
  // A company document (a register extract above all): the company as it shows
  // it. Names and numbers as printed; the status and legal form in English.
  company?: KycDocumentCompany | null;
  // The board or management (directors, managers, members of the board) and
  // the shareholders or owners it lists.
  directors?: KycDocumentDirector[];
  owners?: KycDocumentOwner[];
  // Terms of engagement: whether they carry the client's signature,
  // handwritten or electronic (25 November 2026). Absent on older readings.
  signed?: boolean | null;
}

export interface KycDocumentCompany {
  name: string | null;
  registrationNumber: string | null;
  legalForm: string | null;
  country: string | null;
  register: string | null;            // the register's own name: "Handelsregister, Amtsgericht München"
  address: string | null;             // its registered address
  status: string | null;              // in English: "active", "in liquidation", "dissolved"
  incorporated: string | null;        // yyyy-mm-dd
  extractDate: string | null;         // the date the extract or certificate was issued (yyyy-mm-dd)
}
export interface KycDocumentDirector { name: string; role: string | null; born: string | null }   // born: yyyy-mm or yyyy-mm-dd
export interface KycDocumentOwner { name: string; person: boolean; share: string | null; country: string | null }

export const KYC_DOCUMENT_ACCEPT_NOTE_MIN = 10;

const DAY = 86_400_000;
const isoDay = (s: string | null | undefined): number | null => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T12:00:00Z`);
  return Number.isFinite(t) ? t : null;
};
const dayWords = (s: string | null | undefined) => addressProofDateWords(s);

/** A reader's answer made safe: only the fields named, each the right type. */
export function cleanKycDocumentReading(raw: unknown, readAt: string): KycDocumentReading {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max = 300): string | null => typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;
  const day = (v: unknown): string | null => typeof v === "string" && isoDay(v.trim()) != null ? v.trim() : null;
  const kind = typeof r.kind === "string" && (KYC_DOCUMENT_KINDS as readonly string[]).includes(r.kind) ? r.kind as KycDocumentKind : null;
  const names = Array.isArray(r.names) ? r.names.map(n => str(n, 120)).filter((n): n is string => !!n).slice(0, 4) : [];
  const c = (r.certification && typeof r.certification === "object" ? r.certification : null) as Record<string, unknown> | null;
  const certified = r.certified === true;
  const co = (r.company && typeof r.company === "object" && !Array.isArray(r.company) ? r.company : null) as Record<string, unknown> | null;
  const born = (v: unknown): string | null => typeof v === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(v.trim()) && Number(v.trim().slice(5, 7)) >= 1 && Number(v.trim().slice(5, 7)) <= 12 ? v.trim() : null;
  const list = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[] : [];
  const language = str(r.language, 40);
  const company: KycDocumentCompany | null = co ? {
    name: str(co.name, 160), registrationNumber: str(co.registrationNumber, 60), legalForm: str(co.legalForm, 80), country: str(co.country, 60),
    register: str(co.register, 160), address: str(co.address, 300), status: str(co.status, 80), incorporated: day(co.incorporated), extractDate: day(co.extractDate),
  } : null;
  return {
    readAt, read: true, unreadable: null,
    kind, kindWords: str(r.kindWords, 120), issuer: str(r.issuer, 120), names,
    dob: day(r.dob), issued: day(r.issued), expires: day(r.expires), date: day(r.date),
    address: str(r.address, 300),
    certified,
    certification: certified && c ? {
      words: str(c.words, 400), name: str(c.name, 120), profession: str(c.profession, 120), firm: str(c.firm, 160), date: day(c.date),
      address: str(c.address, 300), phone: str(c.phone, 40), signed: typeof c.signed === "boolean" ? c.signed : null,
    } : null,
    language,
    english: typeof r.english === "boolean" ? r.english : language ? /^english\b/i.test(language) : null,
    company: company && (company.name || company.registrationNumber) ? company : null,
    directors: list(r.directors).map(d => ({ name: str(d.name, 120) || "", role: str(d.role, 80), born: born(d.born) })).filter(d => d.name).slice(0, 20),
    owners: list(r.owners).map(o => ({ name: str(o.name, 160) || "", person: o.person === true, share: str(o.share, 60), country: str(o.country, 60) })).filter(o => o.name).slice(0, 20),
    signed: typeof r.signed === "boolean" ? r.signed : null,
  };
}

export const unreadableKycDocument = (why: string, readAt: string): KycDocumentReading => ({
  readAt, read: false, unreadable: why, kind: null, kindWords: null, issuer: null, names: [], dob: null, issued: null, expires: null,
  date: null, address: null, certified: false, certification: null,
});

/** The reading as a proof of address reading, for the proof of address rules. */
export function asAddressProofReading(r: KycDocumentReading): AddressProofReading {
  return {
    readAt: r.readAt, read: r.read, unreadable: r.unreadable,
    kind: r.kind && isAddressKind(r.kind) ? r.kind as AddressProofReading["kind"] : r.kind === "driving_licence" ? "driving_licence" : r.read ? "other" : null,
    kindWords: r.kindWords, issuer: r.issuer, names: r.names, date: r.date, expires: r.expires, address: r.address, certified: r.certified,
  };
}

export interface KycDocumentPerson { name: string; dob?: { year?: number | null; month?: number | null } | null }

export interface KycDocumentCheck {
  use: "identity" | "address" | "company" | "authority" | "other";
  // The person on the list it is about, when it names one.
  person: string | null;
  ok: boolean;
  reasons: string[];
  // "Passport, John Smith, expires 12 Mar 2031".
  summary: string;
}

const dobAgrees = (register: KycDocumentPerson["dob"], document: string | null): boolean => {
  if (!register?.year || !document) return true;
  const [year, month] = document.split("-").map(Number);
  if (!year || year !== register.year) return false;
  return !register.month || !month || register.month === month;
};

/**
 * Who may certify a copy (Jack, 23 November 2026: "we will accept -
 * Solicitors, lawyers, or notaries public, Chartered accountants, Bank or
 * building society officials"). Read from the profession the certifier wrote,
 * then their firm. Anyone else is not passed and waits for an officer.
 */
export type CertifierGroup = "legal" | "accountant" | "bank";
export const CERTIFIER_GROUP_WORDS: Record<CertifierGroup, string> = {
  legal: "a solicitor, lawyer or notary public",
  accountant: "a chartered accountant",
  bank: "a bank or building society official",
};
export const ACCEPTED_CERTIFIERS_WORDS = "a solicitor, lawyer or notary public, a chartered accountant, or a bank or building society official";

const LEGAL_RE = /\b(solicitors?|lawyers?|barristers?|attorneys?|advocates?|notary|notaries|notarial|legal executives?|law firm|llp solicitors)\b/i;
const ACCOUNTANT_RE = /\bchartered\b[^.;]{0,24}\baccountants?\b|\b(ACA|FCA|ACCA|FCCA|ICAEW|ICAS)\b/;
const BANK_RE = /\b(bank|banking|building society)\b/i;

export function certifierGroup(profession: string | null | undefined, firm?: string | null): CertifierGroup | null {
  for (const text of [profession || "", firm || ""]) {
    if (!text.trim()) continue;
    if (LEGAL_RE.test(text)) return "legal";
    if (/\bchartered\b[^.;]{0,24}\baccountants?\b/i.test(text) || ACCOUNTANT_RE.test(text)) return "accountant";
    if (BANK_RE.test(text)) return "bank";
  }
  return null;
}

/**
 * Whether the certification on a copy carries what HMRC asks for (AMLG11400):
 * the words that it is a true copy of the original, the certifier's
 * signature, the date, their name, occupation, address and telephone number.
 */
export function certificationGaps(c: KycDocumentReading["certification"]): string[] {
  if (!c) return ["who certified it and when"];
  const gaps: string[] = [];
  if (!c.words || !/true\s+cop(y|ies)|original/i.test(c.words)) gaps.push("the words that it is a true copy of the original");
  if (c.signed === false) gaps.push("the certifier's signature");
  if (!c.name) gaps.push("the certifier's name");
  if (!c.profession && !c.firm) gaps.push("their occupation");
  if (!c.date) gaps.push("the date");
  if (!c.address) gaps.push("their address");
  if (!c.phone) gaps.push("their telephone number");
  return gaps;
}

/** Why the certifier is not one BGP accepts, or null when they are. */
export function certifierRefusal(c: KycDocumentReading["certification"]): string | null {
  if (!c || (!c.profession && !c.firm)) return null; // a gap, said by certificationGaps
  if (certifierGroup(c.profession, c.firm)) return null;
  return `Certified by ${[c.name, c.profession || c.firm].filter(Boolean).join(", ")}: BGP accepts ${ACCEPTED_CERTIFIERS_WORDS}`;
}

/**
 * A document set against the people to check. seenOriginal: an agent saw the
 * original, so a copy needs no certification (BGP's AML policy: "Certified
 * to be a true copy of the original seen by me"). today: for the expiry date.
 */
export function checkKycDocument(
  reading: KycDocumentReading | null, people: KycDocumentPerson[],
  // company: the company a register extract should be about (the company that
  // signs, or the company abroad it was uploaded for).
  opts: { uploadedAt: string; seenOriginal: boolean; today: Date; company?: ExtractSubject | null },
): KycDocumentCheck {
  if (!reading) return { use: "other", person: null, ok: false, reasons: ["Not read yet"], summary: "Not read yet" };
  if (!reading.read) {
    const why = `Could not be read${reading.unreadable ? `: ${reading.unreadable}` : ""}`;
    return { use: "other", person: null, ok: false, reasons: [why], summary: why };
  }
  const kind = reading.kind || "other";
  const what = reading.kindWords || KYC_DOCUMENT_KIND_WORDS[kind];
  const names = reading.names.map(n => n.trim()).filter(Boolean);

  if (isAddressKind(kind)) {
    const address = asAddressProofReading(reading);
    const checks = people.map(p => ({ p, check: checkAddressProof(address, p.name, opts.uploadedAt) }));
    const theirs = people.filter(p => names.some(n => addressNameMatches(n, p.name)));
    const best = checks.find(x => x.check.ok) || checks.find(x => theirs.includes(x.p)) || null;
    if (!best) {
      const summary = [what, dayWords(reading.date), names.length ? `in the name of ${names.join(" and ")}` : null].filter(Boolean).join(", ");
      return { use: "address", person: null, ok: false, reasons: [names.length ? `In the name of ${names.join(" and ")}: not one of the people to check` : "No name found on it"], summary };
    }
    return { use: "address", person: best.p.name, ok: best.check.ok, reasons: best.check.reasons, summary: best.check.summary };
  }

  if (isIdentityKind(kind)) {
    const reasons: string[] = [];
    const named = people.filter(p => names.some(n => addressNameMatches(n, p.name)));
    const matched = named.filter(p => dobAgrees(p.dob, reading.dob));
    const person = matched.length === 1 ? matched[0] : null;
    if (!names.length) reasons.push("No name found on it");
    else if (!named.length) reasons.push(`In the name of ${names.join(" and ")}: not one of the people to check`);
    else if (!matched.length) reasons.push(`The date of birth on it (${dayWords(reading.dob)}) does not match ${personDisplayName(named[0].name)}'s at Companies House`);
    else if (matched.length > 1) reasons.push(`The name matches more than one person to check: ${matched.map(p => personDisplayName(p.name)).join(" and ")}`);
    const expires = isoDay(reading.expires);
    const today = Date.UTC(opts.today.getUTCFullYear(), opts.today.getUTCMonth(), opts.today.getUTCDate(), 12);
    if (expires == null) reasons.push("No expiry date found: check it is in date");
    else if (expires < today - DAY / 2) reasons.push(`It expired on ${dayWords(reading.expires)}`);
    // "An agent saw the originals" was taken off on 27 November 2026 (Jack:
    // "this never happens so remove it"): a copy counts only when certified.
    if (!reading.certified) reasons.push("Not a certified copy");
    else {
      const gaps = certificationGaps(reading.certification);
      if (gaps.length) reasons.push(`The certification does not give ${gaps.join(", ")}`);
      const refused = certifierRefusal(reading.certification);
      if (refused) reasons.push(refused);
    }
    const summary = [what, person ? personDisplayName(person.name) : names[0] || null, reading.expires ? `expires ${dayWords(reading.expires)}` : null,
      reading.certified ? `certified${reading.certification?.name ? ` by ${reading.certification.name}` : ""}` : null]
      .filter(Boolean).join(", ");
    return { use: "identity", person: person ? person.name : null, ok: !reasons.length && !!person, reasons, summary };
  }

  // Our terms of engagement, signed for the client: evidence of the authority
  // to act (HMRC, AMLG11400 14.7: "Legal or contractual documentation"; Woody,
  // 25 November 2026: "make them count"). Unsigned, an officer can accept them.
  if (kind === "terms_of_engagement") {
    const reasons = reading.signed === true ? [] : [reading.signed === false ? "Not signed" : "No signature found on it: check it is signed"];
    const summary = [what, reading.company?.name || names[0] || null, dayWords(reading.date || reading.issued), reading.signed === true ? "signed" : null].filter(Boolean).join(", ");
    return { use: "authority", person: null, ok: !reasons.length, reasons, summary };
  }

  if (kind === "register_extract" && opts.company) {
    const check = checkRegisterExtract(reading, opts.company, { uploadedAt: opts.uploadedAt });
    return { use: "company", person: null, ok: check.ok, reasons: check.reasons, summary: check.summary };
  }
  if ((COMPANY_DOC_KINDS as readonly string[]).includes(kind)) {
    const summary = [what, reading.company?.name || names[0] || null, dayWords(reading.company?.extractDate || reading.date)].filter(Boolean).join(", ");
    return { use: "company", person: null, ok: true, reasons: [], summary };
  }
  return { use: "other", person: null, ok: false, reasons: [], summary: [what, names[0] || null].filter(Boolean).join(", ") };
}

/** An upload as the people to check read it (shared/kyc-people.ts). */
export interface KycUploadEvidence {
  documentId: string;
  fileName: string;
  uploadedAt: string;
  seenOriginal: boolean;
  reading: KycDocumentReading | null;
  // The Nominated Officer or a Deputy accepted it although the reading did not pass.
  accepted: { by: string; at: string; note: string } | null;
  // A register extract uploaded for a company abroad in the ownership, not the party itself.
  about?: ExtractSubject | null;
}

/**
 * What an upload counts for, for one person: their identity, their address,
 * both, or nothing. A photocard driving licence that shows an address
 * verifies both (HMRC, AMLG11400 14.2: the name, photo, date of birth and
 * home address are verified by ID evidence, one document or more; Woody,
 * 25 November 2026: mirror HMRC on proof of address).
 */
export function uploadCountsFor(upload: KycUploadEvidence, person: KycDocumentPerson, today: Date): Array<"identity" | "address"> {
  const check = checkKycDocument(upload.reading, [person], { uploadedAt: upload.uploadedAt, seenOriginal: upload.seenOriginal, today });
  if (!check.person || (check.use !== "identity" && check.use !== "address")) return [];
  if (!check.ok && !upload.accepted) return [];
  if (check.use === "identity" && upload.reading?.kind === "driving_licence" && upload.reading.address) return ["identity", "address"];
  return [check.use];
}

/**
 * Our signed terms of engagement on the party's record, the latest that
 * counts (read as signed, or accepted by an officer): the authority to act of
 * whoever instructs us for the party (25 November 2026).
 */
export function authorityFromTerms(uploads: KycUploadEvidence[], today: Date): { documentId: string; fileName: string; summary: string } | null {
  for (const u of [...uploads].reverse()) {
    if (u.reading?.kind !== "terms_of_engagement") continue;
    const check = checkKycDocument(u.reading, [], { uploadedAt: u.uploadedAt, seenOriginal: u.seenOriginal, today });
    if (check.ok || u.accepted) return { documentId: u.documentId, fileName: u.fileName, summary: check.summary };
  }
  return null;
}

export { termsAuthorityWords } from "./kyc-request";
