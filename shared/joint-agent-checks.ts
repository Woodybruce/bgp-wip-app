// Asking the joint agent for their checks (Woody, 22 November 2026: "Let's
// get the app to follow HMRC rules and also send them an email so they can
// load everything up or email the aml? If they email or upload it can we then
// upload it and check it in the app?").
//
// HMRC, read on GOV.UK on 22 November 2026:
// - a sale (AMLG2200, section 21): "The EAB who did not identify the buyer
//   should request the CDD documentation from the other EAB. If the CDD
//   documentation is not provided by the other EAB, the EAB should document
//   in writing that it has been requested and not provided."
// - a letting at £10,000 a month or more (AMLG2300, section 17): "LABs must
//   verify that all parties to the rental agreement are who they say they
//   are", with no joint agent exception; BGP can use the joint agent's
//   checks only under a reliance agreement (MLR 2017 reg 39; AMLG11410): the
//   firm agrees, BGP has its information at once, copies of the documents
//   come on request and are kept for five years, and BGP stays responsible.
//
// The request is a client checks request (kyc_upload_tokens) with
// request.audience "joint_agent": one email from the KYC mailbox to the joint
// agent's contact, copied to the deal's agents, a page of their own (upload,
// and for a letting the reliance terms to agree), or a reply by email with the
// reference. What they send is filed on the party's KYC record, each file read
// once (server/joint-agent-checks.ts), and set against the people the checks
// need here. It lists; it never decides: the officers record the outcome.
//
// Pure: the words, the reading's shape and the coverage rule.

import { personNamesMatch } from "./kyc-prechecks";
import type { JointAgentRule } from "./aml-policy";
import { ENGLAND_BANK_HOLIDAYS } from "./aml-register";

/** What the joint agent's request carries, beside the client checks request's own fields. */
export interface JointAgentRequestDetails {
  firm: string;
  firmCompanyId: string | null;
  // The joint agent's contact in the CRM, when one was picked.
  contactId?: string | null;
  rule: JointAgentRule;
  // The joint agent agreed to the reliance terms on its page.
  reliance: JointRelianceConfirmation | null;
  // Each file read once, by kyc_documents id.
  readings?: Record<string, JointFileReading>;
  // Each email asking for what is missing, and when the app stopped chasing.
  chases?: JointChase[];
  chaseStoppedAt?: string | null;
}

export interface JointRelianceConfirmation {
  name: string;
  position: string | null;
  firm: string;
  // The firm's anti-money laundering supervisor and its number there.
  supervisor: string;
  registration: string | null;
  agreedAt: string;
}

/** The terms the joint agent agrees to on its page (MLR 2017 reg 39; HMRC, AMLG11410). */
export function jointRelianceTerms(partyName: string): string[] {
  return [
    `Bruce Gillingham Pollard may rely on our customer due diligence on ${partyName} for this transaction (Money Laundering Regulations 2017, regulation 39).`,
    "We have given, or will now give, Bruce Gillingham Pollard the information we hold on who the customer is, its beneficial owners and anyone acting for it.",
    "We will give Bruce Gillingham Pollard copies of the identification and verification documents immediately on request.",
    "We will keep those documents for five years after the transaction completes or our business relationship with the customer ends.",
    `Our checks on ${partyName} were full customer due diligence, not simplified due diligence.`,
    "We are supervised for anti-money laundering in the UK, by the supervisor named below.",
  ];
}

export const JOINT_RELIANCE_NAME_MIN = 4;

/** The joint agent's agreement on its page, checked. */
export function jointRelianceInput(raw: Record<string, unknown>, firm: string, now: Date = new Date()): { ok: true; value: JointRelianceConfirmation } | { ok: false; message: string } {
  const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  if (raw.agree !== true && raw.agree !== "true") return { ok: false, message: "Tick to agree to the terms." };
  const name = clean(raw.name, 120);
  if (name.length < JOINT_RELIANCE_NAME_MIN || !/\s/.test(name)) return { ok: false, message: "Give your full name." };
  const supervisor = clean(raw.supervisor, 80);
  if (supervisor.length < 2) return { ok: false, message: "Name your firm's anti-money laundering supervisor (HMRC, for most estate and letting agents)." };
  return {
    ok: true,
    value: {
      name, position: clean(raw.position, 120) || null, firm: clean(raw.firm, 160) || firm,
      supervisor, registration: clean(raw.registration, 40) || null, agreedAt: now.toISOString(),
    },
  };
}

// ── Reading what they send ──────────────────────────────────────────────────

export const JOINT_DOC_KINDS = {
  photo_id: "Photo ID",
  electronic_id: "Electronic identity check",
  proof_of_address: "Proof of address",
  company_register: "Company register",
  ownership: "Ownership",
  screening: "Sanctions and PEP screening",
  risk_assessment: "Risk assessment",
  source_of_funds: "Source of funds",
  reliance_letter: "Reliance letter",
  other: "Other",
} as const;
export type JointDocKind = keyof typeof JOINT_DOC_KINDS;
export const isJointDocKind = (v: unknown): v is JointDocKind => typeof v === "string" && Object.prototype.hasOwnProperty.call(JOINT_DOC_KINDS, v);

export const JOINT_RESULTS = ["pass", "fail", "refer", "clear", "match"] as const;
export type JointResult = typeof JOINT_RESULTS[number];

/** One file the joint agent sent, as the reader read it. */
export interface JointFileReading {
  state: "read" | "failed" | "off";
  why?: string | null;
  // The file itself could not be opened (empty, too large, a picture or a
  // Word file with nothing to read): theirs to send again. Any other failure
  // is BGP's to read again.
  unreadable?: boolean | null;
  file: string;
  readAt: string;
  kind?: JointDocKind;
  title?: string | null;
  issuer?: string | null;
  date?: string | null;     // yyyy-mm-dd: issued, the statement's date, the report's date
  expiry?: string | null;   // yyyy-mm-dd: a photo ID's expiry
  // born: yyyy-mm. On a CDD summary or risk assessment, whether it says the
  // person's identity and address were verified (22 November 2026: HMRC
  // wants the information for reliance, not copies of every document).
  people?: Array<{ name: string; born: string | null; idVerified?: boolean | null; addressVerified?: boolean | null }>;
  companies?: string[];
  owners?: string[];
  result?: JointResult | null;
  addressVerified?: boolean | null;
  certified?: boolean | null;
  // The document says simplified due diligence was applied: BGP cannot rely
  // on simplified checks (HMRC, AMLG11410).
  simplified?: boolean | null;
  summary?: string | null;
}

// A real calendar day only: 30 February does not roll over into March.
const ymd = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
};
const ym = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}` : null;
};
const words = (v: unknown, n = 200): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  return s || null;
};

/** The reader's answer, kept only in the shape above: nothing it adds reaches the screen. */
export function checkJointReading(raw: any, file: string, now: Date = new Date()): JointFileReading {
  const kind = isJointDocKind(raw?.kind) ? raw.kind : "other";
  const yes = (v: unknown) => (typeof v === "boolean" ? v : null);
  const people = (Array.isArray(raw?.people) ? raw.people : [])
    .map((p: any) => ({ name: words(p?.name, 120), born: ym(p?.born), idVerified: yes(p?.idVerified), addressVerified: yes(p?.addressVerified) }))
    .filter((p: { name: string | null }) => !!p.name && /[a-z]/i.test(p.name!))
    .slice(0, 12) as NonNullable<JointFileReading["people"]>;
  const list = (v: any) => (Array.isArray(v) ? v : []).map((x: unknown) => words(x, 160)).filter((x: string | null): x is string => !!x).slice(0, 12);
  const result = JOINT_RESULTS.includes(raw?.result) ? raw.result as JointResult : null;
  return {
    state: "read", file, readAt: now.toISOString(), kind,
    title: words(raw?.title, 160), issuer: words(raw?.issuer, 120),
    date: ymd(raw?.date), expiry: ymd(raw?.expiry),
    people, companies: list(raw?.companies), owners: list(raw?.owners),
    result,
    addressVerified: typeof raw?.addressVerified === "boolean" ? raw.addressVerified : null,
    certified: typeof raw?.certified === "boolean" ? raw.certified : null,
    simplified: typeof raw?.simplified === "boolean" ? raw.simplified : null,
    summary: words(raw?.summary, 300),
  };
}

// ── What they sent, against the people the checks need ──────────────────────

export interface JointCoveragePerson { name: string; roles: string[]; born?: string | null }

/** Something in their files to look at, by kind, so it can be worded for BGP or for the joint agent. */
export interface JointFlag {
  kind: "expired" | "failed" | "referred" | "dob" | "match" | "simplified";
  person: string | null;
  file: string;
  // The document's own name for itself, and the expiry date or the screening's words.
  title: string | null;
  detail: string | null;
}

export interface JointCoverage {
  people: Array<{ name: string; id: string | null; address: string | null; missing: Array<"identity" | "address"> }>;
  company: { register: string | null; ownership: string | null } | null;
  screening: string | null;
  // In BGP's words; flagItems are the same, by kind.
  flags: string[];
  flagItems: JointFlag[];
  others: string[];
  // Files BGP has not read yet (to read again), and files that could not be opened (to send again).
  unread: number;
  unopened: string[];
  // In BGP's words: what their files do not cover yet.
  missing: string[];
  complete: boolean;
}

const LEGAL = /\b(limited|ltd|plc|llp|lp|inc|incorporated|llc|gmbh|sa|sas|bv|nv|ag|a\/s|as|ab|spa|srl|co|company|the)\b/g;
// A name that is a company or a trust, not a person.
const CORPORATE = /\b(limited|ltd|plc|llp|lp|inc|incorporated|llc|gmbh|sarl|sas|bv|nv|ag|a\/s|holdings?|group|trust|trustees?|foundation|partnership|company|corporation|corp|fund|capital|investments?|properties|estates?|nominees?)\b/i;
const companyKey = (name: string) => String(name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9/\s]/g, " ").replace(LEGAL, " ").replace(/\s+/g, " ").trim();

/** The same company, its legal form aside. */
export function sameJointCompany(a: string, b: string): boolean {
  const x = companyKey(a), y = companyKey(b);
  return !!x && !!y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `));
}

const shortDay = (d: string | null | undefined) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null;

const evidence = (r: JointFileReading) => [r.title || JOINT_DOC_KINDS[r.kind || "other"], shortDay(r.date)].filter(Boolean).join(", ");

const MONTH_WORDS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** The people to check's "May 1980" (shared/kyc-people.ts, bornWords) as "1980-05", "1980" as "1980". */
export function bornKey(words: string | null | undefined): string | null {
  const s = String(words || "").trim().toLowerCase();
  if (/^\d{4}-\d{2}$/.test(s) || /^\d{4}$/.test(s)) return s;
  const m = s.match(/^([a-z]+)\s+(\d{4})$/);
  if (m && MONTH_WORDS.includes(m[1])) return `${m[2]}-${String(MONTH_WORDS.indexOf(m[1]) + 1).padStart(2, "0")}`;
  return null;
}

/** The same year, and the same month when both give one. Unknown on either side agrees. */
export function bornAgrees(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  if (a.slice(0, 4) !== b.slice(0, 4)) return false;
  return a.length < 7 || b.length < 7 || a.slice(5, 7) === b.slice(5, 7);
}

/** Does a reading name this person: the name, and the date of birth when both give one. */
function names(r: JointFileReading, p: JointCoveragePerson): boolean {
  return (r.people || []).some(x => personNamesMatch(x.name, p.name) && bornAgrees(x.born, p.born));
}

/** A flag in BGP's words. */
export function jointFlagWords(f: JointFlag): string {
  switch (f.kind) {
    case "expired": return `${f.person}'s ${f.title || "photo ID"} had expired (${f.detail})`;
    case "failed": return `${f.person}'s electronic identity check failed${f.detail ? ` (${f.detail})` : ""}`;
    case "referred": return `${f.person}'s electronic identity check was referred${f.detail ? ` (${f.detail})` : ""}`;
    case "dob": return `${f.file}: names ${f.person} with another date of birth`;
    case "match": return `${f.file}: the screening found a possible match${f.detail ? ` (${f.detail})` : ""}`;
    case "simplified": return `${f.file}: says simplified due diligence was applied, which BGP cannot rely on`;
  }
}

/**
 * What the joint agent's files cover. A person's identity: a photo ID naming
 * them and in date at the document's date (or today), an electronic check
 * naming them that passed, or their CDD summary saying it was verified. Their
 * address: a proof of address naming them, an electronic check that verified
 * it, or their CDD summary saying so. A company: its register entry and who
 * owns it. Screening: a report that came back clear. A screening match, a
 * failed or referred check, an expired ID, a name with another date of birth
 * and, when BGP relies on them, simplified checks are flags. It lists; the
 * officers decide.
 */
export function jointCoverage(input: { partyName: string; kind: "company" | "individual"; people: JointCoveragePerson[]; readings: JointFileReading[]; now?: Date; reliance?: boolean }): JointCoverage {
  const now = input.now || new Date();
  const read = input.readings.filter(r => r.state === "read");
  const unopened = input.readings.filter(r => r.state !== "read" && r.unreadable).map(r => r.file);
  const unread = input.readings.length - read.length - unopened.length;
  const items: JointFlag[] = [];
  const flag = (f: JointFlag) => { if (!items.some(x => x.kind === f.kind && x.person === f.person && x.file === f.file)) items.push(f); };
  // With no people to check read by BGP (no register read for the company),
  // the owners the joint agent's own register entry or structure chart names.
  const fromFiles: JointCoveragePerson[] = [];
  if (input.kind === "company" && !input.people.length) {
    for (const name of read.filter(r => r.kind === "company_register" || r.kind === "ownership").flatMap(r => r.owners || [])) {
      if (!CORPORATE.test(name) && !fromFiles.some(p => personNamesMatch(p.name, name))) fromFiles.push({ name, roles: ["owner"] });
    }
  }
  const people = (input.people.length ? input.people : fromFiles.length ? fromFiles : input.kind === "individual" ? [{ name: input.partyName, roles: ["acting"] }] : [])
    .filter(p => p.roles.some(r => r !== "director"));
  const out = people.map(p => {
    const missing: Array<"identity" | "address"> = [];
    let id: string | null = null, address: string | null = null;
    for (const r of read) {
      const entry = (r.people || []).find(x => personNamesMatch(x.name, p.name) && bornAgrees(x.born, p.born));
      if (!entry) {
        if ((r.people || []).some(x => personNamesMatch(x.name, p.name) && !bornAgrees(x.born, p.born))) {
          flag({ kind: "dob", person: p.name, file: r.file, title: r.title || null, detail: null });
        }
        continue;
      }
      if (r.kind === "photo_id") {
        const at = r.date || now.toISOString().slice(0, 10);
        if (r.expiry && r.expiry < at) { flag({ kind: "expired", person: p.name, file: r.file, title: r.title || null, detail: shortDay(r.expiry) }); continue; }
        id = id || evidence(r);
      }
      if (r.kind === "electronic_id") {
        if (r.result === "fail" || r.result === "refer") { flag({ kind: r.result === "fail" ? "failed" : "referred", person: p.name, file: r.file, title: r.title || null, detail: r.issuer || null }); continue; }
        id = id || evidence(r);
        if (r.addressVerified) address = address || `${evidence(r)} (address verified)`;
      }
      if (r.kind === "proof_of_address") address = address || evidence(r);
      // Their CDD summary or risk assessment, saying what they verified.
      if (r.kind !== "photo_id" && r.kind !== "proof_of_address") {
        if (entry.idVerified) id = id || `${evidence(r)} (identity verified)`;
        if (entry.addressVerified) address = address || `${evidence(r)} (address verified)`;
      }
    }
    if (!id) missing.push("identity");
    if (!address) missing.push("address");
    return { name: p.name, id, address, missing };
  });
  let company: JointCoverage["company"] = null;
  if (input.kind === "company") {
    const register = read.find(r => r.kind === "company_register" && (r.companies || []).some(c => sameJointCompany(c, input.partyName)))
      || read.find(r => r.kind === "company_register");
    const ownership = read.find(r => r.kind === "ownership") || read.find(r => r.kind === "company_register" && (r.owners || []).length);
    company = { register: register ? evidence(register) : null, ownership: ownership ? evidence(ownership) : null };
  }
  let screening: string | null = null;
  for (const r of read.filter(x => x.kind === "screening")) {
    if (r.result === "match" || r.result === "refer") flag({ kind: "match", person: null, file: r.file, title: r.title || null, detail: r.summary || (r.result === "refer" ? "referred" : null) });
    else screening = screening || `${evidence(r)}${r.result === "clear" ? ": clear" : ""}`;
  }
  if (input.reliance) for (const r of read.filter(x => x.simplified)) flag({ kind: "simplified", person: null, file: r.file, title: r.title || null, detail: null });
  const known = [...people.map(p => p.name)];
  const others = [...new Set(read.flatMap(r => (r.people || []).map(x => x.name)).filter(n => !known.some(k => personNamesMatch(k, n))))].slice(0, 8);
  const missing = [
    ...out.filter(p => p.missing.length).map(p => `${p.name}: ${p.missing.join(" and ")}`),
    ...(company && !company.register ? ["the company's register entry"] : []),
    ...(company && !company.ownership ? ["who owns the company"] : []),
    ...(!screening ? ["their sanctions and PEP screening"] : []),
  ];
  const flags = items.map(jointFlagWords);
  return { people: out, company, screening, flags, flagItems: items, others, unread, unopened, missing, complete: !missing.length && !flags.length && !unread && !unopened.length };
}

/**
 * What is still needed from the joint agent, one plain line each, for their
 * email and page (you: true) or for BGP's screens (you: false). Nothing yet:
 * no file has come. A file not read yet is BGP's to read, never theirs to send:
 * until it is read they are asked for nothing it might hold (only a file that
 * could not be opened, and the reliance terms), and BGP's list opens with it.
 */
export function jointGapLines(c: JointCoverage | null, opts: { you: boolean; reliance: boolean; agreed: boolean; nothingYet: boolean; partyName: string }): string[] {
  const your = opts.you ? "your" : "their";
  const lines: string[] = [];
  if (opts.nothingYet || !c) lines.push(opts.you ? `Your checks on ${opts.partyName}: nothing has come yet` : `Their checks on ${opts.partyName}: nothing has come yet`);
  else {
    const unread = c.unread || 0;
    if (!opts.you && unread) lines.push(`${unread} file${unread === 1 ? "" : "s"} from them not read yet: press Read again, or check ${unread === 1 ? "it" : "them"} by eye`);
    for (const f of c.unopened || []) lines.push(opts.you ? `${f} could not be opened: please send it again, as a PDF or a photo` : `${f} could not be opened: ask them to send it again`);
  }
  if (!opts.nothingYet && c && !(opts.you && (c.unread || 0) > 0)) {
    for (const p of c.people) {
      if (p.missing.includes("identity")) lines.push(`${p.name}: an ID document (a passport, photocard driving licence or national identity card), ${your} electronic identity check showing a pass, or ${your} CDD summary saying their identity was verified`);
      if (p.missing.includes("address")) lines.push(`${p.name}: a proof of address (a utility bill, bank or building society statement, or council tax bill), or ${your} check confirming it`);
    }
    if (c.company && !c.company.register) lines.push("The company's register entry (Companies House, or its register abroad)");
    if (c.company && !c.company.ownership) lines.push("Who owns or controls the company: a structure chart, or its register of people with significant control");
    if (!c.screening) lines.push(`${opts.you ? "Your" : "Their"} sanctions and PEP screening on the company and the people`);
    for (const f of c.flagItems) {
      switch (f.kind) {
        case "expired": lines.push(`${f.person}'s ${f.title || "photo ID"} had expired (${f.detail}): ${opts.you ? "please send one in date" : "one in date is needed"}`); break;
        case "failed": lines.push(`${f.person}'s electronic identity check failed: ${opts.you ? "please send another check or an ID document" : "another check or an ID document is needed"}`); break;
        case "referred": lines.push(`${f.person}'s electronic identity check was referred: ${opts.you ? "please send how it was resolved" : "how it was resolved is needed"}`); break;
        case "dob": lines.push(`${f.file} gives ${f.person} a different date of birth: ${opts.you ? "please confirm which is right" : "which is right needs confirming"}`); break;
        case "match": lines.push(`${f.file} shows a possible screening match: ${opts.you ? "please send how it was resolved" : "how it was resolved is needed"}`); break;
        case "simplified": lines.push(`${f.file} says simplified due diligence was applied: ${opts.you ? "we can't rely on simplified checks, so please send your full checks" : "BGP cannot rely on simplified checks"}`); break;
      }
    }
  }
  if (opts.reliance && !opts.agreed) lines.push(opts.you ? "Your agreement to the reliance terms, on the page" : "Their agreement to the reliance terms");
  return lines;
}

// ── Chasing what is missing (Woody, 22 November 2026: "we need to explain
// whats missing and keep emailing") ─────────────────────────────────────────

/** Every this many days while something is missing, skipping weekends and bank holidays. */
export const JOINT_CHASE_EVERY_DAYS = 3;
/** Automatic chases before the app stops and tells the deal's agents. */
export const JOINT_CHASE_MAX = 10;

export interface JointChase { at: string; by: string; auto: boolean; missing: string[] }

/**
 * Whether the joint agent is chased today: "chase" when something is still
 * missing and the last email (the request or a chase) went at least three
 * days ago, on a working day (a weekday that is not an England bank holiday:
 * the caller says, jointWorkingDay); "stop" when the app's own chases since the last one
 * a person sent have run out (the deal's agents are then told, once); null
 * otherwise. Never once the party is
 * decided (approved, Not required, the reliance recorded), the request is
 * cancelled, the app stopped, or nothing is missing.
 */
export function jointChaseDue(input: {
  sentAt: string | null; chases: JointChase[]; stoppedAt: string | null; settled: boolean; cancelled: boolean;
  gaps: number; now: Date; weekday: boolean;
}): "chase" | "stop" | null {
  if (!input.sentAt || input.cancelled || input.settled || input.stoppedAt || !input.gaps || !input.weekday) return null;
  // Three London calendar days after the last email, so the daily 10:00 run
  // chases a request sent on Monday afternoon on Thursday morning.
  const last = lastEmailDay([input.sentAt, ...input.chases.map(c => c.at)]);
  const today = londonDayNumber(input.now);
  if (last === null || today === null || today - last < JOINT_CHASE_EVERY_DAYS) return null;
  // A chase sent by a person starts the app's count again.
  const lastByHand = input.chases.map(c => !c.auto).lastIndexOf(true);
  return input.chases.slice(lastByHand + 1).filter(c => c.auto).length >= JOINT_CHASE_MAX ? "stop" : "chase";
}

/** A moment's London calendar day, as a count of days (for "three days later"). */
export function londonDayNumber(t: string | Date): number | null {
  const d = typeof t === "string" ? new Date(t) : t;
  if (!Number.isFinite(d.getTime())) return null;
  const [y, m, dd] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, dd) / 86400000);
}

const dayKey = (day: number) => new Date(day * 86400000).toISOString().slice(0, 10);
// Day 0 (1 January 1970) was a Thursday: (day + 4) % 7 is 0 on a Sunday, 6 on a Saturday.
const workingDayNumber = (day: number) => ![0, 6].includes((day + 4) % 7) && !ENGLAND_BANK_HOLIDAYS.includes(dayKey(day));

/** A working day in London: a weekday that is not an England bank holiday. */
export function jointWorkingDay(d: Date): boolean {
  const day = londonDayNumber(d);
  return day !== null && workingDayNumber(day);
}

function lastEmailDay(moments: (string | null | undefined)[]): number | null {
  const days = moments.filter((t): t is string => !!t).map(londonDayNumber).filter((n): n is number => n !== null);
  return days.length ? Math.max(...days) : null;
}

/**
 * The day the app chases next (shown on the deal): three London days after
 * the last email, moved to the next working day, as noon UTC on that day.
 */
export function jointNextChaseDay(moments: (string | null | undefined)[]): string | null {
  const last = lastEmailDay(moments);
  if (last === null) return null;
  let day = last + JOINT_CHASE_EVERY_DAYS;
  while (!workingDayNumber(day)) day++;
  return new Date(day * 86400000 + 12 * 3600000).toISOString();
}

/** The joint agent request's state, as the deal's AML box reads it. */
export type JointRequestStatus = "not_sent" | "sent" | "opened" | "in" | "finished" | "expired" | "cancelled";

/** The one line under the party, for the joint agent's checks. */
export function jointLine(input: { rule: JointAgentRule; firm: string | null; status: JointRequestStatus | null; files: number; reliance: boolean }): string {
  const firm = input.firm || "the joint agent";
  switch (input.status) {
    case null: return input.rule === "letting" ? `Not asked: ask ${firm} for their checks under a reliance agreement` : `Not asked: ask ${firm} for their checks`;
    case "not_sent": return "The email to the joint agent did not go: send it again";
    case "expired": return `${firm}'s link ran out: ask again`;
    case "cancelled": return "Cancelled";
    case "sent": return `Asked ${firm}: waiting`;
    case "opened": return `Asked ${firm}: they opened it`;
    default: {
      const files = `${input.files} file${input.files === 1 ? "" : "s"}`;
      if (input.rule === "letting") return `${firm} sent ${files}${input.reliance ? " and agreed to the reliance terms" : ": reliance terms not agreed yet"}`;
      return `${firm} sent ${files}`;
    }
  }
}

// ── What the deal's AML box reads (GET /api/deals/:id/joint-agent-checks) ───

export interface JointAgentRequestView {
  // The request's key, for Remind and Cancel (the client checks routes). Staff only.
  token: string;
  ref: string;
  status: JointRequestStatus;
  firm: string;
  to: string | null;
  toEmail: string | null;
  // Added by BGP from files the joint agent emailed to someone at BGP: no
  // email went from the app.
  manual: boolean;
  sentAt: string | null;
  sentBy: string | null;
  sendError: string | null;
  openedAt: string | null;
  finishedAt: string | null;
  expiresAt: string;
  link: string;
  reliance: JointRelianceConfirmation | null;
  files: Array<{ documentId: string | null; name: string; uploadedAt: string; url: string | null; reading: JointFileReading | null }>;
  // Each email asking for what is missing, the app's next one, and when it stopped.
  chases: JointChase[];
  nextChaseAt: string | null;
  chaseStoppedAt: string | null;
}

export interface JointAgentPartyView {
  role: string;
  companyId: string;
  name: string;
  kind: "company" | "individual";
  // BGP's client on the deal (dealClientRole): its own checks, never the joint agent's.
  isClient: boolean;
  requests: JointAgentRequestView[];
  // The latest request that is not cancelled, set against the people to check.
  coverage: JointCoverage | null;
  // What it still needs, in BGP's words (jointGapLines).
  gaps: string[];
  // Their files not read yet, and whether there is anything to ask them for
  // (nothing a file not read yet may hold is asked for).
  unread: number;
  askable: boolean;
  line: string;
}

export interface JointAgentChecksView {
  dealName: string;
  rule: JointAgentRule;
  ruleWords: string;
  firm: { companyId: string | null; name: string } | null;
  contacts: Array<{ id: string; name: string; email: string | null }>;
  defaultContactId: string | null;
  clientRole: string;
  parties: JointAgentPartyView[];
}
