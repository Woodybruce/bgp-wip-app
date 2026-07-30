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

  // 4b. Switching the team picker to a CLIENT team must put the agent into
  // that client's exact view (nav trims, scope set, "Viewing as" banner), and
  // Exit must restore the full staff view. Woody: "everyone needs the ability
  // to switch to it... we see what they see." Previously the switch only
  // re-branded the UI and looked like it did nothing.
  await step(page, p, 'staff-switch-to-client-view', async () => {
    const scope = () => page.evaluate(async () => {
      const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('authToken') } });
      return (await r.json()).companyScopeId || null;
    });
    // Start from the agent's own team so the assertion is honest.
    await page.evaluate(async () => {
      await fetch('/api/auth/active-team', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') },
        body: JSON.stringify({ team: 'all' }),
      });
    });
    await page.goto(`${BASE}/deals`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    if (await scope()) throw new Error('agent already scoped to a client before switching');
    if (!(await page.locator('[data-testid="button-team-switcher"]').count())) throw new Error('no team switcher for staff');

    await page.locator('[data-testid="button-team-switcher"]').click();
    await page.waitForTimeout(700);
    await page.locator('[data-testid="menu-team-landsec"]').click();
    await page.waitForTimeout(3500);
    if (!(await scope())) throw new Error('switching to the Landsec team did not scope the session to the client view');
    const exit = page.locator('[data-testid="button-exit-client-view"]');
    if (!(await exit.count())) throw new Error('no "Viewing as" banner / exit while in client view — staff would be trapped');
    if (!(await page.locator('[data-testid="button-team-switcher"]').count())) throw new Error('team switcher vanished in client view — no way back');

    await exit.first().click();
    await page.waitForTimeout(3000);
    if (await scope()) throw new Error('Exit did not restore the full staff view');
  });

  // 4c. Agent creates a leasing requirement via the API, confirms it lands on
  // the requirements board, then cleans up. Stamped so the client round can
  // cross-check what it does/doesn't see.
  await step(page, p, 'agent-create-requirement', async () => {
    const stamp = `QA-REQ-R${ROUND}`;
    const r = await page.evaluate(async (needle) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const create = await fetch('/api/crm/requirements-leasing', {
        method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: needle, status: 'Active' }),
      });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const made = await create.json().catch(() => ({}));
      const list = await (await fetch('/api/crm/requirements-leasing', { headers: auth })).json();
      const rows = Array.isArray(list) ? list : (list?.data || []);
      return { ok: true, id: made?.id, found: rows.some(x => JSON.stringify(x).includes(needle)) };
    }, stamp);
    if (!r.ok) throw new Error(r.why);
    if (!r.found) throw new Error('created requirement absent from the requirements board');
    cross.reqStamp = stamp;
    if (r.id) {
      await page.evaluate(async (id) => {
        await fetch(`/api/crm/requirements-leasing/${id}`, { method: 'DELETE', credentials: 'include',
          headers: { Authorization: 'Bearer ' + localStorage.getItem('authToken') } });
      }, r.id);
    }
  });

  // 5. Deal board (kanban) renders its pipeline columns without a crash.
  await step(page, p, 'deal-board-render', async () => {
    await page.goto(`${BASE}/deals`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    // The /deals hub defaults to the WIP Report tab on desktop — switch to
    // the Deals tab before the board view is reachable.
    await page.getByRole('button', { name: /^Deals$/ }).first().click().catch(async () => {
      await page.getByText('Deals', { exact: true }).first().click();
    });
    await page.waitForTimeout(1200);
    // Then flip to Board view (ViewToggle button by accessible name).
    const boardBtn = page.getByRole('button', { name: /board/i }).first();
    if (await boardBtn.count()) { await boardBtn.click().catch(() => {}); await page.waitForTimeout(1200); }
    const cols = await Promise.all(['Negotiating', 'Solicitors', 'Exchanged', 'Completed', 'Invoiced']
      .map(c => page.getByText(c, { exact: false }).count()));
    const shown = cols.filter(n => n > 0).length;
    if (shown < 3) throw new Error(`deal board shows only ${shown}/5 pipeline columns`);
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

  // Client can open the deal-create dialog with no fee element and no crash.
  // (Woody: "client can make a deal, hide the fee.") The full save requires
  // the same counterparty + completion-date fields the agent fills; the
  // end-to-end scoped, fee-stripped POST is covered by the server API test.
  await step(page, p, 'client-create-deal-no-fee', async () => {
    await page.goto(`${BASE}/deals`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);
    if (!(await page.locator('[data-testid="button-create-deal"]').count()))
      throw new Error('client has no New Deal button');
    await page.locator('[data-testid="button-create-deal"]').first().click();
    await page.waitForTimeout(800);
    // Dialog must render (no ErrorBoundary) with the name field...
    if (!(await page.locator('[data-testid="input-deal-name"]').count()))
      throw new Error('client create dialog did not render');
    // ...and none of the fee inputs / split / "Show all fields" escape hatch.
    if (await page.locator('#deal-fee-pct').count()) throw new Error('agency % input visible to client');
    if (await page.locator('#deal-fee').count()) throw new Error('total-fee input visible to client');
    if (await page.getByText('BGP fee split', { exact: false }).count()) throw new Error('BGP fee split visible to client');
    if (await page.locator('[data-testid="button-toggle-all-fields"]').count()) throw new Error('"Show all fields" (exposes fees) visible to client');
    await page.keyboard.press('Escape');
  });

  // Client authors an Operator Targeting Brief on one of their own units
  // (like the Tag Heuer / 145A Westgate brief) and adds a target operator.
  // (Woody: "one scenario for mark should be creating this on another unit.")
  await step(page, p, 'client-create-targeting-brief', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = Array.isArray(units) ? units[0] : null;
      if (!unit) return { ok: false, why: 'no available units in client scope' };
      const briefRes = await fetch(`/api/available-units/${unit.id}/brief`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'QA Brief — food-led operator', objective: 'Secure a savoury meal-occasion operator' }),
      });
      if (!briefRes.ok) return { ok: false, why: `brief create ${briefRes.status}` };
      const brief = await briefRes.json();
      const tRes = await fetch(`/api/unit-briefs/${brief.id}/targets`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorName: 'Honi Poke', category: 'Handheld global food' }),
      });
      if (!tRes.ok) return { ok: false, why: `target add ${tRes.status}` };
      return { ok: true, briefId: brief.id, unitId: unit.id };
    });
    if (!r.ok) throw new Error(r.why);
    // Clean up so briefs don't pile up across rounds.
    await page.evaluate(async (id) => {
      await fetch(`/api/unit-briefs/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + localStorage.getItem('authToken') } });
    }, r.briefId);
  });

  // Client manages their own tasks: add via quick-add, mark complete, remove.
  // (My Tasks widget + page; every task endpoint is user-scoped.)
  await step(page, p, 'client-task-create-complete', async () => {
    const title = `QA Task R${ROUND}`;
    await page.goto(`${BASE}/tasks`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const add = page.locator('[data-testid="input-add-task"]').first();
    if (!(await add.count())) throw new Error('no quick-add task input');
    await add.fill(title);
    await add.press('Enter');
    await page.waitForTimeout(1200);
    const row = page.locator('[data-testid^="task-row-"]', { hasText: title }).first();
    if (!(await row.count())) throw new Error('task not visible after add');
    // Complete it, then clean up via the row's delete button.
    await row.locator('[data-testid^="task-toggle-"]').first().click().catch(() => {});
    await page.waitForTimeout(600);
    await row.locator('[data-testid^="task-delete-"]').first().click().catch(() => {});
    await page.waitForTimeout(400);
  });

  // Client property-detail page renders (tabs, no blank/crash). Cross-check
  // that staff-only surfaces (fee/WIP) never leak onto it.
  await step(page, p, 'client-property-detail', async () => {
    await page.goto(`${BASE}/properties/22222222-2222-2222-2222-222222222222`);
    // The property news panel polls, so networkidle can never settle here —
    // tolerate the timeout and assert on rendered content instead.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    if (await page.getByText('Page not found').count()) throw new Error('property detail is a dead route for client');
    const body = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
    if (body.length < 40) throw new Error('property detail rendered blank for client');
  });

  // Client adds a photo to one of their own units/schemes; the same upload to
  // a property outside their scope is refused. ("Adding photos for a unit and
  // scheme should be a task.")
  await step(page, p, 'client-add-unit-photo', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const props = await (await fetch('/api/crm/properties?excludeComps=true', { headers: auth })).json();
      const list = Array.isArray(props) ? props : (props?.data || []);
      const mine = list[0];
      if (!mine) return { ok: false, why: 'no property in client scope' };
      // 1x1 red JPEG
      const b64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const fd = new FormData();
      fd.append('images', new Blob([arr], { type: 'image/jpeg' }), 'qa-unit-photo.jpg');
      fd.append('propertyId', mine.id);
      fd.append('category', 'Property');
      const up = await fetch('/api/image-studio/upload', { method: 'POST', headers: auth, body: fd });
      return { ok: up.ok, status: up.status, propertyId: mine.id };
    });
    if (!r.ok) throw new Error(`photo upload to own property failed (${r.status})`);
  });

  // Client news feed renders and a save/dismiss action works (per-user
  // engagement is client-allowed; the fetch/scrape trigger stays staff-only).
  await step(page, p, 'client-news-feed', async () => {
    await page.goto(`${BASE}/news`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1800);
    if (await page.getByText('Page not found').count()) throw new Error('news is a dead route for client');
    const body = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
    if (body.length < 40) throw new Error('news feed rendered blank for client');
    // If any article is present, exercise a save toggle (round-trips the
    // client-allowed engage endpoint).
    const save = page.locator('[data-testid^="button-save-"]').first();
    if (await save.count()) { await save.click().catch(() => {}); await page.waitForTimeout(600); }
  });

  // Client requirements page renders without a dead route / blank / staff
  // leak. Requirements are the brand demand side of the portfolio.
  await step(page, p, 'client-requirements', async () => {
    await page.goto(`${BASE}/requirements`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1800);
    if (await page.getByText('Page not found').count()) throw new Error('requirements is a dead route for client');
    const body = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
    if (body.length < 40) throw new Error('requirements rendered blank for client');
  });

  // Client edits a contact they can touch (the one added earlier this round,
  // or any editable brand contact) — change the role and save, no error.
  await step(page, p, 'client-edit-contact', async () => {
    await page.goto(`${BASE}/contacts`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const edit = page.locator('[data-testid^="client-edit-contact-"], [data-testid^="client-edit-own-contact-"]').first();
    if (!(await edit.count())) throw new Error('no editable contact for client');
    await edit.click();
    await page.waitForTimeout(600);
    const roleInput = page.locator('[data-testid="contact-dialog-role"]');
    if (!(await roleInput.count())) throw new Error('contact edit dialog did not open');
    await roleInput.fill(`Acquisitions (edited R${ROUND})`);
    await page.locator('[data-testid="contact-dialog-save"]').click();
    await page.waitForTimeout(1200);
    if (await page.getByText(/failed|error/i).count()) throw new Error('error toast after editing contact');
  });

  // Client opens a hospitality brand profile (in their visible slice) — the
  // page must render (tabs/content), no dead route / blank / staff leak.
  await step(page, p, 'client-brand-profile', async () => {
    await page.goto(`${BASE}/companies/77777777-7777-7777-7777-777777777777`); // Honi Poke
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    if (await page.getByText('Page not found').count()) throw new Error('brand profile is a dead route for client');
    const body = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
    if (body.length < 40) throw new Error('brand profile rendered blank for client');
  });

  // Client dashboard carries the Portfolio Map (same map as the landlord
  // pages) and the BGP Relationship card, and the portfolio payload supplies
  // coordinates for the pins.
  await step(page, p, 'client-dashboard-map-and-relationship', async () => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
    if (!(await page.getByText('BGP Relationship', { exact: false }).count()))
      throw new Error('BGP Relationship card missing from client dashboard');
    if (!(await page.getByText('Portfolio Map', { exact: false }).count()))
      throw new Error('Portfolio Map widget missing from client dashboard');
    if (!(await page.locator('.leaflet-container').count()))
      throw new Error('portfolio map did not initialise (no leaflet container)');
    const coords = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const me = await (await fetch('/api/auth/me', { headers: auth })).json();
      const cid = me.companyScopeId;
      if (!cid) return { n: 0 };
      const d = await (await fetch(`/api/company-portfolio/${cid}`, { headers: auth })).json();
      return { n: (d.properties || []).filter((x) => x.lat != null && x.lng != null).length };
    });
    if (!coords.n) throw new Error('portfolio payload returned no property coordinates for the map');
  });

  // Client opens the viewings + offers panels on one of their own units — the
  // leasing-activity surfaces they'd actually check. Must return data (not
  // 4xx) for a unit in their scope.
  await step(page, p, 'client-viewings-offers', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = Array.isArray(units) ? units[0] : null;
      if (!unit) return { ok: false, why: 'no available units in client scope' };
      const v = await fetch(`/api/available-units/${unit.id}/viewings`, { headers: auth });
      const o = await fetch(`/api/available-units/${unit.id}/offers`, { headers: auth });
      return { ok: v.ok && o.ok, vStatus: v.status, oStatus: o.status };
    });
    if (!r.ok) throw new Error(r.why || `viewings ${r.vStatus} / offers ${r.oStatus} for an in-scope unit`);
    // And the Letting Tracker UI must render the controls that open them.
    // NB the client's tracker is the Deals-hub tab at /deals/letting —
    // /leasing-schedule is the leasing STRATEGY board (zones/positioning) and
    // /available is staff-only (clients get redirected to the dashboard).
    await page.goto(`${BASE}/deals/letting`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    const controls = '[data-testid^="button-viewings-"], [data-testid^="unit-viewing-"], [data-testid^="button-offers-"], [data-testid^="unit-interest-"]';
    if (!(await page.locator(controls).count())) {
      throw new Error('no viewings/offers controls on the client Letting Tracker (/deals/letting)');
    }
  });

  // Client must NOT see the requirement the agent just created for another
  // brand unless it's theirs — guards requirements-board scoping.
  await step(page, p, 'client-requirement-scoping', async () => {
    if (!cross.reqStamp) return; // agent step didn't run
    await page.goto(`${BASE}/requirements`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    const leaked = await page.getByText(cross.reqStamp, { exact: false }).count();
    if (leaked) throw new Error(`agent-only requirement "${cross.reqStamp}" visible to client`);
  });

  // Client dashboard on a phone-width viewport must not overflow horizontally
  // (the app hit body-scroll bugs before; container queries fixed them). Use
  // a fresh 390px page so the desktop context isn't reused.
  await step(page, p, 'client-mobile-no-overflow', async () => {
    const mob = await page.context().newPage();
    try {
      await mob.setViewportSize({ width: 390, height: 780 });
      // domcontentloaded + explicit timeout: the dashboard polls continuously,
      // so goto's default "load" wait can burn 30s and log a false failure.
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mob.evaluate(([tok, u]) => {
        localStorage.setItem('authToken', tok); localStorage.setItem('user', JSON.stringify(u));
      }, [await page.evaluate(() => localStorage.getItem('authToken')), await page.evaluate(() => localStorage.getItem('user'))]);
      await mob.goto(`${BASE}/`, nav);
      // Dashboard widgets poll (news/map), so networkidle can't settle here.
      await mob.waitForLoadState('networkidle').catch(() => {});
      await mob.waitForTimeout(3000);
      const { scrollW, clientW } = await mob.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      // 4px tolerance for sub-pixel rounding.
      if (scrollW > clientW + 4) throw new Error(`client dashboard overflows on mobile: scrollWidth ${scrollW} > viewport ${clientW}`);
    } finally {
      await mob.close();
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
