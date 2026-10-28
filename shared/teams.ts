// BGP's teams — ONE list for the whole app (Woody, 2026-10-12: new team
// structure, BGP_Team_Structure.xlsx, One to Ones tab is the source).
// Each property sits in one team and its fees count to that team; each
// deal's fee is still shared between agents in any team (Fee Allocation).
// Investment, Tenant Rep and Lease Advisory are unchanged; leasing is now
// four teams.
export const LEASING_TEAMS = ["Shopping Centre", "London Estate", "High Street", "City"] as const;
export const BGP_TEAM_NAMES = [...LEASING_TEAMS, "Investment", "Tenant Rep", "Lease Advisory"] as const;
export type BgpTeamName = (typeof BGP_TEAM_NAMES)[number];

// Retired names. Kept only so old stored values (SharePoint folder tags,
// historic imports) can still be read and mapped; never offered as choices.
export const RETIRED_TEAM_NAMES = ["Development", "London F&B", "London Retail", "National Leasing", "Office / Corporate",
  "London Leasing", "National", "London Leasing Retail", "London Leasing F&B and Leisure"] as const;

export const isLeasingTeam = (t: string | null | undefined) => !!t && (LEASING_TEAMS as readonly string[]).includes(t);
export const isBgpTeam = (t: string | null | undefined) => !!t && (BGP_TEAM_NAMES as readonly string[]).includes(t);

// Chip colours, one per team (Tailwind classes, light + dark).
export const TEAM_CHIP_CLASSES: Record<string, string> = {
  "Shopping Centre": "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  "London Estate": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "High Street": "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  "City": "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  "Investment": "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  "Tenant Rep": "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  "Lease Advisory": "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  "Landsec": "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
};
export const TEAM_DOT_CLASSES: Record<string, string> = {
  "Shopping Centre": "bg-sky-500", "London Estate": "bg-amber-500", "High Street": "bg-emerald-500", "City": "bg-violet-500",
  "Investment": "bg-blue-500", "Tenant Rep": "bg-rose-500", "Lease Advisory": "bg-teal-500", "Landsec": "bg-zinc-500",
};

// The One to Ones tab: each person's home team(s). People not listed (MD,
// Heads of Department, support staff) have no team and see all teams.
// Matched to users by full name, then by a unique first name (the sheet's
// surnames may differ from the login's).
export const TEAM_ROSTER_2026: Array<{ name: string; teams: BgpTeamName[] }> = [
  { name: "Jack Barratt", teams: ["Investment"] },
  { name: "Nick Halley", teams: ["Investment"] },
  { name: "Jonny Palmer", teams: ["Investment"] },
  { name: "Millie Edwards", teams: ["Shopping Centre", "London Estate"] }, // + London Estate (Layla, 2026-10-13)
  { name: "Victoria Broadhead", teams: ["Shopping Centre"] },
  { name: "Emily Dumbell", teams: ["Shopping Centre"] },
  { name: "Alex Todd", teams: ["Shopping Centre"] },
  { name: "Ben Sykes", teams: ["Shopping Centre"] },
  { name: "Kate Martin", teams: ["Shopping Centre"] },
  { name: "Luke Donohoe", teams: ["Shopping Centre"] },
  { name: "Lizzie Knights", teams: ["London Estate", "City"] },
  { name: "Lucy Cope", teams: ["London Estate"] },
  { name: "Emily Cann", teams: ["London Estate"] },
  { name: "Evie North", teams: ["Tenant Rep"] }, // moved from London Estate (Woody, 2026-10-13)
  { name: "Will Penfold", teams: ["London Estate"] },
  { name: "Lucy Gardiner", teams: ["High Street", "Shopping Centre"] }, // + Shopping Centre (Layla, 2026-10-13)
  { name: "Tracey Pollard", teams: ["High Street", "London Estate"] }, // + London Estate (Layla, 2026-10-13)
  { name: "Libby Evans", teams: ["High Street", "London Estate"] }, // + London Estate (Woody, 2026-10-19)
  { name: "Pete Wood", teams: ["Lease Advisory", "City"] },
  { name: "Tom Cater", teams: ["Lease Advisory"] },
  { name: "Harry Elliott", teams: ["Tenant Rep"] },
  { name: "Carly Cunliffe", teams: ["Tenant Rep", "Shopping Centre", "London Estate"] }, // + Shopping Centre, London Estate (Woody, 2026-10-19)
  { name: "Beth Emmens", teams: ["Tenant Rep"] },
];
export const NO_TEAM_ROSTER_2026 = ["Woody Bruce", "Rupert Bentley Smith", "Charlotte Roberts", "Layla O'Driscoll", "Cara Milligan", "Harriette Walker Clark", "Nick Goodman", "Emily Mitchell"];
// Woody, 2026-10-12: "Board is Woody and then Charlotte, Rupert, Jack and
// Layla, with Cara and Harriette as support and Nick as consultant … add
// Emily Mitchell as consultant too." Daisy is not part of BGP.
export const BOARD_2026 = ["Woody Bruce", "Charlotte Roberts", "Rupert Bentley Smith", "Jack Barratt", "Layla O'Driscoll"];
// Daisy Driscoll: leave as she is (Woody, 2026-10-12 "daisy ignore").
export const LEFT_BGP_2026: string[] = [];
export const SUPPORT_2026 = ["Cara Milligan", "Harriette Walker Clark"];
export const CONSULTANTS_2026: Array<{ name: string; role: string; reportsTo: string }> = [
  { name: "Nick Goodman", role: "Consultant", reportsTo: "Woody Bruce" },
  { name: "Emily Mitchell", role: "Consultant", reportsTo: "Woody Bruce" },
];

const normPerson = (s: string) => String(s || "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
/** The roster name a login belongs to: full name first, then a first name
 *  only one roster person has ("Libby", "Millie"), then a surname only one
 *  has ("Peter Wood" → Pete Wood, "Elizabeth Knights" → Lizzie Knights).
 *  null = not on the roster (no team: MD, heads of department, support). */
export function rosterNameFor(name: string | null | undefined): string | null {
  const n = normPerson(name || "");
  if (!n) return null;
  const full = TEAM_ROSTER_2026.find(r => normPerson(r.name) === n);
  if (full) return full.name;
  if (NO_TEAM_ROSTER_2026.some(r => normPerson(r) === n)) return null;
  const parts = n.split(" ");
  const byFirst = TEAM_ROSTER_2026.filter(r => normPerson(r.name).split(" ")[0] === parts[0]);
  if (byFirst.length === 1) return byFirst[0].name;
  // Surname alone only when the first names agree too ("Peter Wood" →
  // Pete Wood, "Tracey Wilson" → Tracey Pollard) — not "Johnny Penfold" →
  // Will Penfold (Woody, 2026-10-15).
  const last = parts[parts.length - 1];
  const byLast = parts.length > 1 ? TEAM_ROSTER_2026.filter(r => normPerson(r.name).split(" ").pop() === last
    && normPerson(r.name).split(" ")[0].slice(0, 3) === parts[0].slice(0, 3)) : [];
  return byLast.length === 1 ? byLast[0].name : null;
}
/** A person's 2026-10 teams by name (see rosterNameFor). */
export function rosterTeamsFor(name: string | null | undefined): BgpTeamName[] | null {
  const r = rosterNameFor(name);
  return r ? TEAM_ROSTER_2026.find(x => x.name === r)!.teams : null;
}

/** Same person by name, ignoring case, punctuation and hyphens. */
export const samePerson = (a: string | null | undefined, b: string | null | undefined) => !!normPerson(a || "") && normPerson(a || "") === normPerson(b || "");

/** Where a person sits on the HR org chart / directory: Board, Support or
 *  Consultants (Woody, 2026-10-12), else their team. */
export type StaffGroup = "Board" | "Support" | "Consultants" | string;
export const STAFF_GROUP_ORDER = ["Board", ...BGP_TEAM_NAMES, "Support", "Consultants"];
export function staffGroupFor(name: string | null | undefined, team: string | null | undefined): StaffGroup | null {
  if (BOARD_2026.some(n => samePerson(n, name))) return "Board";
  if (CONSULTANTS_2026.some(c => samePerson(c.name, name))) return "Consultants";
  if (SUPPORT_2026.some(n => samePerson(n, name))) return "Support";
  return team || null;
}

// App photo chosen over the website headshot for a person (Woody,
// 2026-10-12: "change my photo, I hate it"). Paths are app-served files.
// Empty since 2026-10-13: one photo per person, the website's, everywhere
// (Woody: "there should only be one source of truth for each person").
export const APP_PHOTO_OVERRIDES: Record<string, string> = {};
export function appPhotoOverride(name: string | null | undefined): string | null {
  const hit = Object.entries(APP_PHOTO_OVERRIDES).find(([n]) => samePerson(n, name));
  return hit ? hit[1] : null;
}

// Team leads from BGP_Team_Structure.xlsx — shown first, in bold, on each
// team card (Woody, 2026-10-12). A lead on the Board (Jack) still heads
// their team's card. Woody heads the Board card and Layla the Support card
// (Woody, 2026-10-28: "remove Harriette as head support, Layla does that").
export const TEAM_LEADS_2026: Record<string, string[]> = {
  "Board": ["Woody Bruce"],
  "Shopping Centre": ["Millie Edwards", "Victoria Broadhead"],
  "London Estate": ["Lizzie Knights", "Lucy Cope"],
  "High Street": ["Lucy Gardiner", "Tracey Pollard"],
  "City": ["Pete Wood", "Lizzie Knights"],
  "Investment": ["Jack Barratt"],
  "Tenant Rep": ["Harry Elliott", "Beth Emmens"],
  "Lease Advisory": ["Pete Wood"],
  "Support": ["Layla O'Driscoll"],
};

// Seniority order for the HR directory (Woody, 2026-10-28): Director,
// Associate Director, Senior Surveyor, Surveyor, then everyone else, A→Z
// within a rank. Heads are plain "Director" tagged with their team — not
// a title tier ("some people are multiple heads or cross teams").
export function seniorityRank(title: string | null | undefined): number {
  const t = String(title || "").toLowerCase();
  if (!t) return 9;
  if (/associate director/.test(t)) return 2;
  if (/\bdirector\b|\bpartner\b|\bhead\b/.test(t)) return 1;
  if (/senior surveyor/.test(t)) return 4;
  if (/\bassociate\b/.test(t)) return 3;
  if (/surveyor/.test(t)) return 5;
  return 6;
}
export const compareBySeniority = (a: { name?: string | null; title?: string | null }, b: { name?: string | null; title?: string | null }) =>
  seniorityRank(a.title) - seniorityRank(b.title) || String(a.name || "").localeCompare(String(b.name || ""));

// People who need a login + HR profile created by the team move if they
// don't have one (Woody, 2026-10-12: "Millie Edwards needs a profile").
export const NEW_STAFF_2026: Array<{ name: string; email: string; title: string }> = [
  { name: "Millie Edwards", email: "millie@brucegillinghampollard.com", title: "Director" },
];
/** On the 2026-10 structure at all (team, board, support or consultant). */
export const onStructure2026 = (name: string | null | undefined) =>
  !!rosterTeamsFor(name) || [...BOARD_2026, ...SUPPORT_2026, ...CONSULTANTS_2026.map(c => c.name)].some(n => samePerson(n, name));
/** Who belongs on the People & HR pages: a BGP login that's on the 2026
 *  structure or in a BGP team. Keeps out client logins, test and service
 *  accounts (Woody, 2026-10-13: "they are just rando accounts"). */
export const isHrPerson = (p: { name?: string | null; email?: string | null; team?: string | null }) =>
  /@brucegillinghampollard\.com$/i.test(String(p.email || "")) && (onStructure2026(p.name) || isBgpTeam(p.team));
