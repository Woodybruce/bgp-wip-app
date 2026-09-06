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
  let step=60; const shot=async(l)=>{step++;const p=`qa/smoke-shots/${TAG}-${step}-${l}.png`;await page.screenshot({path:p});console.log('   shot',p);};
  page.on('request',(r)=>{ if(/\/api\/tasks/.test(r.url()) && r.method()!=='GET') console.log('   >>',r.method(),r.url().replace(BASE,''), (r.postData()||'').slice(0,300)); });
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
  await page.goto(BASE+'/tasks',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(3000);
  const tid=(await page.locator('[data-testid^="task-row-"]').first().getAttribute('data-testid')).replace('task-row-','');
  await page.locator(`[data-testid="task-edit-${tid}"]`).click(); await page.waitForTimeout(1200);
  // priority -> High
  await page.locator('[data-testid="select-task-priority"]').click(); await page.waitForTimeout(700);
  const opts = await page.evaluate(()=>[...document.querySelectorAll('[role="option"]')].map(e=>e.innerText.trim()));
  console.log('== priority options:', JSON.stringify(opts));
  await page.getByRole('option',{name:/High/i}).first().click().catch(async()=>{ await page.locator('[role="option"]').nth(1).click(); });
  await page.waitForTimeout(600);
  // due date
  await page.locator('[data-testid="input-task-due-date"]').fill('2026-09-10T10:00');
  await page.waitForTimeout(300);
  // link to deal
  await page.locator('[data-testid="select-task-deal"]').click(); await page.waitForTimeout(800);
  const dopts = await page.evaluate(()=>[...document.querySelectorAll('[role="option"]')].map(e=>e.innerText.trim().slice(0,50)));
  console.log('== deal options:', JSON.stringify(dopts.slice(0,12)));
  const pick = dopts.find(o=>o && !/^none$/i.test(o));
  if (pick) await page.getByRole('option',{name:pick}).first().click().catch(()=>{});
  await page.waitForTimeout(600);
  await page.locator('[data-testid="input-task-tags"]').fill('urgent, landsec');
  await shot('edit-filled');
  const before = await page.evaluate(()=>{const d=document.querySelector('[role="dialog"]');return d?d.innerText.replace(/\s+/g,' ').slice(0,700):'';});
  console.log('== dialog before save:', before);
  await page.locator('[data-testid="button-save-task"]').click();
  await page.waitForTimeout(2500); await page.waitForLoadState('networkidle').catch(()=>{});
  await shot('after-save');
  console.log('== row after save:', (await page.locator(`[data-testid="task-row-${tid}"]`).innerText().catch(()=>'GONE')).replace(/\s+/g,' ').slice(0,400));
  flush('save');
  // hard reload — does it persist?
  await page.reload({waitUntil:'domcontentloaded'}); await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(3000);
  console.log('== row after reload:', (await page.locator(`[data-testid="task-row-${tid}"]`).innerText().catch(()=>'GONE')).replace(/\s+/g,' ').slice(0,400));
  await shot('after-reload');
  await page.locator(`[data-testid="task-edit-${tid}"]`).click(); await page.waitForTimeout(1500);
  console.log('== reopened dialog:', await page.evaluate(()=>{const d=document.querySelector('[role="dialog"]');if(!d)return 'NO DIALOG';const f={};d.querySelectorAll('[data-testid]').forEach(e=>{f[e.getAttribute('data-testid')]= e.value!==undefined&&e.value!==null&&e.tagName!=='BUTTON'?String(e.value):(e.innerText||'').trim().slice(0,40);});return JSON.stringify(f);}));
  await shot('reopened');
  flush('reload');
  console.log('TASKID', tid);
} finally { await browser.close(); }
