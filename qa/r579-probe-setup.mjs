// r579 probe: one fee-allocated deal for Victoria Broadhead so the staff
// review's "Sync from WIP" has something to bucket. Deal starts at NEG.
import pg from '/home/user/bgp-wip-app/node_modules/pg/lib/index.js';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const status = process.argv[2] || 'NEG';
await c.query(`DELETE FROM deal_fee_allocations WHERE agent_name = 'Victoria Broadhead' AND deal_id IN (SELECT id FROM crm_deals WHERE name = 'QA-R579 PROBE review fee')`);
await c.query(`DELETE FROM crm_deals WHERE name = 'QA-R579 PROBE review fee'`);
const d = await c.query(
  `INSERT INTO crm_deals (name, status, fee, deal_type) VALUES ('QA-R579 PROBE review fee', $1, 120000, 'letting') RETURNING id`,
  [status]);
await c.query(
  `INSERT INTO deal_fee_allocations (deal_id, agent_name, allocation_type, percentage) VALUES ($1, 'Victoria Broadhead', 'percentage', 100)`,
  [d.rows[0].id]);
console.log(`[r579-probe] deal ${d.rows[0].id} at ${status}, fee £120,000, 100% to Victoria Broadhead`);
await c.end();
