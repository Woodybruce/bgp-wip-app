// r590 journey step 4 — clean data now. Re-read the two headline vacancy
// figures Mark's board paper would quote, then do his WRITE: a focus task on
// the Bluewater property page, checked through to My Tasks.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const BW='cccccccc-0000-0000-0000-000000000001';
const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'mark.warne@landsec.com',password:'B@nd0077!'})});
const me=await r.json();
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
await ctx.route('**/*',q=>q.request().url().startsWith(BASE)||q.request().url().startsWith('data:')?q.continue():q.abort());
const page=await ctx.newPage();
const bad=[]; page.on('response',res=>{if(res.status()>=400&&res.url().startsWith(BASE))bad.push(`${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`);});
const writes=[]; page.on('response',res=>{const m=res.request().method(); if(m!=='GET'&&res.url().startsWith(BASE))writes.push(`${res.status()} ${m} ${res.url().replace(BASE,'')}`);});
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[me.token,me.user||me]);
const grab=async(p,n,re)=>{
  await page.goto(`${BASE}${p}`).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(3000);
  await page.screenshot({path:`qa/smoke-shots/r590-${n}.png`,fullPage:true});
  const t=await page.evaluate(()=>document.body.innerText.replace(/\n{2,}/g,'\n'));
  const lines=t.split('\n');
  const hit=lines.map((l,i)=>({l,i})).filter(x=>re.test(x.l)).map(x=>lines.slice(Math.max(0,x.i-2),x.i+3).join(' | ')).slice(0,6);
  console.log(`\n== ${p} ==\n`+hit.join('\n'));
  return t;
};
await grab('/','06-dash-clean',/TOTAL UNITS|OCCUPANCY|live letting|Available$/);
await grab(`/tenancy-schedule/${BW}`,'07-tenancy-clean',/^OCCUPIED$|^VACANT$|units$/);
// ---- THE WRITE: Mark adds a focus task on Bluewater ----
await page.goto(`${BASE}/properties/${BW}`).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(3500);
const TASK='Board paper: confirm U062 marketing status with BGP';
const boxes = page.locator('input[placeholder], textarea[placeholder]');
const n = await boxes.count();
let target=null;
for (let i=0;i<n;i++){ const ph=await boxes.nth(i).getAttribute('placeholder'); if(ph && /task|focus|push|add/i.test(ph)){ target=boxes.nth(i); console.log('focus box placeholder:', ph); break; } }
if(!target){ console.log('NO focus input found; placeholders:', (await Promise.all([...Array(n).keys()].map(i=>boxes.nth(i).getAttribute('placeholder')))).join(' | ')); }
else {
  await target.click(); await target.fill(TASK); await page.waitForTimeout(400);
  await page.screenshot({path:'qa/smoke-shots/r590-08-task-typed.png'});
  const add = page.locator('button:has-text("Add")').first();
  await add.click().catch(e=>console.log('Add click failed', String(e).slice(0,120)));
  await page.waitForTimeout(3000);
  const toast=await page.evaluate(()=>[...document.querySelectorAll('[role="status"],li[data-state]')].map(e=>(e.textContent||'').trim()).filter(Boolean).join(' ~~ '));
  console.log('TOAST:', toast||'(none)');
  await page.screenshot({path:'qa/smoke-shots/r590-09-task-added.png',fullPage:true});
  const t2=await page.evaluate(()=>document.body.innerText);
  console.log('task visible on property page after add:', t2.includes(TASK));
  console.log("THIS WEEK'S FOCUS count line:", (t2.split('\n').find((l,i,a)=>a[i-1]&&/THIS WEEK/.test(a[i-1]))||'?'));
  // reload to prove it persisted
  await page.reload().catch(()=>{}); await page.waitForTimeout(3500);
  const t3=await page.evaluate(()=>document.body.innerText);
  console.log('task survives reload:', t3.includes(TASK));
  await page.screenshot({path:'qa/smoke-shots/r590-10-task-reload.png',fullPage:true});
  // and on My Tasks
  await page.goto(`${BASE}/tasks`).catch(()=>{}); await page.waitForTimeout(4000);
  const t4=await page.evaluate(()=>document.body.innerText);
  console.log('task appears on /tasks:', t4.includes(TASK));
  await page.screenshot({path:'qa/smoke-shots/r590-11-my-tasks.png',fullPage:true});
}
console.log('\n--- WRITES ---\n'+writes.join('\n'));
console.log('\n--- HTTP>=400 ---\n'+[...new Set(bad)].join('\n'));
await browser.close();
