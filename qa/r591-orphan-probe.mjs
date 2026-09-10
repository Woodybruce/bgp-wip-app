import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const t = await c.query(`select table_name from information_schema.columns where column_name='property_id' and table_schema='public' order by 1`);
const rows=[];
for (const {table_name:tn} of t.rows) {
  const r = await c.query(`select count(*)::int n from ${tn} x where x.property_id is not null and not exists (select 1 from crm_properties p where p.id = x.property_id::varchar)`).catch(e=>null);
  if (r && r.rows[0].n>0) rows.push({table:tn, orphans:r.rows[0].n});
}
console.table(rows);
await c.end();
