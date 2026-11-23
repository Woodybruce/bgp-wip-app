// The AML box, shortened (Woody, 20 November 2026, on the AML checks page:
// "minimise each section with the detail to pop out so people can clearly see
// whats happening and whats needed its pretty overwhelming for them but
// clearly we need that info displayed for the AML officers"), then made
// simple (Woody, 22 November 2026: "there is a large amount of text some of
// which is very AI and its very crowded"; "yes go ahead" to four steps per
// party). Each party opens on its Next line: a bold lead (who it waits on, or
// what to do) and a few words, with one button. A status, not an explanation:
// the reasons live on the Rules page and in each step's detail.
//
// Pure rules. The facts come from what the box already reads: the deal's AML
// status (GET /api/kyc/deal/:id/status), its parties (GET /api/deals/:id/
// parties), its client checks (GET /api/aml/deal/:id/client-checks), KYC4U's
// drafts (history only since 23 November 2026), and the dashboard's stage for the party (shared/aml-dashboard.ts,
// read for the one deal), so the box and the AML dashboard say the same thing.
// The box is client/src/components/deal-aml-status.tsx.

import type { AmlStage } from "./aml-dashboard";
import { personNamesMatch } from "./kyc-prechecks";

export type AmlBoxTone = "done" | "wait" | "act" | "flag";
export type AmlBoxWho = "nobody" | "bgp" | "client" | "officers" | "joint_agent";
/** What the Next line's button does. */
export type AmlBoxAction =
  | "fill_in"            // the party box: the company that signs, who to ask, an email
  | "trust"              // a trust's structure (23 November 2026)
  | "add_details"        // the party box, for the people the checks need
  | "send_client_checks"
  | "send_via_agent"     // the client checks, through the party's own agent to pass on
  | "people"             // open People: send each their own link
  | "sign_off"
  | "red_flags"          // open Red flags
  | "billing"            // open Who pays: BGP's invoice goes to another company
  | "joint"              // open the Documents step on the joint agent's checks
  | "joint_remind";      // email the joint agent what is still missing

export const AML_BOX_WHO_WORDS: Record<AmlBoxWho, string> = {
  nobody: "Nothing to do",
  bgp: "Waiting on BGP",
  client: "Waiting on the client",
  officers: "For the Nominated Officer",
  joint_agent: "Waiting on the other agent",
};

/** One person the checks need who still owes something. */
export interface AmlBoxPerson {
  name: string;
  needs: string[];      // "identity check", "proof of address"
  reachable: boolean;   // an email or mobile is held for them
  linked: boolean;      // they have a link (their own, or the request to the person acting)
}

export interface AmlBoxFacts {
  role: string;                          // landlord, tenant, vendor, purchaser
  // The dashboard's stage for the party, or one read from the AML status
  // when the dashboard's row could not be read (null: not known).
  stage: AmlStage | null;
  // HMRC's timing (amlDue): null when not known.
  due: boolean | null;
  approvedBy: string | null;
  expiresAt: string | null;
  notRequiredWords: string | null;
  company: boolean;                      // a company party, not a private individual
  companyMissing: boolean;               // a company party with no company that signs set
  gaps: string[];                        // the party box's other gaps, in words (who to ask, an email)
  askName: string | null;                // who to ask, as the deal names them
  // The party's own agent, on a party BGP does not act for (23 November 2026:
  // "with the agent acting for the tenant or against us we need them to pass
  // on the standard KYC requests"): with nobody to ask at the party, the
  // client checks go to them to pass on.
  theirAgent?: string | null;
  precheckRunning: boolean;
  redFlags: number;                      // live red flags (set aside ones do not count)
  factors: number;                       // live higher-risk factors under BGP's AML policy
  sanctionsOnly: boolean;                // a letting under £10,000 a month (policy A)
  clientChecks: boolean;                 // the client checks are switched on
  // The latest request to the person acting that is not cancelled.
  request: { status: "not_sent" | "sent" | "opened" | "in_progress" | "finished" | "expired"; to: string | null } | null;
  people: AmlBoxPerson[];                // the people to check who still owe something
  // KYC4U is no longer used (Woody, 23 November 2026): a request made before
  // then holds nothing up. Kept so a caller may still say what was there.
  kyc4u?: "none" | "queued" | "raised";
  canSignOff: boolean;
  canDecide: boolean;                    // the Nominated Officer or a Deputy (admins until one is set)
  signOffBlocked: string | null;         // why it cannot be signed off now; null: it can
  needsNote: boolean;
  // BGP's client billed as another company than the one that signs, with
  // nobody saying who pays (shared/deal-billing.ts, 20 November 2026). Asked
  // before sign-off; it never jumps ahead of the checks themselves.
  billingDiffers?: boolean;
  // Recorded as a trust: checked by BGP's officers in full (Jack, 23 November
  // 2026: "Remove KYC4u on trusts. We need you to build the trust
  // structuring"). trustGaps: what BGP still has to record on its structure.
  trust?: boolean;
  trustGaps?: string[];
  // Owned through a company registered abroad, in words ("Kirkbi A/S
  // (Denmark)"): enhanced due diligence by the officers, who find the owners
  // behind it (KYC4U did until 23 November 2026).
  ownersAbroad?: string | null;
  // Another firm's checks the officers rely on (MLR 2017 reg 39), in words
  // ("Relying on Smith & Co's checks (...)"). It stands in for the client
  // checks, not for enhanced due diligence, which is why it comes after the
  // trust, owners abroad and red flag steps.
  reliance?: string | null;
  // Enhanced due diligence is always BGP's own since KYC4U stopped being used
  // (Woody, 23 November 2026): an enhanced, trust or owned-abroad party's
  // client checks run as any party's, and the Nominated Officer or a Deputy
  // signs it off with a note. A possible sanctions match is resolved first.
  // Kept for callers that still send it; it changes nothing.
  inHouseEdd?: boolean;
  sanctionsFlags?: number;
  // The joint agent asked for their checks on the party (22 November 2026),
  // the latest request not cancelled: HMRC's route for the deal (a sale: ask
  // and record; a letting: their checks under a reliance agreement), whether
  // they agreed to the reliance terms, and how many things their files do not
  // cover yet (server/joint-agent-checks.ts).
  // chasing: the app is emailing them what is missing every three days.
  joint?: { status: "not_sent" | "sent" | "opened" | "in" | "finished" | "expired"; firm: string; rule: "sale" | "letting" | "other"; reliance: boolean; missing: number; chasing?: boolean; unread?: number } | null;
  // The Not required reason's key ("joint_agent", "no_deal"), for its short words.
  notRequiredReason?: string | null;
  // The firm relied on (MLR 2017 reg 39), by name.
  relianceFirm?: string | null;
}

export interface AmlNextStep {
  tone: AmlBoxTone;
  who: AmlBoxWho;
  // The bold start of the line: who it waits on, or what to do ("Waiting on
  // Savills", "To do", "Ready to sign off", "Cleared").
  lead: string;
  // A few words after it; may be empty.
  words: string;
  action: AmlBoxAction | null;
}

const DUE_WORDS: Record<string, string> = {
  tenant: "once the landlord accepts their offer",
  purchaser: "before an offer is accepted",
};

export function andList(names: readonly string[]): string {
  const list = names.filter(Boolean);
  return list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

const s = (n: number) => (n === 1 ? "" : "s");

export function amlBoxDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
}

/** A firm's name without its legal form, for a line on the screen: "Savills (UK) Limited" is "Savills". */
export function firmShort(name: string | null | undefined): string {
  const n = String(name || "").replace(/\s*\((?:UK|U\.K\.|GB)\)\s*/gi, " ")
    .replace(/[,\s]+(?:limited|ltd\.?|llp|plc|lp|inc\.?|llc|gmbh|s\.?a\.?|b\.?v\.?)$/i, "").replace(/\s+/g, " ").trim();
  return n || String(name || "").trim();
}

/** The first clause of a longer reason, for the Next line: the rest is in the step. */
export function shortReason(t: string | null | undefined, max = 70): string {
  let first = String(t || "").split(/(?<=[a-z0-9)])[.:;](?:\s|$)/i)[0].trim().replace(/[.:;]$/, "");
  // Too long for the line: a bracketed aside is detail, so it goes first.
  if (first.length > max && first.indexOf(" (") >= 12) first = first.slice(0, first.indexOf(" (")).trim();
  return first.length > max ? `${first.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : first;
}

// "Savills' checks", "Knight Frank's checks".
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

const NOT_REQUIRED_SHORT: Record<string, string> = {
  joint_agent: "the joint agent's party",
  no_deal: "no transaction with this party",
};

const step = (tone: AmlBoxTone, who: AmlBoxWho, lead: string, words: string, action: AmlBoxAction | null = null): AmlNextStep =>
  ({ tone, who, lead, words, action });

// BGP's invoice goes to another company than the one the checks are on
// (shared/deal-billing.ts): HMRC expects BGP to know who pays and why.
const BILLING_STEP: AmlNextStep = step("act", "bgp", "To do", "Say who pays BGP's invoice", "billing");

/** The one line a party opens on: who it waits on or what to do, in a few words, and one button. */
export function amlNextStep(input: AmlBoxFacts): AmlNextStep {
  // A trust is checked in-house whatever the officers' switch says (23 November 2026).
  const f: AmlBoxFacts = input.trust ? { ...input, inHouseEdd: true } : input;
  const until = amlBoxDay(f.expiresAt);
  switch (f.stage) {
    case "rejected":
      return step("flag", "officers", "Rejected", "don't go ahead without the Nominated Officer");
    case "not_required":
      return step("done", "nobody", "Not required", NOT_REQUIRED_SHORT[f.notRequiredReason || ""] || "");
    case "approved":
      return step("done", "nobody", "Cleared", until ? `until ${until}` : "");
    case "expiring":
      return step("act", "bgp", `Expires ${until || "soon"}`, "check again", f.clientChecks ? "send_client_checks" : null);
    case "expired":
      return step("flag", "bgp", "Expired", "check again", f.clientChecks ? "send_client_checks" : null);
    default:
      break;
  }
  // The joint agent asked for their checks (22 November 2026): their route
  // comes before BGP's own checks on the company that signs.
  const jointRunning = !!f.joint && f.joint.status !== "expired" && f.joint.status !== "not_sent";
  if (f.company && f.companyMissing && !jointRunning) {
    return step("act", "bgp", "To do", "Set the company that signs", "fill_in");
  }
  if (f.precheckRunning) {
    return step("wait", "bgp", "Screening", "running now");
  }
  // Higher risk is the officers' enhanced due diligence: KYC4U is no longer
  // used (Woody, 23 November 2026), and a KYC4U request made before then
  // holds nothing up.
  const edd = !!f.trust || !!f.ownersAbroad || f.redFlags > 0 || f.factors > 0;
  if (edd && (f.sanctionsFlags || 0) > 0) {
    return step("flag", "officers", "Possible sanctions match", "check it first", "red_flags");
  }
  // A trust's structure comes first: its people are the ones to check.
  if (f.trust && f.trustGaps?.length) {
    return step("act", "bgp", "To do", f.trustGaps[0], "trust");
  }
  // Enhanced due diligence by BGP is the officers' to sign off, not an agent's.
  const canSign = edd ? f.canDecide : f.canSignOff;
  const ready = (words: string) => step("act", edd ? "officers" : "bgp", "Ready to sign off", words, "sign_off");
  const blocked = () => step("wait", canSign ? "bgp" : "officers", "Not ready to sign off", shortReason(f.signOffBlocked));
  if (f.sanctionsOnly) {
    if (f.billingDiffers) return BILLING_STEP;
    if (canSign && f.signOffBlocked === null) return ready("sanctions only, all clear");
    return f.signOffBlocked ? blocked() : step("wait", "officers", "Sanctions only", "an agent or an officer signs off");
  }
  if (f.reliance) {
    const firm = firmShort(f.relianceFirm) || "another firm";
    if (f.billingDiffers) return BILLING_STEP;
    if (canSign && f.signOffBlocked === null) return ready(`relying on ${firm}${edd ? "; add a note" : ""}`);
    return f.signOffBlocked ? blocked() : step("wait", "officers", `Relying on ${firm}`, edd ? "an officer signs off" : "an agent or an officer signs off");
  }
  // The joint agent asked for their checks (HMRC: on a sale, ask and record
  // what came back; on a letting, their checks only under a reliance
  // agreement). A request that ran out falls back to the client checks.
  const joint = f.joint && f.joint.status !== "expired" ? f.joint : null;
  const clientGoing = !!f.request && f.request.status !== "expired" && f.request.status !== "not_sent";
  if (joint && (joint.status === "in" || joint.status === "finished")) {
    const firm = firmShort(joint.firm);
    // A file from them not read yet: read it before asking them for anything else.
    if (joint.unread) return step("act", "bgp", "To do", `read ${joint.unread === 1 ? "the file" : `${joint.unread} files`} from ${firm}`, "joint");
    if (joint.missing) {
      const n = `${joint.missing} document${s(joint.missing)} missing`;
      return joint.chasing
        ? step("wait", "joint_agent", `Waiting on ${firm}`, n, "joint_remind")
        : step("act", "bgp", "To do", `ask ${firm} for ${joint.missing === 1 ? "the missing document" : `${joint.missing} missing documents`}`, "joint_remind");
    }
    if (joint.rule === "sale") return step("act", "officers", "For the officers", `${possessive(firm)} checks are in: mark Not required`, "joint");
    // A reliance they agreed before 23 November 2026 can still be recorded.
    if (joint.reliance) return step("act", "officers", "For the officers", `${possessive(firm)} checks are in: record the reliance`, "joint");
    // No reliance terms any more (Woody, 23 November 2026: "we cant agree
    // reliance"): with their documents in, BGP signs the party off on its own
    // check of them.
    if (f.billingDiffers) return BILLING_STEP;
    if (f.signOffBlocked === null && canSign) return ready(`${possessive(firm)} documents are in: add a note`);
    if (f.signOffBlocked) return blocked();
    return step("wait", "officers", "For the officers", `${possessive(firm)} documents are in`);
  }
  if (joint && joint.status === "not_sent" && !clientGoing) {
    return step("act", "bgp", "To do", `the email to ${firmShort(joint.firm)} didn't go: ask again`, "joint");
  }
  if (joint && (joint.status === "sent" || joint.status === "opened") && !clientGoing) {
    return step("wait", "joint_agent", `Waiting on ${firmShort(joint.firm)}`, joint.rule === "sale" ? "for their checks" : "for the documents", "joint");
  }
  if (f.due === false && !f.request) {
    return step("wait", "nobody", "Not due yet", DUE_WORDS[f.role] || "");
  }
  if (!f.clientChecks) {
    return step("act", "officers", "For the officers", "sign it off with a note", f.canDecide ? "sign_off" : null);
  }
  if (f.gaps.length) {
    return step("act", "bgp", "To do", f.gaps[0].replace(/\.$/, ""), "fill_in");
  }
  const unreachable = f.people.filter(p => !p.reachable && !p.linked);
  if (!f.request || f.request.status === "not_sent" || f.request.status === "expired") {
    const viaAgent = !f.request && !f.askName && !!f.theirAgent;
    const words = viaAgent ? `Send the checks to ${firmShort(f.theirAgent)} to pass on`
      : !f.request ? `Send the client checks${f.askName ? ` to ${f.askName}` : ""}`
      : f.request.status === "not_sent" ? "The client checks email didn't go: send it again" : "The link ran out: send a new one";
    return step("act", "bgp", "To do", words, viaAgent ? "send_via_agent" : "send_client_checks");
  }
  if (unreachable.length) {
    return step("act", "bgp", "To do", `Add contact details for ${andList(unreachable.map(p => p.name))}`, "add_details");
  }
  const noLink = f.people.filter(p => !p.linked);
  if (noLink.length) {
    return step("act", "bgp", "To do", `Send ${andList(noLink.map(p => p.name))} their own link`, "people");
  }
  if (f.request.status !== "finished") {
    const to = f.request.to;
    const others = f.people.filter(p => !to || !personNamesMatch(p.name, to));
    return step("wait", "client", `Waiting on ${to || "the client"}`, others.length ? `and ${andList(others.map(p => p.name))}` : "");
  }
  if (f.people.length) {
    return step("wait", "client", `Waiting on ${andList(f.people.map(p => p.name))}`, "");
  }
  if (f.billingDiffers) return BILLING_STEP;
  if (f.signOffBlocked === null && canSign) return ready(edd ? "enhanced: add a note" : f.needsNote ? "add a note" : "");
  if (f.signOffBlocked) return blocked();
  return edd
    ? step("wait", "officers", "For the officers", "everything is in: an officer signs off")
    : step("wait", "officers", "Everything is in", "an agent or an officer signs off");
}
