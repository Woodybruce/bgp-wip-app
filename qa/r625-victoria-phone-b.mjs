// r625 part B: the staff phone Letting Tracker + a task WRITE, as Victoria.
process.env.QA_USER = 'victoria@brucegillinghampollard.com';
process.env.QA_TAG = 'r625b';
const h = await import('./r623-mark-phone-journey.mjs');
const { go, tap, warm, page, ctx, browser, assertPhoneShell, user, BASE } = h;
await assertPhoneShell();

await warm('/deals/letting', 15000);
const t = await go('/deals/letting', 'tracker');
const dom = await page.evaluate(() => ({
  pills: [...document.querySelectorAll('[data-testid^="chip-"],[data-testid^="pill-"],[data-testid^="filter-"]')].map(e => e.getAttribute('data-testid') + '=' + e.innerText.replace(/\n/g,'/')),
  cards: document.querySelectorAll('[data-testid^="mobile-card-"]').length,
  addUnit: !!document.querySelector('[data-testid="button-add-unit"]'),
  headline: (document.body.innerText||'').split('\n').slice(0,26).join(' | '),
}));
console.log('\n[tracker] ' + JSON.stringify(dom, null, 1));
const api = await ctx.request.get(`${BASE}/api/available-units`).then(r => r.json());
const units = Array.isArray(api) ? api : (api.units || []);
console.log(`[api] /api/available-units -> ${units.length} units; statuses ${JSON.stringify(units.reduce((a,u)=>{const k=u.dealStatus||u.status||'?';a[k]=(a[k]||0)+1;return a;},{}))}`);

// ── task WRITE from the phone ───────────────────────────────────────────
await warm('/tasks', 12000);
await go('/tasks', 'tasks-before');
const title = `r625 call the Gail's landlord back ${Date.now()}`;
await page.locator('[data-testid="input-add-task"]:visible').first().fill(title);
await page.keyboard.press('Enter');
await page.waitForTimeout(3000);
const after = await go('/tasks', 'tasks-after', { text: true });
const mine = await ctx.request.get(`${BASE}/api/tasks`).then(r => r.json()).catch(()=>[]);
const arr = Array.isArray(mine) ? mine : (mine.tasks||[]);
const found = arr.find(x => (x.title||'').includes('r625 call'));
console.log(`\n[write] task rows matching: ${arr.filter(x=>(x.title||'').includes('r625 call')).length}; row=${JSON.stringify(found||null).slice(0,400)}`);
if (found) { const d = await ctx.request.delete(`${BASE}/api/tasks/${found.id}`); console.log(`[cleanup] delete task -> ${d.status()}`); }

// ── news tab ────────────────────────────────────────────────────────────
await warm('/news', 12000);
await go('/news', 'news', { text: true });
await browser.close();
