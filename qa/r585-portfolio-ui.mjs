// r585 — visual check of the My Portfolio dashboard widget after the
// /api/dashboard/my-portfolio 500 fix (c.job_title -> c.role AS job_title)
// and the dead-deal predicate fix (NOT IN ('Dead','Draft') -> NOT IN ('WIT')).
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5000';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const api = ctx.request;
const lr = await api.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await lr.json();
if (!user.token) { console.error('login failed', JSON.stringify(user).slice(0, 300)); process.exit(2); }
const page = await ctx.newPage();
const errs = [];
page.on('response', (r) => { if (r.status() >= 500 && r.url().includes('/api/')) errs.push(`${r.status()} ${r.url().replace(BASE,'')}`); });

await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([tok, u]) => {
  localStorage.setItem('bgp_auth_token', tok);
  localStorage.setItem('authToken', tok);
  localStorage.setItem('user', JSON.stringify(u));
}, [user.token, user]);
// Enable the My Portfolio widget for this user — it is not on the default layout.
const cur = await (await api.get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${user.token}` } })).json();
const original = cur.dashboardWidgets || null;
console.log('original widgets:', JSON.stringify(original));
const widgets = [...new Set([...(original || []), 'my-portfolio'])];
await api.patch(`${BASE}/api/auth/me/dashboard-widgets`, { headers: { Authorization: `Bearer ${user.token}` }, data: { widgets } });
console.log('widgets now:', widgets.join(','));
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' }).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.waitForTimeout(9000);
const ids = await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).filter(t => /portfolio|widget/i.test(t)));
console.log('portfolio/widget testids on page:', ids.slice(0, 25).join(', ') || '(none)');

const title = page.locator('[data-testid="text-my-portfolio-title"]');
const present = await title.count();
console.log('My Portfolio widget on dashboard:', present ? 'PRESENT' : 'not on this layout');
if (present) {
  await title.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const card = title.locator('xpath=ancestor::*[self::div][3]');
  const text = (await card.innerText().catch(() => '')) || (await page.locator('body').innerText());
  console.log('--- widget text ---');
  console.log(text.slice(0, 900));
  console.log('-------------------');
  console.log("contains Gail's (live SOL, control):", /Gail/i.test(text));
  console.log('contains MSU9 (withdrawn, must be absent):', /MSU9/i.test(text));
  await page.screenshot({ path: 'qa/smoke-shots/r585-my-portfolio.png' });
} else {
  await page.screenshot({ path: 'qa/smoke-shots/r585-dashboard.png', fullPage: true });
}
console.log('5xx api responses:', errs.length ? errs.join(', ') : 'none');
// put the user's widget list back exactly as it was
await api.patch(`${BASE}/api/auth/me/dashboard-widgets`, { headers: { Authorization: `Bearer ${user.token}` }, data: { widgets: original } });
console.log('widgets restored to:', JSON.stringify(original));
await b.close();
