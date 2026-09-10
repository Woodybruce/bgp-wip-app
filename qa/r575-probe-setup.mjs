// r575 probe: move BOTH Bluewater board deals to HOTs (heads of terms) and
// see what the property page's DealsSummary card says. Restore with
// qa/r575-probe-restore.mjs.
import pg from 'pg';
const c=new pg.Client({connectionString:'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke'});
await c.connect();
const ids=['11110000-0000-0000-0000-000000000302','11110000-0000-0000-0000-000000000303'];
for(const id of ids){
  const b=(await c.query('SELECT name,status FROM crm_deals WHERE id=$1',[id])).rows[0];
  console.log('before:',b.name,b.status);
}
await c.query(`UPDATE crm_deals SET status='HOT' WHERE id = ANY($1)`,[ids]);
console.log('both set HOT');
await c.end();
