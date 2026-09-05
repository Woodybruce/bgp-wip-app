// r548 verification — the Fits cell and the "Matching Available Units" dialog
// must agree, and the edit dialog must come back with its chips selected.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = 'http://localhost:5000';
const USER = 'victoria@brucegillinghampollard.com';
const PASSWORD = 'B@nd0077!';
const TAG = 'r548v';

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
  const page = await ctx.newPage();
  let bucket = [];
  page.on('response', (res) => { if (res.status() >= 400) bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE, '')}`); });
  page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0, 200)}`));
  const flush = (l) => { const s = [...new Set(bucket)]; bucket = []; console.log(`   [${l}] ` + (s.length ? s.join('\n   ') : 'clean')); };
  let step = 0;
  const shot = async (l) => { step++; const p = `qa/smoke-shots/${TAG}-${String(step).padStart(2,'0')}-${l}.png`; await page.screenshot({ path: p }); console.log('   shot', p); };

  await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('bgp_auth_token', tok); localStorage.setItem('authToken', tok);
    localStorage.setItem('user', JSON.stringify(u));
  }, [user.token, user]);
  await page.goto(BASE + '/requirements', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3500);

  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="row-leasing-"]')].map((tr) => ({
    id: tr.getAttribute('data-testid').replace('row-leasing-', ''),
    name: tr.innerText.split('\n')[0],
  })));
  console.log('== rows:', JSON.stringify(rows));
  let fails = 0;
  for (const row of rows) {
    const fitsText = await page.locator(`[data-testid="cell-fits-${row.id}"]`).innerText().catch(() => '');
    const m = fitsText.match(/\+(\d+) more/);
    const listed = (fitsText.match(/^\S.*·/gm) || []).length;
    const cellCount = listed + (m ? Number(m[1]) : 0);
    const btn = page.locator(`[data-testid="button-match-leasing-${row.id}"]`);
    if (!(await btn.count())) { console.log(`   ${row.name}: no match button`); continue; }
    await btn.click();
    await page.waitForTimeout(2200);
    const dlgCount = await page.locator('[data-testid^="match-unit-"]').count();
    const dlgText = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return d ? d.innerText.replace(/\s+/g, ' ').slice(0, 400) : 'NO DIALOG';
    });
    const ok = cellCount === 0 ? dlgCount === 0 : dlgCount >= Math.min(cellCount, 1) && dlgCount === cellCount;
    console.log(`== ${row.name}: fits cell ${cellCount} | dialog ${dlgCount} -> ${ok ? 'AGREE' : 'MISMATCH'}`);
    console.log(`   dialog: ${dlgText}`);
    if (!ok) fails++;
    await shot(`match-${row.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 24)}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }
  flush('matches');

  // edit dialog chips prefilled? (selected chips carry text-white)
  const target = rows.find((r) => r.name.includes('QA-REQ r548')) || rows[0];
  if (target) {
    await page.locator(`[data-testid="button-edit-leasing-${target.id}"]`).click();
    await page.waitForTimeout(1500);
    const on = await page.evaluate(() => {
      const out = {};
      for (const pre of ['toggle-use-', 'toggle-type-', 'toggle-size-', 'toggle-location-']) {
        out[pre] = [...document.querySelectorAll(`[data-testid^="${pre}"]`)].filter((b) => /text-white/.test(b.className)).map((b) => b.innerText.trim());
      }
      return out;
    });
    console.log('== edit chips selected:', JSON.stringify(on));
    await shot('edit-chips');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
  flush('edit');
  console.log(fails ? `!! ${fails} mismatch(es)` : '== ALL AGREE');
} finally {
  await browser.close();
}
