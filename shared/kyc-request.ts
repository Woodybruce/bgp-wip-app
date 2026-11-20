// The client checks request (in-app AML; Woody, 2026-11-17: the emails
// should "come from kyc@chatbgp.app", "copy the agent that has done the
// deal" and carry the BGP logo, and the old ones were "not that clear or
// user friendly"). What we ask a party's contact for, the page they land
// on, and every email and message that asks. Pure: the server sends these,
// the client page and the admin preview read them, the tests run them.

import type { KycRedFlag } from "./kyc-red-flags";

export type KycDocKey = "photo_id" | "proof_of_address" | "source_of_funds" | "ownership" | "owner_ids" | "authority" | "company_documents" | "other";
export type KycPartyKind = "individual" | "company";

// A request of a person's own (Woody, 19 November 2026, agreeing "a list of
// people to check for each party: the owners and the person acting, each with
// their own Veriff link and a proof-of-address upload; the directors shown
// with their sanctions result only"). Set on the request when it is for one
// of the people a company's checks are about, not for the company itself.
export type KycPersonRole = "owner" | "acting" | "director";
export interface KycRequestPerson {
  key: string;
  name: string;
  roles: KycPersonRole[];
  // How they own or control the company, as the register gives it.
  detail?: string | null;
}
export const kycPersonRoleWords = (roles: KycPersonRole[], partyName: string): string =>
  roles.includes("owner") ? `an owner of ${partyName}` : roles.includes("acting") ? `the person dealing with us for ${partyName}` : `a director of ${partyName}`;

export const KYC_DOC_KEYS: KycDocKey[] = ["photo_id", "proof_of_address", "source_of_funds", "ownership", "owner_ids", "authority", "company_documents", "other"];

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
  // BGP's AML policy (Issue 2, "Individuals"): a utility bill, bank statement
  // or local authority tax demand, not more than three months old; certified
  // when the person lives outside the UK.
  proof_of_address: {
    title: "Proof of address",
    detail: "A utility bill, bank or building society statement, council tax bill or mortgage statement dated in the last three months, showing your name and home address. If you live outside the UK, send a copy certified \"as a true copy of the original\" by a practising solicitor or accountant, with their name, signature, the date, their professional body and their firm.",
    docType: "proof_of_address",
  },
  source_of_funds: {
    title: "Where the money is coming from",
    detail: "Something that shows where the money for this deal comes from, not only which bank it is paid from: for example a recent bank statement, a mortgage or loan offer, the sale of another property, or a letter from your accountant or solicitor. For a company, its latest accounts or a recent bank statement.",
    docType: "source_of_funds",
  },
  ownership: {
    title: "Who owns the company",
    detail: "A structure chart up to the people at the top: everyone who owns or controls more than 25% of the company's shares or votes, directly or through other companies, and anyone who controls the company in another way.",
    docType: "ubo_declaration",
  },
  owner_ids: {
    title: "ID for each of those owners",
    detail: "For each person on that list: a passport, photocard driving licence, national identity card or firearms certificate, and a proof of address (a utility bill, bank statement or council tax bill) dated in the last three months. Clear copies are fine to start with; owners who live outside the UK send certified copies, and we may ask for them from others.",
    docType: "passport",
  },
  authority: {
    title: "Confirmation you can act for the company",
    detail: "If you are not one of its directors: an email or letter from a director confirming that you can deal with us for the company.",
    docType: "authority_to_act",
  },
  company_documents: {
    title: "Company documents",
    detail: "Only if the company is registered outside the UK: an extract from its official company register showing it is registered, a list of its directors, and its UK registration number if it is registered at Companies House as an overseas company or an overseas entity.",
    docType: "company_cert",
  },
  other: {
    title: "Anything else",
    detail: "Anything else your agent has asked you for.",
    docType: "other",
  },
};

export const isKycDocKey = (value: unknown): value is KycDocKey => typeof value === "string" && (KYC_DOC_KEYS as string[]).includes(value);

// What a request asks for unless the agent changes it. Photo ID is asked
// for as a document only when there is no online identity check. A company
// is checked at Companies House by the app, so only what is not filed there
// is asked for, with the dealing person's authority to act. The person
// dealing with us for a company sends their own proof of address too (since
// 19 November 2026: they are one of the people to check, BGP's policy asks an
// individual for one proof of identity and one of address). Where the money
// comes from is asked of whoever pays: a buyer, and a tenant (HMRC's letting
// guidance, AMLG2300 section 21: "all customers making a payment").
export function defaultKycDocs(kind: KycPartyKind, role: string | null | undefined, idCheck: boolean): KycDocKey[] {
  const docs: KycDocKey[] = [];
  if (!idCheck) docs.push("photo_id");
  if (kind === "individual") docs.push("proof_of_address");
  else docs.push("proof_of_address", "ownership", "owner_ids", "authority");
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
  landlord: "HMRC expects the landlord's identity checks to be done before you agree terms of engagement and before the unit is marketed.",
  tenant: "HMRC expects the tenant's identity checks once the landlord accepts their offer, and before any agreement or contract is made. No deposit can be taken before they are done.",
  vendor: "HMRC expects the seller's checks as soon as possible after first contact, before the property is marketed.",
  purchaser: "HMRC expects the buyer's checks as soon as possible, before an offer is accepted, and at the latest before exchange.",
};
// A letting is in scope at a rent of £10,000 a month or more for at least
// part of the term, turnover rent included (AMLG2300 sections 2, 11, 12).
// Sanctions have no threshold: estate agents, and letting agents since
// 14 May 2025, must report a designated person to OFSI (OFSI's guidance for
// letting agents; the UK Sanctions List is the one list since 28 January 2026).
export const KYC_LETTING_SCOPE = "A letting needs these checks when the rent is £10,000 a month (£120,000 a year) or more for any part of the term, turnover rent included, or is likely to rise above that. Every sale needs them. Sanctions apply whatever the rent: never deal with someone on the UK Sanctions List, and report them to OFSI.";
export const KYC_PRIVACY_URL = "https://www.brucegillinghampollard.com/privacy/";

// Every request has a short code that goes in the subject line, so a reply
// with documents attached finds its request. Six letters and digits with
// the easily confused ones (0/O, 1/I/L) left out.
export const KYC_REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const KYC_REF_RE = /\(ref ([2-9A-HJKMNP-Z]{6})\)/i;
export function kycRefFromSubject(subject: string | null | undefined): string | null {
  const m = KYC_REF_RE.exec(String(subject || ""));
  return m ? m[1].toUpperCase() : null;
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
  // A person's own request: who they are to the company (19 November 2026).
  person?: { roles: KycPersonRole[] } | null;
  // The owners the person acting is asked to pass a link of their own to.
  ownLinksFor?: string[] | null;
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

// "Jack Smith on 07700 900123 or jack@…", for up to two agents.
function agentContactHtml(agents: KycAgent[]): string {
  const shown = agents.filter(a => a.name).slice(0, 2);
  if (!shown.length) return "reply to this email";
  const one = (a: KycAgent) => {
    const ways = [
      a.phone ? `<a href="tel:${escHtml(a.phone.replace(/[^0-9+]/g, ""))}" style="color:${ACCENT};text-decoration:none">${escHtml(a.phone)}</a>` : "",
      a.email ? `<a href="mailto:${escHtml(a.email)}" style="color:${ACCENT};text-decoration:none">${escHtml(a.email)}</a>` : "",
    ].filter(Boolean);
    return `<strong>${escHtml(a.name)}</strong>${ways.length ? ` on ${ways.join(" or ")}` : ""}`;
  };
  return `${shown.map(one).join(", or ")}, or reply to this email`;
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

// The owners' own links (19 November 2026): each owner does their own
// identity check and sends their own proof of address, on a page of their own.
export const KYC_OWNER_LINKS_TITLE = "Pass each owner their own link";
export const kycOwnerLinksDetail = (names: string[]): string => {
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${who} ${names.length === 1 ? "does their" : "each do their"} own identity check and send${names.length === 1 ? "s" : ""} a proof of address, on a page of their own. Your page has a link for ${names.length === 1 ? "them" : "each of them"}, or give us ${names.length === 1 ? "their email address" : "their email addresses"} there and we'll send it.`;
};

export function kycSteps(ctx: Pick<KycEmailContext, "needsIdCheck" | "docs" | "askPep" | "confirmOwners" | "ownerNames" | "ownLinksFor" | "ownersAbroad"> & { kind?: KycPartyKind }): Array<{ title: string; detail: string }> {
  const steps: Array<{ title: string; detail: string }> = [];
  if (ctx.needsIdCheck) {
    steps.push({ title: "A quick identity check", detail: "On your phone or computer: a photo of your passport, driving licence or identity card and a short selfie. It takes about two minutes." });
  }
  // The owners to confirm come before the owners' IDs, which refer to them.
  const owners = ctx.confirmOwners?.length ? { title: KYC_OWNERS_QUESTION.title, detail: KYC_OWNERS_QUESTION.step } : null;
  if (owners) steps.push(owners);
  if (ctx.ownLinksFor?.length) steps.push({ title: KYC_OWNER_LINKS_TITLE, detail: kycOwnerLinksDetail(ctx.ownLinksFor) });
  for (const key of ctx.docs) steps.push({ title: KYC_DOCS[key].title, detail: kycDocDetail(key, ctx.ownerNames, ctx.ownersAbroad) });
  if (ctx.askPep) {
    steps.push({ title: KYC_PEP_QUESTION.title, detail: ctx.kind === "individual"
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
  return `Bruce Gillingham Pollard. Sent from ${escHtml(ctx.sentFrom)} for ${escHtml(agentNamesText(ctx.agents))}. If you were not expecting this email, please reply and let us know. Reference ${escHtml(ctx.ref)}.`;
}

function linkFallback(link: string): string {
  if (!/^https:\/\//i.test(link)) return "";
  return p(`If the button does not work, copy this address into your browser:<br><a href="${safeHref(link)}" style="color:${ACCENT};word-break:break-all">${escHtml(link)}</a>`, `font-size:12px;color:${MUTED}`);
}

// Regulation 41 of the Money Laundering Regulations 2017: a new customer is
// told their data is used only to prevent money laundering and terrorist
// financing, and where the GDPR information is (the privacy notice). The
// five years run from the end of the relationship (HMRC, AMLG11700).
export const KYC_WHY_WE_ASK = "As estate and letting agents we must follow the UK Money Laundering Regulations 2017, which require us to confirm who we are dealing with before a deal goes ahead.";
export const KYC_DATA_USE = "We will use what you send only to prevent money laundering and terrorist financing. It is stored securely and kept for five years after our work with you ends, as the law requires.";
const whyWeAsk = () => h2("Why we ask") + p(`${escHtml(KYC_WHY_WE_ASK)} ${escHtml(KYC_DATA_USE)} Our <a href="${escHtml(KYC_PRIVACY_URL)}" style="color:${ACCENT}">privacy notice</a> explains how we handle your information and your rights.`, `font-size:13px;color:${BODY}`);

function noteBlock(note: string | null | undefined, agents: KycAgent[]): string {
  const text = String(note || "").trim();
  if (!text) return "";
  const from = firstName(agents[0]?.name) || "your agent";
  return `<div style="margin:18px 0;padding:12px 16px;border-left:3px solid ${ACCENT};background:#faf7f5;font-size:14px;color:${BODY}"><strong style="color:${INK}">A note from ${escHtml(from)}:</strong><br>${escHtml(text).replace(/\r?\n/g, "<br>")}</div>`;
}

const subjectFor = (ctx: Pick<KycEmailContext, "dealName" | "ref" | "test">, lead: string) =>
  `${ctx.test ? "[Test] " : ""}${lead} ${ctx.dealName} (ref ${ctx.ref})`;

// The first email: what we need, one button to the client's own page.
export function kycRequestEmail(ctx: KycEmailContext): { subject: string; html: string } {
  const steps = kycSteps(ctx);
  const forWhom = ctx.kind === "company"
    ? ` That includes you, as the person dealing with us for <strong>${escHtml(ctx.partyName)}</strong>, and the people who own the company.`
    : "";
  // A person's own request: an owner may not know the deal at all.
  const opening = ctx.person?.roles.includes("owner")
    ? `<strong>${escHtml(ctx.partyName)}</strong> is a party to <strong>${escHtml(ctx.dealName)}</strong>, which we are working on. Companies House lists you as someone who owns or controls ${escHtml(ctx.partyName)}, so before the deal can go ahead the law requires us to confirm your identity too.`
    : ctx.person
      ? `You are dealing with us for <strong>${escHtml(ctx.partyName)}</strong> on <strong>${escHtml(ctx.dealName)}</strong>, so before the deal can go ahead the law requires us to confirm your identity.`
      : `We're working with you on <strong>${escHtml(ctx.dealName)}</strong>. Before the deal can go ahead, the law requires us to confirm who we are dealing with.${forWhom}`;
  const companiesHouse = ctx.kind === "company"
    ? p("We read the company's details from Companies House ourselves, so you don't need to send anything that is filed there.", `font-size:14px;color:${BODY}`)
    : "";
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;color:${ACCENT}">Identity checks for ${escHtml(ctx.dealName)}</h1>`,
    p(greeting(ctx.recipientName)),
    p(`${opening}${ctx.docs.includes("photo_id") ? "" : ` It should take about ${ctx.person ? "five" : "ten"} minutes.`}`),
    h2("What we need from you"),
    stepsList(steps),
    companiesHouse,
    button("Start your checks", ctx.link),
    p(`The link is personal to you and works until <strong>${escHtml(kycLongDate(ctx.expiresAt))}</strong>. You can use it on your phone or computer, and come back to it as often as you need.`, `font-size:13px;color:${MUTED}`),
    noteBlock(ctx.note, ctx.agents),
    whyWeAsk(),
    h2("Questions?"),
    p(`Speak to ${agentContactHtml(ctx.agents)}.`, `font-size:14px;color:${BODY}`),
    linkFallback(ctx.link),
  ].join("\n");
  return { subject: subjectFor(ctx, "Please complete your identity checks for"), html: frame("Identity checks", inner, footerFor(ctx), ctx.test, undefined, ctx.testBy) };
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
}

// The reminder: what is done, what is still needed, the same button.
export function kycReminderEmail(ctx: KycEmailContext & { progress: KycProgress }): { subject: string; html: string } {
  const done: string[] = [];
  const left: string[] = [];
  if (ctx.needsIdCheck) (ctx.progress.idDone ? done : left).push("Identity check");
  if (ctx.confirmOwners?.length) (ctx.progress.ownersAnswered ? done : left).push(KYC_OWNERS_QUESTION.title);
  if (ctx.ownLinksFor?.length) (ctx.progress.ownersLinked ? done : left).push(KYC_OWNER_LINKS_TITLE);
  for (const key of ctx.docs) (ctx.progress.docsDone.includes(key) ? done : left).push(KYC_DOCS[key].title);
  if (ctx.askPep) (ctx.progress.pepAnswered ? done : left).push(KYC_PEP_QUESTION.title);
  const list = (items: string[], mark: string, colour: string) => items.map(item => `<tr><td style="width:24px;vertical-align:top;padding:3px 0;font-family:${FONT};font-size:15px;font-weight:bold;color:${colour}">${mark}</td><td style="padding:3px 0;font-family:${FONT};font-size:15px;color:${INK}">${escHtml(item)}</td></tr>`).join("");
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;color:${ACCENT}">A reminder about your identity checks</h1>`,
    p(greeting(ctx.recipientName)),
    p(`We still need a few things from you before <strong>${escHtml(ctx.dealName)}</strong> can go ahead.`),
    done.length ? h2("Done, thank you") + `<table role="presentation" cellspacing="0" cellpadding="0" border="0">${list(done, "&#10003;", "#2e7d32")}</table>` : "",
    left.length ? h2("Still needed") + `<table role="presentation" cellspacing="0" cellpadding="0" border="0">${list(left, "&bull;", ACCENT)}</table>` : "",
    button("Continue your checks", ctx.link),
    p(`Your link works until <strong>${escHtml(kycLongDate(ctx.expiresAt))}</strong>.`, `font-size:13px;color:${MUTED}`),
    h2("Questions?"),
    p(`Speak to ${agentContactHtml(ctx.agents)}.`, `font-size:14px;color:${BODY}`),
    linkFallback(ctx.link),
  ].join("\n");
  return { subject: subjectFor(ctx, "Reminder: your identity checks for"), html: frame("Identity checks reminder", inner, footerFor(ctx), ctx.test) };
}

// The identity check on its own, with Veriff's link (a check started for
// one person from the company's record rather than a deal's request).
export function kycIdCheckEmail(ctx: Omit<KycEmailContext, "docs" | "needsIdCheck" | "ref" | "expiresAt"> & { ref?: string }): { subject: string; html: string } {
  const ref = ctx.ref || "";
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:1.3;color:${ACCENT}">A quick identity check</h1>`,
    p(greeting(ctx.recipientName)),
    p(`Before we can go ahead${ctx.dealName ? ` with <strong>${escHtml(ctx.dealName)}</strong>` : ""}, the law requires us to confirm who we are dealing with. Please complete a short identity check: a photo of your passport or driving licence and a short selfie. It takes about two minutes on your phone or computer.`),
    button("Start the identity check", ctx.link),
    p("The check is run for us by Veriff, an identity verification service. The link is personal to you.", `font-size:13px;color:${MUTED}`),
    whyWeAsk(),
    h2("Questions?"),
    p(`Speak to ${agentContactHtml(ctx.agents)}.`, `font-size:14px;color:${BODY}`),
    linkFallback(ctx.link),
  ].join("\n");
  const subject = `${ctx.test ? "[Test] " : ""}Please complete a quick identity check${ctx.dealName ? ` for ${ctx.dealName}` : ""}`;
  return { subject, html: frame("Identity check", inner, footerFor({ sentFrom: ctx.sentFrom, ref: ref || "none", agents: ctx.agents }), ctx.test) };
}

export interface KycFinishedFile {
  name: string;
  docKey: KycDocKey | null;
}

// The note to the deal's agents when a client has finished.
export function kycFinishedEmail(ctx: {
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
      ? `<div style="margin:12px 0;padding:12px 16px;border-left:3px solid #b45309;background:#fff7ed;font-size:14px;color:${INK}"><strong>${escHtml(who)} has not done their own identity check.</strong> The check on this link was ${escHtml(someoneElse)}'s. Send ${escHtml(who)} a new request from the deal's AML card, or, if ${escHtml(someoneElse)} can act for ${escHtml(ctx.partyName)}, record why on the deal.</div>`
      : "",
    ctx.files.length ? h2(`Files received (${ctx.files.length})`) + `<table role="presentation" cellspacing="0" cellpadding="0" border="0">${fileRows}</table>` : p("No files were uploaded."),
    ctx.missing.length ? h2("Not sent") + p(escHtml(ctx.missing.join(", "))) : "",
    ctx.pep !== undefined ? h2("Public roles") + p(`${escHtml(kycPepWords(ctx.pep))}${ctx.pepDetail ? `: ${escHtml(ctx.pepDetail)}` : ""}`) : "",
    ctx.pep === "yes" || ctx.pep === "unsure"
      ? `<div style="margin:12px 0;padding:12px 16px;border-left:3px solid #b45309;background:#fff7ed;font-size:14px;color:${INK}"><strong>Enhanced due diligence.</strong> A politically exposed person, or a family member or close associate of one, needs senior management approval (a director or the MLRO) before the deal goes ahead, their source of wealth and source of funds established, and closer monitoring (MLR 2017 reg 35; HMRC AMLG11650). A UK one starts as lower risk, so the checks can be lighter and use public information unless something else raises the risk (FCA FG25/3). Screening must confirm whether the answer is right.</div>`
      : "",
    ctx.owners?.list.length ? h2("Owners on the register") + p(`${ctx.owners.list.map(o => `${escHtml(o.name)} (${escHtml(o.detail)})`).join("; ")}.<br><strong>${escHtml(kycOwnersWords(ctx.owners.reply?.answer))}</strong>${ctx.owners.reply?.detail ? `: ${escHtml(ctx.owners.reply.detail)}` : ""}`) : "",
    ctx.owners?.reply?.answer === "no"
      ? `<div style="margin:12px 0;padding:12px 16px;border-left:3px solid #b45309;background:#fff7ed;font-size:14px;color:${INK}"><strong>A difference from the register.</strong> The client says the owners Companies House lists are not right. Find out who the owners are, and report the difference to Companies House (HMRC, AMLG11400 14.8).</div>`
      : "",
    ctx.redFlags?.length ? redFlagBox(ctx.redFlags) : "",
    ctx.peopleOutstanding?.length
      ? h2(`Still to come from the people to check for ${ctx.partyName}`) + `<ul style="margin:4px 0 14px 18px;padding:0;font-size:14px;color:${INK}">${ctx.peopleOutstanding.map(line => `<li style="margin:0 0 4px">${escHtml(line)}</li>`).join("")}</ul>`
      : "",
    ctx.kind === "company" && !ctx.owners?.list.length ? p("Check the owners they list against the PSC register at Companies House. A difference must be reported to Companies House (HMRC, AMLG11400 14.8).", `font-size:13px;color:${BODY}`) : "",
    button("Open the deal's AML", ctx.dealLink),
    p("The files are on the client's KYC record. Review them and sign off in the app as usual.", `font-size:13px;color:${MUTED}`),
  ].join("\n");
  return {
    subject: someoneElse
      ? `${ctx.test ? "[Test] " : ""}The checks sent to ${who} were finished with ${someoneElse}'s identity check, for ${ctx.dealName} (ref ${ctx.ref})`
      : `${ctx.test ? "[Test] " : ""}${who} has finished their identity checks for ${ctx.dealName} (ref ${ctx.ref})`,
    html: frame("Checks finished", inner, `Sent from ${escHtml(ctx.sentFrom)} by ChatBGP. Reference ${escHtml(ctx.ref)}.`, ctx.test, "the deal's agents receive"),
  };
}

// How BGP handles a red flag (Woody, 17 November 2026: "basically we do the
// normal checks expected and if there is a red flag then we get KYC4U").
export const KYC_RED_FLAG_RULE = "The routine checks are done in the app. A red flag, or a higher-risk factor in BGP's AML policy, goes to KYC4U, BGP's outsourced KYC provider, for enhanced due diligence, and the Nominated Officer or the Deputy approves the result before the deal goes ahead.";
export const KYC_RED_FLAG_STEP = "Open the deal's AML card and press Request KYC4U check on this party: the red flags are already in the request's note.";

// The client checks run on their own switch (Woody, 18 November 2026,
// choosing "client checks only"): on unless KYC_CLIENT_CHECKS is "off",
// whether or not the old in-app AML (IN_APP_AML_ENABLED) is on. These are
// the staff addresses the retired-AML switch lets through for them; the
// client's own page (/api/kyc-upload/<token>) was never behind it.
export const clientChecksSwitchOn = (value: string | null | undefined): boolean => String(value ?? "").trim().toLowerCase() !== "off";
export const KYC_CLIENT_CHECK_ROUTES: readonly RegExp[] = [
  /^\/api\/aml\/deal\/[^/]+\/client-checks$/,
  // A person's own link (19 November 2026).
  /^\/api\/aml\/deal\/[^/]+\/client-checks\/people$/,
  // A proof of address read again or accepted (20 November 2026).
  /^\/api\/aml\/deal\/[^/]+\/client-checks\/address-proof\/(?:read|accept)$/,
  /^\/api\/aml\/client-checks\/[^/]+(?:\/remind)?$/,
  /^\/api\/aml\/poll-mailbox$/,
];

function redFlagBox(flags: KycRedFlag[]): string {
  const items = flags.map(f => `<li style="margin:0 0 6px">${escHtml(f.label)}${f.detail ? `: ${escHtml(f.detail)}` : ""} <span style="color:${MUTED}">(${escHtml(f.source)})</span></li>`).join("");
  return `<div style="margin:16px 0;padding:12px 16px;border-left:3px solid #b91c1c;background:#fef2f2;font-size:14px;color:${INK}"><strong>Red flag: raise with KYC4U.</strong><ul style="margin:8px 0 8px 18px;padding:0">${items}</ul>${escHtml(KYC_RED_FLAG_STEP)}</div>`;
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
}): { subject: string; html: string } {
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:20px;line-height:1.3;color:#b91c1c">Red flag: raise ${escHtml(ctx.partyName)} with KYC4U</h1>`,
    p(`For <strong>${escHtml(ctx.dealName)}</strong>${ctx.recipientName && ctx.recipientName !== ctx.partyName ? `, from the checks sent to <strong>${escHtml(ctx.recipientName)}</strong>` : ""}.`),
    h2("What was found"),
    `<ul style="margin:0 0 14px 18px;padding:0">${ctx.flags.map(f => `<li style="margin:0 0 6px">${escHtml(f.label)}${f.detail ? `: ${escHtml(f.detail)}` : ""} <span style="color:${MUTED}">(${escHtml(f.source)})</span></li>`).join("")}</ul>`,
    h2("What to do"),
    p(`${escHtml(KYC_RED_FLAG_RULE)} ${escHtml(KYC_RED_FLAG_STEP)}`),
    button("Open the deal's AML", ctx.dealLink),
    p("Nothing has been sent to the client or to KYC4U.", `font-size:13px;color:${MUTED}`),
  ].join("\n");
  return {
    subject: `${ctx.test ? "[Test] " : ""}Red flag on ${ctx.dealName}: raise ${ctx.partyName} with KYC4U (ref ${ctx.ref})`,
    html: frame("Red flag", inner, `Sent from ${escHtml(ctx.sentFrom)} by ChatBGP. Reference ${escHtml(ctx.ref)}.`, ctx.test, "the deal's agents receive"),
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
    p(`${ctx.dealRef != null ? `Deal #${escHtml(ctx.dealRef)}` : "The deal"} was moved to <strong>${escHtml(ctx.stage)}</strong>${ctx.movedBy ? ` by ${escHtml(ctx.movedBy)}` : ""}. BGP's AML policy says the checks are finished before contracts exchange or a lease completes.`),
    h2("Not approved"),
    `<ul style="margin:0 0 14px 18px;padding:0">${ctx.parties.map(c => `<li style="margin:0 0 6px">${escHtml(roleWord(c.role))}: <strong>${escHtml(c.name)}</strong> <span style="color:${MUTED}">(${escHtml(c.reason)})</span></li>`).join("")}</ul>`,
    h2("What to do"),
    p("Open the deal's Parties & AML and decide each party: sign it off, add KYC4U's result, or, for the other side of a deal a joint agent negotiated, mark it Not required. If anything is suspicious, it is reported to the National Crime Agency, and nobody tells the client."),
    button("Open the deal's AML", ctx.link),
  ].join("\n");
  return {
    subject: `AML: ${ctx.dealName} moved to ${ctx.stage} with checks outstanding`,
    html: frame("AML checks outstanding", inner, `Sent from ${escHtml(ctx.sentFrom)} by ChatBGP to BGP's Nominated Officer and Deputy.`, false, "the Nominated Officer and the Deputy receive"),
  };
}

// A new entry in the AML register (Woody, 19 November 2026). It goes to the
// Nominated Officer and the Deputy only and says nothing of what the entry
// is about: a mailbox is not the place for a suspicion (tipping off).
export function amlRegisterNoticeEmail(ctx: { raisedBy: string | null; link: string; sentFrom: string }): { subject: string; html: string } {
  const inner = [
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:20px;line-height:1.3">A new report is waiting for you</h1>`,
    p(`${ctx.raisedBy ? `${escHtml(ctx.raisedBy)} has` : "Someone has"} raised a report for the Nominated Officer in BGP's AML register. What it is about is not in this email: open it in ChatBGP (Deals, AML, Reports).`),
    button("Open the AML register", ctx.link),
    p("Only the Nominated Officer and the Deputy can read it.", `font-size:13px;color:${MUTED}`),
  ].join("\n");
  return {
    subject: "AML: a new report is waiting for you",
    html: frame("AML register", inner, `Sent from ${escHtml(ctx.sentFrom)} by ChatBGP to BGP's Nominated Officer and Deputy.`, false, "the Nominated Officer and the Deputy receive"),
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
  people?: Array<{ key: string; name: string; detail: string | null; done: boolean; linked: boolean; emailedAt: string | null }> | null;
  note: string | null;
  agents: KycAgent[];
  finishedAt: string | null;
  maxFileMb: number;
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
