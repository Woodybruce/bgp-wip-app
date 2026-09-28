// Who counts as a KEY contact at a brand (Woody, 2026-09-25: "we only want
// C-suite / founders and clear property contacts, anything else is just
// noise" — Nando's board was 18 Regional Managing Directors deep and
// buried its Property Director).
export type ContactTier = "property" | "leadership";

const PROPERTY = /\b(property|properties|real estate|acquisitions?|expansion|estates?|new sites?|site (acquisition|selection|finding|research)|store (development|openings?|expansion)|restaurant (development|openings?)|leasing|new openings?|locations? (director|manager|lead))\b/i;
const LEADERSHIP = /\b(founder|co-?founder|owner|chair(man|woman|person)?|ceo|coo|cfo|cpo|cdo|chief [a-z ]*officer|chief executive|president|managing director|group md|md|managing partner)\b/i;
// "Acquisition" that isn't sites: recruiters and marketers (Honest Greens'
// Talent Acquisition Specialist read as a property contact, 2026-09-26).
const NOT_PROPERTY = /\b((talent|customer|user|client|candidate|member|guest|paid|media|digital|people) acquisitions?|acquisition marketing|recruit(er|ment|ing)?|talent)\b/i;
// A regional / area MD runs restaurants, not the estate; assistants and
// PAs are never the decision-maker.
const NOT_LEADERSHIP = /\b(regional|region|area|district|divisional|zone|territory|assistant|personal assistant|executive assistant|pa|p\.a\.|ea|secretary|office manager|coordinator|co-ordinator)\b/i;
const NEVER = /\b(personal assistant|executive assistant|pa to|ea to|assistant to|secretary|intern|trainee)\b/i;

export function contactTier(role: string | null | undefined): ContactTier | null {
  const r = String(role || "").trim();
  if (!r || NEVER.test(r)) return null;
  if (PROPERTY.test(r) && !NOT_PROPERTY.test(r)) return "property";
  if (LEADERSHIP.test(r) && !NOT_LEADERSHIP.test(r)) return "leadership";
  return null;
}

export const isKeyContactRole = (role: string | null | undefined) => contactTier(role) !== null;

// Letters-only form of a person's name / an email local part, for matching
// "cassie.oflanagan@" to "Cassie O'Flanagan".
export const nameKey = (value: string | null | undefined) => String(value || "").normalize("NFKD").replace(/[^a-z]/gi, "").toLowerCase();

// The Key contacts board leads with a handful of ranked people, not the
// whole CRM (Woody, 2026-09-28: "we don't need everyone… needs to be better
// and more targeted" — Ardent's board was 33 rows, 15 of them "Dbarker"-style
// inbox placeholders, with a leaver at the top).
export type KeyContactSignals = {
  name?: string | null;
  email?: string | null;
  role?: string | null;
  emails?: number | null;
  lastAt?: string | number | null;
  leftAt?: string | null;
  inCrm?: boolean;
};
export type KeyContactHiddenReason = "left" | "placeholder" | "stale";

const YEAR_MS = 365 * 86_400_000;
const toMs = (value: string | number | null | undefined) => { const t = typeof value === "number" ? value : Date.parse(String(value || "")); return Number.isFinite(t) ? t : 0; };
const squashLocal = (value: string | null | undefined) => String(value || "").trim().toLowerCase().replace(/[._-]/g, "");

// A name that is just the email's local part ("Mshulman" for
// mshulman@…) — saved from an inbox before a real name was known.
export function isEmailPlaceholderName(name: string | null | undefined, email: string | null | undefined): boolean {
  const local = String(email || "").split("@")[0];
  const squashed = squashLocal(name);
  return !!local && !!squashed && squashed === squashLocal(local);
}

// Landlord-side decision-makers the brand-oriented tier doesn't know.
const LANDLORD_KEY = /\b(asset manag\w*|portfolio (manag\w*|director)|investment (manag\w*|director)|fund manag\w*|centre (manag\w*|director)|head of (assets?|investments?|portfolio))\b/i;

export function keyRoleRank(role: string | null | undefined, landlord = false): number {
  const tier = contactTier(role);
  if (tier === "property") return 0;
  if (tier === "leadership") return 1;
  const r = String(role || "");
  if (landlord && LANDLORD_KEY.test(r) && !NEVER.test(r)) return 0;
  return 2;
}

// Left the company, a placeholder nobody emails, or silent for 2+ years —
// kept under "Show all", never in the top list.
export function keyContactHiddenReason(c: KeyContactSignals, now = Date.now()): KeyContactHiddenReason | null {
  if (c.leftAt) return "left";
  if (!Number(c.emails || 0) && isEmailPlaceholderName(c.name, c.email)) return "placeholder";
  const last = toMs(c.lastAt);
  if (last && now - last > 2 * YEAR_MS) return "stale";
  return null;
}

// Role first, then who BGP actually emails (anyone emailed in the last 12
// months ahead, then volume, then recency — per-year counts aren't stored),
// then a real name, then saved-in-CRM.
export function compareKeyContacts(a: KeyContactSignals, b: KeyContactSignals, opts: { landlord?: boolean; now?: number } = {}): number {
  const now = opts.now ?? Date.now();
  const recent = (c: KeyContactSignals) => { const t = toMs(c.lastAt); return t && now - t <= YEAR_MS ? 1 : 0; };
  const named = (c: KeyContactSignals) => (String(c.name || "").trim() && !isEmailPlaceholderName(c.name, c.email) ? 1 : 0);
  return (keyRoleRank(a.role, opts.landlord) - keyRoleRank(b.role, opts.landlord))
    || (recent(b) - recent(a))
    || (Number(b.emails || 0) - Number(a.emails || 0))
    || (toMs(b.lastAt) - toMs(a.lastAt))
    || (named(b) - named(a))
    || ((b.inCrm ? 1 : 0) - (a.inCrm ? 1 : 0))
    || String(a.name || "").localeCompare(String(b.name || ""));
}
