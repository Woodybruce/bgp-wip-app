import pg from 'pg';
const c=new pg.Client({connectionString:'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke'});
await c.connect();
await c.query(`UPDATE crm_deals SET status='SOL' WHERE id='11110000-0000-0000-0000-000000000302'`);
await c.query(`UPDATE crm_deals SET status='EXC' WHERE id='11110000-0000-0000-0000-000000000303'`);
const r=await c.query(`SELECT id,name,status FROM crm_deals WHERE id IN ('11110000-0000-0000-0000-000000000302','11110000-0000-0000-0000-000000000303')`);
console.table(r.rows.map(x=>({name:x.name.slice(0,30),status:x.status})));
await c.end();
