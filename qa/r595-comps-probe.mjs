// r595: why does the client /comps page have no "Net Effective" text?
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5000';
const PASSWORD = 'B@nd0077!';

async function login(context, username) {
  const r = await context.request.post(`${BASE}/api/auth/login`, { data: { username, password: PASSWORD } });
  const user = await r.json();
  if (!user.token) throw new Error(`login failed: ${JSON.stringify(user).slice(0,200)}`);
  const page = await context.newPage();
  await page.goto(BASE);
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('authToken', tok);
    localStorage.setItem('user', JSON.stringify(u));
  }, [user.token, user]);
  return { page, token: user.token };
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
for (const who of ['mark.warne@landsec.com', 'victoria@brucegillinghampollard.com']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, token } = await login(ctx, who);
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0,200)); });
  const bad = [];
  page.on('response', res => { if (res.url().includes('/api/') && res.status() >= 400) bad.push(`${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`); });

  await page.goto(`${BASE}/comps`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  const netEff = await page.getByText(/net effective/i).count();
  const rows = await page.locator('tbody tr').count();
  const ths = await page.locator('th').allInnerTexts();
  const body = (await page.locator('body').innerText()).slice(0, 900);
  const api = await page.evaluate(async () => {
    const r = await fetch('/api/comps', { headers: { Authorization: 'Bearer ' + localStorage.getItem('authToken') } });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, n: Array.isArray(j) ? j.length : (j && typeof j === 'object' ? Object.keys(j) : j) };
  });
  console.log('=====', who);
  console.log('netEffective text count:', netEff, '| tbody rows:', rows);
  console.log('GET /api/comps ->', JSON.stringify(api));
  console.log('th headers:', JSON.stringify(ths));
  console.log('4xx:', bad.slice(0, 12));
  console.log('errors:', errs.slice(0, 8));
  console.log('BODY:\n' + body);
  await page.screenshot({ path: `/tmp/r595-comps-${who.split('@')[0]}.png`, fullPage: false });
  await ctx.close();
}
await browser.close();
