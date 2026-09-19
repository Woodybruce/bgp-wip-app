// Atomic manual merges in an isolated schema of a named disposable local DB.
// TENANCY_MERGE_DATABASE_URL='postgresql:///bgp_smoke?host=/tmp/bgp-propertyqa-20260916/socket&port=55446&user=postgres' node --import tsx qa/regression/tenancy-merge-postgres.mjs
import assert from 'node:assert/strict';
import pg from 'pg';
import { mergeTenancyUnits } from '../../server/tenancy-merge.ts';
const supplied=process.env.TENANCY_MERGE_DATABASE_URL;
if(!supplied)throw Error('Provide TENANCY_MERGE_DATABASE_URL for the disposable database');
const url=new URL(supplied);
if(url.hostname || !['/bgp_smoke','/bgp_crm_directory_regression'].includes(url.pathname) || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host')||''))throw Error('Refusing non-disposable database');
const schema=`qa_tenancy_merge_${process.pid}_${Date.now()}`;
const db=new pg.Pool({connectionString:supplied,ssl:false,max:4,options:`-c search_path=${schema}`});
const tables=['crm_properties','tenancy_schedule_units','leasing_schedule_units','available_units','crm_deals','evidence_plan_units','property_plan_units','evidence_plan_entries','future_soft_links','alternate_fk','composite_fk'];
const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows])));
let checks=0;
async function seed(){
  await db.query(`TRUNCATE ${tables.join(',')} CASCADE`);
  await db.query(`INSERT INTO crm_properties VALUES ('property'),('other');
    INSERT INTO tenancy_schedule_units(id,property_id,unit_number,tenant_name,tenant_company_id,floor_level,passing_rent_pa,lease_expiry,premises,comments) VALUES
      ('primary','property','F1','Synthetic shop','brand','Lower',120000,'2031-01-01','premises-1','Keep the clause'),
      ('secondary','property','Unit F01','Synthetic shop','brand','Lower',120000,'2031-01-01','premises-1','Keep the clause'),
      ('unrelated','other','F1','Synthetic shop','brand','Lower',120000,'2031-01-01','premises-1','Keep the clause');`);
  for(const table of ['leasing_schedule_units','available_units','crm_deals','evidence_plan_units','property_plan_units','future_soft_links']){
    await db.query(`INSERT INTO ${table}(id,tenancy_unit_id,notes) VALUES ('keep','primary','Primary information'),('move','secondary','Secondary information'),('unrelated','unrelated','Unchanged')`);
  }
  await db.query(`INSERT INTO evidence_plan_entries VALUES ('evidence','move','Keep original evidence');
    INSERT INTO alternate_fk VALUES ('alternate','secondary');
    INSERT INTO composite_fk VALUES ('composite','secondary','property');`);
}
async function check(name,fn){await seed();await fn();checks++;console.log(`PASS ${name}`);}
try{
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`CREATE TABLE crm_properties(id text PRIMARY KEY);
    CREATE TABLE tenancy_schedule_units(id text PRIMARY KEY,property_id text,unit_number text,tenant_name text,tenant_company_id text,floor_level text,
      passing_rent_pa numeric,lease_expiry date,premises text,comments text,custom_overlay text,property_unit_id text,
      marketing_active boolean DEFAULT false,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),sort_order int DEFAULT 0,UNIQUE(id,property_id));
    CREATE TABLE leasing_schedule_units(id text PRIMARY KEY,tenancy_unit_id text,notes text);
    CREATE TABLE available_units(id text PRIMARY KEY,tenancy_unit_id text,notes text);
    CREATE TABLE crm_deals(id text PRIMARY KEY,tenancy_unit_id text,notes text,active boolean DEFAULT false);
    CREATE TABLE evidence_plan_units(id text PRIMARY KEY,tenancy_unit_id text,notes text,polygon jsonb DEFAULT '[{"x":0.1,"y":0.1},{"x":0.4,"y":0.1},{"x":0.4,"y":0.4}]',dot jsonb DEFAULT '{"x":0.2,"y":0.2}');
    CREATE TABLE property_plan_units(id text PRIMARY KEY,tenancy_unit_id text REFERENCES tenancy_schedule_units(id) ON DELETE SET NULL,notes text,polygon jsonb DEFAULT '{"points":[[0.1,0.1],[0.4,0.1],[0.4,0.4]]}');
    CREATE TABLE evidence_plan_entries(id text PRIMARY KEY,unit_id text REFERENCES evidence_plan_units(id),notes text);
    CREATE TABLE future_soft_links(id text PRIMARY KEY,tenancy_unit_id text,notes text);
    CREATE TABLE alternate_fk(id text PRIMARY KEY,schedule_row_id text REFERENCES tenancy_schedule_units(id) ON DELETE CASCADE);
    CREATE TABLE composite_fk(id text PRIMARY KEY,schedule_row_id text,property_id text,FOREIGN KEY(schedule_row_id,property_id) REFERENCES tenancy_schedule_units(id,property_id) ON DELETE CASCADE);`);
  await check('all five existing links, future soft links and alternate/composite FKs survive with facts and geometry intact',async()=>{
    const before=await snapshot();const result=await mergeTenancyUnits(db,'property','primary','secondary');const after=await snapshot();
    assert.equal(result.merged,1);assert.deepEqual(result.moved.leasing,1);assert.equal(result.moved.available,1);assert.equal(result.moved.deals,1);assert.equal(result.moved.evidencePlans,1);assert.equal(result.moved.propertyPlans,1);
    assert.equal(result.references.reduce((n,row)=>n+row.count,0),8);
    assert.deepEqual(after.tenancy_schedule_units,before.tenancy_schedule_units.filter(row=>row.id!=='secondary'));
    for(const table of ['leasing_schedule_units','available_units','crm_deals','evidence_plan_units','property_plan_units','future_soft_links']){
      assert.deepEqual(after[table],before[table].map(row=>({...row,tenancy_unit_id:row.tenancy_unit_id==='secondary'?'primary':row.tenancy_unit_id})));
    }
    for(const table of ['alternate_fk','composite_fk'])assert.deepEqual(after[table],before[table].map(row=>({...row,schedule_row_id:'primary'})));
    assert.deepEqual(after.evidence_plan_entries,before.evidence_plan_entries);
  });
  await check('rent, donor-only notes, IDs, floor, premises and unknown overlay conflicts reject without any mutation',async()=>{
    for(const [field,value]of [['passing_rent_pa',130000],['comments','Different clause'],['tenant_company_id','different-brand'],['property_unit_id','other-physical'],['floor_level','Upper'],['premises',null],['custom_overlay','Keep custom data']]){
      const original=(await db.query(`SELECT ${field} FROM tenancy_schedule_units WHERE id='secondary'`)).rows[0][field];
      await db.query(`UPDATE tenancy_schedule_units SET ${field}=$1 WHERE id='secondary'`,[value]);const before=await snapshot();
      await assert.rejects(()=>mergeTenancyUnits(db,'property','primary','secondary'),error=>error.status===409&&error.conflicts.includes(field));
      assert.deepEqual(await snapshot(),before);await db.query(`UPDATE tenancy_schedule_units SET ${field}=$1 WHERE id='secondary'`,[original]);
    }
  });
  await check('other-property, missing and identical IDs are rejected without moving a link',async()=>{
    const before=await snapshot();
    for(const [primary,secondary,status]of [['primary','unrelated',400],['primary','missing',404],['primary','primary',400]])await assert.rejects(()=>mergeTenancyUnits(db,'property',primary,secondary),error=>error.status===status);
    assert.deepEqual(await snapshot(),before);
  });
  await check('a final delete failure rolls back every preceding reference update',async()=>{
    await db.query(`CREATE FUNCTION refuse_delete() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic delete failure'; END$$;
      CREATE TRIGGER test_fail BEFORE DELETE ON tenancy_schedule_units FOR EACH ROW EXECUTE FUNCTION refuse_delete()`);
    const before=await snapshot();await assert.rejects(()=>mergeTenancyUnits(db,'property','primary','secondary'),/Synthetic delete failure/);assert.deepEqual(await snapshot(),before);
    await db.query('DROP TRIGGER test_fail ON tenancy_schedule_units; DROP FUNCTION refuse_delete()');
  });
  await check('a live-deal unique constraint rejects atomically with an actionable conflict',async()=>{
    await db.query("UPDATE crm_deals SET active=true WHERE id IN ('keep','move'); CREATE UNIQUE INDEX one_active_deal ON crm_deals(tenancy_unit_id) WHERE active");
    const before=await snapshot();await assert.rejects(()=>mergeTenancyUnits(db,'property','primary','secondary'),error=>error.status===409&&/linked records/.test(error.message));assert.deepEqual(await snapshot(),before);
    await db.query('DROP INDEX one_active_deal');
  });
  await check('concurrent opposite keeper choices serialize and preserve one complete surviving record',async()=>{
    const results=await Promise.allSettled([mergeTenancyUnits(db,'property','primary','secondary'),mergeTenancyUnits(db,'property','secondary','primary')]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason.status,404);
    const survivor=(await db.query("SELECT id FROM tenancy_schedule_units WHERE property_id='property'")).rows;assert.equal(survivor.length,1);
    assert.equal((await db.query("SELECT tenancy_unit_id FROM evidence_plan_units WHERE id='move'")).rows[0].tenancy_unit_id,survivor[0].id);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM evidence_plan_entries')).rows[0].n,1);
  });
  console.log(`PASS ${checks} PostgreSQL tenancy merge checks`);
}finally{try{await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await db.end();}}
