// r574 probe: move one live Bluewater deal to HOTs (heads of terms) — the
// stage a landlord cares most about — and see whether the client dashboard
// board still shows it. Restore with qa/r574-probe-restore.mjs.
import pg from 'pg';
const c=new pg.Client({connectionString:'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke'});
await c.connect();
const id='11110000-0000-0000-0000-000000000302'; // U124 Bluewater — Gail's letting
const before=(await c.query('SELECT status FROM crm_deals WHERE id=$1',[id])).rows[0];
console.log('before status:',before.status);
await c.query(`UPDATE crm_deals SET status='HOT' WHERE id=$1`,[id]);
console.log('set HOT');
await c.end();
