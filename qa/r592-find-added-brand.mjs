// r592 step 6 — Mark added the operator. Now, one-handed, can he FIND them
// again? Two search surfaces on the phone: the /brands quick-search and the
// global search palette in the phone header.
process.env.QA_MAIN = '0';
process.env.QA_STEP_BASE = process.env.QA_STEP_BASE || '50';
const h = await import('./r592-client-mobile-journey.mjs');
const { page, go, tap, report, BASE, user } = h;

await go('/brands', 'brands-reopen');
const qs = page.locator('[data-testid="brand-quick-search"]');
await qs.waitFor({ state: 'visible', timeout: 10000 });
for (const term of ['Jewel', 'Testco Jewellers']) {
  await qs.fill(term);
  await page.waitForTimeout(1400);
  await report(`quick-search-${term.replace(/\W+/g, '-')}`, { text: true });
}

// Global search palette from the phone header.
await go('/brands', 'brands-for-global');
await tap('[data-testid="button-global-search"]', 'global-search-open', { ids: true });
const gi = page.locator('input[type="text"], input[role="combobox"], [cmdk-input]').first();
try {
  await gi.waitFor({ state: 'visible', timeout: 6000 });
  await gi.fill('Testco Jewellers');
  await page.waitForTimeout(2200);
  await report('global-search-added-brand', { text: true });
  await gi.fill('QA Retail Brand');
  await page.waitForTimeout(2200);
  await report('global-search-not-added-control', { text: true });
} catch (e) { console.log('!! global search input not found: ' + String(e).slice(0, 160)); }
await h.browser.close();
