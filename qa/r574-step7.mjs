import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext();
 const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
 const u=await lr.json(); const H={Authorization:`Bearer ${u.token}`};
 const r1=await ctx.request.get(`${BASE}/api/crm/deals?excludeTrackerDeals=true`,{headers:H});
 const d1=await r1.json();
 console.log('deals(excludeTracker):',(Array.isArray(d1)?d1:[]).map(d=>`${d.name}|${d.status}|prop=${d.propertyId||d.property_id||'-'}`).join('\n  '));
 const r2=await ctx.request.get(`${BASE}/api/available-units`,{headers:H});
 const d2=await r2.json();
 const st={}; for(const x of (Array.isArray(d2)?d2:[])) st[x.marketingStatus||'(null)']=(st[x.marketingStatus||'(null)']||0)+1;
 console.log('available-units statuses:',JSON.stringify(st),'total',(d2||[]).length);
}finally{await b.close();}
