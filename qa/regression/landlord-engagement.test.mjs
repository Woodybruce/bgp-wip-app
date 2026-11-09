import test from 'node:test';
import assert from 'node:assert/strict';
import { landlordEngagementView, landlordEventGuestSummary, crmEngagementLink } from '../../shared/landlord-engagement-view.ts';
import { landlordEngagementEvidence, renderLandlordRelationshipBrief, getLandlordRelationshipEvidence, landlordChatEvidencePrompt } from '../../server/landlord-relationship-brief.ts';

const now = Date.parse('2026-10-28T10:00:00Z');
const link = (companyId='landsec') => ({companyId,companyName:companyId,reason:'Discuss recorded retail vacancies'});
const event = (id, values={}) => ({id,title:id,kind:'bgp',startsAt:'2026-11-10T12:00:00Z',endsAt:null,
  status:'planned',dateConfirmed:true,outcome:null,ownerName:'Emmy',companies:[link()],guests:[],...values});
const strategy = (id,values={}) => ({id,name:id,objective:'Introduce relevant operators',status:'active',ownerName:'Charlotte',targets:[{...link(),contactIds:[]}],...values});
const action = (id,values={}) => ({id,title:id,companyId:'landsec',ownerName:'Nick',status:'todo',dueAt:'2026-10-30T10:00:00Z',...values});
const empty = () => ({strategies:[],events:[],actions:[]});

test('landlord view scopes links and uses explicit dates, event completion and task status',()=>{
  const view=landlordEngagementView({
    strategies:[strategy('retail'),strategy('other',{targets:[link('aew')]}),strategy('paused',{status:'paused'})],
    events:[event('future'),event('cancelled',{status:'cancelled'}),event('legacy-date',{dateConfirmed:false,startsAt:'2026-01-01T10:00:00Z'}),
      event('done',{status:'completed',startsAt:'2026-10-20T10:00:00Z',outcome:'Requested an operator shortlist'}),
      event('future-outcome',{status:'completed',outcome:'Not yet happened'}),event('draft-outcome',{outcome:'Unconfirmed note'}),
      event('other',{companies:[link('aew')]})],
    actions:[action('later'),action('first',{dueAt:'2026-10-29T10:00:00Z'}),action('no-date',{dueAt:null}),
      action('done',{status:'done'}),action('other',{companyId:'aew'})],
  },'landsec',now);
  assert.deepEqual(view.strategies.map(x=>x.id),['retail']);
  assert.deepEqual(view.upcoming.map(x=>x.id),['draft-outcome','future','legacy-date']);
  assert.deepEqual(view.completed.map(x=>x.id),['done']);
  assert.deepEqual(view.actions.map(x=>x.id),['first','later','no-date']);
});

test('guest labels preserve suggested, invited and attended separately and exclude other companies',()=>{
  assert.equal(landlordEventGuestSummary(event('event',{guests:[
    {companyId:'landsec',status:'suggested'},{companyId:'landsec',status:'accepted'},
    {companyId:'landsec',status:'invited'},{companyId:'aew',status:'attended'},
  ]}),'landsec'),'1 suggested · 1 invited · 1 accepted');
  const evidence=landlordEngagementEvidence({strategies:[],actions:[],events:[event('unconfirmed',{dateConfirmed:false,
    guests:[{companyId:'landsec',name:'Contact',status:'suggested'},{companyId:'aew',name:'Other',status:'accepted'}]})]},'landsec',now);
  assert.equal(evidence.upcomingEvents[0].startsAt,null);
  assert.deepEqual(evidence.upcomingEvents[0].guests,[{name:'Contact',status:'suggested'}]);
  assert.match(landlordChatEvidencePrompt({company:{id:'landsec',name:'Landsec'},engagement:evidence},'Woody'),/accepted does not mean attended/);
});

test('relationship take records the specific plan, past outcome and existing follow-up instead of a generic next step',()=>{
  const engagement=landlordEngagementEvidence({strategies:[strategy('Retail leasing')],
    events:[event('Operator breakfast',{status:'completed',startsAt:'2026-10-20T10:00:00Z',outcome:'Staff note: client requested a shortlist.'})],
    actions:[action('Prepare the operator shortlist')]},'landsec',now);
  const text=renderLandlordRelationshipBrief({company:{id:'landsec',name:'Landsec'},engagement}, {omitMeetingAndTeam:true});
  assert.match(text,/Relationship plan.*Retail leasing.*Discuss recorded retail vacancies/);
  assert.match(text,/Recorded event outcome.*20 Oct 2026.*Staff note: client requested a shortlist/);
  assert.match(text,/Open follow-ups.*Prepare the operator shortlist.*Nick.*due 30 Oct 2026/);
  assert.doesNotMatch(text,/Next step:|attended|instruction won|fee|warm/);
  assert.equal(crmEngagementLink('landsec',{event:'x/y'}),'/contacts?tab=overview&company=landsec&event=x%2Fy');
});

test('engagement uses the same company-linked reader and does not run for brands',async()=>{
  let calls=0;
  const deps={pool:{query:async sql=>({rows:sql.includes('AS is_landlord')?[{id:'landsec',name:'Landsec',is_landlord:true}]:[]})},
    relationshipTeam:async()=>null,meetingDigest:async()=>({meetings:[],coverage:{status:'current'}}),interviews:async()=>[],
    engagement:async companyId=>{calls++;assert.equal(companyId,'landsec');return empty();}};
  const evidence=await getLandlordRelationshipEvidence('landsec',deps);
  assert.equal(calls,1);assert.deepEqual(evidence.engagement.openActions,[]);
  const brand=await getLandlordRelationshipEvidence('brand',{...deps,pool:{query:async()=>({rows:[{id:'brand',is_landlord:false}]})}});
  assert.equal(brand,null);assert.equal(calls,1);
  const failed=await getLandlordRelationshipEvidence('landsec',{...deps,engagement:async()=>{throw new Error('Unavailable');}});
  assert.ok(failed.issues.includes('CRM relationship plan unavailable'));
  assert.deepEqual(failed.engagement.strategies,[]);
});
