// r548 post-rebuild visual confirm: Fits cell vs Match dialog, and the
// quoting rent labelled p.a. (not psf).
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = 'http://localhost:5000';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
  const user = await r.json();
  const H = { Authorization: 'Bearer ' + user.token, 'Content-Type': 'application/json' };
  const mk = await fetch(`${BASE}/api/crm/requirements-leasing`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'QA-REQ r548 visual', status: 'Active', use: ['Retail'], size: ['Under 500 sq ft'] }) });
  const req = await mk.json();
  const page = await ctx.newPage();
  try {
    await page.goto(BASE).catch(() => {});
    await page.evaluate(([t, u]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);
    await page.goto(BASE + '/requirements', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
    const cell = await page.locator(`[data-testid="cell-fits-${req.id}"]`).innerText().catch(() => 'NO CELL');
    console.log('== fits cell:', JSON.stringify(cell));
    await page.screenshot({ path: 'qa/smoke-shots/r548v2-01-board.png' });
    await page.locator(`[data-testid="button-match-leasing-${req.id}"]`).click();
    await page.waitForTimeout(2200);
    const txt = await page.evaluate(() => (document.querySelector('[role="dialog"]') || {}).innerText || 'NO DIALOG');
    console.log('== dialog rows:', await page.locator('[data-testid^="match-unit-"]').count());
    console.log('== dialog text:', txt.replace(/\s+/g, ' ').slice(0, 460));
    console.log('== says psf:', /psf/.test(txt), '| says p.a.:', /p\.a\./.test(txt));
    await page.screenshot({ path: 'qa/smoke-shots/r548v2-02-match-dialog.png' });
    console.log('   shot qa/smoke-shots/r548v2-02-match-dialog.png');
  } finally {
    await fetch(`${BASE}/api/crm/requirements-leasing/${req.id}`, { method: 'DELETE', headers: { Authorization: H.Authorization } });
  }
} finally { await browser.close(); }
