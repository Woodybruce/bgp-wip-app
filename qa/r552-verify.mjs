// r552 verification: the client's unit Edit dialog must not carry BGP's fee
// or its internal split; staff must keep both. Plus the phone home tile label.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = 'http://localhost:5000';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UID = '99ee6031-384a-4799-94a4-8aba5dda89b1';
const FEE_MARKERS = [/% Agency fee/i, /Total fee/i, /BGP fee split/i, /BGP House takes 15%/i, /remaining 85%/i, /Add agent/i];
let fails = 0;

async function run(who, email, phone) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA }
    : { viewport: { width: 1440, height: 900 } });
  const r = await (await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: email, password: 'B@nd0077!' } })).json();
  if (!r.token) { console.log(`!! ${who} login failed: ${JSON.stringify(r).slice(0,120)}`); fails++; return ctx.close(); }
  const page = await ctx.newPage();
  await page.goto(BASE).catch(() => {});
  await page.evaluate(([t, u]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [r.token, r]);

  if (phone) {
    await page.goto(BASE + '/').catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    const tile = await page.evaluate(() => document.querySelector('[data-testid="mobile-home-portfolio"]')?.innerText.replace(/\n+/g, ' | ') || '(no tile)');
    console.log(`[${who}] home tile: ${tile}`);
    if (/\|\s*Units\s*$/.test(tile) || /\bUnits\b/.test(tile)) { console.log(`  FAIL: tile still labels the tracker total "Units"`); fails++; }
    else if (/On tracker/.test(tile)) console.log('  ok  tracker total labelled "On tracker"');
    await page.screenshot({ path: `qa/smoke-shots/r552v-${who}-home-tile.png` });
  }

  await page.goto(BASE + '/available').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  const search = page.locator('input[placeholder*="Search" i]').first();
  if (await search.count()) { await search.fill('U124'); await page.waitForTimeout(1500); }
  const sel = phone ? `[data-testid="unit-edit-${UID}"]` : `[data-testid="button-edit-${UID}"]`;
  const btn = page.locator(sel).first();
  if (!(await btn.count())) { console.log(`!! ${who}: no edit button (${sel})`); fails++; await ctx.close(); return; }
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click();
  await page.waitForTimeout(2200);
  const txt = await page.locator('[role="dialog"]').last().innerText().catch(() => '');
  const hit = FEE_MARKERS.filter(m => m.test(txt)).map(String);
  const hasRent = /Quoting Rent/i.test(txt);
  console.log(`[${who}] edit dialog: ${txt.length} chars | quoting rent: ${hasRent} | fee markers: ${hit.length ? hit.join(', ') : 'NONE'}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) { console.log(`  FAIL: h-overflow +${overflow}px`); fails++; }
  if (email.includes('landsec')) {
    if (hit.length) { console.log('  FAIL: client still sees BGP fee fields'); fails++; } else console.log('  ok  client sees no BGP fee fields');
    if (!hasRent) { console.log('  FAIL: client lost the Quoting Rent field'); fails++; } else console.log('  ok  client keeps Quoting Rent');
  } else {
    if (hit.length < 4) { console.log('  FAIL: staff lost fee fields'); fails++; } else console.log('  ok  staff keeps the fee panel + split');
  }
  await page.screenshot({ path: `qa/smoke-shots/r552v-${who}-edit-dialog.png` });
  await ctx.close();
}

await run('mark-phone', 'mark.warne@landsec.com', true);
await run('victoria-desktop', 'victoria@brucegillinghampollard.com', false);
console.log(fails === 0 ? '\nr552 verify: ALL GREEN' : `\nr552 verify: ${fails} FAILURE(S)`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
