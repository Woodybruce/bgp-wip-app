// r629 · the WRITE: Mark self-adds an out-of-slice brand from the directory,
// then every surface that lists his brands is re-read — Brand Intelligence
// tiles, Brand Explorer, and the client CRM Brand Directory pill row.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const lr = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'mark.warne@landsec.com', password: 'B@nd0077!' } });
const user = await lr.json();
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon/i.test(m.text())) console.log('  [console]', m.text().slice(0,140)); });
await page.goto(BASE);
await page.evaluate(([t,u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);

// ── the write, through the real dialog ──
await page.goto(BASE + '/brands', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
await page.click('[data-testid="client-add-brand"]');
await page.waitForTimeout(700);
await page.fill('[data-testid="client-add-brand-search"]', 'Testco Jewellers');
await page.waitForTimeout(2500);
const addBtn = page.locator('[role="dialog"] button').filter({ hasText: /Add\s*$/ }).first();
console.log('Add buttons found:', await page.locator('[role="dialog"] button').filter({ hasText: /Add\s*$/ }).count());
await addBtn.click();
await page.waitForTimeout(2500);
console.log('dialog after add:\n' + (await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '')).slice(0,400));
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);

const tiles = () => page.evaluate(() => { const o = {}; document.querySelectorAll('.text-\\[11px\\].uppercase').forEach(el => { const v = el.parentElement?.querySelector('.font-mono'); if (v) o[el.textContent.trim()] = v.textContent.trim(); }); return o; });

await page.goto(BASE + '/brands', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
console.log('\nOverview tiles after write:', JSON.stringify(await tiles()));

await page.goto(BASE + '/brands?tab=explorer', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const exp = await page.evaluate(() => document.body.innerText);
console.log('Brand Explorer: Jewellers present?', exp.includes('Testco Jewellers'));
console.log('Explorer category chips:', JSON.stringify(await page.evaluate(() => {
  const txt = document.body.innerText; const i = txt.indexOf('All Brands\n'); return txt.slice(i, i + 200).split('\n').filter(Boolean).slice(0, 12);
})));

// ── the client CRM Brand Directory — the SECOND list of the same brands ──
await page.goto(BASE + '/companies?tab=tenants', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6500);
console.log('\n== client CRM Brand Directory ==');
console.log('header:', await page.evaluate(() => document.querySelector('h1')?.parentElement?.innerText?.slice(0,120)));
const pills = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => ['All','Food & Dining','Cafés & Coffee','Bars','Leisure','Fitness'].includes(t)));
console.log('category pills:', JSON.stringify(pills));
for (const label of ['All', 'Food & Dining', 'Cafés & Coffee', 'Bars', 'Leisure', 'Fitness']) {
  const btn = page.locator('button', { hasText: new RegExp('^' + label.replace(/[&]/g,'\\&') + '$') }).first();
  if (!(await btn.count())) { console.log(`  pill "${label}" not found`); continue; }
  await btn.click();
  await page.waitForTimeout(900);
  const info = await page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/(\d+) brands/g);
    const names = Array.from(document.querySelectorAll('h3, .font-medium')).map(e => e.textContent.trim());
    return { counts: m, jewellers: t.includes('Testco Jewellers'), fashion: t.includes('Testco Fashion') };
  });
  console.log(`  pill "${label}" -> counts=${JSON.stringify(info.counts)} Jewellers=${info.jewellers} Fashion=${info.fashion}`);
}
await page.screenshot({ path: '/tmp/r629-crm-directory.png' });
await browser.close();
process.exit(0);
