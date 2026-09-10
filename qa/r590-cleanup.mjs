// r590: the r589 leak fix cleans available_units but the two-bot scenario
// staff-unit-writes-canonicalise-status ALSO leaves rows in
// leasing_schedule_units, which inflate the client's tenancy-schedule spine.
import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
for (const t of ['available_units','leasing_schedule_units','tenancy_schedule_units']) {
  const r = await c.query(`delete from ${t} where unit_name like '%QA-R58%' returning unit_name`).catch(e=>({rows:[],err:e.message}));
  console.log(`${t}: removed ${r.rows.length}${r.err? ' ('+r.err+')':''}`);
}
for (const t of ['available_units','leasing_schedule_units']) {
  const r = await c.query(`select count(*) from ${t}`);
  console.log(`${t} now ${r.rows[0].count}`);
}
await c.end();
