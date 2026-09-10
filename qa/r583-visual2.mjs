// r583 — the digest KYC alert on the PHONE home screen (mobile-home.tsx:263).
import { chromium, devices } from '../node_modules/playwright/index.mjs';
import pg from '../node_modules/pg/lib/index.js';
const BASE = 'http://localhost:5000';
const ID = '58358358-0000-0000-0000-000000000583';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
await c.query('DELETE FROM crm_deals WHERE id = $1', [ID]);
await c.query(`INSERT INTO crm_deals (id, name, status, fee, internal_agent, team, kyc_approved, deal_type)
  VALUES ($1, 'QA-R583 stage+kyc probe', 'SOL', 100000, $2, $3, false, 'Leasing')`, [ID, ['Victoria Broadhead'], ['National Leasing']]);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const user = await (await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } })).json();
const page = await ctx.newPage();
await page.goto(BASE);
await page.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
const kyc = page.locator('text=/KYC not approved/i').first();
const n = await kyc.count();
if (n) await kyc.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
console.log('PHONE HOME kyc alert: ' + (n ? 'YES — ' + (await kyc.innerText()) : 'NO'));
await page.screenshot({ path: 'qa/smoke-shots/r583-phone-kyc.png', fullPage: false });
await browser.close();
await c.query('DELETE FROM crm_deals WHERE id = $1', [ID]);
await c.end();
