// r591: the full leak teardown — the auto-created backing DEALS are what a
// boot hook re-materialises tracker listings from, so they have to go too.
import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const like = `(name like '%QA-R58%' or name like '%QA-HOTS%' or name like '%QA-BIGNUM%' or name like '%QA-R591%')`;
const d = await c.query(`delete from crm_deals where ${like} returning name`);
console.log(`crm_deals removed ${d.rows.length}: ${d.rows.map(r=>r.name).join(' | ')}`);
for (const t of ['available_units','leasing_schedule_units']) {
  const r = await c.query(`delete from ${t} where unit_name like '%QA-R58%' or unit_name like '%QA-HOTS%' or unit_name like '%QA-BIGNUM%' or unit_name like '%QA-R591%' returning unit_name`);
  console.log(`${t}: removed ${r.rows.length}`);
}
const n = await c.query(`select (select count(*)::int from available_units) au, (select count(*)::int from leasing_schedule_units) ls, (select count(*)::int from crm_deals) deals`);
console.log(n.rows[0]);
await c.end();
