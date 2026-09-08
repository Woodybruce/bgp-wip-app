import { go, tap, report, shot, page, browser } from './r600-client-mobile-journey.mjs';

await go('/available', 'tracker', {});
await tap('div.border-b button:nth-of-type(2)', 'search-open', {});
await page.keyboard.type('Bluewater');
await page.waitForTimeout(2500);
await page.locator('[role="option"]').first().click();
await page.waitForTimeout(12000);
const prop = await report('property-overview', { text: true, full: true });
console.log('PILLS:', await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => t && t.length < 30).slice(0, 40).join(' | ')));
await browser.close();
