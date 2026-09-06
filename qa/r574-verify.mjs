// r574 verify: client dashboard — does the Properties & Deals board still
// carry the property whose live deal sits at HOTs, and does its deal chip
// agree with the ACTIVE DEALS tile above it?
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const TAG=process.env.QA_TAG||'x';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext({viewport:{width:1440,height:900},locale:'en-GB'});
 await ctx.route('**/*',(r)=>{const u=r.request().url();if(u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:'))return r.continue();return r.abort();});
 const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
 const user=await lr.json();
 const page=await ctx.newPage();
 await page.goto(BASE).catch(()=>{});
 await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
 await page.goto(`${BASE}/dashboard`,{waitUntil:'domcontentloaded'}).catch(()=>{});
 await page.waitForLoadState('networkidle').catch(()=>{});
 await page.waitForTimeout(4000);
 const tile=await page.evaluate(()=>{const e=document.querySelector('[data-testid="kpi-deals"]');return e?e.innerText.replace(/\s+/g,' '):'(no tile)';});
 console.log('TILE:',tile);
 const board=await page.evaluate(()=>{const e=document.querySelector('[data-testid="properties-summary"]');return e?e.innerText.replace(/\s+/g,' ').slice(0,600):'(no board)';});
 console.log('PROPERTIES & DEALS BOARD:',board);
 const rows=await page.evaluate(()=>[...document.querySelectorAll('[data-testid^="properties-summary-row-"]')].map(e=>e.innerText.replace(/\s+/g,' ')));
 console.log('ROWS:',JSON.stringify(rows));
 const el=await page.$('[data-testid="properties-summary"]');
 if(el)await el.screenshot({path:`qa/smoke-shots/r574-board-${TAG}.png`});
 await page.screenshot({path:`qa/smoke-shots/r574-dash-${TAG}.png`,fullPage:true});
 console.log('shots qa/smoke-shots/r574-board-'+TAG+'.png');
}finally{await b.close();}
