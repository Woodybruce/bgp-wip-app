import { page, go, tap, report, shot, browser } from '/home/user/bgp-wip-app/qa/r572-staff-desktop-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();
const WG = 'de222c86-d59c-42b5-842a-a545d0e7fa44';
try {
  await go(`/properties/${WG}`, 'westgate-tenancy');
  await tap('[data-testid="property-section-deals"]', 'westgate-deals-section');
  const t = await page.evaluate(() => {
    const b = (document.body.innerText||'').replace(/\s+/g,' ');
    const i = b.search(/Tenancy Schedule/i);
    return b.slice(Math.max(0,i-1500), i+2000);
  });
  console.log('TENANCY AREA:\n' + t);
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();
