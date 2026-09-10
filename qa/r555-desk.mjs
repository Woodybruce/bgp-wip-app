// r555 desktop harness (staff, 1440px) — reusable base for the fee-chain probe.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = process.env.QA_BASE || 'http://localhost:5000';
const USER = process.env.QA_USER || 'victoria@brucegillinghampollard.com';
const TAG = process.env.QA_TAG || 'r555';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.abort();
});
const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: 'B@nd0077!' } });
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
    bucket.push(`REACTWARN ${JSON.stringify(args).slice(0, 900)}`); return;
  }
  bucket.push(`CONSOLE[${msg.type()}] ${t.slice(0, 250)}`);
});
await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([tok, u]) => {
  localStorage.setItem('bgp_auth_token', tok); localStorage.setItem('authToken', tok);
  localStorage.setItem('user', JSON.stringify(u));
}, [user.token, user]);
let step = 0;
async function shot(label) {
  step++;
  const path = `qa/smoke-shots/${TAG}-${String(step).padStart(2, '0')}-${label.replace(/\W+/g, '-')}.png`;
  await page.screenshot({ path, fullPage: true });
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
  }));
  const p = await shot(label);
  console.log(`\n== [${label}] ${info.path} | "${info.head}" | ${info.chars} chars${info.overflow > 1 ? ` | H-OVERFLOW +${info.overflow}px` : ''}${info.boundary ? ' | ERROR BOUNDARY' : ''} | ${p}`);
  for (const b of [...new Set(bucket)]) console.log(`   ${b}`);
  bucket = [];
  return info;
}
async function go(route, label) {
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded' }).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  return report(label || route);
}
export { page, ctx, browser, go, report, shot, BASE, user };
