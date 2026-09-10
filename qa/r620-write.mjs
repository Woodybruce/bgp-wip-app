import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5000';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx = await b.newContext({viewport:{width:1440,height:900}});
const lr = await ctx.request.post(BASE+'/api/auth/login',{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
const u = await lr.json(); const H={Authorization:'Bearer '+u.token};
const p = await ctx.newPage();
p.on('response',r=>{ if(r.status()>=400 && r.url().includes('/api/')) console.log(`     [http ${r.status()}] ${r.url().replace(BASE,'')}`); });
await p.goto(BASE,{waitUntil:'domcontentloaded'});
await p.evaluate(([t,uu])=>{localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(uu));},[u.token,u]);
await p.goto(BASE+'/deals',{waitUntil:'domcontentloaded'});
await p.waitForSelector('[data-testid="wip-report-page"]',{timeout:60000});
await p.waitForTimeout(7000);

const DEAL='44444444-4444-4444-4444-444444444444';
console.log('STEP 9 — WRITE: set the £250K deal\'s target month to Nov 2026 from the WIP table');
const rows = await p.$$('[data-testid^="wip-row-"]');
let input=null;
for (const r of rows) {
  if ((await r.textContent()).includes('250,000')) { input = await r.$('input[type="month"]'); break; }
}
if (!input) { console.log('   ! no month input on the £250,000 row'); }
else {
  await input.fill('2026-11');
  await input.evaluate(e=>e.blur());
  await p.waitForTimeout(4000);
  const toast = await p.evaluate(()=>document.body.innerText.match(/Target month [a-z]+/i)?.[0] || null);
  console.log('   toast: ' + toast);
  const d = await (await fetch(BASE+'/api/crm/deals/'+DEAL,{headers:H})).json();
  console.log('   deal.targetDate now: ' + d.targetDate);
  await p.waitForTimeout(4000);
  const chips = await p.$$eval('[data-testid^="wip-desk-month-"]',els=>els.map(e=>e.textContent.replace(/\s+/g,' ').trim()));
  console.log('   chart chips after the write: ' + JSON.stringify(chips));
  await p.screenshot({path:'/tmp/r620/09-after-write.png'});
  // Nov-26 filter must now isolate exactly that deal and its £250K
  for (const el of await p.$$('[data-testid^="wip-desk-month-"]')) {
    if ((await el.textContent()).includes('Nov-26')) { await el.click(); break; }
  }
  await p.waitForTimeout(3000);
  console.log('   Nov-26 filter → ' + await p.$$eval('[data-testid^="wip-row-"]',e=>e.length) + ' row(s) · ' +
    await p.$eval('[data-testid="wip-report-title"]',e=>e.parentElement.textContent.replace(/\s+/g,' ').trim()));
  await p.screenshot({path:'/tmp/r620/10-nov-filter.png'});
}
console.log('\nSTEP 10 — restore the fixture (clear the target month again)');
const clr = await fetch(BASE+'/api/crm/deals/'+DEAL,{method:'PUT',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({targetDate:null})});
console.log('   clear PUT: ' + clr.status);
const d2 = await (await fetch(BASE+'/api/crm/deals/'+DEAL,{headers:H})).json();
console.log('   deal.targetDate restored to: ' + d2.targetDate);
await b.close();
