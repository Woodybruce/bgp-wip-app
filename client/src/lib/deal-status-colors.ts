// Single source of truth for deal-status colours across the boards that
// share the canonical 10-code set (Deals schedule, Letting Tracker,
// kanban, property-page tracker summary). Two flavours per code:
//   DOT   — solid swatch for pills/dots on dense tables
//   BADGE — soft background + readable text for status badges
// Hues match per code across both flavours so the same status reads as
// the same colour on every board. Legacy strings kept as fallbacks for
// rows not yet normalised to codes — always try legacyToCode first.

export const DEAL_STATUS_DOT_COLORS: Record<string, string> = {
  OPP: "bg-teal-500",
  REP: "bg-slate-500",
  SPEC: "bg-violet-500",
  LIVE: "bg-blue-500",
  AVA: "bg-emerald-500",
  NEG: "bg-yellow-600",
  SOL: "bg-orange-500",
  EXC: "bg-purple-500",
  COM: "bg-green-500",
  WIT: "bg-zinc-500",
  INV: "bg-emerald-600",
  // Legacy strings — kept for safety; all map to the new colours above
  "Targeting": "bg-slate-500",
  "Reporting": "bg-slate-500",
  "Speculative": "bg-violet-500",
  "Live": "bg-blue-500",
  "Available": "bg-emerald-500",
  "Marketing": "bg-emerald-500",
  "Under Negotiation": "bg-yellow-600",
  "HOTs": "bg-yellow-600",
  "Under Offer": "bg-orange-500",
  "SOLs": "bg-orange-500",
  "Exchanged": "bg-purple-500",
  "Completed": "bg-green-500",
  "Let": "bg-green-500",
  "Withdrawn": "bg-zinc-500",
  "Lost": "bg-zinc-500",
  "Dead": "bg-zinc-500",
  "Invoiced": "bg-emerald-600",
  "Billed": "bg-emerald-600",
  "Leasing Comps": "bg-cyan-600",
  "Investment Comps": "bg-purple-500",
};

export const DEAL_STATUS_BADGE_COLORS: Record<string, string> = {
  OPP: "bg-teal-100 text-teal-800",
  REP: "bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
  SPEC: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  LIVE: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  AVA: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  NEG: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  SOL: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  EXC: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  COM: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  WIT: "bg-zinc-100 text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300",
  INV: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200",
};
