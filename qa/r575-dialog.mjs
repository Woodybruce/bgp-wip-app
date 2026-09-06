// r575: the deal create/edit dialog's Status dropdown (CRM_OPTIONS.dealStatus).
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const TAG=process.argv[2]||'x';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext({viewport:{width:1600,height:950},locale:'en-GB'});
 const r=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
 const user=await r.json();
 const page=await ctx.newPage();
 await page.goto(BASE).catch(()=>{});
 await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
 await page.goto(`${BASE}/deals/list`,{waitUntil:'domcontentloaded'}).catch(()=>{});
 await page.waitForLoadState('networkidle').catch(()=>{});
 await page.waitForTimeout(5000);
 await page.locator('[data-testid="button-create-deal"]').first().click().catch(()=>{});
 await page.waitForTimeout(1500);
 const trig=page.locator('[data-testid="select-deal-status"]').first();
 if(!await trig.count()){console.log('STATUS SELECT NOT FOUND');await page.screenshot({path:`qa/smoke-shots/r575-dialog-${TAG}.png`,fullPage:true});}
 else{
  await trig.scrollIntoViewIfNeeded().catch(()=>{});
  await trig.click().catch(()=>{});
  await page.waitForTimeout(1200);
  const opts=await page.evaluate(()=>[...document.querySelectorAll('[role="option"]')].map(e=>e.textContent.replace(/\s+/g,' ').trim()+(e.getAttribute('data-disabled')!==null||e.getAttribute('aria-disabled')==='true'?' [disabled]':'')));
  console.log('DIALOG STATUS OPTIONS:',JSON.stringify(opts));
  console.log('  has HOTs:',opts.some(o=>/HOT/i.test(o)),' has Opportunity:',opts.some(o=>/Opportunity/i.test(o)));
  await page.screenshot({path:`qa/smoke-shots/r575-dialog-${TAG}.png`});
 }
}finally{await b.close();}
