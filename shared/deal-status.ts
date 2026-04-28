// Canonical deal-status codes used across Letting Tracker, Investment Tracker,
// WIP Schedule, and the Deal page. `crm_deals.status` is the source of truth.

export const DEAL_STATUS_CODES = [
  "REP",  // Reporting
  "SPEC", // Speculative
  "LIVE", // Live
  "AVA",  // Available
  "NEG",  // Negotiating
  "SOL",  // Solicitors (replaces "Under Offer")
  "EXC",  // Exchanged
  "COM",  // Completed (also covers "Let" on the letting tracker)
  "WIT",  // Withdrawn (also covers Lost/Dead)
  "INV",  // Invoiced — system-set when a Xero invoice syncs
] as const;

export type DealStatusCode = typeof DEAL_STATUS_CODES[number];

export const DEAL_STATUS_LABELS: Record<DealStatusCode, string> = {
  REP: "Reporting",
  SPEC: "Speculative",
  LIVE: "Live",
  AVA: "Available",
  NEG: "Negotiating",
  SOL: "Solicitors",
  EXC: "Exchanged",
  COM: "Completed",
  WIT: "Withdrawn",
  INV: "Invoiced",
};

// Tailwind colour classes per status — used by chips/dots across the app
export const DEAL_STATUS_COLORS: Record<DealStatusCode, string> = {
  REP: "bg-slate-100 text-slate-700",
  SPEC: "bg-zinc-100 text-zinc-700",
  LIVE: "bg-blue-100 text-blue-800",
  AVA: "bg-sky-100 text-sky-800",
  NEG: "bg-amber-100 text-amber-800",
  SOL: "bg-orange-100 text-orange-800",
  EXC: "bg-violet-100 text-violet-800",
  COM: "bg-emerald-100 text-emerald-800",
  WIT: "bg-stone-100 text-stone-600",
  INV: "bg-green-100 text-green-800",
};

// Per-tracker subsets — which codes each view's dropdown should offer
export const LETTING_STATUSES: DealStatusCode[]    = ["REP", "AVA", "NEG", "SOL", "EXC", "COM", "WIT", "INV"];
export const INVESTMENT_STATUSES: DealStatusCode[] = ["REP", "SPEC", "LIVE", "AVA", "NEG", "SOL", "EXC", "COM", "WIT", "INV"];
export const WIP_STATUSES: DealStatusCode[]        = ["NEG", "SOL", "EXC", "COM", "INV"];
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
  "negotiation": "NEG",
  "neg": "NEG",
  "hots": "NEG",
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
  "reporting": "REP",
  "rep": "REP",
  "targeting": "REP",
  "speculative": "SPEC",
  "spec": "SPEC",
  "live": "LIVE",
  "available": "AVA",
  "ava": "AVA",
  "marketing": "AVA",
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
