import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const like = process.argv[2] || 'QA-R588%';
const u = await c.query(`select id, unit_name, deal_id, marketing_status from available_units where unit_name like $1 or unit_name like 'ANC1 Bluewater%'`, [like]);
console.table(u.rows);
const ids = u.rows.map(r=>r.id);
const dids = u.rows.map(r=>r.deal_id).filter(Boolean);
if (ids.length) {
  for (const t of ['unit_marketing_files','unit_viewings','unit_offers']) await c.query(`delete from ${t} where unit_id = any($1)`, [ids]).catch(()=>{});
  await c.query(`update tenancy_schedule_units set letting_tracker_unit_id=null where letting_tracker_unit_id = any($1)`, [ids]).catch(()=>{});
  await c.query(`delete from available_units where id = any($1)`, [ids]);
}
if (dids.length) { await c.query(`delete from deal_fee_allocations where deal_id = any($1)`, [dids]).catch(()=>{}); await c.query(`delete from crm_deals where id = any($1)`, [dids]).catch(()=>{}); }
console.log(`cleanup: removed ${ids.length} unit(s), ${dids.length} deal(s)`);
await c.end();
