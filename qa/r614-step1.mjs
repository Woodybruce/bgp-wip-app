// r614 journey step 1 — Mark Warne (Landsec), desktop 1440px.
// Task: "Autumn brand-strategy review. Show me my portfolio, then take me
// into Brand Intelligence and let me dig into one hospitality brand."
import { go, tap, page, browser } from './r614-journey.mjs';

await go('/', 'dashboard', { text: true });
await go('/brands', 'brands-hub', { text: true, ids: true });
await browser.close();
