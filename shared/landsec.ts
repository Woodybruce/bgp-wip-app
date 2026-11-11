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
