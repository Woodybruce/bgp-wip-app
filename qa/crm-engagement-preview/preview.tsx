import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClientProvider} from '@tanstack/react-query';
import {queryClient} from '../../client/src/lib/queryClient';
import {TooltipProvider} from '../../client/src/components/ui/tooltip';
import {Toaster} from '../../client/src/components/ui/toaster';
import {CrmEngagementPanel} from '../../client/src/components/crm-engagement/overview';
import {AccountTeamViewsCard} from '../../client/src/components/account-team-views';
import {leasingTeams,leasingWorkspace} from './leasing-fixture';
import {LandlordEngagementPanel} from '../../client/src/components/landlord-engagement-panel';
import type {EngagementData, EngagementOptions} from '../../shared/crm-engagement';
import '../../client/src/index.css';

// Synthetic records only. Every API call is handled in this frame; no live server.
const now=new Date(), stamp=now.toISOString();
const day=(offset:number,hour=10)=>new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset,hour).toISOString();
const options:EngagementOptions={staff:[{id:'staff-one',name:'Alex Taylor'},{id:'staff-two',name:'Jordan Lee'}],companies:[{id:'estate-one',name:'Example Estates'},{id:'estate-two',name:'Riverside Property'}],contacts:[{id:'contact-one',name:'Casey Green',companyId:'estate-one',role:'Leasing Director'},{id:'contact-two',name:'Morgan West',companyId:'estate-one',role:'Asset Manager'},{id:'contact-three',name:'Robin Hall',companyId:'estate-two',role:'Investment Director'}]};
let data:EngagementData={
 strategies:[{id:'strategy-one',name:'Food and beverage leasing',objective:'Introduce suitable operators for the current vacancies and agree follow-up site visits.',team:'Leasing',ownerId:'staff-one',ownerName:'Alex Taylor',status:'active',startsOn:stamp.slice(0,10),endsOn:null,updatedAt:stamp,targets:[{companyId:'estate-one',companyName:'Example Estates',reason:'Three active leasing briefs need an operator shortlist.',contactIds:['contact-one']},{companyId:'estate-two',companyName:'Riverside Property',reason:'Discuss the leisure requirements recorded at the last meeting.',contactIds:['contact-three']}]}],
 events:[{id:'event-one',title:'Operator breakfast',kind:'bgp',startsAt:day(3),endsAt:day(3,12),location:'London office',description:'Review the current briefs with the leasing team.',ownerId:'staff-one',ownerName:'Alex Taylor',status:'planned',sourceUrl:null,dateConfirmed:true,outcome:null,updatedAt:stamp,strategyIds:['strategy-one'],companies:[{companyId:'estate-one',companyName:'Example Estates',reason:'Introduce operators for the three vacant units.'},{companyId:'estate-two',companyName:'Riverside Property',reason:'Discuss the separate leisure brief.'}],guests:[{contactId:'contact-one',name:'Casey Green',companyId:'estate-one',companyName:'Example Estates',status:'accepted'},{contactId:'contact-two',name:'Morgan West',companyId:'estate-one',companyName:'Example Estates',status:'suggested'}]},
 {id:'event-two',title:'Retail conference — date to check',kind:'industry',startsAt:day(8),endsAt:null,location:null,description:'Legacy planning entry; date has not been checked.',ownerId:null,ownerName:null,status:'planned',sourceUrl:null,dateConfirmed:false,outcome:null,updatedAt:stamp,strategyIds:[],companies:[],guests:[]},
 {id:'event-three',title:'Market Square site visit',kind:'bgp',startsAt:day(-5),endsAt:null,location:'Market Square',description:null,ownerId:'staff-two',ownerName:'Jordan Lee',status:'completed',sourceUrl:null,dateConfirmed:true,outcome:'Casey asked for a revised shortlist before the next leasing meeting.',updatedAt:stamp,strategyIds:['strategy-one'],companies:[{companyId:'estate-one',companyName:'Example Estates',reason:'Review the ground-floor units with the leasing lead.'}],guests:[{contactId:'contact-one',name:'Casey Green',companyId:'estate-one',companyName:'Example Estates',status:'attended'}]}],
 actions:[{id:'action-one',title:'Send the revised operator shortlist',notes:'Include the unit sizes agreed at the visit.',dueAt:day(-1),status:'todo',ownerId:'staff-one',ownerName:'Alex Taylor',companyId:'estate-one',companyName:'Example Estates',strategyId:'strategy-one',eventId:'event-three',canEdit:true} as any]
};
const ownerName=(id:string|null)=>options.staff.find(x=>x.id===id)?.name||null;
const companyName=(id:string)=>options.companies.find(x=>x.id===id)?.name||id;
const interviewNotes=[{interviewId:'interview-one',questionId:'rl1',questionLabel:'Repeat-work relationships',questionText:'Who are your top relationships that generate the most repeat work?',team:'Leasing',interviewee:'Jordan Lee',meetingDate:null,updatedAt:stamp,companyId:'estate-one',companyName:'Example Estates',excerpt:'Example Estates asked us to arrange an operator breakfast around the current vacancies.',sourceUrl:'/contacts?tab=meetings&interview=interview-one'},
 {interviewId:'interview-two',questionId:'cp3',questionLabel:'Top fee clients',questionText:'Which 3 clients have paid the most fees to your team in the last 2 years?',team:'Investment',interviewee:'Alex Taylor',meetingDate:null,updatedAt:stamp,companyId:'estate-one',companyName:'Example Estates',excerpt:'Example Estates, Riverside Property',sourceUrl:'/contacts?tab=meetings&interview=interview-two'}];
window.fetch=async(input:any,init?:RequestInit)=>{
 const url=new URL(typeof input==='string'?input:input.url,location.origin), method=init?.method||'GET';
 if(!url.pathname.startsWith('/api/'))throw new Error('Only local fixture API is available');
 let out:any={};
 if(url.pathname==='/api/auth/me')out={id:'staff-one',name:'Alex Taylor',role:'Admin',email:'alex@example.test'};
 else if(url.pathname==='/api/crm/landlords/interview-links')out=interviewNotes.filter(note=>!url.searchParams.get('companyId')||note.companyId===url.searchParams.get('companyId'));
 else if(url.pathname==='/api/accounts/estate-one/teams')out=leasingTeams;
 else if(url.pathname==='/api/accounts/estate-one/workspace')out=leasingWorkspace;
 else if(url.pathname.endsWith('/engagement/options'))out=options;
 else if(url.pathname==='/api/crm/engagement'){
  const company=url.searchParams.get('companyId');
  out=company?{strategies:data.strategies.filter(s=>s.targets.some(t=>t.companyId===company)),events:data.events.filter(e=>e.companies.some(c=>c.companyId===company)),actions:data.actions.filter(a=>a.companyId===company)}:data;
 }else if(url.pathname.startsWith('/api/crm/engagement/')){
  const [,kind,id]=url.pathname.match(/engagement\/(strategies|events|actions)(?:\/([^/]+))?/)||[];
  if(!kind)return new Response('{}',{status:404});
  const body=JSON.parse(String(init?.body||'{}')), key=kind as keyof EngagementData;
  const record:any={...(data[key] as any[]).find(r=>r.id===id),...body,id:id||`fixture-${Date.now()}`,updatedAt:new Date().toISOString()};
  if(kind==='strategies'){record.ownerName=ownerName(record.ownerId);record.targets=record.targets.map((t:any)=>({...t,companyName:companyName(t.companyId)}));}
  if(kind==='events'){record.ownerName=ownerName(record.ownerId);record.companies=record.companies.map((t:any)=>({...t,companyName:companyName(t.companyId)}));record.guests=record.guests.map((g:any)=>{const c=options.contacts.find(c=>c.id===g.contactId)!;return {...g,name:c?.name,companyId:c?.companyId,companyName:companyName(c?.companyId)};});}
  if(kind==='actions'){record.ownerName=ownerName(record.ownerId);record.companyName=companyName(record.companyId);record.canEdit=true;
   if(record.sourceInterviewId)record.source={kind:'crm_interview',interviewId:record.sourceInterviewId,questionId:record.sourceQuestionId,label:'Team planning interview',url:`/contacts?tab=meetings&interview=${record.sourceInterviewId}`};}
  if(method==='POST')(data[key] as any[]).push(record);else data[key]=(data[key] as any[]).map(r=>r.id===id?record:r) as any;
  out={ok:true,id:record.id};
 }else if(url.pathname==='/api/tasks')out=data.actions;
 return new Response(JSON.stringify(out),{headers:{'Content-Type':'application/json'}});
};
function Content(){const scoped=new URLSearchParams(location.search).has('landlord'), leasing=new URLSearchParams(location.search).has('leasing');return <main className="max-w-[1500px] mx-auto p-4 md:p-6 space-y-5 @container"><header><p className="text-xs text-muted-foreground">LOCAL REVIEW · SYNTHETIC RECORDS</p><h1 className="text-2xl font-bold mt-2">{scoped||leasing?'Example Estates':'CRM'}</h1></header>{leasing?<AccountTeamViewsCard companyId="estate-one"/>:scoped?<LandlordEngagementPanel companyId="estate-one"/>:<CrmEngagementPanel/>}</main>}
function Preview(){const[phone,setPhone]=useState(false);if(new URLSearchParams(location.search).has('frame'))return <Content/>;return <><div className="p-3 flex flex-wrap gap-3 border-b"><button className="border rounded px-3 py-1" onClick={()=>setPhone(false)}>Desktop</button><button className="border rounded px-3 py-1" onClick={()=>setPhone(true)}>Phone (390 px)</button><span className="text-sm text-muted-foreground">CRM planning preview · changes stay in this frame</span></div><iframe title="CRM planning preview" src={`/?frame=1${new URLSearchParams(location.search).has('landlord')?'&landlord=1':''}${new URLSearchParams(location.search).has('leasing')?'&leasing=1':''}`} style={{display:'block',width:phone?390:'100%',maxWidth:'100%',height:'calc(100vh - 65px)',margin:'0 auto',border:phone?'1px solid #ccc':0}}/></>}
await queryClient.fetchQuery({queryKey:['/api/auth/me']});
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><TooltipProvider><Preview/><Toaster/></TooltipProvider></QueryClientProvider>);
