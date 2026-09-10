// r547: Victoria (BGP staff, desktop) — a real back-office task on the WIP
// report: "find our Bluewater fee, click through to the client, then export
// the WIP to Excel for the partners' meeting."
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = 'http://localhost:5000';
const USER = 'victoria@brucegillinghampollard.com';
const PASSWORD = 'B@nd0077!';
const TAG = 'r547w';

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', acceptDownloads: true });
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

  await page.goto(`${BASE}/wip-report`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3500);
  console.log('== WIP report:', await page.evaluate(() => ({
    path: location.pathname,
    head: (document.querySelector('h1,h2')?.textContent||'').trim().slice(0,70),
    chars: (document.body.innerText||'').replace(/\s+/g,' ').length,
    rows: document.querySelectorAll('tbody tr').length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    boundary: /Something went wrong|Application error/i.test(document.body.innerText||''),
  })));
  console.log('   shot', await shot('wip'));
  flush('wip');

  // quick search box above the filters
  const sb = page.locator('input[placeholder*="earch" i]');
  console.log('   search boxes:', await sb.count());
  if (await sb.count()) {
    await sb.first().fill('Bluewater');
    await page.waitForTimeout(2000);
    console.log('   after search rows:', await page.evaluate(() => document.querySelectorAll('tbody tr').length));
    console.log('   first row:', await page.evaluate(() => (document.querySelector('tbody tr')?.innerText||'').replace(/\s+/g,' ').slice(0,220)));
    console.log('   shot', await shot('wip-search'));
    flush('wip-search');
    await sb.first().fill('');
    await page.waitForTimeout(1200);
  }

  // click through a Client / Property cell
  const linkInfo = await page.evaluate(() => {
    const a = document.querySelector('tbody tr a[href]');
    return a ? { href: a.getAttribute('href'), text: a.textContent.trim().slice(0,60) } : null;
  });
  console.log('   first row link:', JSON.stringify(linkInfo));
  if (linkInfo) {
    await page.goto(BASE + linkInfo.href, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    console.log('== click-through:', await page.evaluate(() => ({
      path: location.pathname, head: (document.querySelector('h1,h2')?.textContent||'').trim().slice(0,70),
      chars: (document.body.innerText||'').replace(/\s+/g,' ').length,
      boundary: /Something went wrong|Application error|Not found/i.test(document.body.innerText||''),
    })));
    console.log('   shot', await shot('clickthrough'));
    flush('clickthrough');
    await page.goBack().catch(() => {});
    await page.waitForTimeout(2000);
  }

  // Excel export — the API the button drives
  const exp = await ctx.request.get(`${BASE}/api/wip/export-excel`, { headers: { Authorization: `Bearer ${user.token}` } });
  const buf = await exp.body();
  console.log('== export-excel:', exp.status(), exp.headers()['content-type'], buf.length, 'bytes',
    buf.slice(0,2).toString('latin1') === 'PK' ? '(zip/xlsx magic ok)' : '(NOT a zip: ' + buf.slice(0,80).toString('utf8') + ')');

  // and via the UI button, if there is one
  const btn = page.locator('button:has-text("Export"), a:has-text("Export")');
  console.log('   export controls on page:', await btn.count());
  if (await btn.count()) {
    const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await btn.first().click();
    const d = await dl;
    console.log('   UI download:', d ? await d.suggestedFilename() : 'none within 20s');
    await page.waitForTimeout(1500);
    console.log('   shot', await shot('after-export'));
    flush('export');
  }

  // fee reconciliation + health, the two other WIP reads
  for (const p of ['/api/wip/health', '/api/wip/fee-reconciliation', '/api/wip/agent-summary']) {
    const rr = await ctx.request.get(BASE + p, { headers: { Authorization: `Bearer ${user.token}` } });
    const t = (await rr.text()).slice(0, 160);
    console.log(`   GET ${p} -> ${rr.status()} ${t}`);
  }
} finally { await browser.close(); }
