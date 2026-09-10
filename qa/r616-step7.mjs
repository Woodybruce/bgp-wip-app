import { go, tap, report, shot, page, browser, BASE } from './r600-client-mobile-journey.mjs';
const PID = 'cccccccc-0000-0000-0000-000000000001';
await page.goto(BASE + '/properties/' + PID).catch(()=>{});
await page.waitForTimeout(14000);
// THE WRITE — Mark adds this week's focus item from his phone
const input = page.locator('input[placeholder*="Add a task"]').first();
await input.scrollIntoViewIfNeeded();
await input.fill('Agenda: Q3 vacancy plan for the upper level');
await shot('focus-typed');
await page.locator('button:text-is("Add")').first().click();
await page.waitForTimeout(3500);
await report('focus-after-add', { text: true });
console.log('FOCUS CARD:', await page.evaluate(() => {
  const h = [...document.querySelectorAll('div')].find(d => /This week's focus/i.test(d.textContent||'') && d.textContent.length < 400);
  return h ? h.parentElement.parentElement.innerText.replace(/\n+/g,' | ') : 'not found';
}));
// the card's promise: "they'll appear on My Tasks too"
await go('/tasks', 'my-tasks', { text: true });
await browser.close();
