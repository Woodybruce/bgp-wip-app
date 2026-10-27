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
const nick='nick@brucegillinghampollard.com',ben='ben@brucegillinghampollard.com',manish='manish@eu.aew.com';

test('Landlord person email lookup filters messages before grouping, preserves contact links and rejects unrelated/private correspondence',async()=>{
 const schema=`landlord_person_${randomUUID().replaceAll('-','')}`;
 const pool=new pg.Pool({host:'/tmp',database:'postgres',max:1});
 try {
  await pool.query(`CREATE SCHEMA ${schema}`);await pool.query(`SET search_path TO ${schema}`);
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
  assert.deepEqual(rows.map(row=>row.preview),['Private correspondence','Nested participant','Linked saved contact only','Nick earlier message']);
  const grouped=module.groupEmailConversations(rows,'aew.com',new Set([manish]),['aew.com']);
  assert.equal(grouped.length,1);assert.equal(grouped[0].messages,3);assert.equal(grouped[0].preview,'Nested participant');
  assert.doesNotMatch(JSON.stringify(grouped),/Ben later|Unrelated company|Private correspondence/);
  const forContact=(await pool.query(module.SQL,['aew',['aew.com'],[manish],manish,'manish-id',['manish-id']])).rows;
  assert.deepEqual(forContact.map(row=>row.preview),['Linked saved contact only','Ben later message','Nick earlier message']);
  const all=(await pool.query(module.SQL,['aew',['aew.com'],[manish],null,null,['manish-id']])).rows;
  assert.ok(all.some(row=>row.preview==='Ben later message'));assert.ok(!all.some(row=>row.preview==='Unrelated company'));
 } finally {await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
});
