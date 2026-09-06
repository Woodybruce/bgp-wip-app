// r574 step5: the ACTIVE DEALS tile says 4 — Mark opens the board beneath it
// to see which four. Capture what is actually listed.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const TAG=process.env.QA_TAG||'before';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext({viewport:{width:1440,height:900},locale:'en-GB'});
 await ctx.route('**/*',(r)=>{const u=r.request().url();if(u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:'))return r.continue();return r.abort();});
 const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
 const user=await lr.json();
 const pr=await ctx.request.get(`${BASE}/api/company-portfolio/d25ec158-82df-4f50-8188-cae113af5f9f`,{headers:{Authorization:`Bearer ${user.token}`}});
 const pj=await pr.json();
 console.log('PAYLOAD stats.activeDeals =',pj.stats.activeDeals,' deals[] length =',(pj.deals||[]).length);
 console.log('  deals listed:',(pj.deals||[]).map(d=>`${d.name} [${d.status}]`).join(' | '));
 const page=await ctx.newPage();
 await page.goto(BASE).catch(()=>{});
 await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
 await page.goto(`${BASE}/dashboard`,{waitUntil:'domcontentloaded'}).catch(()=>{});
 await page.waitForLoadState('networkidle').catch(()=>{});
 await page.waitForTimeout(3500);
 const board=await page.evaluate(()=>{
   const h=[...document.querySelectorAll('*')].find(e=>/Properties\s*&\s*Deals/i.test(e.textContent||'')&&e.children.length<6);
   const card=h?h.closest('div.rounded-lg,div[class*=card],section')||h.parentElement:null;
   return card?card.innerText.replace(/\s+/g,' ').slice(0,1200):'(board not found)';
 });
 console.log('DEALS BOARD TEXT:',board);
 const el=await page.$('[data-testid="kpi-active-deals"], [data-testid="kpi-deals"]');
 console.log('kpi testid found:',!!el);
 await page.screenshot({path:`qa/smoke-shots/r574-deals-${TAG}.png`,fullPage:true});
 console.log('shot qa/smoke-shots/r574-deals-'+TAG+'.png');
}finally{await b.close();}
