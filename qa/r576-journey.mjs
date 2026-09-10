// r576 journey probe — Landsec client on the phone (390px, iPhone UA + touch).
import { chromium } from 'playwright';
import { existsSync } from 'fs';
const BASE = 'http://127.0.0.1:5000';
const USER = 'mark.warne@landsec.com';
const PASSWORD = 'B@nd0077!';
const SHOT = 'qa/smoke-shots';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
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
if (!user.token) { console.log('LOGIN FAILED', JSON.stringify(user).slice(0,200)); process.exit(1); }
const TOKEN = user.token;
const page = await ctx.newPage();
const net = [];
page.on('response', res => { const u = res.url(); if (u.includes('/api/')) net.push(`${res.status()} ${res.request().method()} ${u.replace(BASE,'')}`); });
page.on('pageerror', e => console.log('  [pageerror]', e.message));
await page.goto(BASE);
await page.evaluate(([t,u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [TOKEN, user]);

const api = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: 'Bearer ' + TOKEN } });
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};

// ── node-side truth ────────────────────────────────────────────────────────
const units = await api('/api/available-units');
const deals = await api('/api/crm/deals');
console.log(`[api] /api/available-units -> ${units.status} n=${Array.isArray(units.body)?units.body.length:'?'}`);
console.log(`[api] /api/crm/deals       -> ${deals.status} n=${Array.isArray(deals.body)?deals.body.length:'?'}`);
if (Array.isArray(units.body)) {
  const byMk = {};
  for (const u of units.body) { const k = String(u.marketingStatus ?? 'null'); byMk[k] = (byMk[k]||0)+1; }
  console.log('[api] unit marketingStatus census:', JSON.stringify(byMk));
  const withDeal = units.body.filter(u => u.dealId).length;
  console.log(`[api] units with dealId: ${withDeal} / ${units.body.length}`);
}
if (Array.isArray(deals.body)) {
  const byS = {}; for (const d of deals.body) { const k = String(d.status ?? 'null'); byS[k]=(byS[k]||0)+1; }
  console.log('[api] deal status census:', JSON.stringify(byS));
}

// ── phone home ─────────────────────────────────────────────────────────────
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(()=>{});
await page.waitForTimeout(6000);
await page.screenshot({ path: `${SHOT}/r576-phone-home.png`, fullPage: true });
const homeText = await page.evaluate(() => document.body.innerText);
console.log('\n──── PHONE HOME TEXT ────\n' + homeText.slice(0, 2500));
console.log('\n──── NET (>=400) ────');
for (const n of net) if (!n.startsWith('2') && !n.startsWith('3')) console.log('  ' + n);
await browser.close();
