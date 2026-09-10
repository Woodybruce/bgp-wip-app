// r598 journey: Victoria (BGP staff) on the desktop at 1440px.
// Task framing: "Nick needs rental evidence to support a quote at one of our
// schemes. What comparable evidence do we actually hold on the comps board,
// and can I get the deal that just completed onto the schedule so the quote
// stands up? Then check the evidence reaches the surfaces that use it."
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const BASE = process.env.QA_BASE || 'http://localhost:5000';
const USER = process.env.QA_USER || 'mark.warne@landsec.com';
const PASSWORD = 'B@nd0077!';
const TAG = process.env.QA_TAG || 'r598';

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.abort();
});
const CACHE = process.env.QA_TOKEN_CACHE || '/tmp/r598-token.json';
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
  await go('/companies', 'crm', {});
  const hdr = await click('[data-testid="client-crm-tab-contacts"]', 'landsec-contacts-fixed', {});
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="client-contact-"]')]
    .map(c => (c.innerText||'').replace(/\n+/g,' | ').slice(0,70)));
  console.log(`\n#### AFTER FIX — "Landsec Contacts" renders ${cards.length} cards:`);
  cards.forEach(c => console.log('   ' + c));
  console.log('#### sub-header: ' + (hdr?.txt||'').split('\n').find(l => /of your contacts/.test(l)));
  console.log('#### agent pencil still present? ' + await page.locator('[data-testid="client-edit-own-contact-cccccccc-cccc-cccc-cccc-cccccccc0002"]').count());
  console.log('#### brand pencil still present? ' + await page.locator('[data-testid="client-edit-own-contact-11110000-0000-0000-0000-000000000102"]').count());
  // Brand Directory must be UNCHANGED — Tom Barista still reachable there.
  await click('[data-testid="client-crm-tab-brands"]', 'brand-directory-unchanged', {});
  const bd = await page.evaluate(() => (document.body.innerText||''));
  console.log('#### Brand Directory still names Tom Barista? ' + /Tom Barista/.test(bd));
  console.log('#### Brand Directory still names Sam Tester?  ' + /Sam Tester/.test(bd));

  // ── THE JOURNEY WRITE — Mark adds his own new leasing lead to Landsec ──
  await click('[data-testid="client-crm-tab-contacts"]', 'contacts-for-write', {});
  await click('[data-testid="client-add-own-contact"]', 'add-own-contact-dialog', {});
  const dlgTitle = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText||'').split('\n')[0]);
  console.log('\n#### add-dialog title: ' + dlgTitle);
  const inputs = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] input')].map(i => i.name || i.placeholder || i.id || '?'));
  console.log('#### add-dialog inputs: ' + inputs.join(', '));
  const dlgInputs = page.locator('[role="dialog"] input');
  await dlgInputs.nth(0).fill('Priya Raman');
  await dlgInputs.nth(1).fill('Head of Leasing, South East');
  await dlgInputs.nth(2).fill('priya.raman@landsec.example');
  await click('[role="dialog"] button:has-text("Add contact")', 'contact-saved', {});
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="client-contact-"]')]
    .map(c => (c.innerText||'').replace(/\n+/g,' | ').slice(0,60)));
  console.log(`\n#### AFTER WRITE — ${after.length} cards:`);
  after.forEach(c => console.log('   ' + c));
  // survives a reload?
  await go('/companies', 'after-reload', {});
  await click('[data-testid="client-crm-tab-contacts"]', 'contacts-after-reload', {});
  const reloaded = await page.evaluate(() => (document.body.innerText||''));
  console.log('#### Priya survives a reload? ' + /Priya Raman/.test(reloaded));
  console.log('#### and lands on Landsec? ' + JSON.stringify((await api('GET','/api/crm/contacts')).body.filter(c=>c.name==='Priya Raman').map(c=>({co:c.companyId, role:c.role}))));
  await browser.close();
}
