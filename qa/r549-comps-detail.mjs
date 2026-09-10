// r549 — continue the comp task: open the row menu -> details panel -> Rent
// Analysis, and check the numbers agree with the schedule row beside them.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000', USER='victoria@brucegillinghampollard.com', PASSWORD='B@nd0077!', TAG='r549d';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args:['--no-sandbox'] } : { args:['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport:{width:1440,height:900}, locale:'en-GB' });
  await ctx.route('**/*', (route)=>{const u=route.request().url(); if(u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:'))return route.continue(); return route.abort();});
  const r = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:USER,password:PASSWORD}});
  const user = await r.json();
  const page = await ctx.newPage();
  let bucket=[];
  page.on('response',res=>{if(res.status()>=400)bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`);});
  page.on('pageerror',e=>bucket.push(`PAGEERROR ${String(e).slice(0,250)}`));
  page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))bucket.push(`CONSOLE ${m.text().slice(0,220)}`);});
  const flush=(l)=>{const s=[...new Set(bucket)];bucket=[];console.log(`   [${l}] `+(s.length?s.join('\n   '):'clean'));};
  let step=0; const shot=async l=>{step++;const p=`qa/smoke-shots/${TAG}-${String(step).padStart(2,'0')}-${l}.png`;await page.screenshot({path:p});console.log('   shot',p);};
  await page.goto(BASE).catch(e=>{if(!/ERR_ABORTED/.test(String(e)))throw e;});
  await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
  await page.goto(BASE+'/comps',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(2500);
  await page.locator('[data-testid="input-search-comps"]').fill('12 Market Street');
  await page.waitForTimeout(1200);
  const rowIds = await page.locator('[data-testid^="comp-row-"]').evaluateAll(els=>els.map(e=>e.getAttribute('data-testid')));
  console.log('== rows:', rowIds);
  const id = rowIds[0].replace('comp-row-','');
  // read the row's rent + zone A cells as the user sees them
  const cells = await page.locator(`[data-testid="comp-row-${id}"] td`).evaluateAll(t=>t.map(x=>x.innerText.replace(/\s+/g,' ').trim()));
  console.log('== row cells:', JSON.stringify(cells));
  await shot('row');
  // open the row menu
  await page.locator(`[data-testid="comp-menu-${id}"]`).click();
  await page.waitForTimeout(700);
  const menu = await page.evaluate(()=>{const m=document.querySelector('[role="menu"]');return m?m.innerText.replace(/\s+/g,' '):'NO MENU';});
  console.log('== menu:', menu);
  await shot('menu');
  // View details
  await page.locator('[role="menuitem"]').first().click();
  await page.waitForTimeout(1800);
  await shot('details');
  const det = await page.evaluate(()=>{const ds=[...document.querySelectorAll('[role="dialog"]')];return ds.length?ds[ds.length-1].innerText.replace(/\s+/g,' ').slice(0,2500):'NO DIALOG';});
  console.log('== details panel:', det);
  flush('details');
  // Rent analysis from within the details panel
  const nerBtn = page.locator('[data-testid="button-detail-ner"]');
  console.log('== ner button count:', await nerBtn.count());
  if (await nerBtn.count()) {
    await nerBtn.click(); await page.waitForTimeout(1600); await shot('ner');
    const vals = await page.evaluate(()=>{
      const g = (t)=>{const e=document.querySelector(`[data-testid="${t}"]`);return e?e.value:'MISSING';};
      return {headline:g('calc-headline-rent'),area:g('calc-area'),itza:g('calc-itza'),term:g('calc-lease-term'),rf:g('calc-rent-free'),fitout:g('calc-fitout')};
    });
    console.log('== NER prefill:', JSON.stringify(vals));
    const summary = await page.evaluate(()=>{const d=document.querySelector('[data-testid="net-rent-calculator"]');return d?d.innerText.replace(/\s+/g,' ').slice(0,1400):'NONE';});
    console.log('== NER panel:', summary);
    flush('ner');
  }
} finally { await browser.close(); }
