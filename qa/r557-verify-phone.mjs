import { chromium, devices } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000';
const QA = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA?{executablePath:QA,args:['--no-sandbox']}:{args:['--no-sandbox']});
const api0 = await browser.newContext();
const r = await api0.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
const user = await r.json();
const api = async (m,p,d)=>{const res=await api0.request.fetch(`${BASE}${p}`,{method:m,headers:{Authorization:`Bearer ${user.token}`,'Content-Type':'application/json'},data:d});let b=null;try{b=await res.json()}catch{};return{status:res.status(),body:b}};
const date = new Date(Date.now()+120*864e5).toISOString().slice(0,10);
const ervOnly = await api('POST','/api/lease-events',{tenant:'QA-PROBE ERV only',eventType:'Rent Review',status:'Monitoring',sourceEvidence:'Manual',eventDate:date,estimatedErv:'£95,000'});
const both   = await api('POST','/api/lease-events',{tenant:'QA-PROBE rent and ERV',eventType:'Break Option',status:'Monitoring',sourceEvidence:'Manual',eventDate:date,currentRent:'£125,000',estimatedErv:'£140,000'});
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale:'en-GB' });
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
await page.goto(BASE+'/lease-events',{waitUntil:'domcontentloaded'}).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.locator(`[data-testid="lease-event-card-${ervOnly.body.id}"]`).waitFor({timeout:30000});
for (const [label,id] of [['ERV only',ervOnly.body.id],['rent + ERV',both.body.id]]) {
  const txt = (await page.locator(`[data-testid="lease-event-card-${id}"]`).innerText()).split('\n').slice(0,3).join(' | ');
  console.log(`${label}: ${txt}`);
}
const ovf = await page.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log('h-overflow px:', ovf, '| pageerrors:', errs.length);
await page.screenshot({path:'qa/smoke-shots/r557-phone-lease-events.png', fullPage:false});
await api('DELETE','/api/lease-events/'+ervOnly.body.id); await api('DELETE','/api/lease-events/'+both.body.id);
await browser.close();
