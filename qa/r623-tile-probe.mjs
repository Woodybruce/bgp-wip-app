// r623 — TWO DOORS, ONE QUESTION: BGP withdraws a unit from Mark's tracker;
// does his phone home tile still add up? Fresh context per persona (r622
// trap 1: ctx.request shares the context cookie jar and the cookie beats a
// Bearer header in resolveCompanyScope).
import { chromium, devices } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = 'http://localhost:5000';
const PW = 'B@nd0077!';
const EXE = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(EXE ? { executablePath: EXE, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
async function api(email) {
  const ctx = await browser.newContext();
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: email, password: PW } });
  const u = await r.json();
  if (!u.token) throw new Error(`login failed for ${email}: ${JSON.stringify(u).slice(0,200)}`);
  return { ctx, u, hdr: { Authorization: `Bearer ${u.token}` } };
}
const vic = await api('victoria@brucegillinghampollard.com');
const units = await (await vic.ctx.request.get(`${BASE}/api/available-units`, { headers: vic.hdr })).json();
// Pick a Bluewater unit Mark can see, currently marketing, with no linked deal
// (so the unit's own marketingStatus is the effective status).
const mkCtx = await api('mark.warne@landsec.com');
const mkUnits = await (await mkCtx.ctx.request.get(`${BASE}/api/available-units`, { headers: mkCtx.hdr })).json();
console.log(`victoria sees ${units.length} units; mark sees ${mkUnits.length}`);
const target = mkUnits.find(u => !u.dealId && String(u.marketingStatus).toUpperCase() === 'AVA');
if (!target) { console.error('no candidate unit'); process.exit(2); }
console.log(`TARGET ${target.id} "${target.unitName}" status=${target.marketingStatus} dealId=${target.dealId}`);

async function readTile(label) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const lr = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'mark.warne@landsec.com', password: PW } });
  const mu = await lr.json();
  const page = await ctx.newPage();
  await page.goto(BASE).catch(() => {});
  await page.evaluate(([t, u]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); localStorage.removeItem('bgp-force-desktop'); }, [mu.token, mu]);
  await page.goto(BASE + '/deals').catch(() => {});   // warm (r262 cold-first-load)
  await page.waitForTimeout(8000);
  await page.goto(BASE + '/').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(6000);
  if (!(await page.$('[data-testid="mobile-bottom-nav"]'))) { console.error('FATAL: no phone shell'); process.exit(9); }
  const nums = await page.evaluate(() => {
    const tile = document.querySelector('[data-testid="mobile-home-portfolio"]');
    if (!tile) return null;
    const t = tile.innerText.replace(/\n+/g, ' | ');
    const m = [...tile.innerText.matchAll(/(\d[\d,]*)\s*\n\s*(Available|Under offer|Let|Withdrawn|On tracker)/g)];
    return { raw: t, pairs: m.map(x => [x[2], Number(x[1].replace(/,/g, ''))]) };
  });
  await page.screenshot({ path: `/tmp/r623/tile-${label}.png` });
  await ctx.close();
  return nums;
}
const before = await readTile('before');
console.log(`\nBEFORE: ${before.raw}`);
// BGP pulls the unit from the market — the same inline action the tracker's
// row menu fires (available-units.tsx:2637 inlineUpdate(…,"WIT")).
const patch = await vic.ctx.request.patch(`${BASE}/api/available-units/${target.id}`, { headers: vic.hdr, data: { marketingStatus: 'WIT' } });
console.log(`staff withdraw → ${patch.status()}`);
const after = await readTile('after');
console.log(`\nAFTER:  ${after.raw}`);
const map = Object.fromEntries(after.pairs);
const sum = (map['Available'] || 0) + (map['Under offer'] || 0) + (map['Let'] || 0) + (map['Withdrawn'] || 0);
console.log(`\nbuckets: Available=${map['Available']} UnderOffer=${map['Under offer']} Let=${map['Let']} Withdrawn=${map['Withdrawn'] ?? '(absent)'} → sum ${sum}; On tracker=${map['On tracker']}`);
// The tracker page Mark deep-links to, same data, same persona.
const ctx2 = await browser.newContext({ ...devices['iPhone 13'] });
const lr2 = await ctx2.request.post(`${BASE}/api/auth/login`, { data: { username: 'mark.warne@landsec.com', password: PW } });
const mu2 = await lr2.json();
const p2 = await ctx2.newPage();
await p2.goto(BASE).catch(() => {});
await p2.evaluate(([t, u]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [mu2.token, mu2]);
await p2.goto(BASE + '/available-units').catch(() => {});
await p2.waitForTimeout(12000);
const chips = await p2.evaluate(() => {
  const g = (id) => (document.querySelector(`[data-testid="${id}"]`)?.innerText || '').replace(/\n/g, ' ');
  return { all: g('stat-chip-all'), historic: g('stat-chip-historic'), ava: g('stat-chip-ava'), neg: g('stat-chip-neg'), sol: g('stat-chip-sol') };
});
await p2.screenshot({ path: '/tmp/r623/tracker-after.png' });
console.log(`TRACKER PAGE chips: ${JSON.stringify(chips)}`);
// restore
const back = await vic.ctx.request.patch(`${BASE}/api/available-units/${target.id}`, { headers: vic.hdr, data: { marketingStatus: target.marketingStatus } });
console.log(`restore → ${back.status()}`);
const chk = await (await vic.ctx.request.get(`${BASE}/api/available-units`, { headers: vic.hdr })).json();
console.log(`restored status = ${chk.find(u => u.id === target.id)?.marketingStatus}`);
await browser.close();
if (sum !== map['On tracker']) {
  console.log(`\n>>> BUG CONFIRMED: three buckets sum to ${sum} but "On tracker" says ${map['On tracker']} — ${map['On tracker'] - sum} unit(s) in no bucket.`);
  process.exit(1);
}
console.log('\nno gap — buckets add up');
