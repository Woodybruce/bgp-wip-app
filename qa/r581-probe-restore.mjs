// r581: remove the two probe deals and confirm the fixture is back to shipped state.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`DELETE FROM deal_fee_allocations WHERE deal_id LIKE 'dddd5581%'`);
await pool.query(`DELETE FROM crm_deals WHERE id LIKE 'dddd5581%' OR name LIKE 'R581%'`);
const { rows } = await pool.query(
  `SELECT count(*)::int AS left FROM crm_deals WHERE id LIKE 'dddd5581%' OR name LIKE 'R581%'`);
console.log('R581 rows left:', rows[0].left);
await pool.end();
