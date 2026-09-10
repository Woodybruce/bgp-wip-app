// r568 verify: the phone tenancy card's headline money figure, both personas,
// plus the same-record desktop diff.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = 'http://localhost:5000';
const PROP = 'cccccccc-0000-0000-0000-000000000001';
const CASES = [
  ['MSU4',  'c6692824-5db7-4da1-a4d5-44b101b00442', 'Occupied, ERV 2,541,000'],
  ['MSU6',  'b2296949-12cb-4727-bd31-25df24b73ea6', 'Vacant, ERV 958,650'],
  ['U075A', 'c4265ac0-4335-4100-b4b2-e5d5aed92521', 'Vacant, ERV 491,260'],
];
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });

for (const [who, email] of [['mark', 'mark.warne@landsec.com'], ['victoria', 'victoria@brucegillinghampollard.com']]) {
  for (const [mode, vp, mobile] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1440, height: 900 }, false]]) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, ...(mobile ? { userAgent: IPHONE_UA } : {}) });
    const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: email, password: 'B@nd0077!' } });
    const u = await r.json();
    if (!u.token) { console.log(`${who}/${mode}: LOGIN FAILED`); await ctx.close(); continue; }
    const page = await ctx.newPage();
    await page.goto(BASE).catch(() => {});
    await page.evaluate(([t, uu]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(uu)); }, [u.token, u]);
    for (const [label, id, note] of CASES) {
      await page.goto(`${BASE}/tenancy-schedule/${PROP}`).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      const search = page.locator('[data-testid="tenancy-search"]').first();
      await search.fill(label).catch((e) => console.log('   (search fill failed)', String(e).slice(0, 80)));
      await page.waitForTimeout(1500);
      const txt = await page.evaluate((rid) => {
        const card = document.querySelector(`[data-testid="tenancy-card-${rid}"]`);
        const row = document.querySelector(`[data-testid="tenancy-row-${rid}"]`) ||
          [...document.querySelectorAll('tr')].find(tr => tr.innerHTML.includes(rid));
        return { card: card ? card.innerText.replace(/\n+/g, ' | ') : null, row: row ? row.innerText.replace(/\n|\t/g, ' | ') : null };
      }, id);
      console.log(`${who}/${mode} ${label} (${note})`);
      console.log(`   card: ${txt.card ? txt.card.slice(0, 200) : '(no card — desktop sheet)'}`);
      if (mode === 'desktop') console.log(`   row : ${txt.row ? txt.row.slice(0, 400) : '(no row)'}`);
      if (mode === 'phone') await page.screenshot({ path: `qa/smoke-shots/r568-${who}-${label}.png` });
    }
    await ctx.close();
  }
}
await browser.close();
