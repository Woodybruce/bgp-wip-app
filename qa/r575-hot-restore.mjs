import pg from 'pg';
const c=new pg.Client({connectionString:'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke'});
await c.connect();
await c.query(`UPDATE crm_deals SET status='SOL', fee=NULL WHERE id='11110000-0000-0000-0000-000000000302'`);
console.table((await c.query(`SELECT name,status,fee FROM crm_deals WHERE id='11110000-0000-0000-0000-000000000302'`)).rows);
await c.end();
