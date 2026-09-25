// Who counts as a KEY contact at a brand (Woody, 2026-09-25: "we only want
// C-suite / founders and clear property contacts, anything else is just
// noise" — Nando's board was 18 Regional Managing Directors deep and
// buried its Property Director).
export type ContactTier = "property" | "leadership";

const PROPERTY = /\b(property|properties|real estate|acquisitions?|expansion|estates?|new sites?|site (acquisition|selection|finding|research)|store (development|openings?|expansion)|restaurant (development|openings?)|leasing|new openings?|locations? (director|manager|lead))\b/i;
const LEADERSHIP = /\b(founder|co-?founder|owner|chair(man|woman|person)?|ceo|coo|cfo|cpo|cdo|chief [a-z ]*officer|chief executive|president|managing director|group md|md|managing partner)\b/i;
// A regional / area MD runs restaurants, not the estate; assistants and
// PAs are never the decision-maker.
const NOT_LEADERSHIP = /\b(regional|region|area|district|divisional|zone|territory|assistant|personal assistant|executive assistant|pa|p\.a\.|ea|secretary|office manager|coordinator|co-ordinator)\b/i;
const NEVER = /\b(personal assistant|executive assistant|pa to|ea to|assistant to|secretary|intern|trainee)\b/i;

export function contactTier(role: string | null | undefined): ContactTier | null {
  const r = String(role || "").trim();
  if (!r || NEVER.test(r)) return null;
  if (PROPERTY.test(r)) return "property";
  if (LEADERSHIP.test(r) && !NOT_LEADERSHIP.test(r)) return "leadership";
  return null;
}

export const isKeyContactRole = (role: string | null | undefined) => contactTier(role) !== null;

// Letters-only form of a person's name / an email local part, for matching
// "cassie.oflanagan@" to "Cassie O'Flanagan".
export const nameKey = (value: string | null | undefined) => String(value || "").normalize("NFKD").replace(/[^a-z]/gi, "").toLowerCase();
