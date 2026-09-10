// r592 step 3 — Mark Warne, phone 390px: he taps the operator he just added
// and reads their profile one-handed. "Are they any good for the covenant?"
process.env.QA_MAIN = '0';
process.env.QA_STEP_BASE = process.env.QA_STEP_BASE || '20';
const h = await import('./r592-client-mobile-journey.mjs');
const { page, go, tap, report, BASE, user } = h;
const BRAND = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0007';

const info = await go(`/companies/${BRAND}`, 'brand-profile', { text: true, ids: true, tapTargets: true });

// The phone pills the app map promises: Chat / Contacts / Intel / Stores / Social / Compliance
const pills = await page.evaluate(() => [...document.querySelectorAll('button,[role="tab"]')]
  .map(el => (el.textContent || '').trim()).filter(t => t && t.length < 22));
console.log('\n== [pills] ' + JSON.stringify(pills.slice(0, 40)));

for (const label of ['Compliance', 'Intel', 'Contacts']) {
  const el = page.locator(`button:has-text("${label}")`).first();
  if (await el.count() === 0) { console.log(`\n!! pill "${label}" NOT PRESENT`); continue; }
  await tap(el, `pill-${label.toLowerCase()}`, { text: true, ids: true });
}
await h.browser.close();
