// r627: Victoria (Head of National, staff, isAdmin false) on the staff desktop
// at 1440px. Task: pull comparable evidence together for a pitch — comps board,
// a comp detail, the Why Buy / Pathway flow — with a real write in it.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:5000';
const OUT = '/tmp/r627';
import { mkdirSync } from 'fs';
mkdirSync(OUT, { recursive: true });

const errs = [];
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }); };

const visit = async (page, path, settle = 3500) => {
  try { await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
  catch (e) { console.log(`  [goto ${path}] ${e.message.split('\n')[0]}`); }
  await page.waitForTimeout(settle);
};

const main = async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
  const user = await r.json();
  console.log('[login]', r.status(), user.email || JSON.stringify(user).slice(0, 120));
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.evaluate(([tok, u]) => { localStorage.setItem('authToken', tok); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);
  page.qaToken = user.token;
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0, 160)));

  for (const [path, name] of [
    ['/comps', 'comps'],
    ['/property-pathway', 'pathway'],
    ['/evidence-plans', 'evidence-plans'],
    ['/lease-events', 'lease-events'],
  ]) {
    await visit(page, path);
    const body = await page.evaluate(() => document.body.innerText || '');
    const notFound = /page not found/i.test(body);
    console.log(`\n== ${path} == chars=${body.length} notFound=${notFound}`);
    console.log('  head:', body.slice(0, 260).replace(/\n+/g, ' | '));
    await shot(page, name);
  }

  // Comp detail — open the first row on the comps board.
  await visit(page, '/comps');
  const rows = await page.locator('table tbody tr').count().catch(() => 0);
  console.log(`\n[comps] table rows = ${rows}`);
  if (rows > 0) {
    await page.locator('table tbody tr').first().click().catch(e => console.log('  click:', e.message.split('\n')[0]));
    await page.waitForTimeout(3000);
    console.log('[comp detail url]', page.url());
    const t = await page.evaluate(() => document.body.innerText.slice(0, 400));
    console.log('  detail head:', t.replace(/\n+/g, ' | '));
    await shot(page, 'comp-detail');
  }

  console.log('\n[console errors]');
  const seen = new Map();
  for (const e of errs) seen.set(e, (seen.get(e) || 0) + 1);
  for (const [e, n] of seen) console.log(`  x${n} ${e}`);
  await browser.close();
};
main().catch(e => { console.error(e); process.exit(1); });
