// r548 journey — Victoria (BGP staff, desktop 1440px): "a new operator brief
// has landed by email: capture it as a leasing requirement, run its matches,
// brief a unit against it, then tidy up." Drives the create dialog, the row,
// the fits cell, the Match dialog and delete — submitting, not just loading.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = 'http://localhost:5000';
const USER = 'victoria@brucegillinghampollard.com';
const PASSWORD = 'B@nd0077!';
const TAG = 'r548j';
const REQ_NAME = 'QA-REQ r548 Blank Street Coffee';

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    return route.abort();
  });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  const user = await r.json();
  if (!user.token) { console.error('login failed'); process.exit(2); }
  const page = await ctx.newPage();
  let bucket = [];
  page.on('response', (res) => { if (res.status() >= 400) bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE, '')}`); });
  page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0, 250)}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) bucket.push(`CONSOLE ${msg.text().slice(0,220)}`); });
  const flush = (l) => { const s = [...new Set(bucket)]; bucket = []; if (s.length) console.log(`   [${l}] ` + s.join('\n   ')); else console.log(`   [${l}] clean`); };
  let step = 0;
  const shot = async (l) => { step++; const p = `qa/smoke-shots/${TAG}-${String(step).padStart(2,'0')}-${l}.png`; await page.screenshot({ path: p, fullPage: false }); console.log('   shot', p); };
  const hoverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('bgp_auth_token', tok); localStorage.setItem('authToken', tok);
    localStorage.setItem('user', JSON.stringify(u));
  }, [user.token, user]);

  // ---- 1. land on Requirements
  await page.goto(BASE + '/requirements', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  console.log('== title:', await page.locator('[data-testid="text-page-title"]').innerText().catch(() => 'MISSING'));
  console.log('== h-overflow:', await hoverflow());
  const rowsBefore = await page.locator('[data-testid^="row-leasing-"]').count();
  console.log('== leasing rows before:', rowsBefore);
  await shot('requirements');
  flush('load');

  // ---- 2. open the create dialog and fill it as Victoria would
  await page.locator('[data-testid="button-create-leasing"]').click();
  await page.waitForTimeout(1200);
  await shot('create-dialog');
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? d.innerText.replace(/\s+/g, ' ').slice(0, 900) : 'NO DIALOG';
  });
  console.log('== dialog:', dlg);

  await page.locator('[data-testid="input-leasing-name"]').fill(REQ_NAME);
  await page.locator('[data-testid="input-leasing-group"]').fill('QA Coffee Group');
  // toggles: use / type / size / location
  for (const sel of ['[data-testid^="toggle-use-"]', '[data-testid^="toggle-type-"]', '[data-testid^="toggle-size-"]', '[data-testid^="toggle-location-"]']) {
    const n = await page.locator(sel).count();
    if (n) { await page.locator(sel).first().click(); await page.waitForTimeout(150); }
    console.log('   toggles', sel, n);
  }
  await page.locator('[data-testid="input-leasing-comments"]').fill('QA r548 — emailed brief: 1,200-1,800 sq ft, prime pitch, wants Bluewater.');
  await shot('create-filled');
  flush('fill');

  await page.locator('[data-testid="button-submit-leasing"]').click();
  await page.waitForTimeout(3000);
  await page.waitForLoadState('networkidle').catch(() => {});
  await shot('after-submit');
  const dialogStillOpen = await page.locator('[role="dialog"]').count();
  console.log('== dialog still open after submit:', dialogStillOpen);
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('== new req visible on board:', bodyText.includes(REQ_NAME));
  console.log('== leasing rows after:', await page.locator('[data-testid^="row-leasing-"]').count());
  flush('submit');

  // ---- 3. find the new row, read its cells
  const rowInfo = await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('[data-testid^="row-leasing-"]')];
    const row = rows.find((tr) => tr.innerText.includes(name));
    if (!row) return null;
    return { id: row.getAttribute('data-testid').replace('row-leasing-', ''), text: row.innerText.replace(/\s+/g, ' ').slice(0, 500) };
  }, REQ_NAME);
  console.log('== new row:', JSON.stringify(rowInfo));
  if (!rowInfo) { console.log('!! new requirement row not found — stopping'); }
  else {
    const id = rowInfo.id;
    // fits cell
    const fits = await page.locator(`[data-testid="cell-fits-${id}"]`).innerText().catch(() => 'NO FITS CELL');
    console.log('== fits cell:', JSON.stringify(fits));
    // ---- 4. Match dialog
    const matchBtn = page.locator(`[data-testid="button-match-leasing-${id}"]`);
    if (await matchBtn.count()) {
      await matchBtn.click();
      await page.waitForTimeout(2500);
      await shot('match-dialog');
      const m = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        return d ? d.innerText.replace(/\s+/g, ' ').slice(0, 800) : 'NO DIALOG';
      });
      console.log('== match dialog:', m);
      console.log('== match units listed:', await page.locator('[data-testid^="match-unit-"]').count());
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    } else console.log('!! no match button on the new row');
    flush('match');

    // ---- 5. edit it (reopen, change status) then delete
    const editBtn = page.locator(`[data-testid="button-edit-leasing-${id}"]`);
    if (await editBtn.count()) {
      await editBtn.click();
      await page.waitForTimeout(1500);
      await shot('edit-dialog');
      const prefilled = await page.locator('[data-testid="input-leasing-name"]').inputValue().catch(() => 'NO INPUT');
      const groupPre = await page.locator('[data-testid="input-leasing-group"]').inputValue().catch(() => 'NO INPUT');
      const commentsPre = await page.locator('[data-testid="input-leasing-comments"]').inputValue().catch(() => 'NO INPUT');
      console.log('== edit prefilled name:', JSON.stringify(prefilled), 'group:', JSON.stringify(groupPre));
      console.log('== edit prefilled comments:', JSON.stringify(commentsPre));
      const toggleState = await page.evaluate(() => {
        const out = {};
        for (const pre of ['toggle-use-', 'toggle-type-', 'toggle-size-', 'toggle-location-']) {
          const on = [...document.querySelectorAll(`[data-testid^="${pre}"]`)].filter((b) => /bg-primary|border-primary/.test(b.className) || b.getAttribute('data-state') === 'on' || b.getAttribute('aria-pressed') === 'true');
          out[pre] = on.map((b) => b.innerText.trim());
        }
        return out;
      });
      console.log('== edit prefilled toggles:', JSON.stringify(toggleState));
      await page.locator('[data-testid="input-leasing-comments"]').fill('QA r548 — EDITED: now also wants Brent Cross.');
      await page.locator('[data-testid="button-submit-leasing"]').click();
      await page.waitForTimeout(2500);
      await shot('after-edit');
      const after = await page.evaluate((n) => {
        const rows = [...document.querySelectorAll('[data-testid^="row-leasing-"]')];
        const row = rows.find((tr) => tr.innerText.includes(n));
        return row ? row.innerText.replace(/\s+/g, ' ').slice(0, 400) : 'ROW GONE';
      }, REQ_NAME);
      console.log('== row after edit:', JSON.stringify(after));
      flush('edit');
    } else console.log('!! no edit button');
  }

  console.log('== final h-overflow:', await hoverflow());
  await shot('final');
  flush('end');
} finally {
  await browser.close();
}
