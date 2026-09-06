// r574 step6: the tile says 4 active deals. Where can Mark see them?
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const CID='d25ec158-82df-4f50-8188-cae113af5f9f';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext({viewport:{width:1440,height:900},locale:'en-GB'});
 const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
 const user=await lr.json(); const H={Authorization:`Bearer ${user.token}`};
 const get=async(p)=>{const r=await ctx.request.get(BASE+p,{headers:H});let j=null;try{j=await r.json()}catch{};return[r.status(),j];};
 const [s1,deals]=await get('/api/crm/deals');
 const arr=Array.isArray(deals)?deals:(deals?.deals||[]);
 console.log('/api/crm/deals',s1,'rows',arr.length);
 console.log('   ',arr.map(d=>`${d.name}[${d.status}]`).join(' | ').slice(0,600));
 const [s2,ps]=await get(`/api/properties-summary?companyId=${CID}&role=landlord`);
 console.log('/api/properties-summary',s2,JSON.stringify(ps).slice(0,600));
 const [s3,pf]=await get(`/api/company-portfolio/${CID}`);
 console.log('portfolio stats',s3,JSON.stringify(pf?.stats));
}finally{await b.close();}
