// r605 — prove UX #304 in the browser. Seeds ONE investment_tracker row with
// a status legacyToCode cannot read ("On Hold" — the very value ChatBGP's own
// tool schema used to advertise), then checks the Reporting pill: pre-fix it
// COUNTED the row and clicking it HID the row; post-fix the pill that counts
// it shows it. Restores the row's status afterwards.
import { chromium } from '../node_modules/playwright/index.mjs';
import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5000';
const pool = new Pool({ connectionString: process.env.DATABASE_URL
  || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'ok ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

let victim = null;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' },
  });
  const token = (await res.json()).token;
  await page.addInitScript((t) => { try { localStorage.setItem('auth_token', t); } catch {} }, token);
  await page.goto(`${BASE}/investment-tracker`).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  // Rows inside a COLLAPSED portfolio group are not in the DOM at all, so the
  // victim has to be one the board is really showing — otherwise the probe
  // proves nothing either way.
  const rowTexts0 = await page.evaluate(() => [...document.querySelectorAll('tbody tr')]
    .map((r) => (r.innerText || '').replace(/\s+/g, ' ').trim())
    .filter((t) => t && !/^No assets match/.test(t)));
  console.log(`     unfiltered board renders ${rowTexts0.length} row(s)`);
  const { rows: candidates } = await pool.query(
    `SELECT id, asset_name, status FROM investment_tracker WHERE board_type = 'Purchases'`);
  victim = candidates.find((c) => rowTexts0.some((t) => t.includes(c.asset_name)));
  if (!victim) { console.log('no rendered Purchases row to seed'); process.exit(1); }
  await pool.query(`UPDATE investment_tracker SET status = 'On Hold' WHERE id = $1`, [victim.id]);
  console.log(`  seeded: "${victim.asset_name}" status ${victim.status} -> 'On Hold'`);
  await page.reload().catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  const pill = page.locator('[data-testid="filter-status-rep"]');
  const pillText = (await pill.textContent().catch(() => '')) || '';
  check('Reporting pill is on the page', pillText.length > 0, JSON.stringify(pillText));
  const counted = Number((pillText.match(/(\d+)\s*$/) || [])[1] || 0);

  // Rows that belong to a portfolio render inside that portfolio's OWN table,
  // not the main one, so the assertion reads every row on the page.
  const rowTexts = () => page.evaluate(() => [...document.querySelectorAll('tbody tr')]
    .map((r) => (r.innerText || '').replace(/\s+/g, ' ').trim())
    .filter((t) => t && !/^No assets match/.test(t)));
  check('the On Hold row is counted by the Reporting pill', counted > 0, `pill reads ${counted}`);

  await pill.click();
  await page.waitForTimeout(1200);
  const after = await rowTexts();
  const shown = after.length;
  await page.screenshot({ path: 'qa/smoke-shots/r605-tracker-rep-filter.png' });
  console.log(`     Reporting pill counts ${counted}; filtered list shows ${shown} row(s)`);
  console.log(`     filtered row(s): ${JSON.stringify(after).slice(0, 300)}`);
  check('clicking the pill that counted it does NOT empty the list', shown > 0,
    `the Reporting pill counted ${counted} and then showed ${shown}`);
  check('the filtered list is as long as the pill promised', shown === counted, `${shown} vs ${counted}`);
  check('the row shown under Reporting is the On Hold row',
    after.some((t) => t.includes(victim.asset_name)), JSON.stringify(after.slice(0, 2)));
} finally {
  await browser.close();
  if (victim) await pool.query(`UPDATE investment_tracker SET status = $2 WHERE id = $1`, [victim.id, victim.status]);
  await pool.end();
}

console.log(failures === 0 ? '\nr605 tracker-filter probe: all green' : `\nr605 tracker-filter probe: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
