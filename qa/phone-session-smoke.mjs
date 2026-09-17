// Phone session/navigation smoke: run against the same local fixture app as qa/smoke.mjs.
// Uses SMOKE_BASE and optional SMOKE_CHROMIUM; creates and cleans one self-only test thread.
// PHONE_SMOKE_DATABASE_URL adds guarded synthetic property/brand checks (required in CI).
import { chromium, devices } from '../node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPhonePropertyBrandFixture } from './phone-property-brand-fixture.mjs';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname)) throw new Error('Phone smoke requires a local fixture app');
const DIR = fileURLToPath(new URL('./smoke-shots/phone/', import.meta.url));
const smoke = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8');
const fixture = (name) => smoke.match(new RegExp(`const ${name} = '([^']+)'`))[1];
const PASSWORD = fixture('PASSWORD');
const STAFF = fixture('STAFF');
const CLIENT = fixture('CLIENT');
const CANARY = `PHONE-QA-PRIVATE-${Date.now()}`;
const results = { base: BASE, viewport: 'iPhone 13', browser: 'Chromium with iPhone touch/UA emulation; not physical iOS Safari', checks: [], pageErrors: [], apiErrors: [], blockedExternalHosts: [], screenshots: [], skipped: [], canary: CANARY };
mkdirSync(DIR, { recursive: true });
const failures = [];
function check(name, passed, detail = '') {
  results.checks.push({ name, passed, detail });
  if (!passed) failures.push({ name, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
async function snap(page, file) {
  await page.screenshot({ path: `${DIR}${file}`, fullPage: false });
  results.screenshots.push(file);
}
async function watch(context, label) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === BASE || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    if (!results.blockedExternalHosts.includes(url.hostname)) results.blockedExternalHosts.push(url.hostname);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', error => { results.pageErrors.push({ label, message: error.message }); console.log(`PAGEERROR ${label}: ${error.message}`); });
  page.on('response', response => {
    if (response.url().startsWith(`${BASE}/api/`) && response.status() >= 400) results.apiErrors.push({ label, status: response.status(), path: response.url().slice(BASE.length) });
  });
  return page;
}
async function login(page, username) {
  await page.getByTestId('card-login').waitFor({ state: 'visible', timeout: 25000 });
  const toggle = page.getByTestId('button-show-guest-login');
  if (await toggle.isVisible()) await toggle.click();
  await page.getByTestId('input-guest-email').fill(username);
  await page.getByTestId('input-guest-password').fill(PASSWORD);
  await page.getByTestId('button-guest-login').click();
  await page.getByTestId('card-login').waitFor({ state: 'hidden', timeout: 25000 });
  await page.waitForTimeout(1200);
}
async function api(page, method, path, data) {
  return page.evaluate(async ({ method, path, data }) => {
    const token = localStorage.getItem('bgp_auth_token');
    const response = await fetch(path, {
      method, credentials: 'include', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, data: await response.json().catch(() => null) };
  }, { method, path, data });
}
async function phoneFit(page, label, selectors = []) {
  const fit = await page.evaluate(selectors => {
    const viewport = window.innerWidth;
    const overflowing = selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)).flatMap(element => {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height || box.top === 0 && box.bottom === 0) return [];
      return box.left < -1 || box.right > viewport + 1 ? [{ selector, left: box.left, right: box.right }] : [];
    }));
    return { viewport, documentWidth: document.documentElement.scrollWidth, overflowing };
  }, selectors);
  check(`${label}: no horizontal overflow`, fit.documentWidth <= fit.viewport + 1 && fit.overflowing.length === 0, JSON.stringify(fit));
}
const browser = await chromium.launch({ headless: true, ...(process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {}) });
let canaryId;
let propertyBrandFixture;
const contexts = [];
try {
  const staffContext = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  contexts.push(staffContext);
  const staff = await watch(staffContext, 'staff-phone');
  await staff.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
  await login(staff, STAFF);
  await staff.getByTestId('button-mobile-my-profile').waitFor({ state: 'visible', timeout: 20000 });
  check('staff mobile login', await staff.getByTestId('button-mobile-my-profile').isVisible());

  if (process.env.PHONE_SMOKE_DATABASE_URL || process.env.CI) {
    try {
      propertyBrandFixture = await createPhonePropertyBrandFixture(process.env.PHONE_SMOKE_DATABASE_URL);
      const { ids, names } = propertyBrandFixture;
      results.propertyBrandFixtureIds = ids;
      const device = await staff.evaluate(() => ({ ua: navigator.userAgent, touch: navigator.maxTouchPoints, width: innerWidth, height: innerHeight }));
      check('phone scenario uses touch and mobile UA, not only a narrow desktop viewport', device.touch > 0 && /iPhone|Mobile/.test(device.ua) && Math.min(device.width, device.height) < 768, JSON.stringify(device));

      await staff.goto(`${BASE}/properties`, { waitUntil: 'domcontentloaded' });
      await staff.getByTestId('input-search-properties').fill(names.property);
      const propertyCard = staff.locator(`a[href="/properties/${ids.property}"]`).first();
      await propertyCard.waitFor({ state: 'visible', timeout: 25000 });
      check('phone properties use cards and retain the page controls', await staff.getByTestId('property-pagination-top').isVisible() && await staff.getByTestId('button-toggle-columns').count() === 0);
      await phoneFit(staff, 'property cards', ['[data-testid="property-pagination-top"]', `a[href="/properties/${ids.property}"]`]);
      await snap(staff, 'staff-property-list-phone.png');
      await propertyCard.click();
      await staff.getByTestId('property-simple-overview').waitFor({ state: 'visible', timeout: 25000 });
      check('phone Building overview shows current income only', (await staff.getByTestId('property-simple-overview').textContent()).includes('£24,000') && !(await staff.getByTestId('property-simple-overview').textContent()).includes('£114,000'));
      await phoneFit(staff, 'property overview', ['[data-testid="property-view-controls"]', '[data-testid="property-phone-sections"]', '[data-testid="property-simple-overview"]']);
      await snap(staff, 'staff-property-overview-phone.png');
      await staff.getByRole('button', { name: 'Open tenancy', exact: true }).click();
      await staff.getByTestId(`tenancy-card-${ids.currentTenancy}`).waitFor({ state: 'visible', timeout: 25000 });
      check('phone tenancy retains editing and hides history by default', await staff.getByTestId(`tenancy-status-card-${ids.currentTenancy}`).isVisible() && await staff.getByTestId(`tenancy-card-${ids.archivedTenancy}`).count() === 0);
      await staff.getByTestId('tenancy-show-history').click();
      await staff.getByTestId(`tenancy-card-${ids.archivedTenancy}`).waitFor({ state: 'visible' });
      check('phone history does not inflate current rent', (await staff.getByTestId('tenancy-stat-passing-rent').textContent()).includes('£24,000'));
      await phoneFit(staff, 'property tenancy', [`[data-testid="tenancy-card-${ids.currentTenancy}"]`, '[data-testid="tenancy-stat-passing-rent"]']);
      await snap(staff, 'staff-property-tenancy-phone.png');
      await staff.getByTestId('property-section-overview').click();
      await staff.getByTestId('property-toggle-full-page').click();
      check('phone can reach and return from the full property board', await staff.getByTestId('property-section-boards').isVisible());
      await staff.getByTestId('property-toggle-full-page').click();
      await staff.getByTestId('property-section-tenancy').waitFor({ state: 'visible' });

      await staff.goto(`${BASE}/companies/${ids.brand}`, { waitUntil: 'domcontentloaded' });
      await staff.getByTestId('company-detail-mobile').waitFor({ state: 'visible', timeout: 25000 });
      await staff.getByTestId('company-section-contacts').click();
      const representedBy = staff.getByTestId('company-phone-represented-by');
      await representedBy.waitFor({ state: 'visible', timeout: 25000 });
      check('phone Contacts shows named agents and firm confirmation independently', (await representedBy.textContent()).includes(names.namedContact) && (await representedBy.textContent()).includes('Firm unconfirmed') && (await representedBy.textContent()).includes(names.agency));
      check('phone representation links use the recorded contact and firm IDs', await representedBy.locator(`a[href="/contacts/${ids.namedContact}"]`).count() === 1 && await representedBy.locator(`a[href="/companies/${ids.agency}"]`).count() === 1 && await representedBy.locator('a[href*="undefined"],a[href*="null"]').count() === 0);
      await phoneFit(staff, 'brand Contacts', ['[data-testid="company-phone-sections"]', '[data-testid="company-phone-represented-by"]', '[data-testid="company-phone-represented-by"] a']);
      await snap(staff, 'staff-brand-contacts-phone.png');
      await representedBy.locator(`a[href="/contacts/${ids.namedContact}"]`).click();
      await staff.waitForURL(`**/contacts/${ids.namedContact}`);
      check('phone named-agent link opens the real contact route', new URL(staff.url()).pathname === `/contacts/${ids.namedContact}`);
    } catch (error) {
      check('phone property and brand Contacts scenario', false, error.stack || error.message);
      await snap(staff, 'property-brand-phone-failure.png').catch(() => {});
    }
  } else results.skipped.push('Property/brand phone scenario: set PHONE_SMOKE_DATABASE_URL for disposable synthetic fixtures');

  try {
    await staff.goto(`${BASE}/deals`, { waitUntil: 'domcontentloaded' });
    await staff.getByTestId('toggle-deals-wip-report').click({ timeout: 20000 });
    await staff.getByTestId('wip-report-page').waitFor({ state: 'visible', timeout: 25000 });
    check('phone WIP tab uses canonical URL', new URL(staff.url()).pathname === '/deals/report', new URL(staff.url()).pathname);
    check('phone WIP summary is visible', await staff.getByTestId('wip-phone-summary').isVisible());
    await snap(staff, 'staff-wip-before-reload.png');
    await staff.reload({ waitUntil: 'domcontentloaded' });
    await staff.getByTestId('wip-report-page').waitFor({ state: 'visible', timeout: 25000 });
    check('phone WIP survives reload', new URL(staff.url()).pathname === '/deals/report' && await staff.getByTestId('wip-phone-summary').isVisible());
    await staff.getByTestId('toggle-deals-deals').click();
    await staff.waitForURL('**/deals/list');
    await staff.goBack({ waitUntil: 'domcontentloaded' });
    await staff.getByTestId('wip-report-page').waitFor({ state: 'visible', timeout: 25000 });
    check('phone Back restores WIP tab', new URL(staff.url()).pathname === '/deals/report');
    await snap(staff, 'staff-wip-after-back.png');
  } catch (error) { check('staff WIP navigation scenario', false, error.message); await snap(staff, 'staff-wip-failure.png').catch(() => {}); }

  try {
    await staff.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
    await staff.getByTestId('button-mobile-my-profile').waitFor({ state: 'visible', timeout: 20000 });
    await staff.getByTestId('button-mobile-my-profile').click();
    await staff.waitForURL('**/m/profile');
    await staff.getByTestId('button-profile-photo').waitFor({ state: 'visible', timeout: 20000 });
    check('staff avatar opens mobile profile', await staff.getByTestId('button-profile-photo').isVisible());
    await snap(staff, 'staff-profile.png');
  } catch (error) { check('staff mobile profile scenario', false, error.message); }

  try {
    const created = await api(staff, 'POST', '/api/chat/threads', { title: CANARY, isAiChat: false, memberIds: [] });
    if (created.status !== 200 || !created.data?.id) throw new Error(`Could not create disposable private canary: HTTP ${created.status}`);
    canaryId = created.data.id;
    // Empty self-only drafts are intentionally hidden from the phone list.
    const message = await api(staff, 'POST', `/api/chat/threads/${canaryId}/messages`, { content: 'Synthetic private fixture content for account isolation' });
    if (message.status !== 200) throw new Error(`Could not populate the self-only fixture: HTTP ${message.status}`);
    await staff.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
    await staff.getByText(CANARY, { exact: true }).waitFor({ state: 'visible', timeout: 20000 });
    check('staff private canary is rendered before account switch', true);
    await staff.waitForTimeout(2300);
    check('private canary reaches persisted query cache before expiry', await staff.evaluate(canary => (localStorage.getItem('bgp-query-cache') || '').includes(canary), CANARY));
    await staff.evaluate(() => { window.__phoneAuditDocument = 'same-document'; });
    const loggedOut = await api(staff, 'POST', '/api/auth/logout');
    check('only this fixture session was logged out', loggedOut.status === 200);
    // Click an actual tab so a new API query detects the expired session.
    await staff.getByTestId('bottom-nav-deals').click();
    await staff.getByTestId('card-login').waitFor({ state: 'visible', timeout: 25000 });
    check('expired session returns to login without a document reload', await staff.evaluate(() => window.__phoneAuditDocument === 'same-document'));
    check('expired session clears the private persisted snapshot', await staff.evaluate(canary => !(localStorage.getItem('bgp-query-cache') || '').includes(canary), CANARY));

    await staff.evaluate(canary => {
      window.__phoneAuditLeaks = [];
      window.__phoneAuditObserver = new MutationObserver(() => {
        if (document.body.textContent.includes(canary)) window.__phoneAuditLeaks.push(Date.now());
      });
      window.__phoneAuditObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    }, CANARY);
    await login(staff, CLIENT);
    check('client signs into the same document after staff expiry', await staff.evaluate(() => window.__phoneAuditDocument === 'same-document'));
    await staff.getByTestId('bottom-nav-messages').click();
    await staff.getByTestId('button-mobile-my-profile').waitFor({ state: 'visible', timeout: 20000 });
    await staff.waitForTimeout(2300);
    const privacy = await staff.evaluate(canary => ({
      priorPrivateTextVisible: document.body.textContent.includes(canary),
      priorPrivateSnapshotStored: (localStorage.getItem('bgp-query-cache') || '').includes(canary),
      observedTransientLeaks: window.__phoneAuditLeaks.length,
    }), CANARY);
    results.accountSwitchPrivacy = privacy;
    check('client never displays the previous staff private thread', !privacy.priorPrivateTextVisible && privacy.observedTransientLeaks === 0, JSON.stringify(privacy));
    check('client persistence excludes previous staff private thread', !privacy.priorPrivateSnapshotStored);
    await snap(staff, 'client-messages-after-account-switch.png');

    const beforeProfileErrors = results.apiErrors.length;
    await staff.getByTestId('button-mobile-my-profile').click();
    await staff.waitForURL('**/settings/profile');
    await staff.getByTestId('profile-photo-card').waitFor({ state: 'visible', timeout: 20000 });
    check('client profile contains personal controls without organisation settings',
      await staff.getByTestId('profile-settings-page').isVisible() && await staff.getByTestId('settings-page').count() === 0);
    check('client avatar opens permitted profile URL without home redirect', new URL(staff.url()).pathname === '/settings/profile');
    check('client profile photo action is reachable', await staff.getByTestId('button-change-profile-photo').isVisible());
    await snap(staff, 'client-profile.png');
    await staff.reload({ waitUntil: 'domcontentloaded' });
    await staff.getByTestId('profile-photo-card').waitFor({ state: 'visible', timeout: 20000 });
    check('client profile route survives reload', new URL(staff.url()).pathname === '/settings/profile');
    check('client profile does not request forbidden staff settings', !results.apiErrors.slice(beforeProfileErrors).some(error => error.status === 403));
  } catch (error) { check('same-tab account-switch and client profile scenario', false, error.message); await snap(staff, 'account-switch-failure.png').catch(() => {}); }

  check('no uncaught JavaScript errors on focused phone routes', results.pageErrors.length === 0, JSON.stringify(results.pageErrors));
} catch (error) {
  check('phone test setup and login', false, error.stack || error.message);
} finally {
  if (canaryId) {
    const cleanup = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const loginResponse = await cleanup.request.post(`${BASE}/api/auth/login`, { data: { username: STAFF, password: PASSWORD } });
      const loginBody = await loginResponse.json();
      const removed = await cleanup.request.delete(`${BASE}/api/chat/threads/${canaryId}`, { headers: { Authorization: `Bearer ${loginBody.token}` } });
      check('disposable private thread cleaned up', removed.status() === 200);
    } catch (error) { check('disposable private thread cleanup', false, error.message); }
    await cleanup.close();
  }
  for (const context of contexts) await context.close();
  await browser.close();
  if (propertyBrandFixture) {
    try { await propertyBrandFixture.cleanup(); check('disposable phone property/brand records cleaned up', true); }
    catch (error) { check('disposable phone property/brand cleanup', false, error.message); }
  }
  results.failures = failures;
  writeFileSync(`${DIR}results.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`RESULT ${results.checks.filter(c => c.passed).length}/${results.checks.length} checks passed; ${failures.length} failures`);
}
process.exitCode = failures.length ? 1 : 0;
