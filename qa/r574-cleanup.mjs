import pg from 'pg';
const c=new pg.Client({connectionString:'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke'});
await c.connect();
const r=await c.query(`DELETE FROM available_units WHERE unit_name LIKE 'QA-HOTS%' RETURNING unit_name`);
console.log('deleted probe units:',r.rows.map(x=>x.unit_name).join(',')||'(none)');
console.log('HOT units left:',(await c.query(`SELECT unit_name FROM available_units WHERE marketing_status='HOT'`)).rows.map(x=>x.unit_name));
console.log('deal 302 status:',(await c.query(`SELECT status FROM crm_deals WHERE id='11110000-0000-0000-0000-000000000302'`)).rows);
await c.end();
