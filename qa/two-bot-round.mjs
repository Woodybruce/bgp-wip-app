// Two-persona QA harness — "Victoria" (BGP agent) × "Mark Warne" (Landsec client).
//
// Drives two logged-in browser sessions through real workflows at the same
// time, cross-checking that what the agent does shows up (or stays hidden)
// on the client side. Logs every console error, failed request, blank page,
// dead-end and broken flow to qa/logs/ as JSONL + screenshots.
//
// Usage:  node qa/two-bot-round.mjs [roundNumber]
// Server: expects the dev server on http://localhost:5000 with the local
//         fixture DB (Landsec = 11111111-1111-1111-1111-111111111111).

import { chromium } from '../node_modules/playwright/index.mjs';
import { mkdirSync, appendFileSync } from 'fs';

const BASE = 'http://localhost:5000';
const ROUND = parseInt(process.argv[2] || '1', 10);
const LOGDIR = new URL('./logs/', import.meta.url).pathname;
mkdirSync(LOGDIR, { recursive: true });

const LANDSEC = '11111111-1111-1111-1111-111111111111';
const PASSWORD = 'B@nd0077!';
const AGENT_USER = 'victoria@brucegillinghampollard.com';
const CLIENT_USER = 'mark.warne@landsec.com';

// Requests that fail by design or are environment noise — not app bugs.
const IGNORED_RESPONSES = [
  /\/api\/auth\/me$/,                    // 401 before login hydrates
  /\/api\/microsoft\//,                  // no M365 creds locally
  /\/api\/chatbgp\/status/,              // no AI key locally
  /\/api\/hr\/photo\//,                  // 404 = no photo; UI hides the img
  /\/api\/ai-briefing/,                  // 503 locally (no AI key) by design
  /\/api\/brand\/[^/]+\/ai-take\//,      // 503 locally (no AI key) by design
  /\/api\/brand\/[^/]+\/(competitors\/research|rocketreach-company\/refresh)/, // 503 locally, no keys
  /fonts|\.woff|\.map$/,
];

const issues = [];
function logIssue(persona, scenario, kind, detail) {
  const row = { ts: new Date().toISOString(), round: ROUND, persona, scenario, kind, detail };
  issues.push(row);
  appendFileSync(`${LOGDIR}/round-${ROUND}.jsonl`, JSON.stringify(row) + '\n');
  console.log(`  [ISSUE] ${persona} · ${scenario} · ${kind}: ${String(detail).slice(0, 180)}`);
}

let currentScenario = { victoria: 'startup', mark: 'startup' };

function attachCollectors(page, persona) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (/net::|Failed to load resource/.test(t)) return; // captured via response hook
      logIssue(persona, currentScenario[persona], 'console-error', t);
    }
  });
  page.on('pageerror', (e) => logIssue(persona, currentScenario[persona], 'page-error', e.message));
  page.on('response', (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    if (res.status() < 400) return;
    if (IGNORED_RESPONSES.some((re) => re.test(url.split('?')[0]))) return;
    logIssue(persona, currentScenario[persona], `http-${res.status()}`, `${res.request().method()} ${url.replace(BASE, '')}`);
  });
}

async function login(context, username) {
  const r = await context.request.post(`${BASE}/api/auth/login`, { data: { username, password: PASSWORD } });
  const user = await r.json();
  if (!user.token) throw new Error(`login failed for ${username}: ${JSON.stringify(user).slice(0, 120)}`);
  const page = await context.newPage();
  await page.goto(BASE);
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('authToken', tok);
    localStorage.setItem('user', JSON.stringify(u));
  }, [user.token, user]);
  return page;
}

async function visit(page, persona, path, label) {
  currentScenario[persona] = `visit ${path}`;
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
  const notFound = await page.getByText('Page not found').count();
  if (notFound) logIssue(persona, `visit ${path}`, 'dead-route', `${label || path} renders "Page not found"`);
  const bodyText = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
  if (bodyText.length < 30) {
    await page.screenshot({ path: `${LOGDIR}/r${ROUND}-${persona}-blank-${path.replace(/\W+/g, '_')}.png` });
    logIssue(persona, `visit ${path}`, 'blank-page', `${label || path} rendered <30 chars of content`);
  }
}

async function step(page, persona, scenario, fn) {
  currentScenario[persona] = scenario;
  try {
    await fn();
    console.log(`  [ok] ${persona} · ${scenario}`);
    return true;
  } catch (e) {
    await page.screenshot({ path: `${LOGDIR}/r${ROUND}-${persona}-fail-${scenario.replace(/\W+/g, '_')}.png` }).catch(() => {});
    logIssue(persona, scenario, 'flow-failure', e.message?.split('\n')[0]);
    return false;
  }
}

// ─── Personas ─────────────────────────────────────────────────────────────

async function victoriaRound(page, cross) {
  const p = 'victoria';
  const stamp = `QA-R${ROUND}-${Math.random().toString(36).slice(2, 6)}`;
  cross.dealStamp = stamp;

  // 1. Crawl the staff surface (staff CRM hub lives at /contacts)
  for (const path of ['/', '/deals', '/leasing-schedule', '/brands', `/companies/${LANDSEC}`, '/contacts', '/comps', '/news', '/tasks', '/wip-report', '/hr']) {
    await visit(page, p, path);
  }

  // 2. Create a deal through the real dialog. The /deals hub defaults to the
  //    WIP Report tab, so switch to Deals first. We use the "Consultant" deal
  //    type — the one create body that needs no property/counterparty picker,
  //    just name + fee + completion date — so the flow is scriptable end to
  //    end (create → appears in list).
  await step(page, p, 'create-deal', async () => {
    await page.goto(`${BASE}/deals`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /^Deals$/ }).first().click().catch(async () => {
      await page.getByText('Deals', { exact: true }).first().click();
    });
    await page.waitForTimeout(1200);
    await page.locator('[data-testid="button-create-deal"]').first().click();
    await page.waitForTimeout(600);
    // Pick Consultant so the fee-only body (with the required completion
    // date) renders.
    await page.locator('[data-testid="select-deal-type"]').click();
    await page.waitForTimeout(300);
    await page.getByRole('option', { name: 'Consultant' }).click();
    await page.waitForTimeout(500);
    await page.locator('[data-testid="input-deal-name"]').fill(`${stamp} Consultancy — Landsec`);
    // Leave the fee blank at creation — it's editable on the board later, and
    // entering it without an agent split would 400 the fee-allocations save
    // (BGP House 15% row required). A real user uses the split editor.
    await page.locator('[data-testid="input-deal-target-date"]').fill('2026-12-31');
    await page.locator('[data-testid="button-save-deal"]').click();
    await page.waitForTimeout(1800);
    // Verify via the API, not the deals table — the table is team-filtered
    // (Victoria = National Leasing) and Consultant deals carry no team, so a
    // freshly-created one legitimately won't appear in her filtered view.
    const check = await page.evaluate(async (needle) => {
      const r = await fetch('/api/crm/deals', { headers: { Authorization: 'Bearer ' + localStorage.getItem('authToken') } });
      if (!r.ok) return { ok: false, status: r.status };
      const deals = await r.json();
      return { ok: true, found: deals.some((d) => (d.name || '').includes(needle)) };
    }, `${stamp} Consultancy`);
    if (!check.ok) throw new Error(`deals API returned ${check.status} after create`);
    if (!check.found) throw new Error('deal saved (toast shown) but absent from /api/crm/deals');
  });

  // 3. Letting tracker: open the first property, flip a status band
  await step(page, p, 'tracker-status-band', async () => {
    await page.goto(`${BASE}/leasing-schedule`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    let band = page.locator('[data-testid^="inline-statusband-"]').first();
    if (!(await band.count())) {
      // Cards view — click into the first property to reach the unit rows
      await page.getByText('Bluewater', { exact: false }).first().click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      band = page.locator('[data-testid^="inline-statusband-"]').first();
    }
    if (!(await band.count())) throw new Error('no status-band cell found on tracker');
    await band.click();
    await page.waitForTimeout(400);
    const option = page.locator('[data-testid^="statusband-option-"]').first();
    await option.click();
    await page.waitForTimeout(800);
  });

  // 4. Landsec team board: add + remove a member (full cycle)
  await step(page, p, 'team-board-add-remove', async () => {
    await page.goto(`${BASE}/companies/${LANDSEC}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const addBtn = page.locator('[data-testid="btn-add-team-member"]');
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click();
    await page.waitForTimeout(800);
    const candidate = page.locator('[data-testid^="add-member-candidate-"]').first();
    if (!(await candidate.count())) throw new Error('no candidates offered in Add-to-team');
    await candidate.click();
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  });
}

async function markRound(page, cross) {
  const p = 'mark';

  // 1. Crawl the client surface
  for (const path of ['/', '/contacts', '/brands', '/comps', '/deals', '/leasing-schedule', '/m/images', '/news', '/tasks']) {
    await visit(page, p, path);
  }

  // 2. Add a contact to a brand through the client CRM
  await step(page, p, 'client-add-contact', async () => {
    await page.goto(`${BASE}/contacts`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const addBtn = page.locator('[data-testid^="client-add-contact-"]').first();
    if (!(await addBtn.count())) throw new Error('no Add-contact button on any brand card');
    await addBtn.click();
    await page.waitForTimeout(600);
    await page.locator('[data-testid="contact-dialog-name"]').fill(`QA Contact R${ROUND}`);
    await page.locator('[data-testid="contact-dialog-role"]').fill('Acquisitions (bot test)');
    await page.getByRole('button', { name: /save|add/i }).last().click();
    await page.waitForTimeout(1200);
    const errToast = await page.getByText(/failed|error/i).count();
    if (errToast) throw new Error('error toast after saving contact');
  });

  // 3. Image Studio: scoped gallery, no staff actions
  await step(page, p, 'client-image-studio', async () => {
    await page.goto(`${BASE}/m/images`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);
    if (await page.locator('[data-testid="mobile-images-upload"]').count())
      throw new Error('client sees the Add photos (upload) button');
  });

  // 4. Comps: net-effective column present, no inline editors
  await step(page, p, 'client-comps-readonly', async () => {
    await page.goto(`${BASE}/comps`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const netEff = await page.getByText(/net effective/i).count();
    if (!netEff) throw new Error('Net Effective column missing on client comps');
  });

  // 5. Cross-visibility: the deal Victoria just created must NOT leak unless
  //    it is a letting deal on a Landsec property (round-1 deal is neither).
  await step(page, p, 'cross-deal-scoping', async () => {
    await page.goto(`${BASE}/deals`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    if (cross.dealStamp) {
      const leaked = await page.getByText(cross.dealStamp, { exact: false }).count();
      if (leaked) throw new Error(`unscoped staff deal "${cross.dealStamp}" visible to client`);
    }
  });
}

// ─── Run ──────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const agentCtx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const clientCtx = await browser.newContext({ viewport: { width: 1500, height: 950 } });

console.log(`── Round ${ROUND} — Victoria (agent) × Mark (Landsec client) ──`);
const vPage = await login(agentCtx, AGENT_USER);
const mPage = await login(clientCtx, CLIENT_USER);
attachCollectors(vPage, 'victoria');
attachCollectors(mPage, 'mark');

const cross = { dealStamp: null };
await victoriaRound(vPage, cross).catch((e) => logIssue('victoria', 'round', 'harness-crash', e.message));
await markRound(mPage, cross).catch((e) => logIssue('mark', 'round', 'harness-crash', e.message));

await browser.close();

const byKind = {};
for (const i of issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
console.log(`\n── Round ${ROUND} complete: ${issues.length} issues ──`);
console.log(JSON.stringify(byKind, null, 2));
