import pg from '/home/user/bgp-wip-app/node_modules/pg/lib/index.js';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const r = await c.query(`UPDATE crm_deals SET status = $1 WHERE name = 'QA-R579 PROBE review fee' RETURNING id, status`, [process.argv[2]]);
console.log('[r579-probe] status ->', r.rows[0]?.status);
await c.end();
