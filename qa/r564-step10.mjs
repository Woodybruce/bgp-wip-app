import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000', USER='victoria@brucegillinghampollard.com', PASSWORD='B@nd0077!', TAG='r564j';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const IDS = ['notification-no-fee-deals','notification-stuck-616296ba-b0a2-4269-af16-8076b736e87a','notification-kyc-11110000-0000-0000-0000-000000000303'];
try {
  const ctx = await browser.newContext({ viewport:{width:1440,height:900}, locale:'en-GB' });
  await ctx.route('**/*',(route)=>{const u=route.request().url(); if(u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:'))return route.continue(); return route.abort();});
  const user = await (await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:USER,password:PASSWORD}})).json();
  const page = await ctx.newPage();
  let step=90; const shot=async(l)=>{step++;const p=`qa/smoke-shots/${TAG}-${step}-${l}.png`;await page.screenshot({path:p});console.log('   shot',p);};
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
  for (const id of IDS) {
    await page.goto(BASE+'/',{waitUntil:'domcontentloaded'}).catch(()=>{});
    await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(2500);
    await page.locator('[data-testid="button-notifications"]').click(); await page.waitForTimeout(1500);
    const el = page.locator(`[data-testid="${id}"]`);
    if (!await el.count()) { console.log('!! missing', id); continue; }
    console.log('\n== clicking', id, '|', (await el.innerText()).replace(/\s+/g,' ').slice(0,90));
    await el.click();
    await page.waitForTimeout(3500); await page.waitForLoadState('networkidle').catch(()=>{});
    console.log('   -> url:', page.url());
    await shot('notif-'+id.replace(/notification-/,'').slice(0,24));
    const t=(await page.locator('body').innerText()).replace(/\s+/g,' ');
    console.log('   -> page:', t.slice(300,1300));
  }
} finally { await browser.close(); }
