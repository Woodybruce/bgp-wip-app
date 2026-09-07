import pg from '/home/user/bgp-wip-app/node_modules/pg/lib/index.js';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
await c.query(`DELETE FROM deal_fee_allocations WHERE deal_id IN (SELECT id FROM crm_deals WHERE name LIKE 'QA-R579%' OR name LIKE '%PROBE%')`);
await c.query(`DELETE FROM crm_deals WHERE name LIKE 'QA-R579%' OR name LIKE '%PROBE%' OR name LIKE 'QA-HOTS%'`);
await c.query(`DELETE FROM staff_reviews WHERE period LIKE '%' AND user_id = (SELECT id FROM users WHERE email='victoria@brucegillinghampollard.com')`);
const n = await c.query(`SELECT (SELECT count(*) FROM crm_deals WHERE name LIKE 'QA-%' OR name LIKE '%PROBE%')::int AS deals, (SELECT count(*) FROM deal_fee_allocations)::int AS allocs, (SELECT count(*) FROM staff_reviews)::int AS reviews`);
console.log('[r579-restore]', n.rows[0]);
await c.end();
