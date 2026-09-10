// r592 journey harness: Landsec client (Mark Warne) on a phone at 390px.
// Task framing: "A fitness operator stopped me in the mall at Bluewater and
// asked what space I have. On my phone, before I forget: who are they, are
// they on my list, add them if not, are they good for the covenant, and
// which of my units would I put them in."
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const BASE = process.env.QA_BASE || 'http://localhost:5000';
const USER = process.env.QA_USER || 'mark.warne@landsec.com';
const PASSWORD = 'B@nd0077!';
const TAG = process.env.QA_TAG || 'r592';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA,
});
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.abort();
});
const CACHE = process.env.QA_TOKEN_CACHE || '/tmp/r592-token.json';
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
const NOISE = /rocketreach|ai-briefing|ai-take|brand-gaps|commentary|sharepoint\/root|microsoft\/|brand-theme|favicon|\/photo|covenant\/|os\/sites|s2\/favicons/;
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
    bucket.push(`REACTWARN ${JSON.stringify(args).slice(0, 900)}`);
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

let step = Number(process.env.QA_STEP_BASE || 0);
async function shot(label) {
  step++;
  const path = `qa/smoke-shots/${TAG}-${String(step).padStart(2, '0')}-${label.replace(/\W+/g, '-')}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}
async function report(label, { text = false, ids = false, full = false, tapTargets = false } = {}) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1600);
  const info = await page.evaluate(() => ({
    path: location.pathname + location.search,
    head: (document.querySelector('h1,h2')?.textContent || '').trim().slice(0, 90),
    txt: (document.body.innerText || '').replace(/\n{2,}/g, '\n').trim(),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    boundary: /Something went wrong|Application error|Unexpected error/i.test(document.body.innerText || ''),
    ids: [...document.querySelectorAll('[data-testid]')].map(el => el.getAttribute('data-testid')),
    wide: [...document.querySelectorAll('*')].filter(el => el.scrollWidth > window.innerWidth + 2 && el.clientWidth > 100)
      .slice(0, 6).map(el => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').slice(0,3).join('.')} sw=${el.scrollWidth}`),
  }));
  const p = await shot(label);
  console.log(`\n== [${label}] ${info.path} | "${info.head}" | ${info.txt.length} chars${info.overflow > 1 ? ` | H-OVERFLOW +${info.overflow}px` : ''}${info.boundary ? ' | ERROR BOUNDARY' : ''} | ${p}`);
  if (info.wide.length) console.log('   WIDE: ' + info.wide.join(' | '));
  for (const b of [...new Set(bucket)]) console.log(`   ${b}`);
  bucket = [];
  if (text) console.log('--- TEXT ---\n' + (full ? info.txt : info.txt.slice(0, 2600)));
  if (ids) console.log('--- IDS --- ' + [...new Set(info.ids)].join(' '));
  if (tapTargets) {
    const small = await page.evaluate(() => [...document.querySelectorAll('button,a[href],[role="button"],[role="tab"]')]
      .map(el => { const r = el.getBoundingClientRect(); return { t: (el.textContent||'').trim().slice(0,30), w: Math.round(r.width), h: Math.round(r.height), round: /rounded-full/.test(el.className||''), vis: r.width>0&&r.height>0 }; })
      .filter(x => x.vis && x.h > 0 && x.h < 44 && !x.round).slice(0, 12));
    if (small.length) console.log('--- SUB-44px (non-pill) --- ' + JSON.stringify(small));
  }
  return info;
}
async function go(route, label, opts) {
  bucket = [];
  await page.goto(BASE + route).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  return report(label, opts);
}
async function tap(selector, label, opts = {}) {
  bucket = [];
  const { timeout = 8000 } = opts;
  try {
    const el = typeof selector === 'string' ? page.locator(selector).first() : selector;
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
export { page, ctx, browser, go, tap, report, shot, BASE, user };

if (process.env.QA_MAIN !== '0') {
  // STEP 1 — phone home. Is there any route to a brand from here?
  await go('/', 'phone-home', { text: true, ids: true });
  // STEP 2 — /brands on the phone as a client login.
  await go('/brands', 'brands-phone', { text: true, ids: true, tapTargets: true });
  await browser.close();
}
