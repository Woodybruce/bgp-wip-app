// Canonical deal-status codes used across Letting Tracker, Investment Tracker,
// WIP Schedule, and the Deal page. `crm_deals.status` is the source of truth.

export const DEAL_STATUS_CODES = [
  "OPP",  // Opportunity — earliest pipeline stage, pre-reporting
  "REP",  // Reporting
  "SPEC", // Speculative
  "LIVE", // Live
  "AVA",  // Available
  "NEG",  // Negotiating
  "HOT",  // HOTs — heads of terms agreed, pre-solicitors (Alex, 2026-08-12)
  "SOL",  // Solicitors (replaces "Under Offer")
  "UOX",  // Under Offer - Not BGP — someone else's deal under offer, kept on the
          // Investment Tracker to keep tabs (Jack, 2026-11-16). No fee, no questions.
  "EXC",  // Exchanged
  "COM",  // Completed (also covers "Let" on the letting tracker)
  "WIT",  // Withdrawn (also covers Lost/Dead)
  "INV",  // Invoiced — system-set when a Xero invoice syncs
  "ARCH", // Archived — system-set by the WIP import's soft-archive (crm.ts);
          // folds under Historic like WIT, never a kanban column or a picker option
] as const;

export type DealStatusCode = typeof DEAL_STATUS_CODES[number];

export const DEAL_STATUS_LABELS: Record<DealStatusCode, string> = {
  OPP: "Opportunity",
  REP: "Reporting",
  SPEC: "Speculative",
  LIVE: "Live",
  AVA: "Available",
  NEG: "Negotiating",
  HOT: "HOTs",
  SOL: "Solicitors",
  UOX: "U/O - Not BGP",
  EXC: "Exchanged",
  COM: "Completed",
  WIT: "Withdrawn",
  INV: "Invoiced",
  ARCH: "Archived",
};

// Tailwind colour classes per status — used by chips/dots across the app
export const DEAL_STATUS_COLORS: Record<DealStatusCode, string> = {
  OPP: "bg-teal-100 text-teal-800",
  REP: "bg-slate-100 text-slate-700",
  SPEC: "bg-zinc-100 text-zinc-700",
  LIVE: "bg-blue-100 text-blue-800",
  AVA: "bg-sky-100 text-sky-800",
  NEG: "bg-amber-100 text-amber-800",
  HOT: "bg-rose-100 text-rose-800",
  SOL: "bg-orange-100 text-orange-800",
  UOX: "bg-yellow-100 text-yellow-800",
  EXC: "bg-violet-100 text-violet-800",
  COM: "bg-emerald-100 text-emerald-800",
  WIT: "bg-stone-100 text-stone-600",
  INV: "bg-green-100 text-green-800",
  ARCH: "bg-stone-100 text-stone-600",
};

// Solid dot swatches per status — same hue family as the chip map above so a
// status reads as one colour whether it's a soft chip or a tiny dot.
export const DEAL_STATUS_DOT_COLORS: Record<DealStatusCode, string> = {
  OPP: "bg-teal-500",
  REP: "bg-slate-400",
  SPEC: "bg-zinc-400",
  LIVE: "bg-blue-500",
  AVA: "bg-sky-500",
  NEG: "bg-amber-500",
  HOT: "bg-rose-500",
  SOL: "bg-orange-600",
  UOX: "bg-yellow-500",
  EXC: "bg-violet-500",
  COM: "bg-emerald-500",
  WIT: "bg-stone-400",
  INV: "bg-green-600",
  ARCH: "bg-stone-400",
};

// Per-tracker subsets — the codes each tracker shows (its status headings,
// pills, counts and order). The Investment Tracker also offers every one of
// them as a choice; the Letting Tracker offers LETTING_PICK_STATUSES (below).
// REP dropped from the letting tracker headings (Alex, 2026-08-12: "not
// relevant") — existing REP rows still render via legacyToCode, they just
// lose their chip. HOT sits between NEG and SOL per the same request.
export const LETTING_STATUSES: DealStatusCode[]    = ["OPP", "AVA", "NEG", "HOT", "SOL", "EXC", "COM", "WIT", "INV"];
export const INVESTMENT_STATUSES: DealStatusCode[] = ["REP", "SPEC", "LIVE", "AVA", "NEG", "UOX", "SOL", "EXC", "COM", "WIT", "INV"];

// Codes offered as a choice on the Investment Tracker only, the one rule
// every other status picker reads. UOX is the Investment Tracker's own
// (Jack, 2026-11-16). WIT: a deal that falls through is deleted, not moved to
// Withdrawn (Woody, 2026-11-20: "only chase live deals actually delete the
// Withdrawn option generally delete is good enough"); deleting a Letting
// Tracker unit still moves its deal to Withdrawn on the server when the deal
// is at Negotiating, HOTs or Solicitors, which keeps its Ref #, fee and
// history (the unit DELETE in server/routes.ts). Woody did not answer whether
// the Investment Tracker should lose Withdrawn too, so it keeps it. A deal
// that carries either code still shows its label, colour, filters and
// counts, and the server still accepts both on a save.
export const INVESTMENT_ONLY_PICKS: DealStatusCode[] = ["UOX", "WIT"];
const pickedOffInvestment = (c: DealStatusCode) => !INVESTMENT_ONLY_PICKS.includes(c);
// What a person may pick on the Letting Tracker (the bulk Change Status menu)
// and on the joint agent's tracker: its headings less Withdrawn.
export const LETTING_PICK_STATUSES: DealStatusCode[] = LETTING_STATUSES.filter(pickedOffInvestment);
// WIP report covers every fee-bearing stage including pre-deal pipeline.
// AVA + NEG live on the Letting Tracker AND the Deals board (Woody,
// 2026-10-26: a Marketing deal sits on the WIP and the Deals board from
// birth so its fee gets added); SOL+ carry on through the Deals board. REP dropped from WIP (Woody, 2026-08-31: "delete
// reporting" — matching Alex's 2026-08-12 letting-tracker call); REP
// deals stay on the Investment tracker and deal pages, they just don't
// count as WIP.
export const WIP_STATUSES: DealStatusCode[]        = ["AVA", "NEG", "HOT", "SOL", "EXC", "COM", "INV"];
// Every code a person may pick on a deal (the deal form, the Deals table's
// status cell, the WIP report) — ARCH is system-set (see above) and never
// offered. UOX and WIT are picked on the Investment Tracker only
// (INVESTMENT_ONLY_PICKS), so the Deals and WIP pickers (lettings, Landsec)
// never offer them; a deal that carries one still shows its label.
export const DEAL_PAGE_STATUSES: DealStatusCode[]  = DEAL_STATUS_CODES.filter((c) => c !== "ARCH" && pickedOffInvestment(c));

// INV is set automatically when a Xero invoice syncs onto the deal, ARCH by
// the WIP import's soft-archive — UI should render them but disable manual
// selection.
export const SYSTEM_SET_STATUSES: DealStatusCode[] = ["INV", "ARCH"];

// Maps legacy free-text status strings to canonical codes. Used at every read
// site as a safety net while old data still exists, and by the one-shot
// migration that normalises crm_deals.status.
const LEGACY_MAP: Record<string, DealStatusCode> = {
  // post-NEG lifecycle
  "under negotiation": "NEG",
  "in negotiation": "NEG",        // leasing-schedule unit status, leaks into deals
  "negotiation": "NEG",
  "negotiating": "NEG",           // the display label itself
  "neg": "NEG",
  "hots": "HOT",
  "heads of terms": "HOT",
  "under offer": "SOL",
  "under offer - not bgp": "UOX",
  "under offer (not bgp)": "UOX",
  "u/o - not bgp": "UOX",
  "uox": "UOX",
  "sols": "SOL",
  "sol": "SOL",
  "solicitors": "SOL",
  "exchanged": "EXC",
  "exc": "EXC",
  "completed": "COM",
  "complete": "COM",
  "com": "COM",
  "let": "COM",
  "invoiced": "INV",
  "billed": "INV",
  "inv": "INV",
  // marketing lifecycle
  "opportunity": "OPP",
  "opp": "OPP",
  "reporting": "REP",
  "rep": "REP",
  "targeting": "REP",
  "speculative": "SPEC",
  "spec": "SPEC",
  "live": "LIVE",
  "available": "AVA",
  "ava": "AVA",
  "marketing": "AVA",
  "vacant": "AVA",                // tenancy-schedule occupancy word, leaks into tracker rows
  "occupied": "COM",              // leasing-schedule unit status — occupied unit = completed deal
  // archived
  "withdrawn": "WIT",
  "wit": "WIT",
  "lost": "WIT",
  "dead": "WIT",
  "arch": "ARCH",
  "archived": "ARCH",
};

export function legacyToCode(raw: string | null | undefined): DealStatusCode | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // Already canonical?
  if ((DEAL_STATUS_CODES as readonly string[]).includes(trimmed.toUpperCase())) {
    return trimmed.toUpperCase() as DealStatusCode;
  }
  return LEGACY_MAP[trimmed.toLowerCase()] ?? null;
}

// Status groups used by server-side SQL exclusion lists.
// Use these instead of maintaining divergent hardcoded strings in each file.
// All SQL queries should compare against canonical codes (post-migration).
export const CLOSED_STATUSES: DealStatusCode[]   = ["WIT", "COM", "INV", "ARCH"]; // fully closed — dead, completed, invoiced, archived
export const TERMINAL_STATUSES: DealStatusCode[] = ["WIT", "ARCH"];               // dead/withdrawn/archived only (keep COM/INV in view)

// Every stored spelling that reads as one of `codes`, lower-cased: the codes
// themselves plus their legacy labels, in a fixed order. For SQL IN-lists
// compared against lower(trim(coalesce(col, ''))) — see shared/letting-rules.ts.
export function statusSpellingsFor(codes: readonly DealStatusCode[]): string[] {
  const out = codes.map((c) => c.toLowerCase());
  for (const [label, code] of Object.entries(LEGACY_MAP)) {
    if (codes.includes(code) && !out.includes(label)) out.push(label);
  }
  return out;
}

// Statuses that should be excluded from active deal views (legacy, comps).
// `crm_deals.status` rows that match these are not in the 10-code set and
// represent records that belong in the comps schedules, not in WIP.
export const EXCLUDED_LEGACY_STATUSES = ["leasing comps", "investment comps"];

export function isExcludedLegacyStatus(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return EXCLUDED_LEGACY_STATUSES.includes(String(raw).trim().toLowerCase());
}

// Investment fee eligibility (2026-11-09, Investment deals only — lettings
// keep their own rules, incl. Woody's 2026-10-26 "Marketing deals are the
// leasing fee forecast"). An INVESTMENT deal's BGP fee counts toward
// dashboard Total Fees, the cash-flow projection, the Xero pipeline
// forecast, forward commission and WIP totals only once someone has
// explicitly moved it to Solicitors (SOL) or beyond. Before that (Reporting,
// Speculative, Live, Available, Negotiating, HOTs, Opportunity) the fee, %
// and agent splits are recorded but provisional and count £0, splits or not.
// Entering a fee, split or date never changes the status, so moving a deal
// back to Live drops it out of the totals with fee and splits kept.
// SOL/EXC = forecast income; COM/INV keep their completed/invoiced treatment.
export const FEE_COUNTED_STATUSES: DealStatusCode[] = ["SOL", "EXC", "COM", "INV"];
export const INVESTMENT_PROVISIONAL_STATUSES: DealStatusCode[] =
  DEAL_STATUS_CODES.filter((c) => !FEE_COUNTED_STATUSES.includes(c) && !TERMINAL_STATUSES.includes(c));

// Same definition as server/deal-report.ts: deal type Purchase / Sale /
// Investment, or the Investment team on the deal.
const INVESTMENT_DEAL_TYPES = ["Purchase", "Sale", "Investment"];
export function isInvestmentDeal(dealType: string | null | undefined, team: string[] | string | null | undefined): boolean {
  if (dealType && INVESTMENT_DEAL_TYPES.includes(dealType)) return true;
  const teams = Array.isArray(team) ? team : team ? [team] : [];
  return teams.includes("Investment");
}
// SQL twin of isInvestmentDeal for a crm_deals alias (e.g. "d" or "crm_deals").
export function investmentDealSql(alias: string): string {
  return `(${alias}.deal_type IN ('Purchase','Sale','Investment') OR 'Investment' = ANY(COALESCE(${alias}.team, ARRAY[]::text[])))`;
}

// Which deals leave the trackers for the rest of the app (the Deals board,
// the Deal Report, a property's or company's deals). A letting shows from
// Marketing onwards (Woody, 2026-10-26); an INVESTMENT deal stays on the
// Investment Tracker until it reaches Solicitors (Jack, 2026-11-16: "It
// should only move to other parts of the app once in solicitors"). NULL or
// unknown statuses stay visible rather than silently vanishing. SQL for a
// crm_deals alias; true = show it.
const PRE_MARKETING: DealStatusCode[] = ["OPP", "REP", "SPEC", "LIVE"];
const sqlList = (codes: DealStatusCode[]) => statusSpellingsFor(codes).map((s) => `'${s.replace(/'/g, "''")}'`).join(", ");
export function dealLeftTrackerSql(alias: string): string {
  const st = `lower(trim(coalesce(${alias}.status, '')))`;
  return `(${alias}.status IS NULL OR (${st} NOT IN (${sqlList(PRE_MARKETING)})`
    + ` AND NOT (${investmentDealSql(alias)} AND ${st} IN (${sqlList(INVESTMENT_PROVISIONAL_STATUSES)}))))`;
}
export function dealLeftTracker(deal: { status?: string | null; dealType?: string | null; team?: string[] | string | null }): boolean {
  if (deal.status == null) return true;
  const code = legacyToCode(deal.status);
  if (!code) return true;
  if (PRE_MARKETING.includes(code)) return false;
  return !(isInvestmentDeal(deal.dealType, deal.team) && INVESTMENT_PROVISIONAL_STATUSES.includes(code));
}

// Pre-Solicitors investment fee — shown on the record, marked provisional,
// never totalled. Always false for lettings and other non-investment deals.
export function isProvisionalFee(
  raw: string | null | undefined,
  deal: { dealType?: string | null; team?: string[] | string | null },
): boolean {
  const code = legacyToCode(raw);
  return !!code && INVESTMENT_PROVISIONAL_STATUSES.includes(code) && isInvestmentDeal(deal.dealType, deal.team);
}

// True if the status counts as "invoiced" — used by WIP totals and reports.
export function isInvoicedStatus(raw: string | null | undefined): boolean {
  return legacyToCode(raw) === "INV";
}

// Lifecycle stage bucket — pipeline (pre-NEG), wip (NEG–COM), invoiced (INV).
export function deriveStageFromStatus(raw: string | null | undefined): "pipeline" | "wip" | "invoiced" {
  const code = legacyToCode(raw);
  if (!code) return "pipeline";
  if (code === "INV") return "invoiced";
  if (WIP_STATUSES.includes(code)) return "wip";
  return "pipeline";
}
