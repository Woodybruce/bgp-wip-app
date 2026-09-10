// r549 verification — the same comp read on all three surfaces that quote a
// net effective rent: the schedule's devaluation column, the schedule's Net
// Effective cell, and the Rent Analysis dialog one click away.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000', USER='victoria@brucegillinghampollard.com', PASSWORD='B@nd0077!';
const TAG = process.env.TAG || 'r549v';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args:['--no-sandbox'] } : { args:['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport:{width:1600,height:1000}, locale:'en-GB' });
  await ctx.route('**/*',(route)=>{const u=route.request().url(); if(u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:'))return route.continue(); return route.abort();});
  const r = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:USER,password:PASSWORD}});
  const user = await r.json();
  const H = { authorization:'Bearer '+user.token, 'content-type':'application/json' };
  const comps = await (await ctx.request.get(`${BASE}/api/crm/comps`, {headers:H})).json();
  const comp = comps.find(c=>c.name==='QA-COMP r549 12 Market Street');
  if (!comp) { console.error('probe comp missing'); process.exit(2); }
  // clear the stored net effective so the cell recomputes from scratch
  await ctx.request.put(`${BASE}/api/crm/comps/${comp.id}`, {headers:H, data:{ netEffectiveRent:'', effectiveRatePsf:'' }});
  const fresh = await (await ctx.request.get(`${BASE}/api/crm/comps`, {headers:H})).json();
  const c1 = fresh.find(c=>c.id===comp.id);
  console.log('== server devaluation:', JSON.stringify(c1.devaluation));
  const page = await ctx.newPage();
  let bucket=[];
  page.on('response',res=>{if(res.status()>=400)bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`);});
  page.on('pageerror',e=>bucket.push(`PAGEERROR ${String(e).slice(0,250)}`));
  const flush=(l)=>{const s=[...new Set(bucket)];bucket=[];console.log(`   [${l}] `+(s.length?s.join('\n   '):'clean'));};
  let step=0; const shot=async l=>{step++;const p=`qa/smoke-shots/${TAG}-${String(step).padStart(2,'0')}-${l}.png`;await page.screenshot({path:p});console.log('   shot',p);};
  await page.goto(BASE).catch(e=>{if(!/ERR_ABORTED/.test(String(e)))throw e;});
  await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
  await page.goto(BASE+'/comps',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(2500);
  await page.locator('[data-testid="input-search-comps"]').fill('12 Market Street');
  await page.waitForTimeout(1200);
  const row = page.locator(`[data-testid="comp-row-${comp.id}"]`);
  const fbtns = row.locator('[data-testid="button-formula-compute"]');
  for (let i=0;i<await fbtns.count();i++){ await fbtns.nth(i).click({force:true}).catch(()=>{}); await page.waitForTimeout(500); }
  await page.waitForTimeout(1200);
  await shot('row');
  const cells = await row.locator('td').evaluateAll(t=>t.map(x=>x.innerText.replace(/\s+/g,' ').trim()));
  console.log('== devaluation cell:', cells[10]);
  console.log('== net effective cell:', cells[12], '| net eff psf cell:', cells[13]);
  flush('row');
  await page.locator(`[data-testid="comp-menu-${comp.id}"]`).click(); await page.waitForTimeout(600);
  await page.locator('[role="menuitem"]').nth(1).click();
  await page.waitForTimeout(1800);
  await shot('dialog');
  const panel = await page.evaluate(()=>{const d=document.querySelector('[data-testid="net-rent-calculator"]');const m=d.innerText.replace(/\s+/g,' ').match(/Results.*/);return m?m[0].slice(0,600):'NONE';});
  console.log('== dialog:', panel);
  flush('dialog');
} finally { await browser.close(); }
