// r588 journey harness: BGP staff (Victoria) at her desk, 1440px.
// Task framing: "Bluewater have released another unit. Get it on the tracker,
// then tell the landlord where the property stands on availability."
// A real task with a WRITE in it, judged at every step as Victoria.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const BASE = process.env.QA_BASE || 'http://localhost:5000';
const USER = process.env.QA_USER || 'victoria@brucegillinghampollard.com';
const PASSWORD = 'B@nd0077!';
const TAG = process.env.QA_TAG || 'r588';
const ONLY = (process.env.QA_STEPS || '').split(',').filter(Boolean);

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.abort();
});
const CACHE = process.env.QA_TOKEN_CACHE || '/tmp/r588-token.json';
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
  if (/validateDOMNesting|Each child in a list/.test(t)) {
    const args = [];
    for (const a of msg.args()) { try { args.push(await a.jsonValue()); } catch { args.push('?'); } }
    bucket.push(`REACTWARN ${JSON.stringify(args).slice(0, 700)}`);
    return;
  }
  bucket.push(`CONSOLE[${msg.type()}] ${t.slice(0, 250)}`);
});

await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([tok, u]) => {
  localStorage.setItem('bgp_auth_token', tok);
  localStorage.setItem('authToken', tok);
  localStorage.setItem('user', JSON.stringify(u));
}, [user.token, user]);

let step = 0;
async function shot(label) {
  step++;
  const path = `qa/smoke-shots/${TAG}-${String(step).padStart(2, '0')}-${label.replace(/\W+/g, '-')}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}
async function report(label, { text = false, ids = false, full = false, slice = 2600 } = {}) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1800);
  const info = await page.evaluate(() => ({
    path: location.pathname + location.search,
    head: (document.querySelector('h1,h2')?.textContent || '').trim().slice(0, 90),
    txt: (document.body.innerText || '').replace(/\n{2,}/g, '\n').trim(),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    boundary: /Something went wrong|Application error|Unexpected error/i.test(document.body.innerText || ''),
    ids: [...document.querySelectorAll('[data-testid]')].map(el => el.getAttribute('data-testid')),
  }));
  const p = await shot(label);
  console.log(`\n== [${label}] ${info.path} | "${info.head}" | ${info.txt.length} chars${info.overflow > 1 ? ` | H-OVERFLOW +${info.overflow}px` : ''}${info.boundary ? ' | ERROR BOUNDARY' : ''} | ${p}`);
  for (const b of [...new Set(bucket)]) console.log(`   ${b}`);
  bucket = [];
  if (text) console.log('--- TEXT ---\n' + (full ? info.txt : info.txt.slice(0, slice)));
  if (ids) console.log('--- IDS --- ' + [...new Set(info.ids)].join(' '));
  return info;
}
async function go(route, label, opts) {
  bucket = [];
  await page.goto(BASE + route).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  return report(label, opts);
}
async function click(selector, label, opts = {}) {
  bucket = [];
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout: opts.timeout || 9000 });
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 6000 });
  } catch (e) {
    console.log(`\n!! [${label}] click failed on ${selector}: ${String(e).slice(0, 220)}`);
    await shot(`${label}-clickfail`);
    return null;
  }
  return report(label, opts);
}
const want = (n) => !ONLY.length || ONLY.includes(String(n));

// ── JOURNEY (r588) · Victoria, 1440px ─────────────────────────────────
// "Bluewater have released another unit. Get it on the tracker, then tell
//  the landlord where the property stands on availability."
const PROP = process.env.QA_PROP || 'cccccccc-0000-0000-0000-000000000001';

if (want(1)) await go('/', 'dashboard', { text: true, slice: 3000 });
if (want(2)) await go('/properties', 'properties-hub', { text: true, slice: 2200 });
if (want(3)) await go(`/properties/${PROP}`, 'property-bluewater', { text: true, slice: 4000 });
if (want(4)) await go('/available', 'letting-tracker', { text: true, ids: true, slice: 3000 });
if (want(5)) {
  await click('[data-testid="button-add-unit"]', 'add-unit-dialog', { ids: true, text: true, slice: 2200 });
}
await browser.close();
