import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000';
const QA = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA?{executablePath:QA,args:['--no-sandbox']}:{args:['--no-sandbox']});
const ctx = await browser.newContext({ viewport:{width:1440,height:900}, locale:'en-GB' });
const r = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
const user = await r.json();
const api = async (m,p,d)=>{const res=await ctx.request.fetch(`${BASE}${p}`,{method:m,headers:{Authorization:`Bearer ${user.token}`,'Content-Type':'application/json'},data:d});let b=null;try{b=await res.json()}catch{};return{status:res.status(),body:b}};
const made = await api('POST','/api/lease-events',{tenant:'QA-PROBE dom r556',eventType:'Break Option',status:'Contacted',sourceEvidence:'Manual',eventDate:new Date(Date.now()+120*864e5).toISOString().slice(0,10)});
console.log('created with status Contacted:', made.status);
const page = await ctx.newPage();
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
await page.goto(BASE+'/lease-events',{waitUntil:'domcontentloaded'}).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(4000);
const dump = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('table tbody tr')].find(t => t.innerText.includes('QA-PROBE dom r556'));
  if (!tr) return 'ROW NOT FOUND';
  const tds = [...tr.querySelectorAll('td')];
  return {
    cellCount: tds.length,
    statusCellHTML: tds[6]?.innerHTML.slice(0, 700),
    nativeSelects: [...tr.querySelectorAll('select')].map(s => s.value),
    triggers: [...tr.querySelectorAll('button[role="combobox"]')].map(b => b.innerText.trim()),
  };
});
console.log(JSON.stringify(dump, null, 1));
await page.screenshot({path:'qa/smoke-shots/r556p-dom.png'});
console.log('cleanup', (await api('DELETE','/api/lease-events/'+made.body.id)).status);
await browser.close();
