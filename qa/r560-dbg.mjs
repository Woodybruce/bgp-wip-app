import pg from '../node_modules/pg/lib/index.js';
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const a = await pool.query(`SELECT marketing_status, count(*) FROM available_units GROUP BY 1`);
console.log('marketing_status:', a.rows);
const b = await pool.query(`SELECT DISTINCT au.property_id, p.name, p.status FROM available_units au LEFT JOIN crm_properties p ON p.id=au.property_id`);
console.log('props with units:', b.rows);
const c = await pool.query(`SELECT id, name, status FROM crm_properties`);
console.log('all props:', c.rows);
await pool.end();
