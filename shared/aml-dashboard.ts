// The AML dashboard (Woody, 18 November 2026: step 6 of
// docs/deal-page-review-2026-11-18.md, "a dashboard of all AML / KYC live and
// finished checks ... nice and easy", brought forward with "go ahead with
// your suggestions"). One row per deal party. Pure rules: where a party has
// got to, whether HMRC expects its checks yet, which pill it is on and who it
// waits on, all read from records the app already holds. The feed is
// server/aml-dashboard.ts; the page client/src/pages/aml-dashboard.tsx.

import { legacyToCode, type DealStatusCode } from "./deal-status";
import { dealStatusLabel } from "./letting-rules";

export type AmlStage = "not_started" | "bgp_checked" | "joint_asked" | "client_sent" | "joint_in" | "client_finished" | "relied" | "with_kyc4u" | "approved" | "rejected" | "expiring" | "expired" | "not_required";

export const AML_STAGE_LABEL: Record<AmlStage, string> = {
  not_started: "Not started",
  bgp_checked: "Screened",
  client_sent: "Client checks sent",
  client_finished: "Documents in",
  // The joint agent asked for their checks on the party (22 November 2026),
  // and their checks in: BGP's officers then decide.
  joint_asked: "Joint agent asked",
  joint_in: "Joint agent's files in",
  // Another firm's checks relied on (MLR 2017 reg 39; 21 November 2026).
  relied: "Relying on another firm",
  with_kyc4u: "With KYC4U",
  approved: "Cleared",
  rejected: "Rejected",
  expiring: "Expiring",
  expired: "Expired",
  // Marked by the Nominated Officer or a Deputy: no transaction was done with
  // the party (since Issue 4 of the policy; before it, also the other side of
  // a deal a joint agent negotiated).
  not_required: "Not required",
};

export type AmlBucket = "todo" | "in_progress" | "done" | "expiring" | "not_due" | "closed";

export const AML_BUCKETS: Array<{ key: AmlBucket; label: string }> = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
  { key: "expiring", label: "Expiring" },
  { key: "not_due", label: "Not due yet" },
  // A completed or invoiced deal whose party was never approved or rejected:
  // a past gap for the MLRO to see, not work on the To do list.
  { key: "closed", label: "Closed, not checked" },
];

/** An approval this close to its re-check date is Expiring. */
export const AML_EXPIRING_DAYS = 30;
/** BGP's checks before asking count as done for this long (the sign-off rule's window). */
export const AML_PRECHECK_DAYS = 30;

export interface AmlPartyFacts {
  role: string;                        // landlord, tenant, vendor, purchaser
  dealStatus: string | null;           // as stored; read with legacyToCode
  kyc: { status: string | null; expiresAt: string | Date | null };
  precheckAt: string | Date | null;    // the latest of BGP's checks before asking on the party
  clientSentAt: string | Date | null;  // the latest client checks request on this deal (not cancelled)
  clientFinishedAt: string | Date | null;
  kyc4uOpen: boolean;                  // raised with KYC4U on this deal and not answered
  // KYC4U's own latest status for the party (the company that signs when its
  // state is read from it, else the brand) reads as still with them. An
  // "in review" left by the in-app AML retired in October 2026 is not:
  // on live on 18 November 2026, 552 of 615 such parties had no KYC4U request.
  kyc4uInReview: boolean;
  // Marked Not required on this deal by the Nominated Officer or the Deputy.
  notRequired?: boolean;
  // When the officers recorded relying on another firm's checks for the
  // party (MLR 2017 reg 39), not withdrawn: BGP signs it off on them.
  reliedAt?: string | Date | null;
  // false only to read a party as it stood while KYC4U was used. KYC4U is no
  // longer used (Woody, 23 November 2026: "We are no longer using KYC 4U"), so
  // a KYC4U request or KYC4U's own status no longer holds a party at With
  // KYC4U.
  inHouse?: boolean;
  // The joint agent asked for their checks on the party (not cancelled), and
  // when their files (or, on a letting, their agreement to the reliance
  // terms) came in (server/joint-agent-checks.ts).
  jointAskedAt?: string | Date | null;
  jointInAt?: string | Date | null;
}

const time = (v: string | Date | null | undefined): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Where a party has got to. A decision first, then the furthest step on the way. */
export function amlStage(f: AmlPartyFacts, now: Date = new Date()): AmlStage {
  if (f.kyc.status === "rejected") return "rejected";
  if (f.notRequired) return "not_required";
  if (f.kyc.status === "approved") {
    const until = time(f.kyc.expiresAt);
    if (until !== null && until < now.getTime()) return "expired";
    if (until !== null && until - now.getTime() <= AML_EXPIRING_DAYS * 86400000) return "expiring";
    return "approved";
  }
  if (f.inHouse === false && (f.kyc4uOpen || (f.kyc.status === "in_review" && f.kyc4uInReview))) return "with_kyc4u";
  if (time(f.reliedAt) !== null) return "relied";
  if (time(f.clientFinishedAt) !== null) return "client_finished";
  if (time(f.jointInAt) !== null) return "joint_in";
  if (time(f.clientSentAt) !== null) return "client_sent";
  if (time(f.jointAskedAt) !== null) return "joint_asked";
  const pre = time(f.precheckAt);
  if (pre !== null && now.getTime() - pre <= AML_PRECHECK_DAYS * 86400000) return "bgp_checked";
  return "not_started";
}

// When the checks start and when they must be complete: BGP's AML policy,
// Issue 4 (approved by Jack, 23 November 2026), the table "When do we do
// client identity checks". BGP's own client who lets or sells: from
// engagement, complete before the property is marketed. A buyer or tenant,
// and every party BGP does not act for: from agreed heads of terms, complete
// before exchange (a sale) or before the lease completes (a letting), the
// tenant's identity before any agreement is signed. Nothing exchanges or
// completes until every party is done.
const FROM_HOTS = new Set(["HOT", "SOL", "EXC", "COM", "INV"]);
// The property is on the market from Available on (a letting's or a sale's);
// a sale on the Investment Tracker is Live before that, already instructed.
const MARKETED = new Set(["AVA", "NEG", "HOT", "SOL", "EXC", "COM", "INV"]);
const EXCHANGED = new Set(["EXC", "COM", "INV"]);

/** BGP's own client who lets or sells: checked from engagement, before marketing. */
const lettingOrSellingClient = (role: string, clientRole: string | null | undefined): boolean =>
  (role === "landlord" || role === "vendor") && (clientRole == null || clientRole === role);

/**
 * Whether the policy expects the party's checks yet. clientRole: the party BGP
 * acts for (shared/deal-parties.ts dealClientRole); left out, a landlord or
 * seller reads as BGP's client, as before Issue 4.
 */
export function amlDue(role: string, dealStatus: string | null, clientRole?: string | null): boolean {
  if (lettingOrSellingClient(role, clientRole)) return true;
  return FROM_HOTS.has(legacyToCode(dealStatus || "") || "");
}

export interface AmlDeadline {
  // "before the property is marketed", in the policy's words.
  words: string;
  // The transaction is already past that point.
  passed: boolean;
}

/** When the party's checks must be complete (Issue 4), and whether the transaction has passed that point. */
export function amlDeadline(role: string, dealStatus: string | null, clientRole?: string | null): AmlDeadline {
  const code = legacyToCode(dealStatus || "") || "";
  if (lettingOrSellingClient(role, clientRole)) return { words: "before the property is marketed", passed: MARKETED.has(code) };
  if (role === "tenant") return { words: "before any agreement is signed (identity) and before the lease completes (the rest)", passed: EXCHANGED.has(code) };
  if (role === "landlord") return { words: "before the lease completes", passed: EXCHANGED.has(code) };
  return { words: "before exchange of contracts", passed: EXCHANGED.has(code) };
}

/** Past its deadline and not decided: the party is late. */
export function amlLate(stage: AmlStage, deadline: AmlDeadline): boolean {
  return deadline.passed && !["approved", "expiring", "not_required", "rejected"].includes(stage);
}

/** The deal has completed or been invoiced. */
export function amlDealClosed(dealStatus: string | null): boolean {
  const code = legacyToCode(dealStatus || "") || "";
  return code === "COM" || code === "INV";
}

export function amlBucket(stage: AmlStage, due: boolean, closed = false): AmlBucket {
  if (stage === "approved" || stage === "rejected" || stage === "not_required") return "done";
  // On a closed deal a party approved at the time stays Done, however long
  // ago; one never decided is a gap of its own.
  if (closed) return stage === "expiring" || stage === "expired" ? "done" : "closed";
  if (stage === "expiring" || stage === "expired") return "expiring";
  if (stage === "client_sent" || stage === "client_finished" || stage === "joint_asked" || stage === "joint_in" || stage === "relied" || stage === "with_kyc4u") return "in_progress";
  return due ? "todo" : "not_due";
}

/** Who or what the party waits on, in a few words. The officers do enhanced checks (KYC4U is no longer used). */
export function amlWaitingOn(stage: AmlStage, redFlags: number): string {
  const flagged = "Officers: sign off";
  switch (stage) {
    case "not_started": return "BGP: start the checks";
    case "bgp_checked": return redFlags ? "BGP: send the client checks" : "BGP: send the client checks or sign off";
    case "client_sent": return "The client";
    case "joint_asked": return "The joint agent";
    // Issue 4: their documents in, BGP checks and signs the party off (no Not required for a joint agent).
    case "joint_in": return redFlags ? flagged : "BGP: sign off";
    case "client_finished":
    case "relied": return redFlags ? flagged : "BGP: sign off";
    case "with_kyc4u": return "Officers: sign off";
    case "approved": return "Nobody";
    case "not_required": return "Nobody";
    case "rejected": return "The Nominated Officer";
    case "expiring":
    case "expired": return "BGP: check it again";
  }
}

/** Whole days since the latest of the given moments, or null when there is none. */
export function daysSince(moments: Array<string | Date | null | undefined>, now: Date = new Date()): number | null {
  const times = moments.map(time).filter((t): t is number => t !== null);
  if (!times.length) return null;
  return Math.max(0, Math.floor((now.getTime() - Math.max(...times)) / 86400000));
}

export interface AmlDashboardRow {
  key: string;                         // dealId:role
  dealId: string;
  dealName: string;
  dealRef: number | null;
  dealStatus: string | null;
  dealType: string | null;             // so a letting's AVA reads Marketing
  propertyName: string | null;
  role: string;
  brandId: string;
  brandName: string;
  signsAs: string | null;              // the company that signs, when the deal names one
  // Recorded as a trust: checked by the officers, never KYC4U (23 November 2026).
  trust?: boolean;
  // A letting under £10,000 a month: sanctions checks only, and only possible sanctions matches listed (23 November 2026).
  sanctionsOnly?: boolean;
  // Corporate owners registered abroad ("Kirkbi A/S, Denmark"): the officers find the people behind them.
  ownersAbroad?: string[];
  // The level of due diligence BGP's AML policy gives the party (Issue 2),
  // and why: the flags and higher-risk factors that count, or the basis.
  level: "simplified" | "standard" | "enhanced";
  levelWhy: string[];
  stage: AmlStage;
  bucket: AmlBucket;
  due: boolean;
  // When the checks must be complete (Issue 4), and whether the transaction
  // is past that point with the party not decided.
  deadline: string;
  late: boolean;
  redFlags: string[];                  // the labels, the deal card's rule
  // Each flag with its detail and source, for the board's pop-up (Woody, 23 November 2026:
  // "lets not show the actual problem in the table just 2 flags but click and it shows the explanations").
  flagDetails?: Array<{ label: string; detail: string | null; source: string | null }>;
  waitingOn: string;
  movedDays: number | null;
  approvedBy: string | null;
  expiresAt: string | null;
  agents: string[];
  mine: boolean;
}

/** The pills' counts, from the rows shown. */
export function bucketCounts(rows: Pick<AmlDashboardRow, "bucket">[]): Record<AmlBucket, number> {
  const out: Record<AmlBucket, number> = { todo: 0, in_progress: 0, done: 0, expiring: 0, not_due: 0, closed: 0 };
  for (const r of rows) out[r.bucket]++;
  return out;
}

/** Search on the party, its company, the deal, the property and the agents. */
export function rowMatches(row: AmlDashboardRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.brandName, row.signsAs, row.dealName, row.propertyName, row.dealRef != null ? `#${row.dealRef}` : null, amlDealStatusWords(row).words, ...row.agents]
    .some(v => (v || "").toLowerCase().includes(q));
}

/** The transaction's own status in the Transactions board's words (Woody,
 *  23 November 2026: "on this page can we have the deal status i.e
 *  reporting, marketing, solicitors, completed etc"): a letting's AVA reads
 *  Marketing, an investment's Available. */
export function amlDealStatusWords(row: Pick<AmlDashboardRow, "dealStatus" | "dealType">): { code: DealStatusCode | null; words: string | null } {
  return { code: legacyToCode(row.dealStatus || ""), words: dealStatusLabel(row.dealStatus, row.dealType) };
}
