// Phone session/navigation smoke: run against the same local fixture app as qa/smoke.mjs.
// Uses SMOKE_BASE and optional SMOKE_CHROMIUM; creates and cleans one self-only test thread.
import { chromium, devices } from '../node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname)) throw new Error('Phone smoke requires a local fixture app');
const DIR = fileURLToPath(new URL('./smoke-shots/phone/', import.meta.url));
const smoke = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8');
const fixture = (name) => smoke.match(new RegExp(`const ${name} = '([^']+)'`))[1];
const PASSWORD = fixture('PASSWORD');
const STAFF = fixture('STAFF');
const CLIENT = fixture('CLIENT');
const CANARY = `PHONE-QA-PRIVATE-${Date.now()}`;
const results = { base: BASE, viewport: 'iPhone 13', checks: [], pageErrors: [], apiErrors: [], blockedExternalHosts: [], screenshots: [], canary: CANARY };
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
const browser = await chromium.launch({ headless: true, ...(process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {}) });
let canaryId;
const contexts = [];
try {
  const staffContext = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  contexts.push(staffContext);
  const staff = await watch(staffContext, 'staff-phone');
  await staff.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
  await login(staff, STAFF);
  await staff.getByTestId('button-mobile-my-profile').waitFor({ state: 'visible', timeout: 20000 });
  check('staff mobile login', await staff.getByTestId('button-mobile-my-profile').isVisible());

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
  results.failures = failures;
  writeFileSync(`${DIR}results.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`RESULT ${results.checks.filter(c => c.passed).length}/${results.checks.length} checks passed; ${failures.length} failures`);
}
process.exitCode = failures.length ? 1 : 0;
