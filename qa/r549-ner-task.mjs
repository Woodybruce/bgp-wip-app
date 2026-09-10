// r549 — Victoria completes the rent analysis on the comp she just recorded:
// fill the NER calculator as she would from the lease, read the results, and
// check they agree with hand-worked figures and with the comp row.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000', USER='victoria@brucegillinghampollard.com', PASSWORD='B@nd0077!', TAG='r549n';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args:['--no-sandbox'] } : { args:['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport:{width:1440,height:1000}, locale:'en-GB' });
  await ctx.route('**/*',(route)=>{const u=route.request().url(); if(u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:'))return route.continue(); return route.abort();});
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
  const id = (await page.locator('[data-testid^="comp-row-"]').first().getAttribute('data-testid')).replace('comp-row-','');
  await page.locator(`[data-testid="comp-menu-${id}"]`).click(); await page.waitForTimeout(600);
  await page.locator('[role="menuitem"]').nth(1).click(); // Rent Analysis
  await page.waitForTimeout(1600);
  await shot('ner-open');
  const set = async (t,v)=>{ await page.locator(`[data-testid="${t}"]`).fill(v); await page.waitForTimeout(250); };
  await set('calc-lease-term','10');
  await set('calc-rent-free','9');
  await set('calc-fitout','50000');
  await set('calc-area','780');
  await set('calc-itza','400');
  await page.waitForTimeout(900);
  await shot('ner-filled');
  const panel = await page.evaluate(()=>{const d=document.querySelector('[data-testid="net-rent-calculator"]');return d?d.innerText.replace(/\s+/g,' '):'NONE';});
  console.log('== NER results:', panel);
  flush('ner');
  // hand-worked
  const rentFreeValue = 92500*9/12, incentives = rentFreeValue+50000, annualised = incentives/10;
  console.log('== expected: rentFreeValue', rentFreeValue, 'incentives', incentives, 'annualised', annualised.toFixed(2), 'NER', (92500-annualised).toFixed(2));
  console.log('== expected headline psf NIA', (92500/780).toFixed(2), 'net psf NIA', ((92500-annualised)/780).toFixed(2));
  console.log('== expected headline ZA', (92500/400).toFixed(2), 'net ZA', ((92500-annualised)/400).toFixed(2));
  // Now: does anything here get back to the comp?
  const btns = await page.locator('[role="dialog"] button').evaluateAll(b=>b.map(x=>x.innerText.replace(/\s+/g,' ').trim()).filter(Boolean));
  console.log('== dialog buttons:', JSON.stringify(btns));
} finally { await browser.close(); }
