import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const BASE='http://127.0.0.1:5000';
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox']});
const ctx = await browser.newContext({viewport:{width:1440,height:1000}});
const page = await ctx.newPage();
const r = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
const {token} = await r.json();
await page.goto(BASE+'/login',{waitUntil:'domcontentloaded'}).catch(()=>{});
await page.evaluate(t=>localStorage.setItem('authToken',t), token);
await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(7000);
await page.screenshot({path:'qa/smoke-shots/r565-client-dash.png', fullPage:true});
// Dump every element that states a number next to a label, plus clickable cards
const out = await page.evaluate(()=>{
  const res={cards:[], links:[]};
  document.querySelectorAll('[data-testid]').forEach(el=>{
    const t=(el.textContent||'').replace(/\s+/g,' ').trim();
    if(t && t.length<220 && /\d/.test(t)) res.cards.push({tid:el.getAttribute('data-testid'), text:t});
  });
  document.querySelectorAll('a[href]').forEach(a=>{
    const t=(a.textContent||'').replace(/\s+/g,' ').trim();
    if(t) res.links.push({href:a.getAttribute('href'), text:t.slice(0,80)});
  });
  return res;
});
console.log('== cards ==');
for(const c of out.cards.slice(0,120)) console.log(`${c.tid} :: ${c.text}`);
console.log('== links ==');
const seen=new Set();
for(const l of out.links){ const k=l.href+l.text; if(seen.has(k))continue; seen.add(k); console.log(`${l.href} :: ${l.text}`); }
await browser.close();
