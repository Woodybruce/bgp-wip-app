import { go, tap, page, browser, report, shot } from './r614-journey.mjs';
await go('/brands', 'hub');
await tap('text=BRAND EXPLORER', 'explorer');
try {
  await page.locator('p:has-text("Honi Poke")').first().locator('xpath=..').click({ timeout: 6000 });
} catch (e) { console.log('tile click failed: ' + String(e).slice(0, 200)); }
await report('brand-profile', { text: true, full: true, ids: true });
console.log('\n--- URL --- ' + page.url());
await browser.close();
