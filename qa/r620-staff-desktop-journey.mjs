// r620 — staff desktop 1440px journey as Victoria: month-end WIP review.
// Task: "It's month-end. Open the WIP Report, find deals with broken links
// that distort my numbers, fix one in place, and confirm the report agrees."
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5000';
const SHOT = '/tmp/r620';
const issues = [];
const note = (s) => { console.log('   ! ' + s); issues.push(s); };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const console_errs = [];
p.on('console', m => { if (m.type() === 'error') console_errs.push(m.text().slice(0, 200)); });
p.on('response', r => {
  const u = r.url();
  if (r.status() >= 400 && u.includes('/api/')) console.log(`     [http ${r.status()}] ${u.replace(BASE,'')}`);
});

const shot = async (n) => { await p.screenshot({ path: `${SHOT}/${n}.png`, fullPage: false }); console.log(`   [shot] ${n}`); };

console.log('STEP 1 — login as Victoria');
const lr = await ctx.request.post(BASE + '/api/auth/login', { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await lr.json();
if (!user.token) throw new Error('login failed: ' + JSON.stringify(user).slice(0,150));
globalThis.TOKEN = user.token;
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.evaluate(([t,u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);
await p.waitForTimeout(3000);
console.log('   logged in: ' + user.email + ' · isAdmin=' + user.isAdmin + ' · role=' + user.role + ' · ' + (user.jobTitle||''));

console.log('STEP 2 — /deals (WIP Report is the desktop landing tab)');
await p.goto(BASE + '/deals', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
await p.waitForSelector('[data-testid="wip-report-page"]', { timeout: 30000 }).catch(() => note('wip-report-page never rendered'));
await shot('01-wip-report');
const tabs = await p.$$eval('[data-testid="wip-tabs"] button', els => els.map(e => e.textContent.trim()));
console.log('   tabs: ' + JSON.stringify(tabs));
const title = await p.$eval('[data-testid="wip-report-title"]', e => e.textContent.trim()).catch(() => null);
console.log('   title: ' + title);

// desktop boards + KPI strip
const boards = await p.$$eval('[data-testid^="wip-desk-board-"]', els => els.map(e => e.textContent.trim().slice(0,80)));
console.log('   desk boards: ' + boards.length);
const monthChips = await p.$$eval('[data-testid^="wip-desk-month-"]', els => els.map(e => e.textContent.trim()));
console.log('   month chips: ' + JSON.stringify(monthChips.slice(0,14)));
const stageChips = await p.$$eval('[data-testid^="wip-desk-stage-"]', els => els.map(e => e.textContent.trim()));
console.log('   stage chips: ' + JSON.stringify(stageChips));

const rowCount = await p.$$eval('[data-testid^="wip-row-"]', els => els.length);
console.log('   detail rows rendered: ' + rowCount);

console.log('STEP 3 — Needs Attention (the month-end audit)');
const health = await p.$('[data-testid="wip-tab-health"]');
if (!health) { note('no "Needs Attention" tab for Victoria (Head of National) — canSeeAll false?'); }
else {
  await health.click();
  await p.waitForTimeout(5000);
  await p.waitForSelector('[data-testid="wip-health-tab"]', { timeout: 20000 }).catch(() => note('health tab body never rendered'));
  await shot('02-needs-attention');
  const banner = await p.$eval('[data-testid="wip-health-tab"] p', e => e.textContent.trim()).catch(()=>null);
  console.log('   banner: ' + banner);
  const secs = await p.$$eval('[data-testid="wip-health-tab"] .bg-card', els => els.map(e => {
    const h = e.querySelector('p.text-sm'); const rows = e.querySelectorAll('a > div, .divide-y > *');
    return { title: h ? h.textContent.trim() : '?', rows: rows.length };
  }));
  console.log('   sections: ' + JSON.stringify(secs, null, 1));
}

console.log('STEP 4 — Fee Check');
const fc = await p.$('[data-testid="wip-tab-fee-check"]');
if (!fc) note('no Fee Check tab');
else {
  await fc.click(); await p.waitForTimeout(4000); await shot('03-fee-check');
  const clean = await p.$('[data-testid="fee-check-clean"]');
  console.log('   fee check clean banner: ' + !!clean);
  const rows = await p.$$eval('[data-testid^="fee-check-"]', els => els.length);
  console.log('   fee-check elements: ' + rows);
}

console.log('STEP 5 — Agent Summary');
await p.click('[data-testid="wip-tab-agent-summary"]');
await p.waitForTimeout(5000);
await shot('04-agent-summary');
const bars = await p.$$eval('[data-testid^="agent-bar-"]', els => els.map(e=>e.textContent.trim().slice(0,60)));
console.log('   agent bars: ' + bars.length);
const arows = await p.$$eval('[data-testid^="agent-row-"]', els => els.map(e=>e.textContent.replace(/\s+/g,' ').trim().slice(0,120)));
arows.slice(0,8).forEach(r=>console.log('     ' + r));

console.log('\n--- console errors ---');
[...new Set(console_errs)].slice(0,20).forEach(e=>console.log('   ' + e));
console.log('\n--- issues: ' + issues.length + ' ---');
issues.forEach(i=>console.log('   * ' + i));
await b.close();
