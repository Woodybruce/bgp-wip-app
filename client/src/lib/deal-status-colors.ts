// Deal-status colours — thin client wrapper over the ONE canonical map in
// shared/deal-status.ts (design review 2026-08-23: this file and the shared
// map had drifted, so "Available" was emerald on some boards and sky on
// others). Two flavours per code:
//   DOT   — solid swatch for pills/dots on dense tables
//   BADGE — soft background + readable text for status badges
// Legacy strings kept as fallbacks for rows not yet normalised to codes —
// always try legacyToCode first.
import {
  DEAL_STATUS_DOT_COLORS as SHARED_DOTS,
  DEAL_STATUS_COLORS as SHARED_BADGES,
  legacyToCode,
  type DealStatusCode,
} from "@shared/deal-status";

const LEGACY_STRINGS = [
  "Targeting", "Reporting", "Speculative", "Live", "Available", "Marketing",
  "Under Negotiation", "HOTs", "Under Offer", "SOLs", "Exchanged",
  "Completed", "Let", "Withdrawn", "Lost", "Dead", "Invoiced", "Billed",
];

function withLegacy(base: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...base };
  for (const s of LEGACY_STRINGS) {
    const code = legacyToCode(s) as DealStatusCode | null;
    if (code && base[code]) out[s] = base[code];
  }
  return out;
}

export const DEAL_STATUS_DOT_COLORS: Record<string, string> = {
  ...withLegacy(SHARED_DOTS),
  // Comps categories sit outside the 10-code set
  "Leasing Comps": "bg-cyan-600",
  "Investment Comps": "bg-violet-500",
};

export const DEAL_STATUS_BADGE_COLORS: Record<string, string> =
  withLegacy(SHARED_BADGES);
