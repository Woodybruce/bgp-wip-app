import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import { isShareableClientCalendarEvent, teamEventPrivacySql } from '../../server/team-event-privacy.ts';
import { PRIVATE_MAILBOX, isPrivateMailboxAddress } from '../../shared/private-mail.ts';
const require=createRequire(import.meta.url);
const {find,source,evaluate,route,ts}=require('./source-harness.cjs');
const invite=(id,extra={})=>({iCalUId:id,subject:'Landsec leasing review',sensitivity:'normal',isCancelled:false,
  start:{dateTime:'2026-11-01T10:00:00'},end:{dateTime:'2026-11-01T11:00:00'},location:{displayName:'Office'},
  attendees:[{emailAddress:{name:'Client',address:'client@landsec.com'}}],...extra});

test('client calendar eligibility requires normal sensitivity and excludes private addresses and cancellations',()=>{
  assert.equal(isShareableClientCalendarEvent(invite('normal'),'staff@brucegillinghampollard.com'),true);
  for(const event of [invite('private',{sensitivity:'private'}),invite('confidential',{sensitivity:'confidential'}),
    invite('unknown',{sensitivity:undefined}),invite('cancelled',{isCancelled:true}),invite('cancelled-title',{subject:'Cancelled: Landsec review'}),
    invite('organiser',{organizer:{emailAddress:{address:PRIVATE_MAILBOX}}}),
    invite('attendee',{attendees:[{emailAddress:{address:'equity+private@brucegillinghampollard.com'}}]})]) {
    assert.equal(isShareableClientCalendarEvent(event,'staff@brucegillinghampollard.com'),false,event.iCalUId);
  }
  assert.equal(isShareableClientCalendarEvent(invite('private-mailbox'),PRIVATE_MAILBOX),false);
});

test('actual client sync never reads the private mailbox or saves private copies, while retaining normal client scope',async()=>{
  const file='server/client-team-events-sync.ts';const requests=[],tokens=[],saved=[];
  const pool={query:async(sql)=>({rows:sql.includes('SELECT name FROM crm_companies')?[{name:'Landsec'}]
    :sql.includes('crm_client_team_members')?[{user_id:'nick',email:'nick@brucegillinghampollard.com'},{user_id:'private',email:PRIVATE_MAILBOX},{user_id:'ben',email:'ben@brucegillinghampollard.com'}]
    :sql.includes('FROM crm_properties')?[{id:'property',name:'Trinity Leeds'}]:[{email:'client@landsec.com'}]}),
    connect:async()=>({query:async(sql,args)=>{if(sql.includes('INSERT INTO team_events'))saved.push(args);return{rows:[]};},release(){}})};
  const script=[find(file,n=>ts.isVariableDeclaration(n)&&n.name.getText()==='PERSONAL_PATTERNS'),
    find(file,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='norm'),find(file,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='syncClientTeamEvents')];
  const sharedPrivate=invite('cross-copy',{organizer:{emailAddress:{address:PRIVATE_MAILBOX}}});
  const events={nick:[invite('normal'),invite('cross-copy'),invite('sensitive',{sensitivity:'private'}),invite('cancelled',{isCancelled:true}),
    invite('unknown',{sensitivity:undefined}),invite('equity-copy',{attendees:[{emailAddress:{address:PRIVATE_MAILBOX}}]}),
    invite('unrelated',{subject:'Different company',attendees:[{emailAddress:{address:'someone@other.test'}}]})],ben:[sharedPrivate]};
  const {syncClientTeamEvents}=evaluate(`const ${script[0]};\n${script.slice(1).join('\n')}`,{
    pool,isPrivateMailboxAddress,isShareableClientCalendarEvent,
    getDelegatedGraphTokenForUser:async(id)=>{tokens.push(id);return id;},
    fetch:async(url,options)=>{requests.push(url);return{ok:true,json:async()=>({value:events[options.headers.Authorization.replace('Bearer ','')]})};},
    require:name=>{assert.equal(name,'./shared-mailbox');return{graphRequest:async(url)=>{requests.push(url);return{value:[]};}}},
  });
  const result=await syncClientTeamEvents('landsec');
  assert.deepEqual(tokens,['nick','ben']);assert.equal(result.upserted,1);assert.equal(saved.length,1);
  assert.equal(saved[0][0],'Landsec leasing review');assert.equal(saved[0][4],'Landsec');
  assert.match(saved[0][6][0],/client@landsec.com/);
  for(const url of requests) {assert.match(url,/sensitivity/);assert.match(url,/isCancelled/);}
  assert.doesNotMatch(JSON.stringify(saved),/equity|private/);
});

test('historical saved attendee and mailbox addresses are filtered by the PostgreSQL read boundary without deleting rows',async()=>{
  const schema=`team_event_privacy_${randomUUID().replaceAll('-','')}`;const pool=new pg.Pool({host:'/tmp',database:'postgres',max:1});
  try{
    await pool.query(`CREATE SCHEMA ${schema}`);await pool.query(`SET search_path TO ${schema}`);
    const pattern=find('server/private-mail-store.ts',n=>ts.isVariableDeclaration(n)&&n.name.getText()==='privateAddressPattern');
    const sql=find('server/private-mail-store.ts',n=>ts.isTemplateExpression(n)&&n.head.text.startsWith('CREATE OR REPLACE FUNCTION bgp_private_mail_record'));
    await pool.query(evaluate(`const ${pattern};export const sql=${sql};`).sql);
    await pool.query('CREATE TABLE team_events(id text,created_by text,attendees text[])');
    await pool.query('INSERT INTO team_events VALUES ($1,$2,$3),($4,$5,$6),($7,$8,$9),($10,$11,$12)',[
      'safe','client-events-sync',['Client <client@landsec.com>'],'private-copy','client-events-sync',['Equity <equity+private@brucegillinghampollard.com>'],
      'private-owner',PRIVATE_MAILBOX,[],'similar','staff',['notequity@brucegillinghampollard.com','equity@brucegillinghampollard.com.evil']]);
    const result=await pool.query(`SELECT id FROM team_events te WHERE ${teamEventPrivacySql('te')} ORDER BY id`);
    assert.deepEqual(result.rows.map(r=>r.id),['safe','similar']);
    assert.equal((await pool.query('SELECT count(*)::int n FROM team_events')).rows[0].n,4);
    assert.throws(()=>teamEventPrivacySql('te; DROP'),/Invalid/);
  }finally{await pool.query('SET search_path TO public');await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
});

test('saved calendar attendees are unconfirmed unless the source contains an actual RSVP',()=>{
  const fn=find('client/src/pages/calendar.tsx',n=>ts.isFunctionDeclaration(n)&&n.name?.text==='teamEventToCalendarEvent');
  const {convert}=evaluate(`${fn};export const convert=teamEventToCalendarEvent;`,{teamEventType:()=> 'meeting'});
  const row=convert({id:'saved',title:'Review',start_time:'2026-11-01',end_time:'2026-11-01',attendees:['Client <client@landsec.com>']});
  assert.equal(row.attendees[0].status.response,'none');assert.equal(row.attendees[0].emailAddress.address,'client@landsec.com');
});

test('HR shared live calendar excludes private mailboxes and private copies before company-wide event aggregation',async()=>{
  let handler;const requests=[];const team={emailAddress:{address:'team@brucegillinghampollard.com'}};
  const companyEvent=(id,extra={})=>invite(id,{attendees:[team],...extra});
  const events={nick:[companyEvent('safe'),companyEvent('cross-copy'),companyEvent('sensitive',{sensitivity:'confidential'}),
    companyEvent('cancelled',{isCancelled:true}),companyEvent('unknown',{sensitivity:undefined})],
    ben:[companyEvent('cross-copy',{organizer:{emailAddress:{address:PRIVATE_MAILBOX}}}),companyEvent('safe')]};
  evaluate(route('server/hr-routes.ts','get','/api/hr/calendar/team-events'),{
    app:{get(_path,_auth,fn){handler=fn;}},requireAuth:()=>{},getValidMsToken:async()=> 'synthetic',
    isShareableClientCalendarEvent,teamEventPrivacySql,isPrivateMailboxAddress,
    pool:{query:async(sql)=>({rows:sql.includes('JOIN staff_profiles')?
      [{id:'nick',name:'Nick',email:'nick@brucegillinghampollard.com'},{id:'private',name:'Private',email:PRIVATE_MAILBOX},{id:'ben',name:'Ben',email:'ben@brucegillinghampollard.com'}]:[]})},
    fetch:async(url)=>{requests.push(url);const mailbox=decodeURIComponent(new URL(url).pathname.split('/')[3]);return{ok:true,json:async()=>({value:events[mailbox.split('@')[0]]})};},URL,encodeURIComponent,
  });
  let response;await handler({query:{}},{json(value){response=value;}});
  assert.equal(response.events.length,1);assert.equal(response.events[0].key,'outlook:safe');
  assert.equal(response.events[0].internalAttendees.length,2);assert.equal(requests.length,2);
  for(const url of requests){assert.match(url,/sensitivity,isCancelled/);assert.match(url,/organizer,iCalUId/);assert.doesNotMatch(url,/equity/);}
});

test('every existing team-events content/count query uses the shared privacy read boundary',()=>{
  const files=['server/routes.ts','server/microsoft.ts','server/hr-routes.ts','server/activity-summary.ts'];let checked=0;
  for(const file of files){
    const ast=ts.createSourceFile(file,source(file),ts.ScriptTarget.Latest,true);
    const walk=node=>{
      if(ts.isTemplateExpression(node)||ts.isNoSubstitutionTemplateLiteral(node)){
        const query=node.getText(ast);
        if(/SELECT[\s\S]*FROM team_events/i.test(query)&&!query.includes('SELECT created_by FROM team_events')){
          assert.match(query,/teamEventPrivacySql\(|\$\{EVENT_NOISE\}/,`${file}: ${query.slice(0,140)}`);checked++;
        }
      }
      ts.forEachChild(node,walk);
    };walk(ast);
  }
  assert.equal(checked,12);assert.match(source('server/activity-summary.ts'),/const EVENT_NOISE = `\$\{teamEventPrivacySql\(\)\}/);
});
