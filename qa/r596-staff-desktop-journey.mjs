// r596 journey: Victoria (BGP staff) on the desktop at 1440px.
// Task framing: "Nick needs rental evidence to support a quote at one of our
// schemes. What comparable evidence do we actually hold on the comps board,
// and can I get the deal that just completed onto the schedule so the quote
// stands up? Then check the evidence reaches the surfaces that use it."
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const BASE = process.env.QA_BASE || 'http://localhost:5000';
const USER = process.env.QA_USER || 'victoria@brucegillinghampollard.com';
const PASSWORD = 'B@nd0077!';
const TAG = process.env.QA_TAG || 'r596';

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.abort();
});
const CACHE = process.env.QA_TOKEN_CACHE || '/tmp/r596-token.json';
let user = null;
if (existsSync(CACHE)) {
  try {
    const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
    const probe = await ctx.request.get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${cached.token}` } });
    if (probe.ok()) user = cached;
  } catch {}
}
if (!user) {
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  user = await r.json();
  if (!user.token) { console.error('login failed', JSON.stringify(user).slice(0, 300)); process.exit(2); }
  writeFileSync(CACHE, JSON.stringify(user));
}
const page = await ctx.newPage();

let bucket = [];
const NOISE = /rocketreach|ai-briefing|ai-take|brand-gaps|commentary|sharepoint\/root|microsoft\/|brand-theme|favicon|\/photo|covenant\/|os\/sites|s2\/favicons|goad/;
page.on('response', (res) => {
  if (res.status() < 400) return;
  const u = res.url().replace(BASE, '');
  bucket.push(`HTTP ${res.status()} ${res.request().method()} ${u}${NOISE.test(u) ? '   [noise]' : ''}`);
});
page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0, 250)}`));
page.on('console', async (msg) => {
  if (msg.type() !== 'error' && msg.type() !== 'warning') return;
  const t = msg.text();
  if (/Failed to load resource/.test(t)) return;
  if (/Missing `Description`/.test(t)) return;
  if (/validateDOMNesting|Each child in a list/.test(t)) {
    const args = [];
    for (const a of msg.args()) { try { args.push(await a.jsonValue()); } catch { args.push('?'); } }
    bucket.push(`REACTWARN ${JSON.stringify(args).slice(0, 900)}`);
    return;
  }
  bucket.push(`CONSOLE[${msg.type()}] ${t.slice(0, 250)}`);
});

await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([tok, u]) => {
  localStorage.setItem('bgp_auth_token', tok);
  localStorage.setItem('authToken', tok);
  localStorage.setItem('user', JSON.stringify(u));
}, [user.token, user]);

let step = 0;
async function shot(label) {
  step++;
  const path = `qa/smoke-shots/${TAG}-${String(step).padStart(2, '0')}-${label.replace(/\W+/g, '-')}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}
async function report(label, { text = false, ids = false, full = false } = {}) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({
    path: location.pathname + location.search,
    head: (document.querySelector('h1,h2')?.textContent || '').trim().slice(0, 90),
    txt: (document.body.innerText || '').replace(/\n{2,}/g, '\n').trim(),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    boundary: /Something went wrong|Application error|Unexpected error/i.test(document.body.innerText || ''),
    ids: [...document.querySelectorAll('[data-testid]')].map(el => el.getAttribute('data-testid')),
    wide: [...document.querySelectorAll('*')].filter(el => el.scrollWidth > window.innerWidth + 2 && el.clientWidth > 200)
      .slice(0, 6).map(el => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').slice(0,3).join('.')} sw=${el.scrollWidth}`),
  }));
  const p = await shot(label);
  console.log(`\n== [${label}] ${info.path} | "${info.head}" | ${info.txt.length} chars${info.overflow > 1 ? ` | H-OVERFLOW +${info.overflow}px` : ''}${info.boundary ? ' | ERROR BOUNDARY' : ''} | ${p}`);
  if (info.wide.length) console.log('   WIDE: ' + info.wide.join(' | '));
  for (const b of [...new Set(bucket)]) console.log(`   ${b}`);
  bucket = [];
  if (text) console.log('--- TEXT ---\n' + (full ? info.txt : info.txt.slice(0, 2400)));
  if (ids) console.log('--- IDS --- ' + [...new Set(info.ids)].join(' '));
  return info;
}
async function go(route, label, opts) {
  bucket = [];
  await page.goto(BASE + route).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  return report(label, opts);
}
async function click(selector, label, opts = {}) {
  bucket = [];
  try {
    const el = typeof selector === 'string' ? page.locator(selector).first() : selector;
    await el.waitFor({ state: 'visible', timeout: 8000 });
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 6000 });
  } catch (e) {
    console.log(`\n!! [${label}] click failed on ${selector}: ${String(e).slice(0, 200)}`);
    await shot(`${label}-clickfail`);
    return null;
  }
  return report(label, opts);
}
export { page, ctx, browser, go, click, report, shot, BASE, user };

if (process.env.QA_MAIN !== '0') {
  const auth = { Authorization: `Bearer ${user.token}` };
  const api = async (m, p, d) => {
    const r = await page.request.fetch(BASE + p, { method: m, headers: auth, data: d });
    const t = await r.text();
    try { return { status: r.status(), body: JSON.parse(t) }; } catch { return { status: r.status(), body: t.slice(0, 300) }; }
  };

  // STEP 1 — her desk. Start where she starts.
  await go('/', 'staff-home', { text: true });

  // STEP 2 — the comps board. What evidence do we hold?
  const board = await go('/comps', 'comps-board', { text: true, ids: true });
  const compsBefore = (await api('GET', '/api/crm/comps')).body;
  console.log(`\n#### /api/crm/comps rows = ${Array.isArray(compsBefore) ? compsBefore.length : JSON.stringify(compsBefore).slice(0,200)}`);
  if (Array.isArray(compsBefore)) {
    const lead = c => !c.verified && (["News Feed","Team Email","SharePoint File"].includes(c.sourceEvidence||"") || c.createdBy === "AI Auto-Extract");
    console.log(`#### leads=${compsBefore.filter(lead).length} confirmed=${compsBefore.filter(c=>!lead(c)).length} verified=${compsBefore.filter(c=>c.verified).length}`);
    for (const c of compsBefore.slice(0, 4)) console.log(`   ${c.id} "${c.name}" tenant=${c.tenant} ver=${c.verified} src=${c.sourceEvidence} by=${c.createdBy} rent=${c.headlineRent} zoneA=${c.zoneARate} area=${c.areaLocation}`);
  }
  console.log(`#### table rendered? comps-table present = ${board.ids.includes('comps-table')}`);

  // STEP 3 — she picks the scheme the quote is for.
  const props = (await api('GET', '/api/crm/properties')).body;
  const target = props.find(p => /Bluewater/i.test(p.name || '')) || props[0];
  console.log(`\n#### target scheme = "${target?.name}" ${target?.id}`);

  // STEP 4 — THE WRITE. Log the comp she has just been given.
  await click('[data-testid="button-create-comp"]', 'create-comp-dialog', { ids: true, text: true });
  await page.locator('[data-testid="create-comp-name"]').fill(String(target.name).slice(0, 14));
  await page.waitForTimeout(1200);
  await shot('create-comp-name-typeahead');
  const drop = page.locator('button:has-text("' + String(target.name).slice(0, 14) + '")');
  const dn = await drop.count();
  console.log(`#### typeahead options for "${String(target.name).slice(0,14)}": ${dn}`);
  if (dn > 0) { await drop.first().click().catch(e => console.log('   dropdown click failed: ' + String(e).slice(0,120))); }
  await page.waitForTimeout(500);
  await shot('create-comp-property-linked');

  await page.locator('[data-testid="create-comp-tenant"]').fill('Honi Poke');
  await page.locator('[data-testid="create-comp-area"]').fill('Dartford');
  await page.locator('[data-testid="create-comp-rent"]').fill('92500');
  await page.locator('[data-testid="create-comp-zone-a"]').fill('185');
  await page.locator('[data-testid="create-comp-date"]').fill('Sep 2026');
  // Use class + transaction type (Radix selects — click via role=option)
  const sels = page.locator('[role="dialog"] button[role="combobox"]');
  const sc = await sels.count();
  console.log(`#### comboboxes in dialog: ${sc}`);
  for (let i = 0; i < Math.min(sc, 2); i++) {
    await sels.nth(i).click();
    await page.waitForTimeout(400);
    const opts = page.locator('[role="option"]');
    const on = await opts.count();
    const labels = [];
    for (let j = 0; j < Math.min(on, 6); j++) labels.push((await opts.nth(j).innerText()).replace(/\n/g, '/'));
    console.log(`   combobox[${i}] ${on} options: ${labels.join(' · ')}`);
    if (on > 0) await opts.first().click();
    await page.waitForTimeout(300);
  }
  await report('create-comp-filled', { text: true });
  await click('[data-testid="button-save-comp"]', 'create-comp-saved', { text: true });

  // STEP 5 — network/row over toast. Did every field she typed land?
  const compsAfter = (await api('GET', '/api/crm/comps')).body;
  const mine = Array.isArray(compsAfter) ? compsAfter.filter(c => /Honi Poke/.test(c.tenant || '') && /Sep 2026/.test(c.completionDate || '')) : [];
  console.log(`\n#### comps after = ${Array.isArray(compsAfter) ? compsAfter.length : '?'}; matched mine = ${mine.length}`);
  for (const c of mine) console.log('   ROW ' + JSON.stringify(c));

  // STEP 6 — reload the board. Is her comp on it, and did the counts move?
  const after = await go('/comps', 'comps-board-after', { text: true, ids: true });
  console.log(`#### table rendered after write = ${after.ids.includes('comps-table')}`);
  for (const c of mine) console.log(`#### row visible for ${c.id} = ${after.ids.includes('comp-row-' + c.id)}`);

  // STEP 7 — does the evidence reach the scheme it is about?
  await go(`/properties/${target.id}`, 'property-after-comp', { text: true });
  const pc = await api('GET', `/api/crm/properties/${target.id}/comps`);
  console.log(`#### /api/crm/properties/:id/comps → ${pc.status} ${Array.isArray(pc.body) ? pc.body.length + ' rows' : JSON.stringify(pc.body).slice(0,200)}`);

  // STEP 8 — requirements matching, the other half of the evidence job.
  await go('/requirements', 'requirements-board', { text: true, ids: true });

  console.log('\n#### CREATED COMP IDS (for teardown): ' + mine.map(c => c.id).join(','));
  await browser.close();
}
