// r547: Mark Warne (Landsec, desktop) — does a self-added brand actually turn
// up where he'd look for it? Brand Explorer list, the global ⌘K search, and
// the notifications bell (all under-worked surfaces).
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = 'http://localhost:5000';
const USER = process.env.QA_USER || 'mark.warne@landsec.com';
const PASSWORD = 'B@nd0077!';
const TAG = process.env.QA_TAG || 'r547e';

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
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) bucket.push(`CONSOLE ${msg.text().slice(0,200)}`); });
  const flush = (l) => { const s = [...new Set(bucket)]; bucket = []; if (s.length) console.log(`   [${l}] ` + s.join('\n   ')); };
  let step = 0;
  const shot = async (l) => { step++; const p = `qa/smoke-shots/${TAG}-${String(step).padStart(2,'0')}-${l}.png`; await page.screenshot({ path: p }); return p; };

  await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('bgp_auth_token', tok); localStorage.setItem('authToken', tok);
    localStorage.setItem('user', JSON.stringify(u));
  }, [user.token, user]);

  const explorerNames = async () => {
    await page.goto(`${BASE}/brands?tab=explorer`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    const tab = page.locator('button', { hasText: /^BRAND EXPLORER$/i });
    if (await tab.count()) { await tab.first().click(); await page.waitForTimeout(2200); }
    return await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  };

  // A) explorer BEFORE the add
  let txt = await explorerNames();
  console.log('== explorer BEFORE add: Testco Fashion?', /Testco Fashion/.test(txt), '| Testco Ramen?', /Testco Ramen/.test(txt));
  console.log('   shot', await shot('explorer-before'));
  flush('explorer-before');

  // B) add it via the dialog
  await page.locator('[data-testid="client-add-brand"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="client-add-brand-search"]').fill('Testco Fashion');
  await page.waitForTimeout(1800);
  console.log('   add click:', await page.evaluate(() => {
    const t = [...document.querySelectorAll('[role="dialog"] div.rounded.border')].find(r => /Testco Fashion/.test(r.innerText));
    if (!t) return 'row-not-found';
    const b = [...t.querySelectorAll('button')].find(b => /^Add$/.test(b.innerText.trim()));
    if (!b) return 'no-add-button (' + t.innerText.replace(/\s+/g,' ') + ')';
    b.click(); return 'clicked';
  }));
  await page.waitForTimeout(2500);
  console.log('   toast:', await page.evaluate(() => (document.body.innerText.match(/Brand added[^\n]*|Couldn't add brand[^\n]*/)||[''])[0]));
  console.log('   shot', await shot('added'));
  flush('add');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  // C) explorer AFTER the add
  txt = await explorerNames();
  console.log('== explorer AFTER add: Testco Fashion?', /Testco Fashion/.test(txt));
  console.log('   shot', await shot('explorer-after'));
  flush('explorer-after');

  // D) global search for it
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
  const searchBox = page.locator('input[placeholder*="Search" i], [role="button"]:has-text("Search")').first();
  const searchTrigger = page.locator('button:has-text("Search"), div:has-text("⌘ K")').first();
  await page.keyboard.press('Meta+k').catch(() => {});
  await page.waitForTimeout(700);
  let opened = await page.evaluate(() => !!document.querySelector('[cmdk-root], [role="dialog"] input'));
  if (!opened) {
    const el = page.locator('input[placeholder^="Search"]');
    if (await el.count()) { await el.first().click(); await page.waitForTimeout(600); }
    else { const b = page.locator('text=Search...').first(); if (await b.count()) { await b.click(); await page.waitForTimeout(600); } }
    opened = await page.evaluate(() => !!document.querySelector('[cmdk-root], [role="dialog"] input'));
  }
  console.log('== global search opened:', opened);
  console.log('   shot', await shot('search-open'));
  if (opened) {
    const inp = page.locator('[cmdk-root] input, [role="dialog"] input').first();
    await inp.fill('Testco');
    await page.waitForTimeout(2500);
    const res = await page.evaluate(() => {
      const root = document.querySelector('[cmdk-root]') || document.querySelector('[role="dialog"]');
      return root ? root.innerText.replace(/\s+/g, ' ').slice(0, 1200) : 'no-root';
    });
    console.log('   results:', res);
    console.log('   shot', await shot('search-testco'));
    flush('search');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // E) notifications bell
  await page.waitForTimeout(500);
  const bell = page.locator('button:has(svg.lucide-bell), [data-testid*="notification"]').first();
  console.log('== bell present:', await bell.count());
  if (await bell.count()) {
    await bell.click({ force: true });
    await page.waitForTimeout(2200);
    console.log('   panel:', await page.evaluate(() => {
      const p = document.querySelector('[role="dialog"],[data-radix-popper-content-wrapper]');
      return p ? p.innerText.replace(/\s+/g, ' ').slice(0, 700) : 'no-panel';
    }));
    console.log('   shot', await shot('notifications'));
    flush('notifications');
  }

  // F) leave the CRM as we found it
  await page.goto(`${BASE}/brands`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.locator('[data-testid="client-add-brand"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="client-add-brand-search"]').fill('Testco Fashion');
  await page.waitForTimeout(1800);
  console.log('   cleanup remove:', await page.evaluate(() => {
    const t = [...document.querySelectorAll('[role="dialog"] div.rounded.border')].find(r => /Testco Fashion/.test(r.innerText));
    const b = t && [...t.querySelectorAll('button')].find(b => /Remove/.test(b.innerText));
    if (!b) return 'nothing to remove';
    b.click(); return 'removed';
  }));
  await page.waitForTimeout(1500);
} finally { await browser.close(); }
