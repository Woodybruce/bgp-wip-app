import { go, tap, report, shot, page, browser } from './r600-client-mobile-journey.mjs';

await go('/available', 'tracker', {});
// header search (the only route to a property page on a phone)
await tap('div.border-b button:nth-of-type(2)', 'search-open', {});
await page.keyboard.type('Bluewater');
await page.waitForTimeout(2500);
await report('search-results', { text: true });
console.log('OPTS:', await page.evaluate(() => [...document.querySelectorAll('[role="option"],[cmdk-item]')].map(o => o.textContent.trim().slice(0,60)).join(' || ')));
await browser.close();
