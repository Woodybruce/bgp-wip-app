// r550: Mark Warne (Landsec, desktop 1440px) — quarterly asset review at Bluewater.
// "Which leases expire in the next 6 months, and does the tenancy schedule
//  agree with the dashboard tile I clicked to get here?"
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const TAG = process.env.QA_TAG || 'r550j';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  await ctx.route('**/*', (route) => { const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue(); return route.abort(); });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'mark.warne@landsec.com', password: 'B@nd0077!' } });
  const user = await r.json();
  const page = await ctx.newPage();
  let bucket = [];
  page.on('response', (res) => { if (res.status() >= 400) bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`); });
  page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0,250)}`));
  page.on('console', (m) => { if (m.type()==='error' && !/Failed to load resource/.test(m.text())) bucket.push(`CONSOLE ${m.text().slice(0,180)}`); });
  const flush = (l) => { const s=[...new Set(bucket)]; bucket=[]; if (s.length) console.log(`   [${l}] `+s.join('\n   ')); };
  let step = 20;
  const shot = async (l) => { step++; const p=`qa/smoke-shots/${TAG}-${step}-${l}.png`; await page.screenshot({path:p,fullPage:false}); return p; };
  const ovf = () => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([tok,u])=>{localStorage.setItem('bgp_auth_token',tok);localStorage.setItem('authToken',tok);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);

  const PID = 'cccccccc-0000-0000-0000-000000000001';
  await page.goto(`${BASE}/tenancy-schedule/${PID}`, {waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(3000);
  console.log('== tenancy schedule, overflow', await ovf());
  console.log('   shot', await shot('ts-top'));
  const txt = await page.evaluate(()=> (document.body.innerText||'').replace(/\s+/g,' '));
  console.log('   HEAD:', txt.slice(0, 1400));
  flush('ts');

  // What does the schedule itself say about expiries?
  const cols = await page.evaluate(()=> [...document.querySelectorAll('table thead th')].map(t=>t.innerText.replace(/\s+/g,' ').trim()));
  console.log('   COLUMNS:', JSON.stringify(cols));
  const rows = await page.evaluate(()=> [...document.querySelectorAll('table tbody tr')].length);
  console.log('   rows rendered:', rows);
} finally { await browser.close(); }
