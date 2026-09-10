// Visual verification of the r587 HOT fault-line fix: seed one un-dealed unit
// at HOTs and screenshot the asset-brief funnel on the property page.
import { chromium } from 'playwright';
import pg from 'pg';
const BASE = 'http://127.0.0.1:5000';
const PROP = 'cccccccc-0000-0000-0000-000000000001';
const c = new pg.Client({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const { rows } = await c.query(
  `select id, unit_name from available_units where property_id=$1 and deal_id is null and marketing_status='AVA' order by unit_name limit 1`, [PROP]);
const UNIT = rows[0].id;
await c.query(`update available_units set marketing_status='HOT' where id=$1`, [UNIT]);
console.log(`seeded ${rows[0].unit_name} -> HOT`);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await r.json();
const page = await ctx.newPage();
await page.goto(BASE);
await page.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);
await page.goto(`${BASE}/properties/${PROP}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
// Find the funnel and read the HoTs lozenge.
const funnel = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('div,button')) {
    const t = (el.textContent || '').trim();
    if (/^(Engaged|Viewed|Pitch out|HoTs|Legals|Signed)$/i.test(t)) {
      const box = el.closest('button') || el.parentElement;
      out.push({ stage: t, block: (box?.textContent || '').trim().slice(0, 40) });
    }
  }
  return out;
});
console.log('funnel lozenges:', JSON.stringify(funnel));
const hots = page.locator('text=/^HoTs$/i').first();
if (await hots.count()) {
  await hots.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'qa/smoke-shots/r587-funnel-hots.png' });
  // click through to the drilldown
  const btn = page.locator('button', { hasText: /HoTs/i }).first();
  if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(1500); }
  await page.screenshot({ path: 'qa/smoke-shots/r587-funnel-hots-drilldown.png' });
  const body = await page.evaluate(() => document.body.innerText);
  const m = body.match(/HoTs[\s\S]{0,120}/i);
  console.log('near HoTs:', JSON.stringify(m && m[0].replace(/\n+/g, ' | ')));
  console.log('unit named on page:', body.includes('BWREST'));
} else { console.log('HoTs lozenge NOT FOUND on the page'); }
await b.close();
await c.query(`update available_units set marketing_status='AVA' where id=$1`, [UNIT]);
console.log('restored -> AVA');
await c.end();
