// Actual production helpers against a disposable PostgreSQL schema. No .env or
// provider calls. A shared throwaway schema enables real two-session lock tests;
// it is always dropped. The URL guard refuses any production/network database.
// CONTACT_VERIFY_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' node qa/regression/contact-verification-postgres.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const { evaluate, find, ts } = require('./source-harness.cjs');
const supplied = process.env.CONTACT_VERIFY_DATABASE_URL;
if (!supplied) throw new Error('Provide the disposable CONTACT_VERIFY_DATABASE_URL');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_crm_directory_regression'
  || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) {
  throw new Error('Refusing a database outside the disposable CRM audit socket');
}
const schema = `qa_contact_verify_${process.pid}_${Date.now()}`;
const db = new pg.Pool({ connectionString: supplied, ssl: false, max: 5,
  options: `-c search_path=${schema}`, application_name: schema });
const names = ['ensureTable', 'ContactVerificationError', 'contactVerificationSnapshotMatches',
  'loadContactVerificationBrandLinks', 'loadPendingContactVerifications', 'saveContactVerification', 'resolveContactVerification'];
const code = names.map(name => find('server/contact-verify.ts', node =>
  (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === name)).join('\n');
const { loadPendingContactVerifications: pending, loadContactVerificationBrandLinks: links,
  saveContactVerification: save, resolveContactVerification: resolve } = evaluate(code, { pool: db });
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
const reject = async (name, fn, errorCode) => {
  await assert.rejects(fn, error => error.code === errorCode && error.status >= 400);
  checks++; console.log(`PASS ${name}`);
};
async function contact(id, companyId = 'brand', companyName = 'Brand') {
  await db.query('INSERT INTO crm_contacts (id,name,company_id,company_name,notes) VALUES ($1,$5,$2,$3,$4)', [id,companyId,companyName,'Original note',id]);
}
async function finding(contactId, options = {}) {
  const { status = 'mismatch', suggested = 'Agency', current = 'Brand', evidence = {companyIdAtVerification:'brand'},
    resolution = null, created = '2026-01-01' } = options;
  return (await db.query(`INSERT INTO contact_verifications
    (contact_id,status,confidence,current_company_name,suggested_company_name,evidence,resolution,created_at)
    VALUES ($1,$2,'high',$3,$4,$5,$6,$7) RETURNING id`,
  [contactId,status,current,suggested,JSON.stringify(evidence),resolution,created])).rows[0].id.toString();
}
const getContact = async id => (await db.query('SELECT * FROM crm_contacts WHERE id=$1',[id])).rows[0];
const getFinding = async id => (await db.query('SELECT * FROM contact_verifications WHERE id=$1',[id])).rows[0];
const verdict = { status:'mismatch',confidence:'high',suggestedCompanyName:'Agency',reasoning:'Synthetic evidence' };
try {
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`
    CREATE TABLE crm_companies (id varchar PRIMARY KEY, name text, merged_into_id varchar);
    CREATE TABLE crm_contacts (id varchar PRIMARY KEY, name text, email text, company_id varchar, company_name text,
      notes text, updated_at timestamp DEFAULT now());
    CREATE TABLE contact_verifications (id serial PRIMARY KEY, contact_id varchar NOT NULL, status text NOT NULL,
      confidence text, current_company_name text, suggested_company_name text, reasoning text, evidence jsonb,
      resolution text, resolved_by varchar, resolved_at timestamp, created_at timestamp DEFAULT now());
    CREATE TABLE crm_requirements_leasing (id varchar PRIMARY KEY, company_id varchar, agent_contact_id varchar,
      principal_contact_id varchar, status text);
    CREATE TABLE brand_agent_representations (id varchar PRIMARY KEY, brand_company_id varchar,
      agent_company_id varchar, primary_contact_id varchar, agent_type text, start_date timestamp, end_date timestamp);
    CREATE TABLE crm_contact_requirements (contact_id varchar, requirement_id varchar);
    CREATE TABLE crm_deals (id varchar, acquisition_agent_contact_id varchar);
    INSERT INTO crm_companies VALUES ('brand','Brand',NULL),('second-brand','Second Brand',NULL),('agency','Agency',NULL),
      ('alternate','Verified Employer Limited',NULL),('renamed-id','Brand',NULL),('merged','Merged Agency','agency'),
      ('duplicate-a','Duplicate Agency',NULL),('duplicate-b','DUPLICATE AGENCY',NULL),('old-brand','Old Brand','brand');
  `);
  for (const id of ['dedupe','confirmed','dismissed','changed','same-name-id','already-correct','missing-employer','legacy',
    'legacy-stale','null-employer','null-snapshot-changed','unknown-suggestion','merged-suggestion','brand-links']) await contact(id);
  await finding('dedupe'); const dedupe = await finding('dedupe');
  await finding('confirmed'); await finding('confirmed',{status:'confirmed',created:'2026-01-02'});
  await finding('dismissed'); await finding('dismissed',{resolution:'dismissed',created:'2026-01-02'});
  await finding('changed'); await db.query("UPDATE crm_contacts SET company_id='agency',company_name='Agency' WHERE id='changed'");
  await finding('same-name-id'); await db.query("UPDATE crm_contacts SET company_id='renamed-id' WHERE id='same-name-id'");
  await finding('already-correct',{suggested:' brand '});
  await finding('missing-employer',{suggested:'Agency Not Yet In CRM'});
  await finding('legacy',{evidence:{}});
  await finding('legacy-stale',{evidence:{},current:'Old Employer'});
  await db.query("UPDATE crm_contacts SET company_id=NULL,company_name=NULL WHERE id='null-employer'");
  await finding('null-employer',{current:null,evidence:{companyIdAtVerification:null}});
  await finding('null-snapshot-changed',{current:null,evidence:{companyIdAtVerification:null}});
  await finding('unknown-suggestion',{suggested:null});
  await finding('merged-suggestion',{suggested:'Merged Agency'});
  await finding('brand-links');
  await db.query(`
    INSERT INTO crm_requirements_leasing VALUES
      ('req','brand','brand-links',NULL,'Active'),('req-duplicate','brand','brand-links',NULL,' Active '),
      ('req-null','second-brand','brand-links',NULL,NULL),('req-old','second-brand','brand-links',NULL,'Past'),
      ('req-principal','second-brand',NULL,'legacy','Active'),('req-merged','old-brand','brand-links',NULL,'Active');
    INSERT INTO brand_agent_representations VALUES
      ('rep','brand','agency','brand-links','tenant_rep',NULL,NULL),
      ('rep-ended','second-brand','agency','brand-links','tenant_rep',NULL,'2025-01-01'),
      ('rep-future','second-brand','agency','brand-links','tenant_rep','2999-01-01',NULL),
      ('rep-landlord','second-brand','agency','brand-links','landlord_rep',NULL,NULL);
  `);
  let queue = await pending();
  check('one current finding per contact, with newest ID breaking equal timestamps',()=>{
    assert.equal(queue.filter(row=>row.contact_id==='dedupe').length,1);
    assert.equal(String(queue.find(row=>row.contact_id==='dedupe').id),dedupe);
  });
  check('newer confirmed and dismissed findings suppress older unresolved mismatches',()=>{
    assert.ok(queue.every(row=>!['confirmed','dismissed'].includes(row.contact_id)));
  });
  check('changed employer IDs invalidate old findings, including same-name companies',()=>{
    assert.ok(queue.every(row=>!['changed','same-name-id','null-snapshot-changed'].includes(row.contact_id)));
  });
  check('already-correct employer names do not produce actionable warnings',()=>assert.ok(!queue.some(row=>row.contact_id==='already-correct')));
  check('missing, unknown and merged employer suggestions remain reviewable',()=>{
    for(const id of ['missing-employer','unknown-suggestion','merged-suggestion']) assert.ok(queue.some(row=>row.contact_id===id));
  });
  check('legacy name snapshots work, while legacy stale snapshots are excluded',()=>{
    assert.ok(queue.some(row=>row.contact_id==='legacy')); assert.ok(!queue.some(row=>row.contact_id==='legacy-stale'));
  });
  check('an unchanged null employer remains reviewable',()=>assert.ok(queue.some(row=>row.contact_id==='null-employer')));
  const brandLinks=queue.find(row=>row.contact_id==='brand-links').brand_links;
  check('queue distinguishes current requirements and tenant-rep representation from employment',()=>{
    assert.deepEqual(JSON.parse(JSON.stringify(brandLinks)),[
      {id:'brand',name:'Brand',source:'representation'},{id:'brand',name:'Brand',source:'requirement'},
      {id:'second-brand',name:'Second Brand',source:'requirement'},
    ]);
  });
  check('principal-only contacts are not labelled brand agents',()=>assert.equal(queue.find(row=>row.contact_id==='legacy').brand_links.length,0));
  const emptyLinks=await links([]);
  check('empty contact set produces no relationship evidence',()=>assert.deepEqual(JSON.parse(JSON.stringify(emptyLinks)),{}));
  for(let n=0;n<110;n++){ await contact(`bulk-${n}`);await finding(`bulk-${n}`); }
  queue=await pending();
  check('pending contact counts are not truncated at the old 100-row cap',()=>assert.equal(queue.filter(row=>row.contact_id.startsWith('bulk-')).length,110));

  const missing=String(queue.find(row=>row.contact_id==='missing-employer').id);
  await reject('missing employer does not produce notes-only success',()=>resolve(missing,'apply','staff'),'EMPLOYER_SELECTION_REQUIRED');
  const unchanged=await getContact('missing-employer'); const stillOpen=await getFinding(missing);
  check('missing employer failure retains original identity and note, with pending finding',()=>{
    assert.equal(unchanged.company_id,'brand');assert.equal(unchanged.notes,'Original note');assert.equal(stillOpen.resolution,null);
  });
  await contact('ambiguous'); const ambiguous=await finding('ambiguous',{suggested:'Duplicate Agency'});
  await reject('duplicate company names require explicit selection',()=>resolve(ambiguous,'apply','staff'),'EMPLOYER_SELECTION_REQUIRED');
  await reject('merged companies cannot be explicitly selected',()=>resolve(missing,'apply','staff','merged'),'COMPANY_UNAVAILABLE');
  await reject('invalid explicit company is rejected before mutations',()=>resolve(missing,'apply','staff',{}),'INVALID_COMPANY');
  const selected=await resolve(missing,'apply','staff','alternate');
  check('staff-selected employer can resolve a different or absent suggested company name',()=>assert.equal(selected.linkedCompany,'Verified Employer Limited'));
  const selectedContact=await getContact('missing-employer');
  check('successful correction updates canonical and displayed employer together',()=>{
    assert.equal(selectedContact.company_id,'alternate');assert.equal(selectedContact.company_name,'Verified Employer Limited');
  });
  await reject('resolved finding cannot be applied twice',()=>resolve(missing,'apply','staff','agency'),'FINDING_RESOLVED');
  await reject('an older finding cannot overwrite the latest verification',async()=>{
    const old=(await db.query("SELECT id FROM contact_verifications WHERE contact_id='dedupe' ORDER BY id LIMIT 1")).rows[0];
    return resolve(String(old.id),'apply','staff');
  },'FINDING_OUTDATED');
  const changed=(await db.query("SELECT id FROM contact_verifications WHERE contact_id='changed'")).rows[0];
  await reject('stale snapshot cannot overwrite a newer employer correction',()=>resolve(String(changed.id),'apply','staff','alternate'),'CONTACT_CHANGED');
  await db.query(`INSERT INTO crm_contact_requirements VALUES ('dedupe','req');
    INSERT INTO crm_deals VALUES ('deal','dedupe');
    INSERT INTO crm_requirements_leasing VALUES ('req-person','brand','dedupe',NULL,'Active');
    INSERT INTO brand_agent_representations VALUES ('rep-person','brand','agency','dedupe','tenant_rep',NULL,NULL)`);
  const beforeLinks=(await db.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(q)) FROM crm_requirements_leasing q) AS requirements,
    (SELECT jsonb_agg(to_jsonb(r)) FROM brand_agent_representations r) AS representations,
    (SELECT jsonb_agg(to_jsonb(j)) FROM crm_contact_requirements j) AS junctions,
    (SELECT jsonb_agg(to_jsonb(d)) FROM crm_deals d) AS deals`)).rows[0];
  const applied=await resolve(dedupe,'apply','staff');
  check('unique exact suggested employer applies without guessing',()=>assert.equal(applied.linkedCompany,'Agency'));
  const afterLinks=(await db.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(q)) FROM crm_requirements_leasing q) AS requirements,
    (SELECT jsonb_agg(to_jsonb(r)) FROM brand_agent_representations r) AS representations,
    (SELECT jsonb_agg(to_jsonb(j)) FROM crm_contact_requirements j) AS junctions,
    (SELECT jsonb_agg(to_jsonb(d)) FROM crm_deals d) AS deals`)).rows[0];
  check('employer correction preserves every requirement, representation, deal and junction ID',()=>assert.deepEqual(afterLinks,beforeLinks));
  const resolutions=(await db.query("SELECT resolution FROM contact_verifications WHERE contact_id='dedupe' ORDER BY id")).rows.map(r=>r.resolution);
  check('successful apply resolves its selected finding and supersedes historical pending rows',()=>assert.deepEqual(resolutions,['superseded','applied']));
  await contact('dismiss-all');await finding('dismiss-all');const dismissAll=await finding('dismiss-all');
  await resolve(dismissAll,'dismiss','staff');
  const dismissedRows=(await db.query("SELECT resolution FROM contact_verifications WHERE contact_id='dismiss-all' ORDER BY id")).rows.map(r=>r.resolution);
  const dismissedContact=await getContact('dismiss-all');
  check('dismiss clears historical pending findings and retains the contact employer',()=>{
    assert.deepEqual(dismissedRows,['superseded','dismissed']);assert.equal(dismissedContact.company_id,'brand');
  });

  await contact('atomic');const atomic=await finding('atomic');
  await db.query("ALTER TABLE contact_verifications ADD CONSTRAINT synthetic_atomic_failure CHECK (contact_id <> 'atomic' OR resolution IS DISTINCT FROM 'applied')");
  await assert.rejects(()=>resolve(atomic,'apply','staff'),error=>error.code==='23514');
  const atomicContact=await getContact('atomic');const atomicFinding=await getFinding(atomic);
  check('a failed finding write rolls back the preceding employer and note changes',()=>{
    assert.equal(atomicContact.company_id,'brand');assert.equal(atomicContact.notes,'Original note');assert.equal(atomicFinding.resolution,null);
  });
  await contact('concurrent');const concurrent=await finding('concurrent');
  // Hold the contact so both independent review transactions overlap instead
  // of relying on process timing to happen to exercise the race.
  const blocker=await db.connect();
  let simultaneousPromise;let overlapping=false;
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT id FROM crm_contacts WHERE id='concurrent' FOR UPDATE");
    simultaneousPromise=Promise.allSettled([resolve(concurrent,'apply','staff-a','agency'),resolve(concurrent,'apply','staff-b','alternate')]);
    for(let attempt=0;attempt<50;attempt++){
      const waiting=(await db.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[schema])).rows[0].n;
      if(waiting>=2){overlapping=true;break;}
      await new Promise(done=>setTimeout(done,20));
    }
  } finally {
    await blocker.query('COMMIT');blocker.release();
  }
  const simultaneous=await simultaneousPromise;
  check('both independent review transactions actually overlap behind the held contact lock',()=>assert.equal(overlapping,true));
  check('two simultaneous employer corrections cannot both succeed',()=>{
    assert.equal(simultaneous.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(simultaneous.find(r=>r.status==='rejected').reason.code,'FINDING_RESOLVED');
  });
  const concurrentContact=await getContact('concurrent');const concurrentFinding=await getFinding(concurrent);
  check('simultaneous corrections leave one coherent winning employer and reviewer',()=>{
    const winner=simultaneous.find(r=>r.status==='fulfilled').value.linkedCompany;
    assert.equal(concurrentContact.company_name,winner);assert.equal(concurrentFinding.resolution,'applied');
    assert.equal(concurrentFinding.resolved_by,winner==='Agency'?'staff-a':'staff-b');
  });
  await contact('apply-dismiss');const applyDismiss=await finding('apply-dismiss');
  const mixed=await Promise.allSettled([resolve(applyDismiss,'apply','staff-a'),resolve(applyDismiss,'dismiss','staff-b')]);
  check('concurrent Apply and Dismiss permit only one resolution',()=>assert.equal(mixed.filter(r=>r.status==='fulfilled').length,1));

  await contact('save');
  const saved=await save({id:'save',name:'Save',company_id:'brand',company_name:'Brand',verification_id_at_start:null},verdict,{brandLinks:[]});
  check('new verification records canonical employer snapshot in existing evidence JSON',()=>assert.equal(saved.evidence.companyIdAtVerification,'brand'));
  await db.query("UPDATE crm_contacts SET company_id='agency',company_name='Agency' WHERE id='save'");
  await reject('slow verification cannot reintroduce a finding after employer correction',()=>save({id:'save',company_id:'brand',company_name:'Brand'},verdict,{}),'CONTACT_CHANGED');
  await contact('save-review'); const reviewFinding=await finding('save-review');
  const reviewSnapshot={id:'save-review',company_id:'brand',company_name:'Brand',verification_id_at_start:Number(reviewFinding),verification_resolution_at_start:null};
  await resolve(reviewFinding,'dismiss','staff');
  await reject('slow verification cannot requeue a finding dismissed during its lookup',()=>save(reviewSnapshot,verdict,{}),'VERIFICATION_CHANGED');
  await contact('save-newer');const first=await finding('save-newer'); await finding('save-newer');
  await reject('overlapping verification rejects a result superseded while lookups ran',()=>save({id:'save-newer',company_id:'brand',company_name:'Brand',verification_id_at_start:Number(first)},verdict,{}),'VERIFICATION_CHANGED');
  console.log(`PASS ${checks} PostgreSQL contact-verification checks`);
} finally {
  try { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
  finally { await db.end(); }
}
