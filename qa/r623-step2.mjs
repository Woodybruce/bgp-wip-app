// r623 step 2 — Mark taps into the Letting Tracker tab and a deal card.
import { go, tap, warm, browser, page, BASE, user } from './r623-mark-phone-journey.mjs';
await warm('/deals', 12000);
await go('/deals', 'deals-again', {});
await tap('[data-testid="toggle-deals-letting"]', 'deals-letting-tab', { text: true, ids: true, full: true });
await tap('[data-testid="toggle-deals-properties"]', 'deals-properties-tab', { text: true });
await tap('[data-testid="toggle-deals-deals"]', 'deals-deals-tab', {});
await tap('[data-testid="mobile-card-11110000-0000-0000-0000-000000000302"]', 'deal-card-open', { text: true, ids: true, full: true });
console.log('\n### add-terms / inline-number controls on this phone surface:');
console.log(await page.evaluate(() => {
  const hits = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /Add terms/i.test(e.textContent || ''));
  return JSON.stringify({ addTerms: hits.length, texts: hits.slice(0,5).map(e => e.textContent.trim()) });
}));
await browser.close();
