// Synthetic evidence-plan persistence checks in a throwaway PostgreSQL schema.
// No .env, image/provider calls or live data. Use the separate audit database:
// EVIDENCE_PLAN_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' node qa/regression/evidence-plan-data-postgres.mjs
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import pg from 'pg';
const require=createRequire(import.meta.url);
const {source,find,evaluate,ts}=require('./source-harness.cjs');
const supplied=process.env.EVIDENCE_PLAN_DATABASE_URL;
if(!supplied) throw new Error('Provide EVIDENCE_PLAN_DATABASE_URL for the disposable audit database');
const url=new URL(supplied);
if(url.hostname||url.pathname!=='/bgp_crm_directory_regression'||!/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host')||'')) throw new Error('Refusing non-disposable database');
const schema=`qa_evidence_plan_${process.pid}_${Date.now()}`;
const db=new pg.Pool({connectionString:supplied,ssl:false,max:6,options:`-c search_path=${schema}`});
const declaration=(name,file='server/evidence-plan.ts')=>find(file,node=>
  ((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node))&&node.name?.text===name)
  ||ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText()===name));
const code=source('shared/plan-geometry.ts')+'\n'+declaration('resolveBrandIdSubquery','server/tenant-brand-resolver.ts')+'\n'+
  ['normaliseUnitRef','normTenantName','stripCoName','EvidencePlanError','UNIT_FIELDS','ENTRY_FIELDS',
    'validateEvidenceUnitPatch','validateEvidenceEntryPatch','evidenceScheduleRows','matchEvidenceScheduleRow','presentEvidenceUnit',
    'relinkEntriesToUnit','relinkAllEntries','saveEvidenceUnit','saveEvidenceEntry','planOr404'].map(name=>declaration(name)).join('\n')+
  '\nexport {relinkEntriesToUnit,relinkAllEntries,planOr404};';
const helpers=evaluate(code,{...evaluate(source('server/evidence-plan-schedule.ts')),pool:db});
const {saveEvidenceUnit:saveUnit,saveEvidenceEntry:saveEntry,relinkAllEntries:relink}=helpers;
const allow=async()=>true;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const plan=id(1),level=id(2),otherPlan=id(3),otherLevel=id(4),named=id(10),manual=id(11),duplicateA=id(12),duplicateB=id(13),foreign=id(14);
const polygon=[{x:.1,y:.1},{x:.4,y:.1},{x:.4,y:.4},{x:.1,y:.4}];
let checks=0;
const check=(name,fn)=>{fn();checks++;console.log(`PASS ${name}`);};
const reject=async(name,fn,status)=>{await assert.rejects(fn,error=>error.status===status);checks++;console.log(`PASS ${name}`);};
const unit=async unitId=>(await db.query('SELECT * FROM evidence_plan_units WHERE id=$1',[unitId])).rows[0];
const schedule=async rowId=>(await db.query('SELECT * FROM tenancy_schedule_units WHERE id=$1',[rowId])).rows[0];
const entry=async entryId=>(await db.query('SELECT * FROM evidence_plan_entries WHERE id=$1',[entryId])).rows[0];
try {
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`
    CREATE TABLE evidence_plans(id uuid PRIMARY KEY,name text,property_id varchar,updated_at timestamptz DEFAULT now());
    CREATE TABLE evidence_plan_levels(id uuid PRIMARY KEY,plan_id uuid,background_key text,sort_order int DEFAULT 0,created_at timestamptz DEFAULT now());
    CREATE TABLE evidence_plan_units(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_id uuid,level_id uuid,unit_ref text NOT NULL,
      tenant_name text,polygon jsonb,dot jsonb,source text,lease_expiry date,break_date date,review_date date,
      erv numeric,passing_rent numeric,sqft numeric,notes text,tenancy_unit_id varchar,updated_at timestamptz DEFAULT now());
    CREATE TABLE evidence_plan_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_id uuid,unit_id uuid,unit_ref text,tenant text,
      transaction_type text,transaction_date date,size_sqft numeric,zone_a numeric,itza numeric,headline_rent numeric,
      net_effective numeric,term text,concession text,notes text,source_key text,created_by varchar,created_at timestamptz DEFAULT now());
    CREATE TABLE tenancy_schedule_units(id varchar PRIMARY KEY,property_id varchar,unit_number text,trading_name text,tenant_name text,
      floor_level text,lease_expiry timestamp,break_date timestamp,next_review_date timestamp,erv_pa numeric,passing_rent_pa numeric,
      nia_sqft numeric,gia_sqft numeric,permitted_use text,premises text,tenant_company_id varchar,updated_at timestamp DEFAULT now());
    CREATE TABLE crm_properties(id varchar PRIMARY KEY,name text);
    CREATE TABLE crm_companies(id varchar PRIMARY KEY,name text,merged_into_id varchar,trading_entities jsonb);
    INSERT INTO crm_properties VALUES ('property','Synthetic scheme'),('other-property','Other scheme');
    INSERT INTO crm_companies VALUES ('new-brand','New Brand',NULL,'[]');
  `);
  await db.query('INSERT INTO evidence_plans(id,name,property_id) VALUES ($1,$2,$3),($4,$5,$6)',[plan,'Plan','property',otherPlan,'Other','other-property']);
  await db.query('INSERT INTO evidence_plan_levels(id,plan_id,background_key) VALUES ($1,$2,$3),($4,$5,$6)',[level,plan,'image-one',otherLevel,otherPlan,'other-image']);
  for(const [unitId,ref,tenant] of [[named,'Tea Shop','Tea Shop'],[manual,'X9','Manual Tenant'],[duplicateA,'B1','Duplicate'],[duplicateB,'Unit B01','Duplicate']]){
    await db.query(`INSERT INTO evidence_plan_units(id,plan_id,level_id,unit_ref,tenant_name,polygon,dot,source,erv,lease_expiry,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'ai',100,'2030-01-01','Original')`,[unitId,plan,level,ref,tenant,JSON.stringify(polygon),JSON.stringify({x:.2,y:.2})]);
  }
  await db.query(`INSERT INTO evidence_plan_units(id,plan_id,level_id,unit_ref,polygon,source) VALUES ($1,$2,$3,'Foreign',$4,'manual')`,[foreign,otherPlan,otherLevel,JSON.stringify(polygon)]);
  await db.query(`INSERT INTO tenancy_schedule_units(id,property_id,unit_number,trading_name,tenant_name,erv_pa,nia_sqft,lease_expiry) VALUES
    ('schedule-one','property','A1','Tea Shop','Tea Legal Limited',500,1000,'2031-01-01'),
    ('schedule-two','property','C1','Second Shop','Second Legal Limited',600,2000,NULL),
    ('duplicate-one','property','D1','First','First',100,100,NULL),
    ('duplicate-two','property','Unit D01','Second','Second',200,200,NULL),
    ('foreign-row','other-property','F1','Foreign','Foreign',100,100,NULL)`);
  for(const [entryId,ref,tenant] of [[id(21),'A1','Tea Shop'],[id(22),'B1','Duplicate'],[id(23),'A9','Tea Shop'],[id(24),null,'Tea Shop']]){
    await db.query('INSERT INTO evidence_plan_entries(id,plan_id,unit_ref,tenant,source_key) VALUES ($1,$2,$3,$4,$5)',[entryId,plan,ref,tenant,'synthetic-taf']);
  }
  const linked=await relink(plan);
  check('schedule alias links TAF evidence without renaming the saved plan label',()=>assert.equal(linked,2));
  const originalNamed=await unit(named);
  check('GET-style relinking leaves saved human-readable label intact',()=>assert.equal(originalNamed.unit_ref,'Tea Shop'));
  const ambiguousEntry=await entry(id(22)),contradictoryEntry=await entry(id(23));
  check('ambiguous duplicate refs and contradictory explicit refs stay unlinked',()=>{
    assert.equal(ambiguousEntry.unit_id,null);assert.equal(contradictoryEntry.unit_id,null);
  });
  assert.equal((await entry(id(21))).unit_id,named);assert.equal((await entry(id(24))).unit_id,named);
  const manualResult=await saveUnit(manual,{scheduleRowId:null,erv:'125.50',passingRent:'0',notes:'Human edit'},allow);
  check('explicit null schedule ID permits unmatched manual facts',()=>{assert.equal(Number(manualResult.erv),125.5);assert.equal(manualResult.passing_rent,'0');});
  check('manual correction protects an AI-created row from later detection replacement',()=>assert.equal(manualResult.source,'manual'));
  const renumberedManual=await saveUnit(manual,{unitRef:'99',scheduleRowId:null},allow);
  check('unlinked manual units can still receive a different unit number',()=>assert.equal(renumberedManual.unit_ref,'99'));
  await reject('linked fact saves require the displayed canonical schedule ID',()=>saveUnit(named,{erv:999},allow),409);
  await reject('an unrelated or stale schedule row cannot receive edits',()=>saveUnit(named,{scheduleRowId:'foreign-row',erv:999},allow),409);
  await reject('canonical edits honor the existing property edit scope',()=>saveUnit(named,{scheduleRowId:'schedule-one',erv:999},async()=>false),403);
  const canonical=await saveUnit(named,{scheduleRowId:'schedule-one',erv:0,leaseExpiry:'',tenantName:'New Brand',notes:'Reviewed'},allow);
  const canonicalRow=await schedule('schedule-one');const namedAfter=await unit(named);
  check('confirmed edits update canonical schedule facts, including zero and clear',()=>{
    assert.equal(canonicalRow.erv_pa,'0');assert.equal(canonicalRow.lease_expiry,null);assert.equal(canonical.erv,'0');assert.equal(canonical.lease_expiry,null);
  });
  check('trading-name edits preserve legal tenant name and resolve its brand link',()=>{
    assert.equal(canonicalRow.trading_name,'New Brand');assert.equal(canonicalRow.tenant_name,'Tea Legal Limited');assert.equal(canonicalRow.tenant_company_id,'new-brand');
  });
  check('canonical editing retains plan-unit ID, saved label, dot and evidence attachment',()=>{
    assert.equal(namedAfter.id,named);assert.equal(namedAfter.unit_ref,'Tea Shop');assert.deepEqual(namedAfter.dot,{x:.2,y:.2});assert.equal(namedAfter.notes,'Reviewed');
  });
  assert.equal((await entry(id(21))).unit_id,named);
  check('the first canonical fact edit pins the exact tenancy row',()=>assert.equal(namedAfter.tenancy_unit_id,'schedule-one'));
  const otherTenancyBefore=await schedule('schedule-two');
  const renamedTenant=await saveUnit(named,{scheduleRowId:'schedule-one',tenantName:'Second Shop'},allow);
  check('a pinned row allows a deliberate tenant change without following another shop of that name',()=>{
    assert.equal(renamedTenant.ts_row_id,'schedule-one');assert.equal(renamedTenant.unit_ref,'Tea Shop');
  });
  assert.deepEqual(await schedule('schedule-two'),otherTenancyBefore);
  await saveUnit(named,{scheduleRowId:'schedule-one',tenantName:'New Brand'},allow);
  const numbered=id(41);
  await db.query("INSERT INTO tenancy_schedule_units(id,property_id,unit_number,trading_name,tenant_name,passing_rent_pa,lease_expiry) VALUES ('numeric-schedule','other-property','D1','Numeric Shop','Numeric Legal Limited',120000,'2031-01-01')");
  await db.query("INSERT INTO evidence_plan_units(id,plan_id,level_id,unit_ref,tenant_name,passing_rent,lease_expiry,notes,source) VALUES ($1,$2,$3,'D1','Numeric Shop',30000,'2020-01-01','Original numbered unit','manual')",[numbered,otherPlan,otherLevel]);
  const beforeNumbered=await unit(numbered),beforeNumericSchedule=await schedule('numeric-schedule');
  await assert.rejects(()=>saveUnit(numbered,{unitRef:'1',scheduleRowId:'numeric-schedule',passingRent:999,notes:'Must not save'},allow),error=>error.status===409&&/disconnect.*tenancy schedule row/.test(error.message));
  check('renaming linked D1 to 1 is rejected with an explanatory conflict',()=>assert.equal(beforeNumbered.unit_ref,'D1'));
  const rejectedNumbered=await unit(numbered),rejectedNumericSchedule=await schedule('numeric-schedule');
  check('rejected linked renumbering preserves both the entire unit and schedule row',()=>{assert.deepEqual(rejectedNumbered,beforeNumbered);assert.deepEqual(rejectedNumericSchedule,beforeNumericSchedule);});
  const normalizedNumbered=await saveUnit(numbered,{unitRef:'Unit D01',scheduleRowId:'numeric-schedule',passingRent:0},allow);
  check('safe reference normalization retains the same schedule link and ordinary fact edits',()=>{assert.equal(normalizedNumbered.unit_ref,'Unit D01');assert.equal(normalizedNumbered.ts_row_id,'numeric-schedule');assert.equal(normalizedNumbered.passing_rent,'0');});
  await reject('explicit schedule links reject stale expected matches',()=>saveUnit(manual,{linkScheduleRowId:'schedule-two',expectedScheduleRowId:'wrong'},allow),409);
  await reject('explicit schedule links reject other-property rows',()=>saveUnit(manual,{linkScheduleRowId:'foreign-row',expectedScheduleRowId:null},allow),409);
  const duplicateChosen=await saveUnit(manual,{linkScheduleRowId:'duplicate-one',expectedScheduleRowId:null,expectedTenancyUnitId:null},allow);
  check('reviewing a duplicate selects its exact row without changing the plan label',()=>{
    assert.equal(duplicateChosen.tenancy_unit_id,'duplicate-one');assert.equal(duplicateChosen.ts_row_id,'duplicate-one');
    assert.equal(duplicateChosen.unit_ref,'99');assert.equal(duplicateChosen.erv,'100');
  });
  await reject('an outdated saved link cannot replace a newer choice',()=>saveUnit(manual,{linkScheduleRowId:'schedule-two',expectedScheduleRowId:'duplicate-one',expectedTenancyUnitId:null},allow),409);
  await reject('a changed target needs to be reviewed again',()=>saveUnit(manual,{linkScheduleRowId:'schedule-two',expectedScheduleRowId:'duplicate-one',expectedTargetUpdatedAt:'2000-01-01T00:00:00.000Z'},allow),409);
  await db.query("INSERT INTO tenancy_schedule_units(id,property_id,unit_number,trading_name,passing_rent_pa) VALUES ('later-duplicate','property','D1','Later import',95000)");
  const persisted=helpers.presentEvidenceUnit(await unit(manual),await helpers.evidenceScheduleRows('property'));
  check('reload after a duplicate import keeps the reviewed row',()=>{assert.equal(persisted.ts_row_id,'duplicate-one');assert.equal(persisted.ts_match_method,'explicit');});
  await reject('lease facts reject an outdated row version',()=>saveUnit(manual,{scheduleRowId:'duplicate-one',scheduleRowUpdatedAt:'2000-01-01T00:00:00.000Z',passingRent:999},allow),409);
  const duplicateOtherBefore=await schedule('duplicate-two');
  await saveUnit(manual,{scheduleRowId:'duplicate-one',scheduleRowUpdatedAt:new Date((await schedule('duplicate-one')).updated_at).toISOString(),passingRent:45678},allow);
  const duplicateChosenAfter=await schedule('duplicate-one'),duplicateOtherAfter=await schedule('duplicate-two');
  check('editing a chosen duplicate changes only that exact tenancy',()=>{assert.equal(duplicateChosenAfter.passing_rent_pa,'45678');assert.deepEqual(duplicateOtherAfter,duplicateOtherBefore);});
  await db.query("DELETE FROM tenancy_schedule_units WHERE id='duplicate-one'");
  const stale=helpers.presentEvidenceUnit(await unit(manual),await helpers.evidenceScheduleRows('property'));
  check('a deleted linked row stays stale rather than inheriting another duplicate',()=>{assert.equal(stale.ts_row_id,null);assert.equal(stale.ts_link_status,'stale-link');});
  await reject('stale links require replacement before editing lease facts',()=>saveUnit(manual,{scheduleRowId:null,passingRent:999},allow),409);
  const mapped=await saveUnit(manual,{linkScheduleRowId:'schedule-two',expectedScheduleRowId:null,expectedTenancyUnitId:'duplicate-one'},allow);
  check('reviewed replacement link keeps its label, note and canonical facts',()=>{
    assert.equal(mapped.unit_ref,'99');assert.equal(mapped.ts_row_id,'schedule-two');assert.equal(mapped.erv,'600');assert.equal(mapped.notes,'Human edit');
  });
  const snapshot=await unit(manual);
  await reject('marker outside the outline is rejected before any data write',()=>saveUnit(manual,{dot:{x:.9,y:.9},notes:'Should not save'},allow),400);
  await reject('invalid date and negative figures are rejected',()=>saveUnit(manual,{scheduleRowId:'schedule-two',leaseExpiry:'2026-02-30',erv:-1},allow),400);
  await reject('units cannot be moved to another plans level',()=>saveUnit(manual,{levelId:otherLevel},allow),400);
  await reject('drawing against a replaced image returns a conflict',()=>saveUnit(manual,{polygon,expectedBackgroundKey:'old-image'},allow),409);
  const afterInvalid=await unit(manual);
  check('rejected requests retain the complete stored unit and metadata',()=>assert.deepEqual(afterInvalid,snapshot));
  const movedPolygon=[{x:.5,y:.5},{x:.7,y:.5},{x:.7,y:.7},{x:.5,y:.7}];
  const moved=await saveUnit(manual,{polygon:movedPolygon,expectedBackgroundKey:'image-one'},allow);
  check('redrawn geometry keeps a valid marker inside the replacement outline',()=>{
    assert.ok(helpers.pointInPolygon(moved.dot,movedPolygon));assert.equal(moved.id,manual);assert.equal(moved.source,'manual');
  });
  await db.query("ALTER TABLE evidence_plan_units ADD CONSTRAINT synthetic_rollback CHECK (notes IS DISTINCT FROM 'Force rollback')");
  await assert.rejects(()=>saveUnit(named,{scheduleRowId:'schedule-one',erv:999,notes:'Force rollback'},allow),error=>error.code==='23514');
  const rolledBackSchedule=await schedule('schedule-one'),rolledBackUnit=await unit(named);
  check('unit persistence failure rolls canonical schedule changes back atomically',()=>{
    assert.equal(rolledBackSchedule.erv_pa,'0');assert.equal(rolledBackUnit.notes,'Reviewed');
  });
  await reject('evidence cannot be linked to a unit from a different plan',()=>saveEntry(null,id(21),{unitId:foreign},'staff'),400);
  assert.equal((await entry(id(21))).unit_id,named);
  const changed=await saveEntry(null,id(21),{unitId:manual,zoneA:'0',transactionDate:'2026-09-07'},'staff');
  check('explicit evidence relink preserves its ID and supports a genuine zero value',()=>{
    assert.equal(changed.id,id(21));assert.equal(changed.unit_id,manual);assert.equal(changed.zone_a,'0');assert.equal(changed.unit_ref,'A1');
  });
  const added=await saveEntry(plan,null,{unitId:named,zoneA:250,notes:'Additional review'},'staff');
  check('new evidence derives its selected units ref and preserves chosen plan',()=>{assert.equal(added.plan_id,plan);assert.equal(added.unit_id,named);assert.equal(added.unit_ref,'Tea Shop');});
  const fresh=id(31);await db.query('INSERT INTO evidence_plan_entries(id,plan_id,unit_ref,tenant) VALUES ($1,$2,$3,$4)',[fresh,plan,'A1','New Brand']);
  const route=find('server/evidence-plan.ts',node=>ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)
    &&node.expression.expression.getText()==='router'&&node.expression.name.text==='get'
    &&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='/api/evidence-plans/:id');
  let handler;evaluate(route+';',{...helpers,pool:db,router:{get:(_path,_auth,fn)=>{handler=fn;}},requireAuth:()=>{},
    healLevels:async()=>[],healFrontageDots:async()=>{}});
  const response={code:200,body:null,status(value){this.code=value;return this;},json(value){this.body=value;return this;}};
  await handler({params:{id:plan}},response,()=>{});
  check('actual GET returns newly relinked evidence in the same response',()=>{assert.equal(response.code,200);assert.equal(response.body.entries.find(row=>row.id===fresh).unit_id,named);});
  check('actual GET exposes same-property schedule choices while preserving saved labels',()=>{
    assert.ok(response.body.schedule_rows.every(row=>row.property_id==='property'));
    assert.equal(response.body.units.find(row=>row.id===named).unit_ref,'Tea Shop');
    assert.equal(response.body.units.find(row=>row.id===named).ts_row_id,'schedule-one');
  });
  console.log(`PASS ${checks} PostgreSQL evidence-plan data checks`);
} finally {
  try{await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await db.end();}
}
