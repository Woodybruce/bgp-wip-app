// r551 verification — the staff Import/Export controls on the tenancy board:
// download the rent roll, upload it back, and read the board as Victoria.
import { chromium } from '../node_modules/playwright/index.mjs';
import { writeFileSync, readFileSync } from 'fs';
const BASE='http://localhost:5000'; const TAG='r551v';
const PID='cccccccc-0000-0000-0000-000000000001';
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
try{
  const ctx = await browser.newContext({viewport:{width:1440,height:900},locale:'en-GB'});
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  const bad=[]; page.on('response',r=>{ if(r.status()>=400) bad.push(`${r.status()} ${r.url().replace(BASE,'')}`); });
  const r = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
  const user = await r.json(); const H={Authorization:`Bearer ${user.token}`};
  await page.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'});
  await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);

  await page.goto(`${BASE}/tenancy-schedule/${PID}`,{waitUntil:'networkidle'});
  await page.waitForTimeout(2500);
  await page.waitForTimeout(3000);
  await page.screenshot({path:`qa/smoke-shots/${TAG}-board-before.png`, fullPage:false});

  // The user's real move: Export, then Import that same file.
  const ex = await ctx.request.get(`${BASE}/api/tenancy-schedule/property/${PID}/export-excel`,{headers:H});
  const buf = await ex.body(); writeFileSync('/tmp/claude-0/r551-v.xlsx', buf);
  const up = await ctx.request.post(`${BASE}/api/tenancy-schedule/import-excel`,{headers:H,multipart:{
    file:{name:'Bluewater_Tenancy_Schedule.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:readFileSync('/tmp/claude-0/r551-v.xlsx')},
    propertyId:PID, clearExisting:'true'}});
  const res = await up.json();
  console.log('IMPORT:', res.message);

  await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(2500);
  await page.waitForTimeout(3500);
  await page.screenshot({path:`qa/smoke-shots/${TAG}-board-after.png`, fullPage:false});

  const board = await (await ctx.request.get(`${BASE}/api/tenancy-schedule/property/${PID}`,{headers:H})).json();
  console.log('rows', board.length,
    '| NIA filled', board.filter(u=>Number(u.nia_sqft)>0).length,
    '| TOTAL leases', board.filter(u=>/^total$/i.test(String(u.tenant_name||'').trim())).length);
  // Does the board show a phantom anywhere the user would read it?
  const txt = await page.locator('body').innerText();
  console.log('board text mentions a TOTAL tenant row:', /\bTOTAL\b/.test(txt) ? 'CHECK SHOT' : 'no');
  const ov = await page.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('h-overflow', ov, '| pageerrors', errs.length, '| non-2xx', JSON.stringify([...new Set(bad)].slice(0,8)));
} finally { await browser.close(); }
