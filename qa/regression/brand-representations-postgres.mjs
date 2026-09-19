// Actual writes in an isolated schema of the disposable local QA database only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createBrandRepresentation, updateBrandRepresentation } from '../../server/brand-representations.ts';
const supplied=process.env.BRAND_REPRESENTATION_DATABASE_URL;
const url=new URL(supplied||'file:///');
if(url.hostname||url.pathname!=='/bgp_smoke'||url.searchParams.get('host')!=='/tmp/bgp-propertyqa-20260916/socket'||url.searchParams.get('port')!=='55446') throw new Error('Disposable local QA database required');
const schema=`qa_brand_reps_${process.pid}_${Date.now()}`;
const db=new pg.Pool({connectionString:supplied,ssl:false,options:`-c search_path=${schema}`});
let checks=0;
const check=async(name,work)=>{await work();checks++;console.log(`PASS ${name}`);};
try {
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`CREATE TABLE crm_companies(id text PRIMARY KEY,name text,company_type text,merged_into_id text,agent_type text);
    CREATE TABLE crm_contacts(id text PRIMARY KEY,name text,company_id text);
    CREATE TABLE brand_agent_representations(id text PRIMARY KEY DEFAULT gen_random_uuid(),brand_company_id text NOT NULL,agent_company_id text NOT NULL,primary_contact_id text,agent_type text NOT NULL,region text,start_date timestamp,end_date timestamp,notes text,updated_at timestamp DEFAULT now());
    INSERT INTO crm_companies(id,name,company_type) VALUES ('brand','Actual Brand','Tenant - Café'),('agency','Actual Agency','Agent'),('other','Other Agency','Agent');
    INSERT INTO crm_contacts VALUES ('unknown','Named Agent',NULL),('known','Known Agent','agency'),('wrong','Incorrect legacy attachment','brand');
    INSERT INTO brand_agent_representations(id,brand_company_id,agent_company_id,primary_contact_id,agent_type) VALUES ('legacy','brand','agency','known','tenant_rep');`);
  const migration=await readFile(new URL('../../migrations/0040_brand_agent_unknown_firm.sql',import.meta.url),'utf8');
  await check('nullable-firm migration is repeatable and preserves existing records',async()=>{
    await db.query(migration);await db.query(migration);
    assert.equal((await db.query("SELECT agent_company_id FROM brand_agent_representations WHERE id='legacy'")).rows[0].agent_company_id,'agency');
  });
  let unknown;
  await check('a named agent with no employer persists without changing people or creating companies',async()=>{
    unknown=await createBrandRepresentation(db,{brandCompanyId:'brand',primaryContactId:'unknown',agentType:'tenant_rep'});
    assert.equal(unknown.agent_company_id,null);assert.equal(unknown.primary_contact_id,'unknown');
    assert.equal((await db.query("SELECT company_id FROM crm_contacts WHERE id='unknown'")).rows[0].company_id,null);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_companies')).rows[0].n,3);
  });
  await check('known employer is reused while incorrect tenant employment remains unmodified',async()=>{
    assert.equal((await createBrandRepresentation(db,{brandCompanyId:'brand',primaryContactId:'known',agentType:'tenant_rep'})).agent_company_id,'agency');
    assert.equal((await createBrandRepresentation(db,{brandCompanyId:'brand',primaryContactId:'wrong',agentType:'tenant_rep'})).agent_company_id,null);
    assert.equal((await db.query("SELECT company_id FROM crm_contacts WHERE id='wrong'")).rows[0].company_id,'brand');
    assert.ok((await db.query('SELECT agent_type FROM crm_companies')).rows.every(row=>row.agent_type===null));
  });
  await check('invalid firm/contact pairs cannot be created or patched',async()=>{
    const before=(await db.query('SELECT count(*)::int AS n FROM brand_agent_representations')).rows[0].n;
    await assert.rejects(createBrandRepresentation(db,{brandCompanyId:'brand',primaryContactId:'known',agentCompanyId:'other',agentType:'tenant_rep'}),/does not match/);
    await assert.rejects(updateBrandRepresentation(db,unknown.id,{agentCompanyId:'agency'}),/does not match/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM brand_agent_representations')).rows[0].n,before);
    assert.equal((await db.query('SELECT agent_company_id FROM brand_agent_representations WHERE id=$1',[unknown.id])).rows[0].agent_company_id,null);
  });
  await check('the existing profile LEFT JOIN retains a named contact with Firm unconfirmed',async()=>{
    const result=(await db.query(`SELECT r.id,a.name AS agent_name,ct.name AS contact_name FROM brand_agent_representations r LEFT JOIN crm_companies a ON a.id=r.agent_company_id LEFT JOIN crm_contacts ct ON ct.id=r.primary_contact_id WHERE r.id=$1`,[unknown.id])).rows[0];
    assert.equal(result.agent_name,null);assert.equal(result.contact_name,'Named Agent');
  });
  await check('firm-only records work, deleting all parties is rejected, and ending a relationship leaves employment alone',async()=>{
    const firm=await createBrandRepresentation(db,{brandCompanyId:'brand',agentCompanyId:'agency',agentType:'investment'});
    await assert.rejects(updateBrandRepresentation(db,firm.id,{agentCompanyId:null}),/Choose an agent firm/);
    await updateBrandRepresentation(db,unknown.id,{end_date:'2026-09-17'});
    assert.ok((await db.query('SELECT end_date FROM brand_agent_representations WHERE id=$1',[unknown.id])).rows[0].end_date);
    assert.equal((await db.query("SELECT company_id FROM crm_contacts WHERE id='unknown'")).rows[0].company_id,null);
  });
  await check('contact change resolves the new person instead of carrying the old firm forward',async()=>{
    await updateBrandRepresentation(db,'legacy',{primaryContactId:'unknown'});
    const row=(await db.query("SELECT * FROM brand_agent_representations WHERE id='legacy'")).rows[0];
    assert.equal(row.primary_contact_id,'unknown');assert.equal(row.agent_company_id,null);
  });
  await check('removing a named contact keeps the existing valid agency relationship',async()=>{
    const representation=await createBrandRepresentation(db,{brandCompanyId:'brand',primaryContactId:'known',agentType:'tenant_rep'});
    await updateBrandRepresentation(db,representation.id,{primaryContactId:null});
    const row=(await db.query('SELECT * FROM brand_agent_representations WHERE id=$1',[representation.id])).rows[0];
    assert.equal(row.primary_contact_id,null);assert.equal(row.agent_company_id,'agency');
  });
  console.log(`PASS ${checks} PostgreSQL representation checks`);
} finally {try{await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await db.end();}}
