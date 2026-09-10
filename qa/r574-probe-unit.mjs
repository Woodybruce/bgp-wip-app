// r574 probe 2: put one Bluewater unit at HOTs (heads of terms) — the stage
// just before signature — and watch the client's Properties & Deals board.
import pg from 'pg';
const c=new pg.Client({connectionString:'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke'});
await c.connect();
const mode=process.argv[2]||'set';
const { rows:cols } = await c.query(`SELECT table_name, column_name FROM information_schema.columns WHERE column_name IN ('marketing_status') ORDER BY table_name`);
console.log('marketing_status lives in:',cols.map(r=>r.table_name).join(','));
const t=cols[0].table_name;
const { rows } = await c.query(`SELECT id, unit_name, marketing_status FROM ${t} WHERE marketing_status='AVA' AND property_id='cccccccc-0000-0000-0000-000000000001' ORDER BY unit_name LIMIT 1`);
if(mode==='set'){
  const target=rows[0]||null;
  if(!target){console.log('no AVA unit'); process.exit(0);}
  await c.query(`UPDATE ${t} SET marketing_status='HOT' WHERE id=$1`,[target.id]);
  console.log('set HOT on',target.unit_name,target.id);
} else {
  const r=await c.query(`UPDATE ${t} SET marketing_status='AVA' WHERE marketing_status='HOT' RETURNING id, unit_name`);
  console.log('restored',r.rowCount,'unit(s):',r.rows.map(x=>x.unit_name).join(','));
}
await c.end();
