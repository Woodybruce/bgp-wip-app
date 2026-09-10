// r582: Mark Warne (Landsec, desktop 1440px) — "a Bluewater unit has gone
// under offer: which one, to whom, at what rent, and does my portfolio's
// vacancy picture reflect it?" Reads every field as the landlord.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const TAG = process.env.QA_TAG || 'r582j';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  await ctx.route('**/*', (route) => { const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue(); return route.abort(); });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'mark.warne@landsec.com', password: 'B@nd0077!' } });
  const user = await r.json();
  console.log('== logged in as', user?.user?.email || user?.email, 'scope', user?.user?.companyScopeId || user?.companyScopeId);
  const page = await ctx.newPage();
  let bucket = [];
  page.on('response', (res) => { if (res.status() >= 400) bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`); });
  page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0,250)}`));
  page.on('console', (m) => { if (m.type()==='error' && !/Failed to load resource/.test(m.text())) bucket.push(`CONSOLE ${m.text().slice(0,180)}`); });
  const flush = (l) => { const s=[...new Set(bucket)]; bucket=[]; if (s.length) console.log(`   [${l}] `+s.join('\n   ')); };
  let step = 10;
  const shot = async (l) => { step++; const p=`qa/smoke-shots/${TAG}-${step}-${l}.png`; await page.screenshot({path:p,fullPage:false}); return p; };
  const ovf = () => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([tok,u])=>{localStorage.setItem('bgp_auth_token',tok);localStorage.setItem('authToken',tok);localStorage.setItem('user',JSON.stringify(u));},[user.token,user.user||user]);

  // 1 — the landlord's dashboard
  await page.goto(`${BASE}/dashboard`, {waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(4000);
  console.log('\n== STEP 1 dashboard, overflow', await ovf(), 'shot', await shot('dash'));
  const dtxt = await page.evaluate(()=> (document.body.innerText||'').replace(/\s+/g,' '));
  console.log('   TEXT:', dtxt.slice(0, 2600));
  flush('dash');

  // Vacancy Pipeline card — the landlord's "who is working my voids" panel
  const vac = await page.evaluate(()=> [...document.querySelectorAll('[data-testid^="vacancy-prop-"]')].map(e=>e.innerText.replace(/\s+/g,' ').trim()));
  console.log('   VACANCY PIPELINE ROWS:', JSON.stringify(vac, null, 1));
  const nav = await page.evaluate(()=> [...document.querySelectorAll('nav a, aside a')].map(a=>a.innerText.replace(/\s+/g,' ').trim()).filter(Boolean));
  console.log('   NAV:', JSON.stringify([...new Set(nav)]));
} finally { await browser.close(); }
