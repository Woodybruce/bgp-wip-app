// r611: does the leasing-schedule board's per-property "N expiring" badge agree
// with the same page's own "Expiring soon" KPI tile and its expiring filter?
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const TAG = process.env.QA_TAG || 'r611';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/*', (r) => r.request().url().startsWith(BASE) || /^(data|blob):/.test(r.request().url()) ? r.continue() : r.abort());
const lr = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await lr.json();
if (!user.token) { console.error('login failed', JSON.stringify(user).slice(0,200)); process.exit(2); }
const page = await ctx.newPage();
await page.goto(BASE).catch(e => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([t,u]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);

const api = async (p) => (await ctx.request.get(`${BASE}${p}`, { headers: { Authorization: `Bearer ${user.token}` } })).json();
const props = await api('/api/leasing-schedule/properties');
const bw = props.find(p => /Bluewater/i.test(p.name));
console.log(`API /api/leasing-schedule/properties -> Bluewater expiring_soon = ${bw.expiring_soon}  (unit_count ${bw.unit_count})`);

await page.goto(`${BASE}/leasing-schedule`).catch(()=>{});
await page.waitForTimeout(6000);
await page.screenshot({ path: `qa/smoke-shots/${TAG}-01-board.png`, fullPage: false });
const badge = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('*')].filter(e => /Bluewater/.test(e.textContent||'') && e.children.length < 12);
  const txt = rows.map(e => (e.innerText||'').replace(/\s+/g,' ').trim()).filter(t => t.length < 260 && /Bluewater/.test(t));
  return txt.slice(0,4);
});
console.log('board row text:', JSON.stringify(badge));

await page.goto(`${BASE}/leasing-schedule/cccccccc-0000-0000-0000-000000000001`).catch(()=>{});
await page.waitForTimeout(8000);
await page.screenshot({ path: `qa/smoke-shots/${TAG}-02-bluewater.png` });
const kpi = await page.evaluate(() => {
  const t = (document.body.innerText||'').replace(/\s+/g,' ');
  const m = t.match(/(\d+)\s*Expiring[^|]{0,40}/gi) || [];
  const m2 = t.match(/Expiring[^0-9]{0,20}(\d+)/gi) || [];
  return { hits: [...m, ...m2].slice(0,8) };
});
console.log('unit-page KPI text hits:', JSON.stringify(kpi));
await browser.close();
