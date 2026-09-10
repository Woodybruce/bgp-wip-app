import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 420000);
HARD.unref?.();
const UNIT = '36c81e04-6f16-4951-8ea7-cbaf16b83741';
async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : (document.querySelector('[role="dialog"]') || document.body);
    if (!root) return { missing: true };
    return { text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 2600),
      ctl: [...root.querySelectorAll('button,[role="option"],input,textarea,[role="combobox"]')].map(e => ({ t:(e.textContent||'').trim().slice(0,34), tid:e.getAttribute('data-testid')||'', tag:e.tagName, v:(e.value!==undefined?String(e.value):'').slice(0,26) })).filter(x=>x.t||x.tid).slice(0,50) };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 3800)}`);
  return d;
}
try {
  await go('/', 'cold');
  await go('/available', 'tracker');
  await page.waitForTimeout(2500);
  await tap(`[data-testid="unit-viewing-${UNIT}"]`, 'viewing-dialog');
  await page.waitForTimeout(1200);

  // Fill it in as Victoria would straight after the viewing
  await page.fill('[data-testid="viewing-time"]', '11:30').catch(e => console.log('!! time', String(e).slice(0,120)));
  await page.fill('[data-testid="viewing-attendees"]', 'Victoria Bruce; Starbucks acquisitions').catch(e => console.log('!! att', String(e).slice(0,120)));
  await page.fill('[data-testid="viewing-notes"]', 'R562 viewing — keen, wants floor plans').catch(e => console.log('!! notes', String(e).slice(0,120)));
  // company picker
  await tap('[data-testid="viewing-company"]', 'open-company-picker');
  await page.waitForTimeout(1200);
  await dump('company-picker');
  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
