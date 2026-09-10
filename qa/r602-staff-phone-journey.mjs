// r602 journey: BGP staff (Victoria) on the phone shell at 390px.
// Task framing: "A tenant rep has just rung me about a Bluewater unit while
// I'm on the train. Find the unit on the letting tracker on my phone, see
// where it stands, log the call as a viewing/interest, and leave myself a
// task — all before I get off."
import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';

const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 420000);
HARD.unref?.();

async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : (document.querySelector('[role="dialog"]') || document.body);
    if (!root) return { missing: true };
    return {
      btns: [...root.querySelectorAll('button,[role="option"],a[href]')].map(e => ({ t: (e.textContent || '').trim().slice(0, 28), tid: e.getAttribute('data-testid') || '' })).filter(x => x.t || x.tid).slice(0, 45),
      inputs: [...root.querySelectorAll('input,textarea,select')].map(e => ({ tid: e.getAttribute('data-testid') || '', ph: e.getAttribute('placeholder') || '', type: e.getAttribute('type') || '' })).slice(0, 25),
      text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 900),
    };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 3000)}`);
  return d;
}
async function step(label, fn) {
  try { return await fn(); } catch (e) { console.log(`!! STEP ${label} FAILED: ${String(e).slice(0, 220)}`); await shot(`${label}-fail`).catch(() => {}); return null; }
}

try {
  // 1. Cold open — the staff phone home.
  await go('/', 'home');
  await dump('home');

  // 2. Can she get to the letting tracker from here at all?
  await go('/available', 'tracker');

  // 3. Find the unit the rep rang about: MSU9 at Bluewater.
  const UNIT = '36c81e04-6f16-4951-8ea7-cbaf16b83741';
  await step('search', async () => {
    await page.fill('[data-testid="input-search-units"]', 'MSU9');
    await page.waitForTimeout(900);
    await report('tracker-searched');
    await dump('tracker-searched');
  });

  // 4. What is already logged on it — the viewing and the offer.
  await step('viewing-open', () => tap(`[data-testid="unit-viewing-${UNIT}"]`, 'viewing-panel'));

  // 5. THE WRITE — log the call as a viewing from the phone.
  await step('viewing-fill', async () => {
    await page.click('[data-testid="viewing-company"]');
    await page.waitForTimeout(700);
    await page.locator('[role="option"]:has-text("Honi Poke")').first().click();
    await page.waitForTimeout(700);
    await page.click('[data-testid="viewing-contact"]');
    await page.waitForTimeout(700);
    await dump('contact-picker');
    const opt = page.locator('[role="option"]').first();
    await opt.click({ timeout: 4000 }).catch(() => console.log('   (no contact option to pick)'));
    await page.waitForTimeout(500);
    await page.fill('[data-testid="viewing-date"]', '2026-09-07');
    await page.fill('[data-testid="viewing-time"]', '16:20');
    await page.fill('[data-testid="viewing-attendees"]', 'Victoria Bruce, Honi Poke acquisitions');
    await page.click('[data-testid="viewing-outcome"]');
    await page.waitForTimeout(600);
    await dump('outcome-picker');
    await page.locator('[role="option"], [role="menuitem"], button').filter({ hasText: /Interested/i }).first().click({ timeout: 4000 }).catch(() => console.log('   (no Interested option)'));
    await page.waitForTimeout(400);
    await page.fill('[data-testid="viewing-notes"]', 'r602 phone journey — rep rang re MSU9, wants revised figures');
    await shot('viewing-filled');
  });
  await step('viewing-save', () => tap('[data-testid="viewing-save"]', 'viewing-saved'));
  await dump('viewing-after-save');

  // 6. Close, and check the card count moved.
  await step('viewing-close', async () => {
    await page.locator('button:has-text("Close")').last().click().catch(() => page.keyboard.press('Escape'));
    await page.waitForTimeout(1200);
    await report('tracker-after-viewing');
  });

  // 7. What is the standing offer on it?
  await step('offer-open', () => tap(`[data-testid="unit-offer-${UNIT}"]`, 'offer-panel'));
  await dump('offer-panel');
  await step('offer-close', async () => {
    await page.locator('button:has-text("Close")').last().click().catch(() => page.keyboard.press('Escape'));
    await page.waitForTimeout(1000);
  });

  // 8. Leave herself a task to send the figures.
  await go('/tasks', 'tasks');
  await step('task-write', async () => {
    await page.fill('[data-testid="input-add-task"]', 'r602 — send Honi Poke revised MSU9 figures');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1800);
    await report('tasks-after-write');
    await dump('tasks-after-write');
  });
} finally {
  clearTimeout(HARD);
  await browser.close();
}
