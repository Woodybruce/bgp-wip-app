import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { find, evaluate, ts, source } = require('./source-harness.cjs');
const privacy=evaluate(source('shared/private-mail.ts'));
const highlights=evaluate(source('server/landlord-email-highlights.ts'));
const file = 'server/brand-email-threads.ts';
const decl = name => find(file, node => (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText() === name))
  || (ts.isFunctionDeclaration(node) && node.name?.text === name));
const src = ['BGP_DOMAIN', 'normSubject', 'cleanPreview', 'personList', 'groupEmailConversations', 'nameFromEmail', 'emailSummaryPrompt','emailEvidenceFingerprint','currentEmailSummary'].map(decl).join('\n')
  .replace(/^export /gm, '') + '\nexports.groupEmailConversations=groupEmailConversations;exports.emailSummaryPrompt=emailSummaryPrompt;exports.emailEvidenceFingerprint=emailEvidenceFingerprint;exports.currentEmailSummary=currentEmailSummary;';
const { groupEmailConversations, emailSummaryPrompt, emailEvidenceFingerprint, currentEmailSummary } = evaluate(src,{...privacy,...highlights,createHash});

const hg = ['rupert@brucegillinghampollard.com', 'david.menendez@honestgreens.com', 'rasmus@honestgreens.com', 'richard@etchgroup.com'];
const rows = [
  { subject: 'RE: Canary Wharf - Hg (access)', bgp_user: 'rupert@brucegillinghampollard.com', preview: 'Thanks Marissa,\r\n\r\nCallum will update our strip out specs.\r\n\r\nFrom: Marisa', participants: hg, interaction_date: '2026-07-16T14:11:18Z' },
  { subject: 'Canary Wharf - Hg (access)', bgp_user: 'rupert@brucegillinghampollard.com', preview: 'Hi Rupert', participants: hg, interaction_date: '2026-07-10T09:00:00Z' },
  { subject: 'FW: Heads of terms', bgp_user: 'charlotte@brucegillinghampollard.com', preview: 'Attached', participants: ['david.menendez@honestgreens.com'], interaction_date: '2026-05-01T09:00:00Z' },
];

test('emails group into conversations with BGP, brand and other parties split out', () => {
  const convs = groupEmailConversations(rows, 'honestgreens.com');
  assert.equal(convs.length, 2);
  const cw = convs[0];
  assert.equal(cw.subject, 'Canary Wharf - Hg (access)');
  assert.equal(cw.messages, 2);
  assert.equal(cw.first, '2026-07-10T09:00:00.000Z');
  assert.equal(cw.last, '2026-07-16T14:11:18.000Z');
  assert.deepEqual([...cw.bgp], ['rupert@brucegillinghampollard.com']);
  assert.deepEqual([...cw.brand].sort(), ['david.menendez@honestgreens.com', 'rasmus@honestgreens.com']);
  assert.deepEqual([...cw.others], ['richard@etchgroup.com']);
  assert.equal(cw.preview, 'Thanks Marissa, Callum will update our strip out specs.');
  assert.equal(convs[1].subject, 'Heads of terms');
  assert.deepEqual([...convs[1].bgp], ['charlotte@brucegillinghampollard.com']);
});

test('summary prompt names people and copied firms from the conversations', () => {
  const prompt = emailSummaryPrompt('Honest Greens', groupEmailConversations(rows, 'honestgreens.com'));
  assert.match(prompt, /"Canary Wharf - Hg \(access\)" · 2 msg/);
  assert.match(prompt, /BGP: Rupert · Honest Greens: (David Menendez, Rasmus|Rasmus, David Menendez)/);
  assert.match(prompt, /other people: Richard \(etchgroup\.com\)/);
  assert.match(prompt, /sender not recorded/);
});


test('Landlord email grouping accepts exact contacts and genuine subdomains without changing Brand grouping', () => {
  const people = ['nick@brucegillinghampollard.com', 'manish@eu.aew.com', 'other@notaew.com', 'known@agency.test'];
  const rows = [{ subject: 'Catch up', participants: people, interaction_date: '2026-10-27T11:00:00Z' }];
  const landlord = groupEmailConversations(rows, 'aew.com', new Set(['known@agency.test']), ['aew.com'])[0];
  assert.deepEqual([...landlord.brand].sort(), ['known@agency.test', 'manish@eu.aew.com']);
  assert.deepEqual([...landlord.others], ['other@notaew.com']);
  const brand = groupEmailConversations(rows, 'aew.com')[0];
  assert.deepEqual([...brand.brand], []);
  assert.equal(brand.others.length, 3);
});

test('private Equity messages are excluded before grouping, counts, previews and participants for every company kind',()=>{
 const privateRows=[
  {bgp_user:'EQUITY@brucegillinghampollard.com'},
  {participants:['Equity <equity@brucegillinghampollard.com>','nick@brucegillinghampollard.com']},
  {participants:[{emailAddress:{address:'equity@brucegillinghampollard.com',name:'Equity'}}]},
  {participants:'["EQUITY@brucegillinghampollard.com"]'},
  {bccRecipients:[{emailAddress:{address:'equity@brucegillinghampollard.com'}}]},
 ].map((record,index)=>({subject:'RE: Public deal',preview:`PRIVATE CONTENT ${index}`,interaction_date:'2026-10-27T11:00:00Z',...record}));
 const safe={subject:'Public deal',preview:'Please send the revised heads of terms.',participants:['nick@brucegillinghampollard.com','manish@eu.aew.com'],interaction_date:'2026-10-26T11:00:00Z'};
 for(const contacts of [undefined,new Set()]) {
  const grouped=groupEmailConversations([...privateRows,safe],'aew.com',contacts);
  assert.equal(grouped.length,1);assert.equal(grouped[0].messages,1);assert.equal(grouped[0].last,'2026-10-26T11:00:00.000Z');
  assert.equal(grouped[0].preview,safe.preview);assert.doesNotMatch(JSON.stringify(grouped),/PRIVATE CONTENT|equity/i);
 }
 assert.equal(groupEmailConversations([{...safe,participants:['someone@notbrucegillinghampollard.com','notequity@brucegillinghampollard.com']}],'aew.com').length,1);
});

test('old or changed-evidence email summary caches cannot survive the privacy policy for Brands or Landlords',()=>{
 const conversations=groupEmailConversations(rows,'honestgreens.com');
 for(const landlord of [false,true]) {
  const summary={text:'Current safe summary',last:conversations[0].last,evidenceKey:emailEvidenceFingerprint(conversations,landlord),privacyPolicy:privacy.PRIVATE_MAIL_POLICY_VERSION};
  assert.equal(currentEmailSummary(summary,conversations,landlord),summary);
  assert.equal(currentEmailSummary({...summary,privacyPolicy:undefined},conversations,landlord),null);
  assert.equal(currentEmailSummary(summary,[{...conversations[0],preview:'Changed after private message exclusion'},...conversations.slice(1)],landlord),null);
 }
});

test('Landlord excerpts remove boilerplate while preserving the substance and its actual message date',()=>{
 const {cleanLandlordEmailPreview}=highlights;
 assert.equal(cleanLandlordEmailPreview('Please send the revised heads of terms.\n\nKind regards,\nNick\nCompany signature'),'Please send the revised heads of terms.');
 assert.equal(cleanLandlordEmailPreview('The rent proposal is awaiting review. This email and any attachment is confidential and intended for the recipient.'),'The rent proposal is awaiting review.');
 assert.equal(cleanLandlordEmailPreview('This email is confidential and intended only for the recipient.'),'');
 assert.equal(cleanLandlordEmailPreview('Microsoft Teams Need help? Join the meeting now Meeting ID: 123'),'');
 assert.equal(cleanLandlordEmailPreview('We need confidential advice on the revised terms.'),'We need confidential advice on the revised terms.');
 const chain=[{subject:'RE: Dough',preview:'This email is confidential and intended only for the recipient.',interaction_date:'2026-10-27T11:00:00Z'},
  {subject:'Dough',preview:'The draft lease remains with the solicitors for review.',interaction_date:'2026-10-26T11:00:00Z'}];
 const landlord=groupEmailConversations(chain,'aew.com',new Set())[0];
 assert.equal(landlord.preview,chain[1].preview);assert.equal(landlord.previewAt,'2026-10-26T11:00:00.000Z');
 assert.equal(landlord.last,'2026-10-27T11:00:00.000Z');
 assert.match(groupEmailConversations(chain,'aew.com')[0].preview,/confidential/);
});

test('Landlord card favours two recent substantive threads over acceptance noise without hiding the full history',()=>{
 const now=new Date('2026-10-27T12:00:00Z');
 const make=(subject,last,preview)=>({subject,last,first:last,preview,messages:1,bgp:[],brand:[],others:[]});
 const conversations=[make('Accepted: AEW / BGP','2026-10-27T11:00:00Z','This email is confidential and intended only for the recipient.'),
  make('Dough','2026-10-27T10:00:00Z','The draft lease is still with the solicitors for review.'),
  make('New Oxford Street','2026-10-26T10:00:00Z','Please send the proposed terms for the vacant unit.'),
  make('Old deal','2026-04-26T10:00:00Z','The longstanding deal discussions are awaiting a further update.')];
 const selected=highlights.selectLandlordEmailHighlights(conversations,2,now);
 assert.deepEqual(Array.from(selected,row=>row.subject),['Dough','New Oxford Street']);
 assert.equal(conversations.length,4);assert.match(conversations[0].subject,/Accepted/);
 const prompt=highlights.landlordEmailSummaryPrompt('AEW',conversations,now);
 assert.match(prompt,/Dough/);assert.match(prompt,/New Oxford Street/);assert.match(prompt,/Old deal/);assert.match(prompt,/earlier history/);
 assert.doesNotMatch(prompt,/Accepted: AEW|confidential and intended/);
 assert.match(prompt,/Sender identity is not recorded/);assert.match(prompt,/Separate a request\/proposal from an agreed outcome/);
 const routine=highlights.selectLandlordEmailHighlights([conversations[0]],2,now);
 assert.equal(routine.length,1);assert.equal(routine[0].preview,'');
});

test('Landlord history keeps dated substantive replies behind a recent acknowledgement and excludes private history',()=>{
 const thread=[
  {subject:'RE: Bluewater lease',preview:'Thanks, noted.',interaction_date:'2026-10-27T11:00:00Z'},
  {subject:'RE: Bluewater lease',preview:'The tenant requested a revised rent-free period and the draft remains under review.',interaction_date:'2026-10-26T11:00:00Z'},
  {subject:'RE: Bluewater lease',preview:'The first proposal was sent for consideration, subject to landlord approval.',interaction_date:'2026-04-26T11:00:00Z'},
  {subject:'RE: Bluewater lease',preview:'PRIVATE: The landlord accepted all terms and completion is confirmed.',interaction_date:'2026-10-26T12:00:00Z',participants:[privacy.PRIVATE_MAILBOX]},
 ];
 const grouped=groupEmailConversations(thread,'landsec.com',new Set());
 assert.equal(grouped[0].messages,3);
 assert.equal(grouped[0].last,'2026-10-27T11:00:00.000Z');
 assert.equal(grouped[0].preview,thread[1].preview);
 assert.equal(grouped[0].previewAt,'2026-10-26T11:00:00.000Z');
 assert.deepEqual(Array.from(grouped[0].excerpts,item=>item.text),[thread[1].preview,thread[2].preview]);
 const prompt=highlights.landlordEmailSummaryPrompt('Landsec',grouped,new Date('2026-10-27T12:00:00Z'));
 assert.match(prompt,/revised rent-free period/);assert.match(prompt,/first proposal/);assert.match(prompt,/2026-04-26/);
 assert.doesNotMatch(prompt,/PRIVATE:|accepted all terms|equity@/);
 const brand=groupEmailConversations(thread,'landsec.com');
 assert.equal(brand[0].preview,'Thanks, noted.');assert.equal(brand[0].excerpts,undefined);
});

test('Landlord summary retains earlier work alongside busy recent threads within fixed evidence bounds',()=>{
 const now=new Date('2026-10-27T12:00:00Z');
 const make=(subject,date)=>({subject,first:date,last:date,preview:`The ${subject} proposal remains subject to review of the revised terms by the instructed solicitors.`,messages:100,bgp:[],brand:[],others:[]});
 const conversations=[...Array.from({length:15},(_,i)=>make(`Recent property ${i}`,new Date(+now-(i+1)*86400000).toISOString())),
  ...Array.from({length:8},(_,i)=>make(`Earlier property ${i}`,new Date(+now-(100+i)*86400000).toISOString()))];
 const context=highlights.selectLandlordEmailSummaryContext(conversations,now);
 assert.equal(context.evidence.length,12);
 assert.equal(context.evidence.filter(row=>row.period==='recent').length,8);
 assert.equal(context.evidence.filter(row=>row.period==='earlier history').length,4);
 assert.equal(context.coverage.substantiveThreads,23);
 assert.equal(context.depth,'detailed');
 assert.match(highlights.landlordEmailSummaryPrompt('Landsec',conversations,now),/120–180 words maximum/);
 assert.match(highlights.landlordEmailSummaryPrompt('Landsec',conversations,now),/does not establish that an old request remains outstanding/);
 const sparse=[{...conversations[0],messages:1500}];
 assert.equal(highlights.selectLandlordEmailSummaryContext(sparse,now).depth,'brief');
 assert.match(highlights.landlordEmailSummaryPrompt('AEW',sparse,now),/40–80 words maximum/);
 assert.match(highlights.landlordEmailSummaryPrompt('AEW',sparse,now),/not infer completion, landlord instructions, meeting attendance or relationship quality/);
});

test('Landlord excerpts are deduplicated, bounded, dated, and preserve longer saved substantive evidence',()=>{
 const records=Array.from({length:9},(_,i)=>({date:`2026-10-${String(27-i).padStart(2,'0')}T10:00:00.000Z`,text:`Proposal ${i}: The revised terms for the named property have been submitted for review by the landlord.`}));
 const selected=highlights.selectLandlordEmailExcerpts([...records,{...records[0],date:'2026-10-18T10:00:00.000Z'}]);
 assert.deepEqual(Array.from(selected,item=>item.date),[records[0].date,records[1].date,records[2].date,records[8].date]);
 assert.equal(highlights.selectLandlordEmailExcerpts(records,0).length,0);
 const body='The original proposal is being reviewed. '+('This is further recorded context about the same draft terms. '.repeat(6))+'The rent remains subject to agreement.';
 const grouped=groupEmailConversations([{subject:'Terms',preview:body,interaction_date:records[0].date}],'aew.com',new Set());
 assert.ok(grouped[0].excerpts[0].text.length>300);assert.ok(grouped[0].excerpts[0].text.length<=500);
 assert.ok(grouped[0].preview.length<=300);
 const changed=JSON.parse(JSON.stringify(grouped));changed[0].excerpts[0].text+=' Later correction';
 const summary={text:'Older summary',last:grouped[0].last,evidenceKey:emailEvidenceFingerprint(grouped,true),privacyPolicy:privacy.PRIVATE_MAIL_POLICY_VERSION};
 assert.equal(currentEmailSummary(summary,changed,true),null);
});

test('routine-only and future excerpts cannot become substantive Landlord relationship commentary',()=>{
 const now=new Date('2026-10-27T12:00:00Z');
 const row={subject:'Accepted: Property catch up',first:now.toISOString(),last:now.toISOString(),preview:'The meeting has been accepted by the named recipient.',messages:1000,bgp:[],brand:[],others:[]};
 const context=highlights.selectLandlordEmailSummaryContext([row],now);
 assert.equal(context.evidence.length,0);assert.equal(context.depth,'brief');
 assert.match(highlights.landlordEmailSummaryPrompt('AEW',[row],now),/substantive content is unavailable/);
 const future={...row,subject:'Future terms',excerpts:[{date:'2027-01-01T10:00:00Z',text:'The full lease terms were agreed and the document completed.'}]};
 assert.equal(highlights.selectLandlordEmailSummaryContext([future],now).evidence.length,0);
});
