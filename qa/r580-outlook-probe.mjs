// r580: does the firm's forward book keep a deal when it steps FORWARD out of
// Negotiating into HOTs? Reads /finance as Woody (equity) — the WIP pipeline
// headline and the Company outlook stage breakdown.
import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const tag = process.argv[2] || 'x';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)));

const r = await ctx.request.post('http://localhost:5000/api/auth/login', { data: { username: 'woody@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await r.json();
if (!user.token) throw new Error('login failed: ' + JSON.stringify(user).slice(0, 200));
try { await p.goto('http://localhost:5000', { waitUntil: 'domcontentloaded' }); } catch { await p.goto('http://localhost:5000', { waitUntil: 'domcontentloaded' }); }
await p.evaluate(([tok, u]) => { localStorage.setItem('authToken', tok); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);

// Payload truth first — refresh=1 so the Xero forecast is not served stale.
const fin = await (await ctx.request.get('http://localhost:5000/api/xero/financials?refresh=1', { headers: { Authorization: `Bearer ${user.token}` } })).json();
const cash = await (await ctx.request.get('http://localhost:5000/api/cashflow', { headers: { Authorization: `Bearer ${user.token}` } })).json();
const w = fin.wip || {};
console.log('WIP pipeline buckets   :', JSON.stringify(w.pipeline));
console.log('WIP unweighted / weighted:', w.unweightedPipeline, '/', w.weightedPipeline);
const bs = cash?.deals?.byStage || {};
console.log('cashflow byStage       :', JSON.stringify(Object.fromEntries(Object.entries(bs).map(([k, v]) => [k, { u: v.unweighted, w: v.weighted, n: v.count }]))));
const probeIn = Object.entries(bs).flatMap(([k, v]) => (v.deals || []).filter(d => d.name?.startsWith('R580')).map(d => `${k}:${d.name} £${d.fee}->£${d.weighted}`));
console.log('probe deal in forward book:', probeIn.length ? probeIn.join(', ') : 'ABSENT');

try { await p.goto('http://localhost:5000/finance', { waitUntil: 'domcontentloaded' }); }
catch (e) { console.log('  [goto retry]', String(e).slice(0, 80)); await p.goto('http://localhost:5000/finance', { waitUntil: 'domcontentloaded' }); }
await p.waitForTimeout(6000);
const body = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
for (const re of [/WIP[^£]{0,60}£[\d,]+[^£]{0,40}£[\d,]+[^A-Z]{0,30}/i, /Forward book[^A-Z]{0,90}/i, /Negotiating[^A-Z]{0,60}/, /Heads of terms[^A-Z]{0,60}/]) {
  const m = body.match(re);
  console.log('SCREEN:', m ? m[0].trim().slice(0, 130) : `(no match ${re.source.slice(0, 22)})`);
}
await p.screenshot({ path: `qa/smoke-shots/r580-finance-${tag}.png`, fullPage: true });
await b.close();
