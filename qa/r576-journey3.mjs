// r576 journey part 3 — Mark edits a unit on the phone, saves, reloads.
import { chromium } from 'playwright';
import { existsSync } from 'fs';
const BASE = 'http://127.0.0.1:5000';
const USER = 'mark.warne@landsec.com', PASSWORD = 'B@nd0077!';
const SHOT = 'qa/smoke-shots';
const UNIT = process.env.QA_UNIT || '36c81e04-6f16-4951-8ea7-cbaf16b83741';
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: ['--no-sandbox'] });
const raw = browser.newContext.bind(browser);
browser.newContext = async (o) => { const c = await raw(o); await c.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, r => r.abort()); return c; };
const MOBILE = { viewport: { width: 390, height: 780 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Europe/London' };
const ctx = await browser.newContext(MOBILE);
const user = await (await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } })).json();
const TOKEN = user.token;
const api = async (p) => { const res = await fetch(`${BASE}${p}`, { headers: { Authorization: 'Bearer ' + TOKEN } }); let j=null; try{j=await res.json();}catch{} return { status: res.status, body: j }; };
const page = await ctx.newPage();
const net = [];
page.on('response', res => { const u = res.url(); if (u.includes('/api/') && res.status() >= 400) net.push(`${res.status()} ${res.request().method()} ${u.replace(BASE,'')}`); });
page.on('pageerror', e => console.log('  [pageerror]', e.message));
await page.goto(BASE);
await page.evaluate(([t,u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [TOKEN, user]);
await page.goto(`${BASE}/available`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
await page.locator(`[data-testid="unit-edit-${UNIT}"]`).click();
await page.waitForTimeout(2000);
const dlg = page.locator('[role="dialog"]').first();
// Fill size + quoting rent as a landlord would on the move
const setField = async (labelRe, value) => {
  const lab = dlg.locator('label').filter({ hasText: labelRe }).first();
  const forId = await lab.getAttribute('for');
  let input;
  if (forId) input = dlg.locator(`#${CSS.escape ? forId : forId}`);
  if (!forId || !(await input.count())) {
    input = lab.locator('xpath=following::input[1]');
  }
  await input.first().fill(String(value));
  console.log(`  [fill] ${labelRe} = ${value}`);
};
await setField('Size (sq ft)', 4321);
await setField('Quoting Rent', 250000);
await page.screenshot({ path: `${SHOT}/r576-phone-edit-filled.png` });
await dlg.getByRole('button', { name: /^Save$/ }).click();
await page.waitForTimeout(4000);
console.log('[phone] dialog still open after save:', await page.locator('[role="dialog"]').count());
const after = await api(`/api/available-units/${UNIT}`);
console.log('[api] unit after save:', JSON.stringify({ sqft: after.body?.sqft, askingRent: after.body?.askingRent, dealId: after.body?.dealId }));
if (after.body?.dealId) {
  const d = await api(`/api/crm/deals/${after.body.dealId}`);
  console.log('[api] linked deal:', d.status, JSON.stringify({ rentPa: d.body?.rentPa, totalAreaSqft: d.body?.totalAreaSqft, status: d.body?.status }));
}
// ── reload the phone list, read the card ───────────────────────────────────
await page.goto(`${BASE}/available`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
const card = page.locator(`[data-testid="mobile-unit-${UNIT}"]`);
console.log('──── PHONE card after reload ────\n' + (await card.count() ? await card.innerText() : 'CARD MISSING'));
await card.scrollIntoViewIfNeeded().catch(()=>{});
await page.screenshot({ path: `${SHOT}/r576-phone-card-after.png` });
// ── same record on the desktop ─────────────────────────────────────────────
const dctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const dpage = await dctx.newPage();
await dpage.goto(BASE);
await dpage.evaluate(([t,u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [TOKEN, user]);
await dpage.goto(`${BASE}/available`, { waitUntil: 'domcontentloaded' });
await dpage.waitForTimeout(8000);
const row = dpage.locator(`tr:has-text("MSU9")`).first();
console.log('──── DESKTOP row ────\n' + (await row.count() ? (await row.innerText()).replace(/\n/g,' | ') : 'ROW MISSING'));
await dpage.screenshot({ path: `${SHOT}/r576-desktop-row-after.png` });
console.log('\n──── NET (>=400) ────'); net.forEach(n => console.log('  ' + n));
await browser.close();
