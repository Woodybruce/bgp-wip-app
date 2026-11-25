// The AML file's own words (Woody, 20 November 2026: "an option for the AML
// officers to generate a report to include all the documents etc which we can
// then send to HMRC if asked? Also we can send to KYC4U"). Pure: the file is
// made by server/aml-file.ts.

import type { GuarantorChecksState } from "./deal-guarantor";

/** The report, filed on a party's KYC record (for KYC4U until 23 November 2026). */
export const AML_FILE_DOC_TYPE = "aml_file";

const DOC_WORDS: Record<string, string> = {
  adviser_check: "Adviser check",
  agent_confirmation: "Agent's confirmation",
  aml_file: "AML file",
  authority_to_act: "Authority to act",
  company_accounts: "Accounts",
  company_cert: "Certificate of incorporation",
  confirmation_statement: "Confirmation statement",
  credit_report: "Credit report",
  driving_licence: "Driving licence",
  electronic_id_check: "Electronic identity check",
  heads_of_terms: "Heads of terms",
  id_check_report: "Identity document check",
  id_document: "Identity document",
  kyc4u_report: "KYC4U report",
  onfido_report: "Identity check result",
  other: "Other document",
  passport: "Passport",
  proof_of_address: "Proof of address",
  public_source: "Public source",
  register_extract: "Register extract",
  regulator_register: "Regulator's register",
  screening_report: "Screening report",
  source_of_funds: "Source of funds",
  source_of_wealth: "Source of wealth",
  structure_chart: "Structure chart",
  trs_excerpt: "Trust Registration Service",
  trust_deed: "Trust deed",
  trust_structure: "Who is who in the trust",
  certified_id: "Certified ID or proof of address",
  ubo_declaration: "Owners",
  web_source: "Web page (copy)",
};

/** A stored document type in words: "proof_of_address" is "Proof of address". */
export function amlFileDocWords(type: string | null | undefined): string {
  const key = String(type || "").trim().toLowerCase();
  if (DOC_WORDS[key]) return DOC_WORDS[key];
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Document";
}

const ASCII_LETTERS: Record<string, string> = {
  "Ə": "E", "ə": "e", "ß": "ss", "Æ": "AE", "æ": "ae", "Ø": "O", "ø": "o", "Đ": "D", "đ": "d", "Ł": "L", "ł": "l", "ı": "i", "Œ": "OE", "œ": "oe", "Þ": "Th", "þ": "th",
};

/**
 * A file or folder name any computer will take: plain ASCII (a browser drops a
 * download name with an accent or a dash it does not like, and Windows' own
 * unzip can garble one inside a ZIP), no slashes, colons or the like, and not
 * too long. The report inside keeps every name as written.
 */
export function amlFileSafeName(name: string, max = 110): string {
  const clean = String(name || "")
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'").replace(/[\u201c\u201d\u201f\u2033]/g, '"').replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/./g, ch => ASCII_LETTERS[ch] ?? ch)
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/[\s.]+$/, "");
  return clean || "file";
}

const londonDay = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
};

/** "AML file - BRUCE CAP LTD - Ref 4507 - 2026-11-20", or "AML report - ..." for the report alone. */
export function amlFileName(data: {
  deal: { name: string; ref: string | null };
  parties: Array<{ brand: { name: string }; company: { name: string } | null }>;
  madeAt: string;
}, kind: "folder" | "report"): string {
  const subject = data.parties.length === 1 ? (data.parties[0].company?.name || data.parties[0].brand.name) : data.deal.name;
  const deal = data.deal.ref ? `Ref ${data.deal.ref}` : data.parties.length === 1 ? data.deal.name : null;
  return amlFileSafeName([kind === "folder" ? "AML file" : "AML report", subject, deal, londonDay(data.madeAt)].filter(Boolean).join(" - "), 150);
}

/** Where a party's checks stand, in words, for the report. */
export function amlFileStateWords(
  state: { status: string | null; expiresAt: string | Date | null; approvedBy: string | null; approvedAt?: string | Date | null; name?: string; source?: string } | null,
  notRequired: { reasonWords: string; by: string | null; at: string | null } | null,
  now: Date = new Date(),
): { tone: "done" | "act" | "flag"; words: string } {
  const day = (v: unknown) => {
    if (!v) return "";
    const d = new Date(v as any);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
  };
  if (notRequired && String(state?.status || "").toLowerCase() !== "rejected") {
    return { tone: "done", words: `Not required: ${notRequired.reasonWords}${notRequired.by ? ` (${notRequired.by}${notRequired.at ? `, ${day(notRequired.at)}` : ""})` : ""}` };
  }
  const status = String(state?.status || "").toLowerCase();
  const on = state?.source === "company" || state?.source === "same_company" ? ` (on ${state?.name || "the contracting entity"})` : "";
  if (status === "approved") {
    const until = state?.expiresAt ? new Date(state.expiresAt as any) : null;
    const by = `${state?.approvedBy ? ` by ${state.approvedBy}` : ""}${state?.approvedAt ? ` on ${day(state.approvedAt)}` : ""}`;
    if (until && !Number.isNaN(until.getTime()) && until.getTime() < now.getTime()) {
      return { tone: "flag", words: `Approved${by}${on}; the approval ran out on ${day(until)} and the checks are due again` };
    }
    return { tone: "done", words: `Approved${by}${on}${until && !Number.isNaN(until.getTime()) ? `, valid until ${day(until)}` : ""}` };
  }
  if (status === "rejected") return { tone: "flag", words: `Rejected${on}` };
  // Only a sign-off counts (24 November 2026): anything else is not approved yet.
  return { tone: "act", words: `Not approved yet${on}` };
}

// ── Still needed (Woody, 23 November 2026: "a download button of the report
// to date which we can share with suppliers ... we want to make sure the app
// is capable of understanding what we need at each point and then make our
// own approvals") ────────────────────────────────────────────────────────────

export interface StillNeededInput {
  // When the checks must be complete (shared/aml-dashboard.ts amlDeadline) and whether it has passed.
  deadline: { words: string; passed: boolean } | null;
  // Approved and in date, rejected, or marked Not required: nothing more is needed.
  settled: "approved" | "rejected" | "not_required" | null;
  // A private individual or a trust needs no company that signs.
  needsCompany: boolean;
  companySet: boolean;
  // BGP's checks before asking: "done" within the last 30 days, "old", "running", "not_run" or "off".
  precheck: "done" | "old" | "running" | "not_run" | "off";
  flags: Array<{ label: string; factor?: boolean }>;
  level: "simplified" | "standard" | "enhanced" | null;
  sanctionsOnly: boolean;
  // "Jane Doe: identity check and proof of address", from the people to check.
  peopleOutstanding: string[];
  // Client checks requests still open, and what each has not had back.
  requests: Array<{ ref: string; to: string; missing: string[] }>;
  anyRequest: boolean;
  // What the joint agent's files do not cover yet.
  jointGaps: string[];
  trustGaps: string[];
  // A tenant's or buyer's guarantors and where BGP's checks on each stand (23 November 2026).
  guarantors?: Array<{ name: string; state: GuarantorChecksState }>;
  // The other companies that sign for the party, the same way (24 November 2026).
  signers?: Array<{ name: string; state: GuarantorChecksState }>;
  // A company registered abroad: its own register's extract (23 November 2026).
  registerExtract?: { needed: boolean; held: boolean; company: string; reasons: string[] } | null;
}

/**
 * What a party still needs, in order, and who signs it off: one line each, for
 * the AML report. Read from what the report already holds; it decides nothing.
 */
export function amlStillNeeded(f: StillNeededInput): string[] {
  if (f.settled === "approved") return ["Nothing: the checks are approved."];
  if (f.settled === "not_required") return ["Nothing: marked Not required."];
  if (f.settled === "rejected") return ["Nothing more: rejected. BGP does not go ahead with this party unless the Nominated Officer says otherwise."];
  const out: string[] = [];
  if (f.deadline) out.push(f.deadline.passed ? `Late: the checks were needed ${f.deadline.words}.` : `Needed ${f.deadline.words}.`);
  if (f.needsCompany && !f.companySet) out.push("Set the contracting entity: the checks are about that company.");
  if (f.precheck === "not_run" || f.precheck === "off") out.push("Run BGP's checks before asking (Companies House, sanctions, public roles and adverse media).");
  else if (f.precheck === "old") out.push("Run BGP's checks again: the last run is more than 30 days old.");
  else if (f.precheck === "running") out.push("Wait for BGP's checks before asking to finish.");
  for (const g of f.guarantors || []) {
    if (g.state === "not_run") out.push(`Run BGP's checks on the guarantor, ${g.name}.`);
    else if (g.state === "stale") out.push(`Run BGP's checks on the guarantor, ${g.name}, again: the last run is more than 30 days old.`);
    else if (g.state === "running") out.push(`Wait for BGP's checks on the guarantor, ${g.name}, to finish.`);
  }
  for (const g of f.signers || []) {
    if (g.state === "not_run") out.push(`Run BGP's checks on ${g.name}, which also signs.`);
    else if (g.state === "stale") out.push(`Run BGP's checks on ${g.name}, which also signs, again: the last run is more than 30 days old.`);
    else if (g.state === "running") out.push(`Wait for BGP's checks on ${g.name}, which also signs, to finish.`);
  }
  for (const g of f.trustGaps) out.push(`Trust: ${g.replace(/\.$/, "")}.`);
  if (f.registerExtract?.needed && !f.registerExtract.held && !f.sanctionsOnly) {
    out.push(f.registerExtract.reasons.length
      ? `The register extract for ${f.registerExtract.company} did not pass its check: ${f.registerExtract.reasons.map(r => r.replace(/\.$/, "")).join("; ")}.`
      : `An extract from ${f.registerExtract.company}'s own register (it is registered outside the UK), dated in the last three months.`);
  }
  const flags = f.flags.filter(x => !x.factor);
  const factors = f.flags.filter(x => x.factor);
  if (flags.length) out.push(`Look into ${flags.length === 1 ? "the red flag" : `${flags.length} red flags`}: ${flags.map(x => x.label).join("; ")}. Set aside with a comment only where it does not apply.`);
  if (factors.length) out.push(`Enhanced due diligence for ${factors.length === 1 ? "a higher-risk factor" : `${factors.length} higher-risk factors`}: ${factors.map(x => x.label).join("; ")}.`);
  if (!f.sanctionsOnly) {
    if (!f.anyRequest && !f.jointGaps.length && !f.peopleOutstanding.length) out.push("Send the client checks.");
    for (const r of f.requests) if (r.missing.length) out.push(`From ${r.to} (request ${r.ref}): ${r.missing.join("; ")}.`);
    // A person's own line ("Jane Smith: identity check and proof of address"), less what a request to them already lists.
    for (const p of f.peopleOutstanding) {
      const at = p.indexOf(": ");
      const name = at > 0 ? p.slice(0, at) : "";
      const asked = new Set(f.requests.filter(r => name && r.to.toLowerCase() === name.toLowerCase()).flatMap(r => r.missing.map(m => m.toLowerCase())));
      const items = (at > 0 ? p.slice(at + 2) : p).replace(/\.$/, "").split(/ and |; /).filter(i => !asked.has(i.toLowerCase()));
      if (items.length) out.push(`From ${name ? `${name}: ` : ""}${items.join(" and ")}.`);
    }
    for (const g of f.jointGaps) out.push(`From the joint agent: ${g.replace(/\.$/, "")}.`);
  }
  const enhanced = f.level === "enhanced" || flags.length > 0 || factors.length > 0 || f.trustGaps.length > 0;
  out.push(f.sanctionsOnly
    ? "Sign-off: an agent on the transaction or an officer (a letting under £10,000 a month: sanctions checks only)."
    : enhanced
      ? "Sign-off: the Nominated Officer or a Deputy, with a note of what was checked and why the risk is acceptable (enhanced, approval for 1 year)."
      : "Sign-off: an agent on the transaction or an officer, with a note if anything above is still outstanding (approval for 3 years).");
  return out;
}
