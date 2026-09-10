// r564 journey step 1 — Victoria (BGP staff, desktop 1440px).
// Task: "a tenant's agent rang about a Bluewater unit — log the call against
// the company in CRM, set a follow-up task, then check it shows in My Tasks."
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = 'http://localhost:5000';
const USER = 'victoria@brucegillinghampollard.com';
const PASSWORD = 'B@nd0077!';
const TAG = 'r564j';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    return route.abort();
  });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  const user = await r.json();
  if (!user.token) { console.error('login failed'); process.exit(2); }
  const page = await ctx.newPage();
  let bucket = [];
  page.on('response', (res) => { if (res.status() >= 400) bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE, '')}`); });
  page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0, 250)}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) bucket.push(`CONSOLE ${msg.text().slice(0,220)}`); });
  const flush = (l) => { const s = [...new Set(bucket)]; bucket = []; if (s.length) console.log(`   [${l}] ` + s.join('\n   ')); else console.log(`   [${l}] clean`); };
  let step = 0;
  const shot = async (l) => { step++; const p = `qa/smoke-shots/${TAG}-${String(step).padStart(2,'0')}-${l}.png`; await page.screenshot({ path: p, fullPage: false }); console.log('   shot', p); };
  await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('bgp_auth_token', tok); localStorage.setItem('authToken', tok);
    localStorage.setItem('user', JSON.stringify(u));
  }, [user.token, user]);

  // ---- 1. dashboard
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3500);
  await shot('dashboard');
  console.log('== dashboard text:', (await page.locator('body').innerText()).replace(/\s+/g,' ').slice(0, 2200));
  console.log('== h-overflow:', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  flush('dashboard');

  // ---- 2. CRM
  await page.goto(BASE + '/contacts', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
  await shot('contacts');
  console.log('== contacts text:', (await page.locator('body').innerText()).replace(/\s+/g,' ').slice(0, 1800));
  console.log('== testids:', JSON.stringify(await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid')))].slice(0,90))));
  flush('contacts');
} finally { await browser.close(); }
