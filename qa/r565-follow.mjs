import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const BASE='http://127.0.0.1:5000';
const PROP='cccccccc-0000-0000-0000-000000000001';
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox']});
const ctx = await browser.newContext({viewport:{width:1440,height:1000}});
const page = await ctx.newPage();
const r = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
const {token} = await r.json();
await page.goto(BASE+'/login',{waitUntil:'domcontentloaded'}).catch(()=>{});
await page.evaluate(t=>localStorage.setItem('authToken',t), token);

for (const [label, url] of [['leasing', `/leasing-schedule/${PROP}`], ['tenancy', `/tenancy-schedule/${PROP}`]]) {
  await page.goto(BASE+url,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(7000);
  await page.screenshot({path:`qa/smoke-shots/r565-${label}.png`, fullPage:false});
  const txt = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,700));
  console.log(`\n===== ${label} ${url}\n${txt}`);
}
// API truth
for (const p of [`/api/leasing-schedule/property/${PROP}`, `/api/tenancy-schedule/property/${PROP}`]) {
  const res = await ctx.request.get(BASE+p, {headers:{Authorization:`Bearer ${token}`}});
  let j=null; try{ j=await res.json(); }catch{}
  const arr = Array.isArray(j)? j : (j?.units||j?.rows||[]);
  console.log(`\n${p} -> ${res.status()} rows=${Array.isArray(arr)?arr.length:'?'}`);
}
await browser.close();
