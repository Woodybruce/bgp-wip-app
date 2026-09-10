// r574 step3: on the property BGP manages for him, what can Mark actually
// take away in writing? Enumerate every control that promises a document.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const PID='cccccccc-0000-0000-0000-000000000001';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext({viewport:{width:1440,height:900},locale:'en-GB'});
 await ctx.route('**/*',(r)=>{const u=r.request().url();if(u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:'))return r.continue();return r.abort();});
 const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
 const user=await lr.json();
 const page=await ctx.newPage();
 let bucket=[];
 page.on('response',(res)=>{if(res.status()>=400)bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`);});
 await page.goto(BASE).catch(()=>{});
 await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
 for (const path of [`/property/${PID}`,`/tenancy-schedule/${PID}`,`/leasing-schedule`]) {
   await page.goto(BASE+path,{waitUntil:'domcontentloaded'}).catch(()=>{});
   await page.waitForLoadState('networkidle').catch(()=>{});
   await page.waitForTimeout(3000);
   const ctrls=await page.evaluate(()=>[...document.querySelectorAll('button,a[download],a[href]')]
     .map(e=>((e.innerText||'').replace(/\s+/g,' ').trim()+' ::'+(e.getAttribute('data-testid')||'')))
     .filter(t=>/export|download|pdf|excel|csv|brief|report|pack|generate|print|share/i.test(t)));
   console.log('==',path,'->',page.url());
   console.log('   DOC CONTROLS:',JSON.stringify([...new Set(ctrls)]));
   const tabs=await page.evaluate(()=>[...document.querySelectorAll('[role=tab],[data-testid^=tab-]')].map(e=>(e.innerText||'').replace(/\s+/g,' ').trim()));
   console.log('   TABS:',JSON.stringify([...new Set(tabs)]));
 }
 console.log('ERRS:',[...new Set(bucket)].join(' || '));
}finally{await b.close();}
