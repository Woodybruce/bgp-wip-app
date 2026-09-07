// r583 visual re-verification of the two legacy-label fixes.
import { chromium } from '../node_modules/playwright/index.mjs';
import pg from '../node_modules/pg/lib/index.js';

const BASE = 'http://localhost:5000';
const AGENT = 'Victoria Broadhead';
const ID = '58358358-0000-0000-0000-000000000583';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
await c.query('DELETE FROM crm_deals WHERE id = $1', [ID]);
await c.query(`INSERT INTO crm_deals (id, name, status, fee, internal_agent, team, kyc_approved, deal_type)
  VALUES ($1, 'QA-R583 stage+kyc probe', 'SOL', 100000, $2, $3, false, 'Leasing')`, [ID, [AGENT], ['National Leasing']]);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const lr = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await lr.json();
const page = await ctx.newPage();
await page.goto(BASE);
await page.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);

await page.goto(`${BASE}/wip-report`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.getByTestId('wip-tab-agent-summary').click();
await page.waitForTimeout(1500);
await page.getByTestId(`agent-card-${AGENT}`).first().click().catch(async () => {
  await page.getByTestId(`agent-bar-${AGENT}`).first().click();
});
await page.waitForTimeout(2500);
const drill = page.getByTestId('agent-drilldown');
await drill.scrollIntoViewIfNeeded().catch(() => {});
console.log('DRILLDOWN TEXT:\n' + (await drill.innerText().catch(() => '(not found)')).slice(0, 1400));
await page.screenshot({ path: 'qa/smoke-shots/r583-drilldown-stage.png', fullPage: false });

await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
const card = page.getByTestId('card-activity-alerts');
if (await card.count()) { await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(1200); }
console.log('activity-alerts widget present: ' + (await card.count()));
const kyc = page.locator('text=/KYC not approved/i').first();
const seen = await kyc.count();
if (seen) { await kyc.scrollIntoViewIfNeeded(); await page.waitForTimeout(600); }
console.log('\nDASHBOARD kyc alert visible: ' + (seen ? 'YES — ' + (await kyc.innerText()) : 'NO'));
await page.screenshot({ path: 'qa/smoke-shots/r583-dashboard-kyc.png', fullPage: false });

await browser.close();
await c.query('DELETE FROM crm_deals WHERE id = $1', [ID]);
await c.end();
