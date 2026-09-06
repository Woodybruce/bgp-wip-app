// r574: does the new scenario's assertion actually fire on the pre-fix file?
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext({viewport:{width:1440,height:900},locale:'en-GB'});
 const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
 const user=await lr.json();
 const page=await ctx.newPage();
 await page.goto(BASE).catch(()=>{});
 await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
 const mk=await page.evaluate(async()=>{
   const auth={'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('authToken')};
   const units=await (await fetch('/api/available-units',{headers:auth})).json();
   const propertyId=units[0]?.propertyId;
   const res=await fetch('/api/available-units',{method:'POST',credentials:'include',headers:auth,body:JSON.stringify({propertyId,unitName:'QA-HOTS Fire',marketingStatus:'HOT'})});
   if(!res.ok)return{ok:false,why:res.status};
   const u=await res.json(); return {ok:true,id:u.id};
 });
 console.log('staged:',JSON.stringify(mk));
 await page.goto(`${BASE}/properties`,{waitUntil:'domcontentloaded'}).catch(()=>{});
 await page.waitForLoadState('networkidle').catch(()=>{});
 await page.waitForTimeout(4000);
 const r=await page.evaluate(async()=>{
   const auth={Authorization:'Bearer '+localStorage.getItem('authToken')};
   const units=await (await fetch('/api/available-units',{headers:auth})).json();
   const CLOSED=['COM','WIT','INV'];
   const feedLive=units.filter(u=>!CLOSED.includes(String(u.marketingStatus||'AVA').toUpperCase())).length;
   const hots=units.filter(u=>String(u.marketingStatus||'').toUpperCase()==='HOT').length;
   const chip=[...document.querySelectorAll('a[href="/deals/letting"]')].map(a=>(a.textContent||'').replace(/\s+/g,' ').trim()).find(t=>/live letting/i.test(t));
   const shown=chip?Number((chip.match(/\d[\d,]*/)||['0'])[0].replace(/,/g,'')):null;
   return {feedLive,hots,chip,shown};
 });
 console.log('RESULT',JSON.stringify(r),' => ',r.shown===r.feedLive?'PASS':'FAILS (fires)');
 await page.evaluate(async(id)=>{const auth={Authorization:'Bearer '+localStorage.getItem('authToken')};await fetch(`/api/available-units/${id}`,{method:'DELETE',credentials:'include',headers:auth});},mk.id);
 console.log('cleaned up');
}finally{await b.close();}
