// r578: park one fee-allocated deal on Victoria so her own commission card
// has a number, then step it NEG -> HOT. Undo with r578-probe-restore.mjs.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const STATUS = process.argv[2] || 'NEG';
const DEAL = 'dddd5578-0000-0000-0000-0000000005';
const { rows: [u] } = await pool.query(
  `SELECT id, name FROM users WHERE email = 'victoria@brucegillinghampollard.com'`);
if (!u) { console.log('no victoria'); process.exit(2); }
await pool.query(`DELETE FROM deal_fee_allocations WHERE deal_id = $1`, [DEAL + '78']);
await pool.query(`DELETE FROM crm_deals WHERE id = $1`, [DEAL + '78']);
await pool.query(
  `INSERT INTO crm_deals (id, name, status, fee, target_date, deal_type, internal_agent)
   VALUES ($1, 'R578 commission probe', $2, 80000, '2026-11-01', 'New Letting', ARRAY[$3]::text[])`,
  [DEAL + '78', STATUS, u.name]);
await pool.query(
  `INSERT INTO deal_fee_allocations (deal_id, agent_user_id, agent_name, allocation_type, percentage, is_bgp_house)
   VALUES ($1, $2, $3, 'percentage', 100, false)`, [DEAL + '78', u.id, u.name]);
const { rows } = await pool.query(
  `SELECT d.status, d.name, d.fee, a.percentage, a.agent_name
   FROM crm_deals d JOIN deal_fee_allocations a ON a.deal_id = d.id WHERE d.id = $1`, [DEAL + '78']);
console.table(rows);
await pool.end();
