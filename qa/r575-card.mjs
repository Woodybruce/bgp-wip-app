// r575: staff view of the Bluewater property page — the DealsSummary card.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const TAG=process.argv[2]||'x';
const PID='cccccccc-0000-0000-0000-000000000001';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext({viewport:{width:1440,height:1000},locale:'en-GB'});
 const r=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
 const user=await r.json();
 const page=await ctx.newPage();
 await page.goto(BASE).catch(()=>{});
 await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
 await page.goto(`${BASE}/properties/${PID}`,{waitUntil:'domcontentloaded'}).catch(()=>{});
 await page.waitForLoadState('networkidle').catch(()=>{});
 await page.waitForTimeout(4000);
 const card=page.locator('[data-testid="deals-summary-card"]').first();
 if(await card.count()){
   await card.scrollIntoViewIfNeeded().catch(()=>{});
   await page.waitForTimeout(600);
   console.log('CARD TEXT:',(await card.innerText()).replace(/\s+/g,' '));
   await card.screenshot({path:`qa/smoke-shots/r575-card-${TAG}.png`}).catch(async()=>{await page.screenshot({path:`qa/smoke-shots/r575-card-${TAG}.png`});});
 } else {
   console.log('CARD NOT FOUND');
   await page.screenshot({path:`qa/smoke-shots/r575-card-${TAG}.png`,fullPage:true});
 }
}finally{await b.close();}
