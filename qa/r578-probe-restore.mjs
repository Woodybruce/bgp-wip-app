// r578: undo r578-probe-setup.mjs.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const DEAL = 'dddd5578-0000-0000-0000-000000000578';
await pool.query(`DELETE FROM deal_fee_allocations WHERE deal_id = $1`, [DEAL]);
await pool.query(`DELETE FROM crm_deals WHERE id = $1`, [DEAL]);
const { rows } = await pool.query(`SELECT count(*)::int n FROM crm_deals WHERE id = $1`, [DEAL]);
console.log('probe rows left:', rows[0].n);
await pool.end();
