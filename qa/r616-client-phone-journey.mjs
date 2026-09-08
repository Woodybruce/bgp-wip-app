// r616 journey: Landsec client (Mark Warne) on the phone shell at 390px.
// Task framing: "Monday morning, on the phone before the asset-management call
// on Bluewater: open the property, read the Asset Brief and this week's focus,
// check the tenancy schedule and what's live on units, then leave a note for
// the BGP team so the call has an agenda."
import { go, tap, report, shot, page, browser } from './r600-client-mobile-journey.mjs';

const dash = await go('/', 'phone-dashboard', { text: true });
console.log('NAV:', await page.evaluate(() => [...document.querySelectorAll('[data-testid^="bottom-nav-"]')].map(e => e.getAttribute('data-testid') + '=' + e.textContent.trim()).join(' | ')));
console.log('LINKS:', await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')))].join(' ')));

await browser.close();
