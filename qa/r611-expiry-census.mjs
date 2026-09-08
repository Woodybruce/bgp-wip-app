import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const q = async (sql) => (await pool.query(sql)).rows;

console.log('-- server rule (lease_expiry < NOW()+12mo) vs client rule (future & <=12mo), per property --');
console.log(await q(`
  SELECT p.name,
    COUNT(CASE WHEN u.lease_expiry IS NOT NULL AND u.lease_expiry < NOW() + INTERVAL '12 months' AND COALESCE(u.status,'') <> 'Archived' THEN 1 END)::int AS server_expiring_soon,
    COUNT(CASE WHEN u.lease_expiry IS NOT NULL AND u.lease_expiry > NOW() AND u.lease_expiry < NOW() + INTERVAL '12 months' AND COALESCE(u.status,'') <> 'Archived' THEN 1 END)::int AS client_expiring_soon,
    COUNT(CASE WHEN u.lease_expiry IS NOT NULL AND u.lease_expiry <= NOW() AND COALESCE(u.status,'') <> 'Archived' THEN 1 END)::int AS already_expired
  FROM crm_properties p JOIN leasing_schedule_units u ON u.property_id = p.id
  GROUP BY p.id, p.name HAVING COUNT(CASE WHEN u.lease_expiry IS NOT NULL AND u.lease_expiry < NOW() + INTERVAL '12 months' AND COALESCE(u.status,'') <> 'Archived' THEN 1 END) > 0
  ORDER BY 2 DESC LIMIT 15`));

console.log('-- totals --');
console.log(await q(`
  SELECT COUNT(*) FILTER (WHERE lease_expiry IS NOT NULL AND lease_expiry < NOW() + INTERVAL '12 months' AND COALESCE(status,'') <> 'Archived') AS server_rule,
         COUNT(*) FILTER (WHERE lease_expiry IS NOT NULL AND lease_expiry > NOW() AND lease_expiry < NOW() + INTERVAL '12 months' AND COALESCE(status,'') <> 'Archived') AS client_rule,
         COUNT(*) FILTER (WHERE lease_expiry IS NOT NULL AND lease_expiry <= NOW() AND COALESCE(status,'') <> 'Archived') AS expired_counted_as_expiring,
         MIN(lease_expiry) AS oldest_expiry
  FROM leasing_schedule_units`));
await pool.end();
