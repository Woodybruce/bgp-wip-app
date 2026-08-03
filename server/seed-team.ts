import { pool } from "./db";
import bcrypt from "bcrypt";

// BGP team roster from the official org chart (May 2026).
// Reporting lines come from the column-stack ordering in the chart:
// each column flows top-down, every row reporting to the row above.
// Woody is the root.

type SeedPerson = {
  name: string;
  role: string;
  team: string;
  reportsTo: string | null; // name of manager, null = root
  boardMember?: boolean;
  managementTeam?: boolean;
  additionalTeams?: string[];
  displayOrder?: number;
};

// Order matters: managers must be inserted before their reports so we can
// resolve manager IDs by name.
export const BGP_ORG_CHART: SeedPerson[] = [
  // Root
  { name: "Woody Bruce", role: "Managing Director", team: "Office / Corporate", reportsTo: null, boardMember: true, managementTeam: true, displayOrder: 0 },

  // Office / Corporate column (PAs / Office / Bookkeeping report into Woody)
  { name: "Cara Milligan", role: "PA – National", team: "Office / Corporate", reportsTo: "Woody Bruce", displayOrder: 1 },
  { name: "Harriette Walker-Clark", role: "PA & Office Manager – Central London Leasing", team: "Office / Corporate", reportsTo: "Woody Bruce", displayOrder: 2 },
  { name: "Layla O'Driscoll", role: "PA & Office Manager – Central London Leasing & Board support", team: "Office / Corporate", reportsTo: "Woody Bruce", additionalTeams: ["BOARD"], displayOrder: 3 },
  { name: "Nick Goodman", role: "Consultant", team: "Office / Corporate", reportsTo: "Woody Bruce", displayOrder: 4 },
  { name: "Wendy McKenzie", role: "Bookkeeper", team: "Office / Corporate", reportsTo: "Woody Bruce", displayOrder: 5 },

  // Investment column — Jack heads Investment + Board + Finance
  { name: "Jack Barratt", role: "ED, Head of Investment – Finance", team: "Investment", reportsTo: "Woody Bruce", boardMember: true, managementTeam: true, additionalTeams: ["BOARD", "Finance"], displayOrder: 0 },
  { name: "Nick Halley", role: "Director – Investment", team: "Investment", reportsTo: "Jack Barratt", displayOrder: 1 },
  // Ollie Wilkinson left the team (2026) — Jonny now reports to Nick Halley.
  { name: "Jonny Palmer", role: "Graduate", team: "Investment", reportsTo: "Nick Halley", displayOrder: 2 },

  // Lease Advisory column — Pete heads
  { name: "Pete Wood", role: "Head – Lease Consultancy / Management", team: "Lease Advisory", reportsTo: "Woody Bruce", managementTeam: true, displayOrder: 0 },
  { name: "Tom Cater", role: "Associate Director", team: "Lease Advisory", reportsTo: "Pete Wood", displayOrder: 1 },

  // National Leasing column — Vicky heads
  { name: "Victoria Broadhead", role: "Head – National / Management", team: "National Leasing", reportsTo: "Woody Bruce", managementTeam: true, displayOrder: 0 },
  { name: "Lucy Gardiner", role: "Director – National Team", team: "National Leasing", reportsTo: "Victoria Broadhead", displayOrder: 1 },
  // Rob Barnes left the team (2026) — Luke now reports to Lucy Gardiner.
  { name: "Luke Donohoe", role: "Graduate Surveyor – National Team", team: "National Leasing", reportsTo: "Lucy Gardiner", displayOrder: 2 },

  // Development / Re-purposing column — Tracey heads
  { name: "Tracey Pollard", role: "Head – Development / Re-purposing", team: "Development", reportsTo: "Woody Bruce", additionalTeams: ["BOARD"], displayOrder: 0 },
  { name: "Emily Dumbell", role: "Director – Leasing", team: "Development", reportsTo: "Tracey Pollard", displayOrder: 1 },
  { name: "Alex Todd", role: "Senior Surveyor – Development", team: "Development", reportsTo: "Emily Dumbell", displayOrder: 2 },
  { name: "Libby Evans", role: "Graduate Surveyor – Development", team: "Development", reportsTo: "Alex Todd", displayOrder: 3 },

  // Tenant Rep column — Harry heads
  { name: "Harry Elliot", role: "Director – Tenant Rep", team: "Tenant Rep", reportsTo: "Woody Bruce", managementTeam: true, displayOrder: 0 },

  // London Leasing column — Charlotte & Rupert co-head
  { name: "Charlotte Roberts", role: "ED & Co-Head – London Estates / Marketing", team: "London Leasing", reportsTo: "Woody Bruce", boardMember: true, managementTeam: true, additionalTeams: ["BOARD", "Marketing"], displayOrder: 0 },
  { name: "Rupert Bentley-Smith", role: "ED & Co-Head – London Estates & USA / Ops & HR", team: "London Leasing", reportsTo: "Woody Bruce", boardMember: true, managementTeam: true, additionalTeams: ["BOARD", "Ops", "HR"], displayOrder: 1 },
  { name: "Evie North", role: "Associate Director – Leasing & Tenant Rep", team: "London Leasing", reportsTo: "Charlotte Roberts", additionalTeams: ["Tenant Rep"], displayOrder: 2 },
  { name: "Lizzie Knights", role: "Director – London Leasing", team: "London Leasing", reportsTo: "Charlotte Roberts", displayOrder: 3 },
  { name: "Lucy Cope", role: "Associate Director – London Leasing", team: "London Leasing", reportsTo: "Lizzie Knights", displayOrder: 4 },
  { name: "Will Penfold", role: "Graduate Surveyor – London Leasing", team: "London Leasing", reportsTo: "Rupert Bentley-Smith", displayOrder: 5 },
  { name: "Emily Cann", role: "Graduate Surveyor – London Leasing", team: "London Leasing", reportsTo: "Lucy Cope", displayOrder: 6 },
];

function slugifyUsername(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

/**
 * Idempotent upsert of the BGP roster into the `users` table.
 * - Match priority: existing row by (case-insensitive) name → existing row by username → insert new.
 * - For matched rows we ONLY update org-chart fields; we never touch password,
 *   email, profile pic, or admin flags. That protects whatever data is already
 *   in production (Woody, Layla and any other real accounts).
 * - For new rows we set a placeholder bcrypt hash so the row is valid; admins
 *   can issue the user a real password later from settings.
 */
export async function seedBgpOrgChart(): Promise<{ inserted: number; updated: number; }> {
  let inserted = 0;
  let updated = 0;
  const placeholderHash = await bcrypt.hash(`bgp-placeholder-${Date.now()}`, 10);
  const nameToId = new Map<string, string>();

  for (const person of BGP_ORG_CHART) {
    const managerId = person.reportsTo ? nameToId.get(person.reportsTo) ?? null : null;
    const username = slugifyUsername(person.name);

    // Look up existing row by name (case-insensitive) or username
    const existing = await pool.query(
      `SELECT id FROM users WHERE LOWER(name) = LOWER($1) OR username = $2 LIMIT 1`,
      [person.name, username]
    );

    if (existing.rows.length > 0) {
      const id = existing.rows[0].id;
      await pool.query(
        `UPDATE users SET
          role = $2,
          team = $3,
          additional_teams = $4,
          manager_id = $5,
          board_member = $6,
          management_team = $7,
          display_order = $8,
          is_active = true
         WHERE id = $1`,
        [
          id,
          person.role,
          person.team,
          person.additionalTeams || [],
          managerId,
          person.boardMember || false,
          person.managementTeam || false,
          person.displayOrder ?? 0,
        ]
      );
      nameToId.set(person.name, id);
      updated++;
    } else {
      const result = await pool.query(
        `INSERT INTO users (
          username, password, name, role, team, additional_teams,
          manager_id, board_member, management_team, display_order,
          is_admin, is_active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          username,
          placeholderHash,
          person.name,
          person.role,
          person.team,
          person.additionalTeams || [],
          managerId,
          person.boardMember || false,
          person.managementTeam || false,
          person.displayOrder ?? 0,
          false,
          true,
        ]
      );
      nameToId.set(person.name, result.rows[0].id);
      inserted++;
    }
  }

  return { inserted, updated };
}
