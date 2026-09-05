// r556 journey — Victoria (BGP staff, desktop 1440px): "Peter is away, cover
// the lease-advisory board: what's due soon, log the rent review I spotted in
// an email, own it, and check every surface that states it agrees."
// Drives the Log-event dialog, the inline status/owner pickers and delete.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = 'http://localhost:5000';
const USER = 'victoria@brucegillinghampollard.com';
const PASSWORD = 'B@nd0077!';
const TAG = 'r556j';
const TENANT = 'QA-PROBE Lease Tenant r556';

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    return route.abort();
  });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  const user = await r.json();
  if (!user.token) { console.error('login failed'); process.exit(2); }
  const api = async (m, p, data) => {
    const res = await ctx.request.fetch(`${BASE}${p}`, { method: m, headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }, data });
    let body = null; try { body = await res.json(); } catch {}
    return { status: res.status(), body };
  };

  const page = await ctx.newPage();
  let bucket = [];
  page.on('response', (res) => { if (res.status() >= 400) bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE, '')}`); });
  page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0, 250)}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) bucket.push(`CONSOLE ${msg.text().slice(0,220)}`); });
  const flush = (l) => { const s = [...new Set(bucket)]; bucket = []; if (s.length) console.log(`   [${l}] ` + s.join('\n   ')); else console.log(`   [${l}] clean`); };
  let step = 0;
  const shot = async (l) => { step++; const p = `qa/smoke-shots/${TAG}-${String(step).padStart(2,'0')}-${l}.png`; await page.screenshot({ path: p, fullPage: false }); console.log('   shot', p); };
  const hoverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const tiles = () => page.evaluate(() => {
    const out = {};
    document.querySelectorAll('div.grid p.text-\\[10px\\]').forEach(p => {
      const v = p.parentElement.querySelector('p.text-2xl');
      if (v) out[p.innerText.trim()] = v.innerText.trim();
    });
    return out;
  });
  const rowsInfo = () => page.evaluate(() => {
    const trs = [...document.querySelectorAll('table tbody tr')];
    return trs.map(tr => {
      const td = [...tr.querySelectorAll('td')].map(x => x.innerText.replace(/\s+/g, ' ').trim());
      return { when: td[0], type: td[1], who: td[2], landlord: td[3], rent: td[4], status: td[6], owner: td[7] };
    });
  });

  await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('bgp_auth_token', tok); localStorage.setItem('authToken', tok);
    localStorage.setItem('user', JSON.stringify(u));
  }, [user.token, user]);

  // ---- 0. Bluewater tenancy board: what is coming up, and do the KPI tiles
  //         agree with the rows they filter to?
  const BW = 'cccccccc-0000-0000-0000-000000000001';
  await page.goto(BASE + '/tenancy-schedule/' + BW, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
  console.log('== tenancy h-overflow:', await hoverflow());
  const tstats = () => page.evaluate(() => {
    const out = {};
    document.querySelectorAll('[data-testid^="tenancy-stat-"]').forEach(el => {
      out[el.getAttribute('data-testid').replace('tenancy-stat-', '')] = el.innerText.replace(/\n/g, ' | ').trim();
    });
    return out;
  });
  const trowCount = () => page.evaluate(() => document.querySelectorAll('tbody tr').length);
  console.log('== tenancy tiles:', JSON.stringify(await tstats()));
  console.log('== tenancy rows:', await trowCount());
  await shot('tenancy-board');
  flush('tenancy');
  for (const tile of ['occupied', 'vacant']) {
    await page.locator(`[data-testid="tenancy-stat-${tile}"]`).click();
    await page.waitForTimeout(1200);
    console.log(`== click ${tile} tile -> rows in table:`, await trowCount());
    const chip = await page.evaluate(() => (document.body.innerText.match(/Showing[^\n]*/) || [''])[0]);
    console.log('   showing line:', chip);
    await shot('tenancy-filter-' + tile);
    await page.locator(`[data-testid="tenancy-stat-${tile}"]`).click();
    await page.waitForTimeout(800);
  }
  flush('tenancy-filters');

  // ---- 1. the board
  await page.goto(BASE + '/lease-events', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  console.log('== h1:', await page.locator('h1').first().innerText().catch(() => 'MISSING'));
  console.log('== h-overflow:', await hoverflow());
  console.log('== tiles:', JSON.stringify(await tiles()));
  const rows0 = await rowsInfo();
  console.log('== rows:', rows0.length);
  console.log('== count line:', await page.locator('p.ml-auto').first().innerText().catch(() => 'MISSING'));
  rows0.slice(0, 8).forEach((x, i) => console.log(`   row${i}`, JSON.stringify(x)));
  await shot('board');
  flush('board');

  // cross-check the tiles against the API's own rows
  const list = await api('GET', '/api/lease-events');
  console.log('== api rows:', list.status, Array.isArray(list.body) ? list.body.length : list.body);
  if (Array.isArray(list.body)) {
    const c = { overdue: 0, imminent: 0, near: 0, watching: 0, future: 0, undated: 0 };
    for (const e of list.body) {
      if (e.status === 'Dormant' || e.status === 'Instructed') continue;
      if (!e.eventDate) { c.undated++; continue; }
      const m = (new Date(e.eventDate).getTime() - Date.now()) / (1000*60*60*24*30);
      if (m < 0) c.overdue++; else if (m < 3) c.imminent++; else if (m < 6) c.near++; else if (m < 18) c.watching++; else c.future++;
    }
    console.log('== expected buckets (page formula):', JSON.stringify(c));
  }
  const dig = await api('GET', '/api/lease-events/digest');
  console.log('== digest:', dig.status, JSON.stringify(dig.body).slice(0, 400));

  // ---- 2. log the event Victoria spotted
  await page.getByRole('button', { name: /Log event/i }).first().click();
  await page.waitForTimeout(900);
  await shot('dialog-empty');
  const dlgText = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return d ? d.innerText.replace(/\s+/g,' ').slice(0,600) : 'NO DIALOG'; });
  console.log('== dialog:', dlgText);
  const field = (label) => page.locator(`[role="dialog"] div:has(> label:text-is("${label}")) input, [role="dialog"] div:has(> label:text-is("${label}")) textarea`).first();
  const d = new Date(Date.now() + 60*24*60*60*1000).toISOString().slice(0, 10); // ~2 months out
  await page.locator('[role="dialog"] input').nth(0).fill(TENANT);                 // Tenant
  await page.locator('[role="dialog"] input').nth(1).fill('Bluewater Shopping Centre, Greenhithe DA9 9ST');
  await page.locator('[role="dialog"] input').nth(2).fill('Landsec');
  await page.locator('[role="dialog"] input').nth(3).fill('U124');
  await page.locator('[role="dialog"] input[type="date"]').first().fill(d);
  await page.locator('[role="dialog"] input').nth(6).fill('£125,000');             // current rent
  await page.locator('[role="dialog"] input').nth(7).fill('£150,000');             // ERV
  await shot('dialog-filled');
  await page.getByRole('button', { name: /Create event/i }).click();
  await page.waitForTimeout(2000);
  console.log('== after create, dialog open:', await page.locator('[role="dialog"]').count());
  console.log('== tiles after create:', JSON.stringify(await tiles()));
  const rows1 = await rowsInfo();
  const mine = rows1.filter(x => (x.who || '').includes('r556'));
  console.log('== rows after create:', rows1.length, 'mine:', JSON.stringify(mine));
  await shot('after-create');
  flush('create');

  // ---- 3. own it + move status, inline on the board
  const created = (await api('GET', '/api/lease-events')).body.find(e => e.tenant === TENANT);
  console.log('== created row api:', created ? JSON.stringify({ id: created.id, eventDate: created.eventDate, currentRent: created.currentRent, estimatedErv: created.estimatedErv, status: created.status, assignedTo: created.assignedTo }) : 'NOT FOUND');
  if (created) {
    const tr = page.locator('table tbody tr', { hasText: 'r556' }).first();
    await tr.locator('button[role="combobox"]').nth(1).click();  // Owner picker
    await page.waitForTimeout(600);
    await shot('owner-picker');
    const opts = await page.locator('[role="option"]').allInnerTexts();
    console.log('== owner options:', JSON.stringify(opts.slice(0, 12)));
    const vic = page.locator('[role="option"]', { hasText: /Victoria/i }).first();
    if (await vic.count()) { await vic.click(); } else { await page.keyboard.press('Escape'); console.log('!! no Victoria option'); }
    await page.waitForTimeout(1500);
    await tr.locator('button[role="combobox"]').nth(0).click();  // Status picker
    await page.waitForTimeout(600);
    await page.locator('[role="option"]', { hasText: /^Contacted$/ }).first().click();
    await page.waitForTimeout(1500);
    await shot('after-inline');
    flush('inline');
    // reload — does it stick, and does the board show the owner as a person?
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    const rows2 = await rowsInfo();
    console.log('== after reload, mine:', JSON.stringify(rows2.filter(x => (x.who||'').includes('r556'))));
    console.log('== tiles after status move:', JSON.stringify(await tiles()));
    const after = (await api('GET', '/api/lease-events')).body.find(e => e.id === created.id);
    console.log('== api after inline:', JSON.stringify({ status: after?.status, assignedTo: after?.assignedTo }));
    const dig2 = await api('GET', '/api/lease-events/digest');
    const inDigest = JSON.stringify(dig2.body).includes(TENANT);
    console.log('== in digest after Contacted:', inDigest);
    await shot('reloaded');
    flush('reload');

    // ---- 4. edit dialog on the created row — does it round-trip what the board shows?
    await page.locator('table tbody tr', { hasText: 'r556' }).first().locator('button[title="Edit"]').click();
    await page.waitForTimeout(1000);
    const edit = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return 'NO DIALOG';
      return [...d.querySelectorAll('label')].map(l => {
        const box = l.parentElement.querySelector('input, textarea');
        const sel = l.parentElement.querySelector('button[role="combobox"]');
        return `${l.innerText.trim()} = ${box ? box.value : (sel ? sel.innerText.trim() : '?')}`;
      }).join(' | ');
    });
    console.log('== edit dialog:', edit);
    await shot('edit-dialog');
    await page.getByRole('button', { name: /^Cancel$/ }).click();
    await page.waitForTimeout(500);
    flush('edit');

    // ---- 4b. the SAME board embedded on /comps — do the two agree?
    await page.goto(BASE + '/comps?tab=lease-events', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    console.log('== comps tab h-overflow:', await hoverflow());
    console.log('== comps tab tiles:', JSON.stringify(await tiles()));
    const rowsC = await rowsInfo();
    console.log('== comps tab rows:', rowsC.length, 'mine:', JSON.stringify(rowsC.filter(x => (x.who||'').includes('r556'))));
    await shot('comps-tab');
    flush('comps-tab');

    // ---- 5. tidy up
    const del = await api('DELETE', `/api/lease-events/${created.id}`);
    console.log('== delete:', del.status);
  }
  console.log('== journey done');
} finally {
  await browser.close();
}
