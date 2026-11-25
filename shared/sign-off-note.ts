// The sign-off note for a listed company, written from the file (Woody, 24
// November 2026, after asking whether a plc needs someone to sign it off or
// is automatic: "Yes do the sign off note"). A BGP person still presses Sign
// off: the law makes the risk decision BGP's, with its reasons kept. The app
// writes what the file holds, so the sign-off needs no typing once nothing is
// outstanding. When something is (the person instructing us not checked
// yet), the person signing still says why they sign off without it.
//
// Only for a company listed on a UK or EU regulated market, or owned through
// one company at each level by one, with no red flag, on the full checks. A
// market abroad is the officers' to weigh, and a red flag makes it enhanced:
// both keep their own note. The server writes the note again at sign-off
// (never from the request), and keeps it with the approval.

import { LISTING_WORDS, isRegisterDirector, listingSettled, type KycPrecheckResult } from "./kyc-prechecks";
import type { PersonIdState } from "./kyc-people";

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

const day = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
};

const listWords = (items: string[]): string =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export interface SignOffNoteInput {
  precheck: Pick<KycPrecheckResult, "ranAt" | "companiesHouse" | "sanctions" | "web" | "complyAdvantage"> | null;
  // The party's red flags and the transaction's, that count (set aside ones left out).
  redFlags: number;
  sanctionsOnly: boolean;
  // A company: a person, a trust or a public body has its own note.
  company: boolean;
  // The request to the person dealing with us for the company (not cancelled), if any.
  acting: null | {
    name: string | null;
    sentAt: string | null;
    finished: boolean;
    idState: PersonIdState | null;
    // Their authority to act came with the client checks.
    authoritySent: boolean;
    // Our signed terms of engagement are on the party's record (25 November 2026).
    authorityTerms?: boolean;
  };
  // What the people to check still owe, once the client checks are back.
  outstanding: string[];
}

const ID_WORDS: Record<PersonIdState, string> = {
  passed: "identity check passed",
  waiting: "identity check done, result awaited",
  document: "photo ID sent",
  started: "identity check started, not finished",
  retry: "identity check to do again",
  restart: "identity check to do again",
  not_started: "identity check not done yet",
};

/** The note, or null when the party is not a listed company (or one owned through one) the app can write it for. */
export function listedSignOffNote(input: SignOffNoteInput): string | null {
  const ch = input.precheck?.companiesHouse;
  const listing = ch?.listing;
  if (!input.company || input.sanctionsOnly || input.redFlags > 0 || !ch || !listing || !listingSettled(listing.market)) return null;
  const pre = input.precheck!;
  const name = `${text(ch.name)}${ch.number ? ` (${text(ch.number)})` : ""}`;
  const parent = `${text(listing.company)}${listing.companyNumber ? ` (${text(listing.companyNumber)})` : ""}`;
  const market = LISTING_WORDS[listing.market];
  const since = day(listing.since);
  const lines: string[] = [];

  if (listing.viaParent) {
    lines.push(`${name} is owned through one company at each level by ${parent}, which is ${market}${since ? ` (Companies House PSC exemption since ${since})` : ""}. Standard due diligence: no individual owners to verify.`);
    const chain = [text(ch.name)];
    for (const c of ch.chain || []) {
      if (text(c.number) && text(c.number) === text(listing.companyNumber)) continue;
      if (text(c.name) && !chain.includes(text(c.name))) chain.push(text(c.name));
    }
    if (!chain.includes(text(listing.company))) chain.push(text(listing.company));
    if (chain.length > 1) lines.push(`Ownership read at Companies House: ${chain.join(" > ")}.`);
  } else {
    lines.push(`${name} is ${market}${since ? ` (Companies House PSC exemption since ${since})` : ""}. Simplified due diligence: no beneficial owners to identify.`);
  }
  const status = text(ch.status).replace(/-/g, " ");
  if (status) lines.push(`Status at Companies House: ${status}.`);
  if (ch.lastAccountsMadeUpTo) lines.push(`Latest accounts made up to ${day(ch.lastAccountsMadeUpTo) || ch.lastAccountsMadeUpTo}.`);

  // What BGP's checks screened, and what did not run.
  const ran: string[] = [];
  const notRun: string[] = [];
  if (pre.sanctions?.ran) {
    const n = (pre.sanctions.lines || []).length;
    const lists = pre.sanctions.lists?.length ? listWords(pre.sanctions.lists) : "the sanctions lists";
    ran.push(`${lists}${n ? ` (${n} name${n === 1 ? "" : "s"})` : ""}`);
  } else notRun.push("the sanctions lists");
  if (pre.web?.ran) ran.push("a web search (adverse media and public roles)");
  else notRun.push("the web search");
  const caFailed = (pre.complyAdvantage?.lines || []).filter(l => l.status === "error").length;
  if (pre.complyAdvantage?.ran && !caFailed) ran.push("ComplyAdvantage");
  else if (pre.complyAdvantage?.ran) notRun.push(`ComplyAdvantage for ${caFailed} name${caFailed === 1 ? "" : "s"}`);
  else if (pre.complyAdvantage?.skipped && !/^no ComplyAdvantage keys/i.test(pre.complyAdvantage.skipped)) notRun.push("ComplyAdvantage");
  const ranOn = day(pre.ranAt);
  if (ran.length) lines.push(`BGP's checks${ranOn ? ` on ${ranOn}` : ""} found no red flags: ${listWords(ran)}.`);
  if (notRun.length) lines.push(`Not screened: ${listWords(notRun)}.`);

  // The person dealing with us for the company (HMRC: their identity and their authority to act).
  const a = input.acting;
  if (!a || !text(a.name)) {
    lines.push("The client checks have not been sent to anyone instructing us for it yet.");
  } else {
    const who = text(a.name);
    const director = isRegisterDirector(who, (ch.officers || []).filter(o => /director|member/i.test(o.role)).map(o => o.name));
    const authority = director ? "a director at Companies House" : a.authorityTerms ? "authority to act from our signed terms of engagement" : a.authoritySent ? "authority to act sent with the client checks" : "authority to act not sent yet";
    lines.push(`Instructed by ${who}: ${ID_WORDS[a.idState || "not_started"]}; ${authority}.`);
    if (!a.finished) lines.push(`The client checks sent${a.sentAt ? ` on ${day(a.sentAt)}` : ""} are not finished.`);
  }
  if (input.outstanding.length) lines.push(`Still to come: ${input.outstanding.join("; ")}.`);
  return lines.join(" ");
}
