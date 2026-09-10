// r547: Victoria (BGP staff, desktop) — "clear my notifications": open the
// bell, read what's there, click one through, mark it read, watch the badge.
// Plus the global ⌘K search as staff. Both under-worked surfaces.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = 'http://localhost:5000';
const USER = 'victoria@brucegillinghampollard.com';
const PASSWORD = 'B@nd0077!';
const TAG = 'r547n';

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
  const flush = (l) => { const s = [...new Set(bucket)]; bucket = []; if (s.length) console.log(`   [${l}] ` + s.join('\n   ')); };
  let step = 0;
  const shot = async (l) => { step++; const p = `qa/smoke-shots/${TAG}-${String(step).padStart(2,'0')}-${l}.png`; await page.screenshot({ path: p }); return p; };

  await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('bgp_auth_token', tok); localStorage.setItem('authToken', tok);
    localStorage.setItem('user', JSON.stringify(u));
  }, [user.token, user]);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  const badge = async () => page.evaluate(() => {
    const b = document.querySelector('button:has(svg.lucide-bell)');
    return b ? b.innerText.replace(/\s+/g, '') : 'no-bell';
  });
  console.log('== badge before:', await badge());
  const bell = page.locator('button:has(svg.lucide-bell)').first();
  await bell.click();
  await page.waitForTimeout(2500);
  const panelText = await page.evaluate(() => {
    const p = document.querySelector('[data-radix-popper-content-wrapper]') || document.querySelector('[role="dialog"]');
    return p ? p.innerText.replace(/\s+/g, ' ').slice(0, 1200) : 'no-panel';
  });
  console.log('== panel:', panelText);
  console.log('   shot', await shot('bell-open'));
  flush('bell');

  // structure: how many rows, do they look clickable, is there a mark-all
  const struct = await page.evaluate(() => {
    const p = document.querySelector('[data-radix-popper-content-wrapper]') || document.querySelector('[role="dialog"]');
    if (!p) return null;
    const clickable = [...p.querySelectorAll('button,a[href],[role="button"]')].map(e => (e.innerText||'').replace(/\s+/g,' ').trim().slice(0,60)).filter(Boolean);
    return { clickable, htmlLen: p.innerHTML.length };
  });
  console.log('   clickable in panel:', JSON.stringify(struct?.clickable));

  // click the first notification row through
  const before = page.url();
  const clicked = await page.evaluate(() => {
    const p = document.querySelector('[data-radix-popper-content-wrapper]') || document.querySelector('[role="dialog"]');
    if (!p) return 'no-panel';
    const rows = [...p.querySelectorAll('[data-testid*="notification"], a[href], button')]
      .filter(e => (e.innerText||'').trim().length > 12 && !/Mark all|Notifications|View all|Settings/i.test(e.innerText));
    if (!rows.length) return 'no-row';
    rows[0].click(); return 'clicked: ' + rows[0].innerText.replace(/\s+/g,' ').slice(0,80);
  });
  console.log('   row click:', clicked);
  await page.waitForTimeout(3000);
  console.log('   url after:', page.url().replace(BASE, '') , '(was', before.replace(BASE,'') + ')');
  console.log('   shot', await shot('after-row-click'));
  flush('row-click');

  // badge after
  await page.waitForTimeout(1500);
  console.log('== badge after:', await badge());

  // API view of notifications
  for (const p of ['/api/notifications', '/api/notifications/unread-count']) {
    const rr = await ctx.request.get(BASE + p, { headers: { Authorization: `Bearer ${user.token}` } });
    console.log(`   GET ${p} -> ${rr.status()} ${(await rr.text()).slice(0, 300)}`);
  }

  // global ⌘K search as staff — find a property, a person and a deal
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  await page.keyboard.press('Meta+k').catch(() => {});
  await page.waitForTimeout(800);
  let opened = await page.evaluate(() => !!document.querySelector('[cmdk-root], [role="dialog"] input'));
  if (!opened) { const el = page.locator('input[placeholder^="Search"]'); if (await el.count()) { await el.first().click(); await page.waitForTimeout(700); opened = true; } }
  console.log('== search opened:', opened);
  if (opened) {
    for (const q of ['Bluewater', 'Starbucks', 'Broadgate']) {
      const inp = page.locator('[cmdk-root] input, [role="dialog"] input').first();
      await inp.fill(q);
      await page.waitForTimeout(2200);
      console.log(`   "${q}" ->`, await page.evaluate(() => {
        const root = document.querySelector('[cmdk-root]') || document.querySelector('[role="dialog"]');
        return root ? root.innerText.replace(/\s+/g, ' ').slice(0, 500) : 'no-root';
      }));
    }
    console.log('   shot', await shot('search'));
    flush('search');
  }
} finally { await browser.close(); }
