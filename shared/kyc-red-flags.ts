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
import { flagKeyPart, precheckRedFlags, precheckSanctionsMatch, precheckUnfinished, type KycPrecheckResult } from "./kyc-prechecks";
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
  // Words the officer can start the set-aside comment from, where the app can
  // say why the flag may not apply (an old automatic flag the current screening
  // does not bear out). The officer still reads and saves it.
  suggestion?: string;
  // Set aside by the app itself: a flag the old in-app screening set by itself,
  // which BGP's own newer screening of the party does not bear out (24 November
  // 2026). It counts nowhere and is listed with the reason; a new match brings it back.
  supersededBy?: { comment: string; at: string | null; by: string };
  // Written on the record by the old in-app screening by itself, switched off in October
  // 2026 (Woody, 24 November 2026, on Coq d'Argent: "not clear why its been flagged and by
  // what and how to get the right info what we need"): the screens say so, and that BGP's
  // own checks replace it.
  oldScreening?: true;
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
}

export interface SetAsideFlag { flag: KycRedFlag; review: KycFlagReview }

/** Splits flags into the ones that count and the ones a review set aside. */
export function applyFlagReviews(flags: KycRedFlag[], reviews: KycFlagReview[]): { live: KycRedFlag[]; setAside: SetAsideFlag[] } {
  const live: KycRedFlag[] = [];
  const setAside: SetAsideFlag[] = [];
  for (const flag of flags) {
    const review = reviews.find(r => r.flagKey === flag.key && flag.evidence.every(e => r.evidence.includes(e)));
    if (review) setAside.push({ flag, review });
    // Set aside by the app (no review row: id 0, nothing to put back).
    else if (flag.supersededBy) setAside.push({ flag, review: { id: 0, flagKey: flag.key, evidence: flag.evidence, comment: flag.supersededBy.comment, by: flag.supersededBy.by, at: flag.supersededBy.at } });
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
  return EDD_REASONS[r] ? `Reason: ${EDD_REASONS[r]}` : words(r);
};

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
// review_required: a name matched a sanctions or PEP list), its risk rating
// (Clouseau's score; a person's change writes "risk=" on the history) and its
// sanctions match. It kept no record of which name or list matched.
const IN_APP_SCREENING_OFF = "2026-11-01";
export const OLD_SCREENING_SOURCE = "The old in-app screening";
const OLD_SCREENING_WHO = /^(?:automatic|system|auto|the system)$/i;
const dayWords = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "");
const beforeOff = (at: string | null | undefined) => !at || at.slice(0, 10) < IN_APP_SCREENING_OFF;
const byOldScreening = (h: { at: string | null; who: string | null }) => OLD_SCREENING_WHO.test(String(h.who || "").trim()) && beforeOff(h.at);
const regionName = (code: string): string => {
  try {
    const name = new Intl.DisplayNames(["en-GB"], { type: "region" }).of(code.toUpperCase());
    return name && name.toUpperCase() !== code.toUpperCase() ? name : code;
  } catch { return code; }
};

/**
 * Why the old screening marked enhanced due diligence, in plain words, from
 * the reason it wrote (evaluateAutoEdd's sentences). Null for a reason in any
 * other words: a person wrote it.
 */
export function oldEddWhy(reason: unknown): string | null {
  const r = String(reason ?? "").replace(/\s+/g, " ").trim();
  let m: RegExpMatchArray | null;
  if (/^Sanctions screening returned a match/i.test(r)) return "a name matched a sanctions list. It did not record which name or list matched, and its name matching was loose";
  if (/^PEP \/ Relative or Close Associate/i.test(r)) return "it took someone for a politically exposed person, or a relative or close associate of one. It did not record who";
  if (/^Adverse media identified during AI sweep/i.test(r)) return "an AI web search reported bad news about them. It did not record what it found";
  if ((m = r.match(/^UBO chain touches (high|medium)-risk jurisdiction ([A-Za-z]{2,3})\b/i))) return `it placed an owner up the ownership chain in ${regionName(m[2])}, a country it rated ${m[1].toLowerCase()} risk`;
  if (/^Transaction value over £1m/i.test(r)) return "the transaction was worth over £1m. BGP's AML policy weighs value; on its own it is not a red flag";
  if ((m = r.match(/^UBO chain (\d+) levels deep/i))) return `the ownership chain is ${m[1]} companies deep. Depth on its own is not a risk factor in BGP's AML policy: BGP's checks read the chain at Companies House and flag an owner abroad, a trust, or owners who cannot be found`;
  if ((m = r.match(/^Overall risk assessed as high \(score ([^)]*)\)/i))) return `its own risk score came to ${m[1]}, which it called high. BGP's checks and its AML policy set the level now`;
  return null;
}

// What BGP's own latest checks found since, in one sentence: the sanctions lists they read.
const checksSince = (facts: Pick<PartyRedFlagFacts, "precheck">): string | null => {
  const r = facts.precheck?.current ? facts.precheck.result : null;
  if (!r?.sanctions?.ran) return null;
  const ran = dayWords(r.ranAt || null);
  const names = r.sanctions.lines.length;
  return `BGP's checks${ran ? ` on ${ran}` : ""} screened ${names} name${names === 1 ? "" : "s"} against ${r.sanctions.lists.join(", ")}: ${precheckSanctionsMatch(r) === false ? "no match" : "a possible match, listed here"}.`;
};

/** What BGP's checks do about an old flag, for the screens (the first step, setting the company that signs or running the checks, is the party's own). */
export const OLD_SCREENING_TODO = "BGP's checks before asking redo it properly: if they find nothing, it is set aside by itself; anything they find is shown with its evidence.";

export interface OldScreeningMark { at: string | null; detail: string }

/**
 * The record fields the old in-app screening wrote by itself (Woody, 24
 * November 2026, on Coq d'Argent: "not clear why its been flagged and by what
 * and how to get the right info what we need"), each with when and why in
 * plain words. A field a person set (a line by a person on its history) is not
 * the old screening's.
 */
export function oldScreeningMarks(facts: Pick<PartyRedFlagFacts, "company" | "recordHistory" | "latestInvestigation">): {
  edd: OldScreeningMark | null; pep: OldScreeningMark | null; risk: OldScreeningMark | null; sanctions: OldScreeningMark | null;
} {
  const history = facts.recordHistory || [];
  const c = facts.company;
  const off = "the old in-app screening, switched off in October 2026";
  // The latest line about a field decides who set it.
  const latest = (test: (h: { what: string; action?: string | null }) => boolean) => history.find(h => test(h)) || null;

  let edd: OldScreeningMark | null = null;
  if (c?.aml_edd_required) {
    const reason = String(c.aml_edd_reason || "").trim();
    const line = latest(h => h.action === "edd_triggered" || /\bedd=/i.test(h.what) || (!!reason && h.what === reason));
    const automatic = line ? byOldScreening(line) : !!oldEddWhy(reason);
    if (automatic) {
      const why = oldEddWhy(reason);
      const set = dayWords(line?.at || null);
      edd = {
        at: line?.at || null,
        detail: `Set automatically${set ? ` on ${set}` : ""} by ${off}, ${why ? `because ${why}.` : `with the note "${words(reason) || "none"}".`}`,
      };
    }
  }

  let pep: OldScreeningMark | null = null;
  if (String(c?.aml_pep_status || "").trim().toLowerCase() === "review_required") {
    // Only the old screening wrote review_required; a person's own line on the field says otherwise.
    const line = latest(h => /\bpep=/i.test(h.what) || /^pep_/i.test(String(h.action || "")) || /screening returned a match|sanctions screening|screening match/i.test(h.what));
    if (!line || byOldScreening(line) || !/\bpep=/i.test(line.what)) {
      const auto = line && byOldScreening(line) ? line : null;
      const set = dayWords(auto?.at || null);
      pep = { at: auto?.at || null, detail: `Set${set ? ` on ${set}` : ""} by ${off}, when a name matched a sanctions or PEP list. It did not record which name or list matched, and its name matching was loose.` };
    }
  }

  let risk: OldScreeningMark | null = null;
  if (highRisk(c?.aml_risk_level)) {
    const line = latest(h => /\brisk=/i.test(h.what));
    if (!line || byOldScreening(line)) {
      const score = String(c?.aml_edd_reason || "").match(/^Overall risk assessed as high \(score ([^)]*)\)/i)?.[1];
      risk = { at: null, detail: `Set by ${off}, from its own risk score${score ? ` (${score})` : ""}. No one at BGP is recorded as setting it. BGP's checks and its AML policy set the level now.` };
    }
  }

  let sanctions: OldScreeningMark | null = null;
  const inv = facts.latestInvestigation;
  const invAt = iso(inv?.conducted_at);
  if (inv?.sanctions_match && !inv.precheck && invAt && beforeOff(invAt)) {
    sanctions = { at: invAt, detail: `From ${off}, on ${dayWords(invAt)}. It did not record which name or list matched, and its name matching was loose.` };
  }
  return { edd, pep, risk, sanctions };
}

/**
 * The record's screening flag as the old in-app screening left it, when its
 * latest line about the screening is that screening's own automatic note:
 * when it was set, that it kept no record of the match, and what BGP's
 * checks since found. Null for a flag a person set.
 */
export function oldAutomaticScreening(facts: Pick<PartyRedFlagFacts, "recordHistory" | "precheck">): { at: string | null; detail: string; suggestion: string | null } | null {
  const line = (facts.recordHistory || []).find(h => /screening returned a match|sanctions screening|screening match/i.test(h.what));
  if (!line || !OLD_SCREENING_WHO.test(String(line.who || "").trim())) return null;
  if (line.at && line.at.slice(0, 10) >= IN_APP_SCREENING_OFF) return null;
  const set = dayWords(line.at);
  let detail = `Set automatically${set ? ` on ${set}` : ""} by the old in-app screening, switched off in October 2026. It did not record which name or list matched.`;
  let suggestion: string | null = null;
  const result = facts.precheck?.current ? facts.precheck.result : null;
  if (result && precheckSanctionsMatch(result) === false) {
    const ran = dayWords(result.ranAt || null);
    const names = result.sanctions.lines.length;
    const lists = result.sanctions.lists.join(", ");
    detail += ` BGP's checks${ran ? ` on ${ran}` : ""} screened ${names} name${names === 1 ? "" : "s"} against ${lists}: no match.`;
    suggestion = `Old automatic flag from the in-app screening${set ? ` of ${set}` : ""}, which kept no record of what matched. BGP's checks${ran ? ` on ${ran}` : ""} screened ${names} name${names === 1 ? "" : "s"} against ${lists} and found no match.`;
  }
  return { at: line.at, detail, suggestion };
}

/**
 * Whether BGP's own latest checks of the party found nothing, so the old
 * screening's flags are set aside (Woody, 24 November 2026): the checks are
 * the party's latest screening, read the sanctions lists and matched no one,
 * were not cut short (Companies House read), and raised no red flag of their
 * own. Returns the words the set-aside is listed with.
 */
export function oldScreeningCleared(facts: Pick<PartyRedFlagFacts, "recordHistory" | "precheck">): { comment: string; at: string | null; by: string } | null {
  const p = facts.precheck;
  if (!p?.current || !p.result || !p.result.sanctions?.ran) return null;
  if (precheckUnfinished(p.result)) return null;
  if (precheckSanctionsMatch(p.result) !== false) return null;
  if (precheckRedFlags(p.result, { sanctionsCurrent: true }).length) return null;
  const ran = dayWords(p.result.ranAt || null);
  const names = p.result.sanctions.lines.length;
  const lists = p.result.sanctions.lists.join(", ");
  const old = oldAutomaticScreening(facts);
  const set = old?.at ? dayWords(old.at) : null;
  const also = [p.result.complyAdvantage?.ran ? "ComplyAdvantage" : null, p.result.web?.ran ? "a web search" : null].filter(Boolean).join(" and ");
  return {
    comment: `${old ? `Set by the old in-app screening${set ? ` on ${set}` : ""}, which kept no record of what matched.` : "Set by the old in-app screening, switched off in October 2026."} BGP's checks${ran ? ` on ${ran}` : ""} screened ${names} name${names === 1 ? "" : "s"} against ${lists}${also ? `, with ${also},` : ""} and found nothing.`,
    at: p.result.ranAt || null,
    by: "BGP's checks before asking",
  };
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
  // Written by the old in-app screening by itself, which kept no record of the
  // name or list that matched (Woody, 23 November 2026: "this has picked up a
  // red flag but its not clear why?"; 24 November, on Coq d'Argent: "not clear
  // why its been flagged and by what and how to get the right info what we
  // need"): each flag says so, why in plain words, and what BGP's checks found
  // since. Once BGP's own latest checks of the party find nothing, the app sets
  // them aside (cleared), listed with the reason; a new match brings them back.
  const old = oldAutomaticScreening(facts);
  const marks = oldScreeningMarks(facts);
  const cleared = oldScreeningCleared(facts);
  const oldFlag = (mark: OldScreeningMark | null, at?: string | null) => mark
    ? { source: OLD_SCREENING_SOURCE, at: mark.at || at || null, oldScreening: true as const, ...(cleared ? { supersededBy: cleared } : {}) }
    : null;
  const pep = pepStatusLabel(facts.company?.aml_pep_status);
  if (pep) {
    const mark = marks.pep || (old ? { at: old.at, detail: old.detail } : null);
    flags.push({ kind: "screening", label: mark ? "Possible PEP or sanctions match (old screening)" : pep, detail: marks.pep ? [marks.pep.detail, checksSince(facts)].filter(Boolean).join(" ") : old?.detail || null,
      source: "Screening and KYC record", at: null, key: "record:screening", evidence: [`status:${keyPart(facts.company?.aml_pep_status)}`], facts: history,
      ...(old?.suggestion ? { suggestion: old.suggestion } : {}), ...(oldFlag(mark) || {}) });
  }
  if (facts.latestInvestigation?.sanctions_match && !facts.latestInvestigation.precheck) {
    const mark = marks.sanctions;
    flags.push({ kind: "sanctions", label: mark ? "Possible match on the UK Sanctions List (old screening)" : "Possible match on the UK Sanctions List", detail: mark ? [mark.detail, checksSince(facts)].filter(Boolean).join(" ") : null,
      source: "Latest screening", at: iso(facts.latestInvestigation.conducted_at),
      key: "record:sanctions", evidence: [`at:${iso(facts.latestInvestigation.conducted_at) || "unknown"}`], facts: history, ...(oldFlag(mark, iso(facts.latestInvestigation.conducted_at)) || {}) });
  }
  if (highRisk(facts.company?.aml_risk_level)) {
    const mark = marks.risk;
    flags.push({ kind: "high_risk", label: `${riskLabel(facts.company!.aml_risk_level!)}${mark ? " (old screening)" : ""}`, detail: mark ? [mark.detail, checksSince(facts)].filter(Boolean).join(" ") : null, source: "KYC record", at: null,
      key: "record:high_risk", evidence: [`level:${keyPart(facts.company!.aml_risk_level)}`], facts: history, ...(oldFlag(mark) || {}) });
  }
  if (facts.company?.aml_edd_required) {
    const mark = marks.edd;
    const reason = eddReason(facts.company.aml_edd_reason);
    flags.push({ kind: "edd", label: mark ? "Marked for enhanced due diligence (old screening)" : "Marked for enhanced due diligence",
      detail: mark ? [mark.detail, checksSince(facts)].filter(Boolean).join(" ") : reason,
      source: "KYC record", at: null,
      key: "record:edd", evidence: [`reason:${keyPart(facts.company.aml_edd_reason)}`], facts: history,
      ...(mark && old?.suggestion && /^Sanctions screening returned a match/i.test(String(facts.company.aml_edd_reason || "")) ? { suggestion: old.suggestion } : {}), ...(oldFlag(mark) || {}) });
  }
  if (facts.precheck?.result) flags.push(...precheckRedFlags(facts.precheck.result, { sanctionsCurrent: facts.precheck.current }));
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
  if (deal.aml_edd_required && !deal.aml_edd_completed_at) {
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
