import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const P='cccccccc-0000-0000-0000-000000000001';
for (const [t,q] of [
 ['available_units on Bluewater by status', `select marketing_status, count(*) from available_units where property_id=$1 group by 1 order by 2 desc`],
 ['available_units GLOBAL by status', `select marketing_status, count(*) from available_units group by 1 order by 2 desc`],
 ['leasing_schedule_units on Bluewater', `select status, count(*) from leasing_schedule_units where property_id=$1 group by 1 order by 2 desc`],
 ['tenancy_schedule_units on Bluewater', `select status, count(*) from tenancy_schedule_units where property_id=$1 group by 1 order by 2 desc`],
]) { const r = await c.query(q,[P]).catch(e=>({rows:[{err:e.message}]})); console.log('##',t); console.table(r.rows); }
await c.end();
