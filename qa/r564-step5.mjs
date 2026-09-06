import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000', USER='victoria@brucegillinghampollard.com', PASSWORD='B@nd0077!', TAG='r564j';
const TITLE='QA-PROBE task r564 chase Landsec on the Bluewater HOTs';
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
  let step=40; const shot=async(l)=>{step++;const p=`qa/smoke-shots/${TAG}-${step}-${l}.png`;await page.screenshot({path:p});console.log('   shot',p);};
  const pills=async(l)=>{const o={};for(const k of ['assigned-by-me','all','todo','in_progress','done']){o[k]=(await page.locator(`[data-testid="filter-${k}"]`).innerText().catch(()=>'')).replace(/\s+/g,' ');}console.log(`== pills ${l}:`,JSON.stringify(o));};
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
  await page.goto(BASE+'/tasks',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(3000);
  await pills('before');
  const rowsBefore = await page.locator('[data-testid^="task-"]').count();
  console.log('== task-* nodes before:', rowsBefore);
  console.log('== visible list text:', (await page.locator('[data-testid="tasks-page"]').innerText()).replace(/\s+/g,' ').slice(0,1400));
  await shot('tasks-before');
  flush('load');

  // quick-add a task the way Victoria would
  await page.locator('[data-testid="input-add-task"]').fill(TITLE);
  await page.locator('[data-testid="input-add-task"]').press('Enter');
  await page.waitForTimeout(2500); await page.waitForLoadState('networkidle').catch(()=>{});
  await shot('after-add');
  await pills('after-add');
  const bodyTxt = (await page.locator('[data-testid="tasks-page"]').innerText()).replace(/\s+/g,' ');
  console.log('== task present after add:', bodyTxt.includes('chase Landsec on the Bluewater HOTs'));
  console.log('== list text:', bodyTxt.slice(0,1600));
  console.log('== task testids:', JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid')).filter(t=>/task/i.test(t)).slice(0,60))));
  flush('add');
} finally { await browser.close(); }
