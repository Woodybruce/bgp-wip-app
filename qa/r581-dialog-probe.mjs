// r581 (UX #252, six rounds deferred): the deal Edit dialog's Status picker.
// It reads CRM_OPTIONS.dealStatus, which was exactly the pre-HOT
// INVESTMENT_STATUSES — so heads of terms was not offered at all, and a deal
// ALREADY at HOT opened with an empty Status field. r575 reverted this fix
// unverified because it could not open the dialog from /deals/list; the route
// that DOES open it is the deal detail page's button-edit-deal.
import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const tag = process.argv[2] || 'x';
const DEAL = 'dddd5581-0000-0000-0000-0000000002'; // the HOT probe deal

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)));
const r = await ctx.request.post('http://localhost:5000/api/auth/login', { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await r.json();
if (!user.token) throw new Error('login failed: ' + JSON.stringify(user).slice(0, 200));
await p.goto('http://localhost:5000');
await p.evaluate(([tok, u]) => { localStorage.setItem('authToken', tok); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);

await p.goto(`http://localhost:5000/deals/${DEAL}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.click('[data-testid="button-edit-deal"]');
await p.waitForTimeout(1500);
const trigger = p.locator('[data-testid="select-deal-status"]');
console.log('dialog open:', await trigger.count());
console.log('STATUS FIELD SHOWS:', JSON.stringify((await trigger.innerText()).replace(/\s+/g, ' ')));
await trigger.click();
await p.waitForTimeout(900);
const opts = await p.locator('[role="option"]').allTextContents();
console.log('OPTIONS:', JSON.stringify(opts.map(o => o.replace(/\s+/g, ' ').trim())));
console.log('HOTs offered:', opts.some(o => /heads of terms|HOTs/i.test(o)));
await p.screenshot({ path: `qa/smoke-shots/r581-dialog-${tag}.png`, fullPage: false });
await b.close();
