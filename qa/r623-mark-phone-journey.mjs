// r623 journey harness: Landsec client (Mark Warne) on a REAL iPhone context
// at 390px. The phone shell keys off the USER AGENT + touch, not the viewport
// (client/src/hooks/use-mobile.tsx:isTouchDevice), so a viewport-only 390px
// run silently tests the DESKTOP app. This harness THROWS if the phone shell
// did not render.
import { chromium, devices } from '../node_modules/playwright/index.mjs';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const BASE = process.env.QA_BASE || 'http://localhost:5000';
const USER = process.env.QA_USER || 'mark.warne@landsec.com';
const PASSWORD = 'B@nd0077!';
const TAG = process.env.QA_TAG || 'r623';

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
// A FRESH context per persona — ctx.request shares ONE cookie jar with the
// context and the session cookie BEATS an explicit Bearer header in
// resolveCompanyScope (r622 trap 1).
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.abort();
});
const CACHE = process.env.QA_TOKEN_CACHE || `/tmp/${TAG}-token-${USER.split('@')[0]}.json`;
let user = null;
if (existsSync(CACHE)) {
  try {
    const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
    const probe = await ctx.request.get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${cached.token}` } });
    if (probe.ok()) user = cached;
  } catch {}
}
if (!user) {
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  user = await r.json();
  if (!user.token) { console.error('login failed', JSON.stringify(user).slice(0, 300)); process.exit(2); }
  writeFileSync(CACHE, JSON.stringify(user));
}
const page = await ctx.newPage();

let bucket = [];
const NOISE = /rocketreach|ai-briefing|ai-take|brand-gaps|commentary|sharepoint\/root|microsoft\/|brand-theme|favicon|\/photo|covenant\/|os\/sites/;
page.on('response', (res) => {
  if (res.status() < 400) return;
  const u = res.url().replace(BASE, '');
  bucket.push(`HTTP ${res.status()} ${res.request().method()} ${u}${NOISE.test(u) ? '   [noise]' : ''}`);
});
page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0, 250)}`));
page.on('console', async (msg) => {
  if (msg.type() !== 'error' && msg.type() !== 'warning') return;
  const t = msg.text();
  if (/Failed to load resource/.test(t)) return;
  bucket.push(`CONSOLE[${msg.type()}] ${t.slice(0, 220)}`);
});

await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([tok, u]) => {
  localStorage.setItem('bgp_auth_token', tok);
  localStorage.setItem('authToken', tok);
  localStorage.setItem('user', JSON.stringify(u));
  localStorage.removeItem('bgp-force-desktop');
}, [user.token, user]);

let step = 0;
async function shot(label) {
  step++;
  const path = `/tmp/${TAG}/${String(step).padStart(2, '0')}-${label.replace(/\W+/g, '-')}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}
async function report(label, { text = false, ids = false, full = false, settle = 2200 } = {}) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(settle);
  const info = await page.evaluate(() => ({
    path: location.pathname + location.search,
    head: (document.querySelector('h1,h2')?.textContent || '').trim().slice(0, 90),
    txt: (document.body.innerText || '').replace(/\n{2,}/g, '\n').trim(),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    boundary: /Something went wrong|Application error|Unexpected error/i.test(document.body.innerText || ''),
    phoneShell: !!document.querySelector('[data-testid="mobile-bottom-nav"]'),
    navLabels: [...document.querySelectorAll('[data-testid^="bottom-nav-"]')].map(e => e.getAttribute('data-testid')),
    ids: [...document.querySelectorAll('[data-testid]')].map(el => el.getAttribute('data-testid')),
  }));
  const p = await shot(label);
  console.log(`\n== [${label}] ${info.path} | "${info.head}" | ${info.txt.length} chars${info.overflow > 1 ? ` | H-OVERFLOW +${info.overflow}px` : ''}${info.boundary ? ' | ERROR BOUNDARY' : ''}${info.phoneShell ? '' : ' | !! NO PHONE SHELL'} | ${p}`);
  for (const b of [...new Set(bucket)]) console.log(`   ${b}`);
  bucket = [];
  if (text) console.log('--- TEXT ---\n' + (full ? info.txt : info.txt.slice(0, 2600)));
  if (ids) console.log('--- IDS --- ' + [...new Set(info.ids)].join(' '));
  return info;
}
async function go(route, label, opts = {}) {
  bucket = [];
  await page.goto(BASE + route).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  return report(label, opts);
}
// Warm a route: a client route's FIRST cold render can be nav-only (r262
// cold-first-load flake); a phone route needs 10s+ on its first visit.
async function warm(route, ms = 10000) {
  await page.goto(BASE + route).catch(() => {});
  await page.waitForTimeout(ms);
  bucket = [];
}
async function tap(selector, label, opts = {}) {
  bucket = [];
  const { timeout = 9000 } = opts;
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout });
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 6000 });
  } catch (e) {
    console.log(`\n!! [${label}] tap failed on ${selector}: ${String(e).slice(0, 200)}`);
    await shot(`${label}-tapfail`);
    return null;
  }
  return report(label, opts);
}
// THE SURFACE ASSERTION — throw, do not warn.
async function assertPhoneShell() {
  await warm('/', 12000);
  const info = await report('00-surface-check', {});
  if (!info.phoneShell) {
    console.error('\nFATAL: phone shell did NOT render — this is the DESKTOP surface. Aborting.');
    console.error(`  ua=${await page.evaluate(() => navigator.userAgent)}`);
    console.error(`  innerWidth=${await page.evaluate(() => window.innerWidth)} maxTouchPoints=${await page.evaluate(() => navigator.maxTouchPoints)}`);
    await browser.close();
    process.exit(9);
  }
  console.log(`   PHONE SHELL OK · nav = ${info.navLabels.join(', ')}`);
  return info;
}
export { page, ctx, go, tap, report, shot, warm, browser, BASE, user, assertPhoneShell };
