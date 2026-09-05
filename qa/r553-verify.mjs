// r553 verification: the client's Deals table must not carry BGP's fee
// totals or the WIP-report framing on the Dates cell; staff must keep both.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = 'http://localhost:5000';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
let fails = 0;

async function run(who, email) {
  const client = email.includes('landsec');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const r = await (await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: email, password: 'B@nd0077!' } })).json();
  if (!r.token) { console.log(`!! ${who} login failed`); fails++; return ctx.close(); }
  const page = await ctx.newPage();
  await page.goto(BASE).catch(() => {});
  await page.evaluate(([t, u]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [r.token, r]);
  // Staff land on the WIP report at /deals; the deals TABLE is /deals/list.
  await page.goto(BASE + '/deals/list').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  const body = await page.evaluate(() => document.body.innerText);
  const hasTotalFees = /Total fees:/i.test(body);
  console.log(`[${who}] "Total fees:" on the deals table: ${hasTotalFees}`);
  if (client && hasTotalFees) { console.log('  FAIL: client still sees a BGP fee total'); fails++; }
  if (!client && !hasTotalFees) { console.log('  FAIL: staff lost the fee total'); fails++; }

  const tile = await page.locator('[data-testid="card-group-all"]').first().innerText().catch(() => '');
  console.log(`[${who}] All Deals tile: ${tile.replace(/\n+/g, ' | ')}`);
  if (client && /£/.test(tile)) { console.log('  FAIL: client still sees a fee subtotal on the deals tile'); fails++; }
  if (!client && !/£/.test(tile)) { console.log('  FAIL: staff lost the fee subtotal on the deals tile'); fails++; }

  const dc = page.locator('[data-testid^="dates-cell-"]').first();
  if (!(await dc.count())) { console.log(`!! ${who}: no dates cell`); fails++; await ctx.close(); return; }
  const trigger = (await dc.innerText()).replace(/\n+/g, ' | ');
  await dc.click().catch(() => {});
  await page.waitForTimeout(1500);
  const pop = await page.evaluate(() => document.querySelector('[data-radix-popper-content-wrapper]')?.innerText.replace(/\n+/g, ' | ') || '');
  console.log(`[${who}] dates trigger: ${trigger}`);
  console.log(`[${who}] dates popover: ${pop}`);
  const wip = /WIP report/i.test(pop);
  if (client) {
    if (wip) { console.log('  FAIL: client is told about the WIP report'); fails++; } else console.log('  ok  no WIP-report framing for the client');
    if (/Target month/i.test(trigger) || /Target Month/.test(pop)) { console.log('  FAIL: client still sees "Target month"'); fails++; }
    else console.log('  ok  client sees the completion wording');
  } else {
    if (!wip) { console.log('  FAIL: staff lost the WIP hint'); fails++; } else console.log('  ok  staff keeps the WIP hint');
    if (!/Target Month/.test(pop)) { console.log('  FAIL: staff lost the Target Month row'); fails++; }
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) { console.log(`  FAIL: h-overflow +${overflow}px`); fails++; }
  await page.screenshot({ path: `qa/smoke-shots/r553v-${who}-deals.png` });
  await ctx.close();
}

await run('mark-client', 'mark.warne@landsec.com');
await run('victoria-staff', 'victoria@brucegillinghampollard.com');
console.log(fails === 0 ? '\nr553 verify: ALL GREEN' : `\nr553 verify: ${fails} FAILURE(S)`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
