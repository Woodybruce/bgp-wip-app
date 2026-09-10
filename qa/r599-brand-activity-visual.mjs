import { chromium } from '../node_modules/playwright/index.mjs';
import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });

const brand = (await pool.query(`SELECT id, name FROM crm_companies WHERE name = 'Amorino' LIMIT 1`)).rows[0];
const prop = (await pool.query(`SELECT id, name FROM crm_properties ORDER BY name LIMIT 1`)).rows[0];
console.log('brand', brand, 'prop', prop);
const mk = async (status) => (await pool.query(
  `INSERT INTO crm_deals (id, name, status, deal_type, property_id, tenant_id, created_at, updated_at)
   VALUES (gen_random_uuid(), $1, $2, 'New Letting', $3, $4, now(), now()) RETURNING id`,
  [`QA599-${status}`, status, prop.id, brand.id])).rows[0].id;
const comId = await mk('COM');
const witId = await mk('WIT');
console.log('seeded COM', comId, 'WIT', witId);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const login = await page.request.post('http://localhost:5000/api/auth/login', {
  data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const token = (await login.json()).token;
await page.goto('http://localhost:5000/');
await page.evaluate((t) => localStorage.setItem('authToken', t), token);
await page.goto(`http://localhost:5000/companies/${brand.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
const card = page.locator('text=Portfolio activity').first();
try { await card.scrollIntoViewIfNeeded({ timeout: 8000 }); } catch {}
await page.waitForTimeout(1500);
const body = await page.locator('body').innerText();
const idx = body.indexOf('Portfolio activity');
console.log('--- PANEL TEXT ---\n' + (idx >= 0 ? body.slice(idx, idx + 600) : 'PANEL NOT FOUND\nBODY HEAD:\n' + body.slice(0, 1200)));
console.log('mentions QA599-COM:', body.includes('QA599-COM'), '| mentions QA599-WIT:', body.includes('QA599-WIT'));
await page.screenshot({ path: 'qa/smoke-shots/r599-brand-activity.png', fullPage: false });
await browser.close();
await pool.query(`DELETE FROM crm_deals WHERE name IN ('QA599-COM','QA599-WIT')`);
console.log('probe deals removed');
await pool.end();
