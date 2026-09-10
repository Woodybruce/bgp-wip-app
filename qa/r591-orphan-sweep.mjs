// r591: remove leasing_schedule_units rows whose property no longer exists
// (stranded by DELETE /api/crm/properties — see the r591 log entry).
import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const r = await c.query(`delete from leasing_schedule_units x where x.property_id is not null and not exists (select 1 from crm_properties p where p.id = x.property_id::varchar) returning id`);
console.log(`leasing_schedule_units orphans removed: ${r.rows.length}`);
const n = await c.query('select count(*) from leasing_schedule_units');
console.log(`leasing_schedule_units now ${n.rows[0].count}`);
await c.end();
