import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 420000);
HARD.unref?.();
const NAME = 'R578 Phone Unit';
async function dlgText(l) {
  const t = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? (d.innerText||'').replace(/\s+/g,' ').slice(0,1400) : 'NO DIALOG';
  });
  console.log(`-- DLG ${l}: ${t}`);
}
try {
  await go('/deals/letting', 'phone-letting');
  await tap('[data-testid="button-add-unit"]', 'add-open');
  await page.waitForTimeout(1000);

  // Property
  await page.click('[data-testid="select-property"]');
  await page.waitForTimeout(700);
  const pin = page.locator('input[placeholder*="Search"], [role="dialog"] input').last();
  await pin.fill('Bluewater').catch(async () => { await page.keyboard.type('Bluewater'); });
  await page.waitForTimeout(1200);
  const opts = await page.evaluate(() => [...document.querySelectorAll('[role="option"],[cmdk-item]')].map(e=>(e.textContent||'').trim().slice(0,40)).slice(0,8));
  console.log('-- prop options ' + JSON.stringify(opts));
  await page.locator('[role="option"],[cmdk-item]').first().click().catch(e=>console.log('!! prop pick '+e));
  await page.waitForTimeout(900);
  await dlgText('after-property');

  // Unit name
  await page.click('[data-testid="input-unit-name"]');
  await page.waitForTimeout(600);
  const nin = page.locator('[role="dialog"] input:visible, input:visible').last();
  await nin.fill(NAME).catch(()=>{});
  await page.waitForTimeout(900);
  const nopts = await page.evaluate(() => [...document.querySelectorAll('[role="option"],[cmdk-item]')].map(e=>(e.textContent||'').trim().slice(0,40)).slice(0,8));
  console.log('-- unit options ' + JSON.stringify(nopts));
  await shot('unit-name-typed');
  await dlgText('after-unit-name');
  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
