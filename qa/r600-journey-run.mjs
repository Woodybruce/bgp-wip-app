// r600 step 6b: the WRITE — Mark adds the follow-up task from the phone.
import { go, tap, page, report, browser } from './r600-client-mobile-journey.mjs';

await go('/tasks', 'tasks');
const box = page.locator('[data-testid="input-add-task"]').first();
console.log('placeholder:', await box.getAttribute('placeholder'));
const b = await box.boundingBox();
console.log('add-task box:', JSON.stringify(b));
await box.click();
await box.fill('r600 phone: call Ramen rep back about BWREST Portakabin');
await page.keyboard.press('Enter');
await report('task-added', { text: true });
await browser.close();
