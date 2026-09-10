// r581: park two fee-bearing deals on Victoria's own HR profile — one at NEG,
// one at HOT — so the "Working on right now" card renders both side by side.
// HOT was in neither the card's stage-label map nor its colour map, and the
// server's ORDER BY ranked it below Speculative. Undo with r581-probe-restore.mjs.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows: u } = await pool.query(
  `SELECT id, name FROM users WHERE email = 'victoria@brucegillinghampollard.com'`);
if (!u[0]) throw new Error('victoria not found');
const agent = u[0];
const mk = async (id, name, status) => {
  await pool.query(`DELETE FROM crm_deals WHERE id = $1`, [id]);
  await pool.query(
    `INSERT INTO crm_deals (id, name, status, fee, target_date, deal_type,
                            internal_agent, internal_agent_ids)
     VALUES ($1, $2, $3, 90000, '2026-11-03', 'New Letting', ARRAY[$4]::text[], ARRAY[$5]::varchar[])`,
    [id, name, status, agent.name, agent.id]);
};
await mk('dddd5581-0000-0000-0000-0000000001', 'R581 probe — negotiating unit', 'NEG');
await mk('dddd5581-0000-0000-0000-0000000002', 'R581 probe — heads of terms unit', 'HOT');
const { rows } = await pool.query(
  `SELECT id, name, status, fee FROM crm_deals WHERE id LIKE 'dddd5581%' ORDER BY name`);
console.table(rows);
console.log('agent', agent.id, agent.name);
await pool.end();
