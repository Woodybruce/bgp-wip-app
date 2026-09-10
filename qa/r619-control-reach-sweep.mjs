// Control-reach sweep (r619) — the durable form of r618's lesson.
//
// r618 found five of six CRM data-hygiene buttons sitting up to 710px off the
// right edge of a phone screen while `documentElement.scrollWidth` stayed
// exactly 390: an ancestor's `overflow-hidden` CLIPPED the row, so the
// page-level overflow sweep passed it for 617 rounds and a thumb could not
// reach the controls at all. The durable detector is a boundingBox on the
// CONTROLS, not the document.
//
// This walks the staff phone shell and measures every visible interactive
// control on each route, reporting any whose box falls outside the viewport.
//
// Usage:  node qa/r619-control-reach-sweep.mjs
// Server: dev server on http://localhost:5000 with the fixture DB.

import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = process.env.QA_BASE || 'http://localhost:5000';
const PASSWORD = 'B@nd0077!';
const USER = process.env.QA_USER || 'victoria@brucegillinghampollard.com';
const W = 390;

const ROUTES = (process.env.QA_ROUTES || [
  '/', '/deals', '/deals/list', '/deals/letting', '/brands', '/contacts',
  '/tasks', '/news', '/settings', '/aml-compliance', '/m/images', '/comps',
  '/available', '/companies', '/properties', '/diary', '/evidence-plans',
  '/kyc-clouseau', '/covenant-watch', '/lease-events', '/wip-report',
  '/pathway-review', '/investment-tracker', '/leasing-schedule',
].join(',')).split(',').filter(Boolean);

const QA_CHROMIUM = process.env.QA_CHROMIUM
  || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
const browser = await chromium.launch(
  QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] },
);
const ctx = await browser.newContext({
  viewport: { width: W, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  isMobile: true, hasTouch: true,
});
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.abort();
});

const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
const user = await r.json();
if (!user.token) { console.error(`[reach] login failed: ${JSON.stringify(user).slice(0, 160)}`); process.exit(2); }

const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([tok, u]) => {
  localStorage.setItem('authToken', tok);
  localStorage.setItem('bgp_auth_token', tok);
  localStorage.setItem('user', JSON.stringify(u));
}, [user.token, user]);

// The phone shell keys off the USER AGENT, not the viewport: a 390px desktop
// layout is a different, non-user-facing surface, and measuring it reports
// failures no fix can fix. Refuse to sweep if the shell did not render.
async function phoneShellRendered() {
  if (await page.locator('nav [data-testid^="mobile-"], [data-testid^="mobile-home-"]').count()) return true;
  return page.evaluate(() => !!document.querySelector('nav.fixed.bottom-0, nav[class*="fixed bottom"]'));
}

// Measure every visible interactive control. Report a control that is wholly
// or partly outside the viewport — a CLIPPED overflow leaves scrollWidth at
// 390, so only the control's own box tells the truth.
function measure(vw) {
  const SEL = 'button, a[href], [role="button"], [role="tab"], input, select, textarea, [data-testid^="button-"], [data-testid^="tab-"]';
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
    if (el.closest('[aria-hidden="true"], [hidden]')) continue;
    const rc = el.getBoundingClientRect();
    if (rc.width < 8 || rc.height < 8) continue;
    // Only controls that are laid out on the page, not ones parked off-canvas
    // by a closed drawer/sheet (those slide in when opened).
    if (el.closest('[data-state="closed"]')) continue;
    // A control inside a strip that actually SCROLLS horizontally is
    // reachable — the thumb drags the strip. Only a CLIPPED overflow (or one
    // the page cannot scroll to) puts a control out of reach.
    let scrollable = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ov = getComputedStyle(a).overflowX;
      if ((ov === 'auto' || ov === 'scroll') && a.scrollWidth > a.clientWidth + 1) { scrollable = true; break; }
    }
    if (scrollable) continue;
    if (rc.right > vw + 1 || rc.left < -1) {
      const id = el.getAttribute('data-testid') || '';
      const label = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      out.push({
        id: id || `<${el.tagName.toLowerCase()}>`,
        label,
        x: Math.round(rc.left), w: Math.round(rc.width), right: Math.round(rc.right),
        // How far a thumb would have to reach that it cannot.
        over: Math.round(Math.max(rc.right - vw, -rc.left)),
      });
    }
  }
  return out;
}

let bad = 0;
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    .catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.waitForLoadState('networkidle').catch(() => {});
  // A phone route's FIRST visit compiles its lazy chunk in the dev server.
  await page.waitForTimeout(6000);
  if (!(await phoneShellRendered())) {
    console.log(`  SKIP ${route} — phone shell did not render (would measure the desktop layout)`);
    continue;
  }
  // Scroll the whole page so lazily-mounted rows below the fold are laid out.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(600);
  const offs = await page.evaluate(measure, W);
  const landed = await page.evaluate(() => location.pathname);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  if (!offs.length) {
    console.log(`  ok   ${route}${landed !== route ? ` (landed ${landed})` : ''} — all controls inside ${W}px (scrollWidth ${sw})`);
  } else {
    bad++;
    const clipped = sw <= W ? ' [CLIPPED — invisible to a scrollWidth sweep]' : '';
    console.log(`  FAIL ${route}${landed !== route ? ` (landed ${landed})` : ''} — ${offs.length} control(s) out of reach${clipped}`);
    for (const o of offs.slice(0, 12)) {
      console.log(`         ${o.id} "${o.label}" x=${o.x} w=${o.w} right=${o.right} (${o.over}px out)`);
    }
    if (offs.length > 12) console.log(`         …and ${offs.length - 12} more`);
  }
}

await browser.close();
console.log(bad ? `[reach] ${bad}/${ROUTES.length} route(s) have controls out of thumb reach at ${W}px`
                : `[reach] all ${ROUTES.length} routes: every control reachable at ${W}px`);
process.exit(bad ? 1 : 0);
