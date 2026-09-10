// r629 · Mark Warne (Landsec client) desktop 1440px survey of the
// non-leasing-prep surfaces: My Tasks, News, Brand CRM, Requirements.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5000';
const PASSWORD = 'B@nd0077!';
const IGNORE = [
  /\/api\/microsoft\//, /\/api\/ai-briefing/, /\/api\/client\/brand-theme/,
  /\/api\/brand\/.*\/(ai-take|rocketreach)/, /\/api\/os\/sites/,
  /\/api\/client\/sharepoint\/root/, /\/api\/covenant\//,
  /\/api\/property\/.*\/(brand-gaps|commentary)/,
];
const issues = [];
let scen = 'boot';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'mark.warne@landsec.com', password: PASSWORD } });
const user = await r.json();
if (!user.token) { console.log('login failed', JSON.stringify(user).slice(0,200)); process.exit(1); }
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!/Failed to load resource|favicon/i.test(t)) issues.push([scen, 'console', t.slice(0,180)]); } });
page.on('pageerror', (e) => issues.push([scen, 'pageerror', e.message.slice(0,180)]));
page.on('response', (res) => {
  const u = res.url(); if (!u.includes('/api/') || res.status() < 400) return;
  if (IGNORE.some(re => re.test(u.split('?')[0]))) return;
  issues.push([scen, 'http-' + res.status(), res.request().method() + ' ' + u.replace(BASE, '')]);
});
await page.goto(BASE);
await page.evaluate(([tok, u]) => { localStorage.setItem('authToken', tok); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);

const visit = async (path, label) => {
  scen = label;
  try { await page.goto(BASE + path, { waitUntil: 'domcontentloaded' }); } catch (e) { issues.push([label, 'goto', e.message.slice(0,120)]); }
  await page.waitForTimeout(4500);
  const body = await page.evaluate(() => document.body.innerText);
  console.log(`\n===== ${label}  (${path})  chars=${body.length} =====`);
  console.log(body.slice(0, 1800).replace(/\n{3,}/g, '\n\n'));
};

await visit('/', 'dashboard-warm');
await visit('/tasks', 'my-tasks');
await visit('/news', 'news');
await visit('/requirements', 'requirements');
await visit('/brands', 'brand-crm');

console.log('\n===== nav labels =====');
console.log(JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('nav a, [data-sidebar] a')).map(a => a.textContent.trim()).filter(Boolean))));

console.log('\n===== ISSUES =====');
for (const i of issues) console.log(i.join(' | '));
console.log('issue count', issues.length);
await browser.close();
