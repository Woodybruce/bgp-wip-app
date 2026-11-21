// The AML dashboard (Woody, 18 November 2026: step 6 of
// docs/deal-page-review-2026-11-18.md, "a dashboard of all AML / KYC live and
// finished checks ... nice and easy", brought forward with "go ahead with
// your suggestions"). One row per deal party. Pure rules: where a party has
// got to, whether HMRC expects its checks yet, which pill it is on and who it
// waits on, all read from records the app already holds. The feed is
// server/aml-dashboard.ts; the page client/src/pages/aml-dashboard.tsx.

import { legacyToCode } from "./deal-status";

export type AmlStage = "not_started" | "bgp_checked" | "client_sent" | "client_finished" | "with_kyc4u" | "approved" | "rejected" | "expiring" | "expired" | "not_required";

export const AML_STAGE_LABEL: Record<AmlStage, string> = {
  not_started: "Not started",
  bgp_checked: "BGP checked",
  client_sent: "Client checks sent",
  client_finished: "Client finished",
  with_kyc4u: "With KYC4U",
  approved: "Approved",
  rejected: "Rejected",
  expiring: "Expiring",
  expired: "Expired",
  // Marked by the Nominated Officer or the Deputy (BGP's AML policy: the
  // other side of a deal a joint agent negotiated, or no deal done).
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
  if (f.kyc4uOpen || (f.kyc.status === "in_review" && f.kyc4uInReview)) return "with_kyc4u";
  if (time(f.clientFinishedAt) !== null) return "client_finished";
  if (time(f.clientSentAt) !== null) return "client_sent";
  const pre = time(f.precheckAt);
  if (pre !== null && now.getTime() - pre <= AML_PRECHECK_DAYS * 86400000) return "bgp_checked";
  return "not_started";
}

// HMRC's timing (shared/kyc-request.ts, KYC_TIMING): the landlord and the
// seller before the unit is marketed, so on any live deal; the tenant once
// the landlord accepts their offer and the buyer before an offer is
// accepted, so from Heads of Terms.
const FROM_HOTS = new Set(["HOT", "SOL", "EXC", "COM", "INV"]);
export function amlDue(role: string, dealStatus: string | null): boolean {
  if (role === "landlord" || role === "vendor") return true;
  return FROM_HOTS.has(legacyToCode(dealStatus || "") || "");
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
  if (stage === "client_sent" || stage === "client_finished" || stage === "with_kyc4u") return "in_progress";
  return due ? "todo" : "not_due";
}

/** Who or what the party waits on, in a few words. */
export function amlWaitingOn(stage: AmlStage, redFlags: number): string {
  switch (stage) {
    case "not_started": return "BGP: start the checks";
    case "bgp_checked": return redFlags ? "BGP: raise it with KYC4U" : "BGP: send the client checks or sign off";
    case "client_sent": return "The client";
    case "client_finished": return redFlags ? "BGP: raise it with KYC4U" : "BGP: sign off";
    case "with_kyc4u": return "KYC4U";
    case "approved": return "Nobody";
    case "not_required": return "Nobody";
    case "rejected": return "The Nominated Officer";
    case "expiring":
    case "expired": return "BGP: check it again";
  }
}

/**
 * An enhanced party not yet with KYC4U (Jack, 20 November 2026: KYC4U takes
 * requests only on its own portal, so "a big red mark against it" until the
 * agent has submitted it there).
 */
export function amlNeedsKyc4u(level: "simplified" | "standard" | "enhanced", stage: AmlStage, ownedAbroad = false): boolean {
  // Owned through a company registered abroad goes to KYC4U too (Woody, 21 November 2026).
  return (level === "enhanced" || ownedAbroad) && (stage === "not_started" || stage === "bgp_checked" || stage === "client_sent" || stage === "client_finished");
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
  propertyName: string | null;
  role: string;
  brandId: string;
  brandName: string;
  signsAs: string | null;              // the company that signs, when the deal names one
  // Corporate owners registered abroad ("Kirkbi A/S, Denmark"): KYC4U find the people behind them.
  ownersAbroad?: string[];
  // The level of due diligence BGP's AML policy gives the party (Issue 2),
  // and why: the flags and higher-risk factors that count, or the basis.
  level: "simplified" | "standard" | "enhanced";
  levelWhy: string[];
  stage: AmlStage;
  bucket: AmlBucket;
  due: boolean;
  redFlags: string[];                  // the labels, the deal card's rule
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
  return [row.brandName, row.signsAs, row.dealName, row.propertyName, row.dealRef != null ? `#${row.dealRef}` : null, ...row.agents]
    .some(v => (v || "").toLowerCase().includes(q));
}
