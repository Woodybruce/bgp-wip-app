import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const r = await c.query(`select name, sqft from crm_properties where id='cccccccc-0000-0000-0000-000000000001'`).catch(e=>({rows:[{err:String(e.message)}]}));
console.log(r.rows);
await c.end();
