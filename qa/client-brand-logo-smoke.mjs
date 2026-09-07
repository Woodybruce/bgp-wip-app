// Read-only browser checks against the isolated local fixture app. No database access.
// SMOKE_BASE=https://127.0.0.1:5446 SMOKE_LOCAL_TLS=1 SMOKE_CHROMIUM=/path/to/chrome node qa/client-brand-logo-smoke.mjs
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from '../node_modules/playwright/index.mjs';

const BASE = new URL(process.env.SMOKE_BASE || 'http://localhost:5000');
if (!['http:', 'https:'].includes(BASE.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(BASE.hostname) || BASE.username || BASE.password) throw new Error('Local fixture app required');
const OUTPUT = resolve(process.env.UX_OUTPUT || '../audit-evidence/portfolio-logo-20260907');
mkdirSync(OUTPUT, { recursive: true });
const smoke = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8');
const fixture = name => smoke.match(new RegExp(`const ${name} = '([^']+)'`))[1];
const results = { checks: [], screenshots: [], measurements: [], pageErrors: [] };
let browser;
function check(name, pass) { assert.ok(pass, name); results.checks.push(name); console.log(`PASS ${name}`); }
async function login(page) {
  page.on('pageerror', e => results.pageErrors.push(e.message));
  await page.goto(`${BASE.origin}/messages`);
  await page.getByTestId('card-login').waitFor({ state: 'visible', timeout: 25000 });
  if (await page.getByTestId('button-show-guest-login').isVisible()) await page.getByTestId('button-show-guest-login').click();
  await page.getByTestId('input-guest-email').fill(fixture('CLIENT'));
  await page.getByTestId('input-guest-password').fill(fixture('PASSWORD'));
  await page.getByTestId('button-guest-login').click();
  await page.getByTestId('card-login').waitFor({ state: 'hidden', timeout: 25000 });
  await page.goto(BASE.origin);
  await page.getByTestId('sidebar-client-logo').waitFor({ state: 'visible', timeout: 25000 });
  const authenticated = await page.evaluate(async () => {
    const token = localStorage.getItem('bgp_auth_token');
    const response = await fetch('/api/auth/me', { credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const user = await response.json();
    return { status: response.status, email: user.email };
  });
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.email.toLowerCase(), fixture('CLIENT').toLowerCase());
}
async function inspect(page, name) {
  const logo = page.getByTestId('sidebar-client-logo');
  const state = await logo.evaluate(async el => {
    const css = getComputedStyle(el);
    const mask = css.maskImage || css.webkitMaskImage;
    const url = mask.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
    const image = new Image();
    image.src = url || '';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0, opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] === 0) transparent++; if (pixels[i] === 255) opaque++; }
    let parent = el.parentElement;
    while (parent && ['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(parent).backgroundColor)) parent = parent.parentElement;
    const background = parent ? getComputedStyle(parent).backgroundColor : '';
    const luminance = color => {
      const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    };
    const fg = luminance(css.backgroundColor), bg = luminance(background);
    const box = el.getBoundingClientRect();
    return { tag: el.tagName, label: el.getAttribute('aria-label'), maskMode: css.maskMode, bundledMask: url?.startsWith('data:image/png') || url?.includes('landsec-logo'), width: box.width, height: box.height, foreground: css.backgroundColor, background, contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05), transparent, opaque, total: pixels.length / 4 };
  });
  results.measurements.push({ name, ...state });
  check(`${name}: labelled Landsec mask renders at 44×44`, state.tag === 'SPAN' && state.label === 'Landsec' && state.width === 44 && state.height === 44);
  check(`${name}: loaded bundled alpha has transparent space and a visible mark`, state.bundledMask && state.maskMode === 'alpha' && state.transparent > state.total / 2 && state.opaque > 100);
  check(`${name}: logo contrast exceeds 4.5:1`, state.contrast >= 4.5);
  for (const [file, target] of [[`${name}.png`, page], [`${name}-mark.png`, logo]]) {
    await target.screenshot({ path: join(OUTPUT, file) });
    results.screenshots.push(file);
  }
  return state;
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {}) });
  for (const scenario of [
    { name: 'actual-landsec' },
    { name: 'opaque-dark', primaryColor: '#111111', logo: 'opaque' },
    { name: 'broken-light', primaryColor: '#FAF9F7', logo: 'broken' },
    { name: 'delayed-dark', primaryColor: '#111111', logo: 'opaque', delayed: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', ignoreHTTPSErrors: process.env.SMOKE_LOCAL_TLS === '1' });
    await context.route('**/*', route => new URL(route.request().url()).origin === BASE.origin ? route.continue() : route.abort());
    let releaseTheme, themeRequests = 0, remoteLogoRequests = 0;
    const themeGate = new Promise(resolve => { releaseTheme = resolve; });
    if (scenario.primaryColor) {
      await context.route('**/api/client/brand-theme', async route => {
        themeRequests++;
        if (scenario.delayed) await themeGate;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ scoped: true, name: 'Landsec', primaryColor: scenario.primaryColor, secondaryColor: '#00A3E0', logoUrl: `${BASE.origin}/qa-${scenario.logo}-logo.svg` }) });
      });
      await context.route('**/qa-*-logo.svg', route => {
        remoteLogoRequests++;
        return route.fulfill(scenario.logo === 'broken' ? { status: 404, body: 'Synthetic missing logo' } : { status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><rect width="90" height="90" fill="white"/><path d="M20 20H40V60H70V75H20Z" fill="black"/></svg>' });
      });
    }
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await login(page);
    if (scenario.delayed) {
      await inspect(page, 'delayed-before-theme');
      // Arrive later than the former 2.5-second sidebar sampling window.
      await page.waitForTimeout(3100);
      releaseTheme();
    }
    if (scenario.primaryColor) {
      // Exercise the actual theme chooser rather than assuming a fetched
      // brand colour overrides the user's palette during session restore.
      const palette = scenario.primaryColor === '#111111' ? 'bgp' : 'claude';
      await page.getByRole('button', { name: 'Claude', exact: true }).click();
      await page.getByTestId(`button-scheme-${palette}`).click();
      await page.waitForFunction(palette => document.documentElement.classList.contains(`scheme-${palette}`), palette);
      check(`${scenario.name}: mocked brand response was served`, themeRequests > 0);
    }
    const state = await inspect(page, scenario.name);
    if (scenario.primaryColor) {
      const channel = Number(state.background.match(/[\d.]+/)[0]);
      check(`${scenario.name}: requested light or dark sidebar is actually rendered`, scenario.primaryColor === '#111111' ? channel < 60 : channel > 180);
    }
    if (scenario.primaryColor) check(`${scenario.name}: untrusted fetched logo is not requested`, remoteLogoRequests === 0);
    await context.close();
  }
  check('no uncaught browser errors', results.pageErrors.length === 0);
} catch (error) {
  results.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  results.passed = !results.failure && results.pageErrors.length === 0;
  writeFileSync(join(OUTPUT, 'logo-results.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`${results.passed ? 'PASS' : 'FAIL'} ${results.checks.length} logo browser checks; no database mutations`);
}
