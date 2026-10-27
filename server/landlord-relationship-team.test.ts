import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';
let api: typeof import('./landlord-relationship-team');
before(async () => {
  process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:1/test';
  api = await import('./landlord-relationship-team');
});
const person = (id:string, name=id) => ({id,name,email:`${id}@brucegillinghampollard.com`,is_active:true});
const seed = (overrides:any={}) => ({companyId:'aew',staff:[person('will','Will Penfold'),person('nick','Nick'),person('vics','Victoria'),person('woody','Woody'),person('lizzie','Lizzie')],assignedIds:[],roles:[],properties:[{id:'p1',name:'New Oxford Street'},{id:'p2',name:'Other property'}],emails:[],meetings:[],deals:[],advisory:[],propertyAgents:[],manual:[],now:new Date('2026-10-27T12:00:00Z'),...overrides});
const deal = (overrides:any={}) => ({id:'d1',name:'Dough T2',deal_ref:'3629',status:'SOL',property_id:'p1',deal_type:'Lease Acquisition',bgp_acting_for:'tenant',internal_agent_ids:['will'],internal_agent:['Unrelated name'],tenant_name:'Dough',...overrides});

test('every recorded participant is included without a six-person data cap or assigned-mandate assumption',()=>{
  const data=api.assembleLandlordRelationshipTeam(seed({assignedIds:['lizzie'],emails:[{user_id:'nick',email_count:4,last_touch:'2026-10-26T10:00:00Z'}],meetings:[{id:'m1',start:'2026-10-28T10:00:00Z',participants:[{email:person('vics').email}]}],deals:[deal()],conversations:[{user_id:'woody',message_count:2,last_touch:'2026-10-27T09:00:00Z'}]}));
  assert.equal(data.members.length,5);
  assert.equal(data.members.find(x=>x.id==='will')?.assigned,false);
  assert.equal(data.members.find(x=>x.id==='nick')?.emailCount,4);
  assert.equal(data.members.find(x=>x.id==='vics')?.lastInteractionAt,null);
  assert.equal(data.members.find(x=>x.id==='woody')?.conversationCount,2);
  assert.equal(data.members.find(x=>x.id==='lizzie')?.assigned,true);
});
test('tenant-side deal produces a property-specific tenant-representative suggestion with evidence',()=>{
  const member=api.assembleLandlordRelationshipTeam(seed({deals:[deal()]})).members[0];
  assert.equal(member.contexts[0].role,'Tenant representative');
  assert.equal(member.contexts[0].propertyName,'New Oxford Street');
  assert.equal(member.contexts[0].origin,'suggested');
  assert.match(member.contexts[0].notes,/Tenant-side work for Dough; does not establish a landlord instruction/);
  assert.equal(member.contexts[0].sources[0].url,'/deals/d1');
});
test('conflicting saved representation fields retain participation but do not guess the role',()=>{
  const data=api.assembleLandlordRelationshipTeam(seed({deals:[deal({bgp_acting_for:'landlord',deal_type:'Lease Disposal'})]}));
  assert.equal(data.members[0].dealCount,1);assert.equal(data.members[0].contexts.length,0);
  assert.match(data.issues[0],/conflicting representation/);
});
test('landlord leasing, advisory and investment records retain property and source links',()=>{
  const data=api.assembleLandlordRelationshipTeam(seed({deals:[deal({deal_type:'Temp Lease',bgp_acting_for:'landlord'}),deal({id:'d2',deal_type:'Investment Sale',bgp_acting_for:'vendor',property_id:'p2'})],advisory:[{id:'a1',property_id:'p1',lead_user_id:'nick',acting_for:'tenant',matter_type:'rent_review'}]}));
  assert.deepEqual(data.members.find(x=>x.id==='will')?.contexts.map(x=>x.role),['Leasing agent','Investment']);
  const advisory=data.members.find(x=>x.id==='nick')!.contexts[0];
  assert.equal(advisory.role,'Lease advisory');assert.match(advisory.notes,/tenant/);assert.equal(advisory.sources[0].url,'/pla/matters/a1');
});
test('manual property contexts preserve distinct roles and existing account assignments',()=>{
  const data=api.assembleLandlordRelationshipTeam(seed({roles:[{user_id:'will',role:'Support'}],deals:[deal(),deal({id:'d2',property_id:'p2'})],manual:[{id:'manual1',user_id:'will',role:'Tenant representative',property_id:'p1',notes:'Acts for the restaurant only.'}]}));
  const member=data.members[0];assert.equal(member.assignedRole,'Support');
  assert.equal(member.contexts.length,2);assert.equal(member.contexts.find(x=>x.propertyId==='p1')?.origin,'manual');
  assert.equal(member.contexts.find(x=>x.propertyId==='p1')?.notes,'Acts for the restaurant only.');
  assert.equal(member.contexts.find(x=>x.propertyId==='p2')?.origin,'suggested');
});
test('explicit IDs override legacy names; ambiguous names never identify a person',()=>{
  const staff=[person('will','Will Penfold'),person('nick','Nick'),person('nick2','Nick')];
  assert.deepEqual(api.assembleLandlordRelationshipTeam(seed({staff,deals:[deal({internal_agent:['Nick']})]})).members.map(x=>x.id),['will']);
  assert.equal(api.assembleLandlordRelationshipTeam(seed({staff,deals:[deal({internal_agent_ids:[],internal_agent:['Nick']})]})).members.length,0);
  assert.deepEqual(api.assembleLandlordRelationshipTeam(seed({staff,deals:[deal({internal_agent_ids:[],internal_agent:['Will Penfold']})]})).members.map(x=>x.id),['will']);
});
test('duplicate meetings and deals count once and malformed future dates do not become last contact',()=>{
  const meeting={id:'m1',start:'bad date',participants:[{email:person('will').email},{email:person('will').email}]};
  const member=api.assembleLandlordRelationshipTeam(seed({deals:[deal(),deal()],meetings:[meeting,meeting]})).members[0];
  assert.equal(member.dealCount,1);assert.equal(member.meetingCount,1);assert.equal(member.lastInteractionAt,null);assert.equal(member.contexts[0].sources.length,1);
});
test('non-landlord reads return null before interaction queries and role validation rejects arbitrary roles',async()=>{
  let calls=0;const q={query:async()=>{calls++;return{rows:[]};}};
  assert.equal(await api.getLandlordRelationshipTeam('brand',{q}),null);assert.equal(calls,1);
  await assert.rejects(api.saveLandlordTeamContext({companyId:'brand',userId:'will',role:'Owner',actorId:'woody'},q),/Choose a role/);assert.equal(calls,1);
});

// An explicit test-only connection runs the actual PostgreSQL queries against
// temporary tables in a rollback-only transaction, never the application DB.
test('PostgreSQL: exact landlord scope, role upsert, private-chat boundary and domain-linked email counts', {skip:!process.env.LANDLORD_TEAM_TEST_DATABASE_URL}, async()=>{
  const {Client}=await import('pg');const client=new Client({connectionString:process.env.LANDLORD_TEAM_TEST_DATABASE_URL});await client.connect();
  try{
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE crm_companies(id text,name text,company_type text,domain text,domain_url text,bgp_contact_user_ids text[],merged_into_id text);
      CREATE TEMP TABLE users(id text,name text,username text,email text,role text,profile_pic_url text,is_active boolean,address text);
      CREATE TEMP TABLE crm_properties(id text,name text,landlord_id text,freeholder_id text,long_leaseholder_id text,asset_manager_id text);
      CREATE TEMP TABLE crm_company_properties(company_id text,property_id text);
      CREATE TEMP TABLE crm_company_deals(company_id text,deal_id text);
      CREATE TEMP TABLE crm_deals(id text,name text,deal_ref text,status text,property_id text,deal_type text,bgp_acting_for text,team text[],internal_agent text[],internal_agent_ids text[],landlord_id text,vendor_id text,purchaser_id text,tenant_id text);
      CREATE TEMP TABLE crm_company_bgp_roles(company_id text,user_id text,role text);
      CREATE TEMP TABLE crm_contacts(id text,company_id text,email text);
      CREATE TEMP TABLE crm_interactions(id text,microsoft_id text,interaction_date timestamptz,bgp_user text,participants jsonb,type text,company_id text,contact_id text);
      CREATE TEMP TABLE pla_matters(id text,property_id text,matter_type text,acting_for text,status text,lead_user_id text,team_user_ids text[],client_company_id text);
      CREATE TEMP TABLE crm_property_agents(property_id text,user_id text,role text);
      CREATE TEMP TABLE chat_threads(id text,linked_type text,linked_id text,created_by text);
      CREATE TEMP TABLE chat_messages(id text,thread_id text,user_id text,role text,created_at timestamptz);
      CREATE TEMP TABLE chat_thread_members(thread_id text,user_id text);`);
    const boot=readFileSync(new URL('./index.ts',import.meta.url),'utf8');
    const create=boot.match(/`(CREATE TABLE IF NOT EXISTS crm_landlord_team_contexts[\s\S]+?)`/)!;
    const index=boot.match(/`(CREATE UNIQUE INDEX IF NOT EXISTS uq_landlord_team_context[^`]+)`/)!;
    await client.query(create[1].replace('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE'));
    await client.query(index[1]);
    await client.query(`INSERT INTO crm_companies VALUES('aew','AEW','Landlord','aew.com',NULL,'{}',NULL),('brand','Brand','Tenant - Retail',NULL,NULL,'{}',NULL);
      INSERT INTO users VALUES('will','Will Penfold','will','will@brucegillinghampollard.com','Agent',NULL,true,'An unrelated postal address'),('nick','Nick','nick','nick@brucegillinghampollard.com','Agent',NULL,true,'An unrelated postal address'),('woody','Woody','woody','woody@brucegillinghampollard.com','Admin',NULL,true,'Another postal address');
      INSERT INTO crm_properties VALUES('p1','New Oxford Street','aew',NULL,NULL,NULL),('outside','Other',NULL,NULL,NULL,NULL);
      INSERT INTO crm_deals VALUES('d1','Dough','3629','SOL','p1','Lease Acquisition','tenant','{}','{}','{will}','aew',NULL,NULL,NULL);
      INSERT INTO crm_contacts VALUES('external',NULL,'ben@eu.aew.com'),('spoof',NULL,'ben@aew.com.evil.test');
      INSERT INTO crm_interactions VALUES('i1','msg1',now()-interval '1 day','nick@brucegillinghampollard.com','["nick@brucegillinghampollard.com","will@brucegillinghampollard.com","ben@eu.aew.com"]','email',NULL,'external'),('i2','msg1',now()-interval '1 day','nick@brucegillinghampollard.com','["ben@eu.aew.com"]','email',NULL,'external'),('i3','bad',now()-interval '1 day','nick@brucegillinghampollard.com','["ben@aew.com.evil.test"]','email',NULL,'spoof');
      INSERT INTO chat_threads VALUES('visible','company','aew','woody'),('hidden','company','aew','nick');
      INSERT INTO chat_messages VALUES('m1','visible','woody','user',now()),('m2','hidden','will','user',now());`);
    const q={query:(sql:string,params?:any[])=>client.query(sql,params)};
    const digest:any=async()=>({meetings:[],coverage:{status:'current'}});
    const data=await api.getLandlordRelationshipTeam('aew',{q,viewerId:'woody',meetingDigest:digest});
    assert.equal(data?.issues.length,0);assert.equal(data?.members.find(x=>x.id==='nick')?.emailCount,1);assert.equal(data?.members.find(x=>x.id==='will')?.emailCount,1);
    assert.equal(data?.members.find(x=>x.id==='woody')?.conversationCount,1);assert.equal(data?.members.find(x=>x.id==='will')?.conversationCount,0);
    assert.equal(data?.members.find(x=>x.id==='will')?.contexts[0].propertyName,'New Oxford Street');
    assert.equal(await api.getLandlordRelationshipTeam('brand',{q,meetingDigest:digest}),null);
    await assert.rejects(api.saveLandlordTeamContext({companyId:'aew',userId:'will',role:'Support',propertyId:'outside',actorId:'woody'},q),/linked to this landlord/);
    await api.saveLandlordTeamContext({companyId:'aew',userId:'will',role:'Support',propertyId:'p1',notes:'Initial',actorId:'woody'},q);
    await api.saveLandlordTeamContext({companyId:'aew',userId:'will',role:'Support',propertyId:'p1',notes:'Updated',actorId:'woody'},q);
    await api.saveLandlordTeamContext({companyId:'aew',userId:'will',role:'Support',actorId:'woody'},q);
    const saved=(await client.query('SELECT notes,property_id FROM crm_landlord_team_contexts')).rows;assert.equal(saved.length,2);assert.equal(saved.find(x=>x.property_id==='p1').notes,'Updated');
    assert.equal((await client.query('SELECT * FROM crm_company_bgp_roles')).rows.length,0);
  }finally{await client.query('ROLLBACK');await client.end();}
});
