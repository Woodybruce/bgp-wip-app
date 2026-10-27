import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createRequire } from 'node:module';
import { matchLandlordMeeting, londonWeek, type LandlordCatalogueEntry } from './landlord-meeting-matching';

let api: typeof import('./landlord-meetings');
before(async () => {
  process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:1/test';
  api = await import('./landlord-meetings');
});
const aew: LandlordCatalogueEntry = { id:'aew', name:'AEW', company_type:'Landlord', domain:'aew.com',domain_url:null, contacts:[] };
const person = (email: string, name = email) => ({ email, name });
const now = new Date('2026-10-27T10:00:00Z');
const staff = [{ email:'nick@brucegillinghampollard.com', name:'Nick' }, { email:'vics@brucegillinghampollard.com', name:'Victoria' }];
const raw = (overrides: any = {}) => ({ id:'event-1', iCalUId:'uid-1', subject:'Meeting with Ben', sensitivity:'normal',
  start:{ dateTime:'2026-10-28T09:00:00',timeZone:'UTC' },end:{ dateTime:'2026-10-28T10:00:00',timeZone:'UTC' },
  attendees:[{emailAddress:{address:'ben@eu.aew.com',name:'Ben Sykes'}},{emailAddress:{address:staff[0].email,name:'Nick'}}],
  organizer:{ emailAddress:{address:'manish@eu.aew.com',name:'Manish'} }, location:{displayName:'London'},
  webLink:'https://outlook.office.com/calendar/item/event-1', lastModifiedDateTime:'2026-10-27T08:00:00Z', ...overrides });
const snapshot = (mailbox: string, events: any[], overrides: any = {}) => ({ mailbox,checkedAt:now.toISOString(),attemptedAt:now.toISOString(),
  start:'2026-10-01T00:00:00Z',end:'2027-01-01T00:00:00Z',events,issue:null,...overrides });

test('regional landlord invitation domains link without a saved contact and do not use substring matches', () => {
  assert.equal(matchLandlordMeeting('Catch up', [person('ben@eu.aew.com')], [aew])[0]?.company.id, 'aew');
  assert.equal(matchLandlordMeeting('Catch up', [person('ben@not-aew.com')], [aew]).length,0);
  assert.equal(matchLandlordMeeting('Catch up', [person('ben@aew.com.evil.example')], [aew]).length,0);
});
test('ambiguous shared domains skip automatic linking and exact contact disambiguates', () => {
  const other = { ...aew,id:'aew-fund',name:'AEW Fund' };
  assert.equal(matchLandlordMeeting('Catch up',[person('ben@eu.aew.com')],[aew,other]).length,0);
  const named = { ...aew,contacts:[{id:'ben',name:'Ben Sykes',email:'ben@eu.aew.com'}] };
  assert.deepEqual(matchLandlordMeeting('Catch up',[person('ben@eu.aew.com')],[named,other]).map(x=>x.company.id),['aew']);
});
test('specific domains outrank parent domains; generic email domains and brands do not auto-link', () => {
  const europe = { ...aew,id:'europe',name:'AEW Europe',domain:'eu.aew.com' };
  assert.equal(matchLandlordMeeting('Catch up',[person('ben@eu.aew.com')],[aew,europe])[0]?.company.id,'europe');
  assert.equal(matchLandlordMeeting('Catch up',[person('someone@gmail.com')],[{...aew,domain:'gmail.com'}]).length,0);
  assert.equal(matchLandlordMeeting('AEW',[person('ben@aew.com')],[{...aew,company_type:'Tenant - Retail'}]).length,0);
});
test('full landlord names are linked in invitation subjects, not contact-name guesses', () => {
  assert.equal(matchLandlordMeeting('AEW / BGP catch up',[],[aew])[0]?.company.id,'aew');
  assert.equal(matchLandlordMeeting('SomeAEWother',[],[aew]).length,0);
  assert.equal(matchLandlordMeeting('not-aew.com, x@aew.com.evil.test',[],[aew]).length,0);
  assert.equal(matchLandlordMeeting('Ben Sykes catch up',[],[aew]).length,0);
});
test('London week uses local Monday to Sunday across daylight-saving boundaries', () => {
  assert.deepEqual(londonWeek(new Date('2026-10-25T11:00:00Z')), {start:'2026-10-18T23:00:00.000Z',end:'2026-10-26T00:00:00.000Z',timeZone:'Europe/London'});
  assert.deepEqual(londonWeek(new Date('2026-03-29T11:00:00Z')), {start:'2026-03-23T00:00:00.000Z',end:'2026-03-29T23:00:00.000Z',timeZone:'Europe/London'});
});
test('normalised invitations include attendees and reject private, confidential and unknown-sensitivity events', () => {
  const event = api.normaliseLandlordDiaryEvent(raw())!;
  assert.equal(event.participants[0].name,'Manish');
  assert.equal(event.start,'2026-10-28T09:00:00.000Z');
  for (const sensitivity of ['private','personal','confidential']) assert.equal(api.normaliseLandlordDiaryEvent(raw({sensitivity})),null);
  assert.throws(()=>api.normaliseLandlordDiaryEvent(raw({sensitivity:undefined})),/privacy setting/);
  assert.throws(()=>api.normaliseLandlordDiaryEvent(raw({end:undefined})),/incomplete meeting/);
  assert.throws(()=>api.normaliseLandlordDiaryEvent(raw({start:{dateTime:'2026-10-28T09:00:00',timeZone:'Europe/London'}})),/unexpected timezone/);
  assert.equal(api.normaliseLandlordDiaryEvent(raw({webLink:'javascript:alert(1)'}))!.webLink,null);
});
test('duplicate mailbox invitations appear once, participants are named, and latest reschedule wins', () => {
  const event = api.normaliseLandlordDiaryEvent(raw())!;
  const changed = api.normaliseLandlordDiaryEvent(raw({id:'event-copy',start:{dateTime:'2026-10-28T11:00:00',timeZone:'UTC'},end:{dateTime:'2026-10-28T12:00:00',timeZone:'UTC'},lastModifiedDateTime:'2026-10-27T09:00:00Z'}))!;
  const digest = api.buildLandlordMeetingDigest([snapshot(staff[0].email,[event]),snapshot(staff[1].email,[changed])],[aew],staff,{now});
  assert.equal(digest.meetings.length,1);
  assert.equal(digest.nextMeeting?.start,'2026-10-28T11:00:00.000Z');
  assert.equal(digest.nextMeeting?.sourceId,'event-copy');
  assert.equal(digest.nextMeeting?.participants.find(p=>p.email===staff[0].email)?.name,'Nick');
  assert.equal(digest.coverage.status,'current');
});
test('cancellations remove a prior invitation and recurring instances remain separate', () => {
  const event = api.normaliseLandlordDiaryEvent(raw())!;
  const cancelled = api.normaliseLandlordDiaryEvent(raw({isCancelled:true,lastModifiedDateTime:'2026-10-27T09:00:00Z'}))!;
  const later = api.normaliseLandlordDiaryEvent(raw({id:'later',iCalUId:'uid-2',start:{dateTime:'2026-11-04T09:00:00',timeZone:'UTC'},end:{dateTime:'2026-11-04T10:00:00',timeZone:'UTC'}}))!;
  const snaps = [snapshot(staff[0].email,[event,later]),snapshot(staff[1].email,[cancelled])];
  assert.equal(api.buildLandlordMeetingDigest(snaps,[aew],staff,{now}).meetings.length,1);
  assert.equal(api.buildLandlordMeetingDigest(snaps,[aew],staff,{now,weekOnly:true}).meetings.length,0);
});
test('no scan and partial/stale scans never claim an empty diary is complete', () => {
  assert.equal(api.buildLandlordMeetingDigest([],[aew],staff,{now}).coverage.status,'not_synced');
  const old = snapshot(staff[0].email,[],{checkedAt:'2026-10-26T09:00:00Z',issue:'Microsoft denied access to this diary'});
  const digest = api.buildLandlordMeetingDigest([old],[aew],staff,{now});
  assert.equal(digest.coverage.status,'partial');
  assert.equal(digest.coverage.mailboxesChecked,1);
  assert.equal(digest.coverage.mailboxesExpected,2);
  assert.match(digest.coverage.issues.join(' '),/denied access/);
  assert.match(digest.coverage.issues.join(' '),/not checked/);
});
test('calendar pagination requires every page and uses UTC without broadening the host', async () => {
  const requests: string[] = [];
  const fetcher = async (url: any, opts: any) => {
    requests.push(url); assert.equal(opts.headers.Prefer,'outlook.timezone="UTC"');
    return new Response(JSON.stringify(requests.length===1 ? {value:[raw()], '@odata.nextLink':'https://graph.microsoft.com/v1.0/next'} : {value:[raw({id:'page2'})]}));
  };
  assert.equal((await api.fetchLandlordCalendar('test',staff[0].email,{start:now.toISOString(),end:'2026-11-01T00:00:00Z'},fetcher as any)).length,2);
  await assert.rejects(api.fetchLandlordCalendar('test',staff[0].email,{start:'x',end:'y'},(async()=>new Response(JSON.stringify({value:[], '@odata.nextLink':'https://other.example/steal'}))) as any),/Invalid calendar continuation/);
  await assert.rejects(api.fetchLandlordCalendar('test',staff[0].email,{start:'x',end:'y'},(async()=>new Response('truncated')) as any),/incomplete diary response/);
});
test('snapshot capture saves domain-linked meetings without creating contacts or changing Brand interactions', async () => {
  const writes: string[]=[]; let saved: any;
  const q={query:async(sql:string,values?:any[])=>{
    if(sql.startsWith('SELECT lower'))return {rows:staff};
    if(sql.startsWith('SELECT value'))return {rows:[]};
    writes.push(sql); saved=JSON.parse(values![1]); return {rows:[]};
  }};
  await api.captureLandlordDiary([raw(),raw({id:'private',sensitivity:'private'}),
    raw({id:'brand',subject:'Brand catch up',organizer:null,attendees:[{emailAddress:{address:'person@brand.example'}}]}),
    raw({id:'unrelated-cancellation',subject:'Unrelated cancelled appointment',isCancelled:true,organizer:null,attendees:[]}),
  ],staff[0].email,{start:'2026-10-01',end:'2027-01-01'},{q,catalogue:[aew],now});
  assert.equal(saved.events.length,1); assert.equal(writes.length,1);
  assert.doesNotMatch(JSON.stringify(saved),/Unrelated cancelled appointment/);
  assert.match(writes[0],/INSERT INTO system_settings/); assert.doesNotMatch(writes.join(' '),/crm_contacts|crm_interactions|crm_companies/);
});

test('a complete scan revokes removed or newly private meetings from stale mailbox copies', async () => {
  const event=api.normaliseLandlordDiaryEvent(raw())!;
  const earlier=snapshot(staff[0].email,[event],{checkedAt:'2026-10-27T08:00:00Z'});
  let saved:any;
  const q={query:async(sql:string,values?:any[])=>{
    if(sql.startsWith('SELECT lower'))return {rows:staff};
    if(sql.startsWith('SELECT value'))return {rows:[{value:earlier}]};
    saved=JSON.parse(values![1]);return {rows:[]};
  }};
  await api.captureLandlordDiary([],staff[0].email,{start:'2026-10-01',end:'2027-01-01'},{q,catalogue:[aew],now});
  assert.equal(api.buildLandlordMeetingDigest([saved,{...earlier,mailbox:staff[1].email}],[aew],staff,{now}).meetings.length,0);
  await api.captureLandlordDiary([raw({sensitivity:'private',subject:'Private: should never be stored',lastModifiedDateTime:'2026-10-27T09:30:00Z'})],staff[0].email,{start:'2026-10-01',end:'2027-01-01'},{q,catalogue:[aew],now});
  assert.doesNotMatch(JSON.stringify(saved),/Private: should never be stored|Ben Sykes|manish@/);
  assert.equal(api.buildLandlordMeetingDigest([saved,{...earlier,mailbox:staff[1].email}],[aew],staff,{now}).meetings.length,0);
});

test('diary routes reject client accounts, impersonated client views, inactive and non-BGP users', async () => {
  const require = createRequire(import.meta.url);
  const {find,evaluate,ts} = require('../qa/regression/source-harness.cjs');
  const source = find('server/landlord-meetings.ts',(node:any)=>ts.isFunctionDeclaration(node)&&node.name?.text==='canReadLandlordMeetings');
  for (const scenario of [
    {client:true,scope:null,user:{email:staff[0].email},allowed:false},
    {client:false,scope:'landsec',user:{email:staff[0].email},allowed:false},
    {client:false,scope:null,user:{email:'outside@example.com'},allowed:false},
    {client:false,scope:null,user:{email:staff[0].email,is_active:false},allowed:false},
    {client:false,scope:null,user:{email:staff[0].email,role:'Client'},allowed:false},
    {client:false,scope:null,user:{email:staff[0].email,role:'Agent',is_active:true},allowed:true},
  ]) {
    const {canReadLandlordMeetings} = evaluate(source,{
      isClientRequestUser:async()=>scenario.client,resolveCompanyScope:async()=>scenario.scope,
      pool:{query:async()=>({rows:[scenario.user]})},STAFF_DOMAIN:'@brucegillinghampollard.com',
    });
    assert.equal(await canReadLandlordMeetings({session:{userId:'test'}}),scenario.allowed);
    assert.equal(await canReadLandlordMeetings({tokenUserId:'test'}),scenario.allowed);
    assert.equal(await canReadLandlordMeetings({}),false);
  }
});

const searchRequest = { session: { userId: 'nick' } } as any;
function searchDependencies(events: Record<string, any[] | Error>, overrides: any = {}) {
  const statements: string[] = [];
  const requested: Array<{ mailbox: string; window: any }> = [];
  const deps = {
    q: { query: async (sql: string) => {
      statements.push(sql);
      if (sql.startsWith('SELECT c.id')) return { rows: [aew, { ...aew, id: 'other', name: 'Other Landlord', domain: 'other.example' }] };
      if (sql.startsWith('SELECT lower(trim(email)) AS email,name')) return { rows: staff };
      if (sql.startsWith('SELECT lower(trim(email)) AS email FROM users')) return { rows: [staff[0]] };
      throw new Error('Unexpected database access');
    } },
    now, canRead: async () => true, getToken: async () => 'test',
    fetchCalendar: async (_token: string, mailbox: string, window: any) => {
      requested.push({ mailbox, window });
      const result = events[mailbox];
      if (result instanceof Error) throw result;
      return result || [];
    },
    ...overrides,
  };
  return { deps, statements, requested };
}

test('landlord live search is scoped, private-safe, cancelled-safe and never writes broad diary snapshots', async () => {
  const events = [raw(), raw({id:'private',iCalUId:'private',sensitivity:'private',subject:'Private landlord matter'}),
    raw({id:'other',iCalUId:'other',subject:'Other Landlord',organizer:null,attendees:[{emailAddress:{address:'person@other.example'}}]}),
    raw({id:'cancelled',iCalUId:'cancelled'}), raw({id:'changed-private',iCalUId:'changed-private'})];
  const {deps, statements} = searchDependencies({ [staff[0].email]: events, [staff[1].email]: [
    raw({id:'copy'}),
    raw({id:'cancel-copy',iCalUId:'cancelled',isCancelled:true,subject:'',attendees:[],organizer:null,lastModifiedDateTime:'2026-10-27T09:00:00Z'}),
    raw({id:'private-copy',iCalUId:'changed-private',sensitivity:'private',lastModifiedDateTime:'2026-10-27T09:00:00Z'}),
  ] });
  const result = await api.searchLandlordMeetings({req:searchRequest,companyId:'aew',query:'Ben Sykes'},deps);
  assert.ok('events' in result);
  assert.equal(result.events!.length,1);
  assert.equal(result.events![0].companyId,'aew');
  assert.equal(result.events![0].participants[0].name,'Manish');
  assert.equal(result.coverage!.status,'current');
  assert.equal(result.coverage!.mailboxesChecked,2);
  assert.doesNotMatch(JSON.stringify(result),/Private landlord matter|Other Landlord|cancelled|changed-private/);
  assert.ok(statements.every(sql=>sql.startsWith('SELECT')));
});

test('landlord live search reports per-mailbox failure and unknown privacy as incomplete, never a complete empty diary', async () => {
  const {deps} = searchDependencies({ [staff[0].email]:[raw()], [staff[1].email]:new Error('Microsoft denied access to this diary') });
  const result=await api.searchLandlordMeetings({req:searchRequest,companyId:'aew'},deps);
  assert.ok('events' in result); assert.equal(result.events!.length,1); assert.equal(result.coverage!.status,'partial');
  assert.equal(result.coverage!.mailboxes[1].status,'unavailable');
  assert.match(result.coverage!.issues[0],/denied access/);
  const failed=searchDependencies({ [staff[0].email]:[raw({sensitivity:undefined})], [staff[1].email]:new Error('Provider leaked token should not be exposed') });
  const empty=await api.searchLandlordMeetings({req:searchRequest,companyId:'aew'},failed.deps);
  assert.equal(empty.events!.length,0); assert.equal(empty.coverage!.status,'not_synced');
  assert.doesNotMatch(JSON.stringify(empty),/Provider leaked token/);
});

test('landlord live search denies access, unknown landlords, non-staff and ambiguous names before fetching', async () => {
  const denied=searchDependencies({}, {canRead:async()=>false});
  assert.ok('error' in await api.searchLandlordMeetings({req:searchRequest,companyId:'aew'},denied.deps));
  assert.equal(denied.statements.length,0); assert.equal(denied.requested.length,0);
  for (const options of [{companyId:'not-a-landlord'}, {companyId:'aew',mailbox:'outsider@example.com'}, {companyId:'aew',teamMember:'BGP'}]) {
    const {deps, requested}=searchDependencies({});
    assert.ok('error' in await api.searchLandlordMeetings({req:searchRequest,...options},deps));
    assert.equal(requested.length,0);
  }
  const ambiguous=searchDependencies({}, {q:{query:async(sql:string)=>({rows:sql.startsWith('SELECT c.id')?[aew]:[{email:staff[0].email,name:'Ben Sykes'},{email:staff[1].email,name:'Ben Jones'}]})}});
  const result=await api.searchLandlordMeetings({req:searchRequest,companyId:'aew',teamMember:'Ben'},ambiguous.deps);
  assert.match(result.error!,/more than one/); assert.equal(ambiguous.requested.length,0);
});

test('landlord live search respects me and unique staff names with explicit bounded date coverage and result limits', async () => {
  for (const selection of [{mailbox:'me'},{teamMember:'Nick'},{mailbox:staff[0].email}]) {
    const {deps,requested}=searchDependencies({[staff[0].email]:[raw(),raw({id:'two',iCalUId:'two'})]});
    const result=await api.searchLandlordMeetings({req:searchRequest,companyId:'aew',...selection,daysAhead:7,top:1},deps);
    assert.equal(requested.length,1); assert.equal(requested[0].mailbox,staff[0].email);
    assert.equal(result.coverage!.mailboxesExpected,1); assert.equal(result.coverage!.status,'current');
    assert.equal(result.total,2); assert.equal(result.events!.length,1); assert.equal(result.truncated,true);
    assert.equal(result.window!.end,'2026-11-03T10:00:00.000Z');
  }
  for (const dates of [{daysAhead:121},{daysAhead:-1},{startDateTime:'2026-02-30'},{startDateTime:'2026-02-30T09:00:00Z'},
    {startDateTime:'2026-10-28T09:00:00'}, {startDateTime:'2026-11-01',endDateTime:'2026-10-01'},
    {startDateTime:'2026-01-01',endDateTime:'2027-01-01'}]) {
    const {deps,requested}=searchDependencies({});
    assert.ok('error' in await api.searchLandlordMeetings({req:searchRequest,companyId:'aew',...dates},deps));
    assert.equal(requested.length,0);
  }
  const summer=searchDependencies({});
  const london=await api.searchLandlordMeetings({req:searchRequest,companyId:'aew',startDateTime:'2026-06-01',endDateTime:'2026-06-02'},summer.deps);
  assert.equal(london.window!.start,'2026-05-31T23:00:00.000Z');
  assert.equal(london.window!.end,'2026-06-01T23:00:00.000Z');
});

test('explicit absence entries never become landlord meetings, while Holiday Inn meetings remain', async () => {
  const absenceSubjects = ['Jack annual leave x3 days', 'Nick — OUT OF OFFICE', 'OOO - Victoria', 'Ben out-of-office', 'Sick leave'];
  for (const subject of absenceSubjects) assert.equal(api.isLandlordDiaryAbsence(subject),true);
  for (const subject of ['Holiday Inn site meeting with AEW', 'AEW office meeting', 'Goodwood visit']) assert.equal(api.isLandlordDiaryAbsence(subject),false);
  const absences = absenceSubjects.map((subject,i)=>raw({id:`leave-${i}`,iCalUId:`leave-${i}`,subject}));
  const legitimate = raw({id:'hotel',iCalUId:'hotel',subject:'Holiday Inn site meeting with AEW'});
  const saved = snapshot(staff[0].email,[...absences,legitimate].map(api.normaliseLandlordDiaryEvent));
  assert.deepEqual(api.buildLandlordMeetingDigest([saved],[aew],staff,{now,weekOnly:true}).meetings.map(m=>m.subject),[legitimate.subject]);
  let captured:any;
  const q={query:async(sql:string,values?:any[])=>{
    if(sql.startsWith('SELECT lower'))return {rows:staff};
    if(sql.startsWith('SELECT value'))return {rows:[{value:saved}]};
    captured=JSON.parse(values![1]);return {rows:[]};
  }};
  await api.captureLandlordDiary([...absences,legitimate],staff[0].email,{start:'2026-10-01',end:'2027-01-01'},{q,catalogue:[aew],now});
  assert.equal(captured.events.length,1);
  assert.doesNotMatch(JSON.stringify(captured),/annual leave|OUT OF OFFICE|Sick leave/);
  const {deps}=searchDependencies({[staff[0].email]:[...absences,legitimate]});
  const live=await api.searchLandlordMeetings({req:searchRequest,companyId:'aew'},deps);
  assert.deepEqual(live.events!.map(m=>m.subject),[legitimate.subject]);
});

test('coverage preserves a first-scan error and explains a missing Outlook calendar', async () => {
  const issue='Microsoft could not find an Outlook calendar for this account';
  const failed=snapshot(staff[0].email,[],{checkedAt:null,issue});
  const digest=api.buildLandlordMeetingDigest([failed],[aew],[staff[0]],{now});
  assert.equal(digest.coverage.status,'not_synced');
  assert.deepEqual(digest.coverage.issues,[`Nick: ${issue}`]);
  await assert.rejects(api.fetchLandlordCalendar('test',staff[0].email,{start:now.toISOString(),end:'2026-11-01T00:00:00Z'},
    (async()=>new Response('',{status:404})) as any),/could not find an Outlook calendar/);
  const {deps}=searchDependencies({[staff[0].email]:new Error(issue)});
  const live=await api.searchLandlordMeetings({req:searchRequest,companyId:'aew',mailbox:'me'},deps);
  assert.equal(live.coverage!.status,'not_synced');
  assert.match(live.coverage!.issues[0],/could not find an Outlook calendar/);
});
