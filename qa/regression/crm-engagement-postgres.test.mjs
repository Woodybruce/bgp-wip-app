import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { CRM_ENGAGEMENT_MIGRATIONS, createCrmEngagementRouter, getCrmEngagementData } from '../../server/crm-engagement.ts';

test('CRM planning preserves Marketing and My Tasks records, scopes links and rejects untrusted or private access', async t => {
  const schema='crm_engagement_'+randomUUID().replaceAll('-','');
  const pool=new pg.Pool({host:'/tmp',database:'postgres',max:1});
  let server;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);await pool.query(`SET search_path TO ${schema},public`);
    await pool.query(`
      CREATE TABLE users(id varchar PRIMARY KEY,name text,email text,role text,is_active boolean,client_view_mode boolean);
      CREATE TABLE crm_companies(id varchar PRIMARY KEY,name text,company_type text,merged_into_id varchar);
      CREATE TABLE crm_contacts(id varchar PRIMARY KEY,name text,company_id varchar,email text,role text);
      CREATE TABLE crm_deals(id varchar,landlord_id varchar,status text);
      CREATE TABLE crm_properties(id varchar,freeholder_id varchar,long_leaseholder_id varchar,asset_manager_id varchar);
      CREATE TABLE crm_interviews(id varchar PRIMARY KEY,team text,interviewee text,meeting_date date,updated_at timestamp DEFAULT now(),responses jsonb);
      CREATE TABLE marketing_campaigns(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),name text,objective text,team text,lead_user_id varchar,status text,created_at timestamp DEFAULT now());
      CREATE TABLE marketing_events(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),title text,kind text,starts_at timestamp,ends_at timestamp,location text,description text,lead_user_id varchar,status text,external_url text,attendee_user_ids text[],attendee_contact_ids text[],created_by_user_id varchar,created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now());
      CREATE TABLE user_tasks(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),user_id varchar,title text,description text,due_date timestamp,status text,category text,created_at timestamp DEFAULT now(),completed_at timestamp);
      INSERT INTO users VALUES
        ('owner','Owner','owner@brucegillinghampollard.com','Staff',true,false),
        ('colleague','Colleague','colleague@brucegillinghampollard.com','Staff',true,false),
        ('other','Other staff','other@brucegillinghampollard.com','Staff',true,false),
        ('client','Client','client@example.com','Client',true,false),
        ('inactive','Inactive','inactive@brucegillinghampollard.com','Staff',false,false),
        ('client-mode','Preview','preview@brucegillinghampollard.com','Staff',true,true),
        ('equity','Equity','equity@brucegillinghampollard.com','Staff',true,false);
      INSERT INTO crm_companies VALUES ('landsec','Landsec','Landlord',null),('aew','AEW','Investor',null),('brand','Brand','Tenant - Restaurant',null);
      INSERT INTO crm_contacts VALUES ('jon','Jon','landsec','jon@landsec.com','Leasing'),('manish','Manish','aew','manish@aew.com','Investment'),('private','Private','landsec','equity@brucegillinghampollard.com',null),('brand-contact','Brand contact','brand','brand@example.com',null);
      INSERT INTO marketing_events(id,title,status,starts_at,attendee_contact_ids) VALUES ('legacy','Existing Marketing entry','planned','2026-11-01T09:00:00',ARRAY['jon']);
      ALTER TABLE crm_companies ADD COLUMN domain text;
      ALTER TABLE crm_companies ADD COLUMN domain_url text;
      INSERT INTO crm_interviews(id,team,interviewee,responses) VALUES
        ('interview-1','Leasing','Account lead','{"rl1":"Landsec needs a follow-up on operator introductions.","nb1":"AEW has investment requirements to discuss."}');
    `);
    for(const sql of CRM_ENGAGEMENT_MIGRATIONS)await pool.query(sql);
    // The migrations are safe to reapply on every startup.
    for(const sql of CRM_ENGAGEMENT_MIGRATIONS)await pool.query(sql);
    const app=express();app.use(express.json());
    app.use('/api/crm/engagement',createCrmEngagementRouter({pool,
      requireAuth:(req,_res,next)=>{req.tokenUserId=req.headers['x-user'];next();},
      resolveScope:async req=>req.headers['x-scope']||null}));
    app.use('/crm-not-ready',createCrmEngagementRouter({pool,
      requireAuth:(req,_res,next)=>{req.tokenUserId=req.headers['x-user'];next();},
      resolveScope:async()=>null,schemaReady:Promise.resolve(false)}));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const base=`http://127.0.0.1:${server.address().port}/api/crm/engagement`;
    const request=async(method,path='',body,user='owner',scope=null)=>{
      const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(user?{'x-user':user}:{}),...(scope?{'x-scope':scope}:{})},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,body:await response.json()};
    };
    const strategy={name:'Retail introductions',objective:'Arrange relevant operator introductions',team:'Leasing',ownerId:'owner',status:'active',startsOn:'2026-11-01',endsOn:'2026-12-31',targets:[{companyId:'landsec',reason:'Current leasing work',contactIds:['jon']}]};
    const event={title:'Retail breakfast',kind:'bgp',startsAt:'2026-11-12T09:00:00Z',endsAt:'2026-11-12T10:30:00Z',location:'London',description:'Discuss current requirements',ownerId:'owner',status:'planned',sourceUrl:null,dateConfirmed:true,outcome:null,strategyIds:[],companies:[{companyId:'landsec',reason:'Introduce operators relevant to the leasing brief'}],guests:[{contactId:'jon',status:'suggested'}]};
    let strategyId,eventId,actionId;

    await t.test('only active BGP staff outside client view can read or change plans',async()=>{
      for(const user of [null,'client','inactive','client-mode','equity','missing']) {
        assert.equal((await request('GET','',null,user)).status,403);
        assert.equal((await request('POST','/strategies',strategy,user)).status,403);
      }
      assert.equal((await request('GET','',null,'owner','landsec')).status,403);
      const options=await request('GET','/options');assert.equal(options.status,200);
      assert.deepEqual(options.body.staff.map(x=>x.id).sort(),['colleague','other','owner']);
      assert.deepEqual(options.body.companies.map(x=>x.id).sort(),['aew','landsec']);
      assert.deepEqual(options.body.contacts.map(x=>x.id).sort(),['jon','manish']);
      assert.ok(!JSON.stringify(options.body).includes('@'),'options do not include email addresses');
      const notReady=await fetch(`http://127.0.0.1:${server.address().port}/crm-not-ready`,{headers:{'x-user':'owner'}});
      assert.equal(notReady.status,503,'a failed startup schema batch fails closed instead of running DDL on GET');
    });

    await t.test('strategies validate dates and exact contact/company associations before saving',async()=>{
      for(const bad of [
        {...strategy,startsOn:'2026-02-31'}, {...strategy,endsOn:'2026-10-01'},
        {...strategy,targets:[{companyId:'brand',reason:'Not a landlord',contactIds:[]}]},
        {...strategy,targets:[{companyId:'landsec',reason:'',contactIds:[]}]},
        {...strategy,targets:[{companyId:'landsec',reason:'Mismatch',contactIds:['manish']}]},
        {...strategy,ownerId:'client'}, {...strategy,targets:[{companyId:'landsec',reason:'Private',contactIds:['private']}]},
      ])assert.equal((await request('POST','/strategies',bad)).status,400);
      assert.equal((await pool.query('SELECT count(*)::int n FROM marketing_campaigns')).rows[0].n,0);
      const saved=await request('POST','/strategies',strategy);assert.equal(saved.status,200);strategyId=saved.body.id;
      const data=(await request('GET','?companyId=landsec')).body;
      assert.equal(data.strategies[0].name,strategy.name);assert.deepEqual(data.strategies[0].targets[0].contactIds,['jon']);
      assert.equal((await request('GET','?companyId=aew')).body.strategies.length,0);
      assert.equal((await request('GET','?companyId=brand')).status,400);
    });

    await t.test('events retain shared Marketing records and never convert legacy or suggested guests into accepted invitations',async()=>{
      const legacy=(await request('GET')).body.events.find(e=>e.id==='legacy');
      assert.equal(legacy.dateConfirmed,false);assert.deepEqual(legacy.guests,[]);
      for(const bad of [
        {...event,startsAt:null},{...event,endsAt:'2026-11-11T09:00:00Z'},
        {...event,sourceUrl:'javascript:alert(1)'},{...event,strategyIds:['missing']},
        {...event,guests:[{contactId:'manish',status:'suggested'}]},
        {...event,guests:[{contactId:'jon',status:'automatically_accepted'}]},
        {...event,guests:[{contactId:'private',status:'suggested'}]},
      ])assert.equal((await request('POST','/events',bad)).status,400);
      const saved=await request('POST','/events',{...event,strategyIds:[strategyId]});assert.equal(saved.status,200);eventId=saved.body.id;
      const current=(await request('GET')).body.events.find(e=>e.id===eventId);
      assert.equal(current.guests[0].status,'suggested');assert.equal(current.dateConfirmed,true);assert.deepEqual(current.strategyIds,[strategyId]);
      assert.equal((await pool.query('SELECT title FROM marketing_events WHERE id=$1',[eventId])).rows[0].title,event.title);
      assert.equal((await request('PUT','/events/legacy',{...event,guests:[],expectedUpdatedAt:legacy.updatedAt})).status,200);
      assert.deepEqual((await pool.query("SELECT attendee_contact_ids FROM marketing_events WHERE id='legacy'")).rows[0].attendee_contact_ids,['jon']);
    });

    await t.test('stale edits are rejected atomically and linkage replacement does not duplicate records',async()=>{
      const original=(await request('GET')).body;
      await pool.query("UPDATE marketing_events SET updated_at=now()+interval '1 second' WHERE id=$1",[eventId]);
      assert.equal((await request('PUT','/events/'+eventId,{...event,title:'Stale title',expectedUpdatedAt:original.events.find(e=>e.id===eventId).updatedAt})).status,409);
      assert.equal((await pool.query('SELECT title FROM marketing_events WHERE id=$1',[eventId])).rows[0].title,event.title);
      await pool.query("UPDATE marketing_campaigns SET updated_at=now()+interval '1 second' WHERE id=$1",[strategyId]);
      assert.equal((await request('PUT','/strategies/'+strategyId,{...strategy,name:'Stale',expectedUpdatedAt:original.strategies[0].updatedAt})).status,409);
      const latest=(await request('GET')).body.strategies[0];
      assert.equal((await request('PUT','/strategies/'+strategyId,{...strategy,targets:[{companyId:'landsec',reason:'Revised objective',contactIds:['jon']}],expectedUpdatedAt:latest.updatedAt})).status,200);
      assert.equal((await pool.query('SELECT count(*)::int n FROM crm_strategy_targets WHERE strategy_id=$1',[strategyId])).rows[0].n,1);
    });

    await t.test('follow-ups are the same My Tasks rows, with owner/assigner completion permissions',async()=>{
      const action={title:'Confirm introductions',notes:'Agree guests with account lead',dueAt:'2026-11-05T12:00:00Z',status:'todo',ownerId:'colleague',companyId:'landsec',strategyId,eventId};
      assert.equal((await request('POST','/actions',{...action,companyId:'aew'})).status,400);
      const saved=await request('POST','/actions',action);assert.equal(saved.status,200);actionId=saved.body.id;
      const tasks=(await pool.query('SELECT * FROM user_tasks')).rows;assert.equal(tasks.length,1);assert.equal(tasks[0].id,actionId);assert.equal(tasks[0].user_id,'colleague');assert.equal(tasks[0].assigned_by_user_id,'owner');
      assert.equal((await request('GET','?companyId=landsec')).body.actions[0].canEdit,true);
      assert.equal((await request('GET','?companyId=landsec',null,'other')).body.actions[0].canEdit,false);
      assert.equal((await request('PATCH','/actions/'+actionId,{status:'done'},'other')).status,403);
      assert.equal((await request('PATCH','/actions/'+actionId,{status:'done'},'colleague')).status,200);
      assert.equal((await pool.query('SELECT status FROM user_tasks WHERE id=$1',[actionId])).rows[0].status,'done');
      await pool.query("UPDATE user_tasks SET status='in_progress',completed_at=null WHERE id=$1",[actionId]);
      assert.equal((await request('GET')).body.actions[0].status,'in_progress','My Tasks edits are reflected without copying');
      assert.equal((await request('GET','?companyId=aew')).body.actions.length,0);
      assert.equal((await request('PATCH','/actions/'+actionId,{status:'done',title:'forged'})).status,400);
    });

    await t.test('private legacy events and their follow-ups stay hidden even after company links change',async()=>{
      await pool.query("UPDATE marketing_events SET lead_user_id='equity' WHERE id=$1",[eventId]);
      await pool.query('DELETE FROM crm_event_companies WHERE event_id=$1',[eventId]);
      const all=(await request('GET')).body;const scoped=await getCrmEngagementData('landsec',{pool,viewerId:'owner'});
      assert.ok(!all.events.some(e=>e.id===eventId));assert.ok(!all.actions.some(a=>a.id===actionId));assert.ok(!scoped.actions.some(a=>a.id===actionId));
      assert.equal((await request('PUT','/events/'+eventId,event)).status,404);
      assert.equal((await request('PATCH','/actions/'+actionId,{status:'done'})).status,404);
      await pool.query("UPDATE marketing_events SET attendee_user_ids=ARRAY['equity'] WHERE id='legacy'");
      assert.ok(!(await request('GET')).body.events.some(e=>e.id==='legacy'));
    });

    await t.test('explicit actions validate their current interview answer and landlord and retain a canonical source link',async()=>{
      const sourceAction={title:'Agree operator introductions',notes:'Discuss the saved CRM note with the account lead',dueAt:'2026-11-06T12:00:00Z',status:'todo',ownerId:'owner',companyId:'landsec',strategyId,eventId:null,sourceInterviewId:'interview-1',sourceQuestionId:'rl1'};
      const before=(await pool.query('SELECT count(*)::int n FROM user_tasks')).rows[0].n;
      // Opening the CRM never turns mentions into tasks automatically.
      await request('GET');await request('GET','?companyId=landsec');
      assert.equal((await pool.query('SELECT count(*)::int n FROM user_tasks')).rows[0].n,before);
      for(const invalid of [
        {...sourceAction,sourceQuestionId:null}, {...sourceAction,sourceInterviewId:null},
        {...sourceAction,sourceQuestionId:'missing'}, {...sourceAction,sourceInterviewId:'missing'},
        {...sourceAction,sourceQuestionId:'nb1'}, {...sourceAction,companyId:'aew',strategyId:null},
        {...sourceAction,source:{url:'https://untrusted.example/'}},
      ])assert.equal((await request('POST','/actions',invalid)).status,400);
      assert.equal((await pool.query('SELECT count(*)::int n FROM user_tasks')).rows[0].n,before,'invalid provenance does not create an orphan task');
      const saved=await request('POST','/actions',sourceAction);assert.equal(saved.status,200);
      const row=(await pool.query('SELECT * FROM crm_engagement_actions WHERE task_id=$1',[saved.body.id])).rows[0];
      assert.equal(row.source_interview_id,'interview-1');assert.equal(row.source_question_id,'rl1');
      const action=(await request('GET','?companyId=landsec')).body.actions.find(a=>a.id===saved.body.id);
      assert.deepEqual(action.source,{kind:'crm_interview',interviewId:'interview-1',questionId:'rl1',label:'CRM strategy interview',url:'/contacts?tab=meetings&interview=interview-1'});
      await pool.query(`UPDATE crm_interviews SET responses=jsonb_set(responses,'{rl1}','"This note no longer names the landlord."') WHERE id='interview-1'`);
      assert.equal((await request('POST','/actions',sourceAction)).status,400,'stale saved answer is rechecked at creation');
      assert.equal((await pool.query('SELECT count(*)::int n FROM user_tasks')).rows[0].n,before+1);
      assert.equal((await request('GET','?companyId=landsec')).body.actions.find(a=>a.id===saved.body.id).source.interviewId,'interview-1','a saved task keeps its original provenance after the interview changes');
    });
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();
  }
});
