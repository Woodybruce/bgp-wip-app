import { go, page, browser, report, user } from './r614-journey.mjs';
await go('/companies/77777777-7777-7777-7777-777777777777', 'brand');
await page.waitForTimeout(9000);
const i = await report('brand-settled');
const t = await page.evaluate(() => document.body.innerText);
console.log('=== FIRST 5000 ===\n' + t.slice(0, 5000));
await browser.close();
