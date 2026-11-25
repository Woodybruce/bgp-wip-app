// A proof of address is read and set against the person it is for (Woody,
// 20 November 2026: "with the proof of address is the app checking its
// actually for that person and acceptable? linking it from a name
// perspective?"). Until then a file sent on someone's own link, on the proof
// of address step, counted as theirs whatever it said. Pure rules: the reader
// is server/kyc-address-proof.ts, the people to check read the verdict
// (shared/kyc-people.ts), and the deal card shows it.
import { personDisplayName, personNamesMatch, sameToken } from "./kyc-prechecks";

// What BGP's AML policy (Issue 2, "Individuals") and the client checks page
// accept as a proof of residential address. A photocard driving licence is
// identity only.
export const ADDRESS_PROOF_KINDS = ["utility_bill", "bank_statement", "building_society_statement", "mortgage_statement", "council_tax_bill"] as const;
export type AddressProofKind = (typeof ADDRESS_PROOF_KINDS)[number];
export type AddressProofReadKind = AddressProofKind | "driving_licence" | "other";

export const ADDRESS_PROOF_KIND_WORDS: Record<AddressProofReadKind, string> = {
  utility_bill: "Utility bill",
  bank_statement: "Bank statement",
  building_society_statement: "Building society statement",
  mortgage_statement: "Mortgage statement",
  council_tax_bill: "Council tax bill",
  driving_licence: "Driving licence",
  other: "Another document",
};

// "Dated in the last three months" (the client checks page); a council tax
// bill is "this year's" (the policy's local authority tax demand), so it
// counts for the council tax year it was sent in: up to 13 months.
export const ADDRESS_PROOF_MAX_AGE_DAYS = 92;
export const COUNCIL_TAX_MAX_AGE_DAYS = 396;

export interface AddressProofReading {
  readAt: string;
  // The reader could read the file. When not, why (an empty file, a format it
  // cannot open, the reader switched off or out of today's allowance).
  read: boolean;
  unreadable: string | null;
  kind: AddressProofReadKind | null;
  // What the document says it is, in its own words ("British Gas electricity bill").
  kindWords: string | null;
  issuer: string | null;
  // The names the document is addressed to.
  names: string[];
  // The date the document is dated (yyyy-mm-dd).
  date: string | null;
  address: string | null;
  // A copy certified as a true copy (for someone living outside the UK).
  certified: boolean | null;
}

// The Nominated Officer or a Deputy accepting a proof the reading did not pass.
export interface AddressProofAcceptance { by: string; at: string; note: string }

export interface AddressProofCheck {
  ok: boolean;
  // Why it does not count yet, in plain words.
  reasons: string[];
  // "British Gas electricity bill, 12 Oct 2026, in the name of Huseyn Mirhadiyev".
  summary: string;
}

export const ADDRESS_PROOF_ACCEPT_NOTE_MIN = 10;

const DAY = 86_400_000;
const isoDay = (s: string | null | undefined): number | null => {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const t = Date.parse(`${s.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(t) ? t : null;
};
export const addressProofDateWords = (s: string | null | undefined): string | null => {
  const t = isoDay(s);
  return t == null ? null : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

// Tokens that keep initials ("MR H MIRHADIYEV" is "h mirhadiyev").
const TITLE = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "sir", "dame", "lord", "lady", "prof", "professor", "rev", "revd", "hon", "the", "messrs"]);
function rawTokens(name: string): string[] {
  return personDisplayName(name).toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(t => t && !TITLE.has(t));
}

/**
 * Whether a name on a document is the person's: the register's way first
 * (every word of one name in the other), else the same surname with each
 * forename or initial on the document one of the person's ("MR H
 * MIRHADIYEV" for Huseyn Mirhadiyev). A surname alone is not enough.
 */
export function addressNameMatches(onDocument: string, person: string): boolean {
  if (!onDocument.trim() || !person.trim()) return false;
  if (personNamesMatch(onDocument, person) || personNamesMatch(personDisplayName(onDocument), personDisplayName(person))) return true;
  const doc = rawTokens(onDocument), who = rawTokens(person);
  if (doc.length < 2 || who.length < 2) return false;
  if (!sameToken(doc[doc.length - 1], who[who.length - 1])) return false;
  const forenames = who.slice(0, -1);
  return doc.slice(0, -1).every(t => t.length === 1 ? forenames.some(f => f[0] === t) : forenames.some(f => sameToken(f, t)));
}

/**
 * The verdict on a proof of address for a person: their name on it, dated
 * within the policy's window before it was sent, and a kind the policy
 * accepts. Anything else, or a file that could not be read, is for the
 * Nominated Officer or a Deputy to look at.
 */
export function checkAddressProof(reading: AddressProofReading | null, person: string, sentAt: string): AddressProofCheck {
  if (!reading) return { ok: false, reasons: ["Not read yet"], summary: "Not read yet" };
  if (!reading.read) {
    const why = `Could not be read${reading.unreadable ? `: ${reading.unreadable}` : ""}`;
    return { ok: false, reasons: [why], summary: why };
  }
  const reasons: string[] = [];
  const kind = reading.kind || "other";
  if (kind === "driving_licence") reasons.push("A driving licence proves identity, not address (BGP's AML policy)");
  else if (!(ADDRESS_PROOF_KINDS as readonly string[]).includes(kind)) reasons.push(`Not one of the documents the policy accepts${reading.kindWords ? ` (${reading.kindWords})` : ""}`);

  const names = reading.names.map(n => n.trim()).filter(Boolean);
  const theirs = names.filter(n => addressNameMatches(n, person));
  if (!names.length) reasons.push("No name found on it");
  else if (!theirs.length) reasons.push(`In the name of ${names.join(" and ")}, not ${personDisplayName(person)}`);

  const dated = isoDay(reading.date), sent = isoDay(sentAt) ?? Date.parse(sentAt);
  if (dated == null) reasons.push("No date found on it");
  else if (Number.isFinite(sent)) {
    const age = Math.floor((sent - dated) / DAY);
    const max = kind === "council_tax_bill" ? COUNCIL_TAX_MAX_AGE_DAYS : ADDRESS_PROOF_MAX_AGE_DAYS;
    if (age < -1) reasons.push(`Dated ${addressProofDateWords(reading.date)}, after it was sent`);
    else if (age > max) reasons.push(`Dated ${addressProofDateWords(reading.date)}, more than ${kind === "council_tax_bill" ? "a year" : "three months"} before it was sent`);
  }

  const what = reading.kindWords || ADDRESS_PROOF_KIND_WORDS[kind];
  const summary = [what, addressProofDateWords(reading.date), names.length ? `in the name of ${(theirs[0] || names[0])}` : null].filter(Boolean).join(", ");
  return { ok: reasons.length === 0, reasons, summary };
}

/**
 * The day a proof of address stops being in date (yyyy-mm-dd): three months
 * from the date on it, a year for a council tax bill (Woody, 25 November
 * 2026: "proof of address should have an expiry flag so can't be used but
 * should be if possible"). Null when the reading has no date.
 */
export function addressProofExpiry(reading: AddressProofReading | null): string | null {
  const dated = isoDay(reading?.date);
  if (dated == null) return null;
  const max = reading?.kind === "council_tax_bill" ? COUNCIL_TAX_MAX_AGE_DAYS : ADDRESS_PROOF_MAX_AGE_DAYS;
  return new Date(dated + max * DAY).toISOString().slice(0, 10);
}

/** A reader's answer made safe: only the fields named, each the right type. */
export function cleanAddressProofReading(raw: unknown, readAt: string): AddressProofReading {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max = 300): string | null => typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;
  const kinds: readonly string[] = [...ADDRESS_PROOF_KINDS, "driving_licence", "other"];
  const kind = typeof r.kind === "string" && kinds.includes(r.kind) ? r.kind as AddressProofReadKind : null;
  const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && isoDay(r.date) != null ? r.date : null;
  const names = Array.isArray(r.names) ? r.names.map(n => str(n, 120)).filter((n): n is string => !!n).slice(0, 4) : [];
  return {
    readAt, read: true, unreadable: null,
    kind, kindWords: str(r.kindWords, 120), issuer: str(r.issuer, 120), names, date,
    address: str(r.address, 300), certified: typeof r.certified === "boolean" ? r.certified : null,
  };
}

export const unreadableAddressProof = (why: string, readAt: string): AddressProofReading => ({
  readAt, read: false, unreadable: why, kind: null, kindWords: null, issuer: null, names: [], date: null, address: null, certified: null,
});
