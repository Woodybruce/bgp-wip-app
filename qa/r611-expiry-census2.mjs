import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const q = async (sql,p) => (await pool.query(sql,p)).rows;
console.log('leasing_schedule_units total:', (await q('select count(*)::int n, count(lease_expiry)::int with_expiry from leasing_schedule_units'))[0]);
console.log('tenancy_schedule_units:', (await q('select count(*)::int n, count(lease_expiry)::int with_expiry, min(lease_expiry) oldest, max(lease_expiry) newest from tenancy_schedule_units'))[0]);
console.log('tenancy expiry buckets:', (await q(`select count(*) filter (where lease_expiry <= now()) expired, count(*) filter (where lease_expiry > now() and lease_expiry < now()+interval '12 months') next12, count(*) filter (where lease_expiry > now() and lease_expiry < now()+interval '6 months') next6 from tenancy_schedule_units`))[0]);
await pool.end();
