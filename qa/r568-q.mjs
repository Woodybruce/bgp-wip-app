import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const r = await c.query(`select id, unit_number, status, erv_pa from tenancy_schedule_units
 where property_id='cccccccc-0000-0000-0000-000000000001' and status='Vacant' and erv_pa is not null
 order by erv_pa desc limit 3`).catch(e=>({rows:[{err:String(e.message)}]}));
console.log(r.rows);
await c.end();
