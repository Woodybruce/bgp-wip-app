// r570 journey part 2: interest note, status move, persistence across reload.
import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 520000);
HARD.unref?.();
const UNIT = '8ab96050-3b06-4bdd-bb17-f419a3485fea';
async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : (document.querySelector('[role="dialog"]') || document.body);
    if (!root) return { missing: true };
    return { btns: [...root.querySelectorAll('button,[role="option"]')].map(e => ({ t:(e.textContent||'').trim().slice(0,30), tid:e.getAttribute('data-testid')||'' })).filter(x=>x.t||x.tid).slice(0,45),
      text: (root.innerText||'').replace(/\s+/g,' ').slice(0,1000) };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0,2400)}`);
  return d;
}
async function step(label, fn) { try { return await fn(); } catch (e) { console.log(`!! STEP ${label} FAILED: ${String(e).slice(0,240)}`); await shot(`${label}-fail`).catch(()=>{}); return null; } }
async function pick(tid, optText) {
  await page.click(`[data-testid="${tid}"]`); await page.waitForTimeout(800);
  await page.locator(`[role="option"]:has-text("${optText}"), button:has-text("${optText}")`).first().click({ timeout: 6000 });
  await page.waitForTimeout(500); console.log(`   picked "${optText}" for ${tid}`);
}
const chips = () => page.evaluate(() => { const o={}; for (const b of document.querySelectorAll('[data-testid^="stat-chip-"]')) o[b.getAttribute('data-testid').replace('stat-chip-','')] = (b.innerText||'').replace(/\s+/g,' ').trim(); return o; });
const card = (id) => page.evaluate((uid) => { const el=document.querySelector(`[data-testid="mobile-unit-${uid}"]`); return el?(el.innerText||'').replace(/\s+/g,' ').slice(0,300):null; }, id);

try {
  await go('/available', 'tracker');
  // ---- 1. register interest ----------------------------------------------
  await step('interest-open', () => tap(`[data-testid="unit-interest-${UNIT}"]`, 'interest-open'));
  await step('interest-fill', async () => {
    await pick('interest-company', 'Honi Poke');
    await page.fill('[data-testid="interest-notes"]', 'QA-PROBE r570 — rang after the viewing, wants floorplans + service charge');
    await shot('interest-filled');
  });
  await step('interest-save', () => tap('[data-testid="interest-add"]', 'interest-saved'));
  await dump('interest-after-save');
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200);

  // ---- 2. reload: did the phone keep it? ---------------------------------
  await go('/available', 'after-interest-reload');
  console.log('CARD-AFTER-INTEREST', await card(UNIT));
  await step('interest-reopen', () => tap(`[data-testid="unit-interest-${UNIT}"]`, 'interest-reopen'));
  await dump('interest-after-reload');
  await page.keyboard.press('Escape'); await page.waitForTimeout(1000);

  // ---- 3. move the unit's status (Available -> Opportunity) --------------
  await go('/available', 'pre-status');
  console.log('CHIPS-PRE-STATUS', JSON.stringify(await chips()));
  await step('edit-open', () => tap(`[data-testid="unit-edit-${UNIT}"]`, 'edit-open'));
  await step('status-set', async () => {
    const trig = page.locator('[role="dialog"] button[role="combobox"]').filter({ hasText: /Available|Opportunity/ }).first();
    await trig.click(); await page.waitForTimeout(700);
    await page.locator('[role="option"]:has-text("Opportunity")').first().click({ timeout: 6000 });
    await page.waitForTimeout(500);
    await shot('status-picked');
  });
  await step('edit-save', async () => {
    await page.locator('[role="dialog"] button:has-text("Save")').first().click({ timeout: 6000 });
    await page.waitForTimeout(2500);
    await report('edit-saved');
  });
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200);

  // ---- 4. reload: did the status move stick? -----------------------------
  await go('/available', 'after-status-reload');
  console.log('CHIPS-AFTER-STATUS', JSON.stringify(await chips()));
  console.log('CARD-AFTER-STATUS ', await card(UNIT));
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();
