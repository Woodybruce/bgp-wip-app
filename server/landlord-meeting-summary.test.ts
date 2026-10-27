import assert from "node:assert/strict";
import test from "node:test";
import { getLandlordMeetingSummary, landlordMeetingSummaryEvidence, landlordMeetingSummaryPrompt, handleLandlordMeetingSummary, loadLandlordMeetingNotes, formatLandlordMeetingSummary } from "./landlord-meeting-summary";
import { PRIVATE_MAILBOX } from "./private-mail";

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
  assert.match(prompt,/not proof of attendance, acceptance/);assert.match(prompt,/incomplete coverage/);assert.match(prompt,/100–160 words/);
  assert.match(prompt,/40–80 words or fewer/);assert.match(prompt,/high invitation count alone is not a reason for a longer summary/);
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
  await getLandlordMeetingSummary('cache-test',{...source(),notes:[{source:'manual meeting note',id:'note',date:'2026-10-27T12:00:00Z',author:'Nick',
    subject:'AEW meeting',excerpt:'Send the updated schedule.',sourceUrl:'/companies/aew'}]},options);assert.equal(calls,4);
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

test('recurring invitations retain dates and counts without crowding out distinct workstreams',()=>{
  const meetings=[28,21,29,25,30,26,22].map(day=>invitation(`2026-10-${day}T10:00:00Z`,`2026-10-${day}T11:00:00Z`));
  meetings.push({...invitation('2026-10-20T10:00:00Z','2026-10-20T11:00:00Z'),subject:'Trinity leasing review'},
    {...invitation('2026-11-02T10:00:00Z','2026-11-02T11:00:00Z'),subject:'Bluewater lease advisory'});
  const evidence=landlordMeetingSummaryEvidence(source(meetings),new Date('2026-10-27T10:00:00Z'));
  assert.deepEqual(evidence.recent.map(row=>row.subject),['AEW / BGP catch-up','Trinity leasing review']);
  assert.equal(evidence.recent[0].start,'2026-10-26T10:00:00Z');assert.equal(evidence.recent[0].invitationCount,4);
  assert.equal(evidence.recent[0].firstInvitation,'2026-10-21T10:00:00Z');assert.equal(evidence.recentCount,5);
  assert.deepEqual(evidence.upcoming.map(row=>row.subject),['AEW / BGP catch-up','Bluewater lease advisory']);
  assert.equal(evidence.upcoming[0].start,'2026-10-28T10:00:00Z');assert.equal(evidence.upcoming[0].invitationCount,3);
  const prompt=landlordMeetingSummaryPrompt(evidence);
  assert.match(prompt,/Recent paragraph MUST comment on the latest past invitations even when future invitations exist/);
  assert.match(prompt,/\*\*Recent:\*\* and \*\*Next:\*\*/);
  assert.match(prompt,/notes are not recorded/);
  assert.equal(evidence.notesStatus,'No recent linked meeting notes recorded');
});

test('manual notes and CRM interview excerpts keep provenance and do not misclassify invite previews as outcomes',async()=>{
  let sql='';let params:any[]=[];
  const out=await loadLandlordMeetingNotes('aew',{now:new Date('2026-10-27T10:00:00Z'),q:{query:async(statement:string,values?:any[])=>{
    sql=statement;params=values||[];return {rows:[{id:'note',interaction_date:'2026-10-26T14:00:00Z',bgp_user:'nick@brucegillinghampollard.com',
      subject:'AEW catch-up',preview:'Nick to circulate the leasing schedule.',participants:['ben@eu.aew.com']},
      {id:'private-note',interaction_date:'2026-10-26T14:00:00Z',bgp_user:PRIVATE_MAILBOX,preview:'Must not enter summary.'}]};
  }},interviews:async()=>[
    {interviewId:'iv',team:'Leasing',interviewee:'Lizzie',meetingDate:'2026-10-25',updatedAt:'2026-10-26',questionId:'q',excerpt:'AEW requested a revised schedule.',companyId:'aew',companyName:'AEW',sourceUrl:'/contacts?tab=meetings&interview=iv'},
    {interviewId:'old',team:'Leasing',interviewee:'Nick',meetingDate:'2025-01-01',updatedAt:'2026-10-26',questionId:'q',excerpt:'Old material',companyId:'aew',companyName:'AEW',sourceUrl:''},
  ]});
  assert.match(sql,/i\.type='meeting' AND i\.match_method='manual'/);
  assert.ok(sql.indexOf('NOT bgp_private_mail_record') < sql.indexOf('LIMIT 30'));
  assert.match(sql,/i\.company_id=\$1/);assert.equal(params[0],'aew');
  assert.equal(out.notes.length,2);assert.equal(out.notesUnavailable,false);
  assert.equal(out.notes[0].source,'manual meeting note');assert.equal(out.notes[1].source,'CRM interview');
  const evidence=landlordMeetingSummaryEvidence({...source(),...out},new Date('2026-10-27T10:00:00Z'));
  assert.match(JSON.stringify(evidence),/Nick to circulate/);assert.match(JSON.stringify(evidence),/Lizzie/);
  assert.doesNotMatch(JSON.stringify(evidence),/Must not enter|Old material|equity@/);
  assert.match(landlordMeetingSummaryPrompt(evidence),/never associate a note with a specific invitation without an explicit link/);
});

test('missing note access is reported as unavailable rather than no notes, and formatting keeps both compact paragraphs visible',async()=>{
  const notes=await loadLandlordMeetingNotes('aew',{q:{query:async()=>{throw Error('DB unavailable');}},interviews:async()=>[]});
  assert.equal(notes.notesUnavailable,true);
  const evidence=landlordMeetingSummaryEvidence({...source(),...notes});
  assert.equal(evidence.notesStatus,'Some CRM notes could not be checked');
  const text='**Recent:** A catch-up was scheduled on 26 October; no notes are recorded.\n\n**Next:** The next invitation is for 28 October.';
  assert.equal(formatLandlordMeetingSummary(text),text);
  assert.equal(formatLandlordMeetingSummary('A catch-up was scheduled. The next invitation is tomorrow.'),'**A catch-up was scheduled.** The next invitation is tomorrow.');
});

test('private mailbox participants and notes cannot be sent to the meeting summary model',async()=>{
  const privateInvite={...invitation('2026-10-28T10:00:00Z','2026-10-28T11:00:00Z'),participants:[{name:'Private',email:PRIVATE_MAILBOX}]};
  let called=false;
  assert.equal(await getLandlordMeetingSummary('private-only',source([privateInvite]),{generate:async()=>{called=true;return 'Must not generate';}}),null);
  assert.equal(called,false);
});

test('meeting notes alone produce a summary and retain substantive longer responses within the bounded limit',async()=>{
  const now=new Date('2026-10-27T10:00:00Z');
  const notes=[{source:'manual meeting note' as const,id:'note',date:'2026-10-26T10:00:00Z',author:'Nick',subject:'Landsec leasing',
    excerpt:'Trinity leasing: Nick to circulate the updated schedule. Bluewater lease advisory: Lizzie requested the rent review dates.',sourceUrl:'/companies/landsec'}];
  let prompt='';const answer=`**Recent:** ${'Recorded detail '.repeat(70).trim()}\n\n**Next:** None is linked in the checked diaries.`;
  const result=await getLandlordMeetingSummary('notes-only',{...source([]),notes},{now,generate:async(value)=>{prompt=value;return answer;}});
  assert.ok(result);assert.equal(result!.text,answer);
  assert.match(prompt,/Trinity leasing/);assert.match(prompt,/Bluewater lease advisory/);
  assert.match(prompt,/without a linked calendar invitation, summarise those notes with attribution/);
  assert.match(prompt,/do not describe it as all BGP work or conclude little\/no work/);
  assert.match(prompt,/never invent an owner or deadline/);
});

test('notes selection spans different saved records, preserves fuller excerpts, and excludes private/future/old evidence',()=>{
  const now=new Date('2026-10-27T10:00:00Z');
  const note=(id:string,excerpt:string,date='2026-10-26T09:00:00Z')=>({source:'CRM interview' as const,id,date,author:'Lizzie',subject:'Leasing',excerpt,sourceUrl:'/contacts?tab=meetings'});
  const long=note('new-interview',`${'Lease review detail. '.repeat(40)}Nick to send the Trinity schedule.`);
  const notes=[long,...Array.from({length:12},(_,i)=>note('new-interview',`Another answer ${i}`)),
    note('different-meeting','Bluewater follow-up: review rent dates.','2026-10-25T09:00:00Z'),
    {...note('copied-private','Exclude this private note'),participants:[PRIVATE_MAILBOX]},
    {...note('private-owner','Exclude this owner note'),bgp_user:PRIVATE_MAILBOX},
    note('future','Exclude future','2026-11-20T09:00:00Z'),note('old','Exclude stale','2025-01-01T09:00:00Z'),long];
  const evidence=landlordMeetingSummaryEvidence({...source([]),notes},now);
  assert.equal(evidence.notes.length,12);assert.equal(evidence.evidenceSelection.notesAvailable,14);
  assert.equal(evidence.evidenceSelection.omittedNotes,2);
  assert.ok(evidence.notes.some(n=>n.id==='different-meeting'));
  assert.match(evidence.notes.find(n=>n.id==='new-interview')!.excerpt,/Nick to send the Trinity schedule/);
  assert.doesNotMatch(JSON.stringify(evidence),/Exclude this|Exclude future|Exclude stale|equity@/);
});

test('large diaries expose bounded topic coverage rather than silently representing the sample as the entire history',()=>{
  const meetings=Array.from({length:20},(_,i)=>({...invitation('2026-10-20T10:00:00Z','2026-10-20T11:00:00Z'),subject:`Property ${i} leasing`}));
  const evidence=landlordMeetingSummaryEvidence(source(meetings),new Date('2026-10-27T10:00:00Z'));
  assert.equal(evidence.recent.length,12);assert.equal(evidence.recentCount,20);
  assert.equal(evidence.evidenceSelection.recentTopics,20);assert.equal(evidence.evidenceSelection.omittedRecentTopics,8);
  assert.match(evidence.evidenceSelection.calendarScope,/not a full relationship history/);
});
