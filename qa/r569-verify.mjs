// r569 verify: the "Avg ERV £psf" KPI tile on the tenancy board — both
// personas, both widths — reads a real rate instead of "—", and agrees with
// the ERV (pa) / NIA columns of the rows it is computed from.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = 'http://localhost:5000';
const PROP = 'cccccccc-0000-0000-0000-000000000001';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });

for (const [who, email] of [['victoria', 'victoria@brucegillinghampollard.com'], ['mark', 'mark.warne@landsec.com']]) {
  for (const [mode, vp, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, ...(mobile ? { userAgent: IPHONE_UA } : {}) });
    const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: email, password: 'B@nd0077!' } });
    const u = await r.json();
    if (!u.token) { console.log(`${who}/${mode}: LOGIN FAILED`); await ctx.close(); continue; }
    const page = await ctx.newPage();
    await page.goto(BASE).catch(() => {});
    await page.evaluate(([t, uu]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(uu)); }, [u.token, u]);
    await page.goto(`${BASE}/tenancy-schedule/${PROP}`).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    const tile = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="tenancy-stat-avg-erv-£psf"]');
      if (!el) return null;
      const v = el.querySelector('.tabular-nums');
      return { text: el.innerText.replace(/\n+/g, ' | '), title: v ? v.getAttribute('title') : null };
    });
    // Same figure straight from the payload the board rendered from.
    const api = await ctx.request.get(`${BASE}/api/tenancy-schedule/property/${PROP}`);
    const rows = await api.json();
    const list = Array.isArray(rows) ? rows : (rows.units || []);
    const priced = list.filter(x => Number(x.erv_pa) > 0 && Number(x.nia_sqft) > 0);
    const expect = priced.reduce((s, x) => s + Number(x.erv_pa), 0) / priced.reduce((s, x) => s + Number(x.nia_sqft), 0);
    console.log(`${who}/${mode}  tile: ${tile ? tile.text : 'TILE NOT FOUND'}`);
    console.log(`             title: ${tile ? tile.title : '-'}`);
    console.log(`             payload expects ${expect.toFixed(2)} psf from ${priced.length}/${list.length} rows`);
    await page.screenshot({ path: `qa/smoke-shots/r569-${who}-${mode}-erv-tile.png` });
    await ctx.close();
  }
}
await browser.close();
