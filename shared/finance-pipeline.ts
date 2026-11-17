// One pipeline rule for every Finance figure (Woody, 2026-11-17: "Neg & HOTs
// 50%, SOL+ 100%"). A deal with a fee counts in the forward book at its
// stage's weight:
//   Negotiating, HOTs                         50%
//   Solicitors, Exchanged                     100%
//   Completed, not yet invoiced in Xero       100%
// A deal with a Xero invoice raised against it, at any stage, is Xero
// income, never the forward book, so nothing is counted twice. Marketing and
// earlier stages are not in the book, a withdrawn or archived deal never is,
// and an investment deal counts only from Solicitors (isProvisionalFee). The Finance outlook and cash flow, the
// dashboard and phone tiles, forward commission and the Fees & pipeline pill
// all read this file: never write a weight anywhere else.
import { legacyToCode, isProvisionalFee } from "./deal-status";

export const PIPELINE_WEIGHTS = { NEG: 0.5, HOT: 0.5, SOL: 1, EXC: 1, COM: 1 } as const;
export type PipelineStage = keyof typeof PIPELINE_WEIGHTS;
export const PIPELINE_STAGES: readonly PipelineStage[] = ["NEG", "HOT", "SOL", "EXC", "COM"];
export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  NEG: "Negotiating",
  HOT: "HOTs",
  SOL: "At solicitors",
  EXC: "Exchanged",
  COM: "Completed, to invoice",
};
// The stages whose fee is not yet due for commission: Exchanged, Completed
// and Invoiced deals are in the commission statements already.
export const FORWARD_COMMISSION_STAGES: readonly PipelineStage[] = ["NEG", "HOT", "SOL"];

export interface PipelineDeal {
  status: string | null | undefined;
  fee: number | string | null | undefined;
  dealType?: string | null;
  team?: string[] | string | null;
  // Xero invoices raised against the deal (not counting failed ones).
  invoiceCount?: number | null;
}

// The stage a deal counts at in the forward book, or null when it does not
// count: no fee, a stage outside the book, a provisional investment fee, or
// a Xero invoice already raised against it (its fee is in Xero's income).
export function pipelineStage(deal: PipelineDeal): PipelineStage | null {
  const fee = Number(deal.fee);
  if (!Number.isFinite(fee) || fee <= 0) return null;
  const code = legacyToCode(deal.status);
  if (!code || !(PIPELINE_STAGES as readonly string[]).includes(code)) return null;
  if (isProvisionalFee(deal.status, { dealType: deal.dealType, team: deal.team })) return null;
  if (Number(deal.invoiceCount) > 0) return null;
  return code as PipelineStage;
}

export function pipelineWeighted(fee: number, stage: PipelineStage): number {
  return fee * PIPELINE_WEIGHTS[stage];
}

export function pipelineWeightPct(stage: PipelineStage): number {
  return Math.round(PIPELINE_WEIGHTS[stage] * 100);
}

// "NEG 50% · HOTs 50% · SOL 100% · EXC 100% · to invoice 100%" — the rule in
// words, for a footnote.
export const PIPELINE_RULE_TEXT = "Negotiating and HOTs at 50%; Solicitors, Exchanged and Completed (not yet invoiced) at 100%";

// A deal on several teams counts once: its fee is shared equally between
// them, so the team figures add up to the book.
export function teamShares(team: string[] | string | null | undefined): Array<{ team: string; share: number }> {
  const teams = [...new Set((Array.isArray(team) ? team : team ? [team] : []).map(t => String(t || "").trim()).filter(Boolean))];
  if (teams.length === 0) return [{ team: "No team", share: 1 }];
  return teams.map(t => ({ team: t, share: 1 / teams.length }));
}

// BGP's financial year runs 1 May to 30 April. The start of the year a date
// falls in.
export function financialYearStart(d: Date = new Date()): Date {
  const y = d.getUTCMonth() >= 4 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return new Date(Date.UTC(y, 4, 1));
}
