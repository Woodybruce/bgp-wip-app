// Deterministic repro of the persisted-cache staleness: change the data
// out-of-band, reload while the persisted snapshot is still "fresh" under
// staleTime, and see whether the board self-heals.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000';
const QA = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA?{executablePath:QA,args:['--no-sandbox']}:{args:['--no-sandbox']});
const ctx = await browser.newContext({ viewport:{width:1440,height:900}, locale:'en-GB' });
const r = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
const user = await r.json();
const api = async (m,p,d)=>{const res=await ctx.request.fetch(`${BASE}${p}`,{method:m,headers:{Authorization:`Bearer ${user.token}`,'Content-Type':'application/json'},data:d});let b=null;try{b=await res.json()}catch{};return{status:res.status(),body:b}};
const tag='stale-'+Date.now().toString(36);
const made = await api('POST','/api/lease-events',{tenant:'QA-PROBE '+tag,eventType:'Break Option',status:'Monitoring',sourceEvidence:'Manual',eventDate:new Date(Date.now()+120*864e5).toISOString().slice(0,10)});
const page = await ctx.newPage();
let getsAfterReload = 0, reloaded = false;
page.on('request', rq => { if (reloaded && rq.method()==='GET' && rq.url().endsWith('/api/lease-events')) getsAfterReload++; });
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
await page.goto(BASE+'/lease-events',{waitUntil:'domcontentloaded'}).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
const row = () => page.locator('table tbody tr', { hasText: 'QA-PROBE '+tag }).first();
await row().waitFor({ timeout: 30000 });
await page.waitForTimeout(3000);           // let the persister flush the pre-change snapshot
const snap = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('bgp-query-cache')||'null');
  const q = (raw?.clientState?.queries||[]).find(x => JSON.stringify(x.queryKey)==='["/api/lease-events"]');
  return q ? { ageMs: Date.now()-q.state.dataUpdatedAt, n: (q.state.data||[]).length } : null;
});
console.log('snapshot before change:', JSON.stringify(snap));
console.log('patch ->', (await api('PATCH','/api/lease-events/'+made.body.id,{status:'Contacted'})).status);
reloaded = true;
await page.reload({waitUntil:'domcontentloaded'}).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await row().waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
const shown = (await row().locator('button[role="combobox"]').nth(0).innerText()).trim();
console.log(`after reload: board "${shown}", db "Contacted", GET /api/lease-events since reload: ${getsAfterReload}`);
await page.waitForTimeout(5000);
console.log('   +5s later board:', (await row().locator('button[role="combobox"]').nth(0).innerText()).trim(), '| GETs:', getsAfterReload);
await api('DELETE','/api/lease-events/'+made.body.id);
await browser.close();
process.exit(shown === 'Contacted' ? 0 : 1);
