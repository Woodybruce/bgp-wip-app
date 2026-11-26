// Heads of terms before HOTs or Solicitors (Jack, 26 November 2026). The one
// rule for which change of status needs them, shared by the server's refusal
// (server/deal-hots-gate.ts) and the screens that ask for the file first.
import { legacyToCode } from "./deal-status";

/** Stages at or past Solicitors: a move back from them is never held. */
const PAST = new Set(["SOL", "EXC", "COM", "INV"]);
/** Advisory work has no heads of terms (rent reviews, dilapidations, service charge). */
const ADVISORY = /^(rent review|dilapidations|service charge)$/i;

/** Does this change of status need the heads of terms? The stage it moves to, or null. */
export function hotsGateApplies(fromRaw: string | null | undefined, toRaw: string | null | undefined, dealType?: string | null): "HOT" | "SOL" | null {
  const to = legacyToCode(String(toRaw ?? ""));
  const from = legacyToCode(String(fromRaw ?? ""));
  if (to !== "HOT" && to !== "SOL") return null;
  if (to === from || (from && PAST.has(from))) return null;
  if (ADVISORY.test(String(dealType || "").trim())) return null;
  return to;
}
