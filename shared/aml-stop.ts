// BGP stops acting on a deal for AML reasons (Woody, 21 November 2026: "What
// if it moves to solicitors anyway? We can't actually control that", then
// "Yes go ahead" to a Stop acting (AML) button).
//
// MLR 2017 reg 31: where BGP cannot apply customer due diligence, it must not
// carry out the transaction or establish a business relationship, must end any
// relationship it has, and must consider whether a report to the National
// Crime Agency is needed. BGP cannot stop the parties exchanging through their
// solicitors; it can stop its own part. While a deal is stopped it does not
// move on in BGP's records (only to Withdrawn), BGP raises no invoice on it,
// it cannot be deleted (its AML file is kept, reg 40), and the deal's agents
// are told, without the reason.
//
// It is the officers' own decision on a deal, never set by a report or a
// consent request: it is not the hold while the NCA decides that Woody
// declined on 20 November 2026 ("no dont hold a deal").
//
// Pure: the routes and the guards are server/aml-stop.ts.

export const AML_STOP_REASONS = {
  checks_incomplete: "The checks cannot be completed (MLR 2017 reg 31)",
  other: "Another AML reason",
} as const;
export type AmlStopReason = keyof typeof AML_STOP_REASONS;

export const AML_STOP_NOTE_MIN = 10;

/** What a status move, an invoice or a delete is told while the deal is stopped. Neutral: a client login may read it. */
export const AML_STOP_REFUSAL = "This deal is on hold by BGP's compliance team: it cannot move on, be invoiced or be deleted until they release it.";

export interface AmlStopView {
  at: string;
  by: string;
  // For the Nominated Officer and the Deputies only.
  reason?: AmlStopReason;
  reasonWords?: string;
  note?: string;
  prevStatus?: string | null;
  withdrew?: boolean;
}

export function amlStopInput(raw: Record<string, unknown>): { ok: true; value: { reason: AmlStopReason; note: string; withdraw: boolean } } | { ok: false; message: string } {
  const reason = String(raw.reason ?? "") as AmlStopReason;
  if (!(reason in AML_STOP_REASONS)) return { ok: false, message: "Say why BGP is stopping." };
  const note = String(raw.note ?? "").replace(/\s+/g, " ").trim().slice(0, 1500);
  if (note.length < AML_STOP_NOTE_MIN) return { ok: false, message: "Say what has happened (at least a sentence). Only the Nominated Officer and the Deputies read it." };
  return { ok: true, value: { reason, note, withdraw: raw.withdraw === true || raw.withdraw === "true" } };
}

/**
 * Whether a stopped deal may move from one status to another. Withdrawn is
 * always allowed (ending BGP's part is what stopping is for), and so is
 * staying where it is.
 */
export function amlStopAllowsMove(currentCode: string | null, targetCode: string | null): boolean {
  if (!targetCode || targetCode === currentCode) return true;
  return targetCode === "WIT";
}
