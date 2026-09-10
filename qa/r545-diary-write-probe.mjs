// r545 — the diary write path as Victoria uses it: put a meeting in the
// calendar from the Add-event dialog, find it in the grid, open it, delete it.
// Also grabs the deal AML panel (evidence for the KYC-portal note).
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = 'http://localhost:5000';
const PASSWORD = 'B@nd0077!';
const STAFF = 'victoria@brucegillinghampollard.com';
const SHOTS = new URL('./smoke-shots/', import.meta.url).pathname;
const DEAL = process.env.QA_DEAL || '11110000-0000-0000-0000-000000000302';

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.abort();
});
const user = await (await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: STAFF, password: PASSWORD } })).json();
if (!user.token) { console.error('login failed'); process.exit(2); }
const page = await ctx.newPage();
let bucket = [];
page.on('response', (r) => { if (r.status() >= 400) bucket.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0, 200)}`));
page.on('console', async (msg) => {
  if (msg.type() !== 'error' && msg.type() !== 'warning') return;
  const t = msg.text();
  if (/Failed to load resource/.test(t)) return;
  bucket.push(`CONSOLE[${msg.type()}] ${t.slice(0, 240)}`);
});
const visit = async (p) => { await page.goto(BASE + p).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; }); await page.waitForLoadState('networkidle').catch(() => {}); };

await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([t, u]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);

// ── A. Diary write path ────────────────────────────────────────────────────
await visit('/calendar');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}r545-calendar-before.png` });
console.log('CAL-LANDING', JSON.stringify(await page.evaluate(() => ({
  view: (document.querySelector('[data-testid="calendar-page"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 220),
  addBtn: !!document.querySelector('[data-testid="button-add-event"]'),
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
}))));

const d = new Date(); d.setDate(d.getDate() + 1);
const iso = d.toISOString().slice(0, 10);
const TITLE = `QA-CAL-R545 Bluewater rent review`;
await page.locator('[data-testid="button-add-event"]').click();
await page.waitForTimeout(700);
await page.locator('[data-testid="add-event-title"]').fill(TITLE);
await page.locator('[data-testid="add-event-date"]').fill(iso);
await page.locator('[data-testid="add-event-start"]').fill('10:00');
await page.locator('[data-testid="add-event-end"]').fill('11:00');
await page.locator('[data-testid="add-event-location"]').fill('Bluewater management suite');
await page.locator('[data-testid="add-event-notes"]').fill('QA r545 diary write path');
await page.screenshot({ path: `${SHOTS}r545-calendar-dialog.png` });
await page.locator('[data-testid="add-event-save"]').click();
await page.waitForTimeout(3000);
console.log('AFTER-SAVE', JSON.stringify(await page.evaluate((t) => ({
  dialogOpen: !!document.querySelector('[data-testid="add-event-dialog"]'),
  onScreen: (document.body.innerText || '').includes(t),
  toast: (document.body.innerText.match(/(saved|added|created|failed|error)[^\n]{0,60}/i) || [''])[0],
}), TITLE)));

// The user's next move: is it on the day I put it on?
await page.locator('[data-testid="button-next-day"]').click();
await page.waitForTimeout(2500);
const found = await page.evaluate((t) => {
  const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && (e.textContent || '').includes(t));
  return { visible: !!el, dayText: (document.querySelector('[data-testid="calendar-page"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200) };
}, TITLE);
console.log('NEXT-DAY', JSON.stringify(found));
await page.screenshot({ path: `${SHOTS}r545-calendar-after-save.png` });

// Open it and check the detail panel carries what was typed.
if (found.visible) {
  await page.locator(`text=${TITLE}`).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  console.log('EVENT-DETAIL', JSON.stringify(await page.evaluate(() => ({
    text: (document.body.innerText.match(/QA-CAL-R545[\s\S]{0,320}/) || [''])[0].replace(/\s+/g, ' '),
  }))));
  await page.screenshot({ path: `${SHOTS}r545-calendar-event-detail.png` });
}

console.log('CAL 4xx/5xx/console:', bucket.length ? bucket.join(' | ') : 'none');
bucket = [];

// ── B. Staff view of the KYC portal arrival ────────────────────────────────
await visit(`/deals/${DEAL}`);
await page.waitForTimeout(3500);
const aml = await page.evaluate(() => {
  const t = document.body.innerText || '';
  const i = t.indexOf('Client upload links');
  return { hasPanel: i >= 0, panel: i >= 0 ? t.slice(i, i + 400).replace(/\s+/g, ' ') : '', mentionsFile: /qa-r545-proof-of-address/.test(t) };
});
console.log('AML-PANEL', JSON.stringify(aml, null, 1));
await page.screenshot({ path: `${SHOTS}r545-deal-aml-panel.png`, fullPage: true });
console.log('DEAL 4xx/5xx/console:', bucket.length ? bucket.join(' | ') : 'none');

// Cleanup: drop the QA event through the same API the UI uses.
const evs = await (await ctx.request.get(`${BASE}/api/team-events`, { headers: { Authorization: `Bearer ${user.token}` } })).json();
const mine = (Array.isArray(evs) ? evs : []).filter(e => (e.title || '').startsWith('QA-CAL-R545'));
for (const e of mine) {
  const r = await ctx.request.delete(`${BASE}/api/team-events/${e.id}`, { headers: { Authorization: `Bearer ${user.token}` } });
  console.log('CLEANUP delete', e.id, r.status());
}
await browser.close();
