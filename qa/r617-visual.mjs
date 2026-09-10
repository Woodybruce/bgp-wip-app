// r617: Settings -> CRM duplicates -> merge a duplicate PROPERTY, as Victoria.
import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
import pg from '/home/user/bgp-wip-app/node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const SHOT = process.env.SHOT_PREFIX || '/tmp/r617v';

const u1 = (await pool.query("SELECT id FROM users WHERE lower(email)=lower($1)", ['victoria@brucegillinghampollard.com'])).rows[0].id;
await pool.query("DELETE FROM crm_property_agents WHERE property_id IN (SELECT id FROM crm_properties WHERE name LIKE 'QA r617%')");
await pool.query("DELETE FROM crm_properties WHERE name LIKE 'QA r617%'");
const a = (await pool.query("INSERT INTO crm_properties (name) VALUES ('QA r617 Kingsway Retail Park') RETURNING id")).rows[0].id;
const b = (await pool.query("INSERT INTO crm_properties (name) VALUES ('QA r617 Kingsway Retail Park') RETURNING id")).rows[0].id;
await pool.query("INSERT INTO crm_property_agents (property_id, user_id, role) VALUES ($1,$2,'Lead')", [b, u1]);
console.log('seeded two "QA r617 Kingsway Retail Park" rows');

const BASE = 'http://127.0.0.1:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const lr = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await lr.json();
if (!user.token) { console.error('login failed', JSON.stringify(user).slice(0, 200)); process.exit(2); }
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('  [console]', m.text().slice(0, 140)); });
await page.goto(BASE).catch(e => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([tok, u]) => {
  localStorage.setItem('bgp_auth_token', tok);
  localStorage.setItem('authToken', tok);
  localStorage.setItem('user', JSON.stringify(u));
}, [user.token, user]);

await page.goto('http://127.0.0.1:5000/settings', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
const scanBtn = page.locator('[data-testid="button-scan-duplicates"]');
await scanBtn.scrollIntoViewIfNeeded();
await scanBtn.click();
await page.waitForTimeout(6000);
const sec = page.locator('[data-testid="section-property-dupes"]');
await sec.scrollIntoViewIfNeeded();
console.log('property-dupes section visible:', await sec.isVisible());
console.log('rows listed:', (await sec.locator('div.text-xs').allInnerTexts()).slice(0, 5));
await page.screenshot({ path: `${SHOT}-01-dupes-before.png` });

const row = sec.locator('div', { hasText: 'qa r617 kingsway retail park' }).last();
await row.locator('button', { hasText: 'Merge' }).first().click();
await page.waitForTimeout(6000);
await page.screenshot({ path: `${SHOT}-02-after-merge.png` });
const toasts = await page.locator('[data-testid="toast"], li[role="status"], .toast, [role="status"]').allInnerTexts();
console.log('toast text:', JSON.stringify(toasts.join(' | ').slice(0, 220)));
const still = await page.locator('[data-testid="section-property-dupes"]').isVisible().catch(() => false);
const listed = still ? (await page.locator('[data-testid="section-property-dupes"]').innerText()).includes('qa r617') : false;
console.log('our group still listed after merge:', listed);
console.log('rows in DB now:', (await pool.query("SELECT count(*)::int c FROM crm_properties WHERE name LIKE 'QA r617%'")).rows[0].c, '(want 1)');
console.log('agent link survived:', (await pool.query("SELECT count(*)::int c FROM crm_property_agents WHERE property_id=$1", [a])).rows[0].c, '(want 1, moved onto the keeper)');

await pool.query("DELETE FROM crm_property_agents WHERE property_id IN (SELECT id FROM crm_properties WHERE name LIKE 'QA r617%')");
await pool.query("DELETE FROM crm_properties WHERE name LIKE 'QA r617%'");
await browser.close();
await pool.end();
