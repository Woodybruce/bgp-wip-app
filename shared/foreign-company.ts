// A company registered outside the UK as the company that signs, and the
// extract from its own register that HMRC says BGP must hold for it (Woody,
// 23 November 2026: Creditsafe said no and there is no Dun & Bradstreet, so
// "No external ... to all happen in the app including translation"). HMRC,
// AMLG11400 14.6: "For a non-UK based company, you must obtain an excerpt of
// the register kept under the law to which that business is subject as proof
// of the customers registration." The extract is read in the app
// (server/kyc-documents.ts) and checked here: it is about this company, it is
// recent, and the register does not show the company closed. Pure rules.
import type { KycDocumentReading } from "./kyc-documents";
import { foreignOnCompaniesHouse, overseasNameKey, ownerRegister } from "./kyc-prechecks";

export { foreignOnCompaniesHouse };

// How old an extract may be when it is uploaded (three months, the age a proof
// of address may be).
export const REGISTER_EXTRACT_MAX_DAYS = 92;

export interface AbroadCompany {
  name: string;
  country: string;
  registrationNumber: string | null;
  registerUrl: string | null;
}

const oneLine = (v: unknown, max: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** A link to the company's entry on its own register: https only. */
export function registerLink(v: unknown): string | null {
  const s = oneLine(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A company registered abroad typed as the one that signs, or why not. */
export function abroadCompanyInput(body: unknown): { brandId: string; abroad: AbroadCompany } | { problem: string } {
  const b: Record<string, unknown> = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const a: Record<string, unknown> = b.abroad && typeof b.abroad === "object" && !Array.isArray(b.abroad) ? (b.abroad as Record<string, unknown>) : {};
  const brandId = typeof b.brandId === "string" ? b.brandId.trim() : "";
  if (!brandId || brandId.length > 200) return { problem: "Pick the landlord or brand first." };
  const name = oneLine(a.name, 160);
  if (name.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return { problem: "Give the company's name as its register shows it." };
  const country = oneLine(a.country, 60);
  if (country.replace(/[^\p{L}]/gu, "").length < 2) return { problem: "Which country is it registered in?" };
  if (ownerRegister(country) === "uk") return { problem: "A company registered in the UK: find it at Companies House instead." };
  const registrationNumber = oneLine(a.registrationNumber, 60) || null;
  if (registrationNumber && !/^[\p{L}\p{N}][\p{L}\p{N} .\-/]*$/u.test(registrationNumber)) return { problem: "The registration number has characters a register number does not." };
  const rawLink = oneLine(a.registerUrl, 500);
  const registerUrl = registerLink(rawLink);
  if (rawLink && !registerUrl) return { problem: "The register link must be a web address starting https://." };
  return { brandId, abroad: { name, country, registrationNumber, registerUrl } };
}

/** A register number as one key: "HRB 12345" is "HRB12345", "B 123.456" is "B123456". */
export const registrationNumberKey = (v: unknown): string => String(v ?? "").toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");

export interface ExtractSubject { name: string; registrationNumber?: string | null; country?: string | null }

export interface RegisterExtractCheck {
  ok: boolean;
  reasons: string[];
  // True when the extract is about this company (by its name or its number).
  sameCompany: boolean;
  // The date it was issued, as read (yyyy-mm-dd).
  dated: string | null;
  summary: string;
}

const DAY = 86_400_000;
const isoDay = (s: string | null | undefined): number | null => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T12:00:00Z`);
  return Number.isFinite(t) ? t : null;
};
const dayWords = (s: string | null | undefined): string | null => {
  const t = isoDay(s);
  return t == null ? null : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

// A register's words for a company that is gone or going, in English (the
// reader records the status in English).
const CLOSED_STATUS = /\b(dissolved|struck off|deregistered|de-registered|removed|liquidat\w*|wound up|winding up|bankrupt\w*|insolven\w*|ceased|closed|cancelled|deleted|inactive|in administration|receivership)\b/i;

/** Whether the company is shown as gone or going (dissolved, in liquidation and the like). */
export const registerStatusClosed = (status: string | null | undefined): boolean => CLOSED_STATUS.test(String(status || ""));

/**
 * An extract from a company's own register set against the company it should
 * be about: the same company (its name, its legal form aside, or its
 * registration number), dated within three months of being uploaded, and not
 * shown as dissolved or in liquidation.
 */
export function checkRegisterExtract(reading: KycDocumentReading | null, subject: ExtractSubject, opts: { uploadedAt: string }): RegisterExtractCheck {
  if (!reading) return { ok: false, reasons: ["Not read yet"], sameCompany: false, dated: null, summary: "Not read yet" };
  if (!reading.read) {
    const why = `Could not be read${reading.unreadable ? `: ${reading.unreadable}` : ""}`;
    return { ok: false, reasons: [why], sameCompany: false, dated: null, summary: why };
  }
  const c = reading.company || null;
  const shownName = oneLine(c?.name || reading.names[0] || "", 160);
  const shownNumber = oneLine(c?.registrationNumber || "", 60);
  const reasons: string[] = [];
  const byName = !!shownName && !!overseasNameKey(shownName) && overseasNameKey(shownName) === overseasNameKey(subject.name);
  const byNumber = !!shownNumber && !!subject.registrationNumber && registrationNumberKey(shownNumber) === registrationNumberKey(subject.registrationNumber);
  const numbersDiffer = !!shownNumber && !!subject.registrationNumber && !byNumber;
  const same = (byName || byNumber) && !numbersDiffer;
  if (!shownName && !shownNumber) reasons.push("No company name or number found on it");
  else if (numbersDiffer) reasons.push(`Its registration number is ${shownNumber}, not ${subject.registrationNumber}: check it is the same company`);
  else if (!same) reasons.push(`It is about ${shownName || `company ${shownNumber}`}, not ${subject.name}`);
  const dated = c?.extractDate || reading.date || reading.issued || null;
  const t = isoDay(dated);
  const up = Date.parse(opts.uploadedAt);
  if (t == null) reasons.push("No date found on it: check it was issued in the last three months");
  else if (Number.isFinite(up) && t > up + DAY) reasons.push(`Dated ${dayWords(dated)}, after it was uploaded: check the date`);
  else if (Number.isFinite(up) && up - t > REGISTER_EXTRACT_MAX_DAYS * DAY) reasons.push(`Dated ${dayWords(dated)}: more than three months old. Ask for a new one`);
  if (registerStatusClosed(c?.status)) reasons.push(`The register shows it as ${oneLine(c?.status, 80).toLowerCase()}`);
  const directors = reading.directors?.length || 0;
  const owners = reading.owners?.length || 0;
  const summary = [
    reading.kindWords || "Register extract",
    shownName || null,
    shownNumber || null,
    dated ? `dated ${dayWords(dated)}` : null,
    reading.language && reading.english === false ? `in ${reading.language}` : null,
    directors ? `${directors} director${directors === 1 ? "" : "s"}` : null,
    owners ? `${owners} owner${owners === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(", ");
  return { ok: !reasons.length, reasons, sameCompany: same, dated, summary };
}

/**
 * Whether a party needs its own register's extract: a company (not a person,
 * a trust or a public body) registered outside the UK, on a transaction that
 * needs the full checks.
 */
export function needsRegisterExtract(input: {
  kind: "company" | "individual" | "trust" | "public_body";
  // The country the company that signs was recorded with, when typed.
  country?: string | null;
  // The UK record BGP's checks read: a Companies House number, an overseas
  // entity number (OE...) or a UK establishment's (FC..., SF..., NF...), and
  // whether BGP's checks read it as a company abroad with no UK record.
  ukNumber?: string | null;
  abroadParty?: boolean;
  // Companies House holds its home register (a company incorporated abroad).
  homeAbroad?: boolean;
  sanctionsOnly?: boolean;
}): boolean {
  if (input.kind !== "company" || input.sanctionsOnly) return false;
  // On Companies House but incorporated abroad (Woody, 23 November 2026: "a
  // lot of companies that own property in the uk are on companies house but
  // are also foreign"): still its home register's extract.
  if (input.ukNumber && foreignOnCompaniesHouse(input.ukNumber)) return true;
  if (input.homeAbroad) return true;
  if (input.country && ownerRegister(input.country) === "abroad") return true;
  return !input.ukNumber && !!input.abroadParty;
}
