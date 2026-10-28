import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { getAccountLeasing, privateLeasingViewing } from '../../server/account-leasing.ts';

const now=new Date('2026-10-28T12:00:00Z');
test('landlord leasing reads shared records by exact property and preserves privacy and provenance',async t=>{
  const schema='account_leasing_'+randomUUID().replaceAll('-','');
  const pool=new pg.Pool({host:'/tmp',database:'postgres',max:1});
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema},public`);
    await pool.query(`
      CREATE TABLE users(id text PRIMARY KEY,name text,username text,email text,role text,is_active boolean,client_view_mode boolean);
      CREATE TABLE available_units(id text PRIMARY KEY,property_id text,unit_name text,marketing_status text,deal_id text);
      CREATE TABLE crm_property_agents(property_id text,user_id text,role text);
      CREATE TABLE crm_landlord_team_contexts(id text,user_id text,property_id text,role text,company_id text);
      CREATE TABLE crm_deals(id text PRIMARY KEY,name text,property_id text,deal_type text,bgp_acting_for text,status text,internal_agent_ids text[],updated_at timestamptz);
      CREATE TABLE crm_companies(id text,name text,bgp_contact_user_ids text[]);
      CREATE TABLE crm_company_bgp_roles(company_id text,user_id text,role text);
      CREATE TABLE crm_contacts(id text,email text);
      CREATE TABLE unit_viewings(id text PRIMARY KEY,unit_id text,company_id text,company_name text,owner_user_id text,viewing_date text,viewing_time text,status text,outcome text,details_confirmed_at timestamptz,next_action text,follow_up_date text,source_details jsonb,attendees text,deleted_at timestamptz,contact_id text,agent_contact_id text);
      CREATE TABLE user_tasks(id text PRIMARY KEY,title text,status text,priority text,due_date timestamptz,user_id text,source_ref text,completed_at timestamptz,created_at timestamptz DEFAULT now());
      INSERT INTO users VALUES
        ('agent','Agent',null,'agent@brucegillinghampollard.com','Staff',true,false),
        ('account-agent','Account agent',null,'account@brucegillinghampollard.com','Staff',true,false),
        ('deal-agent','Deal agent',null,'deal@brucegillinghampollard.com','Staff',true,false),
        ('tenant-agent','Tenant agent',null,'tenant@brucegillinghampollard.com','Staff',true,false),
        ('inactive','Inactive',null,'inactive@brucegillinghampollard.com','Staff',false,false),
        ('client','Client',null,'client@brucegillinghampollard.com','Client',true,false),
        ('preview','Preview',null,'preview@brucegillinghampollard.com','Staff',true,true),
        ('equity','Private',null,'equity@brucegillinghampollard.com','Staff',true,false);
      INSERT INTO crm_companies VALUES ('brand','Brand',null),
        ('landlord','Landlord',ARRAY['account-agent','agent','tenant-agent','inactive','client','preview','equity']),
        ('unrelated','Other landlord',ARRAY['tenant-agent']),
        ('empty-landlord','No property landlord',ARRAY['account-agent']);
      INSERT INTO crm_company_bgp_roles VALUES ('landlord','account-agent','Leasing'),('landlord','agent','Leasing'),
        ('landlord','tenant-agent','Tenant rep'),('landlord','inactive','Leasing'),('landlord','client','Leasing'),
        ('landlord','preview','Leasing'),('landlord','equity','Leasing'),
        ('landlord','deal-agent','Leasing'),('unrelated','tenant-agent','Leasing'),
        ('empty-landlord','account-agent','Letting agent');
      INSERT INTO crm_contacts VALUES ('private-contact','equity@brucegillinghampollard.com');
      INSERT INTO available_units VALUES ('unit /1','property /1','Unit 1','AVA',null),('closed','property /1','Closed','INV','old-deal'),('outside-unit','outside-property','Other','AVA',null);
      INSERT INTO crm_property_agents VALUES ('property /1','agent','Leasing'),('property /1','inactive','Leasing'),('property /1','client','Leasing'),('property /1','preview','Leasing'),('property /1','equity','Leasing');
      INSERT INTO crm_landlord_team_contexts VALUES ('role-1','agent','property /1','Leasing agent','landlord'),('role-2','agent',null,'Leasing agent','subsidiary'),('foreign-role','tenant-agent','property /1','Leasing agent','unrelated');
      INSERT INTO crm_deals VALUES
        ('deal-1','New letting','property /1','New Letting','landlord','COM',ARRAY['deal-agent'],'2026-10-01'),
        ('tenant-deal','Tenant work','property /1','Lease Disposal','tenant','SOL',ARRAY['tenant-agent'],'2026-10-01'),
        ('conflict','Conflict','property /1','Sub-Letting','landlord','SOL',ARRAY['tenant-agent'],'2026-10-01'),
        ('blank','Unknown side','property /1','New Letting',null,'AVA',ARRAY['tenant-agent'],'2026-10-01'),
        ('outside-deal','Outside','outside-property','New Letting','landlord','AVA',ARRAY['tenant-agent'],'2026-10-01');
    `);
    const seedViewing=async(id,overrides={})=>{
      const v={unit_id:'unit /1',company_id:'brand',owner_user_id:'agent',viewing_date:'2026-10-29',status:'scheduled',outcome:null,details_confirmed_at:null,source_details:{},deleted_at:null,contact_id:null,...overrides};
      await pool.query(`INSERT INTO unit_viewings(id,unit_id,company_id,owner_user_id,viewing_date,viewing_time,status,outcome,details_confirmed_at,source_details,deleted_at,contact_id)
        VALUES($1,$2,$3,$4,$5,'11:00',$6,$7,$8,$9,$10,$11)`,[id,v.unit_id,v.company_id,v.owner_user_id,v.viewing_date,v.status,v.outcome,v.details_confirmed_at,v.source_details,v.deleted_at,v.contact_id]);
    };
    await seedViewing('upcoming /1');
    await seedViewing('past-pending',{viewing_date:'2026-10-27'});
    await seedViewing('today-completed',{viewing_date:'2026-10-28',status:'completed',outcome:'Interested',details_confirmed_at:now});
    await seedViewing('cancelled',{viewing_date:'2026-10-27',status:'cancelled'});
    await seedViewing('not-leasing',{status:'not_leasing'});
    await seedViewing('deleted',{deleted_at:now});
    await seedViewing('old',{viewing_date:'2025-10-27'});
    await seedViewing('far-future',{viewing_date:'2027-06-01'});
    await seedViewing('outside',{unit_id:'outside-unit'});
    await seedViewing('unmatched',{unit_id:null});
    await seedViewing('property-known',{unit_id:null,source_details:{sourcePropertyId:'property /1'}});
    await seedViewing('name-only',{unit_id:null,source_details:{sourcePropertyName:'Exact property'}});
    await seedViewing('outside-property-hint',{unit_id:'outside-unit',source_details:{sourcePropertyId:'property /1'}});
    await seedViewing('outside-source-property',{unit_id:null,source_details:{sourcePropertyId:'outside-property'}});
    await seedViewing('private-unmatched',{unit_id:null,source_details:{sourcePropertyId:'property /1',participants:['equity@brucegillinghampollard.com']}});
    await seedViewing('private-owner',{owner_user_id:'equity'});
    await seedViewing('private-invite',{source_details:{participants:[{email:'equity@brucegillinghampollard.com'}]}});
    await seedViewing('private-mailbox',{source_details:{ownerMailbox:'equity@brucegillinghampollard.com'}});
    await seedViewing('private-contact',{contact_id:'private-contact'});
    for(const [id,viewing,user,status] of [
      ['task-1','upcoming /1','agent','todo'],['task-2','past-pending','agent','in_progress'],
      ['private-task','private-invite','agent','todo'],['private-assignee','upcoming /1','equity','todo'],
      ['cancelled-task','cancelled','agent','todo'],['outside-task','outside','agent','todo'],
      ['inactive-task','upcoming /1','inactive','todo'],['client-task','upcoming /1','client','todo'],
      ['done-task','upcoming /1','agent','done'],['old-task','old','agent','todo'],
      ['property-task','property-known','agent','todo'],['unmatched-task','unmatched','agent','todo'],
      ['private-unmatched-task','private-unmatched','agent','todo'],
    ])await pool.query(`INSERT INTO user_tasks(id,title,status,priority,due_date,user_id,source_ref) VALUES($1,'Follow up',$4,'medium','2026-10-29',$3,$2)`,[id,'viewing_followup:'+viewing,user,status]);
    await pool.query(`INSERT INTO user_tasks(id,title,status,user_id,source_ref) VALUES ('manual','Private personal note','todo','agent','other:upcoming /1')`);
    const properties=[{propertyId:'property /1',name:'Exact property'}];
    const load=()=>getAccountLeasing('landlord',properties,['landlord','subsidiary'],{pool,now});

    await t.test('active leasing staff and saved roles stay distinct from historical deals and tenant representation',async()=>{
      const data=await load();
      assert.deepEqual(data.agents.map(a=>a.userId),['account-agent','agent','deal-agent']);
      const agent=data.agents.find(a=>a.userId==='agent');
      assert.deepEqual(new Set(agent.contexts.map(c=>c.basis)),new Set(['property_team','saved_role']));
      assert.equal(agent.contexts.filter(c=>c.propertyId===null).length,1,'legacy and newer account role are not repeated');
      assert.equal(agent.contexts.find(c=>c.propertyId===null).label,'Confirmed account role');
      const historical=data.agents.find(a=>a.userId==='deal-agent');
      assert.equal(historical.contexts[0].basis,'deal_record','a stale legacy role outside the current saved team is ignored');
      assert.match(historical.contexts[0].label,/COM/,'completed work is evidence, not a live mandate');
      assert.deepEqual(data.properties[0].units.map(u=>u.id),['unit /1']);
      assert.equal(data.properties[0].units[0].href,'/available?propertyId=property%20%2F1&unitId=unit%20%2F1');
      assert.equal(data.properties[0].viewingsHref,'/available?workspace=viewings&propertyId=property%20%2F1');
    });
    await t.test('saved Leasing account roles survive without inventing a property or requiring a portfolio',async()=>{
      const data=await getAccountLeasing('empty-landlord',[],['empty-landlord'],{pool,now});
      assert.deepEqual(data.properties,[]);
      assert.deepEqual(data.agents,[{userId:'account-agent',name:'Account agent',contexts:[{
        propertyId:null,propertyName:null,role:'Letting agent',basis:'saved_role',
        href:'/companies/empty-landlord',label:'Confirmed account role',
      }]}]);
      assert.deepEqual(data.issues,[]);
    });
    await t.test('live units follow the backing deal status then unit status like the Letting Tracker',async()=>{
      await pool.query(`INSERT INTO crm_deals(id,status,updated_at) VALUES
        ('old-live-deal','Under Offer','2020-01-01'),('invalid-status-deal','not a status','2026-10-01');
        INSERT INTO available_units VALUES
        ('deal-closed','property /1','Closed by deal','AVA','deal-1'),
        ('deal-live','property /1','Live by deal','INV','old-live-deal'),
        ('fallback','property /1','Fallback unit','Negotiating','invalid-status-deal'),
        ('default','property /1','Unstated status',null,null)`);
      try {
        const data=await load();
        const statuses=Object.fromEntries(data.properties[0].units.map(u=>[u.id,u.status]));
        assert.deepEqual(statuses,{'deal-live':'SOL',fallback:'NEG',default:'AVA','unit /1':'AVA'});
        assert.equal(data.properties[0].units.find(u=>u.id==='deal-live').dealHref,'/deals/old-live-deal');
      } finally {
        await pool.query(`DELETE FROM available_units WHERE id IN ('deal-closed','deal-live','fallback','default');
          DELETE FROM crm_deals WHERE id IN ('old-live-deal','invalid-status-deal')`);
      }
    });
    await t.test('viewings use actual status, exact portfolio and private invitation exclusion',async()=>{
      const data=await load();
      assert.deepEqual(new Set(data.upcomingViewings.map(v=>v.id)),new Set(['upcoming /1','property-known']));
      assert.deepEqual(new Set(data.recentViewings.map(v=>v.id)),new Set(['past-pending','today-completed','cancelled']));
      assert.equal(data.recentViewings.find(v=>v.id==='past-pending').status,'scheduled');
      assert.equal(data.recentViewings.find(v=>v.id==='past-pending').outcome,null);
      assert.equal(data.upcomingViewings[0].detailsConfirmed,false);
      assert.equal(data.upcomingViewings.find(v=>v.id==='upcoming /1').href,'/available?workspace=viewings&viewing=upcoming%20%2F1');
      const unmatched=data.upcomingViewings.find(v=>v.id==='property-known');
      assert.equal(unmatched.unitId,null);
      assert.equal(unmatched.unitName,'Unit to confirm');
      assert.equal(unmatched.detailsConfirmed,false);
      assert.equal(unmatched.trackerHref,'/available?propertyId=property%20%2F1');
      assert.equal(data.recentViewings.find(v=>v.id==='today-completed').outcome,'Interested');
      assert.equal(data.issues.length,0);
    });
    await t.test('existing follow-up tasks link to their viewing without copying, reconciling or exposing unrelated tasks',async()=>{
      const before=await pool.query('SELECT id,status FROM user_tasks ORDER BY id');
      const data=await load();
      assert.deepEqual(new Set(data.nextActions.map(a=>a.taskId)),new Set(['task-1','task-2','old-task','property-task']));
      assert.equal(data.nextActions.find(a=>a.taskId==='task-1').viewingId,'upcoming /1');
      assert.equal(data.nextActions.find(a=>a.taskId==='task-1').href,data.upcomingViewings.find(v=>v.id==='upcoming /1').href);
      assert.equal(data.nextActions.find(a=>a.taskId==='property-task').viewingId,'property-known');
      assert.deepEqual((await pool.query('SELECT id,status FROM user_tasks ORDER BY id')).rows,before.rows);
      const empty=await getAccountLeasing('other',[],[],{pool,now});
      assert.deepEqual(empty.nextActions,[]);
    });
    await t.test('a source failure is visible and does not fall back to broad unscoped data',async()=>{
      const data=await getAccountLeasing('landlord',properties,['landlord'],{now,pool:{query:async(sql,args)=>{
        if(sql.includes('FROM unit_viewings v'))throw new Error('unavailable');
        return pool.query(sql,args);
      }}});
      assert.ok(data.issues.includes('Viewing records could not be checked'));
      assert.deepEqual(data.nextActions,[]);
      assert.deepEqual(data.upcomingViewings,[]);
    });
  } finally {await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
});

test('Equity aliases and invite recipients are excluded without searching unrelated subject text',()=>{
  assert.equal(privateLeasingViewing({source_details:{organizer:'equity+secret@brucegillinghampollard.com'}}),true);
  assert.equal(privateLeasingViewing({source_details:{subject:'Please speak to equity@brucegillinghampollard.com'}}),false);
});
