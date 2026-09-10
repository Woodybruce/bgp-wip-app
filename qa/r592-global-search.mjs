// r592 step 6b — the phone header's global search palette, as Mark. Can he
// find the operator he just self-added? Control: a brand he has NOT added
// must not appear.
process.env.QA_MAIN = '0';
process.env.QA_STEP_BASE = process.env.QA_STEP_BASE || '60';
const h = await import('./r592-client-mobile-journey.mjs');
const { page, go, tap, report } = h;

await go('/brands', 'brands-base');
await tap('[data-testid="button-global-search"]', 'palette-open');
const gi = page.locator('[data-testid="input-global-search"]');
await gi.waitFor({ state: 'visible', timeout: 8000 });
for (const [label, term] of [['added', 'Testco Jewellers'], ['in-slice-control', 'Testco Gym'], ['not-added-control', 'QA Retail Brand'], ['own-property', 'Bluewater']]) {
  await gi.fill('');
  await gi.type(term, { delay: 30 });
  await page.waitForTimeout(2400);
  const res = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]') || document.body;
    return (dlg.innerText || '').replace(/\n{2,}/g, '\n').trim().slice(0, 900);
  });
  await report(`palette-${label}`);
  console.log(`--- PALETTE "${term}" ---\n${res}`);
}
await h.browser.close();
