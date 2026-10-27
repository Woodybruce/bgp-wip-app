import assert from "node:assert/strict";
import test from "node:test";
import { getLandlordMeetingSummary, landlordMeetingSummaryEvidence, landlordMeetingSummaryPrompt, handleLandlordMeetingSummary } from "./landlord-meeting-summary";

const invitation = (start:string,end:string) => ({id:'aew:event',companyId:'aew',companyName:'AEW',subject:'AEW / BGP catch-up',start,end,
  location:'London',participants:[{name:'Ben Sykes',email:'ben@eu.aew.com'}],bgpParticipants:[{name:'Nick',email:'nick@brucegillinghampollard.com'}],
  source:'calendar' as const,sourceId:'event',mailbox:'nick@brucegillinghampollard.com',webLink:null,matchReasons:['domain'],checkedAt:'2026-10-27T08:00:00Z'});
const source = (meetings:any[]= [invitation('2026-10-28T10:00:00Z','2026-10-28T11:00:00Z')]) => ({name:'AEW',digest:{meetings,nextMeeting:meetings[0]||null,
  week:{start:'2026-10-26',end:'2026-11-02',timeZone:'Europe/London' as const},coverage:{status:'partial' as const,checkedAt:'2026-10-27T08:00:00Z',mailboxesChecked:1,mailboxesExpected:2,issues:['One diary unavailable']}}});

test('summary uses invitation metadata only and separates past, ongoing and future without inferring attendance',()=>{
  const s=source([{...invitation('2026-10-26T10:00:00Z','2026-10-26T11:00:00Z'),body:'Private body',preview:'Do not pass this'},
    invitation('2026-10-27T09:30:00Z','2026-10-27T10:30:00Z'),invitation('2026-10-28T10:00:00Z','2026-10-28T11:00:00Z')]);
  const evidence=landlordMeetingSummaryEvidence(s,new Date('2026-10-27T10:00:00Z'));
  assert.equal(evidence.upcoming[0].phase,'scheduled time in progress');
  assert.equal(evidence.upcoming[1].phase,'upcoming invitation');assert.equal(evidence.recent[0].phase,'past invitation');
  const prompt=landlordMeetingSummaryPrompt(evidence);
  assert.match(prompt,/not proof of attendance, acceptance/);assert.match(prompt,/incomplete coverage/);assert.match(prompt,/60–80 words/);
  assert.match(prompt,/Ben Sykes/);assert.match(prompt,/One diary unavailable/);assert.doesNotMatch(prompt,/Private body|Do not pass this|sourceId|webLink/);
});

test('cache reuses identical evidence, deduplicates concurrent generation, and changes when meeting phase or coverage changes',async()=>{
  let calls=0;
  const generate=async()=>{calls++;return 'The invitation lists Ben Sykes and Nick. Some diaries have not been checked.';};
  const options={now:new Date('2026-10-28T09:00:00Z'),generate};
  const first=await Promise.all([getLandlordMeetingSummary('cache-test',source(),options),getLandlordMeetingSummary('cache-test',source(),options)]);
  assert.equal(calls,1);assert.deepEqual(first[0],first[1]);
  await getLandlordMeetingSummary('cache-test',source(),{...options,now:new Date('2026-10-28T12:00:00Z')});assert.equal(calls,2);
  const changed=source();changed.digest.coverage.checkedAt='2026-10-28T12:00:00Z';
  await getLandlordMeetingSummary('cache-test',changed,options);assert.equal(calls,3);
});

test('empty evidence avoids the model and a stalled model is cancelled without breaking invitations',async()=>{
  let called=false,aborted=false;
  assert.equal(await getLandlordMeetingSummary('empty',source([]),{generate:async()=>{called=true;return 'Unwanted';}}),null);
  assert.equal(called,false);
  const result=await getLandlordMeetingSummary('timeout',source(),{timeoutMs:10,generate:async(_prompt,signal)=>{
    signal.addEventListener('abort',()=>{aborted=true;});return new Promise<string>(()=>{});
  }});
  assert.equal(result,null);assert.equal(aborted,true);
});

test('route requires staff before reading evidence, rejects non-landlords and fails summary generation gracefully',async()=>{
  const req={params:{companyId:'aew'},tokenUserId:'woody'} as any;
  const response=()=>({code:200,body:undefined as any,status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;}});
  let reads=0;
  const denied=response();await handleLandlordMeetingSummary(req,denied as any,{canRead:async()=>false,source:async()=>{reads++;return source();}});
  assert.equal(denied.code,403);assert.equal(reads,0);
  const missing=response();await handleLandlordMeetingSummary(req,missing as any,{canRead:async()=>true,source:async()=>null});assert.equal(missing.code,404);
  const unavailable=response();await handleLandlordMeetingSummary(req,unavailable as any,{canRead:async()=>true,source:async()=>source(),summarise:async()=>{throw Error('Model unavailable');}});
  assert.equal(unavailable.code,200);assert.deepEqual(unavailable.body,{summary:null});
  const success=response();await handleLandlordMeetingSummary(req,success as any,{canRead:async()=>true,source:async()=>source(),summarise:async()=>({text:'Summary',at:'2026-10-27T10:00:00Z'})});
  assert.deepEqual(success.body,{summary:{text:'Summary',at:'2026-10-27T10:00:00Z'}});
});
