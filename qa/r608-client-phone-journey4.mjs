// r608 · part 3 (retry) — the write, against a brand the fixture actually
// holds outside Mark's category slice.
import { go, tap, report, page, browser, BASE, user } from './r600-client-mobile-journey.mjs';

await go('/brands', 'brands-before', {});
await page.waitForTimeout(3000);
const pick = await page.evaluate(async (tok) => {
  const h = { Authorization: 'Bearer ' + tok };
  const out = [];
  for (const q of ['Test', 'a', 'e', 'o']) {
    const r = await fetch(`/api/client/crm/global-brands?search=${q}`, { headers: h });
    const d = await r.json();
    for (const b of (Array.isArray(d) ? d : [])) out.push({ id: b.id, name: b.name, inSlice: b.inSlice, type: b.companyType, q });
  }
  return out;
}, user.token);
const outside = pick.filter(b => !b.inSlice);
console.log('GLOBAL BRANDS OUTSIDE THE SLICE:', JSON.stringify(outside.slice(0, 12)));
if (!outside.length) { console.log('NOTHING OUTSIDE THE SLICE TO ADD'); await browser.close(); process.exit(0); }
const target = outside[0];

const before = await page.evaluate(() => (document.body.innerText.match(/(\d+) results/) || [])[1]);
console.log('RESULTS BEFORE:', before);
await tap('[data-testid="client-add-brand"]', 'add-dialog', {});
await page.locator('[data-testid="client-add-brand-search"]').fill(target.q === 'Test' ? target.name.slice(0, 8) : target.name.slice(0, 6));
await page.waitForTimeout(2500);
await report('add-results', { text: true });
const row = page.locator(`div:has-text("${target.name}") >> button:has-text("Add")`).last();
await row.click({ timeout: 6000 }).catch(e => console.log('ADD TAP FAILED', String(e).slice(0, 150)));
await page.waitForTimeout(2500);
await report('added', { text: true });
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);
await go('/brands', 'brands-after', {});
await page.waitForTimeout(3500);
const after = await page.evaluate(() => ({
  results: (document.body.innerText.match(/(\d+) results/) || [])[1],
  all: (document.body.innerText.match(/All Brands\s*\n?\s*(\d+)/) || [])[1],
}));
console.log('AFTER:', JSON.stringify(after), 'TARGET LISTED:', await page.evaluate(n => document.body.innerText.includes(n), target.name));
await report('brands-after-settled', { text: true });
await browser.close();
