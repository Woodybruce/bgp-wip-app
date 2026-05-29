// Bidirectional translator between the three lifecycle views of a unit:
//
//   Letting Tracker  (available_units.marketing_status)   — canonical codes
//   Deals Board      (crm_deals.status)                    — canonical codes
//   Leasing Schedule (leasing_schedule_units.status)       — Occupied / Vacant /
//                                                            Under Offer /
//                                                            In Negotiation /
//                                                            Archived
//
// The first two share the canonical code set (DealStatusCode). Only the
// Leasing Schedule has its own enum, so this module is purely a bridge
// between the canonical codes and the schedule's enum.
//
// Mapping rationale:
//   REP / SPEC / LIVE / AVA  →  Vacant         (on the market or pre-marketing)
//   NEG                       →  In Negotiation
//   SOL / EXC                 →  Under Offer    (post-Solicitors but not yet completed)
//   COM / INV                 →  Occupied       (tenant signed/in, deal done)
//   WIT                       →  Archived       (withdrawn / dead deal)
//
// Reverse mapping deliberately picks the *least progressive* code in each
// bucket so a schedule edit can never accidentally downgrade a more-advanced
// status (see codeMatchesLeasingStatus + bucket-aware updates).

import type { DealStatusCode } from "./deal-status";
import { legacyToCode } from "./deal-status";

export const LEASING_STATUSES = ["Vacant", "In Negotiation", "Under Offer", "Occupied", "Trading", "Lease Event", "Archived"] as const;
export type LeasingStatus = typeof LEASING_STATUSES[number];

const CODE_TO_LEASING: Record<DealStatusCode, LeasingStatus> = {
  REP:  "Vacant",
  SPEC: "Vacant",
  LIVE: "Vacant",
  AVA:  "Vacant",
  NEG:  "In Negotiation",
  SOL:  "Under Offer",
  EXC:  "Under Offer",
  COM:  "Occupied",
  INV:  "Occupied",
  WIT:  "Archived",
};

// The "default" code each leasing-schedule status maps back to. Picked as
// the *least* progressive code in the bucket so a downstream merge can
// promote (e.g. SOL → EXC) without being clobbered by a schedule round-trip.
const LEASING_TO_CODE: Record<LeasingStatus, DealStatusCode> = {
  "Vacant":         "AVA",
  "In Negotiation": "NEG",
  "Under Offer":    "SOL",
  "Occupied":       "COM",
  // Landsec operational states — both mean the unit is let/occupied, so
  // they map to COM (a completed letting) and, like Occupied, don't push
  // the unit onto the marketing Letting Tracker.
  "Trading":        "COM",
  "Lease Event":    "COM",
  "Archived":       "WIT",
};

export function codeToLeasingStatus(raw: string | null | undefined): LeasingStatus | null {
  const code = legacyToCode(raw);
  if (!code) return null;
  return CODE_TO_LEASING[code] || null;
}

export function leasingStatusToCode(status: string | null | undefined): DealStatusCode | null {
  if (!status) return null;
  const trimmed = String(status).trim() as LeasingStatus;
  return LEASING_TO_CODE[trimmed] || null;
}

// True if the canonical code is already in the same "leasing bucket" as the
// supplied schedule status. Used so a schedule edit to "Under Offer" doesn't
// rewrite an existing EXC deal back to SOL — they're in the same bucket.
export function codeMatchesLeasingStatus(
  code: DealStatusCode | string | null | undefined,
  schedule: LeasingStatus | string | null | undefined,
): boolean {
  if (!code || !schedule) return false;
  const target = codeToLeasingStatus(code as string);
  return target === schedule;
}
