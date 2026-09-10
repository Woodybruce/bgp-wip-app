// r608 · part 3 — the write. Mark self-adds a brand to his Brand CRM from
// the phone, then checks it landed where the app says it will.
import { go, tap, report, shot, page, browser, BASE, user } from './r600-client-mobile-journey.mjs';

await go('/', 'dash', {});
await tap('a[href="/brands"], button:has-text("Brands"), [data-testid*="brands"]', 'phone-brands-hub', { text: true });
await page.waitForTimeout(3000);
await report('phone-brands-hub-settled', { text: true });
await tap('[data-testid="client-add-brand"]', 'phone-add-brand-dialog', {});
const box = page.locator('[data-testid="client-add-brand-search"]');
await box.fill('Nando');
await page.waitForTimeout(2500);
await report('phone-add-brand-results', { text: true });
const addBtn = page.locator('button:has-text("Add")').last();
await addBtn.click().catch(e => console.log('ADD TAP FAILED', String(e).slice(0,150)));
await page.waitForTimeout(2500);
await report('phone-add-brand-added', { text: true });
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
await go('/brands', 'phone-brands-after-add', { text: true });
await page.waitForTimeout(3500);
await report('phone-brands-after-add-settled', { text: true });
await browser.close();
