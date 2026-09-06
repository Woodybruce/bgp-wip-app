import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const BASE='http://127.0.0.1:5000';
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox']});
const ctx = await browser.newContext({viewport:{width:1440,height:1000}});
const page = await ctx.newPage();
const t=await (await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}})).json();
await page.goto(BASE+'/login',{waitUntil:'domcontentloaded'}).catch(()=>{});
await page.evaluate(x=>localStorage.setItem('authToken',x), t.token);
await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(8000);
await page.locator('[data-testid="kpi-expiring"]').click();
await page.waitForTimeout(1500);
await page.screenshot({path:'qa/smoke-shots/r566-s7-popover.png'});
const rows = await page.evaluate(()=>{
  const out=[];
  document.querySelectorAll('[data-testid^="expiring-lease-"]').forEach(el=>{
    const a=el.closest('a');
    out.push({tid:el.getAttribute('data-testid'), text:(el.textContent||'').replace(/\s+/g,' ').trim(), href:a?a.getAttribute('href'):'(NO LINK)'});
  });
  return out;
});
console.log('POPOVER ROWS:', rows.length);
for(const r of rows) console.log(' ', r.text, '=>', r.href);
if(rows.length){
  await page.locator('[data-testid="expiring-lease-0"]').click();
  await page.waitForTimeout(6000);
  console.log('URL after row click:', page.url());
  await page.screenshot({path:'qa/smoke-shots/r566-s7-dest.png'});
  const head = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,400));
  console.log('DEST HEAD:', head);
}
await browser.close();
