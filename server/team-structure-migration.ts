// ── 2026-10 team structure migration (Woody, 2026-10-12) ─────────────────
// "The old teams should go … make assumptions for which new team they go
// into … we can then change the team on the WIP." BGP_Team_Structure.xlsx
// (One to Ones tab) is the source. Runs once at boot, after backing every
// value it changes up to team_structure_backup_2026_10. Xero is untouched —
// nothing here reaches it (its tracking is per person / per property).
//
//   users         team / additional_teams from the One to Ones roster; MD,
//                 heads of department and support staff have no team (they
//                 see all). Retired active_team choices are cleared.
//   properties    ONE owning team in bgp_engagement (Landsec tag kept):
//                 the team most of its deals point to — a deal on a retired
//                 leasing team takes City for an EC postcode, else the
//                 leasing team of its agents (One to Ones), else location /
//                 type (shopping centre → Shopping Centre, London → London
//                 Estate, elsewhere → High Street).
//   deals         retired team tags → the property's leasing team, else the
//                 deal's own leasing team, else the lead agent's home team.
//                 Investment / Tenant Rep / Lease Advisory / Landsec stay.
//   wip_entries   the linked deal's new team, else the property's, else the
//                 agent's home team.
// Fee allocations per agent are not touched.

import { pool } from "./db";
import { BGP_TEAM_NAMES, CONSULTANTS_2026, LEASING_TEAMS, LEFT_BGP_2026, RETIRED_TEAM_NAMES, isLeasingTeam, rosterTeamsFor, samePerson, type BgpTeamName } from "@shared/teams";

const FLAG = "team_structure_2026_10";
const KEPT = new Set(["Investment", "Tenant Rep", "Lease Advisory", "Landsec", ...LEASING_TEAMS]);
const RETIRED = new Set<string>(RETIRED_TEAM_NAMES.map(t => t.toLowerCase()));
const isRetired = (t: string) => RETIRED.has(String(t || "").trim().toLowerCase());
const LONDON_RETIRED = /london|f&b/i;

export type MigUser = { id: string; name: string; email: string | null; team: string | null; additional_teams: string[] | null; active_team: string | null; is_active: boolean | null; role?: string | null; manager_id?: string | null };
type UserState = { team: string | null; additional_teams: string[] | null; active_team: string | null; is_active: boolean; role: string | null; manager_id: string | null };
export type MigDeal = { id: string; team: string[] | null; property_id: string | null; internal_agent: string[] | null; internal_agent_ids: string[] | null; deal_type: string | null };
export type MigProperty = { id: string; name: string; postcode: string | null; address: any; asset_class: string | null; bgp_engagement: string[] | null };
export type MigWip = { id: string; team: string | null; deal_id: string | null; property_id: string | null; agent: string | null; agent_user_id: string | null };

const postcodeOf = (p: MigProperty) => {
  const a = p.address && typeof p.address === "object" ? p.address : {};
  const text = [p.postcode, a.postcode, typeof p.address === "string" ? p.address : "", a.formatted, a.street].filter(Boolean).join(" ");
  return (text.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/)?.[1]) || (String(p.postcode || "").toUpperCase().match(/^[A-Z]{1,2}\d[A-Z\d]?/)?.[0]) || "";
};
const isCityPostcode = (pc: string) => /^EC\d/.test(pc);
const isLondonPostcode = (pc: string) => /^(EC|WC|W|SW|SE|NW|N|E)\d/.test(pc);
const isShoppingCentre = (p: MigProperty | undefined) =>
  !!p && /shopping\s*cent|\bmall\b|retail park|outlet|westfield|bluewater|brent cross|\bcentre\b/i.test(`${p.name} ${p.asset_class || ""}`);

/** Leasing team for a property by location and type alone. */
function locationTeam(p: MigProperty | undefined, retiredTags: string[]): BgpTeamName {
  const pc = p ? postcodeOf(p) : "";
  if (isCityPostcode(pc)) return "City";
  if (isShoppingCentre(p)) return "Shopping Centre";
  if (isLondonPostcode(pc) || retiredTags.some(t => LONDON_RETIRED.test(t))) return "London Estate";
  return "High Street";
}

export function planTeamStructure(input: { users: MigUser[]; deals: MigDeal[]; properties: MigProperty[]; wip: MigWip[] }) {
  const usersById = new Map(input.users.map(u => [u.id, u]));
  const usersByName = new Map(input.users.map(u => [String(u.name || "").toLowerCase().trim(), u]));
  const propsById = new Map(input.properties.map(p => [p.id, p]));
  const homeTeams = (u: MigUser | undefined): BgpTeamName[] => (u ? rosterTeamsFor(u.name) : null) || [];
  const dealAgents = (d: MigDeal): MigUser[] => {
    const ids = (d.internal_agent_ids || []).map(id => usersById.get(id)).filter(Boolean) as MigUser[];
    if (ids.length) return ids;
    return (d.internal_agent || []).map(n => usersByName.get(String(n || "").toLowerCase().trim())).filter(Boolean) as MigUser[];
  };

  // 1. Users — teams from the roster; people who've left made inactive;
  // consultants set to report to the right person.
  const userChanges: Array<{ id: string; name: string; note?: string; from: UserState; to: UserState }> = [];
  for (const u of input.users) {
    const isStaff = String(u.email || "").toLowerCase().endsWith("@brucegillinghampollard.com");
    if (!isStaff) continue;
    const from: UserState = { team: u.team, additional_teams: u.additional_teams, active_team: u.active_team, is_active: u.is_active !== false, role: u.role ?? null, manager_id: u.manager_id ?? null };
    const roster = rosterTeamsFor(u.name);
    const to: UserState = { ...from };
    let note: string | undefined;
    if (roster) { to.team = roster[0]; to.additional_teams = roster.slice(1); }
    else {
      to.team = u.team && !isRetired(u.team) ? u.team : null;
      to.additional_teams = (u.additional_teams || []).filter(t => !isRetired(t));
    }
    to.active_team = u.active_team && isRetired(u.active_team) ? null : u.active_team;
    if (LEFT_BGP_2026.some(n => samePerson(n, u.name))) { to.team = null; to.additional_teams = []; to.is_active = false; note = "Not part of BGP — login made inactive"; }
    const consultant = CONSULTANTS_2026.find(c => samePerson(c.name, u.name));
    if (consultant) {
      const boss = input.users.find(x => samePerson(x.name, consultant.reportsTo));
      to.team = null; to.additional_teams = []; to.is_active = true; to.role = consultant.role; to.manager_id = boss?.id ?? from.manager_id;
      note = `${consultant.role}, reports to ${consultant.reportsTo}`;
    }
    const same = to.team === from.team && JSON.stringify(to.additional_teams || []) === JSON.stringify(from.additional_teams || [])
      && to.active_team === from.active_team && to.is_active === from.is_active && to.role === from.role && to.manager_id === from.manager_id;
    if (!same) userChanges.push({ id: u.id, name: u.name, note, from, to });
  }

  // 2. Each deal's own leasing team (for deals that carry a retired tag)
  const dealLeasingTeam = (d: MigDeal): BgpTeamName => {
    const p = d.property_id ? propsById.get(d.property_id) : undefined;
    const retiredTags = (d.team || []).filter(isRetired);
    if (p && isCityPostcode(postcodeOf(p))) return "City";
    const votes = new Map<BgpTeamName, number>();
    for (const a of dealAgents(d)) for (const t of homeTeams(a)) if (isLeasingTeam(t) && t !== "City") votes.set(t, (votes.get(t) || 0) + 1);
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) return ranked[0][0];
    return locationTeam(p, retiredTags);
  };
  const dealVoteTeam = new Map<string, BgpTeamName | null>();
  for (const d of input.deals) {
    const tags = d.team || [];
    if (tags.some(isRetired)) dealVoteTeam.set(d.id, dealLeasingTeam(d));
    else {
      const kept = tags.find(t => (BGP_TEAM_NAMES as readonly string[]).includes(t)) as BgpTeamName | undefined;
      dealVoteTeam.set(d.id, kept || null);
    }
  }

  // 3. Properties — one team each
  const dealsByProp = new Map<string, MigDeal[]>();
  for (const d of input.deals) if (d.property_id) dealsByProp.set(d.property_id, [...(dealsByProp.get(d.property_id) || []), d]);
  const propTeam = new Map<string, BgpTeamName>();
  const propChanges: Array<{ id: string; name: string; from: string[] | null; to: string[]; basis: string }> = [];
  for (const p of input.properties) {
    const eng = p.bgp_engagement || [];
    const deals = dealsByProp.get(p.id) || [];
    const hasRetired = eng.some(isRetired) || deals.some(d => (d.team || []).some(isRetired));
    const currentTeams = eng.filter(t => (BGP_TEAM_NAMES as readonly string[]).includes(t)) as BgpTeamName[];
    if (!hasRetired && currentTeams.length <= 1) { if (currentTeams[0]) propTeam.set(p.id, currentTeams[0]); continue; }
    const votes = new Map<BgpTeamName, number>();
    for (const d of deals) { const t = dealVoteTeam.get(d.id); if (t) votes.set(t, (votes.get(t) || 0) + 1); }
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || (isLeasingTeam(b[0]) ? 1 : 0) - (isLeasingTeam(a[0]) ? 1 : 0));
    let team: BgpTeamName; let basis: string;
    if (ranked.length) { team = ranked[0][0]; basis = `deals (${ranked.map(([t, n]) => `${t} ${n}`).join(", ")})`; }
    else if (currentTeams.length) { team = currentTeams[0]; basis = "existing team"; }
    else if (eng.some(t => isRetired(t) && !/office|corporate/i.test(t))) { team = locationTeam(p, eng.filter(isRetired)); basis = "location / type"; }
    else continue;
    propTeam.set(p.id, team);
    const to = [team, ...(eng.includes("Landsec") ? ["Landsec"] : [])];
    if (JSON.stringify(to) !== JSON.stringify(eng)) propChanges.push({ id: p.id, name: p.name, from: p.bgp_engagement, to, basis });
  }

  // 4. Deals — retired tags replaced
  const dealChanges: Array<{ id: string; from: string[] | null; to: string[] }> = [];
  const newDealTeam = new Map<string, string[]>();
  for (const d of input.deals) {
    const tags = d.team || [];
    if (!tags.some(isRetired)) { newDealTeam.set(d.id, tags); continue; }
    const kept = tags.filter(t => KEPT.has(t));
    const pt = d.property_id ? propTeam.get(d.property_id) : undefined;
    let leasing: string | undefined = pt && isLeasingTeam(pt) ? pt : undefined;
    if (!leasing && tags.some(t => isRetired(t) && !/office|corporate/i.test(t))) {
      leasing = d.property_id ? dealLeasingTeam(d) : (homeTeams(dealAgents(d)[0])[0] || dealLeasingTeam(d));
    }
    const to = [...new Set([...(leasing ? [leasing] : []), ...kept])];
    newDealTeam.set(d.id, to);
    dealChanges.push({ id: d.id, from: d.team, to });
  }

  // 5. WIP entries (comma-joined team text)
  const wipChanges: Array<{ id: string; from: string | null; to: string | null }> = [];
  for (const w of input.wip) {
    const tags = String(w.team || "").split(",").map(t => t.trim()).filter(Boolean);
    if (!tags.some(isRetired)) continue;
    let to: string | null = null;
    if (w.deal_id && newDealTeam.has(w.deal_id)) to = newDealTeam.get(w.deal_id)!.join(", ") || null;
    else if (w.property_id && propTeam.has(w.property_id)) to = propTeam.get(w.property_id)!;
    else {
      const agent = (w.agent_user_id && usersById.get(w.agent_user_id)) || usersByName.get(String(w.agent || "").toLowerCase().trim());
      const kept = tags.filter(t => KEPT.has(t));
      to = [...new Set([...(homeTeams(agent).slice(0, 1)), ...kept])].join(", ") || null;
    }
    if (to !== w.team) wipChanges.push({ id: w.id, from: w.team, to });
  }

  return { userChanges, propChanges, dealChanges, wipChanges };
}

async function loadInput() {
  const users = (await pool.query(`SELECT id, name, email, team, additional_teams, active_team, is_active, role, manager_id FROM users`)).rows;
  const deals = (await pool.query(`SELECT id, team, property_id, internal_agent, internal_agent_ids, deal_type FROM crm_deals`)).rows;
  const properties = (await pool.query(`SELECT id, name, postcode, address, asset_class, bgp_engagement FROM crm_properties`)).rows;
  // SELECT * — agent_user_id may be missing on older databases.
  const wip = (await pool.query(`SELECT * FROM wip_entries WHERE team IS NOT NULL`).catch(() => ({ rows: [] as any[] }))).rows
    .map((w: any) => ({ id: w.id, team: w.team, deal_id: w.deal_id ?? null, property_id: w.property_id ?? null, agent: w.agent ?? null, agent_user_id: w.agent_user_id ?? null }));
  return { users, deals, properties, wip };
}

export async function previewTeamStructure() {
  return planTeamStructure(await loadInput());
}

export async function applyTeamStructure(opts: { force?: boolean } = {}): Promise<{ skipped?: true; users: number; properties: number; deals: number; wip: number }> {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS active_team TEXT`).catch(() => {});
  const done = (await pool.query(`SELECT 1 FROM system_settings WHERE key = $1`, [FLAG])).rows.length > 0;
  if (done && !opts.force) return { skipped: true, users: 0, properties: 0, deals: 0, wip: 0 };
  const plan = planTeamStructure(await loadInput());
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TABLE IF NOT EXISTS team_structure_backup_2026_10 (
      kind TEXT NOT NULL, row_id TEXT NOT NULL, old_value JSONB, new_value JSONB, basis TEXT, backed_up_at TIMESTAMP DEFAULT NOW())`);
    for (const c of plan.userChanges) {
      await client.query(`INSERT INTO team_structure_backup_2026_10 (kind, row_id, old_value, new_value) VALUES ('user', $1, $2, $3)`, [c.id, JSON.stringify(c.from), JSON.stringify(c.to)]);
      await client.query(`UPDATE users SET team = $2, additional_teams = $3, active_team = $4, is_active = $5, role = $6, manager_id = $7 WHERE id = $1`,
        [c.id, c.to.team, c.to.additional_teams, c.to.active_team, c.to.is_active, c.to.role, c.to.manager_id]);
      // The HR org chart reads title / reporting line from staff_profiles.
      if (c.to.manager_id !== c.from.manager_id || c.to.role !== c.from.role) {
        await client.query(
          `INSERT INTO staff_profiles (user_id, title, manager_id, status) VALUES ($1, $2, $3, 'active')
           ON CONFLICT (user_id) DO UPDATE SET title = EXCLUDED.title, manager_id = EXCLUDED.manager_id`, [c.id, c.to.role, c.to.manager_id]);
      }
    }
    for (const c of plan.propChanges) {
      await client.query(`INSERT INTO team_structure_backup_2026_10 (kind, row_id, old_value, new_value, basis) VALUES ('property', $1, $2, $3, $4)`, [c.id, JSON.stringify(c.from), JSON.stringify(c.to), c.basis]);
      await client.query(`UPDATE crm_properties SET bgp_engagement = $2 WHERE id = $1`, [c.id, c.to]);
    }
    for (const c of plan.dealChanges) {
      await client.query(`INSERT INTO team_structure_backup_2026_10 (kind, row_id, old_value, new_value) VALUES ('deal', $1, $2, $3)`, [c.id, JSON.stringify(c.from), JSON.stringify(c.to)]);
      await client.query(`UPDATE crm_deals SET team = $2 WHERE id = $1`, [c.id, c.to]);
    }
    for (const c of plan.wipChanges) {
      await client.query(`INSERT INTO team_structure_backup_2026_10 (kind, row_id, old_value, new_value) VALUES ('wip', $1, $2, $3)`, [c.id, JSON.stringify(c.from), JSON.stringify(c.to)]);
      await client.query(`UPDATE wip_entries SET team = $2 WHERE id = $1`, [c.id, c.to]);
    }
    await client.query(`INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [FLAG, JSON.stringify({ at: new Date().toISOString(), users: plan.userChanges.length, properties: plan.propChanges.length, deals: plan.dealChanges.length, wip: plan.wipChanges.length })]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
  console.log(`[team-structure] applied: ${plan.userChanges.length} users, ${plan.propChanges.length} properties, ${plan.dealChanges.length} deals, ${plan.wipChanges.length} WIP rows`);
  return { users: plan.userChanges.length, properties: plan.propChanges.length, deals: plan.dealChanges.length, wip: plan.wipChanges.length };
}
