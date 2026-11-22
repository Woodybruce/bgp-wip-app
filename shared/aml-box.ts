// The AML box, shortened (Woody, 20 November 2026, on the AML checks page:
// "minimise each section with the detail to pop out so people can clearly see
// whats happening and whats needed its pretty overwhelming for them but
// clearly we need that info displayed for the AML officers"). Each party
// opens on one line, what happens next and who it waits on, and each of its
// sections on one line of its own; the detail opens when a line is pressed.
//
// Pure rules. The facts come from what the box already reads: the deal's AML
// status (GET /api/kyc/deal/:id/status), its parties (GET /api/deals/:id/
// parties), its client checks (GET /api/aml/deal/:id/client-checks), KYC4U's
// drafts, and the dashboard's stage for the party (shared/aml-dashboard.ts,
// read for the one deal), so the box and the AML dashboard say the same thing.
// The box is client/src/components/deal-aml-status.tsx.

import type { AmlStage } from "./aml-dashboard";
import { personNamesMatch } from "./kyc-prechecks";

export type AmlBoxTone = "done" | "wait" | "act" | "flag";
export type AmlBoxWho = "nobody" | "bgp" | "client" | "kyc4u" | "officers";
/** What the Next line's button does. */
export type AmlBoxAction =
  | "fill_in"            // the party box: the company that signs, who to ask, an email
  | "add_details"        // the party box, for the people the checks need
  | "send_client_checks"
  | "people"             // open People: send each their own link
  | "request_kyc4u"
  | "kyc4u_form"         // KYC4U's own form, to press the Send to ChatBGP bookmark
  | "kyc4u_result"       // the Nominated Officer or a Deputy adds KYC4U's result
  | "sign_off"
  | "red_flags"          // open Red flags
  | "billing";           // open Who pays: BGP's invoice goes to another company

export const AML_BOX_WHO_WORDS: Record<AmlBoxWho, string> = {
  nobody: "Nothing to do",
  bgp: "Waiting on BGP",
  client: "Waiting on the client",
  kyc4u: "Waiting on KYC4U",
  officers: "For the Nominated Officer",
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
  precheckRunning: boolean;
  redFlags: number;                      // live red flags (set aside ones do not count)
  factors: number;                       // live higher-risk factors under BGP's AML policy
  sanctionsOnly: boolean;                // a letting under £10,000 a month (policy A)
  clientChecks: boolean;                 // the client checks are switched on
  // The latest request to the person acting that is not cancelled.
  request: { status: "not_sent" | "sent" | "opened" | "in_progress" | "finished" | "expired"; to: string | null } | null;
  people: AmlBoxPerson[];                // the people to check who still owe something
  kyc4u: "none" | "queued" | "raised";   // queued: prepared, not yet on KYC4U's form
  canSignOff: boolean;
  canDecide: boolean;                    // the Nominated Officer or a Deputy (admins until one is set)
  signOffBlocked: string | null;         // why it cannot be signed off now; null: it can
  needsNote: boolean;
  // BGP's client billed as another company than the one that signs, with
  // nobody saying who pays (shared/deal-billing.ts, 20 November 2026). Asked
  // before sign-off; it never jumps ahead of the checks themselves.
  billingDiffers?: boolean;
  // Recorded as a trust (Jack, 20 November 2026): KYC4U checks it in full.
  trust?: boolean;
  // Owned through a company registered abroad, in words ("Kirkbi A/S
  // (Denmark)"): KYC4U find the owners behind it (Woody, 21 November 2026:
  // "foreign companies I think we will send to KYC4U").
  ownersAbroad?: string | null;
  // Another firm's checks the officers rely on (MLR 2017 reg 39), in words
  // ("Relying on Smith & Co's checks (...)"). It stands in for the client
  // checks, not for enhanced due diligence, which is why it comes after the
  // KYC4U, trust, owners abroad and red flag steps.
  reliance?: string | null;
  // In-house enhanced due diligence (Woody, 21 November 2026: "I'm trying to
  // set this up without using kyc4u"): with the officers' setting on, an
  // enhanced, trust or owned-abroad party is not sent to KYC4U. Its client
  // checks run as any party's, and the Nominated Officer or a Deputy signs it
  // off with a note. A possible sanctions match is resolved first.
  inHouseEdd?: boolean;
  sanctionsFlags?: number;
}

export interface AmlNextStep { tone: AmlBoxTone; who: AmlBoxWho; words: string; action: AmlBoxAction | null }

const DUE_WORDS: Record<string, string> = {
  tenant: "HMRC expects the tenant's checks once the landlord accepts their offer, before any agreement.",
  purchaser: "HMRC expects the buyer's checks before an offer is accepted, and at the latest before exchange.",
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

// "BGP's checks" keeps its capitals; "Enhanced due diligence" reads on in a sentence.
const lowerFirst = (t: string) => (!t || /^[A-Z][A-Z]/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
const stop = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);

/** "Huseyn Mirhadiyev (identity check and proof of address)". */
function owed(people: readonly AmlBoxPerson[]): string {
  return andList(people.map(p => (p.needs.length ? `${p.name} (${andList(p.needs)})` : p.name)));
}

// BGP's invoice goes to another company than the one the checks are on
// (shared/deal-billing.ts): HMRC expects BGP to know who pays and why.
const BILLING_STEP: AmlNextStep = {
  tone: "act", who: "bgp",
  words: "BGP's invoice goes to another company than the one that signs: record who pays and how they are related, or confirm it is the same company.",
  action: "billing",
};

/** The one line a party opens on: what happens next, and who it waits on. */
export function amlNextStep(f: AmlBoxFacts): AmlNextStep {
  const until = amlBoxDay(f.expiresAt);
  switch (f.stage) {
    case "rejected":
      return { tone: "flag", who: "officers", words: "Rejected. Don't go ahead unless the Nominated Officer says so.", action: null };
    case "not_required":
      return { tone: "done", who: "nobody", words: `Not required${f.notRequiredWords ? `: ${lowerFirst(f.notRequiredWords)}` : ""}.`, action: null };
    case "approved":
      return { tone: "done", who: "nobody", words: `Approved${f.approvedBy ? ` by ${f.approvedBy}` : ""}${until ? `, valid until ${until}` : ""}.`, action: null };
    case "expiring":
      return { tone: "act", who: "bgp", words: `Approved until ${until || "soon"}: check again before then.`, action: f.clientChecks ? "send_client_checks" : f.inHouseEdd ? null : "request_kyc4u" };
    case "expired":
      return { tone: "flag", who: "bgp", words: `Approval ran out${until ? ` on ${until}` : ""}: check again.`, action: f.clientChecks ? "send_client_checks" : f.inHouseEdd ? null : "request_kyc4u" };
    default:
      break;
  }
  if (f.company && f.companyMissing) {
    return { tone: "act", who: "bgp", words: "Set the company that signs.", action: "fill_in" };
  }
  if (f.precheckRunning) {
    return { tone: "wait", who: "bgp", words: "BGP's checks are running (a minute or two).", action: null };
  }
  // With the officers doing enhanced checks in-house, a KYC4U request holds
  // nothing up (Woody, 22 November 2026): the steps below carry on.
  if (f.kyc4u === "queued" && !f.inHouseEdd) {
    return { tone: "act", who: "bgp", words: "KYC4U request prepared: submit it on KYC4U's portal.", action: "kyc4u_form" };
  }
  if ((f.kyc4u === "raised" || f.stage === "with_kyc4u") && !f.inHouseEdd) {
    return { tone: "wait", who: "kyc4u", words: `With KYC4U. ${f.canDecide ? "Add their result when it comes." : "An officer adds their result."}`, action: f.canDecide ? "kyc4u_result" : null };
  }
  const edd = !!f.inHouseEdd && (!!f.trust || !!f.ownersAbroad || f.redFlags > 0 || f.factors > 0);
  if (edd && (f.sanctionsFlags || 0) > 0) {
    return {
      tone: "flag", who: "officers",
      words: "Possible sanctions match: check it first. Set it aside if it isn't them; if it is, tell the Nominated Officer.",
      action: "red_flags",
    };
  }
  if (f.trust && !edd) {
    return {
      tone: "flag", who: "bgp",
      words: "A trust: goes to KYC4U in full. Request the KYC4U check.",
      action: "request_kyc4u",
    };
  }
  if (f.ownersAbroad && !edd) {
    return {
      tone: "act", who: "bgp",
      words: `Owned from abroad (${f.ownersAbroad}): goes to KYC4U. Request the KYC4U check.`,
      action: "request_kyc4u",
    };
  }
  if (f.redFlags > 0 && !edd) {
    return {
      tone: "flag", who: "bgp",
      words: `${f.redFlags} red flag${s(f.redFlags)}: raise it with KYC4U${f.canDecide ? ", or set aside any that do not apply, with a comment" : ""}.`,
      action: "request_kyc4u",
    };
  }
  if (f.factors > 0 && !edd) {
    return {
      tone: "flag", who: "bgp",
      words: `Enhanced due diligence (${f.factors} higher-risk factor${s(f.factors)}): raise it with KYC4U.`,
      action: "request_kyc4u",
    };
  }
  // Enhanced due diligence by BGP is the officers' to sign off, not an agent's.
  const canSign = edd ? f.canDecide : f.canSignOff;
  const eddWords = "Enhanced checks: the Nominated Officer or a Deputy signs it off.";
  if (f.sanctionsOnly) {
    if (f.billingDiffers) return BILLING_STEP;
    if (canSign && f.signOffBlocked === null) {
      return { tone: "act", who: "bgp", words: "Letting under £10,000 a month: sanctions only, all clear. Sign it off.", action: "sign_off" };
    }
    return { tone: "wait", who: "bgp", words: `Letting under £10,000 a month: sanctions only.${f.signOffBlocked ? ` Before it can be signed off: ${lowerFirst(stop(f.signOffBlocked))}` : ""}`, action: null };
  }
  if (f.reliance) {
    if (f.billingDiffers) return BILLING_STEP;
    if (canSign && f.signOffBlocked === null) {
      return { tone: "act", who: "bgp", words: `${stop(f.reliance)} The client checks are not needed: sign it off${edd ? " (enhanced due diligence by BGP, with a note)" : ""}.`, action: "sign_off" };
    }
    return {
      tone: "wait", who: canSign ? "bgp" : "officers",
      words: `${stop(f.reliance)}${f.signOffBlocked ? ` Before it can be signed off: ${lowerFirst(stop(f.signOffBlocked))}` : edd ? ` ${eddWords}` : " An agent on the deal, the Nominated Officer or a Deputy signs it off."}`,
      action: null,
    };
  }
  if (f.due === false && !f.request) {
    return { tone: "wait", who: "nobody", words: `Not due yet. ${DUE_WORDS[f.role] || "HMRC does not expect these checks yet."}`, action: null };
  }
  if (!f.clientChecks) {
    return f.inHouseEdd
      ? { tone: "act", who: "officers", words: "Client checks are off: an officer signs it off with a note.", action: f.canDecide ? "sign_off" : null }
      : { tone: "act", who: "bgp", words: "Raise it with KYC4U.", action: "request_kyc4u" };
  }
  // In-house enhanced due diligence: the client checks run as any party's,
  // with the officers' sign-off at the end.
  if (f.gaps.length) {
    return { tone: "act", who: "bgp", words: `${andList(f.gaps.map(g => g.replace(/\.$/, "")))}.`, action: "fill_in" };
  }
  const unreachable = f.people.filter(p => !p.reachable && !p.linked);
  if (!f.request || f.request.status === "not_sent" || f.request.status === "expired") {
    const lead = !f.request
      ? `Send the client checks${f.askName ? ` to ${f.askName}` : ""}.`
      : f.request.status === "not_sent" ? "The client checks email did not go: send it again." : "The client checks link ran out: send a new one.";
    const also = unreachable.length ? ` ${andList(unreachable.map(p => p.name))} also need${unreachable.length === 1 ? "s" : ""} an email or mobile for a link of their own.` : "";
    return { tone: "act", who: "bgp", words: lead + also, action: "send_client_checks" };
  }
  if (unreachable.length) {
    return {
      tone: "act", who: "bgp",
      words: `${andList(unreachable.map(p => p.name))} need${unreachable.length === 1 ? "s" : ""} to do their own checks: no email or mobile is held for them yet.`,
      action: "add_details",
    };
  }
  const noLink = f.people.filter(p => !p.linked);
  if (noLink.length) {
    return { tone: "act", who: "bgp", words: `Send ${andList(noLink.map(p => p.name))} a link of their own.`, action: "people" };
  }
  if (f.request.status !== "finished") {
    const to = f.request.to;
    const others = f.people.filter(p => !to || !personNamesMatch(p.name, to));
    return {
      tone: "wait", who: "client",
      words: `Waiting on ${f.request.to || "the client"} to finish the client checks${others.length ? `, and on ${owed(others)}` : ""}.`,
      action: null,
    };
  }
  if (f.people.length) {
    return { tone: "wait", who: "client", words: `Waiting on ${owed(f.people)}.`, action: null };
  }
  if (f.billingDiffers) return BILLING_STEP;
  if (f.signOffBlocked === null && canSign) {
    return {
      tone: "act", who: "bgp",
      words: edd ? `Everything asked for is in. ${eddWords}` : f.needsNote ? "Everything asked for is in: sign it off, with a note." : "Everything asked for is in: sign it off.",
      action: "sign_off",
    };
  }
  if (f.signOffBlocked) {
    return { tone: "wait", who: canSign ? "bgp" : "officers", words: `Everything asked for is in. Before it can be signed off: ${lowerFirst(stop(f.signOffBlocked))}`, action: null };
  }
  return edd
    ? { tone: "wait", who: "officers", words: `Everything asked for is in. ${eddWords}`, action: null }
    : { tone: "act", who: "bgp", words: "Everything asked for is in: an agent on the deal, the Nominated Officer or a Deputy signs it off.", action: null };
}
