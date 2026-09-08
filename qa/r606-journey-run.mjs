// r606 · step 5: the write. Mark leaves a task on the way out of the board.
import { go, report, browser, page } from './r606-client-desktop-journey.mjs';

await go('/', 'dash-write', {});
const box = page.locator('input[placeholder*="Quick add task"]').first();
await box.click();
await box.fill('Chase BGP on Bluewater MSU9 — heads of terms before the AM meeting');
await box.press('Enter');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'qa/smoke-shots/r606-task-write.png' });
const after = await page.evaluate(() => document.body.innerText.includes('Chase BGP on Bluewater MSU9'));
console.log('TASK VISIBLE ON DASHBOARD:', after);
await go('/tasks', 'my-tasks', {});
const onPage = await page.evaluate(() => document.body.innerText.includes('Chase BGP on Bluewater MSU9'));
console.log('TASK ON MY TASKS PAGE:', onPage);
await page.screenshot({ path: 'qa/smoke-shots/r606-my-tasks.png' });
await browser.close();
