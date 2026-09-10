// r610 journey: BGP staff (Victoria) on the phone shell at 390px.
// Task framing: "Monday, sat in reception waiting for the Landsec meeting.
// Woody's put a task on me over the weekend — what is it? Check today's
// diary for the meeting, then actually DO the task: get Gail's Bakery's
// requirement onto the requirements board from my phone, and tick it off."
import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';

const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 480000);
HARD.unref?.();

async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : (document.querySelector('[role="dialog"]') || document.body);
    if (!root) return { missing: true };
    return {
      btns: [...root.querySelectorAll('button,[role="option"],a[href]')].map(e => ({ t: (e.textContent || '').trim().slice(0, 30), tid: e.getAttribute('data-testid') || '' })).filter(x => x.t || x.tid).slice(0, 50),
      inputs: [...root.querySelectorAll('input,textarea,select')].map(e => ({ tid: e.getAttribute('data-testid') || '', ph: e.getAttribute('placeholder') || '', type: e.getAttribute('type') || '' })).slice(0, 30),
      text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 1400),
    };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 3600)}`);
  return d;
}
async function step(label, fn) {
  try { return await fn(); } catch (e) { console.log(`!! STEP ${label} FAILED: ${String(e).slice(0, 220)}`); await shot(`${label}-fail`).catch(() => {}); return null; }
}
async function settle(ms) { await page.waitForTimeout(ms); }

try {
  // 1. Cold open. Phone first-visit needs the long settle (r608).
  await go('/', 'home-cold');
  await settle(11000);
  await report('home-settled');
  await dump('home');

  // 2. The task Woody put on her — is it on the home list, and does it say
  //    who assigned it?
  await go('/tasks', 'tasks-cold');
  await settle(11000);
  await report('tasks-settled');
  await dump('tasks');
} catch (e) {
  console.log('!! JOURNEY PART 1 ABORTED: ' + String(e).slice(0, 400));
}
await browser.close();
clearTimeout(HARD);
