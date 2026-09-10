import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000', USER='victoria@brucegillinghampollard.com', PASSWORD='B@nd0077!', TAG='r564j';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport:{width:1440,height:900}, locale:'en-GB' });
  await ctx.route('**/*',(route)=>{const u=route.request().url(); if(u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:'))return route.continue(); return route.abort();});
  const user = await (await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:USER,password:PASSWORD}})).json();
  const page = await ctx.newPage();
  let bucket=[];
  page.on('response',(res)=>{if(res.status()>=400)bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`);});
  page.on('pageerror',(e)=>bucket.push(`PAGEERROR ${String(e).slice(0,250)}`));
  page.on('console',(m)=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))bucket.push(`CONSOLE ${m.text().slice(0,220)}`);});
  const flush=(l)=>{const s=[...new Set(bucket)];bucket=[];console.log(s.length?`   [${l}] `+s.join('\n   '):`   [${l}] clean`);};
  let step=10; const shot=async(l)=>{step++;const p=`qa/smoke-shots/${TAG}-${step}-${l}.png`;await page.screenshot({path:p});console.log('   shot',p);};
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);

  // Landsec landlord record
  await page.goto(BASE+'/company/d25ec158-82df-4f50-8188-cae113af5f9f',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(3500);
  console.log('== url:', page.url());
  await shot('landsec');
  console.log('== text:', (await page.locator('body').innerText()).replace(/\s+/g,' ').slice(0,2500));
  console.log('== testids:', JSON.stringify(await page.evaluate(()=>[...new Set([...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid')))].filter(t=>!/^nav-|^chip-threads|^button-panel|^button-pinned/.test(t)).slice(0,120))));
  flush('landsec');
} finally { await browser.close(); }
