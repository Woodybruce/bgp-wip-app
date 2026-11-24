// The four steps of a party's AML checks, one line each, for every screen that
// shows them: the transaction's Parties & AML box (client/src/components/
// deal-aml-status.tsx), the client KYC window (client/src/components/
// client-kyc/client-kyc-dialog.tsx) and the AML page's trail, which draws the
// transaction's box. Woody, 24 November 2026, on the client KYC window: "this
// is great it looks different to the transactions part though can we use this
// as the template and make them match?", then "yes build and push" and "one
// build for AML". One rule for each step's line, so every screen says the same
// thing about the same company. Pure: each screen hands in what it already
// reads.

import { amlBoxDay, firmShort, shortReason } from "./aml-box";

// done: a green tick. todo: the step's number. flag: red, for a red flag or a
// decision against (rejected) only.
export type AmlStepState = "done" | "todo" | "flag";

export interface AmlStepLine {
  state: AmlStepState;
  words: string;
  // Not reached yet (waiting on an earlier step or a run): the sign-off waits for it.
  pending?: boolean;
}

/** The steps' names (24 November 2026: step 1 is "The company", or "The person"). */
export const AML_STEP_LABEL = {
  company: "The company",
  person: "The person",
  screening: "Screening",
  sanctions: "Sanctions",
  documents: "Documents",
  signOff: "Sign-off",
} as const;

const line = (state: AmlStepState, words: string, pending = false): AmlStepLine => (pending ? { state, words, pending: true } : { state, words });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const join = (parts: Array<string | null | undefined | false>) => parts.filter((p): p is string => !!p && !!p.trim()).join(" · ");

export const AFTER_COMPANY = "After the company that signs is set";

// ── Step 1: the company (or the person) ─────────────────────────────────────

export interface CompanyStepFacts {
  // A company party with no company that signs set.
  missing: boolean;
  // What the party is when that matters: "a person", "a UK public body", "a trust: ...".
  kind?: string | null;
  // The register's first warning (dissolved, in liquidation ...).
  warning?: string | null;
  // What is still to sort, a few words each ("who to ask not set").
  gaps?: string[];
  // Facts worth a glance: "ask Jane Smith", "owned from abroad", "in Xero", "2 transactions".
  notes?: string[];
}

export function companyStepLine(f: CompanyStepFacts): AmlStepLine {
  if (f.missing) return line("todo", "Not set");
  const gaps = (f.gaps || []).filter(Boolean);
  const words = join([f.kind, f.warning ? shortReason(f.warning, 50) : null, ...gaps, ...(f.notes || [])]);
  return line(f.warning ? "flag" : gaps.length ? "todo" : "done", words || "Set");
}

// ── Step 2: screening (BGP's checks before asking) ──────────────────────────

export type ScreeningRun = "off" | "needs_company" | "none" | "running" | "cap" | "unfinished" | "done";

export interface ScreeningStepFacts {
  run: ScreeningRun;
  ranAt: string | null;
  // The live red flags' labels (not the policy's factors, not those set aside).
  redFlags: string[];
  // Check lines that found something to look at.
  attention: number;
  // A list or ComplyAdvantage that did not screen everyone: never read as clear.
  failed?: "sanctions" | "provider" | null;
  enhanced?: boolean;
  setAside?: number;
  // Some records the red flags are read from could not be read.
  unread?: boolean;
  // The red flags were read (with the checks switched off, that is all there is).
  flagsRead?: boolean;
}

/** Null: nothing to show (the checks are off and nothing was read). */
export function screeningStepLine(f: ScreeningStepFacts): AmlStepLine | null {
  if (f.redFlags.length) return line("flag", `${plural(f.redFlags.length, "red flag")}: ${shortReason(f.redFlags[0], 60)}`);
  if (f.run === "off") return f.flagsRead ? line("done", "No red flags") : null;
  if (f.run === "needs_company") return line("todo", AFTER_COMPANY, true);
  if (f.run === "running") return line("todo", "Running now", true);
  if (f.run === "cap") return line("todo", "Runs tomorrow: today's limit is used", true);
  if (f.run === "none") return line("todo", "Not run yet", true);
  if (f.run === "unfinished") return line("todo", "Not finished: trying again");
  if (f.attention) return line("todo", `${f.attention} to look at`);
  if (f.failed) return line("todo", f.failed === "sanctions" ? "Sanctions lists not read: run again" : "ComplyAdvantage didn't screen everyone");
  return line("done", join([
    f.ranAt ? `Checked ${amlBoxDay(f.ranAt)}` : "Checked",
    "no red flags",
    f.enhanced ? "higher risk" : null,
    f.setAside ? `${f.setAside} set aside` : null,
    f.unread ? "some records not read" : null,
  ]));
}

// The simple view of a letting under £10,000 a month: the sanctions lists alone.
export interface SanctionsStepFacts {
  run: ScreeningRun;
  ranAt: string | null;
  // A possible match on a sanctions list (the party's or the transaction's).
  match: boolean;
  // The sanctions line came back and read every list.
  read: boolean;
  // Who to raise a match with: "AML Officer (Jack)".
  officer: string;
}

export function sanctionsStepLine(f: SanctionsStepFacts): AmlStepLine {
  if (f.run === "needs_company") return line("todo", AFTER_COMPANY, true);
  if (f.run === "off") return line("todo", "Not run", true);
  if (f.run === "running") return line("todo", "Running now", true);
  if (f.run === "cap") return line("todo", "Runs tomorrow: today's limit is used", true);
  if (f.run === "none") return line("todo", "Not run yet", true);
  if (f.match) return line("flag", `Possible match: raise with ${f.officer}`);
  if (!f.read) return line("todo", "Sanctions lists not read: run again");
  return line("done", join([f.ranAt ? `Checked ${amlBoxDay(f.ranAt)}` : "Checked", "no match"]));
}

// ── Step 3: documents ───────────────────────────────────────────────────────

export type ClientRequestStatus = "not_sent" | "sent" | "opened" | "in_progress" | "finished" | "expired" | "cancelled";

export interface DocumentsStepFacts {
  notRequired?: boolean;
  // A letting under £10,000 a month: nothing is asked of anyone.
  sanctionsOnly?: boolean;
  // Signed off already: nothing more is needed now.
  cleared?: boolean;
  // The firm BGP relies on (MLR 2017 reg 39).
  reliance?: string | null;
  // The joint agent asked for their documents.
  joint?: {
    firm: string;
    status: "not_sent" | "sent" | "opened" | "expired" | "in";
    sentAt: string | null;
    // Who sent their files (shown beside the firm).
    who?: string | null;
    unread: number;
    missing: number;
    // The app is emailing them what is missing.
    chasing: boolean;
    // A letting whose reliance terms they have not agreed (requests before 23 November 2026).
    termsPending: boolean;
  } | null;
  // The client checks sent to the party (not a person's own link).
  request?: { status: ClientRequestStatus; who: string; sentAt: string | null } | null;
  // The people the checks need, and how many still owe something.
  people?: { total: number; owing: number } | null;
  companyMissing?: boolean;
  // The client checks are switched on.
  clientChecks: boolean;
}

export function documentsStepLine(f: DocumentsStepFacts): AmlStepLine {
  if (f.notRequired) return line("done", "Not needed");
  if (f.sanctionsOnly) return line("done", "Not needed: sanctions checks only");
  if (f.reliance) return line("done", `Relying on ${firmShort(f.reliance)}`);
  if (f.joint) {
    const firm = firmShort(f.joint.firm);
    if (f.joint.status === "not_sent") return line("todo", `Asked ${firm}: the email didn't go`);
    if (f.joint.status === "expired") return line("todo", `The link to ${firm} ran out`);
    if (f.joint.status === "sent" || f.joint.status === "opened") return line("todo", join([`Asked ${firm}${f.joint.sentAt ? ` ${amlBoxDay(f.joint.sentAt)}` : ""}`, "nothing back yet"]));
    const from = `From ${firm}${f.joint.who ? ` (${f.joint.who})` : ""}`;
    if (f.joint.unread) return line("todo", join([from, `${plural(f.joint.unread, "file")} not read yet`]));
    if (f.joint.missing) return line("todo", join([from, `${f.joint.missing} missing`, f.joint.chasing ? "chasing" : null]));
    if (f.joint.termsPending) return line("todo", join([from, "terms not agreed yet"]));
    return line("done", join([from, "all in"]));
  }
  const req = f.request && f.request.status !== "cancelled" ? f.request : null;
  if (req) {
    const total = f.people?.total || 0;
    const owing = f.people?.owing || 0;
    if (req.status === "not_sent") return line("todo", "The client checks email didn't go");
    if (req.status === "expired") return line("todo", "The client checks link ran out");
    if (req.status === "finished" && !owing) return line("done", join([`From ${req.who}`, "all in"]));
    return line("todo", join([`Sent to ${req.who}${req.sentAt ? ` ${amlBoxDay(req.sentAt)}` : ""}`, total > 1 ? `${total - owing} of ${total} people done` : null]));
  }
  if (f.cleared) return line("done", "Not needed now: cleared");
  if (f.companyMissing) return line("todo", AFTER_COMPANY, true);
  if (!f.clientChecks) return line("todo", "For the officers to sign off");
  return line("todo", "Not asked yet");
}

// ── Step 4: sign-off ────────────────────────────────────────────────────────

export interface SignOffStepFacts {
  rejected: boolean;
  // Marked Not required, with the reason's short words ("" when none).
  notRequired: string | null;
  approved: { by: string | null; until: string | null } | null;
  expired: { on: string | null } | null;
  companyMissing: boolean;
  // The screening (or sanctions) step has not come back yet.
  screeningPending: boolean;
  // The simple view of a small letting: "After the sanctions checks".
  sanctionsView?: boolean;
  documentsDone: boolean;
  // The sign-off rules could be read for this party.
  decisionRead: boolean;
  blocked: string | null;
  // Enhanced due diligence: an officer signs it off, with a note.
  edd: boolean;
  canDecide: boolean;
  canSignOff: boolean;
  needsNote: boolean;
}

export function signOffStepLine(f: SignOffStepFacts): AmlStepLine {
  if (f.rejected) return line("flag", "Rejected");
  if (f.notRequired !== null) return line("done", f.notRequired ? `Not required: ${f.notRequired}` : "Not required");
  if (f.approved) return line("done", `Cleared${f.approved.by ? ` by ${f.approved.by}` : ""}${f.approved.until ? ` until ${amlBoxDay(f.approved.until)}` : ""}`);
  if (f.expired) return line("todo", `Expired${f.expired.on ? ` ${amlBoxDay(f.expired.on)}` : ""}: check again`);
  if (f.companyMissing) return line("todo", AFTER_COMPANY, true);
  if (f.screeningPending) return line("todo", f.sanctionsView ? "After the sanctions checks" : "After screening", true);
  if (!f.documentsDone || !f.decisionRead) return line("todo", "After the documents", true);
  if (f.blocked) return line("todo", shortReason(f.blocked), true);
  if (f.edd) return line("todo", f.canDecide ? "Ready: an officer signs off, with a note" : "Ready: for an officer");
  if (!f.canSignOff) return line("todo", "Ready: for an agent or an officer");
  return line("todo", f.needsNote ? "Ready: sign off with a note" : "Ready to sign off");
}

// ── The Next line's colours, one set for every screen ───────────────────────

// The transaction's rule says done / act / flag / wait (shared/aml-box.ts); the
// client file's says ok / act / wait / bad (shared/client-kyc.ts). One box draws both.
export type AmlNextTone = "ok" | "act" | "wait" | "bad";
export function amlNextTone(t: "done" | "act" | "flag" | "wait" | "ok" | "bad"): AmlNextTone {
  return t === "done" ? "ok" : t === "flag" ? "bad" : t;
}
