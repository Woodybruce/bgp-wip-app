// Synthetic local browser fixture for choosing between duplicate tenancy rows.
import assert from 'node:assert/strict';
import pg from 'pg';
import sharp from 'sharp';
const supplied = process.env.EVIDENCE_SMOKE_DATABASE_URL;
const url = new URL(supplied || 'file:///');
if (url.hostname || url.pathname !== '/bgp_smoke' || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) throw new Error('Disposable local smoke database required');
const id = n => `ecd09088-0908-4000-8000-${String(n).padStart(12,'0')}`;
const PLAN=id(1),LEVEL=id(2),PROPERTY=id(3),UNIT=id(4),ROW1=id(5),ROW2=id(6),ENTRY=id(7);
const FILE=`qa/evidence-plan-${PLAN}/schedule.png`;
const db = new pg.Client({connectionString:supplied,ssl:false});
await db.connect();
try {
  await db.query('BEGIN');
  const existing=(await db.query('SELECT name FROM evidence_plans WHERE id=$1',[PLAN])).rows[0];
  if (existing) assert.equal(existing.name,'QA duplicate schedule review');
  if (process.argv.includes('--cleanup')) {
    for(const table of ['evidence_plan_entries','evidence_plan_units','evidence_plan_jobs','evidence_plan_levels']) await db.query(`DELETE FROM ${table} WHERE plan_id=$1`,[PLAN]);
    await db.query('DELETE FROM evidence_plans WHERE id=$1',[PLAN]);
    await db.query('DELETE FROM tenancy_schedule_units WHERE property_id=$1',[PROPERTY]);
    await db.query('DELETE FROM crm_properties WHERE id=$1',[PROPERTY]);
    await db.query('DELETE FROM file_storage WHERE storage_key=$1',[FILE]);
  } else {
    assert.equal(existing,undefined,'Fixture already exists; clean it up first');
    const polygon=[{x:.15,y:.2},{x:.65,y:.2},{x:.65,y:.8},{x:.15,y:.8}];
    const png=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect width="1000" height="700" fill="white"/><text x="50" y="55" font-size="25">Synthetic plan — duplicate tenancy review</text><rect x="150" y="140" width="500" height="420" fill="#7cbebb" stroke="#333" stroke-width="3"/><text x="340" y="340" font-size="42">D1</text></svg>')).png().toBuffer();
    await db.query('INSERT INTO crm_properties(id,name) VALUES ($1,$2)',[PROPERTY,'QA schedule property']);
    await db.query('INSERT INTO file_storage(storage_key,data,content_type,original_name,size) VALUES ($1,$2,$3,$4,$5)',[FILE,png,'image/png','schedule.png',png.length]);
    await db.query('INSERT INTO evidence_plans(id,name,property_id,background_key,background_width,background_height) VALUES ($1,$2,$3,$4,1000,700)',[PLAN,'QA duplicate schedule review',PROPERTY,FILE]);
    await db.query('INSERT INTO evidence_plan_levels(id,plan_id,name,background_key,background_width,background_height) VALUES ($1,$2,$3,$4,1000,700)',[LEVEL,PLAN,'Ground floor',FILE]);
    await db.query("INSERT INTO evidence_plan_units(id,plan_id,level_id,unit_ref,tenant_name,polygon,dot,source,notes) VALUES ($1,$2,$3,'D1','QA Tea Shop',$4,$5,'manual','Keep the original unit note')",[UNIT,PLAN,LEVEL,JSON.stringify(polygon),JSON.stringify({x:.4,y:.5})]);
    for(const [row,rent,expiry] of [[ROW1,120000,'2031-01-01'],[ROW2,150000,'2032-01-01']]) await db.query("INSERT INTO tenancy_schedule_units(id,property_id,unit_number,trading_name,tenant_name,floor_level,passing_rent_pa,lease_expiry,nia_sqft) VALUES ($1,$2,'D1','QA Tea Shop','QA Tea Legal Limited','Ground',$3,$4,1000)",[row,PROPERTY,rent,expiry]);
    await db.query("INSERT INTO evidence_plan_entries(id,plan_id,unit_id,unit_ref,tenant,transaction_type,zone_a,notes) VALUES ($1,$2,$3,'D1','QA Tea Shop','OML',220,'Preserve original evidence')",[ENTRY,PLAN,UNIT]);
  }
  await db.query('COMMIT');
  console.log(JSON.stringify({planId:PLAN,propertyId:PROPERTY,unitId:UNIT,rows:[ROW1,ROW2],path:`/evidence-plans/${PLAN}`,cleanup:process.argv.includes('--cleanup')}));
} catch(error) { await db.query('ROLLBACK'); throw error; } finally { await db.end(); }
