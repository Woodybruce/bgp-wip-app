// A party's checks sent on to another agent (Jack, 27 November 2026: "How can
// I make it so that I can send it on to the vendors agent for their checks? We
// use Veriff but a lot of people use old School PDF uploads and normally I
// send on email as attachments"). HMRC asks the agent who did not identify
// the buyer to request the CDD documentation from the other agent (AMLG2200
// s21): the documents themselves, not a letter. Pure: the pack is made and
// sent by server/aml-share.ts.
//
// Never in it: BGP's own working (the AML report, screening, web copies,
// credit reports, KYC4U's reports, reliance letters). The cover sheet says
// how each document is held, and that BGP is not agreeing reliance.

import { amlFileDocWords } from "./aml-file";

/** Document types that never leave BGP in a pack. */
export const SHARE_NEVER_TYPES = new Set([
  "aml_file", "screening_report", "kyc4u_report", "web_source", "public_source", "credit_report",
  "adviser_check", "agent_confirmation", "reliance_letter", "heads_of_terms", "terms_of_engagement",
  "source_of_funds", "source_of_wealth",
]);

/** Ticked to start with: identity, address and the company's register. */
const DEFAULT_TYPES = new Set([
  "passport", "driving_licence", "id_document", "id_check_report", "electronic_id_check", "onfido_report",
  "proof_of_address", "certified_id", "ch_register_excerpt", "register_extract", "company_cert",
]);

export const SHARE_LINK_DAYS = 14;
/** Attached to the email itself up to this size in all; over it the email carries the link only. */
export const SHARE_ATTACH_MAX_BYTES = 2_500_000;

export interface ShareDocFacts {
  type: string;
  name: string;
  at: string | null;
  // An online identity check (Veriff), read from the document's address.
  veriff: boolean;
  // An agent ticked "saw the originals" when uploading, and who uploaded it.
  seenOriginal: boolean;
  uploadedBy: string | null;
  // Read by the app as certified, with the certifier's name.
  certifiedBy: string | null;
}

const COMPANIES_HOUSE = new Set(["company_accounts", "confirmation_statement", "company_cert", "ch_register_excerpt"]);

const dayWords = (v: string | null): string => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
};

export const shareOffered = (type: string): boolean => !SHARE_NEVER_TYPES.has(String(type || "").toLowerCase());
export const shareTicked = (d: Pick<ShareDocFacts, "type" | "veriff">): boolean => d.veriff || DEFAULT_TYPES.has(String(d.type || "").toLowerCase());

/** How BGP holds a document, in the words the cover sheet prints. Never more than BGP can honestly say. */
export function shareStatement(d: ShareDocFacts): string {
  const on = dayWords(d.at);
  const when = on ? ` on ${on}` : "";
  if (d.veriff) return `Identity verified electronically by Veriff, a provider on the UK digital verification services register${when}. This page is the result of that check.`;
  if (COMPANIES_HOUSE.has(d.type)) return `From Companies House, read by BGP${when}.`;
  if (d.seenOriginal) return `Original seen by ${d.uploadedBy || "a BGP agent"} of BGP${when}. This is a copy of it.`;
  if (d.certifiedBy) return `Certified copy supplied to BGP${when}, certified by ${d.certifiedBy}.`;
  if (d.type === "certified_id") return `Supplied to BGP as a certified copy${when}.`;
  return `Copy supplied to BGP${when} and checked by BGP. BGP has not seen the original.`;
}

export interface ShareCover {
  partyName: string;
  partyRole: string;
  companyNumber: string | null;
  transaction: string;
  toName: string | null;
  firm: string | null;
  sentBy: string;
  sentOn: string;
  documents: Array<{ file: string; type: string; statement: string }>;
  note: string | null;
}

export const SHARE_NOT_RELIANCE =
  "These are copies of documents BGP holds, sent so that you can carry out your own customer due diligence. BGP is not agreeing that you may rely on its checks (Money Laundering Regulations 2017, regulation 39), and you remain responsible for your own.";
export const SHARE_DATA_USE =
  "They are personal data, sent only for the purpose of preventing money laundering and terrorist financing. Please keep them securely and use them for nothing else.";

/** The cover sheet as headed lines. */
export function shareCoverLines(c: ShareCover): Array<{ head?: string; label?: string; value?: string; para?: string }> {
  const out: Array<{ head?: string; label?: string; value?: string; para?: string }> = [];
  out.push({ head: "Who these documents are about" });
  out.push({ label: "Name", value: c.partyName });
  out.push({ label: "On this transaction", value: `${c.partyRole}, ${c.transaction}` });
  if (c.companyNumber) out.push({ label: "Companies House number", value: c.companyNumber });
  out.push({ head: "Sent" });
  out.push({ label: "To", value: [c.toName, c.firm].filter(Boolean).join(", ") || "The agent named in the email" });
  out.push({ label: "By", value: `${c.sentBy}, Bruce Gillingham Pollard` });
  out.push({ label: "On", value: c.sentOn });
  out.push({ head: `What is enclosed (${c.documents.length})` });
  c.documents.forEach((d, i) => out.push({ label: `${i + 1}. ${amlFileDocWords(d.type)}`, value: `${d.file}\n${d.statement}` }));
  if (c.note) { out.push({ head: "Note from BGP" }); out.push({ para: c.note }); }
  out.push({ head: "Please read" });
  out.push({ para: SHARE_NOT_RELIANCE });
  out.push({ para: SHARE_DATA_USE });
  return out;
}

/** What the request must carry. */
export function sharePackInput(body: any): { ok: true; toEmail: string; toName: string | null; firm: string | null; documentIds: string[]; note: string | null } | { ok: false; message: string } {
  const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const toEmail = clean(body?.toEmail, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(toEmail)) return { ok: false, message: "Give the email address to send it to." };
  const ids = Array.isArray(body?.documentIds) ? [...new Set(body.documentIds.map((x: unknown) => String(x)).filter(Boolean))] as string[] : [];
  if (!ids.length) return { ok: false, message: "Tick at least one document to send." };
  if (ids.length > 60) return { ok: false, message: "That is too many documents for one pack: send it in two." };
  return { ok: true, toEmail, toName: clean(body?.toName, 120) || null, firm: clean(body?.firm, 160) || null, documentIds: ids, note: String(body?.note ?? "").trim().slice(0, 1500) || null };
}
