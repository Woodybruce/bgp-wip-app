// r556 visual verification of both fixes, 1440px, Victoria, fresh restore.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000';
const QA = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA?{executablePath:QA,args:['--no-sandbox']}:{args:['--no-sandbox']});
const ctx = await browser.newContext({ viewport:{width:1440,height:900}, locale:'en-GB' });
const user = await (await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}})).json();
const page = await ctx.newPage();
let bucket=[];
page.on('response', res => { if (res.status()>=400) bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`); });
page.on('pageerror', e => bucket.push('PAGEERROR '+String(e).slice(0,200)));
const flush = l => { const s=[...new Set(bucket)]; bucket=[]; console.log(`   [${l}] ` + (s.length?s.join('\n   '):'clean')); };
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);

// FIX 2 — tenancy tiles filter what they count
await page.goto(BASE+'/tenancy-schedule/cccccccc-0000-0000-0000-000000000001',{waitUntil:'domcontentloaded'}).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(3000);
for (const tile of ['occupied','vacant']) {
  const el = page.locator(`[data-testid="tenancy-stat-${tile}"]`).first();
  const n = (await el.innerText()).replace(/\n/g,' ');
  await el.click(); await page.waitForTimeout(1200);
  const rows = await page.evaluate(()=>document.querySelectorAll('tbody tr').length);
  const match = await page.evaluate(()=>(document.body.innerText.match(/\d+ of \d+ units match/)||[''])[0]);
  console.log(`tile "${n}" -> ${rows} rows, badge: "${match}"`);
  await page.screenshot({path:`qa/smoke-shots/r556v-tenancy-${tile}.png`});
  await el.click(); await page.waitForTimeout(600);
}
console.log('h-overflow:', await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth));
flush('tenancy');

// FIX 1 — Log event works on a freshly restored database
await page.goto(BASE+'/lease-events',{waitUntil:'domcontentloaded'}).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(2500);
await page.getByRole('button',{name:/Log event/i}).first().click();
await page.waitForTimeout(900);
const d = new Date(Date.now()+45*864e5).toISOString().slice(0,10);
await page.locator('[role="dialog"] input').nth(0).fill('QA-PROBE verify r556');
await page.locator('[role="dialog"] input').nth(1).fill('Bluewater Shopping Centre');
await page.locator('[role="dialog"] input').nth(3).fill('U124');
await page.locator('[role="dialog"] input[type="date"]').first().fill(d);
await page.locator('[role="dialog"] input').nth(6).fill('£125,000');
await page.getByRole('button',{name:/Create event/i}).click();
await page.waitForTimeout(2200);
console.log('dialog still open:', await page.locator('[role="dialog"]').count());
console.log('board rows:', await page.evaluate(()=>document.querySelectorAll('table tbody tr').length));
console.log('tiles:', await page.evaluate(()=>{const o={};document.querySelectorAll('div.grid p.text-\\[10px\\]').forEach(p=>{const v=p.parentElement.querySelector('p.text-2xl');if(v)o[p.innerText.trim()]=v.innerText.trim();});return o;}));
await page.screenshot({path:'qa/smoke-shots/r556v-lease-event-created.png'});
flush('lease-events');
const list = await (await ctx.request.fetch(`${BASE}/api/lease-events`,{headers:{Authorization:'Bearer '+user.token}})).json();
for (const row of list.filter(x=>/QA-PROBE/.test(x.tenant||''))) {
  const r = await ctx.request.fetch(`${BASE}/api/lease-events/${row.id}`,{method:'DELETE',headers:{Authorization:'Bearer '+user.token}});
  console.log('cleanup', row.tenant, r.status());
}
await browser.close();
