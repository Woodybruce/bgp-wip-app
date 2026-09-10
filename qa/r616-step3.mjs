import { go, tap, report, shot, page, browser } from './r600-client-mobile-journey.mjs';

// Mark has no search on the Portfolio home, so he goes via the Tracker tile.
await go('/available', 'tracker', { text: true });
console.log('LINKS:', await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')))].slice(0,40).join(' ')));
// The header search exists on non-home routes — use it to find the property.
console.log('HEADER:', await page.evaluate(() => (document.body.firstElementChild?.firstElementChild?.outerHTML || '').slice(0,700)));
await browser.close();
