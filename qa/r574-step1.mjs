// r574 step1: Mark Warne (Landsec, desktop 1440px). Task: "quarterly asset
// review — what does BGP give me in writing, and does each figure match the
// board it claims to summarise?" Start at the client dashboard.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext({viewport:{width:1440,height:900},locale:'en-GB'});
 await ctx.route('**/*',(r)=>{const u=r.request().url();if(u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:'))return r.continue();return r.abort();});
 const r=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
 const user=await r.json();
 const page=await ctx.newPage();
 let bucket=[];
 page.on('response',(res)=>{if(res.status()>=400)bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`);});
 page.on('pageerror',(e)=>bucket.push(`PAGEERROR ${String(e).slice(0,200)}`));
 await page.goto(BASE).catch(()=>{});
 await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
 await page.goto(`${BASE}/dashboard`,{waitUntil:'domcontentloaded'}).catch(()=>{});
 await page.waitForLoadState('networkidle').catch(()=>{});
 await page.waitForTimeout(3500);
 await page.screenshot({path:'qa/smoke-shots/r574-01-dash.png',fullPage:true});
 const txt=await page.evaluate(()=>(document.body.innerText||'').replace(/\s+/g,' '));
 console.log('DASH:',txt.slice(0,2500));
 const nav=await page.evaluate(()=>[...document.querySelectorAll('nav a, aside a')].map(a=>a.getAttribute('href')+' | '+a.innerText.replace(/\s+/g,' ').trim()));
 console.log('NAV:',JSON.stringify([...new Set(nav)],null,0));
 console.log('ERRS:',[...new Set(bucket)].join(' || '));
}finally{await b.close();}
