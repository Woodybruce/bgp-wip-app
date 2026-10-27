import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const require=createRequire(import.meta.url);
const {find,evaluate,ts,source}=require('./source-harness.cjs');
const file='server/brand-email-threads.ts';
const decl=name=>find(file,node=>(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText()===name))||(ts.isFunctionDeclaration(node)&&node.name?.text===name));
const privacy=evaluate(source('shared/private-mail.ts'));
const highlights=evaluate(source('server/landlord-email-highlights.ts'));
const module=evaluate(['LANDLORD_EMAIL_ROWS_SQL','BGP_DOMAIN','normSubject','cleanPreview','personList','groupEmailConversations'].map(decl).join('\n')+'\nexports.SQL=LANDLORD_EMAIL_ROWS_SQL;', {...privacy,...highlights});
const privacyPattern=find('server/private-mail-store.ts',n=>ts.isVariableDeclaration(n)&&n.name.getText()==='privateAddressPattern');
const privacyFunction=find('server/private-mail-store.ts',n=>ts.isTemplateExpression(n)&&n.head.text.startsWith('CREATE OR REPLACE FUNCTION bgp_private_mail_record'));
const privacySql=evaluate(`const ${privacyPattern}; export const sql=${privacyFunction};`).sql;
const nick='nick@brucegillinghampollard.com',ben='ben@brucegillinghampollard.com',manish='manish@eu.aew.com';

test('Landlord person email lookup filters messages before grouping, preserves contact links and rejects unrelated/private correspondence',async()=>{
 const schema=`landlord_person_${randomUUID().replaceAll('-','')}`;
 const pool=new pg.Pool({host:'/tmp',database:'postgres',max:1});
 try {
  await pool.query(`CREATE SCHEMA ${schema}`);await pool.query(`SET search_path TO ${schema}`);
  await pool.query(privacySql);
  await pool.query('CREATE TABLE crm_interactions(id text,microsoft_id text,company_id text,contact_id text,subject text,type text,direction text,bgp_user text,preview text,participants jsonb,interaction_date timestamptz)');
  let n=0;
  const add=(company,staff,participants,preview,contact=null)=>pool.query('INSERT INTO crm_interactions VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[
    String(++n),company,contact,'RE: Deal update','email','in',staff,preview,JSON.stringify(participants),new Date(Date.UTC(2020,0,n))]);
  await add('aew',nick,[nick,manish],'Nick earlier message');
  await add('aew',ben,[ben,manish],'Ben later message');
  await add('other',nick,[nick,'person@other.com'],'Unrelated company');
  await add(null,nick,[],'Linked saved contact only','manish-id');
  await add('aew',ben,[{emailAddress:{address:nick.toUpperCase()}}],'Nested participant');
  await add('aew',nick,[nick,privacy.PRIVATE_MAILBOX],'Private correspondence');
  const params=['aew',['aew.com'],[manish],nick,null,['manish-id']];
  const rows=(await pool.query(module.SQL,params)).rows;
  assert.deepEqual(rows.map(row=>row.preview),['Nested participant','Linked saved contact only','Nick earlier message']);
  const grouped=module.groupEmailConversations(rows,'aew.com',new Set([manish]),['aew.com']);
  assert.equal(grouped.length,1);assert.equal(grouped[0].messages,3);assert.equal(grouped[0].preview,'Nested participant');
  assert.doesNotMatch(JSON.stringify(grouped),/Ben later|Unrelated company|Private correspondence/);
  const forContact=(await pool.query(module.SQL,['aew',['aew.com'],[manish],manish,'manish-id',['manish-id']])).rows;
  assert.deepEqual(forContact.map(row=>row.preview),['Linked saved contact only','Ben later message','Nick earlier message']);
  const all=(await pool.query(module.SQL,['aew',['aew.com'],[manish],null,null,['manish-id']])).rows;
  assert.ok(all.some(row=>row.preview==='Ben later message'));assert.ok(!all.some(row=>row.preview==='Unrelated company'));
 } finally {await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
});

test('Landlord indexed candidates retain historical and nested domain/contact evidence without admitting broad text matches',async()=>{
 const schema=`landlord_candidates_${randomUUID().replaceAll('-','')}`;
 const pool=new pg.Pool({host:'/tmp',database:'postgres',max:1});
 try {
  await pool.query(`CREATE SCHEMA ${schema}`);await pool.query(`SET search_path TO ${schema},public`);
  await pool.query(privacySql);
  await pool.query('CREATE TABLE crm_interactions(id text PRIMARY KEY,microsoft_id text,company_id text,contact_id text,subject text,type text,direction text,bgp_user text,preview text,participants jsonb,interaction_date timestamptz)');
  const add=(id,participants,{company=null,contact=null,staff=nick,date='2001-01-01',type='email'}={})=>pool.query('INSERT INTO crm_interactions VALUES ($1,$1,$2,$3,$1,$4,$5,$6,$1,$7,$8)',[id,company,contact,type,'in',staff,JSON.stringify(participants),date]);
  await add('old-subdomain',['Person@EU.AEW.COM']);
  await add('nested-domain',[{emailAddress:{address:'person@eu.aew.com'}}]);
  await add('nested-contact',[{email:'external@different.com'}]);
  await add('contact-link',[],{contact:'linked-contact'});
  await add('company-link',[],{company:'aew'});
  await add('evil-domain',['person@aew.com.example.org']);
  await add('substring-contact',['notexternal@different.com']);
  await add('display-name-only',[{name:'external@different.com',email:'unrelated@other.com'}]);
  await add('not-email',['person@aew.com'],{type:'meeting'});
  await add('future',['person@aew.com'],{date:'2100-01-01'});
  // Plenty of newer messages must not crowd a scoped person's old history
  // out of the existing 1,500-message display limit.
  await pool.query(`INSERT INTO crm_interactions SELECT 'other-'||g,'other-'||g,'aew',null,'Other '||g,'email','in',$1,'Other colleague',jsonb_build_array($1::text,'person@aew.com'),'2020-01-01'::timestamptz FROM generate_series(1,1600) g`,[ben]);
  const params=['aew',['aew.com'],[manish,'external@different.com'],nick,null,['linked-contact']];
  const rows=(await pool.query(module.SQL,params)).rows;
  assert.deepEqual(rows.map(x=>x.preview).sort(),['old-subdomain','nested-domain','nested-contact','contact-link','company-link'].sort());
  const grouped=module.groupEmailConversations(rows,'aew.com',new Set([manish,'external@different.com']),['aew.com']);
  assert.deepEqual(Array.from(grouped.find(x=>x.subject==='nested-domain').brand),['person@eu.aew.com']);
  assert.deepEqual(Array.from(grouped.find(x=>x.subject==='nested-contact').brand),['external@different.com']);
 } finally {await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
});

test('Landlord candidate lookup uses existing lookup indexes instead of expanding the whole mail log',async()=>{
 const schema=`landlord_candidate_plan_${randomUUID().replaceAll('-','')}`;
 const pool=new pg.Pool({host:'/tmp',database:'postgres',max:1});
 try {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await pool.query(`CREATE SCHEMA ${schema}`);await pool.query(`SET search_path TO ${schema},public`);
  await pool.query(privacySql);
  await pool.query('CREATE TABLE crm_interactions(id text PRIMARY KEY,microsoft_id text,company_id text,contact_id text,subject text,type text,direction text,bgp_user text,preview text,participants jsonb,interaction_date timestamptz)');
  await pool.query(`INSERT INTO crm_interactions SELECT g::text,g::text,'other',null,'Noise','email','in',$1,'Unrelated',jsonb_build_array('other'||g||'@elsewhere.com'),'2020-01-01'::timestamptz FROM generate_series(1,24000) g`,[nick]);
  await pool.query(`INSERT INTO crm_interactions VALUES ('target','target',null,null,'Target','email','in',$1,'Older relevant mail',$2,'2001-01-01')`,[nick,JSON.stringify([nick,manish])]);
  await pool.query('CREATE INDEX candidate_company_idx ON crm_interactions(company_id)');
  await pool.query('CREATE INDEX candidate_contact_idx ON crm_interactions(contact_id)');
  await pool.query('CREATE INDEX candidate_participants_idx ON crm_interactions USING gin ((participants::text) gin_trgm_ops)');
  await pool.query('ANALYZE crm_interactions');
  const params=['aew',['aew.com'],[manish],nick,null,[]];
  const plan=(await pool.query('EXPLAIN (ANALYZE,FORMAT JSON) '+module.SQL,params)).rows[0]['QUERY PLAN'][0].Plan;
  const nodes=[];const walk=node=>{nodes.push(node);(node.Plans||[]).forEach(walk)};walk(plan);
  assert.ok(nodes.some(node=>node['Index Name']==='candidate_participants_idx'),'trigram index supplies domain candidates');
  assert.ok(!nodes.some(node=>node['Node Type']==='Seq Scan'&&node['Relation Name']==='crm_interactions'),'mail log is not scanned');
  assert.equal((await pool.query(module.SQL,params)).rows[0].preview,'Older relevant mail');
 } finally {await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
});

test('private Landlord mail is excluded before the 1,500-message limit and conversation evidence',async()=>{
 const schema=`landlord_private_limit_${randomUUID().replaceAll('-','')}`;
 const pool=new pg.Pool({host:'/tmp',database:'postgres',max:1});
 try {
  await pool.query(`CREATE SCHEMA ${schema}`);await pool.query(`SET search_path TO ${schema}`);
  await pool.query(privacySql);
  await pool.query('CREATE TABLE crm_interactions(id text PRIMARY KEY,microsoft_id text,company_id text,contact_id text,subject text,type text,direction text,bgp_user text,preview text,participants jsonb,interaction_date timestamptz)');
  await pool.query(`INSERT INTO crm_interactions SELECT 'private-'||g,'private-message-'||g,'aew',null,'Private terms','email','in',
    CASE WHEN g%2=0 THEN $1 ELSE $2 END,'PRIVATE TERMS',
    CASE WHEN g%2=0 THEN jsonb_build_array($3::text) ELSE jsonb_build_array(jsonb_build_object('emailAddress',jsonb_build_object('address',$1::text)),$3::text) END,
    '2020-01-01'::timestamptz FROM generate_series(1,1600) g`,[privacy.PRIVATE_MAILBOX,nick,manish]);
  await pool.query(`INSERT INTO crm_interactions VALUES('older-public','public-message','aew',null,'Public terms','email','in',$1,'The revised terms remain subject to landlord approval.',$2,'2001-01-01')`,[nick,JSON.stringify([nick,manish])]);
  const params=['aew',['aew.com'],[manish],null,null,[]];
  const rows=(await pool.query(module.SQL,params)).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].subject,'Public terms');
  const grouped=module.groupEmailConversations(rows,'aew.com',new Set([manish]),['aew.com']);
  assert.equal(grouped[0].messages,1);
  assert.doesNotMatch(JSON.stringify(grouped),/PRIVATE TERMS|Private terms|equity@/);
  assert.match(highlights.landlordEmailSummaryPrompt('AEW',grouped),/revised terms remain subject to landlord approval/);
 } finally {await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
});
