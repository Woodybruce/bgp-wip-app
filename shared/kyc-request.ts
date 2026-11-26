// The client checks request (in-app AML; Woody, 2026-11-17: the emails
// should "come from kyc@chatbgp.app", "copy the agent that has done the
// deal" and carry the BGP logo, and the old ones were "not that clear or
// user friendly"). What we ask a party's contact for, the page they land
// on, and every email and message that asks. Pure: the server sends these,
// the client page and the admin preview read them, the tests run them.

import type { KycRedFlag } from "./kyc-red-flags";
import { kycWorkOpening, kycWorkReminder, publicBodyNoun, type KycWork, type KycWordsPart } from "./kyc-work-words";

export type KycDocKey = "photo_id" | "proof_of_address" | "source_of_funds" | "ownership" | "owner_ids" | "authority" | "company_documents"
  // A trust's own documents (Jack, 23 November 2026: trusts checked by BGP, not KYC4U).
  | "trust_deed" | "trust_people" | "trs_excerpt" | "trust_authority" | "trust_wealth" | "certified_ids" | "other";
export type KycPartyKind = "individual" | "company";

// A request of a person's own (Woody, 19 November 2026, agreeing "a list of
// people to check for each party: the owners and the person acting, each with
// their own Veriff link and a proof-of-address upload; the directors shown
// with their sanctions result only"). Set on the request when it is for one
// of the people a company's checks are about, not for the company itself.
// "joint": someone named on the deal alongside a private individual (two
// people buying together before any company is set up; Jack, 20 November 2026).
// The trust roles (23 November 2026): the people a trust's structure records
// (shared/trust-structure.ts), each with their own checks.
// guarantor: a person who guarantees the party; guarantor_owner: someone who
// owns or controls a company that guarantees it (23 November 2026; HMRC
// AMLG2300 s18: a guarantor is a party to the tenancy and a customer).
// signer: a person who signs for the party too; signer_owner: someone who owns
// or controls another company that signs for it (24 November 2026).
export type KycPersonRole = "owner" | "acting" | "director" | "joint" | "settlor" | "trustee" | "protector" | "beneficiary" | "controller" | "guarantor" | "guarantor_owner" | "signer" | "signer_owner";
export const TRUST_PERSON_ROLES: readonly KycPersonRole[] = ["settlor", "trustee", "protector", "beneficiary", "controller"];
export interface KycRequestPerson {
  key: string;
  name: string;
  roles: KycPersonRole[];
  // How they own or control the company, as the register gives it.
  detail?: string | null;
}
const withoutPrivateMark = (name: string) => name.replace(/\s*\((private|private client|individual)\)\s*$/i, "").trim() || name;
export const kycPersonRoleWords = (roles: KycPersonRole[], partyName: string): string =>
  roles.includes("settlor") ? `the settlor of ${partyName}`
    : roles.includes("trustee") ? `a trustee of ${partyName}`
    : roles.includes("protector") ? `the protector of ${partyName}`
    : roles.includes("beneficiary") ? `a beneficiary of ${partyName}`
    : roles.includes("controller") ? `someone with control of ${partyName}`
    : roles.includes("guarantor") ? `the guarantor for ${withoutPrivateMark(partyName)}`
    : roles.includes("signer") ? `signing with ${withoutPrivateMark(partyName)}`
    : roles.includes("owner") ? `an owner of ${partyName}`
    : roles.includes("guarantor_owner") ? `an owner of the company guaranteeing ${partyName}`
    : roles.includes("signer_owner") ? `an owner of a company signing with ${partyName}`
    : roles.includes("joint") ? `named on this transaction alongside ${withoutPrivateMark(partyName)}`
    : roles.includes("acting") ? `the person dealing with us for ${partyName}` : `a director of ${partyName}`;

// Jack's lists for certified copies (23 November 2026).
export const CERTIFIED_LIST_A = [
  "a current, valid and signed full passport",
  "a valid photocard driving licence (not an old-style paper licence)",
  "a residence permit issued by the Home Office",
];
export const CERTIFIED_LIST_B = [
  "a utility bill less than 3 months old showing their current address",
  "a council tax bill less than 3 months old showing their current address",
];
// Optional documents every request also takes (the joint agent's aside).
export const TRUST_OPTIONAL_DOCS: KycDocKey[] = ["certified_ids"];

export const KYC_DOC_KEYS: KycDocKey[] = ["photo_id", "proof_of_address", "source_of_funds", "ownership", "owner_ids", "authority", "company_documents", "trust_deed", "trust_people", "trs_excerpt", "trust_authority", "trust_wealth", "certified_ids", "other"];

// docType is what the file is filed as on the client's KYC record, the
// types the KYC pack intake already uses (a driving licence files as
// "passport" there too), so the checklist reads them the same way.
// Checked against HMRC's guidance for supervised businesses on 17 November
// 2026: the identity documents HMRC lists (AMLG11400 14.2), a certified copy
// when the original is not seen (14.4), the address documents it names
// (14.2), beneficial owners as "more than 25%" or control (MLR 2017 reg 5),
// authority to act for a company (14.7), an overseas company's register
// extract (14.8), and source of funds as where the money comes from, not
// only the bank it is paid from (AMLG11630).
export const KYC_DOCS: Record<KycDocKey, { title: string; detail: string; docType: string }> = {
  photo_id: {
    title: "Photo ID (a certified copy)",
    detail: "Your passport, photocard driving licence, national identity card, or firearms or shotgun certificate, in date. As we have not met you to see the original, please send a copy certified by a practising solicitor or accountant who has met you, with the words \"I have met the person concerned and confirm the likeness to the photo ID provided\", their name and signature, the date, their professional body, and their firm's name and registered office. Or show the original to your agent.",
    docType: "passport",
  },
  // A utility bill, bank statement or council tax bill, not more than three
  // months old (this year's for council tax); certified when the person lives
  // outside the UK. Or their photocard driving licence when it shows their
  // address (HMRC, AMLG11400 14.2: ID evidence, one document or more; Woody,
  // 25 November 2026: "mirror hmrc about proof of address").
  proof_of_address: {
    title: "Proof of address",
    detail: "A utility bill, bank or building society statement, council tax bill or mortgage statement dated in the last three months, showing your name and home address. Or your photocard driving licence, if it shows your current address. If you live outside the UK, send a copy certified \"as a true copy of the original\" by a practising solicitor or accountant, with their name, signature, the date, their professional body and their firm.",
    docType: "proof_of_address",
  },
  source_of_funds: {
    title: "Where the money is coming from",
    detail: "Something showing where the money comes from, not only which bank it is paid from: a bank statement, a mortgage or loan offer, the sale of another property, or a letter from your accountant or solicitor. For a company, its latest accounts or a bank statement.",
    docType: "source_of_funds",
  },
  ownership: {
    title: "Who owns the company",
    detail: "A structure chart up to the people at the top: everyone who owns or controls more than 25% of the company's shares or votes, directly or through other companies, and anyone who controls the company in another way.",
    docType: "ubo_declaration",
  },
  owner_ids: {
    title: "ID and proof of address for each of those owners",
    detail: "For each person on that list: a passport, photocard driving licence, national identity card or firearms certificate, and a proof of address from the last three months. Clear copies are fine to start with; owners who live outside the UK send certified copies, and we may ask for them from others.",
    docType: "passport",
  },
  authority: {
    title: "Confirmation you can act for the company",
    detail: "If you are not one of its directors: an email or letter from a director confirming that you can deal with us for the company, or our terms of engagement signed for the company.",
    docType: "authority_to_act",
  },
  company_documents: {
    title: "Company register extract",
    detail: "Only if the company is registered outside the UK: an extract from its official company register, issued in the last three months, showing its registration number, its directors and its shareholders. It can be in any language: we translate it. If it is registered at Companies House as an overseas entity, give that number too.",
    docType: "company_cert",
  },
  // A trust (BGP's trust checklist, items 1, 2, 4 and 8; MLR 2017 reg 6).
  trust_deed: {
    title: "The trust deed",
    detail: "A copy of the trust deed, with any deeds of appointment, retirement or variation since: it shows the settlor, the trustees, the beneficiaries and anyone else with control, such as a protector. As we have not seen the original, please send a copy certified by a practising solicitor or accountant as \"a true copy of the original\", with their name, signature, the date, their professional body and their firm.",
    docType: "trust_deed",
  },
  // Who is who today (23 November 2026): the deed may predate the trustees
  // now acting, and the people each get a link of their own from it.
  trust_people: {
    title: "Who is who in the trust",
    detail: "A list of the trust's settlor, its trustees now, any protector, and its beneficiaries (or how the deed describes them, such as \"the settlor's grandchildren\"), with each person's full name, date of birth, home address and email, and for a company its name and registration number. A letter or email from the trustees or the trust's solicitor or accountant is fine.",
    docType: "trust_structure",
  },
  trs_excerpt: {
    title: "HMRC's proof of registration",
    detail: "The trust's proof of registration from HMRC's Trust Registration Service (the trustees can download it from their HMRC online account), or a line from the trustees or their adviser saying why the trust does not need to register.",
    docType: "trs_excerpt",
  },
  trust_authority: {
    title: "Confirmation the trustees instruct us",
    detail: "If you are not one of the trustees: an email or letter from the trustees confirming that you can deal with us for the trust, or our terms of engagement signed by them.",
    docType: "authority_to_act",
  },
  trust_wealth: {
    title: "Where the trust's money came from",
    detail: "How the settlor came to have the money or property put into the trust (savings, the sale of a business or property, an inheritance), with something showing it: a letter from the trust's accountant or solicitor, a completion statement or a will.",
    docType: "source_of_wealth",
  },
  // Certified copies in place of the online check (Jack, 23 November 2026):
  // optional on a trust's documents request, never one of its required
  // documents; an officer accepts them against each person.
  certified_ids: {
    title: "Certified ID (optional)",
    detail: "Upload each person's certified List A document here, and a List B document for anyone we ask for a proof of address. Name each file after the person if you can.",
    docType: "certified_id",
  },
  other: {
    title: "Anything else",
    detail: "Anything else your agent has asked you for.",
    docType: "other",
  },
};

// What "Request trust structure" asks for (Jack, 23 November 2026: "Request
// Trust Structure and it then emails the trust's representative ... requesting
// the specific documents we need"). The trust's people then each get a link
// of their own for their identity check and proof of address.
export const TRUST_REQUEST_DOCS: KycDocKey[] = ["trust_deed", "trust_people", "trs_excerpt", "trust_wealth", "trust_authority"];
/** The optional certified copies card for a listed company or public body: identity only. */
export const CERTIFIED_IDS_A_ONLY = "Upload each person's certified List A document here. Name each file after the person if you can.";

/**
 * Who sends a proof of address: everyone whose identity is checked (Jack,
 * Nominated Officer, 26 November 2026: "Reasonable measures to verify identity
 * in my view includes proof of address ... applied back to all checks ... The
 * only time we need ID only by itself is Listed Businesses"). Owners, the
 * person acting, a trust's people, a private individual, a person who signs or
 * guarantees. This goes further than HMRC's minimum on purpose and replaces
 * Woody's rule of 25 November 2026 (only a customer in person).
 *
 * Never the person acting who is nothing else (Jack, later the same day:
 * "We dont check agents or representatives for ID and proof or address ...
 * we only check ID and proof of address for the Ultimate Beneficial Owners"):
 * an agent, a solicitor or a representative sends no proof of address, for
 * any party. An owner who is also the person acting still does.
 */
export function owesProofOfAddress(kind: KycPartyKind, roles: Iterable<KycPersonRole>, _idOnly = false): boolean {
  const set = new Set(roles);
  // A private individual is the party in person, whatever their row says.
  if (kind === "individual") return true;
  if (set.size && [...set].every(r => r === "acting" || r === "director")) return false;
  return true;
}

/** Why the person acting for a listed company gives their identity alone. */
export const LISTED_ID_ONLY = "A listed company: the person dealing with us gives their identity check and their authority to act, with no proof of address.";
/** Why the person dealing with us for a company or a trust is not asked for a proof of address. */
export const REPRESENTATIVE_NO_ADDRESS = "The person dealing with us is a representative, not an owner: no proof of address is asked of them. Each owner sends their own.";
/** Why someone is not asked for a proof of address. */
export const NO_ADDRESS_WORDS = "A proof of address is for the owners and the party in person, not for an agent or representative acting for them.";

/** Why authority to act is not asked for: our signed terms of engagement are on file (25 November 2026). */
export const termsAuthorityWords = (summary: string): string =>
  `Our signed terms of engagement are on file (${summary}): HMRC accepts them as evidence of authority to act.`;

export const isKycDocKey = (value: unknown): value is KycDocKey => typeof value === "string" && (KYC_DOC_KEYS as string[]).includes(value);

// What a request asks for unless the agent changes it. Photo ID is asked
// for as a document only when there is no online identity check. A company
// is checked at Companies House by the app, so only what is not filed there
// is asked for, with the dealing person's authority to act. Only a private
// individual sends a proof of address: HMRC asks the person dealing with us
// for a company or a trust for their identity and authority, and the owners
// for their identity (Woody, 25 November 2026: "mirror hmrc about proof of
// address we dont want to request more than we need"). Where the money
// comes from is asked of whoever pays: a buyer, and a tenant (HMRC's letting
// guidance, AMLG2300 section 21: "all customers making a payment").
export function defaultKycDocs(kind: KycPartyKind, role: string | null | undefined, idCheck: boolean, trust = false, publicBody = false): KycDocKey[] {
  // A UK public body (Layla, 23 November 2026, The Crown Estate): simplified
  // due diligence. Only proof that the person instructing us can act for it.
  if (kind === "company" && publicBody) return ["authority"];
  const docs: KycDocKey[] = [];
  if (!idCheck) docs.push("photo_id");
  // A trust (23 November 2026): its deed, HMRC's registration, the trustees'
  // instruction and the settlor's wealth. Its people each get their own link.
  // A proof of address is the party's own or an owner's (Jack, 26 November
  // 2026), never a representative's: precheckAsks adds it when the person
  // asked for a company is one of its owners.
  if (kind === "individual") docs.push("proof_of_address");
  if (kind === "company" && trust) docs.push("trust_deed", "trs_excerpt", "trust_authority", "trust_wealth");
  else if (kind !== "individual") docs.push("ownership", "owner_ids", "authority");
  if (["purchaser", "tenant"].includes(String(role || "").toLowerCase())) docs.push("source_of_funds");
  return docs;
}

// The one question every request asks (HMRC, AMLG11650: "Asking your
// customer" is one way to find a politically exposed person; the app's
// screening is the other). A yes or a not sure means enhanced due
// diligence: MLRO (senior management) approval before going ahead, and the
// source of wealth and of funds.
export type KycPepAnswer = "no" | "yes" | "unsure";
export interface KycAnswers {
  pep: KycPepAnswer | null;
  pepDetail: string | null;
  answeredAt: string | null;
}
// The words follow the legal definition (MLR 2017 reg 35(12)-(14)) and no
// wider: the FCA found firms using definitions "wider than we would have
// expected" (FG25/3, which replaced FG17/6, and its July 2024 review).
// Family is a spouse or partner, a child and their spouse or partner, and a
// parent; not a brother or sister. Twelve months after leaving office
// (reg 35(9)).
export const KYC_PEP_QUESTION = {
  title: "One question about public roles",
  individual: "Do you hold a prominent public role, or have you in the last 12 months? Or are you the spouse or partner, child (or child's spouse or partner) or parent of someone who does, or a known close business associate of theirs?",
  company: "Does anyone who owns or controls the company, or you, hold a prominent public role, or have they in the last 12 months? Or is any of you the spouse or partner, child (or child's spouse or partner) or parent of someone who does, or a known close business associate of theirs?",
  examples: "Prominent public roles are, in the UK or abroad: head of state or government, minister, member of parliament, member of a political party's governing body, judge of a supreme or constitutional court, member of a court of auditors or of a central bank's board, ambassador, high-ranking officer in the armed forces, board member of a state-owned company, or director of an international organisation. Middle-ranking and junior officials are not included.",
};
export const isKycPepAnswer = (value: unknown): value is KycPepAnswer => value === "no" || value === "yes" || value === "unsure";

// The owners Companies House lists, shown to the client to confirm instead
// of asking for a chart (Woody, 2026-11-17: ask only what is left). HMRC,
// AMLG11400 14.8: the register alone is not enough, and a difference the
// client tells us about is reported to Companies House.
export type KycOwnersAnswer = "yes" | "no";
export interface KycOwnersReply { answer: KycOwnersAnswer; detail: string | null; answeredAt: string }
export const isKycOwnersAnswer = (value: unknown): value is KycOwnersAnswer => value === "yes" || value === "no";
export const KYC_OWNERS_QUESTION = {
  title: "Confirm who owns the company",
  step: "We have read the company's owners from Companies House. Check the list and tell us if it is right. One click.",
  intro: "Companies House lists these as having significant control of the company: owning or controlling more than 25% of its shares or votes, or controlling it in another way. Is this list right and up to date?",
  no: "Tell us who owns or controls the company now, and what has changed.",
};
export const kycOwnersWords = (answer: KycOwnersAnswer | null | undefined): string =>
  answer === "yes" ? "Confirmed the owners on the register" : answer === "no" ? "Said the owners on the register are not right" : "Not answered";
export const kycPepWords = (answer: KycPepAnswer | null | undefined): string =>
  answer === "no" ? "No" : answer === "yes" ? "Yes" : answer === "unsure" ? "Not sure" : "Not answered";

// When HMRC expects each party's checks (AMLG2200 sections 15 and 17, estate
// agency; AMLG2300 section 19, letting agency).
export const KYC_TIMING: Record<string, string> = {
  landlord: "Due before you agree terms of engagement and before the unit is marketed.",
  tenant: "Due once the landlord accepts their offer, and before any agreement or contract. No deposit before then.",
  vendor: "Due as soon as possible after first contact, before the property is marketed.",
  purchaser: "Due before an offer is accepted, and at the latest before exchange.",
};
// A letting is in scope at a rent of £10,000 a month or more for at least
// part of the term, turnover rent included (AMLG2300 sections 2, 11, 12).
// Sanctions have no threshold: estate agents, and letting agents since
// 14 May 2025, must report a designated person to OFSI (OFSI's guidance for
// letting agents; the UK Sanctions List is the one list since 28 January 2026).
export const KYC_LETTING_SCOPE = "Lettings need these checks at £10,000 a month or more, turnover rent included; every sale does. Sanctions apply whatever the rent: report a listed person to OFSI.";
export const KYC_PRIVACY_URL = "https://www.brucegillinghampollard.com/privacy/";

// Every request has a short code that goes in the subject line, so a reply
// with documents attached finds its request. Six letters and digits with
// the easily confused ones (0/O, 1/I/L) left out.
export const KYC_REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
// The reference sits at the end of the subject as a small tag, [7K2Q9M]
// (Woody, 23 November 2026: "keep it but make it small it's only for our
// use"); emails sent before then end "(ref 7K2Q9M)", and replies to them
// still carry it, so both are read. The last one in the subject counts.
export const KYC_REF_RE = /\(ref ([2-9A-HJKMNP-Z]{6})\)|\[([2-9A-HJKMNP-Z]{6})\]/gi;
export function kycRefFromSubject(subject: string | null | undefined): string | null {
  let last: string | null = null;
  for (const m of String(subject || "").matchAll(KYC_REF_RE)) last = String(m[1] || m[2]).toUpperCase();
  return last;
}

export interface KycAgent {
  name: string;
  email: string | null;
  phone: string | null;
}

// The state of the online identity check, as the client page shows it.
export type KycIdState = "not_started" | "started" | "submitted" | "approved" | "retry" | "restart";

// Veriff's session statuses and event actions, read as one state.
export function kycIdStateFor(status: string | null | undefined): KycIdState {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "submitted" || s === "review") return "submitted";
  if (s === "resubmission_requested") return "retry";
  if (s === "declined" || s === "expired" || s === "abandoned") return "restart";
  if (s === "started") return "started";
  return "not_started";
}

export interface KycEmailContext {
  recipientName: string | null;
  partyName: string;
  kind: KycPartyKind;
  dealName: string;
  ref: string;
  link: string;
  expiresAt: Date | string;
  needsIdCheck: boolean;
  docs: KycDocKey[];
  note?: string | null;
  noteFrom?: string | null;            // who typed the note (the person who sent the request)
  agents: KycAgent[];
  // The mailbox the email goes from, named in the footer.
  sentFrom: string;
  test?: boolean;
  // A test an admin sent to a colleague: the admin's name, for the banner
  // (it is copied to the admin, so "nothing sent to anyone else" is wrong).
  testBy?: string | null;
  // The question about public roles (asked on every request since
  // 17 November 2026; absent on older rows, which did not ask it).
  askPep?: boolean;
  // The owners on the register, to confirm (BGP's checks before asking).
  confirmOwners?: Array<{ name: string; detail: string }> | null;
  // The people whose ID is asked for, where the register names them.
  ownerNames?: string[] | null;
  // Companies registered abroad that own the company: the structure chart is
  // to show who owns them (20 November 2026).
  ownersAbroad?: Array<{ name: string; country: string }> | null;
  // What was not asked and why: a listed company's request lists no List B.
  notAsked?: Array<{ key: KycDocKey; reason: string }> | null;
  // A person's own request: who they are to the company (19 November 2026).
  person?: { roles: KycPersonRole[] } | null;
  // The owners the person acting is asked to pass a link of their own to.
  ownLinksFor?: string[] | null;
  // Sent at the request of the party's own agent, who passed the checks on
  // from their page (Woody, 23 November 2026).
  passedOnBy?: { name: string | null; firm: string } | null;
  // A request for a trust's documents (23 November 2026), not identity checks.
  purpose?: "trust_structure" | null;
  // What the request says about the work: our client or the other side, the
  // place and the transaction spelt out (25 November 2026). Absent on older rows.
  work?: KycWork | null;
}

// Who hears back from a request (the agents' Finished note, a red-flag
// alert): its copy list, the deal's agents and whoever sent it, never the
// client. A test an admin sent to themselves has no copy list and goes back
// to its own address; one sent to a colleague is copied to the admin, who
// hears back as the agent.
export function kycReplyAddresses(row: { is_test: boolean | null; contact_email: string | null }, cc: unknown): string[] {
  const copied = Array.isArray(cc) ? cc.filter((address): address is string => typeof address === "string") : [];
  return row.is_test && !copied.length ? [row.contact_email || ""] : copied;
}

// Sending client checks waits for BGP's checks before asking: what to ask
// follows from what they read on the register (24 November 2026, #4664).
export const kycChecksRunningWords = (party: string): string =>
  `BGP's checks are still reading Companies House for ${party}. What to ask follows from what they find: wait a minute and send again.`;
export const KYC_CHECKS_UPDATED_WORDS = "BGP's checks have read Companies House since this window opened, so what to ask has changed. Check the list and send again.";
/** Was a list made when BGP's checks last finished at `basedOn` (null: none
 * had) out of date because a later run has finished since? */
export function listMadeBeforeChecks(basedOn: string | null, latestRanAt: string | null): boolean {
  const latest = latestRanAt ? Date.parse(latestRanAt) : NaN;
  if (!Number.isFinite(latest)) return false;
  const seen = basedOn ? Date.parse(basedOn) : NaN;
  return !Number.isFinite(seen) || seen < latest;
}

// Who is copied on an AML email: the copy list it was given, then the AML
// officers (the Nominated Officer and the Deputies), on every AML email that
// goes out (Woody, 24 November 2026: "can you have layla, jack and I copied
// in on all emails sent out for AML"). Each address once, never one the email
// is sent to, and an officer only at BGP's own domain.
export function kycCopyList(to: string[], cc: string[], officers: string[]): string[] {
  const clean = (value: unknown) => String(value || "").trim().toLowerCase();
  const valid = (value: string) => /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(value);
  const sentTo = new Set(to.map(clean));
  const out: string[] = [];
  for (const address of [...cc.map(clean), ...officers.map(clean).filter(a => a.endsWith("@brucegillinghampollard.com"))]) {
    if (valid(address) && !sentTo.has(address) && !out.includes(address)) out.push(address);
  }
  return out;
}

export const KYC_LOGO_CID = "bgp-logo";
const ACCENT = "#6E0C25", INK = "#1a1a1a", BODY = "#3d3d3d", MUTED = "#6b6b6b", RULE = "#e3ddd8", PAGE = "#f4f1ee";
const FONT = "Arial,Helvetica,sans-serif";

export function escHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// An address in an href: only https links, escaped. Anything else is
// dropped rather than written into an email.
function safeHref(url: string): string {
  return /^https:\/\//i.test(url) ? escHtml(url) : "#";
}

export function kycLongDate(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
}

const firstName = (name: string | null | undefined): string => String(name || "").trim().split(/\s+/)[0] || "";

function greeting(name: string | null | undefined): string {
  const first = firstName(name);
  return first ? `Hello ${escHtml(first)},` : "Hello,";
}

// "Jack Smith on 07700 900123 or jack@…", for up to two people. Since
// 23 November 2026 the server passes the Nominated Officer alone (Jack: "I
// need to be the only person referenced under 'Questions?'").
function agentContactHtml(agents: KycAgent[]): string {
  const shown = agents.filter(a => a.name).slice(0, 2);
  if (!shown.length) return "your contact at Bruce Gillingham Pollard";
  const one = (a: KycAgent) => {
    const ways = [
      a.phone ? `<a href="tel:${escHtml(a.phone.replace(/[^0-9+]/g, ""))}" style="color:${ACCENT};text-decoration:none">${escHtml(a.phone)}</a>` : "",
      a.email ? `<a href="mailto:${escHtml(a.email)}" style="color:${ACCENT};text-decoration:none">${escHtml(a.email)}</a>` : "",
    ].filter(Boolean);
    return `<strong>${escHtml(a.name)}</strong>${ways.length ? ` on ${ways.join(" or ")}` : ""}`;
  };
  return shown.map(one).join(", or ");
}

// The Questions? line. With nobody named it reads "Reply to this email."
// (it read "Speak to reply to this email." until 25 November 2026).
function questionsLine(agents: KycAgent[]): string {
  // Never "reply to this email" (Woody, 25 November 2026: "should ask layla or jack"): the server names them.
  return `Speak to ${agentContactHtml(agents)}.`;
}

function agentNamesText(agents: KycAgent[]): string {
  const names = agents.map(a => a.name).filter(Boolean).slice(0, 2);
  return names.length ? names.join(" and ") : "your contact at Bruce Gillingham Pollard";
}

// The steps a request asks for, in the order the client page shows them.
// The owner IDs step names the owners when the register gave them.
export function kycDocDetail(key: KycDocKey, ownerNames?: string[] | null, ownersAbroad?: Array<{ name: string; country: string }> | null): string {
  const names = (ownerNames || []).filter(Boolean);
  const abroad = (ownersAbroad || []).filter(o => o?.name);
  if (key === "ownership" && abroad.length) {
    const which = abroad.map(o => `${o.name} (${o.country})`);
    const who = which.length === 1 ? which[0] : `${which.slice(0, -1).join(", ")} and ${which[which.length - 1]}`;
    return `${KYC_DOCS.ownership.detail} Companies House shows ${who} owns the company, and it cannot show who owns ${abroad.length === 1 ? "that company" : "those companies"}: please show the people behind ${abroad.length === 1 ? "it" : "them"}, with an extract from ${abroad.length === 1 ? "its" : "each one's"} own company register.`;
  }
  if (key !== "owner_ids" || !names.length) return KYC_DOCS[key].detail;
  const who = names.length > 6 ? `${names.slice(0, 6).join(", ")} and ${names.length - 6} more` : names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return KYC_DOCS.owner_ids.detail.replace("For each person on that list", `For ${who}`);
}

// A document step's words. A UK public body is asked who may act for it, never
// for a director (25 November 2026: Wirral Metropolitan Borough Council).
export function kycDocWords(key: KycDocKey, o: { ownerNames?: string[] | null; ownersAbroad?: Array<{ name: string; country: string }> | null; publicBody?: boolean; partyName?: string }): { title: string; detail: string } {
  if (key === "authority" && o.publicBody) {
    const noun = publicBodyNoun(o.partyName || "");
    return { title: `Confirmation you can act for ${noun}`, detail: `An email or letter from someone authorised at ${noun} confirming that you can deal with us for it, or our terms of engagement signed for it.` };
  }
  return { title: KYC_DOCS[key].title, detail: kycDocDetail(key, o.ownerNames, o.ownersAbroad) };
}

// The owners' own links (19 November 2026): each owner does their own
// identity check, on a page of their own (no proof of address since
// 25 November 2026: HMRC asks the owners for their identity only).
export const KYC_OWNER_LINKS_TITLE = "Pass each owner their own link";
export const kycOwnerLinksDetail = (names: string[]): string => {
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${who} ${names.length === 1 ? "does their" : "each do their"} own identity check, on a page of their own. Your page has a link for ${names.length === 1 ? "them" : "each of them"}, or give us ${names.length === 1 ? "their email address" : "their email addresses"} there and we'll send it.`;
};

export function kycSteps(ctx: Pick<KycEmailContext, "needsIdCheck" | "docs" | "askPep" | "confirmOwners" | "ownerNames" | "ownLinksFor" | "ownersAbroad"> & { kind?: KycPartyKind; work?: KycWork | null; partyName?: string }): Array<{ title: string; detail: string }> {
  const steps: Array<{ title: string; detail: string }> = [];
  if (ctx.needsIdCheck) {
    steps.push({ title: "A quick identity check", detail: "On your phone or computer: a photo of your passport, driving licence or identity card and a short selfie. It takes about two minutes." });
  }
  // The owners to confirm come before the owners' IDs, which refer to them.
  const owners = ctx.confirmOwners?.length ? { title: KYC_OWNERS_QUESTION.title, detail: KYC_OWNERS_QUESTION.step } : null;
  if (owners) steps.push(owners);
  if (ctx.ownLinksFor?.length) steps.push({ title: KYC_OWNER_LINKS_TITLE, detail: kycOwnerLinksDetail(ctx.ownLinksFor) });
  for (const key of ctx.docs) steps.push(kycDocWords(key, { ownerNames: ctx.ownerNames, ownersAbroad: ctx.ownersAbroad, publicBody: !!ctx.work?.publicBody, partyName: ctx.partyName || "" }));
  if (ctx.askPep) {
    // A public body has no owners: the question is about the person dealing with us.
    steps.push({ title: KYC_PEP_QUESTION.title, detail: ctx.kind === "individual" || ctx.work?.publicBody
      ? "Whether you hold a prominent public role, or are the spouse, partner, child or parent, or a close business associate, of someone who does. One click."
      : "Whether you, or anyone who owns the company, holds a prominent public role, or is the spouse, partner, child or parent, or a close business associate, of someone who does. One click." });
  }
  return steps;
}

function button(label: string, link: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 10px"><tr><td style="background:${ACCENT};border-radius:4px">
<a href="${safeHref(link)}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">${escHtml(label)}</a>
</td></tr></table>`;
}

function stepsList(steps: Array<{ title: string; detail: string }>): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:6px 0 4px">${steps.map((step, i) => `<tr>
<td style="width:30px;vertical-align:top;padding:8px 0"><div style="width:22px;height:22px;line-height:22px;border-radius:11px;background:${ACCENT};color:#ffffff;font-family:${FONT};font-size:12px;font-weight:bold;text-align:center">${i + 1}</div></td>
<td style="vertical-align:top;padding:8px 0;font-family:${FONT};font-size:15px;line-height:1.5;color:${INK}"><strong>${escHtml(step.title)}</strong><br><span style="color:${BODY};font-size:14px">${escHtml(step.detail)}</span></td>
</tr>`).join("")}</table>`;
}

// One frame for every email: the logo, a bordeaux rule, the body, a quiet
// footer that says where the email came from.
function frame(title: string, inner: string, footer: string, test: boolean | undefined, whoReceives = "a client receives", testBy?: string | null): string {
  const said = testBy
    ? `${escHtml(testBy)} sent this to try the client checks: it is what a client receives. No client has been sent anything.`
    : `This is what ${escHtml(whoReceives)}. Nothing has been sent to anyone else.`;
  const banner = test
    ? `<tr><td style="background:#fff4d6;padding:10px 32px;font-family:${FONT};font-size:13px;color:#6b4e00"><strong>Test email.</strong> ${said}</td></tr>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${PAGE}">
<div style="background:${PAGE};padding:24px 12px">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:100%;max-width:600px;margin:0 auto;background:#ffffff;border-collapse:collapse">
${banner}
<tr><td style="padding:28px 32px 20px;border-bottom:3px solid ${ACCENT}"><img src="cid:${KYC_LOGO_CID}" alt="Bruce Gillingham Pollard" width="122" height="48" style="display:block;border:0;outline:none;width:122px;height:48px"></td></tr>
<tr><td style="padding:28px 32px 12px;font-family:${FONT};font-size:15px;line-height:1.55;color:${INK}">
${inner}
</td></tr>
<tr><td style="padding:16px 32px 26px;border-top:1px solid ${RULE};font-family:${FONT};font-size:11px;line-height:1.5;color:${MUTED}">${footer}</td></tr>
</table>
</div>
</body></html>`;
}

const p = (html: string, style = "") => `<p style="margin:0 0 14px;${style}">${html}</p>`;
const h2 = (text: string) => `<h2 style="margin:22px 0 6px;font-family:${FONT};font-size:15px;color:${INK}">${escHtml(text)}</h2>`;

function footerFor(ctx: Pick<KycEmailContext, "sentFrom" | "ref" | "agents">): string {
  return `Bruce Gillingham Pollard. Sent from ${escHtml(ctx.sentFrom)} for ${escHtml(agentNamesText(ctx.agents))}. If you were not expecting this email, please reply and let us know. <span style="font-size:10px;color:#b5ada8">${escHtml(ctx.ref)}</span>`;
}

function linkFallback(link: string): string {
  if (!/^https:\/\//i.test(link)) return "";
  return p(`If the button does not work, copy this address into your browser:<br><a href="${safeHref(link)}" style="color:${ACCENT};word-break:break-all">${escHtml(link)}</a>`, `font-size:12px;color:${MUTED}`);
}

// Regulation 41 of the Money Laundering Regulations 2017: a new customer is
// told their data is used only to prevent money laundering and terrorist
// financing, and where the GDPR information is (the privacy notice). The
// five years run from the end of the relationship (HMRC, AMLG11700).
export const KYC_WHY_WE_ASK = "The Money Laundering Regulations require estate and letting agents to confirm who they are dealing with.";
export const KYC_DATA_USE = "We use what you send only to prevent money laundering and terrorist financing, and keep it securely for five years after our work with you ends.";
const whyWeAsk = () => h2("Why we ask") + p(`${escHtml(KYC_WHY_WE_ASK)} ${escHtml(KYC_DATA_USE)} Our <a href="${escHtml(KYC_PRIVACY_URL)}" style="color:${ACCENT}">privacy notice</a> has more.`, `font-size:13px;color:${BODY}`);

// The note is from whoever typed it, the person who sent the request (Jack,
// 23 November 2026: his note read "A note from Charlotte", the first agent on
// the transaction). Never the first name on the contact list.
function noteBlock(note: string | null | undefined, noteFrom: string | null | undefined): string {
  const text = String(note || "").trim();
  if (!text) return "";
  const from = firstName(noteFrom) || "Bruce Gillingham Pollard";
  return `<div style="margin:18px 0;padding:12px 16px;border-left:3px solid ${ACCENT};background:#faf7f5;font-size:14px;color:${BODY}"><strong style="color:${INK}">A note from ${escHtml(from)}:</strong><br>${escHtml(text).replace(/\r?\n/g, "<br>")}</div>`;
}

const subjectFor = (ctx: Pick<KycEmailContext, "dealName" | "ref" | "test"> & { work?: KycWork | null }, lead: string) =>
  `${ctx.test ? "[Test] " : ""}${lead} ${ctx.work?.place || ctx.dealName} [${ctx.ref}]`;

// Parts to HTML, bold where marked.
const partsHtml = (parts: KycWordsPart[]): string => parts.map(x => x.strong ? `<strong>${escHtml(x.text)}</strong>` : escHtml(x.text)).join("");
// The request asks about the company's owners.
export const kycAsksOwners = (ctx: Pick<KycEmailContext, "docs" | "confirmOwners" | "ownLinksFor">): boolean =>
  ctx.docs.includes("ownership") || ctx.docs.includes("owner_ids") || !!ctx.confirmOwners?.length || !!ctx.ownLinksFor?.length;

// The first email: what we need, one button to the client's own page.
export function kycRequestEmail(ctx: KycEmailContext): { subject: string; html: string } {
  if (ctx.purpose === "trust_structure") return trustDocsRequestEmail(ctx);
  const steps = kycSteps(ctx);
  const forWhom = ctx.kind === "company"
    ? ` That's you, for <strong>${escHtml(ctx.partyName)}</strong>, and the company's owners.`
    : "";
  // A person's own request: an owner may not know the deal at all.
  const opening = ctx.person?.roles.includes("guarantor")
    ? `You're named as the guarantor for <strong>${escHtml(withoutPrivateMark(ctx.partyName))}</strong> on <strong>${escHtml(ctx.dealName)}</strong>. The law requires us to confirm your identity too.`
    : ctx.person?.roles.includes("owner")
    ? `Companies House lists you as someone who owns or controls ${escHtml(ctx.partyName)}, a party to <strong>${escHtml(ctx.dealName)}</strong>. The law requires us to confirm your identity too.`
    : ctx.person?.roles.includes("guarantor_owner")
    ? `Companies House lists you as someone who owns or controls the company guaranteeing ${escHtml(ctx.partyName)} on <strong>${escHtml(ctx.dealName)}</strong>. The law requires us to confirm your identity too.`
    : ctx.person?.roles.includes("signer")
    ? `You're named as signing with <strong>${escHtml(withoutPrivateMark(ctx.partyName))}</strong> on <strong>${escHtml(ctx.dealName)}</strong>. The law requires us to confirm your identity too.`
    : ctx.person?.roles.includes("signer_owner")
    ? `Companies House lists you as someone who owns or controls a company signing with ${escHtml(ctx.partyName)} on <strong>${escHtml(ctx.dealName)}</strong>. The law requires us to confirm your identity too.`
    : ctx.person?.roles.includes("joint")
      ? `You're named alongside <strong>${escHtml(withoutPrivateMark(ctx.partyName))}</strong> on <strong>${escHtml(ctx.dealName)}</strong>. The law requires us to confirm your identity too.`
    : ctx.person
      ? `You're dealing with us for <strong>${escHtml(ctx.partyName)}</strong> on <strong>${escHtml(ctx.dealName)}</strong>. The law requires us to confirm your identity.`
      : `Before <strong>${escHtml(ctx.dealName)}</strong> can go ahead, the law requires us to confirm who we're dealing with.${forWhom}`;
  // Our client, or the other side, in their own words (25 November 2026).
  const workParas = ctx.work && !ctx.person ? kycWorkOpening(ctx.work, { name: ctx.partyName, kind: ctx.kind }, kycAsksOwners(ctx)) : null;
  const companiesHouse = ctx.kind === "company" && !ctx.work?.publicBody
    ? p("We read the company's Companies House record ourselves.", `font-size:14px;color:${BODY}`)
    : "";
  const passedOn = ctx.passedOnBy
    ? p(`${ctx.passedOnBy.name ? `${escHtml(ctx.passedOnBy.name)} of <strong>${escHtml(ctx.passedOnBy.firm)}</strong>, your agent,` : `Your agent, <strong>${escHtml(ctx.passedOnBy.firm)}</strong>,`} asked us to send you this.`)
    : "";
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;color:${ACCENT}">Identity checks for ${escHtml(ctx.work?.place || ctx.dealName)}</h1>`,
    p(greeting(ctx.recipientName)),
    passedOn,
    p(`${workParas ? partsHtml(workParas[0]) : opening}${ctx.docs.includes("photo_id") ? "" : ` It should take about ${ctx.person ? "five" : "ten"} minutes.`}`),
    ...(workParas || []).slice(1).map(para => p(partsHtml(para))),
    h2("What we need from you"),
    stepsList(steps),
    companiesHouse,
    button("Start your checks", ctx.link),
    p(`Your personal link works until <strong>${escHtml(kycLongDate(ctx.expiresAt))}</strong>, on your phone or computer.`, `font-size:13px;color:${MUTED}`),
    h2("Or send certified copies"),
    p(escHtml(certifiedWords(ctx)), `font-size:14px;color:${BODY}`),
    certifiedLists(requestOwesProofOfAddress(ctx)),
    noteBlock(ctx.note, ctx.noteFrom),
    whyWeAsk(),
    h2("Questions?"),
    p(questionsLine(ctx.agents), `font-size:14px;color:${BODY}`),
    linkFallback(ctx.link),
  ].join("\n");
  return { subject: subjectFor(ctx, "Please complete your identity checks for"), html: frame("Identity checks", inner, footerFor(ctx), ctx.test, undefined, ctx.testBy) };
}

// A trust's documents (23 November 2026): who stands behind the trust, sent
// by its trustees, solicitor or accountant. Its people each get a link of
// their own for their identity check afterwards.
// What follows a trust's documents (Jack, 23 November 2026): each person's
// own link, or certified copies sent now. The email and the page say both.
export const TRUST_NEXT_WORDS = {
  links: "Once we have these, each trustee, the settlor and anyone else with control of the trust gets an email from us with their own secure link. It asks for a short online identity check and a proof of address (one document from List B below), and takes about five minutes on a phone. Please include each person's email address in the \"Who is who\" list so we can reach them.",
  certified: "Or, instead of the online check, you can upload certified copies for each of those people on the same page: one document from List A, certified. Either way, each person sends one document from List B as their proof of address.",
};
// Certified copies in place of the online check, on every request (Jack, 23
// November 2026: "these need to be sent on all AML request emails"). Who
// they are for depends on who is asked.
/** A request to a listed company or a UK public body: identity only, as recorded when it was made. */
type AddressCtx = { kind: KycPartyKind; person?: unknown; purpose?: string | null; notAsked?: Array<{ key: KycDocKey; reason: string }> | null; work?: { publicBody?: boolean } | null };
export function requestIsIdOnly(ctx: AddressCtx): boolean {
  if (ctx.work?.publicBody) return true;
  // A request made before 26 November 2026 says it by its ownership line.
  return (ctx.notAsked || []).some(n => (n.key === "proof_of_address" && (n.reason === LISTED_ID_ONLY || /^A UK public body/.test(n.reason)))
    || (n.key === "ownership" && /no beneficial owners to identify/.test(n.reason)));
}
/**
 * Whether a request asks for proofs of address (owesProofOfAddress; Jack,
 * 26 November 2026): every request does, except one to a listed company or a
 * UK public body. Its certified copies then take a List B (address) document.
 */
export function requestOwesProofOfAddress(ctx: AddressCtx): boolean {
  if (ctx.purpose === "trust_structure") return true;
  const roles = (ctx.person as { roles?: unknown } | null | undefined)?.roles;
  if (Array.isArray(roles)) return owesProofOfAddress(ctx.kind, roles as KycPersonRole[], requestIsIdOnly(ctx));
  return ctx.kind === "individual" || !requestIsIdOnly(ctx);
}
/** A request's document steps as asked now: a listed company's person acting is never asked a proof of address. */
export function docsStillAsked(request: AddressCtx & { docs: KycDocKey[] }): KycDocKey[] {
  return requestOwesProofOfAddress(request) ? request.docs : request.docs.filter(k => k !== "proof_of_address");
}
export function certifiedWords(ctx: AddressCtx): string {
  if (ctx.purpose === "trust_structure") return TRUST_NEXT_WORDS.certified;
  const listB = requestOwesProofOfAddress(ctx) ? ", and one from List B" : "";
  // A public body has no owners: the copies are for the person dealing with us (25 November 2026).
  if (ctx.person || ctx.kind === "individual" || ctx.work?.publicBody) return `Prefer not to do the online identity check? You can upload certified copies instead, on the same page: one document from List A, certified${listB}.`;
  return `Prefer not to do the online identity check? You can upload certified copies instead, on the same page, for yourself and for anyone who owns more than 25% of the company: for each person, one document from List A, certified${listB}.`;
}
// Who may certify and what the certification must carry (Jack, 23 November
// 2026; the details are HMRC's, AMLG11400). The app checks each copy against
// both (shared/kyc-documents.ts).
export const CERTIFIED_WHO = "Who can certify: a solicitor, lawyer or notary public, a chartered accountant, or a bank or building society official.";
export const CERTIFIED_HOW = "They write \"Certified to be a true copy of the original seen by me\" on the copy, sign and date it, and print their name, occupation, address and telephone number.";
const bullets = (items: string[]): string =>
  `<ul style="margin:0 0 6px 18px;padding:0;font-family:${FONT};font-size:14px;line-height:1.5;color:${BODY}">${items.map(i => `<li>${escHtml(i[0].toUpperCase() + i.slice(1))}</li>`).join("")}</ul>`;

const certifiedLists = (withB: boolean): string => [
  p(`<strong>List A</strong> (one, certified)`, `font-size:14px;color:${BODY};margin:10px 0 2px`),
  bullets(CERTIFIED_LIST_A),
  ...(withB ? [p(`<strong>List B</strong> (one)`, `font-size:14px;color:${BODY};margin:10px 0 2px`), bullets(CERTIFIED_LIST_B)] : []),
  p(escHtml(CERTIFIED_WHO), `font-size:14px;color:${BODY};margin:10px 0 2px`),
  p(escHtml(CERTIFIED_HOW), `font-size:14px;color:${BODY}`),
].join("\n");

function trustDocsRequestEmail(ctx: KycEmailContext): { subject: string; html: string } {
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;color:${ACCENT}">Documents about ${escHtml(ctx.partyName)}</h1>`,
    p(greeting(ctx.recipientName)),
    p(`<strong>${escHtml(ctx.partyName)}</strong> is a party to <strong>${escHtml(ctx.dealName)}</strong>. Before it can go ahead, the law requires us to know who stands behind the trust: who set it up, who the trustees are and who benefits.`),
    h2("What we need"),
    stepsList(kycSteps(ctx)),
    p("Upload them on your secure page, or reply to this email with them attached.", `font-size:14px;color:${BODY}`),
    button("Upload the documents", ctx.link),
    p(`Your link works until <strong>${escHtml(kycLongDate(ctx.expiresAt))}</strong>.`, `font-size:13px;color:${MUTED}`),
    h2("What happens next"),
    p(escHtml(TRUST_NEXT_WORDS.links), `font-size:14px;color:${BODY}`),
    p(escHtml(TRUST_NEXT_WORDS.certified), `font-size:14px;color:${BODY}`),
    certifiedLists(true),
    noteBlock(ctx.note, ctx.noteFrom),
    whyWeAsk(),
    h2("Questions?"),
    p(questionsLine(ctx.agents), `font-size:14px;color:${BODY}`),
    linkFallback(ctx.link),
  ].join("\n");
  return { subject: subjectFor(ctx, `Documents about ${ctx.partyName} for`), html: frame("Trust documents", inner, footerFor(ctx), ctx.test, undefined, ctx.testBy) };
}

/**
 * The trust's documents are in (23 November 2026, Jack: "Once they upload, we
 * need the documents to go somewhere and then be notified that are ready to
 * undertake due diligence on"): to the transaction's agents and the officers.
 */
export function trustDocsReadyEmail(ctx: {
  recipientName: string | null; partyName: string; dealName: string; ref: string; dealLink: string; sentFrom: string; test?: boolean;
  files: KycFinishedFile[]; missing: string[];
  // The deed's reading: values found, or why it could not be read; null with no deed sent.
  deed: { read: boolean; values: number; people: number; why: string | null } | null;
}): { subject: string; html: string } {
  const fileRows = ctx.files.map(f => `<tr><td style="padding:3px 12px 3px 0;font-family:${FONT};font-size:14px;color:${INK}">${escHtml(f.name)}</td><td style="padding:3px 0;font-family:${FONT};font-size:13px;color:${MUTED}">${escHtml(f.docKey ? KYC_DOCS[f.docKey].title : "Sent by email")}</td></tr>`).join("");
  const deedLine = !ctx.deed ? ""
    : ctx.deed.read ? p(`The trust deed has been read into a draft structure: ${ctx.deed.people} ${ctx.deed.people === 1 ? "person" : "people"} named. Check it against the deed and save it.`)
    : p(`The trust deed could not be read by the app (${escHtml(ctx.deed.why || "no reason given")}): record the structure from it by hand.`);
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:20px;line-height:1.3;color:${ACCENT}">Ready for due diligence: ${escHtml(ctx.partyName)}</h1>`,
    p(`${escHtml(ctx.recipientName || "The trust's representative")} has sent the trust's documents for <strong>${escHtml(ctx.dealName)}</strong>. They are filed on the trust's KYC record.`),
    ctx.files.length ? h2(`Files received (${ctx.files.length})`) + `<table role="presentation" cellspacing="0" cellpadding="0" border="0">${fileRows}</table>` : p("No files were uploaded."),
    ctx.missing.length ? h2("Not sent") + p(escHtml(ctx.missing.join(", "))) : "",
    deedLine,
    h2("Next"),
    `<ol style="margin:4px 0 14px 18px;padding:0;font-size:14px;color:${INK}"><li style="margin:0 0 4px">Open the transaction's Parties &amp; AML and check the trust information against the documents, then save it.</li><li style="margin:0 0 4px">Send each trustee, the settlor and anyone else with control their own link under People to check.</li><li style="margin:0 0 4px">An officer signs off once nothing is outstanding.</li></ol>`,
    button("Open the transaction's AML", ctx.dealLink),
  ].join("\n");
  return {
    subject: `${ctx.test ? "[Test] " : ""}Ready for due diligence: ${ctx.partyName}'s trust documents, ${ctx.dealName} [${ctx.ref}]`,
    html: frame("Trust documents in", inner, `Sent from ${escHtml(ctx.sentFrom)} by ChatBGP. Reference ${escHtml(ctx.ref)}.`, ctx.test, "the transaction's agents and the AML officers receive"),
  };
}

export interface KycProgress {
  idDone: boolean;
  docsDone: KycDocKey[];
  // The question about public roles has been answered.
  pepAnswered?: boolean;
  // The owners on the register have been confirmed or corrected.
  ownersAnswered?: boolean;
  // Every owner the person acting was asked to pass a link to has one.
  ownersLinked?: boolean;
  // The owners the person acting can pass a link to: those the request named
  // when it went out, and any the register named since (read live, as their
  // page lists them; 24 November 2026, #4664).
  ownersToLink?: string[];
}

// The reminder: what is done, what is still needed, the same button.
/** What a request has had and what it still needs, by step title. */
export function kycReminderLists(ctx: Pick<KycEmailContext, "needsIdCheck" | "confirmOwners" | "ownLinksFor" | "docs" | "askPep"> & { progress: KycProgress }): { done: string[]; left: string[] } {
  const done: string[] = [];
  const left: string[] = [];
  if (ctx.needsIdCheck) (ctx.progress.idDone ? done : left).push("Identity check");
  if (ctx.confirmOwners?.length) (ctx.progress.ownersAnswered ? done : left).push(KYC_OWNERS_QUESTION.title);
  if (ctx.ownLinksFor?.length) (ctx.progress.ownersLinked ? done : left).push(KYC_OWNER_LINKS_TITLE);
  for (const key of ctx.docs) (ctx.progress.docsDone.includes(key) ? done : left).push(KYC_DOCS[key].title);
  if (ctx.askPep) (ctx.progress.pepAnswered ? done : left).push(KYC_PEP_QUESTION.title);
  return { done, left };
}

const markList = (items: string[], mark: string, colour: string) => items.map(item => `<tr><td style="width:24px;vertical-align:top;padding:3px 0;font-family:${FONT};font-size:15px;font-weight:bold;color:${colour}">${mark}</td><td style="padding:3px 0;font-family:${FONT};font-size:15px;color:${INK}">${escHtml(item)}</td></tr>`).join("");

export function kycReminderEmail(ctx: KycEmailContext & { progress: KycProgress }): { subject: string; html: string } {
  const { done, left } = kycReminderLists(ctx);
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;color:${ACCENT}">${ctx.purpose === "trust_structure" ? `A reminder about the documents for ${escHtml(ctx.partyName)}` : "A reminder about your identity checks"}</h1>`,
    p(greeting(ctx.recipientName)),
    p(ctx.work ? partsHtml(kycWorkReminder(ctx.work, { name: ctx.partyName, kind: ctx.kind })) : `We still need a few things from you before <strong>${escHtml(ctx.dealName)}</strong> can go ahead.`),
    done.length ? h2("Done, thank you") + `<table role="presentation" cellspacing="0" cellpadding="0" border="0">${markList(done, "&#10003;", "#2e7d32")}</table>` : "",
    left.length ? h2("Still needed") + `<table role="presentation" cellspacing="0" cellpadding="0" border="0">${markList(left, "&bull;", ACCENT)}</table>` : "",
    button("Continue your checks", ctx.link),
    p(`Your link works until <strong>${escHtml(kycLongDate(ctx.expiresAt))}</strong>.`, `font-size:13px;color:${MUTED}`),
    h2("Questions?"),
    p(questionsLine(ctx.agents), `font-size:14px;color:${BODY}`),
    linkFallback(ctx.link),
  ].join("\n");
  return { subject: subjectFor(ctx, ctx.purpose === "trust_structure" ? `Reminder: documents about ${ctx.partyName} for` : "Reminder: your identity checks for"), html: frame("Identity checks reminder", inner, footerFor(ctx), ctx.test) };
}

// The identity check on its own, with Veriff's link (a check started for
// one person from the company's record rather than a deal's request).
export function kycIdCheckEmail(ctx: Omit<KycEmailContext, "docs" | "needsIdCheck" | "ref" | "expiresAt"> & { ref?: string }): { subject: string; html: string } {
  const ref = ctx.ref || "";
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;color:${ACCENT}">A quick identity check</h1>`,
    p(greeting(ctx.recipientName)),
    p(`Before we can go ahead${ctx.dealName ? ` with <strong>${escHtml(ctx.dealName)}</strong>` : ""}, the law requires us to confirm who we're dealing with. It takes about two minutes: a photo of your passport or driving licence, and a selfie.`),
    button("Start the identity check", ctx.link),
    p("Veriff runs the check for us. The link is personal to you.", `font-size:13px;color:${MUTED}`),
    whyWeAsk(),
    h2("Questions?"),
    p(questionsLine(ctx.agents), `font-size:14px;color:${BODY}`),
    linkFallback(ctx.link),
  ].join("\n");
  const subject = `${ctx.test ? "[Test] " : ""}Please complete a quick identity check${ctx.dealName ? ` for ${ctx.dealName}` : ""}`;
  return { subject, html: frame("Identity check", inner, footerFor({ sentFrom: ctx.sentFrom, ref: ref || "none", agents: ctx.agents }), ctx.test) };
}

// ── The joint agent's request (Woody, 22 November 2026) ─────────────────────
//
// "send them an email so they can load everything up or email the aml". A
// sale: HMRC asks the agent who did not find the buyer to ask the agent who
// did for their checks (AMLG2200, section 21). A letting at £10,000 a month
// or more: every party is verified (AMLG2300), so BGP asks to rely on the
// joint agent's checks (MLR 2017 reg 39). The rules are
// shared/joint-agent-checks.ts.

export interface JointAgentEmailContext {
  recipientName: string | null;
  firm: string;
  partyName: string;
  partyRole: string | null;           // tenant, purchaser, landlord, vendor
  kind: KycPartyKind;
  dealName: string;
  ref: string;
  link: string;
  expiresAt: Date | string;
  letting: boolean;                   // a letting at £10,000 a month or more: the reliance terms
  note?: string | null;
  noteFrom?: string | null;            // who typed the note (the person who sent the request)
  agents: KycAgent[];
  sentFrom: string;
  test?: boolean;
  // Who is asked: the joint agent, or the party's own agent (the landlord's
  // agent when BGP acts for the tenant; Woody, 22 November 2026). None = joint.
  relation?: "joint" | "own" | null;
  clientRole?: string | null;          // BGP's client's role, for "We act for the tenant"
  clientName?: string | null;          // BGP's client by name, for "We are jointly instructed by <client>"
}

const ROLE_NOUN: Record<string, string> = { tenant: "tenant", purchaser: "buyer", landlord: "landlord", vendor: "seller" };

/**
 * What the joint agent is asked for, in the order the page shows it: every
 * document they hold, their proof of identity first, and any further AML they
 * did (Woody, 23 November 2026: "This should include all the docs including
 * their proof of identity and any further AML they have done"). No reliance
 * terms (Woody, the same day: "we cant agree reliance"); `letting` is kept
 * for the callers and changes nothing.
 */
export function jointAgentAsks(ctx: Pick<JointAgentEmailContext, "kind" | "letting">): Array<{ title: string; detail: string }> {
  return [
    { title: "Proof of identity", detail: ctx.kind === "company"
      ? "For each owner and the person acting for the company: their passport, photocard driving licence or national identity card, or your electronic identity check report."
      : "For each person: their passport, photocard driving licence or national identity card, or your electronic identity check report." },
    // For everyone whose identity is checked (Jack, 26 November 2026).
    { title: "Proof of address", detail: `For each ${ctx.kind === "company" ? "owner and the person acting" : "of them"}: a utility bill, bank or building society statement or council tax bill from the last three months, their photocard driving licence if it shows their current address, or your electronic check confirming it.` },
    ...(ctx.kind === "company" ? [{ title: "The company", detail: "Its register entry and who owns it, with a structure chart if it is owned through other companies." }] : []),
    { title: "Any further AML you have done", detail: "Your sanctions, PEP and adverse media screening, your risk assessment or CDD summary, and anything you hold on where the money comes from." },
  ];
}

/**
 * The joint agent's intro (Woody, 23 November 2026: "the intro changing to
 * reflect the fact that we are jointly instructed by xxx client and you have
 * undertaken the negotiations of this transaction").
 */
export function jointlyInstructed(ctx: Pick<JointAgentEmailContext, "clientName" | "clientRole">): string {
  const noun = ROLE_NOUN[ctx.clientRole || ""] || null;
  const client = ctx.clientName ? `<strong>${escHtml(ctx.clientName)}</strong>` : noun ? `the ${escHtml(noun)}` : "our client";
  return `We are jointly instructed by ${client}`;
}

export function jointAgentRequestEmail(ctx: JointAgentEmailContext): { subject: string; html: string } {
  const noun = ROLE_NOUN[ctx.partyRole || ""] || "other party";
  const own = ctx.relation === "own";
  const clientNoun = ROLE_NOUN[ctx.clientRole || ""] || null;
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;color:${ACCENT}">Finalising our KYC on ${escHtml(ctx.partyName)}</h1>`,
    p(greeting(ctx.recipientName)),
    p(own
      ? `We act for ${clientNoun ? `the ${escHtml(clientNoun)}` : "the other side"} on <strong>${escHtml(ctx.dealName)}</strong>, and you act for <strong>${escHtml(ctx.partyName)}</strong>, the ${escHtml(noun)}. We are finalising our KYC on them and need the documents below.`
      : `${jointlyInstructed(ctx)} on <strong>${escHtml(ctx.dealName)}</strong>, and you have undertaken the negotiations of this transaction with <strong>${escHtml(ctx.partyName)}</strong>, the ${escHtml(noun)}. We are finalising our KYC on them and need the documents below.`),
    h2("Please send us"),
    stepsList(jointAgentAsks(ctx)),
    button("Upload the documents", ctx.link),
    p(`Or reply to this email with the documents attached. The link works until <strong>${escHtml(kycLongDate(ctx.expiresAt))}</strong>.`, `font-size:13px;color:${MUTED}`),
    noteBlock(ctx.note, ctx.noteFrom),
    p(`We use what you send only for our anti-money laundering checks, and keep it securely for five years.`, `font-size:13px;color:${BODY}`),
    h2("Questions?"),
    p(questionsLine(ctx.agents), `font-size:14px;color:${BODY}`),
    linkFallback(ctx.link),
  ].join("\n");
  return { subject: subjectFor({ dealName: ctx.dealName, ref: ctx.ref, test: ctx.test }, `Finalising our KYC on ${ctx.partyName}:`), html: frame("AML checks", inner, footerFor(ctx), ctx.test, own ? "the other side's agent receives" : "a joint agent receives") };
}

/**
 * Asking the joint agent for what is still missing (22 November 2026: "we need
 * to explain whats missing and keep emailing"): every gap in one plain line,
 * or, when nothing has come, what to send. Sent by BGP staff from the deal, or
 * by the app every three days until it is all in.
 */
export function jointAgentMissingEmail(ctx: JointAgentEmailContext & { missing: string[]; nothingYet: boolean; chase: number }): { subject: string; html: string } {
  const list = (items: string[]) => `<ul style="margin:0 0 16px;padding-left:20px;font-family:${FONT};font-size:15px;line-height:1.5;color:${BODY}">${items.map(i => `<li style="margin:4px 0">${escHtml(i)}</li>`).join("")}</ul>`;
  const why = ctx.letting
    ? "We can't finish our KYC on them until these are in."
    : "If you can't send them, please tell us: HMRC asks us to record what was and wasn't provided.";
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;color:${ACCENT}">${ctx.nothingYet ? `A reminder: the documents on ${escHtml(ctx.partyName)}` : `What we still need on ${escHtml(ctx.partyName)}`}</h1>`,
    p(greeting(ctx.recipientName)),
    ctx.nothingYet
      ? p(`We have not had the documents on <strong>${escHtml(ctx.partyName)}</strong> for <strong>${escHtml(ctx.dealName)}</strong> yet. To finalise our KYC, please send:`)
      : p(`Thank you for what you have sent on <strong>${escHtml(ctx.partyName)}</strong> for <strong>${escHtml(ctx.dealName)}</strong>. To finish our checks we still need:`),
    ctx.nothingYet ? stepsList(jointAgentAsks(ctx)) : list(ctx.missing),
    p(why, `font-size:14px;color:${BODY}`),
    button(ctx.nothingYet ? "Upload the documents" : "Send what's missing", ctx.link),
    p(`Or reply to this email with the documents attached. The link works until <strong>${escHtml(kycLongDate(ctx.expiresAt))}</strong>.`, `font-size:13px;color:${MUTED}`),
    h2("Questions?"),
    p(questionsLine(ctx.agents), `font-size:14px;color:${BODY}`),
    linkFallback(ctx.link),
  ].join("\n");
  const prefix = ctx.nothingYet ? `Reminder: finalising our KYC on ${ctx.partyName}:` : `Still needed: our KYC on ${ctx.partyName}:`;
  return { subject: subjectFor({ dealName: ctx.dealName, ref: ctx.ref, test: ctx.test }, prefix), html: frame("AML checks", inner, footerFor(ctx), ctx.test, ctx.relation === "own" ? "the other side's agent receives" : "a joint agent receives") };
}

/** To the deal's agents when the app has stopped chasing the joint agent. */
export function jointAgentChaseStoppedEmail(ctx: {
  firm: string; partyName: string; dealName: string; ref: string; dealLink: string; missing: string[]; chases: number; letting: boolean; sentFrom: string;
}): { subject: string; html: string } {
  const next = ctx.letting
    ? "BGP can't finish the checks while these are missing. Chase them yourself, or send the client checks."
    : "Chase them yourself, or an officer records on the transaction that \"they sent part of their checks\" or \"they did not provide them\".";
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;color:${ACCENT}">Still missing after ${ctx.chases} reminders</h1>`,
    p(`The app has asked ${escHtml(ctx.firm)} ${ctx.chases} times for what is missing from their checks on <strong>${escHtml(ctx.partyName)}</strong> for <strong>${escHtml(ctx.dealName)}</strong>, and has stopped chasing.`),
    ctx.missing.length ? h2("Still missing") + `<ul style="margin:0 0 14px;padding-left:20px">${ctx.missing.map(m => `<li style="margin:2px 0">${escHtml(m)}</li>`).join("")}</ul>` : "",
    p(next),
    button("Open the transaction", ctx.dealLink),
  ].join("\n");
  return { subject: `${ctx.firm} has not sent what is missing on ${ctx.partyName}: ${ctx.dealName} [${ctx.ref}]`, html: frame("Joint agent's checks", inner, `Bruce Gillingham Pollard. Sent from ${escHtml(ctx.sentFrom)}. Reference ${escHtml(ctx.ref)}.`, false) };
}

/** To the deal's agents when the joint agent has sent the documents. */
export function jointAgentFinishedEmail(ctx: {
  firm: string; recipientName: string | null; partyName: string; dealName: string; ref: string; dealLink: string;
  files: string[]; letting: boolean; reliance: { name: string; at: string } | null; missing: string[]; sentFrom: string;
}): { subject: string; html: string } {
  // No reliance terms are asked for (23 November 2026): BGP checks what they sent and signs the party off.
  const next = ctx.letting
    ? "Next: an officer checks what they sent and signs the party off."
    : "Next: an officer checks what they sent and records it on the transaction.";
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;color:${ACCENT}">${escHtml(ctx.firm)} has sent the documents</h1>`,
    p(`${escHtml(ctx.recipientName || ctx.firm)} has sent ${escHtml(ctx.firm)}'s documents on <strong>${escHtml(ctx.partyName)}</strong> for <strong>${escHtml(ctx.dealName)}</strong>.`),
    ctx.files.length ? h2("Files") + `<ul style="margin:0 0 14px;padding-left:20px">${ctx.files.map(f => `<li style="margin:2px 0">${escHtml(f)}</li>`).join("")}</ul>` : p("No files came with it.", `color:${ACCENT}`),
    ctx.letting && ctx.reliance ? p(`Reliance terms agreed by ${escHtml(ctx.reliance.name)} on ${escHtml(kycLongDate(ctx.reliance.at))}.`) : "",
    ctx.missing.length ? h2("Not covered yet") + `<ul style="margin:0 0 14px;padding-left:20px">${ctx.missing.map(m => `<li style="margin:2px 0">${escHtml(m)}</li>`).join("")}</ul>` : "",
    p(next),
    button("Open the transaction", ctx.dealLink),
  ].join("\n");
  return { subject: `${ctx.firm} sent the documents on ${ctx.partyName}: ${ctx.dealName} [${ctx.ref}]`, html: frame("Joint agent's checks", inner, `Bruce Gillingham Pollard. Sent from ${escHtml(ctx.sentFrom)}. Reference ${escHtml(ctx.ref)}.`, false) };
}

// ── Through the other side's agent (Woody, 23 November 2026) ───────────────
//
// "with the agent acting for the tenant or against us we need them to pass on
// the standard KYC requests for their clients to complete the agent should
// have the ability to help organise by uploading docs etc." The party's own
// agent is sent the party's standard client checks: the same page and link,
// to pass on to their client. Anyone with the link can upload the party's
// documents; the identity check is the client's own. The joint agent is
// asked for their documents instead (jointAgentRequestEmail).

export interface KycViaAgentEmailContext extends KycEmailContext {
  agentFirm: string;
  partyRole: string | null;            // the party's role (tenant, landlord, buyer, seller)
  clientRole: string | null;           // BGP's client's role
  clientName?: string | null;          // BGP's client by name
  personName?: string | null;          // who at the party will complete it, when known
}

/** "We act for <client>, the landlord," or "We act for the landlord". */
function weActFor(ctx: Pick<KycViaAgentEmailContext, "clientName" | "clientRole">): string {
  const noun = ROLE_NOUN[ctx.clientRole || ""] || null;
  if (ctx.clientName) return `We act for <strong>${escHtml(ctx.clientName)}</strong>${noun ? `, the ${escHtml(noun)},` : ""}`;
  return noun ? `We act for the ${escHtml(noun)}` : "We act for our client";
}

/** Who does the identity check, in the agent's words. */
export function kycViaAgentIdWho(ctx: Pick<KycViaAgentEmailContext, "kind" | "partyName" | "personName">): string {
  if (ctx.personName) return ctx.personName;
  return ctx.kind === "company" ? `the person at ${ctx.partyName} dealing with us` : "your client";
}

const titleList = (items: string[]) => `<ul style="margin:6px 0 4px;padding-left:20px;font-family:${FONT};font-size:15px;line-height:1.5;color:${INK}">${items.map(i => `<li style="margin:4px 0">${escHtml(i)}</li>`).join("")}</ul>`;

export function kycViaAgentRequestEmail(ctx: KycViaAgentEmailContext): { subject: string; html: string } {
  const noun = ROLE_NOUN[ctx.partyRole || ""] || "other party";
  const steps = kycSteps(ctx);
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;color:${ACCENT}">Our checks on ${escHtml(ctx.partyName)}</h1>`,
    p(greeting(ctx.recipientName)),
    p(`${weActFor(ctx)} on ${ctx.work?.what ? escHtml(ctx.work.what) : `<strong>${escHtml(ctx.work?.place || ctx.dealName)}</strong>`}, and you act for <strong>${escHtml(ctx.partyName)}</strong>, the ${escHtml(noun)}. Before the ${escHtml(ctx.work?.word || "transaction")} can go ahead, the law requires us to confirm who is on each side. Please pass our standard checks on to your client to complete.`),
    h2(`What we need from ${ctx.partyName}`),
    titleList(steps.map(s => s.title)),
    button("Open the checks", ctx.link),
    p(`To pass them on, forward this email to ${ctx.personName ? escHtml(ctx.personName) : "your client"}, or send the link to them from the page. You can upload any documents you hold for them on the same page.${ctx.needsIdCheck ? ` The identity check must be done by ${escHtml(kycViaAgentIdWho(ctx))}.` : ""}`, `font-size:14px;color:${BODY}`),
    p(`The link works until <strong>${escHtml(kycLongDate(ctx.expiresAt))}</strong>.`, `font-size:13px;color:${MUTED}`),
    noteBlock(ctx.note, ctx.noteFrom),
    whyWeAsk(),
    h2("Questions?"),
    p(questionsLine(ctx.agents), `font-size:14px;color:${BODY}`),
    linkFallback(ctx.link),
  ].join("\n");
  return { subject: subjectFor(ctx, `Please pass on: our checks on ${ctx.partyName} for`), html: frame("Identity checks", inner, footerFor(ctx), ctx.test, "the other side's agent receives") };
}

/** The reminder to the agent when the checks have not been passed on from the page. */
export function kycViaAgentReminderEmail(ctx: KycViaAgentEmailContext & { progress: KycProgress }): { subject: string; html: string } {
  const { done, left } = kycReminderLists(ctx);
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;color:${ACCENT}">A reminder: our checks on ${escHtml(ctx.partyName)}</h1>`,
    p(greeting(ctx.recipientName)),
    p(`We still need a few things from <strong>${escHtml(ctx.partyName)}</strong> before <strong>${escHtml(ctx.dealName)}</strong> can go ahead. Please chase your client, or upload what you hold for them.`),
    done.length ? h2("Done, thank you") + `<table role="presentation" cellspacing="0" cellpadding="0" border="0">${markList(done, "&#10003;", "#2e7d32")}</table>` : "",
    left.length ? h2("Still needed") + `<table role="presentation" cellspacing="0" cellpadding="0" border="0">${markList(left, "&bull;", ACCENT)}</table>` : "",
    button("Open the checks", ctx.link),
    p(`The link works until <strong>${escHtml(kycLongDate(ctx.expiresAt))}</strong>.`, `font-size:13px;color:${MUTED}`),
    h2("Questions?"),
    p(questionsLine(ctx.agents), `font-size:14px;color:${BODY}`),
    linkFallback(ctx.link),
  ].join("\n");
  return { subject: subjectFor(ctx, `Reminder: our checks on ${ctx.partyName} for`), html: frame("Identity checks reminder", inner, footerFor(ctx), ctx.test, "the other side's agent receives") };
}

export interface KycFinishedFile {
  name: string;
  docKey: KycDocKey | null;
}

// The note to the deal's agents when a client has finished.
export function kycFinishedEmail(ctx: {
  // The officers do enhanced checks in-house (22 November 2026): a red flag box says so.
  inHouse?: boolean;
  recipientName: string | null;
  partyName: string;
  dealName: string;
  ref: string;
  dealLink: string;
  idState: KycIdState | null;
  // Who Veriff checked, set against the person the request was for (19 November 2026).
  idPerson?: { verifiedName: string | null; isThePerson: boolean | null } | null;
  files: KycFinishedFile[];
  missing: string[];
  sentFrom: string;
  test?: boolean;
  kind?: KycPartyKind;
  pep?: KycPepAnswer | null;
  pepDetail?: string | null;
  redFlags?: KycRedFlag[];
  // The owners on the register the client was asked to confirm, and the reply.
  owners?: { list: Array<{ name: string; detail: string }>; reply: KycOwnersReply | null } | null;
  // A person's own request (19 November 2026): who they are to the company.
  person?: { roles: KycPersonRole[] } | null;
  // The party's people to check with something still outstanding.
  peopleOutstanding?: string[];
}): { subject: string; html: string } {
  const who = ctx.recipientName || ctx.partyName;
  // Someone else passed the identity check on this link (Woody, 19 November
  // 2026: an agent copied on the request did it on the client's link): never
  // reported as the client's own.
  const someoneElse = ctx.idPerson?.isThePerson === false && (ctx.idState === "approved" || ctx.idState === "submitted") ? ctx.idPerson.verifiedName || "someone else" : null;
  const idLine = ctx.idState === null ? "" :
    someoneElse ? `Identity check: ${ctx.idState === "approved" ? "passed" : "done"} by ${someoneElse}, not ${who}, who this request was for.` :
    ctx.idState === "approved" ? "Identity check: passed." :
    ctx.idState === "submitted" ? "Identity check: done, waiting for Veriff's result." :
    ctx.idState === "retry" ? "Identity check: Veriff asked them to try again." :
    ctx.idState === "restart" ? "Identity check: not passed or not finished. It needs starting again." :
    "Identity check: not done yet.";
  const fileRows = ctx.files.map(f => `<tr><td style="padding:3px 12px 3px 0;font-family:${FONT};font-size:14px;color:${INK}">${escHtml(f.name)}</td><td style="padding:3px 0;font-family:${FONT};font-size:13px;color:${MUTED}">${escHtml(f.docKey ? KYC_DOCS[f.docKey].title : "Sent by email")}</td></tr>`).join("");
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:20px;line-height:1.3;color:${ACCENT}">${someoneElse ? `The checks sent to ${escHtml(who)} were finished` : `${escHtml(who)} has finished their checks`}</h1>`,
    p(ctx.person
      ? `For <strong>${escHtml(ctx.dealName)}</strong>, as ${escHtml(kycPersonRoleWords(ctx.person.roles, ctx.partyName))}.`
      : `For <strong>${escHtml(ctx.dealName)}</strong>${ctx.recipientName && ctx.partyName !== ctx.recipientName ? `, on behalf of <strong>${escHtml(ctx.partyName)}</strong>` : ""}.`),
    idLine ? p(escHtml(idLine)) : "",
    someoneElse
      ? `<div style="margin:12px 0;padding:12px 16px;border-left:3px solid #b45309;background:#fff7ed;font-size:14px;color:${INK}"><strong>${escHtml(who)} has not done their own identity check.</strong> The check on this link was ${escHtml(someoneElse)}'s. Send ${escHtml(who)} a new request from the transaction's AML card, or, if ${escHtml(someoneElse)} can act for ${escHtml(ctx.partyName)}, record why on the transaction.</div>`
      : "",
    ctx.files.length ? h2(`Files received (${ctx.files.length})`) + `<table role="presentation" cellspacing="0" cellpadding="0" border="0">${fileRows}</table>` : p("No files were uploaded."),
    ctx.missing.length ? h2("Not sent") + p(escHtml(ctx.missing.join(", "))) : "",
    ctx.pep !== undefined ? h2("Public roles") + p(`${escHtml(kycPepWords(ctx.pep))}${ctx.pepDetail ? `: ${escHtml(ctx.pepDetail)}` : ""}`) : "",
    ctx.pep === "yes" || ctx.pep === "unsure"
      ? `<div style="margin:12px 0;padding:12px 16px;border-left:3px solid #b45309;background:#fff7ed;font-size:14px;color:${INK}"><strong>Enhanced due diligence.</strong> A public role, or a relative or close associate of someone with one, needs senior management approval before the transaction goes ahead, their source of wealth and source of funds, and closer monitoring. A UK one starts as lower risk. Check the answer against the screening.</div>`
      : "",
    ctx.owners?.list.length ? h2("Owners on the register") + p(`${ctx.owners.list.map(o => `${escHtml(o.name)} (${escHtml(o.detail)})`).join("; ")}.<br><strong>${escHtml(kycOwnersWords(ctx.owners.reply?.answer))}</strong>${ctx.owners.reply?.detail ? `: ${escHtml(ctx.owners.reply.detail)}` : ""}`) : "",
    ctx.owners?.reply?.answer === "no"
      ? `<div style="margin:12px 0;padding:12px 16px;border-left:3px solid #b45309;background:#fff7ed;font-size:14px;color:${INK}"><strong>A difference from the register.</strong> The client says the owners Companies House lists are wrong. Find out who the owners are and report the difference to Companies House.</div>`
      : "",
    ctx.redFlags?.length ? redFlagBox(ctx.redFlags, ctx.inHouse !== false) : "",
    ctx.peopleOutstanding?.length
      ? h2(`Still to come from the people to check for ${ctx.partyName}`) + `<ul style="margin:4px 0 14px 18px;padding:0;font-size:14px;color:${INK}">${ctx.peopleOutstanding.map(line => `<li style="margin:0 0 4px">${escHtml(line)}</li>`).join("")}</ul>`
      : "",
    ctx.kind === "company" && !ctx.owners?.list.length ? p("Check the owners they list against the PSC register. Report any difference to Companies House.", `font-size:13px;color:${BODY}`) : "",
    button("Open the transaction's AML", ctx.dealLink),
    p("The files are on the client's KYC record. Review them and sign off in the app as usual.", `font-size:13px;color:${MUTED}`),
  ].join("\n");
  return {
    subject: someoneElse
      ? `${ctx.test ? "[Test] " : ""}The checks sent to ${who} were finished with ${someoneElse}'s identity check, for ${ctx.dealName} [${ctx.ref}]`
      : `${ctx.test ? "[Test] " : ""}${who} has finished their identity checks for ${ctx.dealName} [${ctx.ref}]`,
    html: frame("Checks finished", inner, `Sent from ${escHtml(ctx.sentFrom)} by ChatBGP. Reference ${escHtml(ctx.ref)}.`, ctx.test, "the transaction's agents receive"),
  };
}

// How BGP handles a red flag (Woody, 17 November 2026: "basically we do the
// normal checks expected and if there is a red flag then we get KYC4U").
export const KYC_RED_FLAG_RULE = "A red flag goes to KYC4U for enhanced checks, and an officer approves their result before the transaction goes ahead.";
export const KYC_RED_FLAG_STEP = "On the transaction's AML, press Request KYC4U check: the flags are in the request's note.";

// The client checks run on their own switch (Woody, 18 November 2026,
// choosing "client checks only"): on unless KYC_CLIENT_CHECKS is "off",
// whether or not the old in-app AML (IN_APP_AML_ENABLED) is on. These are
// the staff addresses the retired-AML switch lets through for them; the
// client's own page (/api/kyc-upload/<token>) was never behind it.
export const clientChecksSwitchOn = (value: string | null | undefined): boolean => String(value ?? "").trim().toLowerCase() !== "off";
export const KYC_CLIENT_CHECK_ROUTES: readonly RegExp[] = [
  /^\/api\/aml\/deal\/[^/]+\/client-checks$/,
  // A person's own link (19 November 2026).
  /^\/api\/aml\/deal\/[^/]+\/client-checks\/people(?:\/rename)?$/,
  // A proof of address read again or accepted (20 November 2026).
  /^\/api\/aml\/deal\/[^/]+\/client-checks\/address-proof\/(?:read|accept)$/,
  /^\/api\/aml\/client-checks\/[^/]+(?:\/remind)?$/,
  /^\/api\/aml\/poll-mailbox$/,
];

// With the officers doing enhanced checks in-house (22 November 2026), a red
// flag goes to the Nominated Officer or a Deputy, not KYC4U.
export const KYC_RED_FLAG_RULE_IN_HOUSE = "A red flag needs enhanced checks, and an officer signs the party off before the transaction goes ahead.";
export const KYC_RED_FLAG_STEP_IN_HOUSE = "On the transaction's AML, an officer signs it off, or sets a flag aside with a comment.";

function redFlagBox(flags: KycRedFlag[], inHouse = true): string {
  const items = flags.map(f => `<li style="margin:0 0 6px">${escHtml(f.label)}${f.detail ? `: ${escHtml(f.detail)}` : ""} <span style="color:${MUTED}">(${escHtml(f.source)})</span></li>`).join("");
  return `<div style="margin:16px 0;padding:12px 16px;border-left:3px solid #b91c1c;background:#fef2f2;font-size:14px;color:${INK}"><strong>${inHouse ? "Red flag: for the Nominated Officer." : "Red flag: raise with KYC4U."}</strong><ul style="margin:8px 0 8px 18px;padding:0">${items}</ul>${escHtml(inHouse ? KYC_RED_FLAG_STEP_IN_HOUSE : KYC_RED_FLAG_STEP)}</div>`;
}

// The alert to the deal's agents the moment a client's answer or identity
// check raises a red flag. Once per flag per request.
export function kycRedFlagEmail(ctx: {
  partyName: string;
  recipientName: string | null;
  dealName: string;
  ref: string;
  dealLink: string;
  flags: KycRedFlag[];
  sentFrom: string;
  test?: boolean;
  // The officers do enhanced checks in-house: no KYC4U in the words.
  inHouse?: boolean;
}): { subject: string; html: string } {
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:20px;line-height:1.3;color:#b91c1c">${ctx.inHouse !== false ? `Red flag: ${escHtml(ctx.partyName)} needs enhanced checks` : `Red flag: raise ${escHtml(ctx.partyName)} with KYC4U`}</h1>`,
    p(`For <strong>${escHtml(ctx.dealName)}</strong>${ctx.recipientName && ctx.recipientName !== ctx.partyName ? `, from the checks sent to <strong>${escHtml(ctx.recipientName)}</strong>` : ""}.`),
    h2("What was found"),
    `<ul style="margin:0 0 14px 18px;padding:0">${ctx.flags.map(f => `<li style="margin:0 0 6px">${escHtml(f.label)}${f.detail ? `: ${escHtml(f.detail)}` : ""} <span style="color:${MUTED}">(${escHtml(f.source)})</span></li>`).join("")}</ul>`,
    h2("What to do"),
    p(ctx.inHouse !== false ? `${escHtml(KYC_RED_FLAG_RULE_IN_HOUSE)} ${escHtml(KYC_RED_FLAG_STEP_IN_HOUSE)}` : `${escHtml(KYC_RED_FLAG_RULE)} ${escHtml(KYC_RED_FLAG_STEP)}`),
    button("Open the transaction's AML", ctx.dealLink),
    p(ctx.inHouse !== false ? "Nothing has been sent to the client." : "Nothing has been sent to the client or to KYC4U.", `font-size:13px;color:${MUTED}`),
  ].join("\n");
  return {
    subject: `${ctx.test ? "[Test] " : ""}Red flag on ${ctx.dealName}: ${ctx.inHouse !== false ? `${ctx.partyName} needs enhanced checks` : `raise ${ctx.partyName} with KYC4U`} [${ctx.ref}]`,
    html: frame("Red flag", inner, `Sent from ${escHtml(ctx.sentFrom)} by ChatBGP. Reference ${escHtml(ctx.ref)}.`, ctx.test, "the transaction's agents receive"),
  };
}

// BGP's AML policy (Issue 2, section 3.7): checks are finished before a
// binding contract, at exchange or lease completion. A deal that moves to
// Exchanged or Completed with a party not approved still moves (Woody, 19
// November 2026: "Warn, and email Jack and Victoria"); the Nominated Officer
// and the Deputy get this, once per deal and stage.
export function amlOutstandingAtCompletionEmail(ctx: {
  dealName: string;
  dealRef: number | null;
  stage: "Exchanged" | "Completed";
  movedBy: string | null;
  parties: Array<{ name: string; role: string; reason: string }>;
  link: string;
  sentFrom: string;
}): { subject: string; html: string } {
  const roleWord = (r: string) => r === "landlord" ? "Landlord" : r === "tenant" ? "Tenant" : r === "vendor" ? "Seller" : r === "purchaser" ? "Buyer" : r;
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:20px;line-height:1.3;color:#b91c1c">${escHtml(ctx.dealName)} moved to ${escHtml(ctx.stage)} with checks outstanding</h1>`,
    p(`${ctx.dealRef != null ? `Transaction #${escHtml(ctx.dealRef)}` : "The transaction"} was moved to <strong>${escHtml(ctx.stage)}</strong>${ctx.movedBy ? ` by ${escHtml(ctx.movedBy)}` : ""}. BGP's AML policy says the checks are finished before contracts exchange or a lease completes.`),
    h2("Not approved"),
    `<ul style="margin:0 0 14px 18px;padding:0">${ctx.parties.map(c => `<li style="margin:0 0 6px">${escHtml(roleWord(c.role))}: <strong>${escHtml(c.name)}</strong> <span style="color:${MUTED}">(${escHtml(c.reason)})</span></li>`).join("")}</ul>`,
    h2("What to do"),
    p("Decide each party on the transaction's AML: sign it off, add KYC4U's result, or mark the joint agent's party Not required. Anything suspicious goes to the National Crime Agency, and the client is not told."),
    button("Open the transaction's AML", ctx.link),
  ].join("\n");
  return {
    subject: `AML: ${ctx.dealName} moved to ${ctx.stage} with checks outstanding`,
    html: frame("AML checks outstanding", inner, `Sent from ${escHtml(ctx.sentFrom)} by ChatBGP to BGP's Nominated Officer and Deputy.`, false, "the Nominated Officer and the Deputy receive"),
  };
}

// BGP stops acting on a deal, or acts on it again (Woody, 21 November 2026:
// shared/aml-stop.ts). It goes to the deal's agents and the officers, and
// never says why: only the officers read the reason (tipping off).
export function amlStoppedEmail(ctx: {
  dealName: string;
  dealRef: number | null;
  by: string;
  resumed: boolean;
  withdrawn: boolean;
  link: string;
  sentFrom: string;
}): { subject: string; html: string } {
  const deal = ctx.dealRef != null ? `Transaction #${escHtml(ctx.dealRef)}, ${escHtml(ctx.dealName)}` : escHtml(ctx.dealName);
  const inner = ctx.resumed
    ? [
        `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:20px;line-height:1.3">BGP is acting on ${escHtml(ctx.dealName)} again</h1>`,
        p(`${deal} is no longer on hold: ${escHtml(ctx.by)} released it. It can move on and be invoiced as before.`),
        button("Open the transaction", ctx.link),
      ]
    : [
        `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:20px;line-height:1.3;color:#b91c1c">BGP has stopped acting on ${escHtml(ctx.dealName)}</h1>`,
        p(`${deal} is on hold for anti-money laundering reasons: ${escHtml(ctx.by)} stopped BGP acting on it.${ctx.withdrawn ? " The transaction has been moved to Withdrawn." : ""}`),
        h2("What this means"),
        p("Do not move the transaction on, raise or send an invoice, or do more work on it until the Nominated Officer releases it. The transaction and its AML file are kept."),
        p("Do not tell the client, the other side or their advisers why. If they ask, say the transaction is on hold and pass them to the Nominated Officer."),
        button("Open the transaction", ctx.link),
      ];
  return {
    subject: ctx.resumed ? `AML: ${ctx.dealName} is no longer on hold` : `AML: BGP has stopped acting on ${ctx.dealName}`,
    html: frame("AML", inner.join("\n"), `Sent from ${escHtml(ctx.sentFrom)} by ChatBGP to the transaction's agents, BGP's Nominated Officer and the Deputies.`, false, "the transaction's agents and the officers receive"),
  };
}

// A new entry in the AML register (Woody, 19 November 2026). It goes to the
// Nominated Officer and the Deputy only and says nothing of what the entry
// is about: a mailbox is not the place for a suspicion (tipping off).
export function amlRegisterNoticeEmail(ctx: { raisedBy: string | null; link: string; sentFrom: string }): { subject: string; html: string } {
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:20px;line-height:1.3">A new report is waiting for you</h1>`,
    p(`${ctx.raisedBy ? `${escHtml(ctx.raisedBy)} has` : "Someone has"} raised a report for the Nominated Officer in BGP's AML register. What it is about is not in this email: open it in ChatBGP (Transactions, AML, Reports).`),
    button("Open the AML register", ctx.link),
    p("Only the officers can read it.", `font-size:13px;color:${MUTED}`),
  ].join("\n");
  return {
    subject: "AML: a new report is waiting for you",
    html: frame("AML register", inner, `Sent from ${escHtml(ctx.sentFrom)} by ChatBGP to BGP's Nominated Officer and Deputy.`, false, "the Nominated Officer and the Deputy receive"),
  };
}

// HMRC changed a page behind BGP's AML rules in short (shared/aml-rules.ts):
// to the officers, from the quarterly check (server/aml-rules.ts).
export function amlRulesChangedEmail(ctx: { changes: Array<{ label: string; at: string; note: string | null }>; error: string | null; link: string; sentFrom: string }): { subject: string; html: string } {
  const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
  const rows = ctx.changes.map(c => `<li style="margin:0 0 8px">${escHtml(c.label)}, updated ${escHtml(when(c.at))}${c.note ? `: ${escHtml(c.note)}` : ""}</li>`).join("");
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:20px;line-height:1.3">${ctx.changes.length ? "HMRC has changed its AML guidance" : "HMRC's AML guidance could not be checked"}</h1>`,
    ctx.changes.length
      ? `<ul style="margin:0 0 14px;padding-left:18px">${rows}</ul>` + p("Read the changes and check BGP's rules still match. Then mark them reviewed.")
      : p(`${escHtml(ctx.error || "GOV.UK did not answer.")} Check again from the Rules page.`),
    button("Open the rules", ctx.link),
  ].join("\n");
  return {
    subject: ctx.changes.length ? "AML: HMRC has changed its guidance" : "AML: HMRC's guidance could not be checked",
    html: frame("AML rules", inner, `Sent from ${escHtml(ctx.sentFrom)} by ChatBGP to BGP's Nominated Officer and Deputies.`, false, "the Nominated Officer and the Deputies receive"),
  };
}

// The message an agent sends from their own WhatsApp (a wa.me link opens it
// written out). The app does not send WhatsApp itself: WhatsApp refuses a
// business's first message unless it is an approved template, so the old
// automatic one never reached a new client.
export function kycWhatsAppText(ctx: Pick<KycEmailContext, "recipientName" | "dealName" | "link" | "expiresAt"> & { senderName?: string | null }): string {
  const hello = firstName(ctx.recipientName) ? `Hello ${firstName(ctx.recipientName)}` : "Hello";
  const me = firstName(ctx.senderName) ? `it's ${firstName(ctx.senderName)} at Bruce Gillingham Pollard` : "this is Bruce Gillingham Pollard";
  return `${hello}, ${me}. Before ${ctx.dealName} can go ahead we need to confirm your identity, as the law requires. It takes about ten minutes, on your phone: ${ctx.link}\nThe link works until ${kycLongDate(ctx.expiresAt)}.`;
}

export function kycWhatsAppHref(mobile: string | null | undefined, text: string): string {
  let digits = String(mobile || "").replace(/[^0-9+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `44${digits.slice(1)}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// What the client page shows: built on the server from the request, the
// files and the identity check. Never the client's files themselves.
export interface KycPortalView {
  test: boolean;
  ref: string;
  recipientName: string | null;
  partyName: string;
  kind: KycPartyKind;
  dealName: string;
  // What the request says about the work (25 November 2026); absent on older requests.
  work?: KycWork | null;
  workOpening?: KycWordsPart[][] | null;
  expiresAt: string;
  // real: a Veriff check runs (always on a client's request; on a test page
  // when Veriff is set up, since 17 November 2026).
  // otherPerson: the check on this link was passed by someone other than the
  // person the request was for (verifiedName is who), so theirs is still to do.
  idCheck: { state: KycIdState; canStart: boolean; real: boolean; verifiedName?: string | null; otherPerson?: boolean } | null;
  question: { pep: KycPepAnswer | null; pepDetail: string | null } | null;
  // The owners on the register to confirm (null when not asked).
  owners: { list: Array<{ name: string; detail: string }>; answer: KycOwnersAnswer | null; detail: string | null } | null;
  docs: Array<{ key: KycDocKey; title: string; detail: string; files: Array<{ name: string; uploadedAt: string }> }>;
  otherFiles: Array<{ name: string; uploadedAt: string }>;
  // A person's own request (19 November 2026): who they are to the company.
  person?: { roles: KycPersonRole[]; words: string } | null;
  // The owners the person acting passes a link of their own to: done when
  // they have nothing left to send, linked when they have a link.
  // address: their proof of address, which anyone with this link may send for them (24 November 2026);
  // null when none is asked of them.
  people?: Array<{ key: string; name: string; detail: string | null; done: boolean; linked: boolean; emailedAt: string | null;
    address?: { done: boolean; reading: boolean; notPassed: boolean } | null }> | null;
  note: string | null;
  noteFrom?: string | null;
  agents: KycAgent[];
  finishedAt: string | null;
  maxFileMb: number;
  // Sent through the party's own agent to pass on (23 November 2026): the
  // agent's firm, who at the firm, who it has been passed on to (names only),
  // and whether the person who does the identity check is named yet.
  viaAgent?: {
    firm: string;
    agentName: string | null;
    passedOn: Array<{ name: string; at: string }>;
    personNamed: boolean;
  } | null;
  // A request for a trust's documents (23 November 2026): its own wording.
  trustDocs?: boolean;
  // Optional documents the page also takes (certified copies), and the words that introduce them.
  certifiedWords?: string;
  // Whether the certified copies take a List B (address) document too (25 November 2026).
  certifiedListB?: boolean;
  optionalDocs?: Array<{ key: KycDocKey; title: string; detail: string; files: Array<{ name: string; uploadedAt: string }> }>;
  // The joint agent's request (22 November 2026): its own page, with the
  // reliance terms to agree on a letting at £10,000 a month or more.
  joint?: {
    firm: string;
    partyRole: string | null;
    letting: boolean;
    // The joint agent, or the party's own agent; BGP's client's role.
    relation?: "joint" | "own";
    clientRole?: string | null;
    clientName?: string | null;
    asks: Array<{ title: string; detail: string }>;
    terms: string[] | null;
    reliance: { name: string; position: string | null; supervisor: string; registration: string | null; agreedAt: string } | null;
    // What their files do not cover yet, one line each (empty until something comes).
    missing?: string[];
    // Their files not read yet: nothing is asked for while one is being read.
    reading?: number;
  } | null;
}

// Files the client page accepts: documents and photos a phone takes.
export const KYC_UPLOAD_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/webp": ".webp",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};
export const KYC_UPLOAD_EXTENSIONS = /\.(pdf|jpe?g|png|heic|heif|webp|docx?)$/i;
export const KYC_MAX_FILE_MB = 25;
export const KYC_MAX_FILES_PER_REQUEST = 40;

export function kycUploadAllowed(fileName: string, mime: string | null | undefined): boolean {
  if (!KYC_UPLOAD_EXTENSIONS.test(fileName)) return false;
  const m = String(mime || "").toLowerCase();
  // Phones send HEIC with a blank or generic type; the name decides then.
  return !m || m === "application/octet-stream" || m in KYC_UPLOAD_TYPES;
}


// A transaction reads the client file's requests for the same contracting entity
// too (Woody, 25 November 2026, on Tokoro Capital: "still not saying these have
// been sent?"): links sent from the company's own KYC window count on its
// transactions. tokens is the alias of kyc_upload_tokens; $param is the deal's id.
export function dealOrClientFileTokensSql(param: string, tokens = "kyc_upload_tokens"): string {
  return `(${tokens}.deal_id = ${param} OR (${tokens}.deal_id IS NULL AND EXISTS (
    SELECT 1 FROM crm_deals d0, LATERAL (VALUES (d0.landlord_id, d0.landlord_trading_entity_id), (d0.tenant_id, d0.tenant_trading_entity_id),
      (d0.vendor_id, d0.vendor_trading_entity_id), (d0.purchaser_id, d0.purchaser_trading_entity_id)) p0(c, e)
    WHERE d0.id = ${param} AND p0.c IS NOT NULL AND p0.c = ${tokens}.company_id AND p0.e IS NOT DISTINCT FROM ${tokens}.trading_entity_id))
    OR (${tokens}.deal_id IS NOT NULL AND ${tokens}.deal_id <> ${param} AND ${tokens}.revoked_at IS NULL AND ${sameSignerPartySql(param, tokens)} IS NOT NULL))`;
}

/** A Companies House number as one key: upper case, letters and digits only, no leading noughts. */
export const chNumberSql = (col: string): string =>
  `regexp_replace(regexp_replace(upper(coalesce(${col}, '')), '[^A-Z0-9]', '', 'g'), '^0+(?=[0-9])', '')`;

/**
 * The party brand on transaction ${param} that a request on ANOTHER transaction
 * counts for: the same company signs on both, by its Companies House number
 * (Woody, 25 November 2026, on The Royal Exchange Investments Limited: the
 * checks started with Peter Wood on one transaction "should be mirrored in all
 * accross the app once its clear they are the contracting entity").
 */
export function sameSignerPartySql(param: string, tokens = "kyc_upload_tokens"): string {
  return `(SELECT p1.c FROM crm_deals d1, LATERAL (VALUES (d1.landlord_id, d1.landlord_trading_entity_id), (d1.tenant_id, d1.tenant_trading_entity_id),
      (d1.vendor_id, d1.vendor_trading_entity_id), (d1.purchaser_id, d1.purchaser_trading_entity_id)) p1(c, e), crm_trading_entities te1, crm_trading_entities te2
    WHERE d1.id = ${param} AND p1.c IS NOT NULL AND te1.id = p1.e AND te2.id = ${tokens}.trading_entity_id
      AND ${chNumberSql("te1.companies_house_number")} <> '' AND ${chNumberSql("te1.companies_house_number")} = ${chNumberSql("te2.companies_house_number")} LIMIT 1)`;
}

/** The party brand a request read for transaction ${param} counts for: its own, or the party's when it came from another transaction. */
export function tokenPartyCompanySql(param: string, tokens = "kyc_upload_tokens"): string {
  return `(CASE WHEN ${tokens}.deal_id IS NOT NULL AND ${tokens}.deal_id <> ${param} THEN COALESCE(${sameSignerPartySql(param, tokens)}, ${tokens}.company_id) ELSE ${tokens}.company_id END)`;
}
