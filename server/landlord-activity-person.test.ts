import assert from 'node:assert/strict';
import test from 'node:test';
import { landlordPersonRequest, resolveLandlordActivityPerson, landlordRecordIncludesPerson, scopeLandlordMeetingDigest, LandlordPersonScopeError } from './landlord-activity-person';
import { getLandlordMeetingSummary, handleLandlordMeetingSummary, landlordMeetingSummaryEvidence } from './landlord-meeting-summary';
import { landlordActivityPersonQuery } from '../shared/landlord-activity-person';
import { PRIVATE_MAILBOX } from './private-mail';
import type { LandlordMeetingDigest } from '../shared/landlord-meetings';

const nick = { key:'staff:nick-id', userId:'nick-id', name:'Nick', email:'nick@brucegillinghampollard.com' };
const ben = { key:'staff:ben-id', userId:'ben-id', name:'Ben', email:'ben@brucegillinghampollard.com' };
const now = new Date('2026-10-27T11:00:00Z');
const invite = (id:string, participants:string[], start='2026-10-28T10:00:00Z') => ({
  id, companyId:'aew', companyName:'AEW', subject:id, start, end:new Date(Date.parse(start)+3600000).toISOString(), location:'London',
  participants:participants.map(email=>({name:email.split('@')[0],email})), bgpParticipants:[], source:'calendar' as const,
  sourceId:id, mailbox:'nick@brucegillinghampollard.com', webLink:null, matchReasons:[], checkedAt:now.toISOString(),
});
const digest:LandlordMeetingDigest = { meetings:[invite('nick-future',[nick.email,'manish@eu.aew.com']),invite('ben-future',[ben.email]),
  invite('nick-past',[nick.email],'2026-10-26T09:00:00Z'), invite('private',[nick.email,PRIVATE_MAILBOX])],
  nextMeeting:null,week:{start:'2026-10-26',end:'2026-11-02',timeZone:'Europe/London'},coverage:{status:'partial',checkedAt:now.toISOString(),mailboxesChecked:2,mailboxesExpected:4,issues:['Two diaries unavailable']} };

test('person history accepts one saved identity, never caller-supplied email or two identities',()=>{
  assert.equal(landlordPersonRequest({}),null);
  assert.deepEqual(landlordPersonRequest({personUserId:'nick-id'}),{userId:'nick-id'});
  assert.deepEqual(landlordPersonRequest({personContactId:'manish-id',email:'attacker@example.com'}),{contactId:'manish-id'});
  for(const query of [{personUserId:'nick',personContactId:'contact'},{personUserId:['nick']},{personUserId:''},{personContactId:'bad/id'}]) {
    assert.throws(()=>landlordPersonRequest(query),error=>error instanceof LandlordPersonScopeError && error.status===400);
  }
  assert.equal(landlordActivityPersonQuery({name:'Nick',userId:'nick-id'}),'?personUserId=nick-id');
  assert.equal(landlordActivityPersonQuery({name:'Manish',contactId:'manish-id'}),'?personContactId=manish-id');
});

test('person resolution verifies landlord and uses saved staff identity, including former team members',async()=>{
  const calls:any[]=[];
  const q={query:async(sql:string,params?:any[])=>{calls.push({sql,params});return {rows:sql.includes('FROM crm_companies')?[{id:'aew'}]:[{name:'Saved name',email:nick.email}]};}};
  const resolved=await resolveLandlordActivityPerson('aew',{userId:'nick-id'},{q});
  assert.equal(resolved?.email,nick.email);assert.equal(resolved?.name,'Saved name');assert.equal(resolved?.key,'staff:nick-id');
  assert.deepEqual(calls[0].params,['aew']);assert.match(calls[0].sql,/company_type/);
  assert.deepEqual(calls[1].params,['nick-id']);assert.match(calls[1].sql,/lower\(COALESCE\(role,''\)\) <> 'client'/);
  assert.doesNotMatch(calls[1].sql,/is_active/);
  await assert.rejects(resolveLandlordActivityPerson('brand',{userId:'nick-id'},{q:{query:async()=>({rows:[]})}}),/Landlord not found/);
});

test('contacts must belong to the resolved landlord account and private addresses are never available',async()=>{
  const q={query:async()=>({rows:[{id:'aew'}]})};
  const account=async()=>({contacts:[{contactId:'manish-id',name:'Manish',email:'MANISH@eu.aew.com'}] as any});
  assert.equal((await resolveLandlordActivityPerson('aew',{contactId:'manish-id'},{q,account}))?.email,'manish@eu.aew.com');
  await assert.rejects(resolveLandlordActivityPerson('aew',{contactId:'unrelated-id'},{q,account}),/no available linked email/);
  await assert.rejects(resolveLandlordActivityPerson('aew',{contactId:'private-id'},{q,account:async()=>({contacts:[{contactId:'private-id',name:'Private',email:PRIVATE_MAILBOX}] as any})}),/no available linked email/);
});

test('person matching uses participant metadata only, not names, notes, domains or quoted body',()=>{
  for(const row of [{bgp_user:nick.email.toUpperCase()},{participants:[nick.email]},{participants:[{emailAddress:{address:nick.email}}]},
    {participants:JSON.stringify([{email:nick.email}])}]) assert.equal(landlordRecordIncludesPerson(row,nick),true);
  for(const row of [{participants:[ben.email]},{participants:[{name:nick.email,email:ben.email}]},{preview:nick.email,subject:nick.email},
    {participants:[`not${nick.email}`]},{participants:[`${nick.email}.evil`]}]) assert.equal(landlordRecordIncludesPerson(row,nick),false);
});

test('meeting histories filter before the summary and next invitation selection while preserving partial coverage',()=>{
  const scoped=scopeLandlordMeetingDigest(digest,nick,+now);
  assert.deepEqual(scoped.meetings.map(m=>m.id),['nick-future','nick-past']);assert.equal(scoped.nextMeeting?.id,'nick-future');
  assert.equal(scoped.coverage,digest.coverage);assert.equal(scopeLandlordMeetingDigest(digest,null),digest);
  const source={name:'AEW',digest,person:nick,notes:[
    {source:'manual meeting note' as const,id:'nick-note',date:now.toISOString(),author:'Nick',subject:'Nick notes',excerpt:'Send the plan.',sourceUrl:'/',bgp_user:nick.email},
    {source:'manual meeting note' as const,id:'ben-note',date:now.toISOString(),author:'Ben',subject:'Ben notes',excerpt:'Different work.',sourceUrl:'/',bgp_user:ben.email},
  ]};
  const evidence=landlordMeetingSummaryEvidence(source,now);
  assert.deepEqual(evidence.notes.map(n=>n.id),['nick-note']);assert.equal(evidence.upcomingCount,1);assert.equal(evidence.recentCount,1);
  assert.doesNotMatch(JSON.stringify(evidence),/ben-future|private|Different work/);
});

test('person summary caches cannot be reused for another person or the company overview',async()=>{
  const prompts:string[]=[];
  const generate=async(prompt:string)=>{prompts.push(prompt);return '**Recent:** A past invitation is recorded. **Next:** See the next invitation.';};
  const opts={now,generate};
  await getLandlordMeetingSummary('person-cache-test',{name:'AEW',digest,person:nick},opts);
  await getLandlordMeetingSummary('person-cache-test',{name:'AEW',digest,person:nick},opts);
  await getLandlordMeetingSummary('person-cache-test',{name:'AEW',digest,person:ben},opts);
  await getLandlordMeetingSummary('person-cache-test',{name:'AEW',digest},opts);
  assert.equal(prompts.length,3);assert.match(prompts[0],/limited to invitations and saved notes involving Nick/);
  assert.doesNotMatch(prompts[0],/ben-future/);assert.match(prompts[1],/ben-future/);assert.doesNotMatch(prompts[1],/nick-future/);
});

test('summary route checks viewer access before identity and preserves 400/404 errors rather than widening the result',async()=>{
  const req={params:{companyId:'aew'},query:{personUserId:'nick-id'}} as any;
  const response=()=>({code:200,body:undefined as any,status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;}});
  let resolved=0,read=0,summarised=0;
  const deps={canRead:async()=>false,resolvePerson:async()=>{resolved++;return nick;},source:async()=>{read++;return{name:'AEW',digest};},summarise:async(_id:string,source:any)=>{summarised++;assert.equal(source.person,nick);return null;}};
  const denied=response();await handleLandlordMeetingSummary(req,denied as any,deps);assert.equal(denied.code,403);assert.equal(resolved,0);assert.equal(read,0);
  const good=response();await handleLandlordMeetingSummary(req,good as any,{...deps,canRead:async()=>true});assert.equal(good.code,200);assert.equal(summarised,1);
  const missing=response();await handleLandlordMeetingSummary(req,missing as any,{...deps,canRead:async()=>true,resolvePerson:async()=>{throw new LandlordPersonScopeError('No linked contact');}});
  assert.equal(missing.code,404);assert.equal(summarised,1);
});
