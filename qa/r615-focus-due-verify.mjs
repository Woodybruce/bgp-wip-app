// r615: prove the property asset brief's "This week's focus" card labels a
// task due TODAY as "today", not "1d overdue". Seeds the task, screenshots
// the card, prints the rendered row, cleans up. Token-cached so re-runs
// (fixed vs deliberately re-broken) don't trip the login rate limiter.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const BASE = 'http://localhost:5000';
const TAG = process.env.QA_TAG || 'r615';
const CACHE = '/tmp/r615-token.json';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

let user = null;
if (existsSync(CACHE)) {
  try {
    const c = JSON.parse(readFileSync(CACHE, 'utf8'));
    if ((await ctx.request.get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${c.token}` } })).ok()) user = c;
  } catch {}
}
if (!user) {
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
  user = await r.json();
  if (!user.token) { console.error('login failed', JSON.stringify(user).slice(0, 300)); process.exit(2); }
  writeFileSync(CACHE, JSON.stringify(user));
}
const auth = { Authorization: `Bearer ${user.token}` };

const props = await (await ctx.request.get(`${BASE}/api/crm/properties`, { headers: auth })).json();
const prop = (Array.isArray(props) ? props : props.data)[0];
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const made = await (await ctx.request.post(`${BASE}/api/tasks`, {
  headers: { ...auth, 'Content-Type': 'application/json' },
  data: { title: `QA r615 focus due TODAY`, dueDate: today, linkedPropertyId: prop.id },
})).json();
console.log(`seeded task ${made.id} due ${today} on "${prop.name}" (${prop.id})`);

const page = await ctx.newPage();
await page.goto(BASE).catch(() => {});
await page.evaluate(([t, u]) => {
  localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t);
  localStorage.setItem('user', JSON.stringify(u));
}, [user.token, user]);
await page.goto(`${BASE}/properties/${prop.id}`).catch(() => {});
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(3000);

const box = page.locator(`[data-testid="task-complete-${made.id}"]`).first();
const found = await box.count();
let row = '';
if (found) {
  row = (await box.locator('xpath=ancestor::div[1]').innerText().catch(() => '')) || '';
  await box.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `qa/smoke-shots/${TAG}-focus-due.png` });
}
console.log(`RENDERED ROW: ${JSON.stringify(row.replace(/\s+/g, ' ').trim())}`);
console.log(found ? (/overdue/i.test(row) ? 'VERDICT: OVERDUE (bug present)' : /today/i.test(row) ? 'VERDICT: today (correct)' : 'VERDICT: no due label') : 'VERDICT: task row not rendered');

await ctx.request.delete(`${BASE}/api/tasks/${made.id}`, { headers: auth });
await browser.close();
