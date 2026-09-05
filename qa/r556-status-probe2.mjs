import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000';
const QA = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA?{executablePath:QA,args:['--no-sandbox']}:{args:['--no-sandbox']});
const ctx = await browser.newContext({ viewport:{width:1440,height:900}, locale:'en-GB' });
const r = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
const user = await r.json();
const api = async (m,p,d)=>{const res=await ctx.request.fetch(`${BASE}${p}`,{method:m,headers:{Authorization:`Bearer ${user.token}`,'Content-Type':'application/json'},data:d});let b=null;try{b=await res.json()}catch{};return{status:res.status(),body:b}};
const made = await api('POST','/api/lease-events',{tenant:'QA-PROBE cache r556',eventType:'Break Option',status:'Monitoring',sourceEvidence:'Manual',eventDate:new Date(Date.now()+120*864e5).toISOString().slice(0,10)});
const page = await ctx.newPage();
page.on('response', async (res) => {
  if (res.url().endsWith('/api/lease-events') && res.request().method()==='GET') {
    const h = res.headers();
    let body=''; try { body = (await res.text()).slice(0,200); } catch(e){ body='(unreadable)'; }
    console.log('GET /api/lease-events ->', res.status(), 'cache-control:', h['cache-control'], 'etag:', h['etag'], 'age:', h['age']);
    console.log('   body starts:', body.replace(/\s+/g,' '));
  }
});
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
await page.goto(BASE+'/lease-events',{waitUntil:'domcontentloaded'}).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(2500);
console.log('--- patch status to Contacted via API ---');
console.log('patch', (await api('PATCH','/api/lease-events/'+made.body.id,{status:'Contacted'})).status);
await page.reload({waitUntil:'domcontentloaded'}).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(2500);
const inPage = await page.evaluate(async () => {
  const res = await fetch('/api/lease-events', { headers: { Authorization: 'Bearer ' + localStorage.getItem('bgp_auth_token') } });
  const j = await res.json();
  return j.map(x=>({t:x.tenant,s:x.status}));
});
console.log('in-page fetch says:', JSON.stringify(inPage));
const tr = page.locator('table tbody tr', { hasText: 'QA-PROBE cache r556' }).first();
console.log('row combobox:', (await tr.locator('button[role="combobox"]').nth(0).innerText()).trim());
console.log('cleanup', (await api('DELETE','/api/lease-events/'+made.body.id)).status);
await browser.close();
