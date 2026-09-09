// r629 · Mark Warne (Landsec client) · desktop 1440px · FULL journey
// Real task: "build a Q4 pitch list of hospitality brands to chase for
// Bluewater" — Brand Intelligence overview, the All Brands door, Brand
// Explorer, Turnover Board, Brand Hunter, then the WRITE: self-add a brand
// from the global directory and check every count that moves.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5000';
const PASSWORD = 'B@nd0077!';
const IGNORE = [
  /\/api\/microsoft\//, /\/api\/ai-briefing/, /\/api\/client\/brand-theme/,
  /\/api\/brand\/.*\/(ai-take|rocketreach)/, /\/api\/os\/sites/, /\/api\/hr\/photo/,
  /\/api\/client\/sharepoint\/root/, /\/api\/covenant\//,
  /\/api\/property\/.*\/(brand-gaps|commentary)/,
];
const issues = [];
let scen = 'boot';
const note = (...a) => console.log('  ·', ...a);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const lr = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'mark.warne@landsec.com', password: PASSWORD } });
const user = await lr.json();
if (!user.token) { console.log('login failed'); process.exit(1); }
const TOK = { Authorization: 'Bearer ' + user.token };
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!/Failed to load resource|favicon/i.test(t)) issues.push([scen, 'console', t.slice(0,160)]); } });
page.on('pageerror', (e) => issues.push([scen, 'pageerror', e.message.slice(0,160)]));
page.on('response', (res) => {
  const u = res.url(); if (!u.includes('/api/') || res.status() < 400) return;
  if (IGNORE.some(re => re.test(u.split('?')[0]))) return;
  issues.push([scen, 'http-' + res.status(), res.request().method() + ' ' + u.replace(BASE, '')]);
});
await page.goto(BASE);
await page.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);

const api = async (p) => { const r = await fetch(BASE + p, { headers: TOK }); return r.ok ? r.json() : { __status: r.status }; };
const tiles = () => page.evaluate(() => {
  const out = {};
  document.querySelectorAll('.text-\\[11px\\].uppercase').forEach(el => {
    const v = el.parentElement?.querySelector('.font-mono');
    if (v) out[el.textContent.trim()] = v.textContent.trim();
  });
  return out;
});

// ── STEP 1: the Overview tiles ────────────────────────────────────────
scen = 'brand-overview';
await page.goto(BASE + '/brands', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const t1 = await tiles();
console.log('\n== STEP 1 · Brand Intelligence overview tiles ==');
console.log(JSON.stringify(t1));
const hub = await api('/api/brands/hub');
const companies = await api('/api/crm/companies');
const brandRows = (Array.isArray(companies) ? companies : []).filter(c => /^tenant\s*-/i.test(c.companyType || ''));
note('hub stats:', JSON.stringify(hub.stats));
note('/api/crm/companies rows:', Array.isArray(companies) ? companies.length : companies, '· of which Tenant-*:', brandRows.length);
note('brand names Mark can see via crm/companies:', brandRows.map(b => b.name).sort().join(', '));

// ── STEP 2: the "All Brands" door in the header ───────────────────────
scen = 'all-brands-door';
console.log('\n== STEP 2 · the header "All Brands" button ==');
const allBrandsHref = await page.evaluate(() => {
  const a = Array.from(document.querySelectorAll('a')).find(x => /^all brands/i.test(x.textContent.trim()));
  return a ? a.getAttribute('href') : null;
});
note('href =', allBrandsHref);
if (allBrandsHref) {
  await page.goto(BASE + allBrandsHref, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const body = await page.evaluate(() => document.body.innerText);
  console.log(body.slice(0, 1500));
  await page.screenshot({ path: '/tmp/r629-all-brands.png' });
}

// ── STEP 3: Brand Explorer / Turnover Board / Brand Hunter ────────────
for (const tab of ['explorer', 'turnover', 'hunter']) {
  scen = 'brand-tab-' + tab;
  console.log(`\n== STEP 3 · tab=${tab} ==`);
  await page.goto(`${BASE}/brands?tab=${tab}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6500);
  const body = await page.evaluate(() => document.body.innerText.split('⌘\nK')[1] || document.body.innerText);
  console.log(body.slice(0, 1400).replace(/\n{3,}/g, '\n'));
  await page.screenshot({ path: `/tmp/r629-tab-${tab}.png` });
}

// ── STEP 4: the WRITE — self-add a non-slice brand ────────────────────
scen = 'self-add-write';
console.log('\n== STEP 4 · WRITE: add a brand from the global directory ==');
const dir = await api('/api/client/crm/global-brands?search=Testco');
const cand = (Array.isArray(dir) ? dir : []).filter(b => !b.inSlice && !b.added);
note('directory hits for "Testco":', Array.isArray(dir) ? dir.length : dir, '· addable:', cand.length,
     cand.length ? '· picking ' + cand[0].name + ' (' + cand[0].companyType + ')' : '');
console.log('  first 8 directory rows:', JSON.stringify((Array.isArray(dir)?dir:[]).slice(0,8).map(b=>[b.name,b.companyType,b.inSlice,b.added])));

let added = null;
if (cand.length) {
  added = cand[0];
  await page.goto(BASE + '/brands', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5500);
  await page.click('[data-testid="client-add-brand"]');
  await page.waitForTimeout(800);
  await page.fill('[data-testid="client-add-brand-search"]', added.name);
  await page.waitForTimeout(2500);
  const rowTxt = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '');
  console.log('  dialog:\n' + rowTxt.slice(0, 700));
  const btn = page.locator('[role="dialog"] button', { hasText: /^Add$/ }).first();
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(2500); }
  console.log('  after add, dialog:\n' + ((await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '')).slice(0, 500)));
  await page.screenshot({ path: '/tmp/r629-add-dialog.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);

  // ── STEP 5: does every count that should move, move? ───────────────
  scen = 'post-write-recheck';
  console.log('\n== STEP 5 · post-write reconciliation ==');
  await page.goto(BASE + '/brands', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6500);
  const t2 = await tiles();
  console.log('  tiles before:', JSON.stringify(t1));
  console.log('  tiles after :', JSON.stringify(t2));
  const hub2 = await api('/api/brands/hub');
  const comp2 = await api('/api/crm/companies');
  const brand2 = (Array.isArray(comp2) ? comp2 : []).filter(c => /^tenant\s*-/i.test(c.companyType || ''));
  note('hub total_brands', hub.stats?.total_brands, '->', hub2.stats?.total_brands);
  note('crm/companies Tenant-* ', brandRows.length, '->', brand2.length);
  note('added brand now in crm/companies?', brand2.some(b => b.id === added.id));

  scen = 'explorer-after-write';
  await page.goto(BASE + '/brands?tab=explorer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6500);
  const exp = await page.evaluate(() => document.body.innerText);
  note('added brand visible in Brand Explorer?', exp.includes(added.name));
  await page.screenshot({ path: '/tmp/r629-explorer-after.png' });

  scen = 'brand-profile-after-write';
  await page.goto(BASE + '/companies/' + added.id, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  const prof = await page.evaluate(() => document.body.innerText.split('⌘\nK')[1] || document.body.innerText);
  console.log('\n== STEP 6 · the self-added brand profile ==');
  console.log(prof.slice(0, 1600).replace(/\n{3,}/g, '\n'));
  await page.screenshot({ path: '/tmp/r629-profile.png', fullPage: false });
}

console.log('\n===== ISSUES =====');
for (const i of issues) console.log(i.join(' | '));
console.log('issue count', issues.length);
await browser.close();
process.exit(0);
