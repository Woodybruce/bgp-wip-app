// A deal party's AML state, and when BGP may sign a party off (Woody,
// 18 November 2026: step 2 of docs/deal-page-review-2026-11-18.md, "go ahead
// with your suggestions"). Pure rules; server/deal-gates.ts and
// server/deal-party-aml.ts read the records.
//
// The state of a party with no company that signs is the brand's
// (crm_companies.kyc_*), as it always was. With one set (crm_deals.
// <role>_trading_entity_id, server/deal-parties.ts) it is that company's own
// check: its crm_entity_kyc row (the canonical per-entity KYC record built in
// Delivery 5), or, while it has none, the brand's when the two are the same
// legal company (the same Companies House number, or the company's name is
// the brand's own legal name). A brand the MLRO has rejected blocks whatever
// company is named: a rejection is never stepped round by naming a company.

import { guarantorChecksDenial, type GuarantorChecksState } from "./deal-guarantor";

export interface KycFacts {
  status: string | null; expiresAt: string | Date | null; approvedBy: string | null; approvedAt?: string | Date | null;
  /** The approval was BGP's sign-off on a letting under £10,000 a month: it covers sanctions checks only. */
  scope?: "sanctions_only" | null;
  /** Set when a sanctions-only approval stands but this transaction needs the full checks (applyCheckScope). */
  sanctionsOnly?: { by: string | null; at: string | Date | null; until: string | Date | null } | null;
}

export interface PartyKycInput {
  brand: { id: string; name: string; companiesHouseNumber: string | null; legalName: string | null } & KycFacts;
  company: null | { id: string; name: string; companiesHouseNumber: string | null; kyc: KycFacts | null };
}

export type PartyKycSource = "brand" | "company" | "same_company" | "brand_rejected";

export interface PartyKycState extends KycFacts {
  name: string;               // who the state is about: the company that signs, or the brand
  source: PartyKycSource;
  brandName?: string;         // the party's brand (absent when the brand record was not found)
  brandStatus?: string | null; // the brand's own kyc_status, whatever the state is read from
}

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const nameKey = (v: unknown): string => text(v).toLowerCase()
  .replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ")
  .replace(/\b(limited|ltd)\b/g, "ltd").replace(/\bpublic ltd company\b/g, "plc")
  .replace(/\s+/g, " ").trim();
const chKey = (v: unknown): string => {
  const s = String(v ?? "").replace(/\s+/g, "").toUpperCase();
  return /^\d+$/.test(s) ? s.padStart(8, "0") : s;
};

/** The company that signs is the brand's own legal company. */
export function sameLegalCompany(brand: PartyKycInput["brand"], company: NonNullable<PartyKycInput["company"]>): boolean {
  const a = chKey(brand.companiesHouseNumber), b = chKey(company.companiesHouseNumber);
  if (a && b) return a === b;
  return !!nameKey(brand.legalName) && nameKey(brand.legalName) === nameKey(company.name);
}

// KYC4U are BGP's outsourced KYC provider, not its MLRO (BGP's AML policy,
// Issue 2). Their approvals were stored as "KYC4U (MLRO)" until 21 November
// 2026; a stored row is read as "KYC4U". The KYC history keeps what it said.
export function approverWords(by: string | null | undefined): string | null {
  if (!by) return null;
  return by.trim() === "KYC4U (MLRO)" ? "KYC4U" : by;
}

export function partyKycState(input: PartyKycInput): PartyKycState {
  const { brand, company } = input;
  const brandFacts: KycFacts = { status: brand.status, expiresAt: brand.expiresAt, approvedBy: approverWords(brand.approvedBy), approvedAt: brand.approvedAt ?? null, scope: brand.scope ?? null };
  const about = { brandName: brand.name, brandStatus: brand.status };
  if (!company) return { name: brand.name, source: "brand", ...brandFacts, ...about };
  if (brand.status === "rejected") return { name: brand.name, source: "brand_rejected", ...brandFacts, ...about };
  if (company.kyc) return { name: company.name, source: "company", ...company.kyc, approvedBy: approverWords(company.kyc.approvedBy), ...about };
  if (sameLegalCompany(brand, company)) return { name: company.name, source: "same_company", ...brandFacts, ...about };
  return { name: company.name, source: "company", status: null, expiresAt: null, approvedBy: null, approvedAt: null, ...about };
}

// ── A sign-off for sanctions checks only ────────────────────────────────────
//
// Woody, 23 November 2026, on AG Hondo Brixton Village BV (TPG): "if TPG are a
// client and we are doing lots of work for them is this a good enough check?"
// A sign-off on a letting under £10,000 a month covers the sanctions checks
// that letting needs, and nothing more. An approval is kept on the company
// (or the brand) and read by every transaction with it, so on a transaction
// that needs the full checks (a sale or purchase, a letting at £10,000 a month
// or more) such an approval does not count: the party reads as not yet
// checked, saying why, and is signed off again once the full checks are done.

const MINUTES_APART = 5;
const near = (a: unknown, b: unknown): boolean => {
  const x = new Date(String(a ?? "")).getTime(), y = new Date(String(b ?? "")).getTime();
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= MINUTES_APART * 60_000;
};

/** The company's approval is the sanctions-only sign-off it records (crm_entity_kyc.evidence.bgpSignOff). */
export function entitySignOffScope(input: { regime: unknown; signedOffAt: unknown; approvedAt: unknown }): "sanctions_only" | null {
  return String(input.regime || "") === "sanctions_only" && near(input.signedOffAt, input.approvedAt) ? "sanctions_only" : null;
}

/** The brand's approval is a sanctions-only sign-off: its latest approval line on the KYC history, written with it, says so. */
export function brandSignOffScope(input: { notes: unknown; loggedAt: unknown; checkedAt: unknown }): "sanctions_only" | null {
  return /sanctions checks only/i.test(String(input.notes || "")) && near(input.loggedAt, input.checkedAt) ? "sanctions_only" : null;
}

/** The state as a transaction reads it: on one that needs the full checks a sanctions-only approval is not an approval. */
export function applyCheckScope<T extends KycFacts>(state: T, fullChecks: boolean): T {
  if (!fullChecks || state.status !== "approved" || state.scope !== "sanctions_only") return state;
  return { ...state, status: null, expiresAt: null, approvedBy: null, approvedAt: null,
    sanctionsOnly: { by: state.approvedBy, at: state.approvedAt ?? null, until: state.expiresAt } };
}

export const SANCTIONS_ONLY_APPROVAL_WORDS = "signed off for sanctions checks only: this transaction needs the full checks";

/** Approved and current, else why not ("expired", "no checks run", the status). */
export function kycVerdict(state: KycFacts, now: Date = new Date()): { approved: boolean; reason: string | null } {
  if (state.status !== "approved") return { approved: false, reason: state.sanctionsOnly ? SANCTIONS_ONLY_APPROVAL_WORDS : state.status || "no checks run" };
  if (state.expiresAt && new Date(state.expiresAt) < now) return { approved: false, reason: "expired" };
  return { approved: true, reason: null };
}

// ── BGP sign-off ────────────────────────────────────────────────────────────
//
// Woody, 17 November 2026: "basically we do the normal checks expected and if
// there is a red flag then we get KYC4U". A routine party is signed off for
// the re-check period, on the company that signs when the deal names one.
// Since 19 November 2026 (BGP's AML policy, Issue 2, and Woody's answer) a
// standard or simplified party is signed off by the deal's agents, the
// Nominated Officer or the Deputy; an enhanced one goes to KYC4U and the
// officers record KYC4U's result. Approvals last 3 years, or 1 year for an
// enhanced party (shared/aml-policy.ts).

export const SIGN_OFF_PRECHECK_DAYS = 30;
export const SIGN_OFF_NOTE_MIN = 10;
// Enhanced due diligence done by BGP itself (below): the officer's note says
// what was checked and why the risk is acceptable.
export const IN_HOUSE_EDD_NOTE_MIN = 40;

export interface SignOffFacts {
  rejected: boolean;             // the MLRO or KYC4U rejected the brand or the company that signs
  current: { by: string | null; until: string | null } | null; // already approved and in date
  withKyc4u: boolean;            // raised with KYC4U on this deal and not yet answered
  redFlags: number;              // the party's own red flags
  dealRedFlags: number;          // the deal record's (not tied to one party)
  unchecked: string[];           // records the red flag read could not reach
  higherRisk: boolean;           // the brand's file reads as higher risk (high risk, EDD, a PEP result)
  precheck: { ranAt: string } | null;
  precheckRunning: boolean;
  clientChecksFinished: boolean; // the request to the person acting was finished and every person to check has sent what they owe
  // With the request finished: the people still to send something (19 November 2026).
  clientChecksOutstanding?: string[];
  // A letting under £10,000 a month: sanctions checks only (AML policy A), so
  // the client checks are not needed and no note stands in for them.
  sanctionsOnly?: boolean;
  // Owned through a company registered abroad, in words: it goes to KYC4U
  // (Woody, 21 November 2026: "foreign companies I think we will send to KYC4U").
  ownersAbroad?: string[];
  // Another firm's checks the officers rely on (MLR 2017 reg 39), in words:
  // they stand in for the client checks, so no note is asked for.
  reliance?: string | null;
  // Enhanced due diligence by BGP's officers (always, since KYC4U stopped being
  // used on 23 November 2026; false reads a file as it stood before): the
  // Nominated Officer or a Deputy signs off an enhanced party themselves, with
  // a note of what was checked. A possible sanctions match must be resolved
  // first: no one deals with a designated person.
  inHouseEdd?: boolean;
  sanctionsFlags?: number;
  // Recorded as a trust: checked in-house by the officers, never KYC4U, and
  // signed off only once its structure and documents are complete (Jack,
  // 23 November 2026). trustGaps: what its file still needs.
  trust?: boolean;
  trustGaps?: string[];
  // The guarantors of the party (23 November 2026; HMRC AMLG2300 s18: a
  // guarantor is a party to the tenancy): the party is not signed off until
  // BGP's checks on each have run (shared/deal-guarantor.ts).
  guarantorChecks?: Array<{ name: string; state: GuarantorChecksState }>;
  note: string;
  now?: Date;
}

/** Enhanced due diligence applies: a red flag or factor (the party's or the deal's), a higher-risk file, or owners abroad. */
// A letting under £10,000 a month needs the sanctions checks only, so its party is
// never an enhanced sign-off unless it is a trust (Woody, 23 November 2026).
export const signOffEnhanced = (f: Pick<SignOffFacts, "redFlags" | "dealRedFlags" | "higherRisk" | "ownersAbroad"> & { trust?: boolean; sanctionsOnly?: boolean }): boolean =>
  !(f.sanctionsOnly && !f.trust) && (f.redFlags > 0 || f.dealRedFlags > 0 || f.higherRisk || !!f.ownersAbroad?.length || !!f.trust);

const SANCTIONS_MATCH_DENIAL = "A possible sanctions match stands: check whether it is the person or company, then set it aside with a comment if it is not, or tell the Nominated Officer (an OFSI report and legal advice follow) before going any further.";

/** Done by the officers in-house: their switch is on, or the party is a trust (never KYC4U since 23 November 2026). */
export const signOffInHouse = (f: Pick<SignOffFacts, "inHouseEdd" | "trust">): boolean => !!f.inHouseEdd || !!f.trust;

/** Why BGP may not sign the party off, or null when it may. */
export function signOffDenial(input: SignOffFacts): string | null {
  const f: SignOffFacts = input.trust ? { ...input, inHouseEdd: true } : input;
  const now = f.now ?? new Date();
  if (f.rejected) return "This party was rejected by the Nominated Officer or KYC4U: only the Nominated Officer or the Deputy can clear it.";
  if (f.current) {
    const until = f.current.until ? new Date(f.current.until) : null;
    return `Already approved${f.current.by ? ` by ${f.current.by}` : ""}${until && !isNaN(until.getTime()) ? ` until ${until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })}` : ""}.`;
  }
  if (f.unchecked.length) return `Red flags could not be checked against ${f.unchecked.join(", ")}. Try again in a moment.`;
  // A letting under £10,000 a month (Woody, 23 November 2026: "we have a sanctions
  // only version for AML'S which is much simpler so not to confuse everyone"): the
  // sanctions checks are all it needs, so only a possible sanctions match holds the
  // sign-off and an agent on the transaction signs it off. Other findings are for
  // information. A trust keeps its own rules.
  if (f.sanctionsOnly && !f.trust) {
    if ((f.sanctionsFlags || 0) > 0) return SANCTIONS_MATCH_DENIAL;
    if (f.precheckRunning) return "The sanctions checks are still running. Sign off once they finish.";
    if (!f.precheck) return "The sanctions checks have not run for this party. Press Run again first.";
    if (now.getTime() - Date.parse(f.precheck.ranAt) > SIGN_OFF_PRECHECK_DAYS * 86400000) return `The sanctions checks are more than ${SIGN_OFF_PRECHECK_DAYS} days old. Press Run again first.`;
    return guarantorChecksDenial(f.guarantorChecks);
  }
  // With the officers doing enhanced checks in-house, an open KYC4U request
  // no longer holds the party (Woody, 22 November 2026: "I dont actually think
  // KYC4U is doing anything we cant").
  // KYC4U is no longer used (Woody, 23 November 2026): enhanced due diligence
  // is the officers' own unless a caller reads a file as it stood before.
  if (f.withKyc4u && f.inHouseEdd === false) return "This party was raised with KYC4U on this transaction: add KYC4U's result when it comes back.";
  const edd = signOffEnhanced(f) && f.inHouseEdd !== false;
  if (edd && (f.sanctionsFlags || 0) > 0) return SANCTIONS_MATCH_DENIAL;
  if (edd) {
    // Enhanced due diligence by BGP: the same freshness rules, then the officer's note.
    if (f.precheckRunning) return "BGP's checks before asking are still running. Sign off once they finish.";
    if (!f.precheck) return "BGP's checks before asking have not run for this party. Press Run again on the card first.";
    if (now.getTime() - Date.parse(f.precheck.ranAt) > SIGN_OFF_PRECHECK_DAYS * 86400000) return `BGP's checks before asking are more than ${SIGN_OFF_PRECHECK_DAYS} days old. Press Run again on the card first.`;
    const guarantorEdd = guarantorChecksDenial(f.guarantorChecks);
    if (guarantorEdd) return guarantorEdd;
    if (f.trust && f.trustGaps?.length) return `The trust's file is not complete: ${f.trustGaps.map(g => g.replace(/\.$/, "")).join("; ")}.`;
    if (f.trust && f.clientChecksOutstanding?.length) return `The trust's people still owe their checks: ${f.clientChecksOutstanding.join("; ")}.`;
    if (text(f.note).length < IN_HOUSE_EDD_NOTE_MIN) return "Enhanced due diligence by BGP: say what was checked and why the risk is acceptable (each red flag or factor, the source of funds and of wealth where it matters, who is behind any company abroad or trust): at least a couple of sentences.";
    return null;
  }
  if (f.redFlags > 0) return "This party needs enhanced due diligence (a red flag or a higher-risk factor in the AML policy): raise it with KYC4U; the Nominated Officer or the Deputy adds KYC4U's result.";
  if (f.dealRedFlags > 0) return "The transaction needs enhanced due diligence (a red flag or a higher-risk factor on the transaction record): raise it with KYC4U; the Nominated Officer or the Deputy adds KYC4U's result.";
  if (f.higherRisk) return "This is a higher-risk file (high risk, enhanced due diligence or a public role): it goes to KYC4U.";
  if (f.ownersAbroad?.length) return `Owned through a company registered abroad (${f.ownersAbroad.join(", ")}): it goes to KYC4U, who find the people behind it; the Nominated Officer or a Deputy adds KYC4U's result.`;
  if (f.precheckRunning) return "BGP's checks before asking are still running. Sign off once they finish.";
  if (!f.precheck) return "BGP's checks before asking have not run for this party. Press Run again on the card first.";
  if (now.getTime() - Date.parse(f.precheck.ranAt) > SIGN_OFF_PRECHECK_DAYS * 86400000) {
    return `BGP's checks before asking are more than ${SIGN_OFF_PRECHECK_DAYS} days old. Press Run again on the card first.`;
  }
  const guarantor = guarantorChecksDenial(f.guarantorChecks);
  if (guarantor) return guarantor;
  if (!f.clientChecksFinished && !f.sanctionsOnly && !f.reliance && text(f.note).length < SIGN_OFF_NOTE_MIN) {
    return f.clientChecksOutstanding?.length
      ? `The client checks are not finished for this party (still to come: ${f.clientChecksOutstanding.join("; ")}): say what you relied on instead (at least a sentence).`
      : "The client checks are not finished for this party: say what you relied on instead (at least a sentence).";
  }
  return null;
}

// ── KYC4U's result, added by hand ───────────────────────────────────────────

// The status written on the request row is the label: the KYC4U mirror reads
// it with kyc4uVerdict (server/kyc4u.ts) as approved, rejected or with KYC4U.
export const KYC4U_RESULTS = {
  approved: "Approved",
  rejected: "Rejected",
  more_info: "More information needed",
} as const;
export type Kyc4uResultKey = keyof typeof KYC4U_RESULTS;
export const isKyc4uResultKey = (v: unknown): v is Kyc4uResultKey => typeof v === "string" && Object.prototype.hasOwnProperty.call(KYC4U_RESULTS, v);

// Since 21 November 2026 KYC4U's whole pack can be added at once: a zip (up
// to 100MB, opened on the server) or many files; each file 25MB at most
// (shared/kyc4u-result-pack.ts).
export const KYC4U_RESULT_MAX_FILES = 40;
export const KYC4U_RESULT_MAX_BYTES = 25 * 1024 * 1024;

/** A KYC4U result's date: yyyy-mm-dd, not in the future, not before 2015; else null. */
export function kyc4uResultDate(v: unknown, now: Date = new Date()): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  if (isNaN(d.getTime()) || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  if (d.getTime() > now.getTime() + 36 * 3600000 || d.getUTCFullYear() < 2015) return null;
  return d;
}
