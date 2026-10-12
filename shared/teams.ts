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
  { name: "Millie Edwards", teams: ["Shopping Centre"] },
  { name: "Victoria Broadhead", teams: ["Shopping Centre"] },
  { name: "Emily Dumbell", teams: ["Shopping Centre"] },
  { name: "Alex Todd", teams: ["Shopping Centre"] },
  { name: "Ben Sykes", teams: ["Shopping Centre"] },
  { name: "Kate Martin", teams: ["Shopping Centre"] },
  { name: "Luke Donohoe", teams: ["Shopping Centre"] },
  { name: "Lizzie Knights", teams: ["London Estate", "City"] },
  { name: "Lucy Cope", teams: ["London Estate"] },
  { name: "Emily Cann", teams: ["London Estate"] },
  { name: "Evie North", teams: ["London Estate"] },
  { name: "Will Penfold", teams: ["London Estate"] },
  { name: "Lucy Gardiner", teams: ["High Street"] },
  { name: "Tracey Pollard", teams: ["High Street"] },
  { name: "Libby Evans", teams: ["High Street"] },
  { name: "Pete Wood", teams: ["Lease Advisory", "City"] },
  { name: "Tom Cater", teams: ["Lease Advisory"] },
  { name: "Harry Elliott", teams: ["Tenant Rep"] },
  { name: "Carly Cunliffe", teams: ["Tenant Rep"] },
  { name: "Beth Emmens", teams: ["Tenant Rep"] },
];
export const NO_TEAM_ROSTER_2026 = ["Woody Bruce", "Rupert Bentley Smith", "Charlotte Roberts", "Layla O'Driscoll", "Cara Milligan", "Harriette Walker Clark", "Nick Goodman", "Emily Mitchell"];
// Woody, 2026-10-12: "Board is Woody and then Charlotte, Rupert, Jack and
// Layla, with Cara and Harriette as support and Nick as consultant … add
// Emily Mitchell as consultant too." Daisy is not part of BGP.
export const BOARD_2026 = ["Woody Bruce", "Charlotte Roberts", "Rupert Bentley Smith", "Jack Barratt", "Layla O'Driscoll"];
export const LEFT_BGP_2026 = ["Daisy Driscoll"];
export const CONSULTANTS_2026: Array<{ name: string; role: string; reportsTo: string }> = [
  { name: "Nick Goodman", role: "Consultant", reportsTo: "Woody Bruce" },
  { name: "Emily Mitchell", role: "Consultant", reportsTo: "Woody Bruce" },
];

const normPerson = (s: string) => String(s || "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
/** A person's 2026-10 teams by name: full name first, then a first name
 *  that only one roster person has ("Libby", "Millie"). null = not on the
 *  roster (no team: MD, heads of department, support, or unknown). */
export function rosterTeamsFor(name: string | null | undefined): BgpTeamName[] | null {
  const n = normPerson(name || "");
  if (!n) return null;
  const full = TEAM_ROSTER_2026.find(r => normPerson(r.name) === n);
  if (full) return full.teams;
  if (NO_TEAM_ROSTER_2026.some(r => normPerson(r) === n)) return null;
  const first = n.split(" ")[0];
  const byFirst = TEAM_ROSTER_2026.filter(r => normPerson(r.name).split(" ")[0] === first);
  return byFirst.length === 1 ? byFirst[0].teams : null;
}

/** Same person by name, ignoring case, punctuation and hyphens. */
export const samePerson = (a: string | null | undefined, b: string | null | undefined) => !!normPerson(a || "") && normPerson(a || "") === normPerson(b || "");
