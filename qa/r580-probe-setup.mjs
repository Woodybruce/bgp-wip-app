// r580: park one dated, fee-bearing deal in the firm's forward book, then
// step it NEG -> HOT. The firm's cashflow projection and the equity WIP
// forecast both weight NEG/SOL/EXC only, so a deal moving FORWARD out of
// Negotiating fell out of both. Undo with r580-probe-restore.mjs.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const STATUS = process.argv[2] || 'NEG';
const DEAL = 'dddd5580-0000-0000-0000-0000000580';
await pool.query(`DELETE FROM deal_fee_allocations WHERE deal_id = $1`, [DEAL]);
await pool.query(`DELETE FROM crm_deals WHERE id = $1`, [DEAL]);
await pool.query(
  `INSERT INTO crm_deals (id, name, status, fee, target_date, deal_type)
   VALUES ($1, 'R580 outlook probe', $2, 200000, '2026-11-03', 'New Letting')`,
  [DEAL, STATUS]);
const { rows } = await pool.query(
  `SELECT id, name, status, fee, target_date FROM crm_deals WHERE id = $1`, [DEAL]);
console.table(rows);
await pool.end();
