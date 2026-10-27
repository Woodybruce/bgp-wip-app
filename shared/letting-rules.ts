// The one lettings vocabulary: which deal types are lettings, which status
// codes are live on the Letting Tracker, which are historic, which count as
// WIP, and which side BGP acts for. Every screen, ChatBGP tool and SQL
// WHERE clause imports from here instead of hand-typing a list (CLAUDE.md
// "Lettings: units, deals and the Letting Tracker", decided 2026-10-26;
// docs/letting-cleanup-thoughts.md and Phase 1 of the technical appendix).
// Imported by the client and the server alike — no node imports here.
import { legacyToCode, statusSpellingsFor, WIP_STATUSES, type DealStatusCode } from "./deal-status";

// ── Deal types ───────────────────────────────────────────────────────────
// Letting deals: the five types that live on the Letting Tracker. The
// tracker filters by TYPE, not side — Lease Disposal and Sub-Letting are
// tenant-side instructions and still sit on it.
export const LETTING_DEAL_TYPES = ["New Letting", "Lease Disposal", "Temp Lease", "Licence", "Sub-Letting"] as const;
// Labels old rows still carry; read as lettings until normalised, never
// offered as a choice.
export const LEGACY_LETTING_TYPES = ["Letting", "Leasing"] as const;
// Everything that reads as a letting today (current + legacy).
export const ALL_LETTING_TYPES: readonly string[] = [...LETTING_DEAL_TYPES, ...LEGACY_LETTING_TYPES];
// What a backing deal is typed when nothing says otherwise (Add Unit, the
// SOL flip, a client-added unit) and what a legacy label normalises to.
export const DEFAULT_LETTING_TYPE: string = "New Letting" satisfies (typeof LETTING_DEAL_TYPES)[number];
// Tenant-rep acquisitions: never on the tracker.
export const TENANT_REP_TYPES = ["Lease Acquisition", "Tenant Acquisition"] as const;
// Unit-level advisory work: never on the tracker, never refused by a
// letting rule (a live Rent Review beside a live letting is normal).
export const ADVISORY_UNIT_TYPES = ["Lease Renewal", "Rent Review", "Regear", "Dilapidations", "Service Charge"] as const;
// Types where BGP acts for the tenant — what actingForFromType derives.
export const TENANT_SIDE_TYPES = ["Lease Disposal", "Sub-Letting", "Lease Acquisition", "Tenant Acquisition"] as const;

// ── Status codes (the code set itself is shared/deal-status.ts) ──────────
// Live on the tracker: Opportunity (the pre-marketing row), Marketing
// (AVA), Negotiating, HOTs, Solicitors ("Under Offer" on the website).
export const TRACKER_LIVE_STATUSES: DealStatusCode[] = ["OPP", "AVA", "NEG", "HOT", "SOL"];
// Folded under the tracker's Historic pill; closed for the
// one-live-letting-per-unit rule. ARCH is the WIP import's soft-archive.
export const HISTORIC_STATUSES: DealStatusCode[] = ["EXC", "COM", "WIT", "INV", "ARCH"];
// The investment pipeline before marketing — on the trackers, not the
// Deals board.
export const PRE_MARKETING_STATUSES: DealStatusCode[] = ["OPP", "REP", "SPEC", "LIVE"];
// WIP_STATUSES (AVA with or without a fee, through to INV) stays in
// shared/deal-status.ts; isWipDeal reads it from there.

// A deal as the client (camelCase, CrmDeal) or a server row (snake_case)
// carries it — both spellings are read.
export type DealLike = { dealType?: string | null; deal_type?: string | null; status?: string | null };
export type TrackerRowLike = { marketingStatus?: string | null; marketing_status?: string | null };

const trim = (s: string | null | undefined) => String(s ?? "").trim();
const has = (list: readonly string[], v: string | null | undefined) => list.includes(trim(v));

/** A letting type, current or legacy (exact label after trimming). A NULL
 *  type is not a letting here — a caller that defaults a blank type to
 *  New Letting does that itself. */
export const isLettingType = (dealType: string | null | undefined) => has(ALL_LETTING_TYPES, dealType);
export const isLettingDeal = (deal: DealLike) => isLettingType(deal.dealType ?? deal.deal_type);

/** Status (code or legacy label) that is live on the Letting Tracker. */
export function isTrackerLiveStatus(raw: string | null | undefined): boolean {
  const code = legacyToCode(raw);
  return !!code && TRACKER_LIVE_STATUSES.includes(code);
}

/** Status (code or legacy label, incl. "archived") that folds under Historic. */
export function isHistoricStatus(raw: string | null | undefined): boolean {
  const code = legacyToCode(raw);
  return !!code && HISTORIC_STATUSES.includes(code);
}

/** On the Letting Tracker: a letting type at a tracker-live status. */
export const isTrackerDeal = (deal: DealLike) => isLettingDeal(deal) && isTrackerLiveStatus(deal.status);

/** On the WIP (and the Deals board): AVA through INV, fee or no fee. */
export function isWipDeal(deal: DealLike): boolean {
  const code = legacyToCode(deal.status);
  return !!code && WIP_STATUSES.includes(code);
}

/** The side the type implies: Lease Disposal / Sub-Letting / Lease
 *  Acquisition / Tenant Acquisition are tenant-side, everything else
 *  landlord-side. DEFINED here only — not wired into any create path
 *  until Woody has reviewed the Phase 0 impact list (section g of the
 *  integrity report). */
export function actingForFromType(dealType: string | null | undefined): "landlord" | "tenant" {
  return has(TENANT_SIDE_TYPES, dealType) ? "tenant" : "landlord";
}

/** The code a tracker row shows: the linked deal's status when there is a
 *  deal and it maps, else the row's own marketing status. Same rule as
 *  effByUnit on the Letting Tracker page; callers default null to AVA
 *  where they always have. */
export function effectiveStatus(trackerRow: TrackerRowLike | null | undefined, deal: DealLike | null | undefined): DealStatusCode | null {
  const fromDeal = deal ? legacyToCode(deal.status) : null;
  if (fromDeal) return fromDeal;
  return trackerRow ? legacyToCode(trackerRow.marketingStatus ?? trackerRow.marketing_status) : null;
}

// ── SQL fragments ────────────────────────────────────────────────────────
// Quoted, comma-joined literals for the inside of IN (...), so WHERE
// clauses and the one-live-letting-per-unit index predicate come from one
// source. Deterministic order (the predicate text must not drift).
const sqlLiterals = (values: readonly string[]) => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");

/** Closed (historic) statuses, lower-cased, codes and legacy labels alike:
 *  compare `lower(trim(coalesce(col, '')))` against it. */
export const closedStatusSqlList = () => sqlLiterals(statusSpellingsFor(HISTORIC_STATUSES));

/** Letting types, current and legacy, as stored (exact case): compare the
 *  raw `deal_type` column against it. */
export const lettingTypeSqlList = () => sqlLiterals(ALL_LETTING_TYPES);
