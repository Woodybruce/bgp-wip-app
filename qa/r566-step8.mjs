import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const BASE='http://127.0.0.1:5000';
const PROP='cccccccc-0000-0000-0000-000000000001';
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox']});
const ctx = await browser.newContext({viewport:{width:1440,height:1000}});
const page = await ctx.newPage();
const t=await (await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}})).json();
await page.goto(BASE+'/login',{waitUntil:'domcontentloaded'}).catch(()=>{});
await page.evaluate(x=>localStorage.setItem('authToken',x), t.token);
await page.goto(BASE+'/tenancy-schedule/'+PROP,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(9000);
const inputs = await page.evaluate(()=>[...document.querySelectorAll('input,select')].map(i=>({tag:i.tagName,type:i.type,ph:i.placeholder||'',tid:i.getAttribute('data-testid')||''})));
console.log('INPUTS:', JSON.stringify(inputs));
const isTable = await page.evaluate(()=>({tables:document.querySelectorAll('table').length, trs:document.querySelectorAll('tbody tr').length, cards:document.querySelectorAll('[data-testid^="tenancy-card-"]').length}));
console.log('STRUCT:', JSON.stringify(isTable));
// try to find the Nando's row
const found = await page.evaluate(()=>{
  const out=[];
  document.querySelectorAll('tbody tr').forEach(tr=>{
    const txt=(tr.textContent||'');
    if(/Nando/i.test(txt)) out.push([...tr.querySelectorAll('td')].map(td=>(td.textContent||'').replace(/\s+/g,' ').trim()));
  });
  return out;
});
console.log('NANDO ROWS:', JSON.stringify(found));
const heads = await page.evaluate(()=>[...document.querySelectorAll('thead th')].map(th=>(th.textContent||'').replace(/\s+/g,' ').trim()));
console.log('HEADS:', JSON.stringify(heads));
await browser.close();
