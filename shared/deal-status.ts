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
  "EXC",  // Exchanged
  "COM",  // Completed (also covers "Let" on the letting tracker)
  "WIT",  // Withdrawn (also covers Lost/Dead)
  "INV",  // Invoiced — system-set when a Xero invoice syncs
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
  EXC: "Exchanged",
  COM: "Completed",
  WIT: "Withdrawn",
  INV: "Invoiced",
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
  EXC: "bg-violet-100 text-violet-800",
  COM: "bg-emerald-100 text-emerald-800",
  WIT: "bg-stone-100 text-stone-600",
  INV: "bg-green-100 text-green-800",
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
  EXC: "bg-violet-500",
  COM: "bg-emerald-500",
  WIT: "bg-stone-400",
  INV: "bg-green-600",
};

// Per-tracker subsets — which codes each view's dropdown should offer
// REP dropped from the letting tracker headings (Alex, 2026-08-12: "not
// relevant") — existing REP rows still render via legacyToCode, they just
// lose their chip. HOT sits between NEG and SOL per the same request.
export const LETTING_STATUSES: DealStatusCode[]    = ["OPP", "AVA", "NEG", "HOT", "SOL", "EXC", "COM", "WIT", "INV"];
export const INVESTMENT_STATUSES: DealStatusCode[] = ["REP", "SPEC", "LIVE", "AVA", "NEG", "SOL", "EXC", "COM", "WIT", "INV"];
// WIP report covers every fee-bearing stage including pre-deal pipeline.
// REP + AVA + NEG live on the Letting Tracker side; SOL+ live on the
// Deals Board. Both feed the WIP report (visual reflection of both
// boards per the post-Sage model).
export const WIP_STATUSES: DealStatusCode[]        = ["REP", "AVA", "NEG", "HOT", "SOL", "EXC", "COM", "INV"];
export const DEAL_PAGE_STATUSES: DealStatusCode[]  = [...DEAL_STATUS_CODES];

// INV is set automatically when a Xero invoice syncs onto the deal — UI should
// render it but disable manual selection.
export const SYSTEM_SET_STATUSES: DealStatusCode[] = ["INV"];

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
  "occupied": "COM",              // leasing-schedule unit status — occupied unit = completed deal
  // archived
  "withdrawn": "WIT",
  "wit": "WIT",
  "lost": "WIT",
  "dead": "WIT",
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
export const CLOSED_STATUSES: DealStatusCode[]   = ["WIT", "COM", "INV"]; // fully closed — dead, completed, invoiced
export const TERMINAL_STATUSES: DealStatusCode[] = ["WIT"];               // dead/withdrawn only (keep COM/INV in view)

// Statuses that should be excluded from active deal views (legacy, comps).
// `crm_deals.status` rows that match these are not in the 10-code set and
// represent records that belong in the comps schedules, not in WIP.
export const EXCLUDED_LEGACY_STATUSES = ["leasing comps", "investment comps"];

export function isExcludedLegacyStatus(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return EXCLUDED_LEGACY_STATUSES.includes(String(raw).trim().toLowerCase());
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
