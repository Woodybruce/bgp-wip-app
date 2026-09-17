// Real property-plan SQL/routes/transactions against the disposable QA database only.
// No .env, live plan files, provider calls, or production database writes are used.
// PROPERTY_PLAN_TEST_DATABASE_URL='postgresql:///bgp_smoke?host=/tmp/bgp-propertyqa-20260916/socket&port=55446&user=postgres' node --import tsx qa/regression/property-plan-integration-postgres.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import sharp from 'sharp';
import crypto from 'node:crypto';
import * as links from '../../server/property-plan-links.ts';
import { startPropertyPlanScan, applyPropertyPlanScan, requirePropertyPlan } from '../../server/property-plan-scan-store.ts';
import { scanPropertyPlanImage, propertyPlanRaster, suggestPropertyPlanLink } from '../../server/property-plan-scan.ts';
import { tracePlanUnit } from '../../server/plan-unit-detection.ts';
import { pointInPolygon } from '../../shared/plan-geometry.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');
const supplied = process.env.PROPERTY_PLAN_TEST_DATABASE_URL;
if (!supplied) throw new Error('Provide PROPERTY_PLAN_TEST_DATABASE_URL for the disposable local QA database');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_smoke' || url.searchParams.get('host') !== '/tmp/bgp-propertyqa-20260916/socket' || url.searchParams.get('port') !== '55446') throw new Error('Refusing a non-disposable database');
const schema = `qa_property_plan_${process.pid}_${Date.now()}`;
const db = new pg.Pool({ connectionString: supplied, ssl: false, max: 12, options: `-c search_path=${schema}` });
const id = n => `00000000-0016-4000-8000-${String(n).padStart(12, '0')}`;
const planId = id(1), otherPlanId = id(2), scanPlanId = id(3);
const rectangle = (x, y, w=.12, h=.14) => ({ points: [[x,y],[x+w,y],[x+w,y+h],[x,y+h]] });
const polygon = rectangle(.1,.1);
const access = async propertyId => propertyId === 'property';
const pass = name => { checks++; console.log(`PASS ${name}`); };
let checks = 0, created = false, leased = 0, beforeConnect;
const routePool={query:(...args)=>db.query(...args),connect:async()=>{if(beforeConnect){const run=beforeConnect;beforeConnect=undefined;await run();}const connection=await db.connect();leased++;return{query:(...args)=>connection.query(...args),release(){leased--;connection.release();}};}};
const declaration = name => find('server/property-plans.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const ast = ts.createSourceFile('server/property-plans.ts', source('server/property-plans.ts'), ts.ScriptTarget.Latest, true);
const constants = ast.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(ast) === 'STATUS_OVERRIDES')).map(node => node.getText(ast)).join('\n');
const routes = new Map();
const routeScripts = [];
for (const [method, path] of [['get','/api/plans/:planId/units'],['post','/api/plans/:planId/units'],['patch','/api/plan-units/:id'],['delete','/api/plan-units/:id'],['patch','/api/plans/:planId'],['delete','/api/plans/:planId'],['get','/api/properties/:propertyId/plan-pickable-units']]) {
  routeScripts.push(find('server/property-plans.ts', (node, tree) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(tree) === 'router' && node.expression.name.text === method && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === path)+';');
}
evaluate([constants,...['inputStatus','inputLabel','errorResponse','planForRequest','unitOwnerForRequest','unitForRequest'].map(declaration),...routeScripts].join('\n'), {
  ...links, pool: routePool, requireAuth(){}, clientBlockedForProperty: async(req,propertyId) => {assert.equal(leased,0,'Scope must be resolved before a transaction reserves a pool connection');return req.scope && req.scope !== propertyId;},
  router: Object.fromEntries(['get','post','patch','delete'].map(method => [method, (path,_auth,handler) => routes.set(`${method} ${path}`,handler)])),
});
async function invoke(method,path,params,body={},scope='property') {
  let status=200,data;
  const res={status(value){status=value;return res;},json(value){data=value;return res;}};
  await routes.get(`${method} ${path}`)({params,body,scope},res);
  return {status,data};
}
const count = async table => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
async function ready(plan=scanPlanId,candidates=[{id:'candidate-1',label:'A1',polygon:rectangle(.1,.1)},{id:'candidate-2',label:'B1',polygon:rectangle(.6,.1)}]) {
  const {job}=await startPropertyPlanScan(db,plan,access);
  await db.query("UPDATE property_plan_scans SET status='ready',candidates=$2::jsonb WHERE id=$1",[job.id,JSON.stringify(candidates)]);
  return job.id;
}
const assignment=(candidateId,label,tenancy_unit_id=null,unit_id=null)=>({candidateId,label,tenancy_unit_id,unit_id});
const apply=(job,assignments,plan=scanPlanId)=>applyPropertyPlanScan(db,plan,job,{assignments},access);
const rejectStatus=(promise,status)=>assert.rejects(promise,error=>error.status===status);
try {
  await db.query(`CREATE SCHEMA ${schema}`);created=true;
  for (const table of ['crm_properties','property_plans','property_plan_units','property_units','tenancy_schedule_units','leasing_schedule_units','available_units','crm_deals']) await db.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  await db.query(await readFile(new URL('../../migrations/0036_property_plan_tenancy_and_scan_review.sql',import.meta.url),'utf8'));
  await db.query("INSERT INTO crm_properties(id,name) VALUES('property','Synthetic Property')");
  await db.query("INSERT INTO property_plans(id,property_id,floor,storage_key,width,height) VALUES($1,'property','Ground','synthetic-plan',400,300),($2,'foreign','Ground','foreign-plan',400,300),($3,'property','Upper','synthetic-scan',400,300)",[planId,otherPlanId,scanPlanId]);
  await db.query(`INSERT INTO property_units(id,property_id,unit_name,floor) VALUES('physical-1','property','Old A1','Ground'),('physical-2','property','Ambiguous','Ground'),('physical-3','property','Legacy','Ground'),('physical-only','property','No tenancy','First'),('foreign-physical','foreign','Foreign','Ground');
    INSERT INTO tenancy_schedule_units(id,property_id,property_unit_id,unit_number,floor_level,tenant_name,passing_rent_pa,status) VALUES('t1','property','physical-1','A1','Ground','Canonical Shop',NULL,'Occupied'),('t2','property',NULL,'B1','First','New Shop',25000,'Occupied'),('ambiguous-1','property','physical-2','Shared','Ground','Historic Shop',12000,'Occupied'),('ambiguous-2','property','physical-2','Shared','Upper','Another Shop',15000,'Occupied'),('foreign-tenancy','foreign','foreign-physical','A1','Ground','Foreign Shop',99999,'Occupied');
    INSERT INTO leasing_schedule_units(id,property_id,unit_name,tenant_name,rent_pa) VALUES('legacy-1','property','Old A1','Wrong Old Shop',90000),('legacy-2','property','Old A1','Wrong Duplicate',95000),('legacy-3','property','Legacy','Legacy Shop',17000);
    INSERT INTO available_units(id,property_id,unit_id,tenancy_unit_id,unit_name,marketing_status) VALUES('tracker-1','property','physical-1','t1','Old A1','HOT'),('tracker-2','property','physical-1','t1','Old A1','HOT');`);
  await db.query("INSERT INTO property_plan_units(id,plan_id,unit_id,tenancy_unit_id,label,polygon) VALUES($1,$4,'physical-1','t1','A1',$5::jsonb),($2,$4,'physical-2',NULL,'Shared',$5::jsonb),($3,$4,'physical-3',NULL,'Legacy',$5::jsonb)",[id(11),id(12),id(13),planId,JSON.stringify(polygon)]);
  let rows=await links.queryPropertyPlanUnits(db,planId);
  assert.equal(rows.length,3);let canonical=rows.find(row=>row.id===id(11));
  assert.equal(canonical.tenant_name,'Canonical Shop');assert.equal(canonical.rent_pa,null);assert.equal(canonical.tenancy_unit_id,'t1');assert.equal(links.propertyPlanUnitStatus(canonical),'under_offer');
  pass('canonical tenancy wins, deliberately cleared rent stays empty, duplicate projections do not multiply outlines, HOT is under offer');
  await db.query("UPDATE tenancy_schedule_units SET lease_expiry='2027-03-31',next_review_date='2028-09-01' WHERE id='t1'; UPDATE leasing_schedule_units SET lease_expiry='2027-03-31 00:00:00',lease_break='2028-09-01 00:00:00' WHERE id='legacy-3'");
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ['Europe/London', 'UTC', 'America/Los_Angeles']) {
      process.env.TZ = timezone;
      const dated = await links.queryPropertyPlanUnits(db, planId);
      const linked = dated.find(row => row.id === id(11)), legacy = dated.find(row => row.id === id(13));
      assert.equal(linked.lease_expiry, '2027-03-31'); assert.equal(linked.rent_review, '2028-09-01'); assert.equal(linked.lease_break, null);
      assert.equal(legacy.lease_expiry, '2027-03-31'); assert.equal(legacy.lease_break, '2028-09-01'); assert.equal(legacy.rent_review, null);
    }
  } finally { if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone; }
  pass('canonical SQL dates and legacy lease timestamps return exact calendar days across server time zones');
  assert.equal(rows.find(row=>row.id===id(12)).link_state,'ambiguous');assert.equal(rows.find(row=>row.id===id(12)).tenant_name,null);assert.equal(rows.find(row=>row.id===id(13)).tenant_name,'Legacy Shop');
  pass('ambiguous physical tenancy stays unassigned; unique genuine legacy data remains visible');
  const countsBefore=await Promise.all(['property_units','tenancy_schedule_units','leasing_schedule_units'].map(count));
  await db.query("UPDATE tenancy_schedule_units SET permitted_use='Office' WHERE id='t2'; UPDATE property_units SET use_class='Storage' WHERE id='physical-only'");
  const options=await links.queryPickableUnits(db,'property');assert.equal(options.length,6);assert.ok(options.some(row=>row.tenancy_unit_id==='t2'&&row.unit_id===null&&row.permitted_use==='Office'));assert.ok(options.some(row=>row.unit_id==='physical-only'&&!row.tenancy_unit_id&&row.permitted_use==='Storage'));assert.ok(!options.some(row=>row.id==='foreign-tenancy'));
  assert.deepEqual(await Promise.all(['property_units','tenancy_schedule_units','leasing_schedule_units'].map(count)),countsBefore);
  assert.equal(suggestPropertyPlanLink('Shared',null,options),null);assert.equal(suggestPropertyPlanLink('Not A1','Canonical Shop',options),null);
  pass('picker is read-only, includes schedule-only and physical-only units, isolates property and refuses ambiguous suggestions');
  await db.query("UPDATE tenancy_schedule_units SET unit_number='Renamed A1',tenant_name='Updated Tenant',passing_rent_pa=42000 WHERE id='t1'");
  canonical=(await links.queryPropertyPlanUnits(db,planId)).find(row=>row.id===id(11));assert.equal(canonical.unit_name,'Renamed A1');assert.equal(canonical.tenant_name,'Updated Tenant');assert.equal(canonical.rent_pa,42000);
  pass('plan immediately reads renamed unit and changed rent/tenant through the stable tenancy ID');
  assert.deepEqual(await links.validatePlanUnitLink(db,'property',{tenancy_unit_id:'t2'}),{unit_id:null,tenancy_unit_id:'t2'});
  await assert.rejects(links.validatePlanUnitLink(db,'property',{tenancy_unit_id:'foreign-tenancy'}),/belonging to this property/);
  await assert.rejects(links.validatePlanUnitLink(db,'property',{unit_id:'foreign-physical'}),/belonging to this property/);
  await assert.rejects(links.validatePlanUnitLink(db,'property',{unit_id:'physical-only',tenancy_unit_id:'t1'}),/same unit/);
  pass('links validate exact property and physical identity; schedule-only rows do not create master records');
  for(const [method,path,params,body] of [['get','/api/plans/:planId/units',{planId:otherPlanId}],['post','/api/plans/:planId/units',{planId:otherPlanId},{polygon}],['patch','/api/plans/:planId',{planId:otherPlanId},{floor:'Bad'}],['delete','/api/plans/:planId',{planId:otherPlanId}],['patch','/api/plan-units/:id',{id:id(11)},{label:'Bad'}],['delete','/api/plan-units/:id',{id:id(11)}]]) {
    const response=await invoke(method,path,params,body,params.planId===otherPlanId?'property':'foreign');assert.equal(response.status,403,`${method} ${path}`);
  }
  assert.equal((await invoke('get','/api/plans/:planId/units',{planId:id(999)})).status,404);
  assert.equal((await invoke('post','/api/plans/:planId/units',{planId},{polygon,imageKey:'stale'})).status,409);
  assert.equal((await invoke('post','/api/plans/:planId/units',{planId},{polygon:{points:[[.1,.1],[.8,.8],[.1,.8],[.8,.1]]}})).status,400);
  pass('actual plan CRUD handlers reject foreign access, stale images, crossed geometry and missing plans');
  const create=await invoke('post','/api/plans/:planId/units',{planId},{polygon,tenancy_unit_id:'t2',label:'B1',imageKey:'synthetic-plan'});assert.equal(create.status,200,create.data?.error);
  assert.equal((await invoke('patch','/api/plan-units/:id',{id:create.data.id},{tenancy_unit_id:'foreign-tenancy'})).status,400);
  assert.equal((await invoke('patch','/api/plan-units/:id',{id:create.data.id},{status_override:'vacant'})).status,200);
  assert.equal((await invoke('delete','/api/plan-units/:id',{id:create.data.id})).status,200);
  pass('scoped manual create/edit/delete works while relinking outside the property is blocked');
  await db.query("INSERT INTO property_plan_units(id,plan_id,unit_id,tenancy_unit_id,label,polygon) VALUES($1,$2,'physical-1','t2','Stale physical',$3::jsonb)",[id(14),planId,JSON.stringify(polygon)]);
  const stalePhysical=(await links.queryPropertyPlanUnits(db,planId)).find(row=>row.id===id(14));assert.equal(stalePhysical.unit_id,null);assert.equal(stalePhysical.tenancy_unit_id,'t2');assert.equal(stalePhysical.tenant_name,'New Shop');assert.equal(stalePhysical.available_unit_id,null);assert.equal(stalePhysical.marketing_status,null);
  await db.query('DELETE FROM property_plan_units WHERE id=$1',[id(14)]);
  pass('schedule-only canonical link never borrows a stale physical unit or its marketing details');
  beforeConnect=()=>db.query("UPDATE property_plans SET property_id='foreign' WHERE id=$1",[planId]);
  const movedCreate=await invoke('post','/api/plans/:planId/units',{planId},{polygon,label:'Moved plan'});assert.equal(movedCreate.status,409,movedCreate.data?.error);
  await db.query("UPDATE property_plans SET property_id='property' WHERE id=$1",[planId]);
  beforeConnect=()=>db.query("UPDATE property_plans SET property_id='foreign' WHERE id=$1",[planId]);
  const movedEdit=await invoke('patch','/api/plan-units/:id',{id:id(11)},{label:'Moved unit'});assert.equal(movedEdit.status,409,movedEdit.data?.error);
  await db.query("UPDATE property_plans SET property_id='property' WHERE id=$1",[planId]);
  const checkedAccess=async propertyId=>{assert.equal(leased,0,'Scan scope check must precede reserving a transaction connection');return access(propertyId);};
  const checkedStart=await startPropertyPlanScan(routePool,scanPlanId,checkedAccess);
  await db.query("UPDATE property_plan_scans SET status='failed' WHERE id=$1",[checkedStart.job.id]);
  pass('authorization runs before reserving pool connections and locked writes reject moved-property races');
  const before=await count('property_plan_units');
  const starts=await Promise.all(Array.from({length:12},()=>startPropertyPlanScan(db,scanPlanId,access)));
  assert.equal(new Set(starts.map(item=>item.job.id)).size,1);assert.equal(starts.filter(item=>!item.reused).length,1);assert.equal(await count('property_plan_units'),before);
  await rejectStatus(startPropertyPlanScan(db,otherPlanId,access),403);await rejectStatus(requirePropertyPlan(db,'invalid',access),400);
  pass('12 simultaneous scans produce one job and no saved outlines; foreign/invalid starts fail');
  const old=starts[0].job.id;await db.query("UPDATE property_plan_scans SET updated_at=now()-interval '4 minutes' WHERE id=$1",[old]);
  const next=await startPropertyPlanScan(db,scanPlanId,access);assert.notEqual(next.job.id,old);assert.equal((await db.query('SELECT status FROM property_plan_scans WHERE id=$1',[old])).rows[0].status,'failed');
  await db.query("UPDATE property_plan_scans SET created_at=now()-interval '31 minutes' WHERE id=$1",[next.job.id]);
  const fresh=await startPropertyPlanScan(db,scanPlanId,access);assert.notEqual(fresh.job.id,next.job.id);
  pass('heartbeat and hard expiry allow replacement without reviving old jobs');
  await db.query("UPDATE property_plan_scans SET status='failed' WHERE id=$1",[fresh.job.id]);
  const success=await ready();const chosen=[assignment('candidate-1','A1','t1'),assignment('candidate-2','B1','t2')];
  const saves=await Promise.all([apply(success,chosen),apply(success,[...chosen].reverse())]);assert.equal(saves.filter(row=>!row.reused).length,1);assert.equal(saves.filter(row=>row.reused).length,1);assert.equal(await count('property_plan_units'),before+2);
  const saved=(await db.query('SELECT * FROM property_plan_units WHERE plan_id=$1 ORDER BY label',[scanPlanId])).rows;assert.equal(saved[0].tenancy_unit_id,'t1');assert.equal(saved[0].unit_id,'physical-1');assert.equal(saved[1].tenancy_unit_id,'t2');assert.equal(saved[1].unit_id,null);
  await rejectStatus(apply(success,[{...chosen[0],label:'Changed'},chosen[1]]),409);
  pass('concurrent apply is atomic and idempotent; reordered replay is accepted, changed replay rejected, canonical links retained');
  await db.query('DELETE FROM property_plan_units WHERE plan_id=$1',[scanPlanId]);
  const stale=await ready();await db.query("UPDATE property_plans SET storage_key='replacement' WHERE id=$1",[scanPlanId]);await rejectStatus(apply(stale,chosen),409);assert.equal((await db.query('SELECT count(*)::int AS n FROM property_plan_units WHERE plan_id=$1',[scanPlanId])).rows[0].n,0);
  await db.query("UPDATE property_plans SET storage_key='synthetic-scan' WHERE id=$1",[scanPlanId]);
  pass('replacing the plan invalidates old scan proposals before any writes');
  await db.query("ALTER TABLE property_plan_units ADD CONSTRAINT qa_rejected_label CHECK(label <> 'Rejected')");
  const rollback=await ready();await assert.rejects(apply(rollback,[assignment('candidate-1','A1','t1'),assignment('candidate-2','Rejected','t2')]));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM property_plan_units WHERE plan_id=$1',[scanPlanId])).rows[0].n,0);assert.equal((await db.query('SELECT status FROM property_plan_scans WHERE id=$1',[rollback])).rows[0].status,'ready');
  pass('failure on the second insert rolls back the first outline and keeps review available');
  const raceA=await ready(),raceB=await ready();const race=await Promise.allSettled([apply(raceA,chosen),apply(raceB,chosen)]);assert.equal(race.filter(row=>row.status==='fulfilled').length,1);assert.equal(race.filter(row=>row.status==='rejected'&&row.reason.status===409).length,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM property_plan_units WHERE plan_id=$1',[scanPlanId])).rows[0].n,2);
  pass('two separate reviews racing for the same floor cannot duplicate outlines');
  const invalid=await ready(scanPlanId,[{id:'candidate-3',label:'C1',polygon:rectangle(.5,.6)}]);await rejectStatus(apply(invalid,[assignment('candidate-3','C1','foreign-tenancy')]),400);await rejectStatus(apply(invalid,[assignment('candidate-3','C1','t1')]),409);
  pass('apply also rejects foreign tenancy and a second outline for an already-linked tenancy');
  const raw=Buffer.alloc(400*300*3,255);for(let y=40;y<210;y++)for(let x=40;x<180;x++)if(x<95||y>135){const i=(y*400+x)*3;raw[i]=110;raw[i+1]=190;raw[i+2]=185;}
  const png=await sharp(raw,{raw:{width:400,height:300,channels:3}}).png().toBuffer();
  const raster=await propertyPlanRaster(png);const traced=tracePlanUnit(raster,{x:.16,y:.30});assert.ok(traced);assert.ok(pointInPolygon({x:.17,y:.3},traced.polygon));assert.ok(pointInPolygon({x:.35,y:.55},traced.polygon));assert.equal(pointInPolygon({x:.36,y:.27},traced.polygon),false);assert.ok(traced.polygon.length>=6);
  pass('the shared tracer follows a synthetic L-shaped demise and excludes its rectangular empty corner');
  const checkpoints=[];let calls=0;
  const scanned=await scanPropertyPlanImage(png,options,[],async(...args)=>checkpoints.push(args),async(_sharp,_image,_w,_h,_x,_y,_fw,_fh,_known,_overview,regions)=>{calls++;const region=regions.find(row=>pointInPolygon({x:.16,y:.30},row.polygon));return region?[{unitRef:'A1',tenant:'Canonical Shop',seed:region.dot,polygon:region.polygon,regionId:region.id}]:[{unitRef:'A1',tenant:'Canonical Shop',seed:{x:.16,y:.30},polygon:null}];});
  assert.ok(calls>0);assert.ok(checkpoints.length>1);assert.equal(scanned.candidates.length,1);assert.equal(scanned.candidates[0].tenancy_unit_id,'t1');assert.equal(pointInPolygon({x:.36,y:.27},scanned.candidates[0].polygon.points.map(([x,y])=>({x,y}))),false);
  pass('actual scan engine uses verified traced geometry and canonical suggestions with a mocked identity reader');
  const covered=await scanPropertyPlanImage(png,options,[{polygon:scanned.candidates[0].polygon}],async()=>{},async()=>[{unitRef:'A1',tenant:null,seed:{x:.16,y:.30},polygon:null}]);assert.equal(covered.candidates.length,0);assert.match(covered.message,/kept unchanged/);
  pass('rescan excludes existing saved outlines instead of replacing them');
  const oriented=await sharp(raw,{raw:{width:400,height:300,channels:3}}).jpeg({quality:100}).withMetadata({orientation:6}).toBuffer();
  const orientedRaster=await propertyPlanRaster(oriented);assert.equal(orientedRaster.width,300);assert.equal(orientedRaster.height,400);
  const orientedTrace=tracePlanUnit(orientedRaster,{x:.7,y:.16});assert.ok(orientedTrace);assert.equal(pointInPolygon({x:.73,y:.36},orientedTrace.polygon),false);
  let orientedReads=0;
  const orientedScan=await scanPropertyPlanImage(oriented,options,[],async()=>{},async(_sharp,working,w,h,_x,_y,_fw,_fh,_known,_overview,regions)=>{orientedReads++;assert.equal(w,300);assert.equal(h,400);assert.equal((await sharp(working).metadata()).orientation,undefined);const region=regions.find(row=>pointInPolygon({x:.7,y:.16},row.polygon));return region?[{unitRef:'A1',tenant:null,seed:region.dot,polygon:region.polygon,regionId:region.id}]:[{unitRef:'A1',tenant:null,seed:{x:.7,y:.16},polygon:null}];});
  assert.ok(orientedReads>0);assert.equal(orientedScan.candidates.length,1);assert.equal(pointInPolygon({x:.73,y:.36},orientedScan.candidates[0].polygon.points.map(([x,y])=>({x,y}))),false);assert.equal((await sharp(oriented).metadata()).orientation,6);
  pass('EXIF-rotated JPEG trace and AI working copy share display coordinates while original bytes remain oriented');
  await db.query('DELETE FROM property_plan_units WHERE plan_id=$1',[scanPlanId]);
  const workerDeclaration=find('server/property-plan-scanning.ts',node=>ts.isFunctionDeclaration(node)&&node.name?.text==='runPropertyPlanScan');
  async function runWorker(jobId,intervene) {
    const job=(await db.query('SELECT * FROM property_plan_scans WHERE id=$1',[jobId])).rows[0];
    const plan=(await db.query('SELECT * FROM property_plans WHERE id=$1',[scanPlanId])).rows[0];
    const {run}=evaluate(workerDeclaration+'\nexports.run=runPropertyPlanScan;',{
      pool:db,setInterval,clearInterval,getFile:async()=>({data:png}),queryPickableUnits:links.queryPickableUnits,
      scanPropertyPlanImage:async(_image,_options,_existing,checkpoint)=>{
        await checkpoint('Reading synthetic identities',0,1);
        if(intervene)await intervene();
        return {candidates:scanned.candidates,message:'Synthetic review ready'};
      },
    });
    await run(job,plan);
  }
  const workerStart=await startPropertyPlanScan(db,scanPlanId,access);
  await runWorker(workerStart.job.id);
  const workerResult=(await db.query('SELECT * FROM property_plan_scans WHERE id=$1',[workerStart.job.id])).rows[0];assert.equal(workerResult.status,'ready');assert.equal(workerResult.candidates.length,1);assert.equal((await db.query('SELECT count(*)::int AS n FROM property_plan_units WHERE plan_id=$1',[scanPlanId])).rows[0].n,0);
  const freshConnection=new pg.Pool({connectionString:supplied,ssl:false,max:1,options:`-c search_path=${schema}`});
  try{const durable=(await freshConnection.query('SELECT * FROM property_plan_scans WHERE id=$1',[workerStart.job.id])).rows[0];assert.deepEqual(durable.candidates,workerResult.candidates);assert.equal(durable.status,'ready');}finally{await freshConnection.end();}
  pass('real worker persists review without geometry writes and a fresh database connection retrieves it');
  const expiredWorker=await startPropertyPlanScan(db,scanPlanId,access);
  await runWorker(expiredWorker.job.id,()=>db.query("UPDATE property_plan_scans SET status='failed',message='Expired during scan' WHERE id=$1",[expiredWorker.job.id]));
  let expired=(await db.query('SELECT * FROM property_plan_scans WHERE id=$1',[expiredWorker.job.id])).rows[0];assert.equal(expired.status,'failed');assert.equal(expired.message,'Expired during scan');assert.equal(expired.candidates.length,0);
  await runWorker(expiredWorker.job.id);expired=(await db.query('SELECT * FROM property_plan_scans WHERE id=$1',[expiredWorker.job.id])).rows[0];assert.equal(expired.status,'failed');assert.equal(expired.candidates.length,0);
  pass('worker losing its lease before completion or restarting after expiry cannot publish a review');
  const changedWorker=await startPropertyPlanScan(db,scanPlanId,access);
  await runWorker(changedWorker.job.id,()=>db.query("UPDATE property_plans SET storage_key='new-during-scan' WHERE id=$1",[scanPlanId]));
  const changed=(await db.query('SELECT * FROM property_plan_scans WHERE id=$1',[changedWorker.job.id])).rows[0];assert.notEqual(changed.status,'ready');assert.equal(changed.candidates.length,0);
  await db.query("UPDATE property_plans SET storage_key='synthetic-scan' WHERE id=$1",[scanPlanId]);await db.query("UPDATE property_plan_scans SET status='failed' WHERE id=$1",[changedWorker.job.id]);
  pass('worker never publishes proposals for a replaced image');
  const legacyDuplicate=await ready(scanPlanId,[{id:'candidate-3',label:'A1',polygon:rectangle(.6,.6)}]);
  await db.query("INSERT INTO property_plan_units(plan_id,unit_id,label,polygon) VALUES($1,'physical-1','Legacy A1',$2::jsonb)",[scanPlanId,JSON.stringify(rectangle(.1,.6))]);
  await rejectStatus(apply(legacyDuplicate,[assignment('candidate-3','A1','t1')]),409);
  pass('canonical assignment cannot duplicate an existing legacy physical-unit outline elsewhere on the floor');
  const traceRoutes=new Map();
  const traceDeclaration=find('server/property-plan-scanning.ts',(node,tree)=>ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(tree)==='router'&&node.expression.name.text==='post'&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='/api/plans/:planId/trace-unit');
  const failDeclaration=find('server/property-plan-scanning.ts',node=>ts.isFunctionDeclaration(node)&&node.name?.text==='fail');
  const {PropertyPlanScanError}=await import('../../server/property-plan-scan-store.ts');
  evaluate(failDeclaration+'\n'+traceDeclaration+';',{
    pool:db,requireAuth(){},requirePropertyPlan,PropertyPlanScanError,tracePlanUnit,propertyPlanRaster,
    access:req=>async propertyId=>req.scope===propertyId,getFile:async()=>({data:png}),
    router:{post:(path,_auth,fn)=>traceRoutes.set(path,fn)},
  });
  async function traceRequest(params,body,scope='property'){let status=200,data;const res={status(n){status=n;return res;},json(value){data=value;return res;}};await traceRoutes.get('/api/plans/:planId/trace-unit')({params,body,scope},res);return{status,data};}
  const tracedRoute=await traceRequest({planId},{x:.16,y:.3});assert.equal(tracedRoute.status,200,tracedRoute.data?.error);assert.equal(tracedRoute.data.imageKey,'synthetic-plan');assert.ok(tracedRoute.data.polygon.points.length>=6);
  assert.equal((await traceRequest({planId:otherPlanId},{x:.16,y:.3})).status,403);assert.equal((await traceRequest({planId:id(999)},{x:.16,y:.3})).status,404);assert.equal((await traceRequest({planId},{x:2,y:.3})).status,400);assert.equal((await traceRequest({planId},{x:.95,y:.95})).status,422);
  pass('actual trace route returns an L-shaped preview only and rejects foreign, missing, outside and unenclosed clicks');
  let uploadHandler;const savedFiles=[];
  const uploadDeclaration=find('server/property-plans.ts',(node,tree)=>ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(tree)==='router'&&node.expression.name.text==='post'&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='/api/properties/:propertyId/plans');
  evaluate(declaration('errorResponse')+'\n'+uploadDeclaration+';',{
    pool:db,sharp,crypto,PropertyPlanInputError:links.PropertyPlanInputError,requireAuth(){},
    clientBlockedForProperty:async(req,propertyId)=>req.scope!==propertyId,upload:{single:()=>()=>{}},
    saveFile:async(key,bytes,mime,name)=>savedFiles.push({key,bytes,mime,name}),
    router:{post:(_path,_auth,_upload,fn)=>uploadHandler=fn},
  });
  async function uploadRequest(bytes,propertyId='property'){let status=200,data;const res={status(n){status=n;return res;},json(value){data=value;return res;}};await uploadHandler({params:{propertyId},scope:'property',body:{floor:'QA Upload',width:1,height:1},file:{buffer:bytes,originalname:'synthetic.jpg',mimetype:'image/gif'}},res);return{status,data};}
  const uploaded=await uploadRequest(oriented);assert.equal(uploaded.status,200,uploaded.data?.error);assert.equal(uploaded.data.width,300);assert.equal(uploaded.data.height,400);assert.ok(savedFiles[0].bytes.equals(oriented));assert.equal(savedFiles[0].mime,'image/jpeg');assert.equal((await invoke('patch','/api/plans/:planId',{planId:uploaded.data.id},{width:999})).status,400);
  assert.equal((await uploadRequest(Buffer.from('not a real image'))).status,400);assert.equal((await uploadRequest(png.subarray(0,60))).status,400);assert.equal((await uploadRequest(png,'foreign')).status,403);assert.equal(savedFiles.length,1);
  pass('actual upload preserves original image bytes, derives oriented dimensions/type, rejects corruption and prevents dimension edits');
  const transparent=await sharp(Buffer.from('<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><path d="M40 40H95V135H180V210H40Z" fill="none" stroke="black" stroke-width="3"/></svg>')).png().toBuffer();
  const transparentRaster=await propertyPlanRaster(transparent);const bg=(250*400+300)*3;assert.deepEqual([...transparentRaster.data.subarray(bg,bg+3)],[255,255,255]);
  const transparentTrace=tracePlanUnit(transparentRaster,{x:.16,y:.3});assert.ok(transparentTrace);assert.equal(pointInPolygon({x:.36,y:.27},transparentTrace.polygon),false);
  let transparentReads=0;
  await scanPropertyPlanImage(transparent,options,[],async()=>{},async(_sharp,working)=>{transparentReads++;const image=await sharp(working).raw().toBuffer({resolveWithObject:true});const i=(250*image.info.width+300)*image.info.channels;assert.deepEqual([...image.data.subarray(i,i+3)],[255,255,255]);return[];});assert.ok(transparentReads>0);
  pass('transparent line plans flatten to browser-white consistently for click tracing and vision working frames');
  console.log(`PASS ${checks} property-plan PostgreSQL/route/scan checks`);
} finally {
  if(created)await db.query(`DROP SCHEMA ${schema} CASCADE`);
  await db.end();
}
