// r614 step 3 — Mark opens a brand profile in depth (Honi Poke) and reads the
// Compliance & KYC panel a landlord is meant to see.
import { go, tap, page, browser, shot } from './r614-journey.mjs';

await go('/brands', 'hub');
await tap('text=BRAND EXPLORER', 'explorer');
await tap('text=Honi Poke >> nth=0', 'brand-profile', { text: true, full: true, ids: true });
console.log('\n--- URL --- ' + page.url());
await browser.close();
