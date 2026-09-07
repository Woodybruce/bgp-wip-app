// Read-only visual review against the disposable smoke fixture.
// UX_OUTPUT selects an evidence directory; SMOKE_BASE must be local.
import { chromium, devices } from '../node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname)) throw new Error('Use a local fixture app');
const DIR = process.env.UX_OUTPUT || fileURLToPath(new URL('./smoke-shots/ux/', import.meta.url));
mkdirSync(DIR, { recursive: true });
const smoke = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8');
const fixture = name => smoke.match(new RegExp(`const ${name} = '([^']+)'`))[1];
const results = [];
const browser = await chromium.launch({ headless: true, ...(process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {}) });
try {
  for (const device of ['phone', 'desktop']) {
    for (const person of ['STAFF', 'CLIENT']) {
      const context = await browser.newContext({ ...(device === 'phone' ? devices['iPhone 13'] : { viewport: { width: 1440, height: 1000 } }), serviceWorkers: 'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === BASE ? route.continue() : route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('card-login').waitFor({ state: 'visible', timeout: 25000 });
      const toggle = page.getByTestId('button-show-guest-login');
      if (await toggle.isVisible()) await toggle.click();
      await page.getByTestId('input-guest-email').fill(fixture(person));
      await page.getByTestId('input-guest-password').fill(fixture('PASSWORD'));
      await page.getByTestId('button-guest-login').click();
      await page.getByTestId('card-login').waitFor({ state: 'hidden', timeout: 25000 });
      const routes = [
        ['home', '/'], ['deals', '/deals/list'],
        ...(person === 'STAFF' ? [['wip', '/deals/report']] : []),
        ['properties', '/properties'], ['property', `/properties/${fixture('BLUEWATER')}`],
        ['brand', `/companies/${fixture('BRAND_CO')}`],
      ];
      for (const [name, path] of routes) {
        if (process.env.UX_ROUTE && name !== process.env.UX_ROUTE) continue;
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('card-login').waitFor({ state: 'hidden', timeout: 25000 });
        if (name === 'wip') await page.getByTestId('wip-report-page').waitFor({ state: 'visible', timeout: 25000 });
        if (name === 'property') await page.getByTestId(`property-detail-${fixture('BLUEWATER')}`).waitFor({ state: 'visible', timeout: 25000 });
        if (name === 'brand') await page.getByTestId('text-company-detail-name').waitFor({ state: 'visible', timeout: 25000 });
        await page.waitForTimeout(1600);
        const metrics = await page.evaluate(() => {
          const rect = selector => {
            const node = document.querySelector(selector);
            if (!node) return null;
            const r = node.getBoundingClientRect();
            return { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width) };
          };
          return {
            url: location.pathname,
            viewport: { width: innerWidth, height: innerHeight },
            documentWidth: document.documentElement.scrollWidth,
            mainText: document.body.innerText.slice(0, 2500),
            summary: rect('[data-testid="wip-phone-summary"]'),
            firstDealCard: rect('[data-testid="wip-card-0"]'),
            filters: rect('[data-testid="wip-filters-bar"]'),
          };
        });
        const file = `${device}-${person.toLowerCase()}-${name}.png`;
        await page.screenshot({ path: `${DIR}/${file}`, fullPage: false });
        const result = { device, person, name, file, ...metrics, errors: [...errors] };
        results.push(result);
        console.log(JSON.stringify({ device, person, name, width: metrics.documentWidth, summary: metrics.summary, firstDealCard: metrics.firstDealCard }));
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  writeFileSync(`${DIR}/review.json`, `${JSON.stringify(results, null, 2)}\n`);
}
process.exitCode = results.some(r => r.errors.length || r.documentWidth > r.viewport.width + 1) ? 1 : 0;
