// r547 targeted task: Mark Warne (Landsec) on desktop —
// "We're pitching a fashion brand for a Bluewater unit. Add it to my CRM,
//  open its profile, check it's in my brands hub, then take it out again."
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = 'http://localhost:5000';
const USER = 'mark.warne@landsec.com';
const PASSWORD = 'B@nd0077!';
const TAG = 'r547c';

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
  if (!user.token) { console.error('login failed', JSON.stringify(user).slice(0, 300)); process.exit(2); }
  const page = await ctx.newPage();
  let bucket = [];
  page.on('response', (res) => { if (res.status() >= 400) bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE, '')}`); });
  page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0, 250)}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (/Failed to load resource/.test(t)) return;
    bucket.push(`CONSOLE ${t.slice(0, 220)}`);
  });

  await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('bgp_auth_token', tok);
    localStorage.setItem('authToken', tok);
    localStorage.setItem('user', JSON.stringify(u));
  }, [user.token, user]);

  let step = 0;
  const shot = async (l) => { step++; const p = `qa/smoke-shots/${TAG}-${String(step).padStart(2,'0')}-${l}.png`; await page.screenshot({ path: p, fullPage: false }); return p; };
  const flush = (l) => { const s = [...new Set(bucket)]; bucket = []; if (s.length) console.log(`   [${l}] ` + s.join('\n   ')); };

  // 1. Brands hub
  await page.goto(`${BASE}/brands`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  console.log('== brands hub:', await page.evaluate(() => location.pathname + ' | ' + (document.querySelector('h1,h2')?.textContent||'').trim().slice(0,70) + ' | ' + (document.body.innerText||'').replace(/\s+/g,' ').length + ' chars'));
  console.log('   shot', await shot('brands-hub'));
  flush('hub');

  // brands visible before
  const before = await page.evaluate(() => (document.body.innerText||'').replace(/\s+/g,' '));
  console.log('   Testco Fashion visible before add?', /Testco Fashion/.test(before));

  // 2. Add brand dialog
  const addBtn = page.locator('[data-testid="client-add-brand"]');
  console.log('   add-brand button count:', await addBtn.count());
  if (!(await addBtn.count())) { console.log('!! no Add brand button for the client'); }
  else {
    await addBtn.first().click();
    await page.waitForTimeout(600);
    await page.locator('[data-testid="client-add-brand-search"]').fill('Testco');
    await page.waitForTimeout(1800);
    console.log('   results:', await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] .rounded.border')].map(d => d.innerText.replace(/\s+/g,' ').trim()).join(' || ')));
    console.log('   shot', await shot('add-dialog-results'));
    flush('search');

    // click Add on Testco Fashion row
    const row = page.locator('[role="dialog"] div').filter({ hasText: /^Testco Fashion/ });
    const addRowBtn = page.locator('[role="dialog"] button', { hasText: /^Add$/ });
    const n = await addRowBtn.count();
    console.log('   Add buttons in dialog:', n);
    // find the specific row's Add
    const clicked = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[role="dialog"] div.rounded.border')];
      const t = rows.find(r => /Testco Fashion/.test(r.innerText));
      if (!t) return 'row-not-found';
      const b = [...t.querySelectorAll('button')].find(b => /Add/.test(b.innerText));
      if (!b) return 'add-button-not-found';
      b.click(); return 'clicked';
    });
    console.log('   add click:', clicked);
    await page.waitForTimeout(2500);
    console.log('   after add row text:', await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[role="dialog"] div.rounded.border')];
      const t = rows.find(r => /Testco Fashion/.test(r.innerText));
      return t ? t.innerText.replace(/\s+/g,' ').trim() : 'gone';
    }));
    console.log('   toast:', await page.evaluate(() => (document.body.innerText.match(/Brand added[^\n]*|Couldn't add brand[^\n]*/)||[''])[0]));
    console.log('   shot', await shot('after-add'));
    flush('add');

    // 3. Does the name become a link to the profile?
    const link = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[role="dialog"] div.rounded.border')];
      const t = rows.find(r => /Testco Fashion/.test(r.innerText));
      const a = t && t.querySelector('a[href]');
      return a ? a.getAttribute('href') : null;
    });
    console.log('   profile link in dialog:', link);

    // close dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);

    // 4. Is it now in the hub list?
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => (document.body.innerText||'').replace(/\s+/g,' '));
    console.log('   Testco Fashion visible in hub after add?', /Testco Fashion/.test(after));
    console.log('   shot', await shot('hub-after-add'));
    flush('hub-after');

    // 5. Open its profile
    if (link) {
      await page.goto(BASE + link, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(3000);
      const info = await page.evaluate(() => ({
        path: location.pathname,
        head: (document.querySelector('h1,h2')?.textContent||'').trim().slice(0,80),
        chars: (document.body.innerText||'').replace(/\s+/g,' ').trim().length,
        boundary: /Something went wrong|Application error|Access denied|not authorised|Not authorized/i.test(document.body.innerText||''),
      }));
      console.log('== profile:', JSON.stringify(info));
      console.log('   shot', await shot('brand-profile'));
      flush('profile');
    }
  }

  // 6. Remove it again (API-level via the UI dialog)
  await page.goto(`${BASE}/brands`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
  if (await page.locator('[data-testid="client-add-brand"]').count()) {
    await page.locator('[data-testid="client-add-brand"]').first().click();
    await page.waitForTimeout(500);
    await page.locator('[data-testid="client-add-brand-search"]').fill('Testco Fashion');
    await page.waitForTimeout(1800);
    const rm = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[role="dialog"] div.rounded.border')];
      const t = rows.find(r => /Testco Fashion/.test(r.innerText));
      if (!t) return 'row-not-found';
      const b = [...t.querySelectorAll('button')].find(b => /Remove/.test(b.innerText));
      if (!b) return 'remove-not-found: ' + t.innerText.replace(/\s+/g,' ');
      b.click(); return 'clicked';
    });
    console.log('   remove click:', rm);
    await page.waitForTimeout(2000);
    console.log('   shot', await shot('after-remove'));
    flush('remove');
  }
} finally {
  await browser.close();
}
