// r544 journey: Landsec client (Mark Warne) on a phone at 390px.
// Task framing: "I'm at Bluewater. An agent has just asked me about a unit —
// what's happening on it, what's the deal position, who at BGP is on it,
// then message BGP and clear my tasks."
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = process.env.QA_BASE || 'http://localhost:5000';
const USER = process.env.QA_USER || 'mark.warne@landsec.com';
const PASSWORD = 'B@nd0077!';
const TAG = process.env.QA_TAG || 'r544';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA,
});
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.abort();
});
const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
const user = await r.json();
if (!user.token) { console.error('login failed', JSON.stringify(user).slice(0, 300)); process.exit(2); }
const page = await ctx.newPage();

let bucket = [];
page.on('response', (res) => { if (res.status() >= 400) bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE, '')}`); });
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

let step = 0;
async function shot(label) {
  step++;
  const path = `qa/smoke-shots/${TAG}-${String(step).padStart(2, '0')}-${label.replace(/\W+/g, '-')}.png`;
  await page.screenshot({ path });
  return path;
}
async function report(label) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1800);
  const info = await page.evaluate(() => ({
    path: location.pathname + location.search,
    head: (document.querySelector('h1,h2')?.textContent || '').trim().slice(0, 90),
    chars: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    boundary: /Something went wrong|Application error|Unexpected error/i.test(document.body.innerText || ''),
    tiny: [...document.querySelectorAll('button,a[href]')].filter(el => {
      const rct = el.getBoundingClientRect();
      return rct.width > 0 && rct.height > 0 && rct.height < 30 && !/rounded-full/.test(el.className || '');
    }).length,
  }));
  const p = await shot(label);
  console.log(`\n== [${label}] ${info.path} | "${info.head}" | ${info.chars} chars${info.overflow > 1 ? ` | H-OVERFLOW +${info.overflow}px` : ''}${info.boundary ? ' | ERROR BOUNDARY' : ''} | ${p}`);
  for (const b of [...new Set(bucket)]) console.log(`   ${b}`);
  bucket = [];
  return info;
}
async function go(route, label) {
  bucket = [];
  await page.goto(BASE + route).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  return report(label);
}
async function tap(selector, label, { timeout = 8000 } = {}) {
  bucket = [];
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout });
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 5000 });
  } catch (e) {
    console.log(`\n!! [${label}] tap failed on ${selector}: ${String(e).slice(0, 160)}`);
    await shot(`${label}-tapfail`);
    return null;
  }
  return report(label);
}
export { page, go, tap, report, shot, browser, BASE };
