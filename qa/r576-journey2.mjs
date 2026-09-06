// r576 journey part 2 — Mark on the phone: open the tracker, edit a unit, reload.
import { chromium } from 'playwright';
import { existsSync } from 'fs';
const BASE = 'http://127.0.0.1:5000';
const USER = 'mark.warne@landsec.com';
const PASSWORD = 'B@nd0077!';
const SHOT = 'qa/smoke-shots';
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: ['--no-sandbox'] });
const raw = browser.newContext.bind(browser);
browser.newContext = async (o) => { const c = await raw(o); await c.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, r => r.abort()); return c; };
const MOBILE = {
  viewport: { width: 390, height: 780 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Europe/London',
};
const ctx = await browser.newContext(MOBILE);
const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
const user = await r.json();
const TOKEN = user.token;
const api = async (p, m='GET', b) => {
  const res = await fetch(`${BASE}${p}`, { method: m, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  let j=null; try { j = await res.json(); } catch {}
  return { status: res.status, body: j };
};
const page = await ctx.newPage();
const net = [];
page.on('response', res => { const u = res.url(); if (u.includes('/api/') && res.status() >= 400) net.push(`${res.status()} ${res.request().method()} ${u.replace(BASE,'')}`); });
page.on('pageerror', e => console.log('  [pageerror]', e.message));
await page.goto(BASE);
await page.evaluate(([t,u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [TOKEN, user]);

await page.goto(`${BASE}/available`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
await page.screenshot({ path: `${SHOT}/r576-phone-tracker.png`, fullPage: false });
const cards = await page.locator('[data-testid^="mobile-unit-"]').count();
console.log(`[phone] mobile unit cards rendered: ${cards}`);
if (!cards) { console.log('[phone] NO MOBILE CARDS — desktop branch?', (await page.evaluate(()=>document.body.innerText)).slice(0,800)); }
const firstText = cards ? await page.locator('[data-testid^="mobile-unit-"]').first().innerText() : '';
console.log('──── first card ────\n' + firstText);
const unitId = cards ? (await page.locator('[data-testid^="mobile-unit-"]').first().getAttribute('data-testid')).replace('mobile-unit-','') : null;
console.log('[phone] first unit id', unitId);
const before = await api(`/api/available-units/${unitId}`);
console.log('[api] unit before:', JSON.stringify({ unitName: before.body?.unitName, sqft: before.body?.sqft, askingRent: before.body?.askingRent, comments: before.body?.comments, floor: before.body?.floor, marketingStatus: before.body?.marketingStatus }));

// ── open Edit on the phone ────────────────────────────────────────────────
await page.locator(`[data-testid="unit-edit-${unitId}"]`).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOT}/r576-phone-unit-edit.png`, fullPage: false });
const dlg = page.locator('[role="dialog"]');
console.log('[phone] edit dialog open:', await dlg.count());
if (await dlg.count()) {
  const m = await dlg.first().evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  console.log('[phone] dialog overflow', JSON.stringify(m));
  const txt = await dlg.first().innerText();
  console.log('──── edit dialog text ────\n' + txt.slice(0, 1800));
}
console.log('\n──── NET (>=400) ────'); net.forEach(n => console.log('  ' + n));
await browser.close();
