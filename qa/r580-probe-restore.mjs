// r580: remove the forward-book probe deal, back to the shipped fixture.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const DEAL = 'dddd5580-0000-0000-0000-0000000580';
await pool.query(`DELETE FROM deal_fee_allocations WHERE deal_id = $1`, [DEAL]);
const r = await pool.query(`DELETE FROM crm_deals WHERE id = $1`, [DEAL]);
console.log('removed', r.rowCount, 'probe deal(s)');
const { rows } = await pool.query(`SELECT count(*)::int AS n FROM crm_deals WHERE name LIKE 'R580%'`);
console.log('remaining R580 rows:', rows[0].n);
await pool.end();
