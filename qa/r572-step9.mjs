import { page, go, tap, report, shot, browser } from '/home/user/bgp-wip-app/qa/r572-staff-desktop-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();
const LANDSEC = 'd25ec158-82df-4f50-8188-cae113af5f9f';
try {
  await go(`/companies/${LANDSEC}`, 'landsec');
  const cards = await page.evaluate(() => [...document.querySelectorAll('a[href*="/propert"],a[href*="/leasing"],button')].map(e=>({t:(e.innerText||'').replace(/\s+/g,' ').trim().slice(0,50),h:e.getAttribute('href')||'',tid:e.getAttribute('data-testid')||''})).filter(x=>/Westgate|Bluewater|leasing|propert/i.test(x.t+x.h)).slice(0,20));
  console.log('CARDS', JSON.stringify(cards));
  const clicked = await tap('text=Westgate Test Centre', 'westgate-from-landsec');
  console.log('AFTER-CLICK', JSON.stringify(clicked));
  const t = await page.evaluate(() => (document.body.innerText||'').replace(/\s+/g,' '));
  console.log('WESTGATE', t.slice(600, 3000));
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();
