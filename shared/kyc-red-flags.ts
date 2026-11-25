// Red flags: what in BGP's own checks sends a party to KYC4U. Woody,
// 17 November 2026: "basically we do the normal checks expected and if there
// is a red flag then we get KYC4U", then "yes build the red flag handoff to
// KYC4U". Every flag is read from a record the app already holds; nothing
// here decides anything. The agent raises the party with KYC4U, BGP's
// outsourced KYC provider, and the Nominated Officer or the Deputy records
// KYC4U's result (BGP's AML policy, Issue 2).
//
// Not a flag on purpose: the MLRO's rejection (it already blocks the deal)
// and a client who has not replied (chase them). Adverse media is a flag
// since 17 November 2026, from BGP's checks before asking, where a web
// search finds it with a source to check (shared/kyc-prechecks.ts).

import type { KycAnswers, KycOwnersReply } from "./kyc-request";
import { flagKeyPart, precheckRedFlags, type KycPrecheckResult } from "./kyc-prechecks";
import { policyFactorFlags } from "./aml-policy";

export type KycRedFlagKind =
  | "client_pep"
  | "id_declined"
  | "screening"
  | "sanctions"
  | "high_risk"
  | "edd"
  | "sof_mismatch"
  // From BGP's checks before asking (shared/kyc-prechecks.ts).
  | "provider_screen"
  | "web_pep"
  | "web_adverse"
  | "company_status"
  | "insolvency"
  | "disqualified"
  | "ownership_unclear"
  | "offshore_owner"
  // The client says the owners Companies House lists are not right.
  | "owners_differ"
  // Higher-risk factors BGP's AML policy and risk assessment name (Issue 2,
  // 19 November 2026; shared/aml-policy.ts).
  | "policy_trust"
  | "policy_pooled"
  | "policy_country"
  | "policy_cbi"
  | "policy_sector"
  | "super_prime"
  // An overseas-looking company with no Overseas Entity ID found on the
  // Register of Overseas Entities (19 November 2026).
  | "overseas_entity_missing"
  // A third party pays BGP's invoice with no clear relationship to the client
  // (20 November 2026; shared/deal-billing.ts).
  | "third_party_payer"
  // The Charity Commission's register: removed, insolvent, in administration
  // or a dissolved CIO (21 November 2026; shared/charity-register.ts).
  | "charity_status";

/** A possible sanctions match: on the UK, US or EU lists, declared on the Register of Overseas Entities, or a ComplyAdvantage sanctions profile. */
export const isSanctionsFlag = (f: Pick<KycRedFlag, "kind" | "evidence">): boolean =>
  f.kind === "sanctions" || (f.kind === "provider_screen" && (f.evidence || []).includes("type:sanctions"));

// One line of what is behind a flag (Woody, 19 November 2026: "We also need
// to see the detail of the red flag").
export interface KycFlagFact { label: string; value: string; url?: string | null }

export interface KycRedFlag {
  kind: KycRedFlagKind;
  // One line, in plain words.
  label: string;
  // The record's own words, where they help (the client's detail, the reason
  // enhanced due diligence was marked).
  detail: string | null;
  // Where the flag was read.
  source: string;
  at: string | null;
  // What the flag is about, the same from one check to the next (the subject
  // and the kind of finding), and the evidence behind it (a list entry, a
  // web address, a ComplyAdvantage profile, a status). Setting a flag aside
  // covers that evidence only: new evidence raises it again.
  key: string;
  evidence: string[];
  facts?: KycFlagFact[];
  // A higher-risk factor the AML policy names (a trust, a high-risk country,
  // a sector, a super-prime sale), not a finding about the party. It counts
  // as a red flag does (enhanced due diligence); the screens list it apart.
  factor?: boolean;
  // A ComplyAdvantage match an officer has confirmed is the person (25 November 2026).
  confirmed?: boolean;
}

/**
 * A ComplyAdvantage match (other than a sanctions list) is a possible match
 * to check, not a finding (Woody, 25 November 2026: "everything is enhanced
 * because of all the red flags from comply"). HMRC asks for enhanced due
 * diligence for a politically exposed person, not a namesake: the match makes
 * a party enhanced only once an officer confirms it is the person. It still
 * waits for a decision before sign-off: confirm it, or set it aside.
 */
export function flagToConfirm(f: Pick<KycRedFlag, "kind" | "evidence" | "confirmed"> & { factor?: boolean }): boolean {
  return f.kind === "provider_screen" && !f.factor && !f.confirmed && !(f.evidence || []).some(e => /^type:sanction/.test(e));
}

// ── Setting a flag aside ────────────────────────────────────────────────────
//
// Woody, 19 November 2026: "have the option to ignore with a comment as
// comply advantage is picking up things that are not really a massive
// problem". The MLRO (admins until one is appointed) sets a flag aside with
// a comment; it stays on the record, listed with who set it aside, when and
// why, and no longer counts as a red flag anywhere (KYC4U's note, Kick off
// AML, the sign-off, the AML dashboard). A flag with evidence the review did
// not see is a new flag.

export const FLAG_REVIEW_COMMENT_MIN = 10;

export interface KycFlagReview {
  id: number;
  flagKey: string;
  evidence: string[];
  comment: string;
  by: string | null;
  at: string | null;
  // An officer confirmed the match is the person: the flag stays and counts.
  confirmed?: boolean;
}

export interface SetAsideFlag { flag: KycRedFlag; review: KycFlagReview }

/** Splits flags into the ones that count and the ones a review set aside. */
export function applyFlagReviews(flags: KycRedFlag[], reviews: KycFlagReview[]): { live: KycRedFlag[]; setAside: SetAsideFlag[] } {
  const live: KycRedFlag[] = [];
  const setAside: SetAsideFlag[] = [];
  for (const flag of flags) {
    const review = reviews.find(r => r.flagKey === flag.key && flag.evidence.every(e => r.evidence.includes(e)));
    if (review?.confirmed) live.push({ ...flag, confirmed: true });
    else if (review) setAside.push({ flag, review });
    else live.push(flag);
  }
  return { live, setAside };
}

/** The words of a comment a person gives for setting a flag aside, or why it will not do. */
export function flagReviewComment(raw: unknown): { comment: string } | { problem: string } {
  const comment = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (comment.length < FLAG_REVIEW_COMMENT_MIN) return { problem: `Say why it is not a concern (at least ${FLAG_REVIEW_COMMENT_MIN} characters): the comment is kept on the KYC record.` };
  return { comment };
}

const keyPart = flagKeyPart;

export interface PartyRedFlagFacts {
  company: {
    aml_pep_status?: string | null;
    aml_risk_level?: string | null;
    aml_edd_required?: boolean | null;
    aml_edd_reason?: string | null;
    // BGP's type for the brand and the kind of subject: the policy's sector
    // and trust factors read them.
    company_type?: string | null;
    aml_subject_type?: string | null;
  } | null;
  // The party's latest screening record only: a later clear one clears it.
  // precheck: that record is BGP's checks before asking, whose own lines say
  // who matched (so the general line is not added as well).
  latestInvestigation: { sanctions_match: boolean | null; conducted_at: string | Date | null; precheck?: boolean } | null;
  // The party's latest checks before asking, and whether they are its latest
  // screening (a later screening replaces their sanctions lines).
  precheck?: { result: KycPrecheckResult; current: boolean } | null;
  // The client checks sent on this deal to this party (tests left out).
  // person: the name on a person's own request (19 November 2026).
  requests: Array<{ ref: string; answers?: KycAnswers | null; ownersAnswer?: KycOwnersReply | null; person?: string | null }>;
  // The party's identity checks.
  idChecks: Array<{ status: string | null; decision_reason?: string | null; received_at?: string | Date | null; name?: string | null }>;
  // The KYC record's own history about its risk, PEP and enhanced due
  // diligence fields (the KYC audit lines), newest first: the facts behind
  // a flag read from the record.
  recordHistory?: Array<{ at: string | null; what: string; who: string | null; action?: string | null }>;
}

export interface DealRedFlagFacts {
  aml_pep_status?: string | null;
  aml_risk_level?: string | null;
  aml_edd_required?: boolean | null;
  aml_edd_reason?: string | null;
  aml_edd_completed_at?: string | Date | null;
  aml_sof_analysis?: { items?: Array<{ documentType?: string | null; declaredSourceMatchesDocument?: boolean | null; generatedAt?: string | null }> } | null;
  // For the super-prime factor: the deal's type, teams, price and the
  // property's postcode.
  deal_type?: string | null;
  team?: string[] | string | null;
  pricing?: number | string | null;
  postcode?: string | null;
}

const iso = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const words = (value: unknown): string | null => {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 300) : null;
};
const highRisk = (level: string | null | undefined) => /^(high|critical)$/i.test(String(level || "").trim());
const riskLabel = (level: string) => `Risk rated ${String(level).trim().toLowerCase()}`;
const EDD_REASONS: Record<string, string> = {
  pep: "a politically exposed person",
  high_risk_country: "a high-risk country",
  super_prime: "a super-prime deal",
  complex_structure: "a complex ownership structure",
  suspicious: "something suspicious",
};
const eddReason = (reason: string | null | undefined): string | null => {
  const r = String(reason || "").trim();
  if (!r) return null;
  if (EDD_REASONS[r]) return `Reason: ${EDD_REASONS[r]}`;
  // Several reasons saved together ("super_prime,pep"): each in words, never a
  // super-prime price, which is weighed and is no reason by itself.
  const keys = r.split(",").map(k => k.trim()).filter(k => k && k !== "super_prime");
  return keys.length && keys.every(k => EDD_REASONS[k]) ? `Reason: ${keys.map(k => EDD_REASONS[k]).join(", ")}` : words(r);
};

// The transaction save marked every sale or purchase priced at £1m or more
// (£5m with "london" in its name) for enhanced due diligence, with the reason
// super_prime, until 24 November 2026. A super-prime price is weighed on each
// party, never a red flag by itself (risk assessment Issue 3), so a mark with
// no other reason is no flag (marks already saved on live included).
export function eddMarkIsSuperPrimeOnly(reason: string | null | undefined): boolean {
  const keys = String(reason || "").split(",").map(k => k.trim()).filter(Boolean);
  return keys.length > 0 && keys.every(k => k === "super_prime");
}

// aml_pep_status as the screening and the MLRO write it: review_required
// (screening found a possible PEP or sanctions match), pep / pep_* (a PEP),
// rca (a relative or close associate). The same reading as the KYC form's
// risk (server/aml-cdd-form.ts).
export function pepStatusLabel(status: string | null | undefined): string | null {
  const s = String(status || "").trim().toLowerCase();
  if (!s || s === "clear") return null;
  if (s === "review_required") return "Screening found a possible PEP or sanctions match to review";
  if (s === "rca" || s === "pep_associate") return "Recorded as a close associate of a politically exposed person";
  if (s === "pep_family") return "Recorded as a family member of a politically exposed person";
  if (s === "pep_domestic") return "Recorded as a UK politically exposed person";
  if (s === "pep_foreign") return "Recorded as a politically exposed person outside the UK";
  if (s.startsWith("pep")) return "Recorded as a politically exposed person";
  return null;
}

// The in-app screening wrote the record by itself until it was switched off
// in October 2026 (server/kyc-orchestrator.ts, evaluateAutoEdd in
// server/aml-ai.ts): its enhanced due diligence mark (an "edd_triggered" line
// by "automatic", with its reason), its PEP review status (only it wrote
// review_required), its risk rating (Clouseau's score; a person's change
// writes "risk=" on the history) and its sanctions matches. None of them is a
// red flag (Woody, 24 November 2026: "Only sign off counts remove the old
// bit. The result are in the app"): they stay in the record's KYC history,
// and only a sign-off decides a party. A mark a person set still counts.
const IN_APP_SCREENING_OFF = "2026-11-01";
const OLD_SCREENING_WHO = /^(?:automatic|system|auto|the system)$/i;
const beforeOff = (at: string | null | undefined) => !at || at.slice(0, 10) < IN_APP_SCREENING_OFF;
const byOldScreening = (h: { at: string | null; who: string | null }) => OLD_SCREENING_WHO.test(String(h.who || "").trim()) && beforeOff(h.at);

/** A reason for enhanced due diligence in the old screening's own words (evaluateAutoEdd's sentences). */
export function oldScreeningEddReason(reason: unknown): boolean {
  const r = String(reason ?? "").replace(/\s+/g, " ").trim();
  return /^(Sanctions screening returned a match|PEP \/ Relative or Close Associate|Adverse media identified during AI sweep|UBO chain touches (high|medium)-risk jurisdiction|Transaction value over £1m|UBO chain \d+ levels deep|Overall risk assessed as high \(score)/i.test(r);
}

/**
 * Which of the record's AML fields the old in-app screening wrote by itself.
 * The latest history line about a field decides who set it; a field a person
 * set (the MLRO form's "edd=", "pep=" or "risk=" line) is theirs.
 */
export function oldScreeningMarks(facts: Pick<PartyRedFlagFacts, "company" | "recordHistory" | "latestInvestigation">): { edd: boolean; pep: boolean; risk: boolean; sanctions: boolean } {
  const history = facts.recordHistory || [];
  const c = facts.company;
  const latest = (test: (h: { what: string; action?: string | null }) => boolean) => history.find(h => test(h)) || null;
  let edd = false;
  if (c?.aml_edd_required) {
    const reason = String(c.aml_edd_reason || "").trim();
    const line = latest(h => h.action === "edd_triggered" || /\bedd=/i.test(h.what) || (!!reason && h.what === reason));
    edd = line ? byOldScreening(line) : oldScreeningEddReason(reason);
  }
  let pep = false;
  if (String(c?.aml_pep_status || "").trim().toLowerCase() === "review_required") {
    // Only the old screening wrote review_required; a person's own "pep=" line says otherwise.
    const line = latest(h => /\bpep=/i.test(h.what));
    pep = !line || byOldScreening(line);
  }
  let risk = false;
  if (highRisk(c?.aml_risk_level)) {
    const line = latest(h => /\brisk=/i.test(h.what));
    risk = !line || byOldScreening(line);
  }
  const inv = facts.latestInvestigation;
  const invAt = iso(inv?.conducted_at);
  const sanctions = !!(inv?.sanctions_match && !inv.precheck && invAt && beforeOff(invAt));
  return { edd, pep, risk, sanctions };
}

export function partyRedFlags(facts: PartyRedFlagFacts): KycRedFlag[] {
  const flags: KycRedFlag[] = [];
  // The client's own answer, the latest request that has one; and each
  // person's own answer on their own request (19 November 2026).
  const answered = facts.requests.filter(r => r.answers?.pep && r.answers.pep !== "no");
  const firstPer = answered.filter((r, i) => answered.findIndex(x => (x.person || null) === (r.person || null)) === i);
  for (const r of firstPer) {
    const said = r.answers!.pep === "yes" ? "said yes to the question about public roles" : "was not sure about the question about public roles";
    flags.push({
      kind: "client_pep",
      label: r.person ? `${r.person} ${said}` : r.answers!.pep === "yes" ? "Said yes to the question about public roles" : "Not sure about the question about public roles",
      detail: words(r.answers!.pepDetail),
      source: `Client checks, ref ${r.ref}`,
      at: iso(r.answers!.answeredAt),
      key: `client_pep:${keyPart(r.ref)}`,
      evidence: [`answer:${r.answers!.pep}`],
      facts: [
        { label: "Their answer", value: r.answers!.pep === "yes" ? "Yes" : "Not sure" },
        ...(words(r.answers!.pepDetail) ? [{ label: "What they said", value: words(r.answers!.pepDetail)! }] : []),
        { label: "Request", value: `Client checks, ref ${r.ref}` },
      ],
    });
  }
  // The client's reply about the owners on the register, the latest that
  // has one: a difference is reported to Companies House (HMRC, AMLG11400
  // 14.8) and the owners found out.
  for (const r of facts.requests.filter(r => r.ownersAnswer?.answer).slice(0, 1).filter(r => r.ownersAnswer!.answer === "no")) {
    flags.push({
      kind: "owners_differ",
      label: "Says the owners Companies House lists are not right",
      detail: words(r.ownersAnswer!.detail),
      source: `Client checks, ref ${r.ref}`,
      at: iso(r.ownersAnswer!.answeredAt),
      key: `owners_differ:${keyPart(r.ref)}`,
      evidence: [],
      facts: words(r.ownersAnswer!.detail) ? [{ label: "What they said", value: words(r.ownersAnswer!.detail)! }] : [],
    });
  }
  for (const s of facts.idChecks.filter(c => String(c.status || "").toLowerCase() === "declined")) {
    flags.push({
      kind: "id_declined",
      label: `Identity check declined${s.name ? ` for ${s.name}` : ""}`,
      detail: words(s.decision_reason),
      source: "Veriff",
      at: iso(s.received_at),
      key: `id_declined:${keyPart(s.name)}`,
      evidence: [`at:${iso(s.received_at) || "unknown"}`],
      facts: words(s.decision_reason) ? [{ label: "Veriff's reason", value: words(s.decision_reason)! }] : [],
    });
  }
  // The brand's KYC record: who wrote each field, and when, is in its history
  // (recordHistory, the KYC audit lines about it), shown as the flag's facts.
  const history = (facts.recordHistory || []).map(h => ({ label: h.at ? new Date(h.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "On the record", value: `${h.what}${h.who ? ` (${h.who})` : ""}` }));
  // The old in-app screening's own marks are not red flags (Woody, 24 November
  // 2026: "Only sign off counts remove the old bit. The result are in the
  // app"): they stay in the record's history. A mark a person set still counts.
  const old = oldScreeningMarks(facts);
  const pep = pepStatusLabel(facts.company?.aml_pep_status);
  if (pep && !old.pep) flags.push({ kind: "screening", label: pep, detail: null, source: "Screening and KYC record", at: null, key: "record:screening", evidence: [`status:${keyPart(facts.company?.aml_pep_status)}`], facts: history });
  if (facts.latestInvestigation?.sanctions_match && !facts.latestInvestigation.precheck && !old.sanctions) {
    flags.push({ kind: "sanctions", label: "Possible match on the UK Sanctions List", detail: null, source: "Latest screening", at: iso(facts.latestInvestigation.conducted_at),
      key: "record:sanctions", evidence: [`at:${iso(facts.latestInvestigation.conducted_at) || "unknown"}`], facts: history });
  }
  if (highRisk(facts.company?.aml_risk_level) && !old.risk) {
    flags.push({ kind: "high_risk", label: riskLabel(facts.company!.aml_risk_level!), detail: null, source: "KYC record", at: null, key: "record:high_risk", evidence: [`level:${keyPart(facts.company!.aml_risk_level)}`], facts: history });
  }
  if (facts.company?.aml_edd_required && !old.edd) {
    flags.push({ kind: "edd", label: "Marked for enhanced due diligence", detail: eddReason(facts.company.aml_edd_reason), source: "KYC record", at: null,
      key: "record:edd", evidence: [`reason:${keyPart(facts.company.aml_edd_reason)}`], facts: history });
  }
  if (facts.precheck?.result) flags.push(...precheckRedFlags(facts.precheck.result, {
    sanctionsCurrent: facts.precheck.current,
    publicBody: String(facts.company?.aml_subject_type || "").trim().toLowerCase() === "public_body",
  }));
  flags.push(...policyFactorFlags({ precheck: facts.precheck?.result || null, companyType: facts.company?.company_type, subjectType: facts.company?.aml_subject_type }));
  return flags;
}

// The deal record's own AML fields. They are not tied to one party, so the
// screens show them as "On the deal record".
export function dealRedFlags(deal: DealRedFlagFacts | null): KycRedFlag[] {
  if (!deal) return [];
  const flags: KycRedFlag[] = [];
  const pep = pepStatusLabel(deal.aml_pep_status);
  if (pep) flags.push({ kind: "screening", label: pep, detail: null, source: "Transaction record", at: null, key: "deal:screening", evidence: [`status:${keyPart(deal.aml_pep_status)}`] });
  if (highRisk(deal.aml_risk_level)) flags.push({ kind: "high_risk", label: riskLabel(deal.aml_risk_level!), detail: null, source: "Transaction record", at: null, key: "deal:high_risk", evidence: [`level:${keyPart(deal.aml_risk_level)}`] });
  if (deal.aml_edd_required && !deal.aml_edd_completed_at && !eddMarkIsSuperPrimeOnly(deal.aml_edd_reason)) {
    flags.push({ kind: "edd", label: "Marked for enhanced due diligence", detail: eddReason(deal.aml_edd_reason), source: "Transaction record", at: null, key: "deal:edd", evidence: [`reason:${keyPart(deal.aml_edd_reason)}`] });
  }
  const mismatched = (deal.aml_sof_analysis?.items || []).filter(i => i?.declaredSourceMatchesDocument === false);
  if (mismatched.length) {
    const kinds = [...new Set(mismatched.map(i => words(i.documentType)).filter(Boolean))];
    flags.push({
      kind: "sof_mismatch",
      label: mismatched.length === 1 ? "A source of funds document does not match what was declared" : `${mismatched.length} source of funds documents do not match what was declared`,
      detail: kinds.length ? kinds.join(", ") : null,
      source: "Source of funds review",
      at: iso(mismatched[0].generatedAt),
      key: "deal:sof_mismatch",
      evidence: mismatched.map(i => `doc:${keyPart(i.documentType)}:${iso(i.generatedAt) || ""}`),
    });
  }
  // A super-prime sale is weighed on each party, not a flag (risk assessment Issue 3).
  return flags;
}

export const redFlagLine = (f: KycRedFlag): string => `${f.label}${f.detail ? ` (${f.detail})` : ""}. Source: ${f.source}.`;

// The lines KYC4U's request note carries: the red flags, then the higher-
// risk factors BGP's AML policy names.
export function redFlagNote(party: KycRedFlag[], deal: KycRedFlag[]): string {
  if (!party.length && !deal.length) return "";
  const lines: string[] = [];
  const found = [...party.filter(f => !f.factor).map(f => `- ${redFlagLine(f)}`), ...deal.filter(f => !f.factor).map(f => `- On the transaction record: ${redFlagLine(f)}`)];
  const factors = [...party.filter(f => f.factor).map(f => `- ${redFlagLine(f)}`), ...deal.filter(f => f.factor).map(f => `- On the transaction: ${redFlagLine(f)}`)];
  if (found.length) lines.push("Red flags from BGP's checks:", ...found);
  if (factors.length) lines.push(...(found.length ? [""] : []), "Higher-risk factors in BGP's AML policy (enhanced due diligence):", ...factors);
  return lines.join("\n");
}

// One alert per flag per request: the key the request remembers.
export const redFlagAlertKey = (f: Pick<KycRedFlag, "kind" | "label">): string => `${f.kind}:${f.label}`.slice(0, 200);
