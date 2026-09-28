// One BGP team per account (Woody, 2026-09-28: "add teams still not talking
// to the rest of the app"). The header chips keep crm_companies
// .bgp_contact_user_ids; the BGP Team board keeps crm_client_team_members.
// Every write to one now mirrors into the other, and a one-time pass unions
// what each already held.
import { pool } from "./db";

type Db = { query: (sql: string, params?: any[]) => Promise<any> };

const KEY = "migration:bgp_team_union_v1";

// Chips edited: new people join the board, removed people leave it.
export async function coverersChanged(companyId: string, before: string[], after: string[], db: Db = pool): Promise<void> {
  const added = after.filter(id => !before.includes(id));
  const removed = before.filter(id => !after.includes(id));
  for (const userId of added) {
    await db.query(
      `INSERT INTO crm_client_team_members (client_company_id, user_id, team_group)
       SELECT $1::varchar, $2::varchar, NULL
        WHERE NOT EXISTS (SELECT 1 FROM crm_client_team_members WHERE client_company_id = $1::varchar AND user_id = $2::varchar)`,
      [companyId, userId]);
  }
  if (removed.length) {
    await db.query(`DELETE FROM crm_client_team_members WHERE client_company_id = $1::varchar AND user_id = ANY($2::varchar[])`, [companyId, removed]);
  }
}

// Added on the board: they cover the account in the chips too.
export async function teamMemberAdded(companyId: string, userId: string, db: Db = pool): Promise<void> {
  await db.query(
    `UPDATE crm_companies
        SET bgp_contact_user_ids = COALESCE(bgp_contact_user_ids, '{}'::text[]) || $2::text
      WHERE id = $1::varchar AND NOT ($2::text = ANY(COALESCE(bgp_contact_user_ids, '{}'::text[])))`,
    [companyId, userId]);
}

// Removed from the board: once they hold no slot on it, drop them from the chips.
export async function teamMemberRemoved(companyId: string, userId: string, db: Db = pool): Promise<void> {
  await db.query(
    `UPDATE crm_companies
        SET bgp_contact_user_ids = NULLIF(array_remove(bgp_contact_user_ids, $2::text), '{}'::text[])
      WHERE id = $1::varchar
        AND NOT EXISTS (SELECT 1 FROM crm_client_team_members WHERE client_company_id = $1::varchar AND user_id = $2::text)`,
    [companyId, userId]);
}

export async function runBgpTeamUnion(db: Db = pool): Promise<void> {
  if ((await db.query(`SELECT 1 FROM system_settings WHERE key = $1`, [KEY])).rows.length) return;
  const toBoard = await db.query(
    `INSERT INTO crm_client_team_members (client_company_id, user_id, team_group)
     SELECT DISTINCT c.id, m.user_id, NULL
       FROM crm_companies c
       CROSS JOIN LATERAL unnest(c.bgp_contact_user_ids) AS m(user_id)
       JOIN users u ON u.id = m.user_id
      WHERE c.merged_into_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM crm_client_team_members t WHERE t.client_company_id = c.id AND t.user_id = m.user_id)`);
  const toChips = await db.query(
    `UPDATE crm_companies c
        SET bgp_contact_user_ids = ARRAY(
              SELECT DISTINCT x FROM unnest(COALESCE(c.bgp_contact_user_ids, '{}'::text[]) || t.ids) AS x)
       FROM (SELECT client_company_id, array_agg(DISTINCT user_id::text) AS ids
               FROM crm_client_team_members GROUP BY client_company_id) t
      WHERE t.client_company_id = c.id
        AND NOT (t.ids <@ COALESCE(c.bgp_contact_user_ids, '{}'::text[]))`);
  const counts = { addedToBoard: toBoard.rowCount || 0, companiesUpdated: toChips.rowCount || 0 };
  console.log(`[bgp-team-union] ${JSON.stringify(counts)}`);
  await db.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
    [KEY, JSON.stringify({ ...counts, at: new Date().toISOString() })]);
}
