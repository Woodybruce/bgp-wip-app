// r584b journey harness: Landsec client (Mark Warne) on a phone at 390px.
// Task framing: "Board pack week. On the train: what's my vacancy and income
// position, does the number on my phone match the list behind it, what's the
// covenant on my biggest tenant, and what documents has BGP given me."
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const BASE = process.env.QA_BASE || 'http://localhost:5000';
const USER = process.env.QA_USER || 'mark.warne@landsec.com';
const PASSWORD = 'B@nd0077!';
const TAG = process.env.QA_TAG || 'r584b';
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
// Token cache — the login rate limiter 429s after a handful of script runs
// (listed environment noise), so reuse the session across steps of a journey.
const CACHE = process.env.QA_TOKEN_CACHE || '/tmp/r584b-token.json';
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
const NOISE = /rocketreach|ai-briefing|ai-take|brand-gaps|commentary|sharepoint\/root|microsoft\/|brand-theme|favicon|\/photo|covenant\/|os\/sites/;
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

let step = 0;
async function shot(label) {
  step++;
  const path = `qa/smoke-shots/${TAG}-${String(step).padStart(2, '0')}-${label.replace(/\W+/g, '-')}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}
async function report(label, { text = false, ids = false, full = false } = {}) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1600);
  const info = await page.evaluate(() => ({
    path: location.pathname + location.search,
    head: (document.querySelector('h1,h2')?.textContent || '').trim().slice(0, 90),
    txt: (document.body.innerText || '').replace(/\n{2,}/g, '\n').trim(),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    boundary: /Something went wrong|Application error|Unexpected error/i.test(document.body.innerText || ''),
    ids: [...document.querySelectorAll('[data-testid]')].map(el => el.getAttribute('testid') || el.getAttribute('data-testid')),
  }));
  const p = await shot(label);
  console.log(`\n== [${label}] ${info.path} | "${info.head}" | ${info.txt.length} chars${info.overflow > 1 ? ` | H-OVERFLOW +${info.overflow}px` : ''}${info.boundary ? ' | ERROR BOUNDARY' : ''} | ${p}`);
  for (const b of [...new Set(bucket)]) console.log(`   ${b}`);
  bucket = [];
  if (text) console.log('--- TEXT ---\n' + (full ? info.txt : info.txt.slice(0, 2600)));
  if (ids) console.log('--- IDS --- ' + [...new Set(info.ids)].join(' '));
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
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout });
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 5000 });
  } catch (e) {
    console.log(`\n!! [${label}] tap failed on ${selector}: ${String(e).slice(0, 200)}`);
    await shot(`${label}-tapfail`);
    return null;
  }
  return report(label, opts);
}

// Mark, on the train: put a note in for BGP before he forgets it.
// Types into EVERY field the dialog offers, saves, RELOADS, and re-reads.
const TITLE = 'R584 chase BGP on MSU9 offer';
const DESC = 'Landsec board pack needs the MSU9 offer terms by Friday.';

await go('/tasks', 'tasks-before', {});
await tap('[data-testid="button-new-task"]', 'dialog-open', { ids: true });
const dlg = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText || '').slice(0, 900));
console.log('--- DIALOG ---\n' + dlg);

await page.fill('[data-testid="input-task-title"]', TITLE);
await page.fill('[data-testid="input-task-description"]', DESC);
// priority -> Urgent
await page.click('[data-testid="select-task-priority"]');
await page.waitForTimeout(400);
await page.click('text=🔥 Urgent').catch(() => console.log('!! priority option not clickable'));
await page.waitForTimeout(300);
// category -> first non-none
await page.click('[data-testid="select-task-category"]');
await page.waitForTimeout(400);
const cats = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map(e => e.textContent.trim()));
console.log('CATEGORY OPTIONS: ' + JSON.stringify(cats));
if (cats.length > 1) await page.click(`[role="option"]:has-text("${cats[1]}")`).catch(() => {});
await page.waitForTimeout(300);
await page.fill('[data-testid="input-task-due-date"]', '2026-09-11T17:00').catch(e => console.log('!! due date fill: ' + String(e).slice(0,120)));
await shot('dialog-filled');
const filled = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText || '').slice(0, 900));
console.log('--- DIALOG FILLED ---\n' + filled);

// find the save button
const btns = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map(b => `${b.getAttribute('data-testid')||''}|${b.textContent.trim().slice(0,30)}`));
console.log('DIALOG BUTTONS: ' + JSON.stringify(btns));
await page.click('[role="dialog"] button:has-text("Save")').catch(async () => {
  await page.click('[role="dialog"] button:has-text("Create")').catch(() => console.log('!! no save/create button'));
});
await page.waitForTimeout(2500);
await report('after-save', { text: true });

// RELOAD — persistence check
await go('/tasks', 'tasks-after-reload', { text: true });
const persisted = await page.evaluate((t) => document.body.innerText.includes(t), TITLE);
console.log(`\nPERSISTED AFTER RELOAD: ${persisted}`);

// re-open the row's edit dialog and diff every field against what was typed
const rowId = await page.evaluate((t) => {
  const rows = [...document.querySelectorAll('[data-testid^="task-row-"]')];
  const hit = rows.find(r => r.innerText.includes(t));
  return hit ? hit.getAttribute('data-testid').replace('task-row-', '') : null;
}, TITLE);
console.log('ROW ID: ' + rowId);
if (rowId) {
  await tap(`[data-testid="task-edit-${rowId}"]`, 'reopen-edit', {});
  const vals = await page.evaluate(() => ({
    title: document.querySelector('[data-testid="input-task-title"]')?.value,
    desc: document.querySelector('[data-testid="input-task-description"]')?.value,
    prio: document.querySelector('[data-testid="select-task-priority"]')?.innerText,
    cat: document.querySelector('[data-testid="select-task-category"]')?.innerText,
    due: document.querySelector('[data-testid="input-task-due-date"]')?.value,
  }));
  console.log('--- REOPENED VALUES ---\n' + JSON.stringify(vals, null, 1));
  await shot('reopened');
}
// raw row from the API
const api = await ctx.request.get(`${BASE}/api/tasks`, { headers: { Authorization: `Bearer ${user.token}` } });
const list = await api.json();
const mine = (Array.isArray(list) ? list : list.tasks || []).filter(t => (t.title || '').includes('R584'));
console.log('--- API ROW ---\n' + JSON.stringify(mine, null, 1).slice(0, 1200));
await browser.close();
