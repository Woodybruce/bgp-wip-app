// r581: the "Working on right now" card on an agent's own HR profile.
// A deal at heads of terms rendered its RAW CODE ("HOT") where every other
// stage reads a sentence, drew a grey bar, and sorted below Speculative.
import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const tag = process.argv[2] || 'x';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)));

const r = await ctx.request.post('http://localhost:5000/api/auth/login', { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await r.json();
if (!user.token) throw new Error('login failed: ' + JSON.stringify(user).slice(0, 200));
await p.goto('http://localhost:5000');
await p.evaluate(([tok, u]) => { localStorage.setItem('authToken', tok); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);

// The endpoint the card reads, in server order.
const api = await (await ctx.request.get(`http://localhost:5000/api/hr/staff/${user.id}/active-deals`, { headers: { Authorization: `Bearer ${user.token}` } })).json();
console.log('API order:', JSON.stringify(api.map(d => `${d.status} ${d.name}`), null, 0));

// A cold deep link to /hr?person= bounces to "/" — warm the SPA on /hr first,
// then push the person query through the router.
await p.goto('http://localhost:5000/hr', { waitUntil: 'networkidle' })
  .catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await p.waitForTimeout(3000);
await p.evaluate((id) => { window.history.pushState({}, '', `/hr?person=${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, user.id);
await p.waitForTimeout(6000);
console.log('url:', p.url(), '| body:', (await p.locator('body').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,200));
const card = p.locator('div:has(> div > div:has-text("Working on right now"))').last();
const probe = p.locator('[data-testid^="active-deal-dddd5581"]');
const n = await probe.count();
console.log('probe rows rendered:', n);
for (let i = 0; i < n; i++) {
  const el = probe.nth(i);
  const txt = (await el.innerText()).replace(/\s+/g, ' ');
  const bar = await el.locator('span').first().getAttribute('class');
  console.log(`  ${txt}   || bar=${(bar || '').replace(/.*(bg-[\w-/]+).*/, '$1')}`);
}
const shot = p.locator('[data-testid^="active-deal-"]').first();
if (await shot.count()) {
  await shot.scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
}
await p.screenshot({ path: `qa/smoke-shots/r581-activedeals-${tag}.png`, fullPage: false });
await b.close();
