// r543 under-visited surface sweep (staff desktop 1440px, Victoria).
// Loads each surface, waits for it to settle, records 4xx/5xx, pageerrors,
// React warnings (incl. DOM nesting) and a screenshot.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = process.env.QA_BASE || 'http://localhost:5000';
const PASSWORD = 'B@nd0077!';
const USER = process.env.QA_USER || 'victoria@brucegillinghampollard.com';
const ROUTES = (process.env.QA_ROUTES || '/kyc-clouseau,/covenant-watch,/lease-events,/wip-report,/board-report,/evidence-plans,/image-studio,/marketing-files,/pathway-review,/my-expenses,/team-expenses').split(',');
const TAG = process.env.QA_TAG || 'r543';

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.abort();
});
const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
const user = await r.json();
if (!user.token) { console.error('login failed', JSON.stringify(user).slice(0, 200)); process.exit(2); }
const page = await ctx.newPage();

let bucket = [];
page.on('response', (res) => { if (res.status() >= 400) bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE, '')}`); });
page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0, 200)}`));
page.on('console', async (msg) => {
  if (msg.type() !== 'error' && msg.type() !== 'warning') return;
  const t = msg.text();
  if (/Failed to load resource/.test(t)) return;
  if (/validateDOMNesting/.test(t)) {
    const args = [];
    for (const a of msg.args()) { try { args.push(await a.jsonValue()); } catch { args.push('?'); } }
    bucket.push(`DOMNEST ${JSON.stringify(args).slice(0, 900)}`);
    return;
  }
  bucket.push(`CONSOLE[${msg.type()}] ${t.slice(0, 300)}`);
});

await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([tok, u]) => { localStorage.setItem("bgp_auth_token", tok); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);

let i = 0;
for (const route of ROUTES) {
  i++;
  bucket = [];
  await page.goto(BASE + route).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => ({
    path: location.pathname,
    h1: (document.querySelector('h1,h2')?.textContent || '').trim().slice(0, 80),
    text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    boundary: /Something went wrong|Application error|error boundary/i.test(document.body.innerText || ''),
    buttons: document.querySelectorAll('button').length,
    rows: document.querySelectorAll('tbody tr').length,
    empty: /No .* (yet|found)|Nothing here|no results/i.test(document.body.innerText || ''),
  }));
  const shot = `qa/smoke-shots/${TAG}-${String(i).padStart(2, '0')}-${route.replace(/\W+/g, '-').replace(/^-/, '')}.png`;
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`\n== ${route} -> ${info.path} | "${info.h1}" | ${info.text} chars | ${info.buttons} btns | ${info.rows} rows${info.overflow ? ' | H-OVERFLOW' : ''}${info.boundary ? ' | ERROR BOUNDARY' : ''}`);
  for (const b of [...new Set(bucket)]) console.log(`   ${b}`);
}
await browser.close();
