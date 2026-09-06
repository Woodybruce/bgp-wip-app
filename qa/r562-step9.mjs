import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 420000);
HARD.unref?.();
const UNIT = '36c81e04-6f16-4951-8ea7-cbaf16b83741';
async function pick(text, label) {
  const el = page.locator(`text="${text}"`).last();
  await el.click({ timeout: 6000 }).then(()=>console.log(`   picked ${label}=${text}`)).catch(e=>console.log(`!! pick ${label} ${String(e).slice(0,120)}`));
  await page.waitForTimeout(900);
}
async function dump(label) {
  const d = await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"]') || document.body;
    return { text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 2200) };
  });
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 2600)}`);
}
page.on('request', r => { if (/\/api\/(viewings|units)/.test(r.url()) && r.method() !== 'GET') console.log(`   >> ${r.method()} ${r.url().replace(BASE,'')} ${(r.postData()||'').slice(0,260)}`); });
page.on('response', async r => { if (/\/api\/(viewings|units)/.test(r.url()) && r.request().method() !== 'GET') console.log(`   << ${r.status()} ${r.url().replace(BASE,'')} ${(await r.text().catch(()=>'')).slice(0,300)}`); });
try {
  await go('/', 'cold');
  await go('/available', 'tracker');
  await page.waitForTimeout(2500);
  await tap(`[data-testid="unit-viewing-${UNIT}"]`, 'viewing-dialog');
  await page.waitForTimeout(1200);
  await page.fill('[data-testid="viewing-time"]', '11:30');
  await page.fill('[data-testid="viewing-attendees"]', 'Victoria Bruce; Starbucks acquisitions');
  await page.fill('[data-testid="viewing-notes"]', 'R562 viewing - keen, wants floor plans');
  await tap('[data-testid="viewing-company"]', 'open-company');
  await pick('Starbucks', 'company');
  await tap('[data-testid="viewing-contact"]', 'open-contact');
  await pick('Tom Barista', 'contact');
  await tap('[data-testid="viewing-outcome"]', 'open-outcome');
  await pick('Offer Expected', 'outcome');
  await tap('[data-testid="viewing-save"]', 'save-viewing');
  await page.waitForTimeout(2500);
  await dump('after-save');
  // close and re-read the card
  await page.keyboard.press('Escape').catch(()=>{});
  await page.waitForTimeout(1500);
  const card = await page.evaluate((u) => {
    const btn = document.querySelector(`[data-testid="unit-viewing-${u}"]`);
    return { label: (btn?.textContent||'').trim(), body: document.body.innerText.replace(/\s+/g,' ').slice(0, 420) };
  }, UNIT);
  console.log('-- CARD AFTER', JSON.stringify(card));
  // reload — does it persist (r557 lesson)
  await go('/available', 'tracker-reload');
  await page.waitForTimeout(3000);
  const card2 = await page.evaluate((u) => ({ label: (document.querySelector(`[data-testid="unit-viewing-${u}"]`)?.textContent||'').trim() }), UNIT);
  console.log('-- CARD AFTER RELOAD', JSON.stringify(card2));
  await tap(`[data-testid="unit-viewing-${UNIT}"]`, 'viewing-reopen');
  await page.waitForTimeout(1500);
  await dump('viewing-list-reopened');
  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
