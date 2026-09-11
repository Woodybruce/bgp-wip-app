// Local fixture UX regression. No AI/messages or external integrations are invoked.
// Run: SMOKE_BASE=http://localhost:5106 node qa/ux-smoke.mjs
// Optional: SMOKE_CHROMIUM executable; UX_OUTPUT directory for JSON/screenshots;
// SMOKE_LOCAL_TLS=1 for a self-signed HTTPS proxy around the local fixture app.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '../node_modules/playwright/index.mjs';

const baseUrl = new URL(process.env.SMOKE_BASE || 'http://localhost:5000');
if (!['http:', 'https:'].includes(baseUrl.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname) || baseUrl.username || baseUrl.password) {
  throw new Error('UX smoke requires a local, disposable smoke-fixture app');
}
const BASE = baseUrl.origin;
const OUTPUT = resolve(process.env.UX_OUTPUT || fileURLToPath(new URL('./smoke-shots/ux/', import.meta.url)));
const source = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8');
function fixture(name) {
  const match = source.match(new RegExp(`const ${name} = '([^']+)'`));
  assert.ok(match, `Missing fixture constant ${name} in qa/smoke.mjs`);
  return match[1];
}
const PASSWORD = fixture('PASSWORD');
const STAFF = fixture('STAFF');
const CLIENT = fixture('CLIENT');
const BLUEWATER = fixture('BLUEWATER');
const runId = Date.now();
const results = { base: BASE, startedAt: new Date().toISOString(), checks: [], screenshots: [], pageErrors: [], apiErrors: [], blockedExternalHosts: [] };
mkdirSync(OUTPUT, { recursive: true });

function check(name, passed, detail = '') {
  results.checks.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!passed) {
    const error = new Error(name);
    error.recorded = true;
    throw error;
  }
}
async function snap(page, name) {
  const file = `${name}.png`;
  await page.screenshot({ path: join(OUTPUT, file), fullPage: false });
  results.screenshots.push(file);
}
async function scenario(name, page, run) {
  if (process.env.UX_SCENARIO && !name.startsWith(process.env.UX_SCENARIO)) return;
  try {
    await run();
    assert.equal(await page.getByTestId('error-boundary-fallback').count(), 0, 'App error boundary is visible');
    await snap(page, name);
  } catch (error) {
    if (!error.recorded) {
      results.checks.push({ name, passed: false, detail: error.message });
      console.log(`FAIL ${name}: ${error.message}`);
    }
    await snap(page, `${name}-failure`).catch(() => {});
  }
}
async function watch(context, label) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === BASE || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    if (!results.blockedExternalHosts.includes(url.hostname)) results.blockedExternalHosts.push(url.hostname);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => {
    results.pageErrors.push({ label, message: error.message });
    console.log(`PAGEERROR ${label}: ${error.message}`);
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === BASE && url.pathname.startsWith('/api/') && response.status() >= 400) {
      // Includes deliberately injected failures and fixture integrations without keys.
      // Scenario assertions, not this diagnostic list, determine whether recovery works.
      results.apiErrors.push({ label, path: url.pathname, status: response.status() });
    }
  });
  return page;
}
async function login(page, username) {
  await page.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('card-login').waitFor({ state: 'visible', timeout: 25000 });
  const toggle = page.getByTestId('button-show-guest-login');
  if (await toggle.isVisible()) await toggle.click();
  await page.getByTestId('input-guest-email').fill(username);
  await page.getByTestId('input-guest-password').fill(PASSWORD);
  await page.getByTestId('button-guest-login').click();
  await page.getByTestId('card-login').waitFor({ state: 'hidden', timeout: 25000 });
  if (page.viewportSize().width < 768) {
    await page.getByTestId('button-mobile-my-profile').waitFor({ state: 'visible', timeout: 25000 });
  }
  // Desktop Messages uses its own full-width shell, without the main sidebar.
  // Prove the submitted identity, then require the scenario's actual page.
  const me = await api(page, 'GET', '/api/auth/me');
  assert.equal(me.status, 200, 'Form sign-in did not establish an authenticated session');
  assert.equal((me.data?.email || me.data?.username)?.toLowerCase(), username.toLowerCase());
  if (baseUrl.protocol === 'https:') {
    const cookies = await page.context().cookies(BASE);
    check('HTTPS form login establishes a Secure HttpOnly session cookie', cookies.some(cookie => cookie.name === 'connect.sid' && cookie.secure && cookie.httpOnly));
  }
}
async function api(page, method, path, data) {
  return page.evaluate(async ({ method, path, data }) => {
    const token = localStorage.getItem('bgp_auth_token');
    const response = await fetch(path, {
      method, credentials: 'include',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, data: await response.json().catch(() => null) };
  }, { method, path, data });
}
const pathIs = path => url => url.origin === BASE && url.pathname === path;
async function report(page) {
  await page.goto(`${BASE}/deals/report`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('wip-report-page').waitFor({ state: 'visible', timeout: 25000 });
}
async function phoneGeometry(page, testId) {
  return page.evaluate(id => {
    const rect = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
    const nav = document.querySelector('[data-testid="mobile-bottom-nav"]')?.getBoundingClientRect();
    return { top: rect?.top, bottom: rect?.bottom, navTop: nav?.top, height: window.innerHeight };
  }, testId);
}
async function openDeal(page, id) {
  await page.goto(`${BASE}/deals/${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId(`deal-detail-${id}`).waitFor({ state: 'visible', timeout: 25000 });
  await page.getByTestId('button-edit-deal').click();
  const dialog = page.getByRole('dialog', { name: 'Edit Deal', exact: true });
  await dialog.waitFor({ state: 'visible' });
  return dialog;
}

let browser;
const contexts = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {}) });
  async function session(label, phone = false) {
    const context = await browser.newContext({ ...(phone ? devices['iPhone 13'] : { viewport: { width: 1600, height: 1000 } }), serviceWorkers: 'block', ignoreHTTPSErrors: process.env.SMOKE_LOCAL_TLS === '1' });
    contexts.push(context);
    return { context, page: await watch(context, label) };
  }

  const staffPhone = await session('staff-phone', true);
  await scenario('staff-phone-wip-layout', staffPhone.page, async () => {
    const page = staffPhone.page;
    await login(page, STAFF);
    await report(page);
    const geometry = await phoneGeometry(page, 'wip-phone-tile-wip');
    check('phone WIP tiles start in the viewport above fixed navigation', Number.isFinite(geometry.navTop) && geometry.top >= 0 && geometry.top < geometry.navTop && geometry.bottom <= geometry.navTop, JSON.stringify(geometry));
    check('phone WIP Add deal is available', await page.getByTestId('wip-new-deal-button').isVisible());
    check('phone WIP hides Columns', !await page.getByTestId('wip-columns-button').isVisible());
    await page.getByTestId('wip-phone-actions-button').click();
    for (const action of ['sync-xero', 'export-excel', 'print']) {
      check(`phone More contains ${action}`, await page.getByTestId(`wip-phone-${action}-button`).isVisible());
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'wip-phone-actions-button');
    check('Escape from More normally returns keyboard focus to its trigger', true);
    await snap(page, 'staff-phone-wip-initial');
    await page.getByTestId('wip-phone-actions-button').click();
    await page.keyboard.press('Escape');
    const filters = page.getByTestId('wip-phone-filters-button');
    check('phone filters start collapsed', await filters.getAttribute('aria-expanded') === 'false' && !await page.getByTestId('wip-filter-options').isVisible());
    await filters.click();
    // Open immediately after More closes: its exit animation must not later
    // steal this popover's focus and dismiss it before a selection is possible.
    await page.getByTestId('wip-filter-deal-status').click();
    const option = page.locator('[data-testid^="wip-filter-checkbox-deal-status-"]').first();
    await option.waitFor({ state: 'visible' });
    const selectedTestId = await option.getAttribute('data-testid');
    await option.click();
    await page.keyboard.press('Escape');
    await filters.click();
    check('closing phone filters retains the active count', await filters.getAttribute('aria-expanded') === 'false' && /1 active/i.test(await filters.innerText()));
    await filters.click();
    await page.getByTestId('wip-filter-deal-status').click();
    check('reopening phone filters retains the selected option', await page.getByTestId(selectedTestId).getAttribute('data-state') === 'checked');
    await page.keyboard.press('Escape');
    await page.getByTestId('wip-clear-all-filters').click();
    check('Reset clears the active phone filter count', !/\d+ active/i.test(await filters.innerText()) && await page.getByTestId('wip-clear-all-filters').count() === 0);
    await filters.click();
    check('phone monthly and stage charts remain populated', await page.locator('[data-testid^="wip-phone-month-"]').count() > 0 && await page.locator('[data-testid^="wip-phone-stage-"]').count() > 0);
    const view = page.getByTestId('wip-phone-view-deals');
    check('phone View deals has a nonempty fixture count', /View\s+[1-9]\d*\s+deal/.test(await view.innerText()));
    await view.click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'wip-detail-table');
    const card = await phoneGeometry(page, 'wip-card-0');
    check('View deals moves to the phone card list', card.top >= 0 && card.top < card.navTop, JSON.stringify(card));
    await snap(page, 'staff-phone-wip-deal-list');
    await page.getByTestId('wip-phone-back-summary').click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'wip-phone-summary');
    const summary = await phoneGeometry(page, 'wip-phone-tile-wip');
    check('Back to summary restores visible tiles', summary.top >= 0 && summary.bottom <= summary.navTop, JSON.stringify(summary));
  });
  await staffPhone.context.close();

  const errorSession = await session('staff-wip-errors', true);
  await scenario('staff-wip-error-recovery', errorSession.page, async () => {
    const page = errorSession.page;
    const matcher = pathIs('/api/wip');
    let failedGets = 0;
    const failWip = route => {
      if (route.request().method() !== 'GET') return route.continue();
      failedGets++;
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'UX fixture: WIP unavailable' }) });
    };
    await page.route(matcher, failWip);
    try {
      await login(page, STAFF);
      await page.goto(`${BASE}/deals/report`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('wip-load-error').waitFor({ state: 'visible', timeout: 25000 });
      check('failed initial WIP load shows an error instead of a zero report', failedGets > 0 && await page.getByTestId('wip-report-page').count() === 0 && await page.getByTestId('wip-phone-tile-wip').count() === 0);
      await snap(page, 'staff-wip-cold-error');
      await page.unroute(matcher, failWip);
      await page.getByTestId('wip-retry-button').click();
      await page.getByTestId('wip-phone-tile-wip').waitFor({ state: 'visible', timeout: 25000 });
      check('WIP Retry loads real fixture figures', await page.getByTestId('wip-load-error').count() === 0 && /View\s+[1-9]\d*\s+deal/.test(await page.getByTestId('wip-phone-view-deals').innerText()));
      const previousTile = await page.getByTestId('wip-phone-tile-wip').innerText();
      await page.route(matcher, failWip);
      await page.bringToFront();
      await page.getByTestId('wip-refresh-error').waitFor({ state: 'visible', timeout: 45000 });
      check('failed live WIP refresh labels and retains cached figures', await page.getByTestId('wip-phone-tile-wip').innerText() === previousTile && /last loaded figures/.test(await page.getByTestId('wip-refresh-error').innerText()));
      await snap(page, 'staff-wip-stale-error');
      await page.unroute(matcher, failWip);
      await page.getByTestId('wip-refresh-retry-button').click();
      await page.getByTestId('wip-refresh-error').waitFor({ state: 'hidden', timeout: 25000 });
      check('cached WIP Retry clears the stale warning', await page.getByTestId('wip-report-page').isVisible());
    } finally {
      await page.unroute(matcher, failWip);
    }
  });
  await errorSession.context.close();

  const clientSession = await session('client');
  let clientReady = false;
  await scenario('client-form-login', clientSession.page, async () => {
    await login(clientSession.page, CLIENT);
    const me = await api(clientSession.page, 'GET', '/api/auth/me');
    assert.equal(me.status, 200);
    check('real client form login establishes a scoped client session', me.data?.role === 'Client' || !!me.data?.companyScopeId);
    clientReady = true;
  });
  if (clientReady) {
    await scenario('client-property-inline-edit', clientSession.page, async () => {
      const page = clientSession.page;
      const path = `/api/crm/properties/${BLUEWATER}`;
      const before = await api(page, 'GET', path);
      assert.equal(before.status, 200, 'Client cannot read the Bluewater fixture');
      assert.equal(before.data?.id, BLUEWATER, 'Expected the exact Bluewater fixture');
      const originalWebsite = before.data.website ?? null;
      const draftWebsite = `https://example.invalid/ux-smoke-${runId}`;
      const matcher = pathIs(path);
      let puts = 0;
      let mayHaveWritten = false;
      const watchPut = request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === path) puts++; };
      const failPut = route => route.request().method() === 'PUT'
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'UX fixture save failed; retry the draft' }) })
        : route.continue();
      page.on('request', watchPut);
      try {
        await page.goto(`${BASE}/properties/${BLUEWATER}`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId(`property-detail-${BLUEWATER}`).waitFor({ state: 'visible', timeout: 25000 });
        for (const [field, trigger] of [['status', 'inline-label-display'], ['asset-class', 'inline-label-display'], ['team', 'inline-engagement-trigger']]) {
          check(`client property ${field} editor remains available`, await page.getByTestId(`property-field-${field}`).getByTestId(trigger).isVisible());
        }
        const area = page.getByTestId('property-field-area');
        const areaButton = area.getByRole('button', { name: 'Edit Area (sq ft)', exact: true });
        await areaButton.focus();
        await areaButton.press('Space');
        const number = area.getByTestId('inline-edit-number');
        await number.waitFor({ state: 'visible' });
        check('Area keyboard Space opens a labelled editor', await number.getAttribute('aria-label') === 'Area (sq ft)');
        await number.fill('120k');
        await number.press('Enter');
        await area.getByRole('alert').waitFor({ state: 'visible' });
        check('invalid 120k remains a draft with an error and no PUT', await number.inputValue() === '120k' && puts === 0);
        await snap(page, 'client-property-invalid-number');
        await number.press('Escape');
        await areaButton.waitFor({ state: 'visible' });
        check('Escape cancels the invalid draft without a PUT', puts === 0 && await area.getByRole('alert').count() === 0);
        const website = page.getByTestId('property-field-website');
        const websiteButton = website.getByRole('button', { name: 'Edit Website', exact: true });
        await websiteButton.focus();
        await websiteButton.press('Enter');
        const text = website.getByTestId('inline-edit-text');
        await text.waitFor({ state: 'visible' });
        check('Website keyboard Enter opens a labelled editor', await text.getAttribute('aria-label') === 'Website');
        await text.fill(draftWebsite);
        await page.route(matcher, failPut);
        await text.press('Enter');
        await website.getByRole('alert').waitFor({ state: 'visible' });
        check('failed website PUT retains the draft and offers Retry', puts === 1 && await text.inputValue() === draftWebsite && await website.getByTestId('inline-edit-retry').isVisible());
        await snap(page, 'client-property-save-error');
        await page.unroute(matcher, failPut);
        mayHaveWritten = true;
        await website.getByTestId('inline-edit-retry').click();
        await websiteButton.waitFor({ state: 'visible', timeout: 25000 });
        const saved = await api(page, 'GET', path);
        check('website Retry persists the retained draft', puts === 2 && saved.status === 200 && saved.data?.website === draftWebsite && await website.getByRole('alert').count() === 0);
      } finally {
        await page.unroute(matcher, failPut);
        page.off('request', watchPut);
        if (mayHaveWritten) {
          const restored = await api(page, 'PUT', path, { website: originalWebsite });
          const verified = await api(page, 'GET', path);
          check('Bluewater fixture website restored after the edit test', restored.status === 200 && verified.status === 200 && (verified.data?.website ?? null) === originalWebsite);
        }
      }
    });

    await scenario('client-deal-business-edit', clientSession.page, async () => {
      const page = clientSession.page;
      const allocationGets = [];
      const onRequest = request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'GET' && /\/fee-allocations(?:\/|$)/.test(path)) allocationGets.push(path);
      };
      page.on('request', onRequest);
      try {
        const response = await api(page, 'GET', '/api/crm/deals');
        assert.equal(response.status, 200);
        assert.ok(Array.isArray(response.data), 'Expected the scoped deals array');
        const supportsRentAndArea = deal => deal?.id && !['Purchase', 'Sale'].includes(deal.dealType);
        const deal = response.data.find(deal => deal.propertyId === BLUEWATER && supportsRentAndArea(deal)) || response.data.find(supportsRentAndArea);
        assert.ok(deal, 'Fixture needs a client-visible leasing/advisory deal for business-field assertions');
        const dialog = await openDeal(page, deal.id);
        for (const field of ['rent-pa', 'gf-area', 'ff-area', 'basement-area']) {
          const input = dialog.getByTestId(`input-deal-${field}`);
          check(`client deal ${field} stays editable`, await input.isVisible() && await input.isEditable());
        }
        for (const testId of ['input-deal-fee', 'select-deal-fee-agreement', 'card-fee-allocation', 'button-edit-fee-allocation']) {
          check(`client deal hides staff ${testId}`, await page.getByTestId(testId).count() === 0);
        }
        await snap(page, 'client-deal-edit-dialog');
        await dialog.getByTestId('button-cancel-deal').click();
        await page.goto(`${BASE}/deals/list`, { waitUntil: 'domcontentloaded' });
        // A fresh persisted list may render without a new GET until its next poll.
        await page.getByTestId('button-create-deal').waitFor({ state: 'visible', timeout: 25000 });
        await page.waitForTimeout(500);
        check('client deal detail, dialog and list make no allocation GETs', allocationGets.length === 0, JSON.stringify(allocationGets));
      } finally {
        page.off('request', onRequest);
      }
    });
  }
  await clientSession.context.close();

  const staffDesktop = await session('staff-desktop');
  let staffReady = false;
  await scenario('staff-desktop-wip', staffDesktop.page, async () => {
    await login(staffDesktop.page, STAFF);
    staffReady = true;
    await report(staffDesktop.page);
    check('desktop WIP retains Columns', await staffDesktop.page.getByTestId('wip-columns-button').isVisible());
  });
  if (staffReady) await scenario('staff-deal-live-draft', staffDesktop.page, async () => {
    const page = staffDesktop.page;
    const response = await api(page, 'GET', '/api/crm/deals');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.data));
    const deal = response.data.find(deal => deal.id && deal.name);
    assert.ok(deal, 'Fixture needs a staff-visible deal');
    const dialog = await openDeal(page, deal.id);
    const name = dialog.getByTestId('input-deal-name');
    const draft = `UX unsaved draft ${runId}`;
    const serverName = `UX colleague update ${runId}`;
    await name.fill(draft);
    const matcher = pathIs(`/api/crm/deals/${deal.id}`);
    let mockedGets = 0;
    const started = Date.now();
    const changedDeal = async route => {
      if (route.request().method() !== 'GET') return route.continue();
      try {
        const response = await route.fetch();
        if (response.status() !== 200) return route.fulfill({ response });
        const body = await response.json();
        mockedGets++;
        await route.fulfill({ response, json: { ...body, name: serverName } });
      } catch {
        await route.abort('failed').catch(() => {});
      }
    };
    await page.route(matcher, changedDeal);
    try {
      await page.bringToFront();
      const refetch = await page.waitForResponse(response => matcher(new URL(response.url())) && response.request().method() === 'GET' && mockedGets > 0, { timeout: 45000 });
      assert.equal((await refetch.json()).name, serverName, 'Browser did not receive the simulated colleague update');
      // Allow the query observer and dialog effect to consume the actual polling response.
      await page.waitForTimeout(500);
      check('real live deal refetch preserves the unsaved dialog draft', await name.inputValue() === draft, `Received ${mockedGets} mocked GET after ${Date.now() - started}ms`);
      check('updated deal visibly warns that the retained draft differs from the server', await dialog.getByTestId('deal-draft-update-notice').isVisible());
      await snap(page, 'staff-deal-draft-after-poll');
      await dialog.getByTestId('button-cancel-deal').click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByTestId('button-edit-deal').click();
      await dialog.waitFor({ state: 'visible' });
      check('cancel and reopen uses the latest server deal', await dialog.getByTestId('input-deal-name').inputValue() === serverName);
      check('reopening the latest deal clears the update notice', await dialog.getByTestId('deal-draft-update-notice').count() === 0);
      await dialog.getByTestId('button-cancel-deal').click();
    } finally {
      await page.unroute(matcher, changedDeal);
    }
  });
  await staffDesktop.context.close();
} catch (error) {
  results.checks.push({ name: 'suite setup or teardown', passed: false, detail: error.message });
  console.log(`FAIL suite setup or teardown: ${error.message}`);
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close().catch(() => {});
  results.finishedAt = new Date().toISOString();
  results.passed = results.checks.length > 0 && results.checks.every(check => check.passed) && results.pageErrors.length === 0;
  writeFileSync(join(OUTPUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`${results.passed ? 'PASS' : 'FAIL'} UX smoke: ${results.checks.filter(check => check.passed).length}/${results.checks.length} checks; ${results.pageErrors.length} page errors. Evidence: ${OUTPUT}`);
  if (!results.passed) process.exitCode = 1;
}
