// r547: Victoria (staff, desktop) — a real WIP edit: "put a target month on
// the Bluewater MSU9 deal so it lands in the fee forecast". Inline <input
// type="month"> in the deal-detail table; debounced save on change, flush on
// blur. Submit through it, then reload and check it stuck.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = 'http://localhost:5000';
const USER = 'victoria@brucegillinghampollard.com';
const PASSWORD = 'B@nd0077!';
const TAG = 'r547t';

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
  const page = await ctx.newPage();
  let bucket = [], writes = [];
  page.on('response', (res) => {
    const m = res.request().method();
    if (m !== 'GET') writes.push(`${m} ${res.url().replace(BASE,'')} -> ${res.status()}`);
    if (res.status() >= 400) bucket.push(`HTTP ${res.status()} ${m} ${res.url().replace(BASE, '')}`);
  });
  page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0, 250)}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) bucket.push(`CONSOLE ${msg.text().slice(0,220)}`); });
  const flush = (l) => { const s = [...new Set(bucket)]; bucket = []; if (s.length) console.log(`   [${l}] ` + s.join('\n   ')); };
  let step = 0;
  const shot = async (l) => { step++; const p = `qa/smoke-shots/${TAG}-${String(step).padStart(2,'0')}-${l}.png`; await page.screenshot({ path: p }); return p; };

  await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('bgp_auth_token', tok); localStorage.setItem('authToken', tok);
    localStorage.setItem('user', JSON.stringify(u));
  }, [user.token, user]);

  const load = async () => {
    await page.goto(`${BASE}/wip-report`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3200);
  };
  await load();

  const cells = async () => page.evaluate(() => [...document.querySelectorAll('tbody tr')].map(tr => {
    const inp = tr.querySelector('input[type="month"]');
    return { deal: (tr.querySelector('td:nth-child(3)')?.innerText||'').replace(/\s+/g,' ').trim().slice(0,45), month: inp ? inp.value : null,
             w: inp ? inp.clientWidth : null, sw: inp ? inp.scrollWidth : null };
  }));
  console.log('== rows before:', JSON.stringify(await cells(), null, 0));
  console.log('   shot', await shot('before'));
  flush('load');

  // pick the first row with a month input and set it
  const target = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('tbody tr')];
    const i = trs.findIndex(tr => tr.querySelector('input[type="month"]'));
    return i;
  });
  console.log('   editable row index:', target);
  if (target >= 0) {
    const inp = page.locator('tbody tr input[type="month"]').first();
    await inp.scrollIntoViewIfNeeded();
    await inp.fill('2027-03');
    await page.waitForTimeout(500);
    await page.locator('h1').first().click({ force: true }); // blur -> flush
    await page.waitForTimeout(3000);
    console.log('   writes:', JSON.stringify([...new Set(writes)]));
    writes = [];
    console.log('   rows after save:', JSON.stringify(await cells()));
    console.log('   shot', await shot('after-save'));
    flush('save');

    // reload — did it persist?
    await load();
    const after = await cells();
    console.log('== rows after reload:', JSON.stringify(after));
    console.log('   persisted 2027-03?', after.some(r => r.month === '2027-03'));
    // does the fee-by-month chart know about it?
    console.log('   chart months:', await page.evaluate(() => {
      const c = [...document.querySelectorAll('*')].find(e => /NET FEES BY MONTH/i.test(e.textContent||'') && e.children.length < 12);
      const card = c ? c.closest('div.rounded-lg, div[class*="rounded"]') : null;
      return card ? card.innerText.replace(/\s+/g,' ').slice(0, 240) : 'no-card';
    }));
    console.log('   shot', await shot('after-reload'));
    flush('reload');

    // put it back
    const inp2 = page.locator('tbody tr input[type="month"]').first();
    await inp2.scrollIntoViewIfNeeded();
    await inp2.fill('');
    await page.waitForTimeout(400);
    await page.locator('h1').first().click({ force: true });
    await page.waitForTimeout(2500);
    console.log('   clear writes:', JSON.stringify([...new Set(writes)]));
    await load();
    console.log('   rows after clear+reload:', JSON.stringify(await cells()));
    console.log('   shot', await shot('after-clear'));
    flush('clear');
  }
} finally { await browser.close(); }
