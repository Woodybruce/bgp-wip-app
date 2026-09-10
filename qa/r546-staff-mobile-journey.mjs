// r546 journey: BGP staff (Victoria) on a phone at 390px.
// Task framing: "I've just come out of a viewing at Brent Cross BX10. Record
// the viewing, log the verbal offer the operator made, then file my travel
// expense — all on my phone before I get on the train."
import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';

const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 430000);
HARD.unref?.();

async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : (document.querySelector('[role="dialog"]') || document.body);
    if (!root) return { missing: true };
    return {
      btns: [...root.querySelectorAll('button,[role="option"]')].map(e => ({ t: (e.textContent || '').trim().slice(0, 30), tid: e.getAttribute('data-testid') || '' })).filter(x => x.t || x.tid).slice(0, 40),
      inputs: [...root.querySelectorAll('input,textarea')].map(e => ({ tid: e.getAttribute('data-testid') || '', ph: e.getAttribute('placeholder') || '', type: e.getAttribute('type') || '' })).slice(0, 25),
      text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 800),
    };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 2400)}`);
  return d;
}
async function step(label, fn) {
  try { return await fn(); } catch (e) { console.log(`!! STEP ${label} FAILED: ${String(e).slice(0, 220)}`); await shot(`${label}-fail`).catch(() => {}); return null; }
}
async function pick(triggerTid, optionText, label) {
  await page.click(`[data-testid="${triggerTid}"]`);
  await page.waitForTimeout(700);
  const opt = page.locator(`button:has-text("${optionText}"), [role="option"]:has-text("${optionText}")`).first();
  await opt.click({ timeout: 5000 });
  await page.waitForTimeout(500);
  console.log(`   picked ${optionText} for ${triggerTid}`);
}

try {
  await go('/available', 'tracker-list');
  const unit = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(e => /^unit-viewing-/.test(e.getAttribute('data-testid') || ''));
    return b ? b.getAttribute('data-testid').replace('unit-viewing-', '') : null;
  });
  console.log('UNIT', unit);

  // ---- 1. record the viewing ---------------------------------------------
  await step('viewing-open', () => tap(`[data-testid="unit-viewing-${unit}"]`, 'viewing-open'));
  await step('viewing-fill', async () => {
    await pick('viewing-company', 'Honi Poke');
    await dump('after-company');
    await page.fill('[data-testid="viewing-date"]', '2026-09-05');
    await page.fill('[data-testid="viewing-time"]', '11:30');
    await page.fill('[data-testid="viewing-attendees"]', 'Victoria Bruce, operator ops director');
    await pick('viewing-outcome', 'Interested');
    await page.fill('[data-testid="viewing-notes"]', 'r546 phone journey — keen, wants figures today');
    await shot('viewing-filled');
  });
  await step('viewing-save', () => tap('[data-testid="viewing-save"]', 'viewing-saved'));
  await step('viewing-verify', () => dump('viewing-list-after-save'));
  await step('viewing-close', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  });

  // ---- 2. log the verbal offer -------------------------------------------
  await step('offer-open', () => tap(`[data-testid="unit-offer-${unit}"]`, 'offer-open'));
  await step('offer-fill', async () => {
    await pick('offer-company', 'Honi Poke');
    await page.fill('[data-testid="offer-date"]', '2026-09-05');
    await page.fill('[data-testid="offer-rent"]', '85000');
    await page.fill('[data-testid="offer-rent-free"]', '6');
    await page.fill('[data-testid="offer-term"]', '10');
    await page.fill('[data-testid="offer-break"]', 'Year 5');
    await page.fill('[data-testid="offer-premium"]', '0');
    await page.fill('[data-testid="offer-fitout"]', '50000');
    await page.fill('[data-testid="offer-incentives"]', 'Landlord to strip out');
    await page.fill('[data-testid="offer-comments"]', 'r546 phone journey — verbal offer taken on site');
    await shot('offer-filled');
  });
  await step('offer-save', () => tap('[data-testid="offer-save"]', 'offer-saved'));
  await step('offer-verify', () => dump('offer-list-after-save'));
  await step('offer-close', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(1200); });

  // ---- 3. does the tracker card reflect the new activity? ----------------
  await step('tracker-reload', () => go('/available', 'tracker-after-activity'));

  // ---- 4. file the travel expense ----------------------------------------
  await step('expenses', () => go('/m/expenses', 'phone-expenses'));
  await step('expenses-dump', () => dump('expenses-screen', 'body'));
  await step('expense-upload', async () => {
    // a 1x1 JPEG stands in for the train-ticket photo off her camera roll
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
    await page.setInputFiles('[data-testid="mobile-expense-new-input"]', { name: 'train-ticket.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await page.waitForTimeout(6000);
    await report('expense-after-upload');
    await dump('expense-form', 'body');
  });
} finally {
  await browser.close().catch(() => {});
}
