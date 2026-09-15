// Phone horizontal-overflow sweep — app-wide consistency check (r442).
//
// Logs in as staff, opens the phone shell at iPhone 13 size (390×844,
// iPhone UA + touch — the shell keys off the user agent, not just the
// viewport), SPA-navigates through the core routes and asserts
// document.documentElement.scrollWidth <= window.innerWidth on each.
// On failure it reports the widest element extending past the right edge.
//
// Usage:  node qa/phone-overflow-sweep.mjs
// Server: expects the dev server on http://localhost:5000 with a fixture DB.
// Exits non-zero when any route overflows.

import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = process.env.QA_BASE || 'http://localhost:5000';
const PASSWORD = 'B@nd0077!';
const STAFF_USER = 'victoria@brucegillinghampollard.com';

const ROUTES = [
  '/',
  '/deals',
  '/deals/list',
  '/deals/letting',
  '/deals/investment',
  '/deals/properties',
  '/brands',
  '/contacts',
  '/news',
  '/tasks',
  '/wip-report',
];

const QA_CHROMIUM = process.env.QA_CHROMIUM
  || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
const browser = await chromium.launch(
  QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] },
);

const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  isMobile: true, hasTouch: true,
});
// No external network in the QA container — abort non-local requests so
// networkidle reflects the app alone (same guard as two-bot-round.mjs).
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.abort();
});

// Bearer login + localStorage seed (the harness pattern — the login form
// itself is covered by smoke).
const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: STAFF_USER, password: PASSWORD } });
const user = await r.json();
if (!user.token) {
  console.error(`[overflow-sweep] login failed for ${STAFF_USER}: ${JSON.stringify(user).slice(0, 120)}`);
  process.exit(2);
}
const page = await ctx.newPage();
await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([tok, u]) => {
  localStorage.setItem('authToken', tok);
  localStorage.setItem('user', JSON.stringify(u));
}, [user.token, user]);
await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1500);

// SPA navigation: wouter patches history.pushState, so calling it from the
// page context routes client-side without a full reload.
async function spaNavigate(path) {
  await page.evaluate((p) => history.pushState({}, '', p), path);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
  const here = await page.evaluate(() => location.pathname);
  if (here !== path) {
    // Route redirected on mount (hub routes) or pushState didn't take —
    // fall back to a full navigation so the check still runs somewhere real.
    await page.goto(`${BASE}${path}`).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1200);
  }
  return page.evaluate(() => location.pathname);
}

function widestOffender() {
  const iw = window.innerWidth;
  let worst = null;
  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect();
    if (rect.right > iw + 1 && rect.width > 0) {
      if (!worst || rect.right > worst.right) {
        const cls = (typeof el.className === 'string' ? el.className : '')
          .trim().split(/\s+/).slice(0, 4).join('.');
        worst = {
          right: rect.right,
          desc: `<${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}> width=${Math.round(rect.width)} right=${Math.round(rect.right)}`,
        };
      }
    }
  }
  return worst ? worst.desc : '(no single element past the right edge — root-level overflow)';
}

let failures = 0;
for (const route of ROUTES) {
  const landed = await spaNavigate(route);
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }));
  if (m.sw <= m.iw) {
    console.log(`  ok   ${route}${landed !== route ? ` (landed ${landed})` : ''} — scrollWidth ${m.sw} <= ${m.iw}`);
  } else {
    failures++;
    const offender = await page.evaluate(widestOffender);
    console.log(`  FAIL ${route}${landed !== route ? ` (landed ${landed})` : ''} — scrollWidth ${m.sw} > ${m.iw}; widest: ${offender}`);
  }
}

await browser.close();
console.log(failures
  ? `[overflow-sweep] ${failures}/${ROUTES.length} route(s) overflow at 390px`
  : `[overflow-sweep] all ${ROUTES.length} routes fit at 390px`);
process.exit(failures ? 1 : 0);
