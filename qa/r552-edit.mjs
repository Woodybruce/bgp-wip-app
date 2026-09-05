import { go, report, tap, browser, page, BASE, ctx, user, shot } from './r552-client-mobile-journey.mjs';
const UID = '99ee6031-384a-4799-94a4-8aba5dda89b1';
await go('/available', 'tracker');
const search = page.locator('input[placeholder*="Search" i]').first();
await search.fill('U124'); await page.waitForTimeout(1500);
// read the card for our unit
const card = await page.evaluate((uid) => {
  const btn = document.querySelector(`[data-testid="unit-offer-${uid}"]`);
  let el = btn; for (let i = 0; i < 8 && el; i++) { el = el.parentElement; if (el && el.innerText && el.innerText.length > 60) break; }
  return el ? el.innerText.replace(/\n+/g, ' | ') : '(card not found)';
}, UID);
console.log('\nCARD: ' + card);
await shot('card-with-offer');
await tap(`[data-testid="unit-edit-${UID}"]`, 'edit-open');
const dlg = page.locator('[role="dialog"]').last();
console.log('\n--- EDIT DIALOG TEXT ---\n' + (await dlg.innerText().catch(() => '(none)')).slice(0, 2000));
const vals = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[role="dialog"] input, [role="dialog"] textarea, [role="dialog"] select, [role="dialog"] [role="combobox"]')) {
    const id = el.getAttribute('data-testid') || el.getAttribute('name') || el.getAttribute('placeholder') || el.tagName;
    out.push(`${id} = ${JSON.stringify((el.value !== undefined ? el.value : el.textContent || '').toString().slice(0, 60))}`);
  }
  return out;
});
console.log('\n--- EDIT FIELD VALUES ---\n' + vals.join('\n'));
await shot('edit-dialog');
await browser.close();
