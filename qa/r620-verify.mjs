import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5000';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx = await b.newContext({viewport:{width:1440,height:900}});
const lr = await ctx.request.post(BASE+'/api/auth/login',{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
const u = await lr.json(); const H={Authorization:'Bearer '+u.token};
const w = await (await fetch(BASE+'/api/wip',{headers:H})).json();
const rows = Array.isArray(w)?w:(w.entries||w.data||[]);
console.log('AFTER FIX — /api/wip months:');
for (const e of rows) console.log(`  month=${String(e.month).padEnd(8)} target=${String(e.targetDate||'null').slice(0,10).padEnd(12)} ${String(e.ref).slice(0,42)}`);
console.log(`  dateless deals now null-month (→ TBC): ${rows.filter(e=>!e.month).length} of ${rows.length}`);

const p = await ctx.newPage();
await p.goto(BASE,{waitUntil:'domcontentloaded'});
await p.evaluate(([t,uu])=>{localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(uu));},[u.token,u]);
await p.goto(BASE+'/deals',{waitUntil:'domcontentloaded'});
await p.waitForSelector('[data-testid="wip-report-page"]',{timeout:60000});
await p.waitForTimeout(7000);
await p.screenshot({path:'/tmp/r620/07-fixed-wip.png'});
const chips = await p.$$eval('[data-testid^="wip-desk-month-"]',els=>els.map(e=>({label:e.textContent.replace(/\s+/g,' ').trim(),disabled:e.disabled})));
console.log('\nmonth chart chips: '+JSON.stringify(chips));
console.log('header: '+await p.$eval('[data-testid="wip-report-title"]',e=>e.parentElement.textContent.replace(/\s+/g,' ').trim()));
console.log('rows: '+await p.$$eval('[data-testid^="wip-row-"]',e=>e.length));
for (const el of await p.$$('[data-testid^="wip-desk-month-"]')) {
  const t = await el.textContent();
  if (t.includes('Dec-26')) { await el.click(); break; }
}
await p.waitForTimeout(3000);
console.log('after Dec-26 filter: '+await p.$$eval('[data-testid^="wip-row-"]',e=>e.length)+' row(s) · '+await p.$eval('[data-testid="wip-report-title"]',e=>e.parentElement.textContent.replace(/\s+/g,' ').trim()));
await p.screenshot({path:'/tmp/r620/08-fixed-dec-filter.png'});
// TBC bar must be present and untappable
const tbc = await p.$('[data-testid="wip-desk-month-TBC"]');
console.log('TBC bar rendered: '+!!tbc+(tbc?(' · disabled='+await tbc.evaluate(e=>e.disabled)):''));
await b.close();
