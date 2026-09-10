// r590 journey — Mark Warne (Landsec), desktop 1440px.
// Task: "board paper due — where does every empty unit at Bluewater stand,
// and what's under offer?"  Step 1: dashboard, read the headline numbers and
// map the nav.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const r = await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ username:'mark.warne@landsec.com', password:'B@nd0077!' })});
const me = await r.json();
console.log('login', r.status, me?.user?.email || me?.email, 'role=', me?.user?.role || me?.role);
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
const ctx = await browser.newContext({ viewport:{width:1440,height:900} });
await ctx.route('**/*', (q)=> q.request().url().startsWith(BASE)||q.request().url().startsWith('data:') ? q.continue() : q.abort());
const page = await ctx.newPage();
const bad = [];
page.on('response', (res)=>{ if(res.status()>=400 && res.url().startsWith(BASE)) bad.push(`${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`); });
page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0,200)));
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[me.token,me.user||me]);
await page.goto(`${BASE}/`).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(3000);
await page.screenshot({ path:'qa/smoke-shots/r590-01-dashboard.png', fullPage:true });
console.log('URL:', page.url());
const nav = await page.evaluate(()=>[...document.querySelectorAll('a[href]')].map(a=>`${(a.textContent||'').trim().replace(/\s+/g,' ').slice(0,30)} -> ${a.getAttribute('href')}`).filter(s=>s.includes('->')&&!s.startsWith(' ->')));
console.log('NAV:\n' + [...new Set(nav)].join('\n'));
const txt = await page.evaluate(()=>document.body.innerText.replace(/\n{2,}/g,'\n').slice(0,3500));
console.log('--- DASHBOARD TEXT ---\n'+txt);
console.log('--- HTTP >=400 ---\n'+[...new Set(bad)].join('\n'));
await browser.close();
