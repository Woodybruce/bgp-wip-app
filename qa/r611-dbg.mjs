import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg; const pool = new Pool({ connectionString:'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const r = await pool.query(`SELECT u.unit_number, u.lease_expiry, p.name FROM tenancy_schedule_units u JOIN crm_properties p ON p.id=u.property_id WHERE u.lease_expiry > NOW() AND u.lease_expiry <= NOW()+INTERVAL '6 months' ORDER BY u.lease_expiry`);
console.log(r.rows);
console.log('now:', new Date().toISOString());
await pool.end();
