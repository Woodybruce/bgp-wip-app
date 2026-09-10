import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000', USER='victoria@brucegillinghampollard.com', P='B@nd0077!';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
const ctx = await b.newContext({ viewport:{width:1440,height:900} });
const r = await ctx.request.post(`${BASE}/api/auth/login`, { data:{ username:USER, password:P } });
const u = await r.json(); if(!u.token){console.log('login fail');process.exit(2);}
const page = await ctx.newPage();
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,x])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(x));},[u.token,u]);
await page.goto(BASE+'/deals/44444444-4444-4444-4444-444444444444').catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(2500);
const t = await page.evaluate(()=> (document.body.innerText||'').replace(/\s+/g,' '));
console.log('DESKTOP DEAL PAGE has-pound:', /£/.test(t), '| 250,000:', /250,000/.test(t));
console.log('TEXT:', t.slice(0,2200));
await page.screenshot({path:'qa/smoke-shots/r554-desk-deal.png'});
// raw deal record
const d = await page.evaluate(async ()=>{ const tk=localStorage.getItem('bgp_auth_token');
  const rr=await fetch('/api/crm/deals/44444444-4444-4444-4444-444444444444',{headers:{Authorization:'Bearer '+tk}});
  const j=await rr.json(); return { status:rr.status, fee:j.fee, feeCombined:j.feeCombined, name:j.name, team:j.team, targetDate:j.targetDate, status_:j.status }; });
console.log('-- DEAL RECORD', JSON.stringify(d));
await b.close();
