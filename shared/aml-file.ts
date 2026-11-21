// The AML file's own words (Woody, 20 November 2026: "an option for the AML
// officers to generate a report to include all the documents etc which we can
// then send to HMRC if asked? Also we can send to KYC4U"). Pure: the file is
// made by server/aml-file.ts.

/** The report, filed on a party's KYC record for KYC4U. */
export const AML_FILE_DOC_TYPE = "aml_file";

const DOC_WORDS: Record<string, string> = {
  aml_file: "AML file",
  authority_to_act: "Authority to act",
  company_accounts: "Accounts",
  company_cert: "Certificate of incorporation",
  confirmation_statement: "Confirmation statement",
  credit_report: "Credit report",
  driving_licence: "Driving licence",
  heads_of_terms: "Heads of terms",
  id_document: "Identity document",
  kyc4u_report: "KYC4U report",
  onfido_report: "Identity check result",
  other: "Other document",
  passport: "Passport",
  proof_of_address: "Proof of address",
  public_source: "Public source",
  register_extract: "Register extract",
  screening_report: "Screening report",
  source_of_funds: "Source of funds",
  structure_chart: "Structure chart",
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
  const on = state?.source === "company" || state?.source === "same_company" ? ` (on ${state?.name || "the company that signs"})` : "";
  if (status === "approved") {
    const until = state?.expiresAt ? new Date(state.expiresAt as any) : null;
    const by = `${state?.approvedBy ? ` by ${state.approvedBy}` : ""}${state?.approvedAt ? ` on ${day(state.approvedAt)}` : ""}`;
    if (until && !Number.isNaN(until.getTime()) && until.getTime() < now.getTime()) {
      return { tone: "flag", words: `Approved${by}${on}; the approval ran out on ${day(until)} and the checks are due again` };
    }
    return { tone: "done", words: `Approved${by}${on}${until && !Number.isNaN(until.getTime()) ? `, valid until ${day(until)}` : ""}` };
  }
  if (status === "rejected") return { tone: "flag", words: `Rejected${on}` };
  if (status === "in_review") return { tone: "act", words: `In review${on}: not approved yet` };
  return { tone: "act", words: `Not approved yet${on}` };
}
