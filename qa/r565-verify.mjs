import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const BASE='http://127.0.0.1:5000';
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox']});
const ctx = await browser.newContext({viewport:{width:1440,height:1000}});
const page = await ctx.newPage();
const r = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
const {token} = await r.json();
await page.goto(BASE+'/login',{waitUntil:'domcontentloaded'}).catch(()=>{});
await page.evaluate(t=>localStorage.setItem('authToken',t), token);
await page.goto(BASE+'/',{waitUntil:'domcontentloaded'}).catch(()=>{});
await page.waitForTimeout(9000);
const card = await page.evaluate(()=>{
  const h = Array.from(document.querySelectorAll('h3')).find(e=>/Tenancy Schedule|Leasing Schedule/.test(e.textContent||''));
  if(!h) return null;
  const root = h.closest('.h-full') || h.parentElement.parentElement.parentElement;
  const rows = Array.from(root.querySelectorAll('a[href]')).map(a=>({href:a.getAttribute('href'), text:(a.textContent||'').replace(/\s+/g,' ').trim().slice(0,70)}));
  return {title:(h.textContent||'').replace(/\s+/g,' ').trim(), rows};
});
console.log(JSON.stringify(card,null,1));
const el = await page.$('[data-testid="dash-prop-cccccccc-0000-0000-0000-000000000001"]');
if(el){ await el.scrollIntoViewIfNeeded(); await el.click(); await page.waitForTimeout(8000); }
console.log('URL after click:', page.url());
await page.screenshot({path:'qa/smoke-shots/r565-fix-destination.png'});
const txt = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
console.log('ARCHIVED banner present:', /This board is retired/.test(txt));
const m = txt.match(/Tenancy Schedule · [^L]*Letting Tracker\s*([\d,]+) units/); 
console.log('header slice:', txt.slice(txt.indexOf('Back to property'), txt.indexOf('Back to property')+300));
await browser.close();
