// r592 step 2 — Mark Warne, phone 390px: an operator (a jewellery/watch
// concept) stopped him in the mall. He looks for them in his own brand list,
// doesn't find them, and self-adds them from the global directory. THE WRITE.
process.env.QA_MAIN = '0';
process.env.QA_STEP_BASE = process.env.QA_STEP_BASE || '10';
const h = await import('./r592-client-mobile-journey.mjs');
const { page, go, tap, report, shot, BASE, user } = h;

// 1. His own brand list, and the phone quick-search: is the operator there?
await go('/brands', 'brands-list');
const search = page.locator('[data-testid="brand-quick-search"]');
await search.waitFor({ state: 'visible', timeout: 10000 });
await search.fill('Jewel');
await report('quick-search-jewel', { text: true });

// 2. Not in his CRM. Tap "Add brand" and search the wider directory.
await tap('[data-testid="client-add-brand"]', 'add-brand-dialog', { text: true, ids: true });
const dq = page.locator('[data-testid="client-add-brand-search"]');
await dq.waitFor({ state: 'visible', timeout: 8000 });
await dq.fill('Testco Jewel');
await page.waitForTimeout(1800);
await report('directory-results', { text: true, ids: true });

// 3. The write.
const addBtn = page.locator('div:has-text("Testco Jewellers") >> button:has-text("Add")').last();
const before = await page.evaluate(() => document.body.innerText.length);
await tap(addBtn, 'after-add', { text: true, ids: true });
console.log(`   (body chars before add: ${before})`);

// 4. Does the API agree?
const api = await page.request.get(`${BASE}/api/crm/companies`, { headers: { Authorization: `Bearer ${user.token}` } });
const rows = await api.json();
const names = (Array.isArray(rows) ? rows : []).map(r => r.name);
console.log(`\n== [api] /api/crm/companies -> ${names.length} rows; Testco Jewellers present: ${names.includes('Testco Jewellers')}`);
console.log('   names: ' + names.slice(0, 20).join(' | '));

// 5. And does his list agree after a full reload (the real test of a phone write)?
await go('/brands', 'brands-after-reload', { text: true });
await h.browser.close();
