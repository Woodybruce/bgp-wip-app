import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { getLandlordRelationshipEvidence, renderLandlordRelationshipBrief, landlordChatEvidencePrompt, landlordChatHistory, guardLandlordSaveClaim, landlordConversationUpdates, isInternalLandlordThread, landlordDealRelationship, landlordCorrespondence } from '../../server/landlord-relationship-brief.ts';

const fixture = () => ({ company: { id:'aew', name:'AEW' }, coverage: { status:'current' },
  nextMeeting: { subject:'AEW / BGP catch-up', start:'2026-10-28T10:00:00Z', participants:[{name:'Manish',email:'manish@eu.aew.com'},{name:'Ben Sykes',email:'ben@eu.aew.com'}],bgpParticipants:[{name:'Nick',email:'nick@bgp.example'},{name:'Vics',email:'vics@bgp.example'}] },
  bgpTeam:[{name:'Will Penfold',source:'deal',role:null}],
  deals:[{name:'Dough T2',deal_ref:3629,status:'SOL'},{name:'Dough T1',deal_ref:3295,status:'INV'}], interviewMentions:[], issues:[] });

test('landlord relationship starts with dated meeting and participants before team and actual deal stages', () => {
  const text=renderLandlordRelationshipBrief(fixture());
  assert.match(text,/AEW — next meeting Wed,? 28 Oct, 10:00/);
  assert.ok(text.indexOf('Ben Sykes') < text.indexOf('BGP team'));
  assert.match(text,/Manish, Ben Sykes, Nick, Vics/);
  assert.match(text,/Will Penfold \(from deal records\)/);
  assert.match(text,/Dough T2 #3629 — with solicitors/);
  assert.match(text,/Dough T1 #3295 — invoiced/);
  assert.doesNotMatch(text,/warm|cold|momentum|decision-maker|mandate/);
});

test('mail volume and previous AI text cannot invent warmth or change the factual summary',()=>{
 const evidence=fixture(), expected=renderLandlordRelationshipBrief(evidence);
 assert.equal(renderLandlordRelationshipBrief({...evidence, interactions_90d:999, old_summary:'AEW is warm with a current mandate'}),expected);
});

test('relationship take separates tenant representation at linked assets from landlord-side deals and preserves legacy notes and stages',()=>{
 const text=renderLandlordRelationshipBrief({...fixture(),
  properties:[{name:'New Oxford Street',status:'BGP Instruction'}],
  deals:[{name:'Dough T2',deal_ref:3629,status:'SOL',property_name:'New Oxford Street',landlord_id:'aew',bgp_acting_for:'landlord',notes:'Continues as a legacy deal after the wider disinstruction.'},
   {name:'DanDan',deal_ref:4001,status:'NEG',property_name:'New Oxford Street',landlord_id:'aew',bgp_acting_for:'tenant',tenant_name:'DanDan'}],
  communications:{items:[{subject:'RE: AEW catch-up',date:'2026-10-26',bgpName:'Nick',contactName:'Manish'}]},
  interviewMentions:[{interviewee:'Lizzie',meetingDate:'2026-10-20',excerpt:'AEW: confirm the legacy deal position.'}]});
 assert.match(text,/New Oxford Street \(CRM status: BGP Instruction\)/);
 assert.match(text,/Links do not confirm a current instruction/);
 assert.match(text,/Dough T2 #3629 — with solicitors at New Oxford Street \(recorded landlord-side deal\)/);
 assert.match(text,/CRM note: “Continues as a legacy deal/);
 assert.match(text,/DanDan #4001 — negotiating at New Oxford Street \(tenant representation\)/);
 assert.match(text,/26 Oct 2026, Nick \/ Manish/);
 assert.match(text,/Saved subjects, not confirmed outcomes/);
 assert.match(text,/Lizzie, 20 Oct 2026/);
 assert.doesNotMatch(text,/DanDan[^\n]*landlord-side deal|warm|strong relationship|key decision/);
});

test('property/deal links alone never establish an instruction and tenant representation overrides a landlord counterparty field',()=>{
 assert.equal(landlordDealRelationship({bgp_acting_for:'tenant',landlord_id:'aew'},'aew').instruction,false);
 assert.equal(landlordDealRelationship({bgp_acting_for:'landlord',landlord_id:'other',company_deal_link:true,at_linked_property:true},'aew').instruction,false);
 assert.equal(landlordDealRelationship({landlord_id:'aew'},'aew').instruction,false);
 assert.equal(landlordDealRelationship({bgp_acting_for:'landlord',landlord_id:'aew'},'aew').instruction,true);
 assert.equal(landlordDealRelationship({deal_type:'Lease Disposal',bgp_acting_for:'landlord',landlord_id:'aew'},'aew').kind,'conflict');
 assert.equal(landlordDealRelationship({deal_type:'Lease Disposal',landlord_id:'aew'},'aew').kind,'tenant_rep');
});

test('recent correspondence deduplicates reply chains and exposes subject metadata without email bodies or invented outcomes',()=>{
 const result=landlordCorrespondence([{id:'latest',subject:'Re: RE: AEW meeting',interaction_date:'2026-10-27',preview:'Private body',bgp_name:'Nick'},
  {id:'older',subject:'AEW meeting',interaction_date:'2026-10-26'},{id:'different',subject:'New Oxford Street',interaction_date:'2026-10-25'}]);
 assert.deepEqual(result.map(row=>row.id),['latest','different']);
 assert.equal(result[0].subject,'AEW meeting');assert.equal(result[0].bgpName,'Nick');
 assert.match(result[0].source,/contents and outcome not reviewed/);
 assert.doesNotMatch(JSON.stringify(result),/Private body|preview/);
});

test('evidence reads company-linked and property-linked deals plus bounded exact-domain correspondence',async()=>{
 const queries=[];
 const q={query:async(sql,params)=>{queries.push({sql,params});if(sql.includes('AS is_landlord'))return{rows:[{id:'aew',name:'AEW',domain:'aew.com',is_landlord:true}]};return{rows:[]};}};
 await getLandlordRelationshipEvidence('aew',{pool:q,relationshipTeam:async()=>null,meetingDigest:async()=>({meetings:[],nextMeeting:null,coverage:{status:'current'}}),interviews:async()=>[]});
 const deals=queries.find(query=>query.sql.includes('LEFT(d.comments'));
 assert.match(deals.sql,/crm_company_deals/);assert.match(deals.sql,/cp.property_id=p.id AND cp.company_id=\$1/);
 assert.match(deals.sql,/p.asset_manager_id=\$1/);assert.match(deals.sql,/d.bgp_acting_for/);
 const mail=queries.find(query=>query.sql.includes('FROM crm_interactions i'));
 assert.deepEqual(mail.params,['aew',['aew.com']]);
 assert.match(mail.sql,/i.type='email'/);assert.match(mail.sql,/BETWEEN now\(\)-interval '90 days' AND now\(\)/);
 assert.match(mail.sql,/NOT bgp_private_mail_record\(i.bgp_user, i.participants\)/);
 assert.ok(mail.sql.indexOf('NOT bgp_private_mail_record') < mail.sql.indexOf('LIMIT 60'));
 assert.match(mail.sql,/split_part\(lower\(trim\(participant\)\),'@',2\)=domain/);
 assert.match(mail.sql,/length\(domain\)\+1\)='\.'\|\|domain/);
 assert.doesNotMatch(mail.sql,/i.preview|ILIKE/);
});

test('compact relationship summary retains the work and reported changes without repeating meeting or team panels',()=>{
 const text=renderLandlordRelationshipBrief({...fixture(),conversationUpdates:[{speaker:'Woody Bruce',date:'2026-10-27',report:'AEW disinstructed BGP on New Oxford Street'}]}, {omitMeetingAndTeam:true});
 assert.match(text,/AEW — BGP relationship/);
 assert.match(text,/Dough T2 #3629 — with solicitors/);
 assert.match(text,/Reported in chat.*Woody Bruce/);
 assert.match(text,/Reconcile these staff reports/);
 assert.doesNotMatch(text,/Next meeting|next meeting Wed|Manish|Ben Sykes|BGP team|Will Penfold/);
});

test('same-property legacy deals are retained as related context with explicit provenance and conflicting property links',async()=>{
 const queries=[];
 const deals=[{id:'dandan',deal_ref:3327,name:'DanDan',property_name:'New Oxford Street',status:'NEG',landlord_id:'aew',bgp_acting_for:'tenant',at_deal_linked_property:true},
  {id:'dough2',deal_ref:3629,name:'Dough T2',property_name:'New Oxford Street',status:'SOL',at_deal_linked_property:true},
  {id:'dough1',deal_ref:3295,name:'Dough T1',property_name:'New Oxford Street',status:'INV',at_deal_linked_property:true}];
 const q={query:async(sql,params)=>{queries.push({sql,params});
  if(sql.includes('AS is_landlord'))return{rows:[{id:'aew',name:'AEW',is_landlord:true}]};
  if(sql.includes('LEFT(d.comments'))return{rows:deals};
  if(sql.includes('AS other_property_companies'))return{rows:[{name:'New Oxford Street',direct_company_link:false,via_company_deal:true,other_property_companies:['Dulwich Estate']}]};
  return{rows:[]};}};
 const evidence=await getLandlordRelationshipEvidence('aew',{pool:q,relationshipTeam:async()=>null,meetingDigest:async()=>({meetings:[],nextMeeting:null,coverage:{status:'current'}}),interviews:async()=>[]});
 const query=queries.find(row=>row.sql.includes('LEFT(d.comments')).sql;
 assert.match(query,/linked_deal\.property_id=p\.id/);
 assert.match(query,/linked_deal\.landlord_id=\$1/);
 assert.match(query,/linked_company\.deal_id=linked_deal\.id AND linked_company\.company_id=\$1/);
 assert.doesNotMatch(query,/ILIKE|lower\(p\.name\)/);
 assert.equal(evidence.deals[1].linkBasis,'same_property_as_company_deal');
 assert.equal(evidence.deals[1].relationship.instruction,false);
 assert.equal(evidence.deals[2].relationship.instruction,false);
 const text=renderLandlordRelationshipBrief({...evidence,conversationUpdates:[{speaker:'Woody',report:'AEW was disinstructed but Dough T2 continues as legacy.',date:'2026-10-27'}]}, {omitMeetingAndTeam:true});
 assert.match(text,/via AEW's deal link; property record links Dulwich Estate/);
 assert.match(text,/Dough T2 #3629 — with solicitors/);assert.match(text,/Dough T1 #3295 — invoiced/);
 assert.match(text,/DanDan #3327 — negotiating.*tenant representation/);
 assert.doesNotMatch(text,/before the meeting|AEW instruction|AEW ownership/);
 assert.match(landlordChatEvidencePrompt(evidence,'Woody'),/do not establish that this landlord owned that property or instructed BGP/);
});

test('empty or partial calendar coverage is not a claim that no meeting exists',()=>{
 const text=renderLandlordRelationshipBrief({...fixture(),nextMeeting:null,coverage:{status:'partial'},bgpTeam:[],deals:[]});
 assert.match(text,/No upcoming linked meeting is available; the diary check is incomplete/);
 assert.doesNotMatch(text,/no meetings scheduled|no meeting exists|not meeting/i);
});

test('interview reports stay attributed and their text cannot inject formatting',()=>{
 const text=renderLandlordRelationshipBrief({...fixture(),interviewMentions:[{interviewee:'Lizzie', meetingDate:'2026-10-20',excerpt:'AEW: **new mandate** [click](bad)'}]});
 assert.match(text,/Lizzie, 20 Oct 2026/);
 assert.match(text,/\\\*\\\*new mandate\\\*\\\*/);
});

test('landlord history retains each actual author and does not infer identity from mentions',()=>{
 const history=landlordChatHistory([{role:'user',user_id:'woody',sender_name:'Woody Bruce',created_at:'2026-10-27T09:37:00Z',content:'Nick says Dough T2 continues'}, {role:'assistant',content:'Noted, Nick'}]);
 assert.match(history[0].content,/Sender: Woody Bruce/);
 assert.match(history[0].content,/Nick says Dough T2 continues/);
 assert.equal(history[1].content,'Noted, Nick');
 assert.match(landlordChatEvidencePrompt(fixture(),'Woody Bruce'),/authenticated sender of this turn is Woody Bruce/);
 assert.match(landlordChatEvidencePrompt(fixture(),'Woody Bruce'),/Saving a chat message is NOT saving a CRM deal/);
});

test('unsupported or failed CRM save claims are replaced, but a real successful write is retained',()=>{
 const claim='Noted, Woody — recorded on Dough T2 that it continues as a legacy deal.';
 assert.match(guardLandlordSaveClaim(claim,[]),/haven’t saved a change/);
 assert.match(guardLandlordSaveClaim("I've updated the deal",[{success:false,error:'Denied'}]),/haven’t saved a change/);
 assert.equal(guardLandlordSaveClaim(claim,[{success:true,action:'updated',id:'3629'}]),claim);
 const honest='Dough T2 is with solicitors. I haven’t changed the record.';
 assert.equal(guardLandlordSaveClaim(honest,[]),honest);
});

test('tenant companies never load landlord diary or interview data',async()=>{
 let reads=0;
 const evidence=await getLandlordRelationshipEvidence('brand',{pool:{query:async()=>({rows:[{id:'brand',name:'Brand',is_landlord:false}]})},relationshipTeam:async()=>null,meetingDigest:async()=>{reads++;throw Error('Must not read');},interviews:async()=>{reads++;return[];}});
 assert.equal(evidence,null);assert.equal(reads,0);
});

test('human disinstruction and legacy-deal reports stay attributed, while greetings, questions and assistant claims do not become facts',()=>{
 const rows=[{id:'a',role:'assistant',speaker:'ChatBGP',content:'Recorded the legacy deal.'},{id:'g',role:'user',speaker:'Woody Bruce',content:'Hello Nick'},
 {id:'q',role:'user',speaker:'Woody Bruce',content:'why havent you picked up the meeting with Ben Sykes'},
 {id:'d',role:'user',speaker:'Woody Bruce',content:'we were disinstructed by AEW on New Oxford Street',created_at:'2026-10-27T09:23:00Z',thread_id:'aew-chat'},
 {id:'l',role:'user',speaker:'Nick',content:'yes that continues as a legacy deal',created_at:'2026-10-27T09:37:00Z',thread_id:'aew-chat'}];
 const reports=landlordConversationUpdates(rows);
 assert.deepEqual(reports.map(r=>r.messageId),['d','l']);
 assert.equal(reports[0].sourceUrl,'/chatbgp?thread=aew-chat');
 assert.match(reports[1].status,/not confirmation of a CRM record update/);
 const text=renderLandlordRelationshipBrief({...fixture(),conversationUpdates:reports});
 assert.match(text,/Reported in chat.*Woody Bruce, 27 Oct 2026.*disinstructed/);
 assert.match(text,/Dough T2 #3629 — with solicitors/);
 assert.match(text,/Reconcile these staff reports with the saved instruction and deal records/);
});

test('conversation evidence is restricted to the requesting viewer’s linked threads',async()=>{
 const queries=[];
 const q={query:async(sql,params)=>{queries.push({sql,params});if(sql.includes('AS is_landlord'))return{rows:[{id:'aew',name:'AEW',is_landlord:true}]};return{rows:[]};}};
 await getLandlordRelationshipEvidence('aew',{pool:q,viewerId:'woody',relationshipTeam:async()=>null,meetingDigest:async()=>({meetings:[],nextMeeting:null,coverage:{status:'current'}}),interviews:async()=>[]});
 const read=queries.find(q=>q.sql.includes('FROM chat_messages'));
 assert.deepEqual(read.params,['aew','woody',null]);assert.match(read.sql,/t.created_by=\$2 OR EXISTS/);assert.match(read.sql,/tm.user_id=\$2/);assert.match(read.sql,/m.role='user'/);
});

test('group evidence cannot import reports from other company threads the sender can access',async()=>{
 const queries=[];
 const q={query:async(sql,params)=>{queries.push({sql,params});if(sql.includes('AS is_landlord'))return{rows:[{id:'aew',name:'AEW',is_landlord:true}]};return{rows:[]};}};
 await getLandlordRelationshipEvidence('aew',{pool:q,viewerId:'woody',conversationThreadId:'current-group',relationshipTeam:async()=>null,meetingDigest:async()=>({meetings:[],nextMeeting:null,coverage:{status:'current'}}),interviews:async()=>[]});
 const read=queries.find(q=>q.sql.includes('FROM chat_messages'));
 assert.deepEqual(read.params,['aew','woody','current-group']);
 assert.match(read.sql,/\(\$3::text IS NULL OR t.id=\$3\)/);
});

test('relationship take shares the full team model while group context excludes private other-thread activity',async()=>{
 const q={query:async(sql)=>({rows:sql.includes('AS is_landlord')?[{id:'aew',name:'AEW',is_landlord:true}]:[]})};
 const member={id:'nick',name:'Nick',assigned:true,assignedRole:'Relationship lead',contexts:[{role:'Tenant representative',sources:[{kind:'deal',id:'dandan'}]}],emailCount:4,meetingCount:1};
 for(const conversationThreadId of [undefined,'current-group']) {
  let options;
  const evidence=await getLandlordRelationshipEvidence('aew',{pool:q,viewerId:'woody',conversationThreadId,
   relationshipTeam:async(id,input)=>{assert.equal(id,'aew');options=input;return{members:[member]};},
   meetingDigest:async()=>({meetings:[],nextMeeting:null,coverage:{status:'current'}}),interviews:async()=>[]});
  assert.equal(options.viewerId,conversationThreadId?undefined:'woody');
  assert.equal(evidence.bgpTeam[0].role,'Relationship lead');
  assert.equal(evidence.bgpTeam[0].source,'assigned');
  assert.deepEqual(evidence.relationshipTeam.members,[member]);
 }
});

test('landlord group evidence refuses external, unknown or missing members before loading staff diary context',async()=>{
 const queries=[];
 const q={query:async(sql,params)=>{queries.push({sql,params});return{rows:[{internal_only:false}]};}};
 assert.equal(await isInternalLandlordThread('shared-thread',q),false);
 assert.match(queries[0].sql,/created_by AS user_id/);
 assert.match(queries[0].sql,/chat_thread_members/);
 assert.match(queries[0].sql,/u.id IS NULL/);
 assert.match(queries[0].sql,/u.is_active=false/);
 assert.match(queries[0].sql,/NOT LIKE '%@brucegillinghampollard.com'/);
 assert.equal(await isInternalLandlordThread('staff-thread',{query:async()=>({rows:[{internal_only:true}]})}),true);
 assert.equal(await isInternalLandlordThread('missing-thread',{query:async()=>({rows:[]})}),false);
});

test('both landlord evidence entry points use the shared staff predicate, token identity, and group membership boundary',async()=>{
 const require=createRequire(import.meta.url);
 const {find,evaluate,ts}=require('./source-harness.cjs');
 for(const file of ['server/brand-ai-take.ts','server/routes.ts']) {
  const block=find(file,node=>ts.isIfStatement(node)&&node.expression.getText().includes('canReadLandlordMeetings(req)'));
  const isGroup=file==='server/routes.ts';
  for(const allowed of [false,true]) for(const internal of [false,true]) {
   const evidenceReads=[];let gateCalls=0;let result;
   const loader=async(id,options)=>{evidenceReads.push({id,options});return fixture();};
   const bindings={req:{tokenUserId:'token-staff'},scope:null,tab:'brand',companyId:'aew',groupIsClient:false,groupViewScope:null,
    threadId:'current-group',triggerMessageId:'message',senderName:'Woody Bruce',
    canReadLandlordMeetings:async(req)=>{gateCalls++;assert.equal(req.tokenUserId,'token-staff');return allowed;},
    storage:{getChatThread:async()=>({linkedType:'company',linkedId:'aew'})},
    pool:{query:async()=>({rows:[]})},res:{json:value=>{result=value;return value;}},
    require:name=>{assert.equal(name,'./landlord-relationship-brief');return{getLandlordRelationshipEvidence:loader,renderLandlordRelationshipBrief,
      landlordChatEvidencePrompt,landlordChatHistory,isInternalLandlordThread:async()=>internal};},
   };
   const {run}=evaluate(`export async function run() { let landlordEvidence=null;let landlordContext='';let recentMessages=[];let isLandlordConversation=false;${block};return {isLandlordConversation}; }`,bindings);
   const outcome=await run();
   if(isGroup)assert.equal(outcome.isLandlordConversation,allowed&&internal);
   assert.equal(gateCalls,1);
   assert.equal(evidenceReads.length,allowed&&(!isGroup||internal)?1:0);
   if(evidenceReads.length){assert.equal(evidenceReads[0].options.viewerId,'token-staff');
    if(isGroup)assert.equal(evidenceReads[0].options.conversationThreadId,'current-group');
    else {assert.match(result.relationshipSummary,/BGP relationship/);assert.doesNotMatch(result.relationshipSummary,/BGP team/);}
   }
  }
 }
});

test('landlord evidence reads records and exposes failed sources instead of inventing activity',async()=>{
 const queries=[];
 const q={query:async(sql)=>{queries.push(sql); if(sql.includes('AS is_landlord'))return{rows:[{id:'aew',name:'AEW',is_landlord:true}]}; if(sql.includes('LEFT(d.comments'))throw Error('unavailable');return{rows:[]};}};
 const evidence=await getLandlordRelationshipEvidence('aew',{pool:q,relationshipTeam:async()=>null,meetingDigest:async()=>({meetings:[],nextMeeting:null,coverage:{status:'not_synced'}}),interviews:async()=>[]});
 assert.deepEqual(evidence.issues,['Deal records unavailable']);
 assert.deepEqual(evidence.deals,[]);
 assert.ok(queries.every(sql=>!/^\s*(UPDATE|INSERT|DELETE)/.test(sql)));
});
