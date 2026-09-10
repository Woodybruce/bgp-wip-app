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
await page.waitForTimeout(8000);
await page.screenshot({path:'qa/smoke-shots/r566-s1-dash.png', fullPage:true});
// nav items available to Mark
const nav = await page.evaluate(()=>{
  const out=[];
  document.querySelectorAll('nav a[href], aside a[href]').forEach(a=>{
    const t=(a.textContent||'').replace(/\s+/g,' ').trim();
    if(t) out.push(a.getAttribute('href')+' :: '+t.slice(0,50));
  });
  return [...new Set(out)];
});
console.log('== NAV ==\n'+nav.join('\n'));
// anything mentioning break / expiry / WAULT
const hits = await page.evaluate(()=>{
  const out=[];
  document.querySelectorAll('*').forEach(el=>{
    if(el.children.length>0) return;
    const t=(el.textContent||'').replace(/\s+/g,' ').trim();
    if(/break|expir|WAULT|renew/i.test(t) && t.length<160) out.push(t);
  });
  return [...new Set(out)];
});
console.log('== BREAK/EXPIRY TEXT ==\n'+hits.join('\n'));
await browser.close();
