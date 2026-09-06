// r574 step2: Mark follows the two headline tiles that promise a list, then
// looks for what BGP has written for him on the property page.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext({viewport:{width:1440,height:900},locale:'en-GB'});
 await ctx.route('**/*',(r)=>{const u=r.request().url();if(u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:'))return r.continue();return r.abort();});
 const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
 const user=await lr.json();
 const H={Authorization:`Bearer ${user.token}`};
 // what does the API say the client's portfolio is?
 for (const p of ['/api/crm/properties','/api/client/crm/global-brands?limit=1']) {
   const rr=await ctx.request.get(BASE+p,{headers:H});
   const j=await rr.json().catch(()=>null);
   const arr=Array.isArray(j)?j:(j?.properties||j?.data||[]);
   console.log(p,'->',rr.status(),Array.isArray(arr)?arr.length+' rows':typeof j);
   if(p.includes('properties')&&Array.isArray(arr))console.log('  props:',arr.map(x=>`${x.id} ${x.name}`).join(' | '));
 }
 const page=await ctx.newPage();
 let bucket=[];
 page.on('response',(res)=>{if(res.status()>=400)bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`);});
 await page.goto(BASE).catch(()=>{});
 await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
 await page.goto(`${BASE}/dashboard`,{waitUntil:'domcontentloaded'}).catch(()=>{});
 await page.waitForLoadState('networkidle').catch(()=>{});
 await page.waitForTimeout(3000);
 // Click the EXPIRING (6M) tile
 const clicked=await page.evaluate(()=>{
   const el=[...document.querySelectorAll('*')].find(e=>/EXPIRING \(6M\)/i.test(e.textContent||'')&&e.children.length<8&&e.textContent.length<200);
   if(!el)return null; const t=el.closest('[data-testid],button,a,div'); t.click(); return t.outerHTML.slice(0,200);
 });
 console.log('CLICK expiring ->',clicked?'ok':'not found');
 await page.waitForTimeout(2500);
 console.log('URL after:',page.url());
 await page.screenshot({path:'qa/smoke-shots/r574-02-expiring.png',fullPage:true});
 const t2=await page.evaluate(()=>(document.body.innerText||'').replace(/\s+/g,' '));
 console.log('AFTER:',t2.slice(0,1500));
 console.log('ERRS:',[...new Set(bucket)].join(' || '));
}finally{await b.close();}
