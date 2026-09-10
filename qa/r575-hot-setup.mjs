// r575 probe: park one Bluewater deal at HOTs with a £50,000 fee and see
// whether the firm's ski-target WIP counts it. Restore with
// qa/r575-hot-restore.mjs (status SOL, fee NULL).
import pg from 'pg';
const c=new pg.Client({connectionString:'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke'});
await c.connect();
const id='11110000-0000-0000-0000-000000000302';
const b=(await c.query('SELECT name,status,fee FROM crm_deals WHERE id=$1',[id])).rows[0];
console.log('before:',b.name,b.status,'fee',b.fee);
await c.query(`UPDATE crm_deals SET status='HOT', fee=50000 WHERE id=$1`,[id]);
const a=(await c.query('SELECT status,fee FROM crm_deals WHERE id=$1',[id])).rows[0];
console.log('after:',a.status,'fee',a.fee);
await c.end();
