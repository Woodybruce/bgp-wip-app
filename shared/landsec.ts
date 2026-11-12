// Landsec workspace constants shared by server and client
// (docs/landsec-pitch-plan.md). The brief categories are the Hospitality &
// Leisure categories of the instruction; the four London schemes also take
// all retail.
export const LANDSEC_BRIEF_CATEGORIES = [
  "Restaurants & Bars",
  "Café, Grab & Go and QSR",
  "Food Halls",
  "Competitive Socialising",
  "Active Leisure",
  "Gyms, Wellness & Softplay",
  "Retail (London schemes)",
] as const;
export type LandsecBriefCategory = (typeof LANDSEC_BRIEF_CATEGORIES)[number];

export type LandsecBriefSigner = "leasing" | "am";

export interface LandsecAgreedBrief {
  use: string | null;
  category: string | null;
  nerFloor: number | null;          // net effective rent floor, £ pa
  incentiveCeiling: string | null;  // e.g. "12 months rent free, no capital contribution"
  capexEnvelope: number | null;     // £
  targetBrands: string | null;
  notes: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  leasing: { by: string | null; at: string | null };
  am: { by: string | null; at: string | null };
}

export function briefStatus(b: LandsecAgreedBrief | null | undefined): "agreed" | "awaiting_am" | "awaiting_leasing" | "unsigned" | "empty" {
  if (!b) return "empty";
  const hasContent = !!(b.use || b.category || b.nerFloor || b.incentiveCeiling || b.capexEnvelope || b.targetBrands);
  if (!hasContent) return "empty";
  if (b.leasing.at && b.am.at) return "agreed";
  if (b.leasing.at) return "awaiting_am";
  if (b.am.at) return "awaiting_leasing";
  return "unsigned";
}

// ── Deal clock (item 4) ─────────────────────────────────────────────────
export const LANDSEC_WAITING_PARTIES = [
  "Landsec asset manager",
  "Landsec leasing manager",
  "Landsec approval (CAPR / board)",
  "Tenant",
  "Tenant's agent",
  "Landsec solicitors",
  "Tenant's solicitors",
  "BGP",
  "Joint agent",
  "Another deal",
] as const;

export interface LandsecDealClock {
  waitingOnParty: string | null;
  waitingOnName: string | null;
  waitingSince: string | null;
  waitingNote: string | null;
  dependsOnDealId: string | null;
  dependsOn?: { id: string; ref: number | null; name: string; unit: string | null } | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

// Net Effective Rent as Landsec defines it: the headline rent less the
// annual cost of the incentives spread over the MINIMUM term — the term
// certain to the first break — not the full lease.
//   NER pa = (headline × (termCertain − rentFreeYears) − capital) / termCertain
export interface LandsecNer {
  nerPa: number;
  headlinePa: number;
  termCertainYears: number;
  rentFreeMonths: number;
  capital: number;
  assumedTerm: boolean;
}

const numIn = (s: string | number | null | undefined): number | null => {
  if (s === null || s === undefined || s === "") return null;
  const m = String(s).replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

// "10 years", "10 yrs", "10" → 10. Break: "5th year", "year 5", "5", "break at year 5",
// "mutual break 2031" (a year, not a term — ignored).
export function termCertainYears(leaseLength: string | number | null | undefined, breakOption: string | null | undefined): { years: number; assumed: boolean } {
  const full = numIn(leaseLength);
  const b = (breakOption || "").toLowerCase();
  let brk: number | null = null;
  if (b && !/\bno\b|none|n\/a/.test(b)) {
    const m = b.match(/(\d+(\.\d+)?)/);
    if (m) {
      const v = parseFloat(m[1]);
      brk = v > 0 && v < 100 ? v : null; // a calendar year ("2031") is not a term
    }
  }
  if (full && brk && brk < full) return { years: brk, assumed: false };
  if (brk && !full) return { years: brk, assumed: false };
  if (full) return { years: full, assumed: false };
  return { years: 5, assumed: true };
}

export function landsecNer(input: {
  headlinePa: number | null | undefined;
  rentFreeMonths?: number | null;
  capital?: number | null;
  leaseLength?: string | number | null;
  breakOption?: string | null;
  termYears?: number | null;
}): LandsecNer | null {
  const headlinePa = Number(input.headlinePa);
  if (!headlinePa || headlinePa < 1000) return null;
  const tc = input.termYears && input.termYears > 0 ? { years: input.termYears, assumed: false } : termCertainYears(input.leaseLength, input.breakOption);
  const rentFreeMonths = Math.max(0, Number(input.rentFreeMonths) || 0);
  const rentFreeYears = Math.min(rentFreeMonths / 12, tc.years);
  const capital = Math.max(0, Number(input.capital) || 0);
  const nerPa = (headlinePa * (tc.years - rentFreeYears) - capital) / tc.years;
  if (!Number.isFinite(nerPa)) return null;
  return { nerPa: Math.round(nerPa), headlinePa: Math.round(headlinePa), termCertainYears: tc.years, rentFreeMonths, capital, assumedTerm: tc.assumed };
}

// ── Brand case (item 5) ─────────────────────────────────────────────────
export const LANDSEC_CASE_RESPONSES = [
  { key: "seen", label: "Seen" },
  { key: "supportive", label: "Supportive" },
  { key: "concerns", label: "Concerns" },
  { key: "visit", label: "Wants a store visit" },
] as const;
export type LandsecCaseResponse = (typeof LANDSEC_CASE_RESPONSES)[number]["key"];

export interface LandsecCaseEvidence { id: string; kind: "photo" | "video" | "link" | "file"; url: string; caption: string | null; fileKey?: string | null; mimeType?: string | null }
export interface LandsecCaseUnit { id: string; schemeKey: string; schemeName?: string; tenancyUnitId: string | null; unitLabel: string; note: string | null; status: string | null }

// ── Logins by role and scheme (item 6) ──────────────────────────────────
export const LANDSEC_ROLES = [
  { key: "leasing_manager", label: "Landsec leasing manager", scope: "all schemes" },
  { key: "asset_manager", label: "Landsec asset manager", scope: "their schemes; brand pages and brand cases portfolio-wide" },
  { key: "joint_agent", label: "Joint agent", scope: "units, deals and files on their schemes only" },
] as const;
export type LandsecRole = (typeof LANDSEC_ROLES)[number]["key"];
export const RESTRICTED_LANDSEC_ROLES: LandsecRole[] = ["asset_manager", "joint_agent"];
