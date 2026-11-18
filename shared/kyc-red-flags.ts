// Red flags: what in BGP's own checks sends a party to KYC4U. Woody,
// 17 November 2026: "basically we do the normal checks expected and if there
// is a red flag then we get KYC4U", then "yes build the red flag handoff to
// KYC4U". Every flag is read from a record the app already holds; nothing
// here decides anything. The agent raises the party with KYC4U, BGP's MLRO
// service, and KYC4U decides.
//
// Not a flag on purpose: the MLRO's rejection (it already blocks the deal)
// and a client who has not replied (chase them). Adverse media is a flag
// since 17 November 2026, from BGP's checks before asking, where a web
// search finds it with a source to check (shared/kyc-prechecks.ts).

import type { KycAnswers, KycOwnersReply } from "./kyc-request";
import { precheckRedFlags, type KycPrecheckResult } from "./kyc-prechecks";

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
  | "owners_differ";

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
}

export interface PartyRedFlagFacts {
  company: {
    aml_pep_status?: string | null;
    aml_risk_level?: string | null;
    aml_edd_required?: boolean | null;
    aml_edd_reason?: string | null;
  } | null;
  // The party's latest screening record only: a later clear one clears it.
  // precheck: that record is BGP's checks before asking, whose own lines say
  // who matched (so the general line is not added as well).
  latestInvestigation: { sanctions_match: boolean | null; conducted_at: string | Date | null; precheck?: boolean } | null;
  // The party's latest checks before asking, and whether they are its latest
  // screening (a later screening replaces their sanctions lines).
  precheck?: { result: KycPrecheckResult; current: boolean } | null;
  // The client checks sent on this deal to this party (tests left out).
  requests: Array<{ ref: string; answers?: KycAnswers | null; ownersAnswer?: KycOwnersReply | null }>;
  // The party's identity checks.
  idChecks: Array<{ status: string | null; decision_reason?: string | null; received_at?: string | Date | null; name?: string | null }>;
}

export interface DealRedFlagFacts {
  aml_pep_status?: string | null;
  aml_risk_level?: string | null;
  aml_edd_required?: boolean | null;
  aml_edd_reason?: string | null;
  aml_edd_completed_at?: string | Date | null;
  aml_sof_analysis?: { items?: Array<{ documentType?: string | null; declaredSourceMatchesDocument?: boolean | null; generatedAt?: string | null }> } | null;
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

export function partyRedFlags(facts: PartyRedFlagFacts): KycRedFlag[] {
  const flags: KycRedFlag[] = [];
  // The client's own answer, the latest request that has one.
  const answered = facts.requests.filter(r => r.answers?.pep && r.answers.pep !== "no");
  for (const r of answered.slice(0, 1)) {
    flags.push({
      kind: "client_pep",
      label: r.answers!.pep === "yes" ? "Said yes to the question about public roles" : "Not sure about the question about public roles",
      detail: words(r.answers!.pepDetail),
      source: `Client checks, ref ${r.ref}`,
      at: iso(r.answers!.answeredAt),
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
    });
  }
  for (const s of facts.idChecks.filter(c => String(c.status || "").toLowerCase() === "declined")) {
    flags.push({
      kind: "id_declined",
      label: `Identity check declined${s.name ? ` for ${s.name}` : ""}`,
      detail: words(s.decision_reason),
      source: "Veriff",
      at: iso(s.received_at),
    });
  }
  const pep = pepStatusLabel(facts.company?.aml_pep_status);
  if (pep) flags.push({ kind: "screening", label: pep, detail: null, source: "Screening and KYC record", at: null });
  if (facts.latestInvestigation?.sanctions_match && !facts.latestInvestigation.precheck) {
    flags.push({ kind: "sanctions", label: "Possible match on the UK Sanctions List", detail: null, source: "Latest screening", at: iso(facts.latestInvestigation.conducted_at) });
  }
  if (highRisk(facts.company?.aml_risk_level)) {
    flags.push({ kind: "high_risk", label: riskLabel(facts.company!.aml_risk_level!), detail: null, source: "KYC record", at: null });
  }
  if (facts.company?.aml_edd_required) {
    flags.push({ kind: "edd", label: "Marked for enhanced due diligence", detail: eddReason(facts.company.aml_edd_reason), source: "KYC record", at: null });
  }
  if (facts.precheck?.result) flags.push(...precheckRedFlags(facts.precheck.result, { sanctionsCurrent: facts.precheck.current }));
  return flags;
}

// The deal record's own AML fields. They are not tied to one party, so the
// screens show them as "On the deal record".
export function dealRedFlags(deal: DealRedFlagFacts | null): KycRedFlag[] {
  if (!deal) return [];
  const flags: KycRedFlag[] = [];
  const pep = pepStatusLabel(deal.aml_pep_status);
  if (pep) flags.push({ kind: "screening", label: pep, detail: null, source: "Deal record", at: null });
  if (highRisk(deal.aml_risk_level)) flags.push({ kind: "high_risk", label: riskLabel(deal.aml_risk_level!), detail: null, source: "Deal record", at: null });
  if (deal.aml_edd_required && !deal.aml_edd_completed_at) {
    flags.push({ kind: "edd", label: "Marked for enhanced due diligence", detail: eddReason(deal.aml_edd_reason), source: "Deal record", at: null });
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
    });
  }
  return flags;
}

export const redFlagLine = (f: KycRedFlag): string => `${f.label}${f.detail ? ` (${f.detail})` : ""}. Source: ${f.source}.`;

// The lines KYC4U's request note carries.
export function redFlagNote(party: KycRedFlag[], deal: KycRedFlag[]): string {
  if (!party.length && !deal.length) return "";
  const lines = ["Red flags from BGP's checks:"];
  for (const f of party) lines.push(`- ${redFlagLine(f)}`);
  for (const f of deal) lines.push(`- On the deal record: ${redFlagLine(f)}`);
  return lines.join("\n");
}

// One alert per flag per request: the key the request remembers.
export const redFlagAlertKey = (f: Pick<KycRedFlag, "kind" | "label">): string => `${f.kind}:${f.label}`.slice(0, 200);
