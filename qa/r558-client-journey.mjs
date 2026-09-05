// r558: Mark Warne (Landsec, desktop 1440px) — "a unit at Bluewater is coming
// vacant. Who could take it? Start from my dashboard, find the vacancy, see
// who is interested/matches, and follow it through to the brand."
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const TAG = process.env.QA_TAG || 'r558j';
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
  let step = 0;
  const shot = async (l) => { step++; const p=`qa/smoke-shots/${TAG}-${step}-${l}.png`; await page.screenshot({path:p,fullPage:false}); return p; };
  const ovf = () => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  const visit = async (u, w=2500) => { await page.goto(BASE+u, {waitUntil:'domcontentloaded'}).catch(()=>{}); await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(w); };
  const txt = () => page.evaluate(()=> (document.body.innerText||'').replace(/\s+/g,' '));
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([tok,u])=>{localStorage.setItem('bgp_auth_token',tok);localStorage.setItem('authToken',tok);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);

  // STEP 1 — the dashboard Mark lands on
  await visit('/', 3500);
  console.log('== 1 dashboard url', page.url(), 'overflow', await ovf());
  console.log('   shot', await shot('dashboard'));
  console.log('   TEXT:', (await txt()).slice(0, 2200));
  const nav = await page.evaluate(()=> [...document.querySelectorAll('nav a, aside a')].map(a=>`${a.innerText.replace(/\s+/g,' ').trim()}|${a.getAttribute('href')}`).filter(x=>x.length>1));
  console.log('   NAV:', JSON.stringify([...new Set(nav)]));
  flush('dashboard');
} finally { await browser.close(); }
