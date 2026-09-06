// r575 verification: (1) the /hr ski-target hero's WIP + forecast with one
// deal parked at HOTs; (2) the Deals board inline status picker's options.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const TAG=process.argv[2]||'x';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext({viewport:{width:1440,height:950},locale:'en-GB'});
 const r=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
 const user=await r.json();
 const h={Authorization:`Bearer ${user.token}`};
 const fs=await (await ctx.request.get(`${BASE}/api/dashboard/firm-summary`,{headers:h})).json();
 console.log('FIRM-SUMMARY:',JSON.stringify({billedPence:fs.billedPence,wipPence:fs.wipPence,forecastPence:fs.forecastPence,toGoPence:fs.toGoPence,dealCount:fs.dealCount}));

 const page=await ctx.newPage();
 await page.goto(BASE).catch(()=>{});
 await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
 await page.goto(`${BASE}/hr`,{waitUntil:'domcontentloaded'}).catch(()=>{});
 await page.waitForLoadState('networkidle').catch(()=>{});
 await page.waitForTimeout(4000);
 const hero=page.locator('h2:has-text("Ski target")').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]').first();
 if(await hero.count()){
   console.log('SKI HERO:',(await hero.innerText()).replace(/\s+/g,' '));
   await hero.screenshot({path:`qa/smoke-shots/r575-ski-${TAG}.png`});
 } else { console.log('SKI HERO NOT FOUND'); await page.screenshot({path:`qa/smoke-shots/r575-ski-${TAG}.png`,fullPage:true}); }

 // Deals board inline status picker
 await page.goto(`${BASE}/deals/list`,{waitUntil:'domcontentloaded'}).catch(()=>{});
 await page.waitForLoadState('networkidle').catch(()=>{});
 await page.waitForTimeout(4500);
 const cell=page.locator('[data-testid^="inline-deal-status-"]').first();
 if(await cell.count()){
   await cell.scrollIntoViewIfNeeded().catch(()=>{});
   await cell.locator('[data-testid="inline-label-display"]').first().click().catch(()=>{});
   await page.waitForTimeout(900);
   const dd=page.locator('[data-testid="inline-label-dropdown"]').first();
   if(await dd.count()){
     const opts=(await dd.innerText()).split('\n').map(s=>s.trim()).filter(Boolean);
     console.log('STATUS OPTIONS:',JSON.stringify(opts));
     console.log('HAS HOTs:',opts.some(o=>/HOT/i.test(o)));
     await dd.screenshot({path:`qa/smoke-shots/r575-statusmenu-${TAG}.png`});
   } else console.log('DROPDOWN NOT FOUND');
 } else console.log('STATUS CELL NOT FOUND');
}finally{await b.close();}
