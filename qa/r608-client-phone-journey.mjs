// r608 journey: Landsec client (Mark Warne) on the phone shell at 390px.
// Task framing: "Monday, on the train. The asset team want a read on live
// deal activity across the portfolio and anything in the news about our
// tenants — and Nando's came up on Friday, so get them onto my brand CRM
// before I forget."
import { go, tap, report, shot, page, browser } from './r600-client-mobile-journey.mjs';

// 1 — the phone dashboard the client lands on
const dash = await go('/', 'phone-dashboard', { text: true });
console.log('NAV:', await page.evaluate(() => [...document.querySelectorAll('[data-testid^="bottom-nav-"]')].map(e => e.textContent.trim()).join(' | ')));

// 2 — Deals from the bottom nav
await tap('[data-testid="bottom-nav-deals"]', 'phone-deals', { text: true });

// 3 — News from the bottom nav
await tap('[data-testid="bottom-nav-news"]', 'phone-news', { text: true });

// 4 — Messages / ChatBGP on a phone
await tap('[data-testid="bottom-nav-messages"]', 'phone-messages', { text: true });

await browser.close();
