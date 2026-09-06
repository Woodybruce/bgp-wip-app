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
const cards = await page.evaluate(()=>{
  const res=[];
  document.querySelectorAll('[data-testid]').forEach(el=>{
    const t=(el.textContent||'').replace(/\s+/g,' ').trim();
    if(t && t.length<200) res.push(el.getAttribute('data-testid')+' :: '+t);
  });
  return res;
});
console.log('== TESTIDS ==\n'+cards.join('\n'));
console.log('== HREFS ==');
const hrefs = await page.evaluate(()=>[...new Set([...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')+' :: '+(a.textContent||'').replace(/\s+/g,' ').trim().slice(0,60)))]);
console.log(hrefs.join('\n'));
await browser.close();
