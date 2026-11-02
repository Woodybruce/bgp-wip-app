import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import { compareKeyContacts } from '../../shared/contact-tiers.ts';
import { landlordDisplayContacts } from '../../shared/landlord-contact-identity.ts';
import { ACCOUNT_CONTACT_ACTIVITY_SQL } from '../../server/account-resolver.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const now = Date.parse('2026-10-27T12:00:00Z');

test('Landlord contacts rank recent recorded work ahead of title and lifetime volume; Brands keep role priority', () => {
  const active = { name:'Working contact',role:null,emails:40,recent90d:30,recent30d:20,lastAt:'2026-10-26' };
  const historic = { name:'Historic director',role:'Property Director',emails:4000,recent90d:0,recent30d:0,lastAt:'2026-01-01' };
  const uncontacted = { name:'Unknown director',role:'Leasing Director',emails:0,lastAt:null };
  assert.ok(compareKeyContacts(active,historic,{landlord:true,now}) < 0);
  assert.ok(compareKeyContacts(active,uncontacted,{landlord:true,now}) < 0);
  assert.ok(compareKeyContacts(active,historic,{landlord:false,now}) > 0);
  assert.ok(compareKeyContacts({...active,recent30d:21},{...active,role:'Property Director'},{landlord:true,now}) < 0);
});

test('Strong duplicate identities retain the newest activity and conservative counts without mutating records', () => {
  const old={id:'old',name:'Name',email:'old@example.test',linkedin_url:'https://linkedin.com/in/person',interaction_count:4000,email_count:3998,meeting_count:2,recent_interactions_90d:5,recent_interactions_30d:1,last_interaction_at:'2026-01-01',last_email_at:'2026-01-01'};
  const recent={id:'new',name:'Name',email:'new@example.test',linkedin_url:'https://linkedin.com/in/person',interaction_count:40,email_count:35,meeting_count:5,recent_interactions_90d:30,recent_interactions_30d:20,last_interaction_at:'2026-10-26',last_email_at:'2026-10-25',last_meeting_at:'2026-10-26'};
  const before=JSON.stringify([old,recent]);const [row]=landlordDisplayContacts([old,recent]);
  assert.equal(row.id,'old');assert.equal(row.last_interaction_at,'2026-10-26');assert.equal(row.last_email_at,'2026-10-25');
  assert.equal(row.interaction_count,4000);assert.equal(row.email_count,3998);assert.equal(row.meeting_count,5);
  assert.equal(row.recent_interactions_90d,30);assert.equal(row.recent_interactions_30d,20);
  assert.equal(row.relatedContactRecords[0].id,'new');assert.equal(JSON.stringify([old,recent]),before);
});

test('PostgreSQL aggregate counts source events once, measures recent windows and excludes private or future evidence', async () => {
  const schema=`contact_activity_test_${randomUUID().replaceAll('-','')}`;
  const pool=new pg.Pool({host:'/tmp',database:'postgres',max:1});
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);await pool.query(`SET search_path TO ${schema}`);
    await pool.query('CREATE TABLE crm_contacts(id text,email text); CREATE TABLE crm_interactions(id text,contact_id text,microsoft_id text,type text,interaction_date timestamptz,bgp_user text,participants jsonb)');
    const pattern=find('server/private-mail-store.ts',n=>ts.isVariableDeclaration(n)&&n.name.getText()==='privateAddressPattern');
    const sql=find('server/private-mail-store.ts',n=>ts.isTemplateExpression(n)&&n.head.text.startsWith('CREATE OR REPLACE FUNCTION bgp_private_mail_record'));
    await pool.query(evaluate(`const ${pattern}; export const sql=${sql};`).sql);
    await pool.query("INSERT INTO crm_contacts VALUES('c1','contact@example.test'),('c2','other@example.test'),('outside','outside@example.test')");
    const put=(id,contactId,message,type,days,mailbox,participants)=>pool.query("INSERT INTO crm_interactions VALUES($1,$2,$3,$4,NOW()-($5::int * INTERVAL '1 day'),$6,$7::jsonb)",[id,contactId,message,type,days,mailbox,JSON.stringify(participants)]);
    await put('e1','c1','email_message1','email',2,'staff@example.test',['contact@example.test']);
    await put('e1-copy','c2','email_message1','email',2,'staff@example.test',['contact@example.test','other@example.test']);
    await put('e1-capture','c1','message1','email',2,'staff@example.test',[]);
    await put('e2','c1','email_message2','email',45,'staff@example.test',[]);
    await put('e3','c1','email_message3','email',150,'staff@example.test',[]);
    await put('m1','c1','cal_staff@example.test_same-event','meeting',10,'staff@example.test',['contact@example.test']);
    await put('m1-copy','c2','cal_colleague@example.test_same-event','meeting',10,'colleague@example.test',['contact@example.test','other@example.test']);
    await put('future','c1','cal_future','meeting',-1,'staff@example.test',['contact@example.test']);
    await put('private-mailbox','c1','email_private1','email',1,'equity@brucegillinghampollard.com',['contact@example.test']);
    await put('private-copy','c2','email_private2','email',1,'staff@example.test',['contact@example.test','Equity <equity+private@brucegillinghampollard.com>']);
    await put('outside','outside','email_outside','email',1,'staff@example.test',['outside@example.test']);
    await put('nonarray','c1','email_nonarray','email',60,'staff@example.test',{});
    const result=await pool.query(ACCOUNT_CONTACT_ACTIVITY_SQL,[['c1']]);
    assert.equal(result.rows.length,1);const row=result.rows[0];assert.equal(row.contact_id,'c1');
    assert.equal(row.touches,5);assert.equal(row.email_count,4);assert.equal(row.meeting_count,1);
    assert.equal(row.recent_90d,4);assert.equal(row.recent_30d,2);
    assert.ok(Date.now()-new Date(row.last_touch).getTime()>86400000,'private/future evidence must not move recency');
  } finally {await pool.query('SET search_path TO public');await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
});

test('Account contact adapter carries recent activity and separate type counts to both layouts',()=>{
 const declaration=find('client/src/components/brand-profile-panel.tsx',n=>ts.isVariableDeclaration(n)&&n.name.getText()==='accountBoardContacts');
 const {accountBoardContacts}=evaluate(`export const ${declaration};`);
 const [row]=accountBoardContacts({contacts:[{contactId:'c1',name:'Contact',interactionCount:12,lastInteractionAt:'2026-10-26',emailCount:10,meetingCount:2,recentInteractions90d:7,recentInteractions30d:4,lastEmailAt:'2026-10-25',lastMeetingAt:'2026-10-26'}]});
 assert.equal(row.email_count,10);assert.equal(row.meeting_count,2);assert.equal(row.recent_interactions_90d,7);assert.equal(row.recent_interactions_30d,4);assert.equal(row.last_email_at,'2026-10-25');assert.equal(row.last_meeting_at,'2026-10-26');
});
