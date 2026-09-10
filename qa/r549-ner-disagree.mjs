// r549 — same comp, two surfaces: the schedule's Net Effective cell vs the
// Rent Analysis dialog one click away. Comp has a break; does the schedule
// agree with the calculator?
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000', USER='victoria@brucegillinghampollard.com', PASSWORD='B@nd0077!', TAG='r549x';
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
  // Victoria fills in the lease terms she read off the lease
  await ctx.request.put(`${BASE}/api/crm/comps/${comp.id}`, {headers:H, data:{ term:'15 years', breakClause:'10 years', rentFreeMonths:'9', fitoutContribution:'50000', niaSqft:'780', useClass:'E(b) Restaurant / Cafe' }});
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
  // the Net Effective cell offers a compute button (formula). Click every formula button in the row.
  const fbtns = row.locator('[data-testid="button-formula-compute"]');
  console.log('== formula buttons in row:', await fbtns.count());
  for (let i=0;i<await fbtns.count();i++){ await fbtns.nth(i).click({force:true}).catch(()=>{}); await page.waitForTimeout(600); }
  await page.waitForTimeout(1500);
  await shot('row-computed');
  const cells = await row.locator('td').evaluateAll(t=>t.map(x=>x.innerText.replace(/\s+/g,' ').trim()));
  console.log('== row cells:', JSON.stringify(cells));
  const after = await (await ctx.request.get(`${BASE}/api/crm/comps`, {headers:H})).json();
  const c2 = after.find(c=>c.id===comp.id);
  console.log('== persisted:', JSON.stringify({term:c2.term,brk:c2.breakClause,rf:c2.rentFreeMonths,fit:c2.fitoutContribution,nia:c2.niaSqft,ner:c2.netEffectiveRent,overall:c2.overallRate,effPsf:c2.effectiveRatePsf}));
  flush('row');
  // now the dialog one click away
  await page.locator(`[data-testid="comp-menu-${comp.id}"]`).click(); await page.waitForTimeout(600);
  await page.locator('[role="menuitem"]').nth(1).click();
  await page.waitForTimeout(1800);
  await shot('ner-dialog');
  const vals = await page.evaluate(()=>{const g=t=>{const e=document.querySelector(`[data-testid="${t}"]`);return e?e.value:'MISSING';};return {headline:g('calc-headline-rent'),term:g('calc-lease-term'),ytb:g('calc-years-to-break'),rf:g('calc-rent-free'),fit:g('calc-fitout'),area:g('calc-area')};});
  console.log('== dialog prefill:', JSON.stringify(vals));
  const panel = await page.evaluate(()=>{const d=document.querySelector('[data-testid="net-rent-calculator"]');return d?d.innerText.replace(/\s+/g,' ').match(/Results.*/)[0].slice(0,700):'NONE';});
  console.log('== dialog results:', panel);
  flush('dialog');
} finally { await browser.close(); }
