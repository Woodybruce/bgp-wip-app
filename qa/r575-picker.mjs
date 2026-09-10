// r575: the same deal's status picker on the Deals board vs the WIP Report.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const TAG=process.argv[2]||'x';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const readMenu=async(page,trigger,shot)=>{
  await trigger.scrollIntoViewIfNeeded().catch(()=>{});
  await trigger.click().catch(()=>{});
  await page.waitForTimeout(900);
  const dd=page.locator('[data-testid="inline-label-dropdown"]').first();
  if(!await dd.count()) return null;
  const opts=(await dd.innerText()).split('\n').map(s=>s.trim()).filter(Boolean);
  await dd.screenshot({path:shot}).catch(()=>{});
  await page.keyboard.press('Escape').catch(()=>{});
  return opts;
};
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
 const cell=page.locator('[data-testid="inline-label-display"]').filter({hasText:/^(Exchanged|Solicitors|Completed|Invoiced|Negotiating|HOTs)$/}).first();
 const boardOpts=await readMenu(page,cell,`qa/smoke-shots/r575-picker-board-${TAG}.png`);
 console.log('DEALS BOARD PICKER:',JSON.stringify(boardOpts));
 console.log('  board has HOTs:',!!boardOpts&&boardOpts.some(o=>/HOT/i.test(o)));

 await page.goto(`${BASE}/deals`,{waitUntil:'domcontentloaded'}).catch(()=>{});
 await page.waitForLoadState('networkidle').catch(()=>{});
 await page.waitForTimeout(6000);
 const wcell=page.locator('[data-testid="inline-label-display"]').filter({hasText:/^(Exchanged|Solicitors|Completed|Invoiced|Negotiating|HOTs|Available)$/}).first();
 const wipOpts=await readMenu(page,wcell,`qa/smoke-shots/r575-picker-wip-${TAG}.png`);
 console.log('WIP REPORT PICKER:',JSON.stringify(wipOpts));
 console.log('  wip has HOTs:',!!wipOpts&&wipOpts.some(o=>/HOT/i.test(o)));
}finally{await b.close();}
