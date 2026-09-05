// r549 — Victoria (BGP staff, desktop 1440px): "a letting just completed —
// record it as a comp, then check the schedule and the rent analysis agree."
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = 'http://localhost:5000';
const USER = 'victoria@brucegillinghampollard.com';
const PASSWORD = 'B@nd0077!';
const TAG = 'r549j';
const COMP_NAME = 'QA-COMP r549 12 Market Street';

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    return route.abort();
  });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  const user = await r.json();
  if (!user.token) { console.error('login failed'); process.exit(2); }
  const page = await ctx.newPage();
  let bucket = [];
  page.on('response', (res) => { if (res.status() >= 400) bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE, '')}`); });
  page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0, 250)}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) bucket.push(`CONSOLE ${msg.text().slice(0,220)}`); });
  const flush = (l) => { const s = [...new Set(bucket)]; bucket = []; if (s.length) console.log(`   [${l}] ` + s.join('\n   ')); else console.log(`   [${l}] clean`); };
  let step = 0;
  const shot = async (l) => { step++; const p = `qa/smoke-shots/${TAG}-${String(step).padStart(2,'0')}-${l}.png`; await page.screenshot({ path: p, fullPage: false }); console.log('   shot', p); };
  const hoverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('bgp_auth_token', tok); localStorage.setItem('authToken', tok);
    localStorage.setItem('user', JSON.stringify(u));
  }, [user.token, user]);

  // 1. land on Comps
  await page.goto(BASE + '/comps', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  console.log('== h-overflow:', await hoverflow());
  console.log('== rows before:', await page.locator('[data-testid^="comp-row-"]').count());
  await shot('comps-board');
  flush('load');

  // 2. create dialog
  await page.locator('[data-testid="button-create-comp"]').click();
  await page.waitForTimeout(1000);
  await page.locator('[data-testid="create-comp-tenant"]').fill('QA Coffee Co');
  await page.locator('[data-testid="create-comp-area"]').fill('Clapham');
  await page.locator('[data-testid="create-comp-rent"]').fill('92500');
  await page.locator('[data-testid="create-comp-zone-a"]').fill('120');
  await page.locator('[data-testid="create-comp-date"]').fill('Aug 2026');
  // property/name combobox — type manually
  const nameInputs = await page.locator('[role="dialog"] input').count();
  console.log('== dialog inputs:', nameInputs);
  const firstInput = page.locator('[role="dialog"] input').first();
  await firstInput.fill(COMP_NAME);
  await page.waitForTimeout(800);
  await shot('create-dialog');
  const dtext = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return d ? d.innerText.replace(/\s+/g,' ').slice(0,700) : 'NONE'; });
  console.log('== dialog:', dtext);
  const saveDisabled = await page.locator('[data-testid="button-save-comp"]').isDisabled();
  console.log('== save disabled:', saveDisabled);
  await page.locator('[data-testid="button-save-comp"]').click();
  await page.waitForTimeout(2500);
  await shot('after-save');
  flush('create');

  // 3. find the row
  await page.locator('[data-testid="input-search-comps"]').fill('QA-COMP r549');
  await page.waitForTimeout(1200);
  const rows = await page.locator('[data-testid^="comp-row-"]').count();
  console.log('== rows matching search:', rows);
  const rowText = await page.locator('[data-testid^="comp-row-"]').first().innerText().catch(()=>'NONE');
  console.log('== row:', JSON.stringify(rowText.replace(/\s+/g,' ').slice(0,400)));
  await shot('row');
  flush('search');

  // 4. open the row detail
  await page.locator('[data-testid^="comp-name-"]').first().click().catch(()=>{});
  await page.waitForTimeout(1800);
  await shot('detail');
  const det = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return d ? d.innerText.replace(/\s+/g,' ').slice(0,1600) : 'NO DIALOG'; });
  console.log('== detail:', det);
  flush('detail');
  console.log('== h-overflow end:', await hoverflow());
} finally { await browser.close(); }
