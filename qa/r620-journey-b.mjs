// r620 part B — Victoria continues: the report says £250,000 sits under
// "Unassigned" for both Team and BGP Contact. Open that deal, fix it, and
// confirm the WIP report agrees.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5000';
const SHOT = '/tmp/r620';
const issues = []; const note = s => { console.log('   ! ' + s); issues.push(s); };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('response', r => { if (r.status() >= 400 && r.url().includes('/api/')) console.log(`     [http ${r.status()}] ${r.url().replace(BASE,'')}`); });
const shot = async n => { await p.screenshot({ path: `${SHOT}/${n}.png` }); console.log('   [shot] ' + n); };

const lr = await ctx.request.post(BASE + '/api/auth/login', { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await lr.json();
const TOKEN = user.token;
const api = async (m, u, body) => {
  const r = await fetch(BASE + u, { method: m, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.evaluate(([t,u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [TOKEN, user]);
await p.waitForTimeout(2500);

console.log('STEP 6 — the deal detail table: what are the 7 rows?');
await p.goto(BASE + '/deals', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(10000);
const rows = await p.$$eval('[data-testid^="wip-row-"]', els => els.map(e => Array.from(e.querySelectorAll('td')).map(td => td.textContent.replace(/\s+/g,' ').trim())));
const heads = await p.$$eval('[data-testid^="wip-sort-"]', els => els.map(e=>e.textContent.replace(/\s+/g,'').trim()));
console.log('   cols: ' + JSON.stringify(heads));
rows.forEach((r,i)=>console.log(`   row${i}: ` + JSON.stringify(r)));

console.log('\nSTEP 7 — click the Sep-26 month bar to filter (the page says "click to filter")');
const before = await p.$eval('[data-testid="wip-report-title"]', e => e.parentElement.textContent.replace(/\s+/g,' ').trim()).catch(()=>null);
console.log('   header before: ' + before);
const sep = await p.$('[data-testid="wip-desk-month-2026-09"]') || (await p.$$('[data-testid^="wip-desk-month-"]')).find ? null : null;
const monthEls = await p.$$('[data-testid^="wip-desk-month-"]');
let clicked = null;
for (const el of monthEls) {
  const t = await el.textContent();
  if (t.includes('Sep-26')) { await el.click(); clicked = t.trim(); break; }
}
console.log('   clicked month chip: ' + clicked);
await p.waitForTimeout(3000);
const afterRows = await p.$$eval('[data-testid^="wip-row-"]', els => els.length);
const afterHeader = await p.$eval('[data-testid="wip-report-title"]', e => e.parentElement.textContent.replace(/\s+/g,' ').trim()).catch(()=>null);
console.log('   rows after month filter: ' + afterRows + '  (was ' + rows.length + ')');
console.log('   header after: ' + afterHeader);
await shot('05-month-filtered');
const clearBtn = await p.$('[data-testid="wip-clear-all-filters"]');
console.log('   "clear all filters" affordance present: ' + !!clearBtn);
if (clearBtn) { await clearBtn.click(); await p.waitForTimeout(2500); console.log('   rows after clear: ' + await p.$$eval('[data-testid^="wip-row-"]', e=>e.length)); }

console.log('\nSTEP 8 — open the £250K deal from the report');
const link = await p.$('[data-testid^="link-deal-"]');
const dealHref = await p.$$eval('[data-testid^="link-deal-ref-"]', els => els.map(e=>e.getAttribute('data-testid')));
console.log('   deal ref links: ' + JSON.stringify(dealHref.slice(0,8)));
// find the row with 250,000
let targetId = null;
const idRows = await p.$$eval('[data-testid^="wip-row-"]', els => els.map(e => ({
  txt: e.textContent.replace(/\s+/g,' ').trim(),
  id: (e.querySelector('[data-testid^="link-deal-ref-"]')||{}).getAttribute ? e.querySelector('[data-testid^="link-deal-ref-"]').getAttribute('data-testid').replace('link-deal-ref-','') : null,
})));
idRows.forEach(r => { if (r.txt.includes('250,000')) targetId = r.id; });
console.log('   £250,000 deal id: ' + targetId);

if (!targetId) { note('could not locate the £250,000 row in the detail table'); }
else {
  await p.goto(BASE + '/deals/' + targetId, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(9000);
  await shot('06-deal-profile');
  const h = await p.evaluate(() => document.body.innerText.split('\n').filter(Boolean).slice(0,40).join(' | '));
  console.log('   deal page top: ' + h.slice(0, 700));
  const d = await api('GET', '/api/crm/deals/' + targetId);
  console.log('   API deal: ' + JSON.stringify({ name: d.body?.name, fee: d.body?.fee, status: d.body?.status, team: d.body?.team, bgpContactId: d.body?.bgpContactId, targetMonth: d.body?.targetMonth, targetDate: d.body?.targetDate, agents: d.body?.agents }));
}
console.log('\n--- issues: ' + issues.length + ' ---'); issues.forEach(i=>console.log('   * '+i));
await b.close();
