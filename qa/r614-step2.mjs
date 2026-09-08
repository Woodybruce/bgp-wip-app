// r614 step 2 — Brand Intelligence in depth: does TOTAL BRANDS 9 agree with
// the Brand Explorer list Mark can actually open?
import { go, tap, page, browser, BASE, user } from './r614-journey.mjs';

await go('/brands', 'brands-hub-again');
await tap('text=BRAND EXPLORER', 'brand-explorer', { text: true });
const api = await page.evaluate(async (t) => {
  const j = async (u) => { const r = await fetch(u, { headers: { Authorization: 'Bearer ' + t } }); return { s: r.status, b: r.ok ? await r.json() : await r.text() }; };
  const hub = await j('/api/brands/hub');
  const ex = await j('/api/brands/explorer?limit=200');
  return {
    hubStatus: hub.s,
    hubKeys: hub.s === 200 ? Object.keys(hub.b) : hub.b.slice(0, 200),
    hubStats: hub.s === 200 ? hub.b.stats ?? hub.b.summary ?? null : null,
    exStatus: ex.s,
    exCount: ex.s === 200 ? (Array.isArray(ex.b) ? ex.b.length : (ex.b.brands?.length ?? ex.b.items?.length ?? JSON.stringify(ex.b).slice(0,200))) : ex.b.slice(0, 200),
  };
}, user.token);
console.log('\n--- API ---\n' + JSON.stringify(api, null, 1).slice(0, 2500));
await browser.close();
