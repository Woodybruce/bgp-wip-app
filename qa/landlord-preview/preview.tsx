import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClientProvider} from '@tanstack/react-query';
import {queryClient} from '../../client/src/lib/queryClient';
import {TooltipProvider} from '../../client/src/components/ui/tooltip';
import {BgpTakeStrip} from '../../client/src/components/bgp-take-strip';
import {LandlordMeetingsSummary} from '../../client/src/components/landlord-meetings-summary';
import {LandlordWeeklyMeetings} from '../../client/src/components/landlord-weekly-meetings';
import {LandlordInterviewNotes} from '../../client/src/components/landlord-interview-notes';
import {CompanyMiniChat} from '../../client/src/components/brand-profile-panel';
import '../../client/src/index.css';

// Synthetic data only. API requests are intercepted locally; mutations never reach a server.
const now=new Date();
const tomorrow=new Date(now);tomorrow.setDate(tomorrow.getDate()+1);tomorrow.setHours(11,0,0,0);
const meeting={id:'fixture-meeting',companyId:'example',companyName:'Example Estates',subject:'Portfolio and leasing review',start:tomorrow.toISOString(),end:new Date(+tomorrow+3600000).toISOString(),location:'BGP office',participants:[{name:'Alex Taylor',email:'alex@example.test'},{name:'Sam Morgan',email:'sam@brucegillinghampollard.com'},{name:'Jo Reed',email:'jo@brucegillinghampollard.com'}],bgpParticipants:[{name:'Sam Morgan',email:'sam@brucegillinghampollard.com'},{name:'Jo Reed',email:'jo@brucegillinghampollard.com'}],source:'calendar',sourceId:'fixture',mailbox:'sam@brucegillinghampollard.com',webLink:'https://outlook.office.com/calendar/',matchReasons:['Invitation domain: example.test'],checkedAt:now.toISOString()};
const weekStart=new Date(now);weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));weekStart.setHours(0,0,0,0);
const digest={meetings:[meeting],nextMeeting:meeting,week:{start:weekStart.toISOString(),end:new Date(+weekStart+7*86400000).toISOString(),timeZone:'Europe/London'},coverage:{status:'partial',checkedAt:now.toISOString(),mailboxesChecked:2,mailboxesExpected:3,issues:['One connected diary could not be checked.'],refreshing:false}};
const notes=[{interviewId:'fixture',team:'London Estate',interviewee:'Alex Taylor',meetingDate:now.toISOString(),updatedAt:now.toISOString(),questionId:'q1',excerpt:'Example Estates wants one shared account view and a clear plan before each meeting.',companyId:'example',companyName:'Example Estates',sourceUrl:'/contacts?tab=meetings&interview=fixture'}];
const brief='**Example Estates — BGP relationship.**\n- **Recorded work:** High Street letting #123 — with solicitors.\n- **Reported in chat:** Sam Morgan: “The wider instruction has ended, but the existing deal continues.”\n- **Next step:** Reconcile the staff report with the saved instruction and deal records before the meeting.';
const messages=[{id:'m1',role:'user',userId:'sam',userName:'Sam Morgan',createdAt:now.toISOString(),content:'The wider instruction has ended, but the existing deal continues.'},{id:'m2',role:'assistant',createdAt:now.toISOString(),content:'The deal is still **with solicitors** in the CRM. Your update is in this conversation; I haven’t changed the deal record.'},{id:'m3',role:'user',userId:'viewer',createdAt:now.toISOString(),content:'Who is attending tomorrow?'},{id:'m4',role:'assistant',createdAt:now.toISOString(),content:'Alex, Sam and Jo are on the invitation for **11:00 tomorrow** at the BGP office. One diary hasn’t been checked, so this may not be the full meeting list.'}];
window.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
 if(init?.method && init.method!=='GET')return new Response(JSON.stringify({error:'Read-only synthetic preview'}),{status:403});
 let data:any=[];
 if(url.pathname==='/api/auth/me')data={id:'viewer',name:'Preview User',role:'Admin',email:'preview@brucegillinghampollard.com'};
 else if(url.pathname==='/api/users')data=[{id:'viewer',name:'Preview User'},{id:'sam',name:'Sam Morgan'}];
 else if(url.pathname==='/api/chat/threads')data=[{id:'fixture-chat',linkedId:'example',hasAiMember:true,isAiChat:false}];
 else if(url.pathname==='/api/chat/threads/fixture-chat')data={messages,members:[{userId:'viewer'},{userId:'sam'}]};
 else if(url.pathname.includes('/ai-take/'))data={text:brief,relationshipSummary:brief,relationshipEvidence:{company:{id:'example'}},generatedAt:Date.now()};
 else if(url.pathname.includes('interview-links'))data=notes;
 else if(url.pathname.includes('/meetings'))data=digest;
 else if(url.pathname.includes('tracker-comments'))data={comments:[]};
 return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
function Content(){return <main className="max-w-6xl mx-auto p-4 md:p-7 space-y-5"><header><p className="text-xs text-muted-foreground">SYNTHETIC LOCAL PREVIEW · no live records</p><h1 className="text-2xl font-semibold mt-2">Example Estates</h1></header><BgpTakeStrip companyId="example" tab="activity" landlord leading={<LandlordMeetingsSummary companyId="example" canRefresh={false}/>} footer={<div className="text-sm"><strong>BGP team</strong><p className="mt-1">Sam Morgan · Account lead &nbsp; Jo Reed · Leasing</p></div>}/><div className="grid md:grid-cols-2 gap-5"><section className="rounded-xl border bg-card p-4 space-y-4"><h2 className="text-lg font-semibold">Landlord profile</h2><p className="text-sm">Official company facts remain separate from the BGP relationship.</p><LandlordInterviewNotes companyId="example"/></section><CompanyMiniChat companyId="example" companyName="Example Estates" landlord title="Landlord conversation"/></div><LandlordWeeklyMeetings/></main>}
function Preview(){const[phone,setPhone]=useState(false);if(new URLSearchParams(location.search).has('frame'))return <Content/>;return <><div className="p-3 flex gap-3 border-b"><button className="rounded border px-3 py-1" onClick={()=>setPhone(false)}>Desktop</button><button className="rounded border px-3 py-1" onClick={()=>setPhone(true)}>Phone (390 px)</button><span className="text-sm text-muted-foreground">Landlord-only components · synthetic fixture</span></div><iframe title="Landlord CRM preview" src="/?frame=1" style={{display:'block',width:phone?390:'100%',maxWidth:'100%',height:'calc(100vh - 65px)',margin:'0 auto',border:phone?'1px solid #ccc':0}}/></>}
await queryClient.fetchQuery({queryKey:['/api/auth/me']});
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><TooltipProvider><Preview/></TooltipProvider></QueryClientProvider>);
