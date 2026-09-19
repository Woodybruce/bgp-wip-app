// Real concurrent transactions in an isolated schema of the disposable QA database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const supplied = process.env.VIEWING_TEST_DATABASE_URL;
if (!supplied) throw new Error('Provide VIEWING_TEST_DATABASE_URL for the disposable database');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_smoke' || url.searchParams.get('host') !== '/tmp/bgp-propertyqa-20260916/socket' || url.searchParams.get('port') !== '55446') throw new Error('Refusing non-disposable database');
const admin = new pg.Pool({ connectionString: supplied, ssl: false });
const schema = `qa_offer_atomic_${Date.now()}`;
const lockKey = Math.floor(Math.random() * 1_000_000_000) + 1;
let appPool, control, probe;
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
const until = async condition => {
  for (let attempt = 0; attempt < 100; attempt++) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Expected database lock was not observed');
};
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const table of ['users','user_tasks','crm_companies','crm_contacts','crm_properties','crm_company_properties','available_units','unit_viewings','unit_offers','crm_requirements_leasing','brand_agent_representations','crm_property_agents','crm_client_team_members']) {
    await admin.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
  }
  url.searchParams.set('options', `-c search_path=${schema},public`);
  url.searchParams.set('application_name', schema);
  process.env.DATABASE_URL = url.toString(); process.env.PGSSLMODE = 'disable'; delete process.env.VIEWING_REMINDER_EMAILS_ENABLED;
  const { pool } = await import('../../server/db.ts'); appPool = pool;
  const { ensureLeasingViewingSchema } = await import('../../server/viewing-schema.ts'); await ensureLeasingViewingSchema();
  const { createTrackerOffer, patchTrackerOffer, patchLeasingViewing } = await import('../../server/leasing-viewings.ts');
  const ids = Object.fromEntries(['owner','property','unit','unit2','viewing','brand','otherBrand','unlinked'].map(key => [key,randomUUID()]));
  await pool.query(`INSERT INTO users(id,username,password,name,email,team) VALUES ($1,'atomic-owner','unused','Atomic Owner','atomic-owner@brucegillinghampollard.com','National Leasing')`, [ids.owner]);
  await pool.query(`INSERT INTO crm_companies(id,name,company_type) VALUES ($1,'Original Brand','Tenant - Retail'),($2,'Other Brand','Tenant - Retail')`, [ids.brand,ids.otherBrand]);
  await pool.query(`INSERT INTO crm_properties(id,name) VALUES ($1,'Atomic Property')`,[ids.property]);
  await pool.query(`INSERT INTO available_units(id,property_id,unit_name) VALUES ($1,$3,'Unit 1'),($2,$3,'Unit 2')`, [ids.unit,ids.unit2,ids.property]);
  await pool.query(`INSERT INTO unit_viewings(id,unit_id,company_id,company_name,viewing_date,viewing_time,owner_user_id,details_confirmed_at)
    VALUES ($1,$2,$3,'Original Brand','2026-09-01','10:00',$4,NOW())`, [ids.viewing,ids.unit,ids.brand,ids.owner]);
  await pool.query(`CREATE FUNCTION ${schema}.pause_offer_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${lockKey}::bigint); RETURN NEW; END $$;
    CREATE TRIGGER pause_offer_write BEFORE INSERT OR UPDATE ON ${schema}.unit_offers FOR EACH ROW EXECUTE FUNCTION ${schema}.pause_offer_write()`);
  control = await admin.connect(); probe = await admin.connect();
  const request = { session: { userId: ids.owner }, _companyScopeResolved:true, _companyScope:null };
  const awaitingInsert = () => admin.query(`SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
    WHERE a.application_name=$1 AND l.locktype='advisory' AND l.objid=$2::oid AND NOT l.granted`, [schema,lockKey]).then(result => !!result.rows.length);
  await control.query('SELECT pg_advisory_lock($1::bigint)', [lockKey]);
  const creating = createTrackerOffer(request,ids.unit,{viewingId:ids.viewing,companyId:ids.otherBrand,companyName:'Wrong input',offerDate:'2026-09-02',rentPa:12345678,premium:15000,breakOption:'Year 5',comments:'Preserve terms'});
  await until(awaitingInsert);
  await assert.rejects(probe.query(`SELECT id FROM ${schema}.unit_viewings WHERE id=$1 FOR UPDATE NOWAIT`,[ids.viewing]), error => error.code === '55P03');
  check('viewing row remains locked while the actual offer INSERT is paused',()=>{});
  let editFinished = false;
  const editing = patchLeasingViewing(request,ids.viewing,{companyId:ids.otherBrand}).then(value => ({value}),error => ({error})).finally(()=>{editFinished=true;});
  await until(async () => (await admin.query(`SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM unit_viewings%'`,[schema])).rows.length>0);
  check('concurrent viewing identity edit waits for the pending offer transaction',()=>assert.equal(editFinished,false));
  await control.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey]);
  const created = await creating;
  const edit = await editing;
  check('after insertion the waiting identity edit is rejected and cannot create a brand mismatch',()=>{assert.equal(edit.error?.status,409);assert.equal(created.companyId,ids.brand);assert.equal(created.companyName,'Original Brand');assert.equal(created.viewingId,ids.viewing);});
  check('linked create preserves unrelated offer terms and the existing high-value rent allowance',()=>{assert.equal(created.rentPa,12345678);assert.equal(created.premium,15000);assert.equal(created.breakOption,'Year 5');assert.equal(created.comments,'Preserve terms');assert.ok(created.confirmedAt);});

  await control.query('SELECT pg_advisory_lock($1::bigint)', [lockKey]);
  const updating = patchTrackerOffer(request,created.id,{rentPa:220000,comments:'Revised terms',companyId:ids.otherBrand,unitId:ids.unit2,viewingId:null,confirmedAt:null});
  await until(awaitingInsert);
  await assert.rejects(probe.query(`SELECT id FROM ${schema}.unit_viewings WHERE id=$1 FOR UPDATE NOWAIT`,[ids.viewing]), error => error.code === '55P03');
  check('linked offer UPDATE also retains its viewing lock through the database write',()=>{});
  await control.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey]);
  const updated = await updating;
  check('offer patch keeps original unit/viewing, authoritative brand and confirmation while updating terms',()=>{assert.equal(updated.unitId,ids.unit);assert.equal(updated.viewingId,ids.viewing);assert.equal(updated.companyId,ids.brand);assert.ok(updated.confirmedAt);assert.equal(updated.rentPa,220000);assert.equal(updated.comments,'Revised terms');assert.equal(updated.premium,15000);});

  const detected = (await pool.query(`INSERT INTO unit_offers(id,unit_id,company_id,offer_date,source) VALUES ($1,$2,$3,'2026-09-02','email') RETURNING *`,[ids.unlinked,ids.unit,ids.brand])).rows[0];
  const editedDetected = await patchTrackerOffer(request,detected.id,{rentPa:60000,confirmedAt:new Date()});
  check('editing an unlinked detected offer cannot silently confirm it',()=>{assert.equal(editedDetected.confirmedAt,null);assert.equal(editedDetected.viewingId,null);assert.equal(editedDetected.source,'email');});
  await assert.rejects(createTrackerOffer(request,ids.unit2,{viewingId:ids.viewing,offerDate:'2026-09-02'}),error=>error.status===400);
  await assert.rejects(createTrackerOffer(request,ids.unit,{viewingId:ids.viewing,offerDate:'2026-09-02',rentPa:'bad'}),error=>error.status===400);
  check('wrong-unit links and invalid values roll back without another offer',()=>{});
  const rows=(await pool.query('SELECT * FROM unit_offers')).rows;
  check('only the two expected offers exist and every linked offer agrees with its viewing',()=>{assert.equal(rows.length,2);assert.ok(rows.filter(row=>row.viewing_id).every(row=>row.unit_id===ids.unit&&row.company_id===ids.brand));});
  console.log(`${checks} atomic viewing-offer PostgreSQL checks passed.`);
} finally {
  if (control) { await control.query('SELECT pg_advisory_unlock_all()').catch(()=>{}); control.release(); }
  if (probe) probe.release();
  if (appPool) await appPool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
