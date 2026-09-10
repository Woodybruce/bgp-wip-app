import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const r = await pool.query(`UPDATE leasing_schedule_units SET lease_expiry = NULL WHERE lease_expiry IS NOT NULL`);
console.log('cleared seeded lease_expiry on', r.rowCount, 'leasing_schedule_units rows');
console.log('remaining with expiry:', (await pool.query('select count(lease_expiry)::int n from leasing_schedule_units')).rows[0].n);
await pool.end();
