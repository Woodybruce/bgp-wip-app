// r577: undo r577-probe-setup.mjs — back to the shipped fixture values.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ids = [
  '11110000-0000-0000-0000-000000000301',
  '65fb328e-d101-4df6-8fe0-34d9fc6f210e',
  '616296ba-b0a2-4269-af16-8076b736e87a',
];
await pool.query(
  `UPDATE crm_deals SET fee=NULL, internal_agent=ARRAY[]::text[], target_date=NULL WHERE id = ANY($1)`, [ids]);
const { rows } = await pool.query(
  `SELECT status, name, fee, internal_agent, target_date FROM crm_deals WHERE id = ANY($1) ORDER BY status`, [ids]);
console.table(rows);
await pool.end();
