import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const props = (await pool.query(`SELECT p.id, p.name, count(u.id)::int n FROM crm_properties p JOIN leasing_schedule_units u ON u.property_id=p.id GROUP BY p.id,p.name ORDER BY n DESC LIMIT 5`)).rows;
console.log('leasing board properties:', props);
const target = props[0];
// 3 units expiring in the future (<=12mo), 4 units whose lease EXPIRED long ago.
const ids = (await pool.query(`SELECT id FROM leasing_schedule_units WHERE property_id=$1 AND COALESCE(status,'')<>'Archived' ORDER BY unit_name LIMIT 7`, [target.id])).rows.map(r=>r.id);
await pool.query(`UPDATE leasing_schedule_units SET lease_expiry = NOW() + INTERVAL '4 months' WHERE id = ANY($1)`, [ids.slice(0,3)]);
await pool.query(`UPDATE leasing_schedule_units SET lease_expiry = NOW() - INTERVAL '30 months' WHERE id = ANY($1)`, [ids.slice(3,7)]);
console.log('seeded on', target.name, '— 3 future (<=12mo), 4 long-expired');
console.log('server rule says:', (await pool.query(`SELECT COUNT(CASE WHEN u.lease_expiry IS NOT NULL AND u.lease_expiry < NOW() + INTERVAL '12 months' AND COALESCE(u.status,'')<>'Archived' THEN 1 END)::int n FROM leasing_schedule_units u WHERE u.property_id=$1`,[target.id])).rows[0].n);
console.log('truth (future, <=12mo):', (await pool.query(`SELECT COUNT(*)::int n FROM leasing_schedule_units u WHERE u.property_id=$1 AND u.lease_expiry > NOW() AND u.lease_expiry < NOW()+INTERVAL '12 months' AND COALESCE(u.status,'')<>'Archived'`,[target.id])).rows[0].n);
await pool.end();
