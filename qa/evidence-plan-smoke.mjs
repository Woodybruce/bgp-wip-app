// Only run against the disposable local app/DB. Never clone or mutate a live plan.
// EVIDENCE_SMOKE_DATABASE_URL='postgresql:///bgp_smoke?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres'
// SMOKE_BASE=https://127.0.0.1:5446 SMOKE_LOCAL_TLS=1 SMOKE_CHROMIUM=/path/to/chrome node qa/evidence-plan-smoke.mjs
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { chromium, devices } from '../node_modules/playwright/index.mjs';

const BASE = new URL(process.env.SMOKE_BASE || 'https://127.0.0.1:5446');
if (!['http:', 'https:'].includes(BASE.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(BASE.hostname) || BASE.username || BASE.password) throw new Error('Local fixture app required');
const supplied = process.env.EVIDENCE_SMOKE_DATABASE_URL || process.env.CRM_SMOKE_DATABASE_URL;
if (!supplied) throw new Error('Provide EVIDENCE_SMOKE_DATABASE_URL for the disposable database');
const dbUrl = new URL(supplied);
if (dbUrl.hostname || dbUrl.pathname !== '/bgp_smoke' || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(dbUrl.searchParams.get('host') || '')) throw new Error('Disposable smoke database Unix socket required');
const OUTPUT = resolve(process.env.UX_OUTPUT || '../audit-evidence/evidence-plan-20260907/browser');
mkdirSync(OUTPUT, { recursive: true });
const smoke = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8');
const fixture = name => smoke.match(new RegExp(`const ${name} = '([^']+)'`))[1];
const html = readFileSync(new URL('../server/assets/demos/brent-cross-evidence-map.html', import.meta.url), 'utf8');
const jpeg = Buffer.from(html.match(/<img id="plan" src="data:image\/jpeg;base64,([^"]+)"/)[1], 'base64');
const markers = runInNewContext(`(${html.match(/const EVIDENCE=(\[[\s\S]*?\]);/)[1]})`, Object.create(null), { timeout: 1000 });
assert.equal(createHash('sha256').update(jpeg).digest('hex'), '3819ad24f27eb83de251c2139f833e68b5b03b355f30479edaf311acb0beedb5', 'Original embedded JPEG changed; review fixture provenance');
const id = n => `ecd09070-0907-4000-8000-${String(n).padStart(12, '0')}`;
const PLAN = id(1), LEVEL = id(2), PROPERTY = id(3), TS_D2 = id(4), TS_EXPLICIT = id(5);
const EMPTY_UNIT = id(200), UNMATCHED_ENTRY = id(301);
const FILE_KEY = `qa/evidence-plan-${PLAN}/brent-cross-lower.jpg`;
const rectangle = (x, y, width = 0.04, height = 0.04) => [{ x: x - width / 2, y: y - height / 2 }, { x: x + width / 2, y: y - height / 2 }, { x: x + width / 2, y: y + height / 2 }, { x: x - width / 2, y: y + height / 2 }];
function insidePolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
const results = { checks: [], screenshots: [], pageErrors: [], mutationErrors: [], fixture: { planId: PLAN, originalImage: '1707×1280 JPEG from the August demo', geometry: 'Synthetic rectangles around demo markers, not inferred shop boundaries', livePlanCloned: false } };
const db = new pg.Client({ connectionString: supplied, ssl: false });
let browser, seeded = false, activePage;
function check(name, pass) { assert.ok(pass, name); results.checks.push(name); console.log(`PASS ${name}`); }
async function eventually(fn, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
}
const unitRow = async unitId => (await db.query('SELECT * FROM evidence_plan_units WHERE id=$1 AND plan_id=$2', [unitId, PLAN])).rows[0];
async function screenshot(page, name) {
  const file = `${name}.png`;
  await page.screenshot({ path: join(OUTPUT, file), fullPage: false });
  results.screenshots.push(file);
}
async function api(page, path) {
  assert.ok(path.startsWith(`/api/evidence-plans/${PLAN}`), 'Only fixture plan detail may be fetched through this helper');
  return page.evaluate(async path => {
    const token = localStorage.getItem('bgp_auth_token');
    const response = await fetch(path, { credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: response.status, body: await response.json() };
  }, path);
}
async function newContext(phone = false) {
  const context = await browser.newContext({ ...(phone ? devices['iPhone 13'] : { viewport: { width: 1440, height: 1000 } }), serviceWorkers: 'block', ignoreHTTPSErrors: process.env.SMOKE_LOCAL_TLS === '1' });
  await context.route('**/*', route => new URL(route.request().url()).origin === BASE.origin ? route.continue() : route.abort());
  return context;
}
async function login(context) {
  const page = await context.newPage(); activePage = page;
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => results.pageErrors.push(error.message));
  page.on('response', async response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/evidence-plans/') && response.request().method() !== 'GET' && !response.ok()) {
      const body = await response.json().catch(() => ({}));
      results.mutationErrors.push({ path, status: response.status(), error: body.error || 'No JSON error message' });
    }
  });
  await page.goto(`${BASE.origin}/evidence-plans/${PLAN}`);
  await page.getByTestId('card-login').waitFor({ state: 'visible', timeout: 25000 });
  if (await page.getByTestId('button-show-guest-login').isVisible()) await page.getByTestId('button-show-guest-login').click();
  await page.getByTestId('input-guest-email').fill(fixture('STAFF'));
  await page.getByTestId('input-guest-password').fill(fixture('PASSWORD'));
  await page.getByTestId('button-guest-login').click();
  await page.getByTestId('card-login').waitFor({ state: 'hidden', timeout: 25000 });
  await page.goto(`${BASE.origin}/evidence-plans/${PLAN}`);
  await page.getByTestId('evidence-plan-surface').waitFor({ state: 'visible', timeout: 25000 });
  return page;
}
async function selectUnit(page, unitId) {
  await page.getByTestId(`unit-marker-${unitId}`).click();
  await page.getByTestId('button-edit-unit').waitFor({ state: 'visible' });
}
async function planPoint(page, point) {
  const rect = await page.getByTestId('evidence-plan-surface').boundingBox();
  assert.ok(rect?.width && rect?.height, 'Plan surface has a real layout');
  return { x: rect.x + point.x * rect.width, y: rect.y + point.y * rect.height };
}
async function clickPoint(page, point) { const p = await planPoint(page, point); await page.mouse.click(p.x, p.y); }
async function drawPolygon(page, points, ref) {
  await page.getByTestId('pill-draw-unit').click();
  for (const point of points) await clickPoint(page, point);
  await page.getByTestId('button-finish-outline').click();
  await page.getByTestId('input-unit-ref').fill(ref);
  await page.getByTestId('button-save-unit-ref').click();
  await page.getByTestId('input-unit-ref').waitFor({ state: 'hidden' });
  let found;
  await eventually(async () => { found = (await db.query('SELECT * FROM evidence_plan_units WHERE plan_id=$1 AND unit_ref=$2', [PLAN, ref])).rows[0]; return !!found; }, 'drawn unit persisted');
  return found;
}
async function seed() {
  const collision = await db.query('SELECT id::text FROM evidence_plans WHERE id=$1 UNION ALL SELECT id::text FROM crm_properties WHERE id=$2 UNION ALL SELECT storage_key FROM file_storage WHERE storage_key=$3', [PLAN, PROPERTY, FILE_KEY]);
  assert.equal(collision.rows.length, 0, 'Fixture IDs exist; refusing to overwrite data');
  await db.query('BEGIN');
  await db.query('INSERT INTO crm_properties (id,name) VALUES ($1,$2)', [PROPERTY, 'QA Brent Cross schedule fixture']);
  await db.query('INSERT INTO tenancy_schedule_units (id,property_id,unit_number,trading_name,lease_expiry,next_review_date,passing_rent_pa,erv_pa,nia_sqft) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [TS_D2, PROPERTY, 'Unit D02', 'QA Schedule Tenant D2', '2031-09-30', '2028-09-30', 222222, 240000, 2400]);
  await db.query('INSERT INTO tenancy_schedule_units (id,property_id,unit_number,trading_name,lease_expiry,passing_rent_pa,erv_pa,nia_sqft) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [TS_EXPLICIT, PROPERTY, 'TS-X77', 'QA Explicit Schedule Tenant', '2033-12-31', 77777, 88000, 777]);
  await db.query('INSERT INTO file_storage (storage_key,data,content_type,original_name,size) VALUES ($1,$2,$3,$4,$5)', [FILE_KEY, jpeg, 'image/jpeg', 'brent-cross-lower-original.jpg', jpeg.length]);
  await db.query('INSERT INTO evidence_plans (id,name,background_key,background_width,background_height) VALUES ($1,$2,$3,1707,1280)', [PLAN, 'QA Brent Cross interaction fixture', FILE_KEY]);
  await db.query('INSERT INTO evidence_plan_levels (id,plan_id,name,background_key,background_width,background_height) VALUES ($1,$2,$3,$4,1707,1280)', [LEVEL, PLAN, 'Lower level', FILE_KEY]);
  for (const [index, marker] of markers.entries()) {
    const dot = { x: marker.cx / 100, y: marker.cy / 100 };
    await db.query('INSERT INTO evidence_plan_units (id,plan_id,level_id,unit_ref,tenant_name,polygon,dot,source,passing_rent,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id(100 + index), PLAN, LEVEL, marker.unit, `QA Demo ${marker.unit}`, JSON.stringify(rectangle(dot.x, dot.y, index === 6 ? 0.10 : 0.04, index === 6 ? 0.10 : 0.04)), JSON.stringify(dot), 'manual', 10000 + index, 'Synthetic fixture geometry']);
    await db.query('INSERT INTO evidence_plan_entries (id,plan_id,unit_id,unit_ref,tenant,transaction_type,transaction_date,zone_a,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id(400 + index), PLAN, id(100 + index), marker.unit, `QA Demo ${marker.unit}`, marker.type, '2026-08-01', marker.za, JSON.stringify(marker.extra)]);
  }
  await db.query('INSERT INTO evidence_plan_units (id,plan_id,level_id,unit_ref,tenant_name,polygon,dot,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [EMPTY_UNIT, PLAN, LEVEL, 'QA-EMPTY', 'No evidence fixture', JSON.stringify(rectangle(0.52, 0.28)), JSON.stringify({ x: 0.52, y: 0.28 }), 'manual']);
  await db.query('INSERT INTO evidence_plan_entries (id,plan_id,unit_ref,tenant,transaction_type,zone_a) VALUES ($1,$2,$3,$4,$5,$6)', [UNMATCHED_ENTRY, PLAN, 'QA-DRAW', 'Waiting evidence fixture', 'OML', 111]);
  await db.query('COMMIT'); seeded = true;
}
async function cleanup() {
  if (!seeded) { await db.query('ROLLBACK').catch(() => {}); return; }
  await db.query('BEGIN');
  for (const table of ['evidence_plan_entries', 'evidence_plan_units', 'evidence_plan_jobs', 'evidence_plan_levels']) await db.query(`DELETE FROM ${table} WHERE plan_id=$1`, [PLAN]);
  await db.query('DELETE FROM evidence_plans WHERE id=$1', [PLAN]);
  await db.query('DELETE FROM tenancy_schedule_units WHERE id=ANY($1::varchar[]) AND property_id=$2', [[TS_D2, TS_EXPLICIT], PROPERTY]);
  await db.query('DELETE FROM crm_properties WHERE id=$1', [PROPERTY]);
  await db.query('DELETE FROM file_storage WHERE storage_key=$1', [FILE_KEY]);
  await db.query('COMMIT'); results.fixture.cleaned = true;
}

await db.connect();
try {
  await seed();
  if (process.env.EVIDENCE_FIXTURE_ONLY === '1') {
    results.fixture.retained = true;
    console.log(`Fixture ready: ${BASE.origin}/evidence-plans/${PLAN}`);
  } else {
    browser = await chromium.launch({ headless: true, ...(process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {}) });
    const context = await newContext();
    const page = await login(context);
    const detail = await api(page, `/api/evidence-plans/${PLAN}`);
    check('actual API returns the seeded plan, 12 units and 12 evidence entries', detail.status === 200 && detail.body.units.length === 12 && detail.body.entries.length === 12);
    await page.waitForFunction(() => { const image = document.querySelector('[data-testid="evidence-plan-surface"] img'); return image?.complete && image.naturalWidth === 1707; });
    check('original plan background loads with correct dimensions', true);
    check('a unit without evidence has a visible marker', await page.getByTestId(`unit-marker-${EMPTY_UNIT}`).isVisible());
    await screenshot(page, 'desktop-original-plan');

    const panStart = await planPoint(page, { x: 0.312, y: 0.502 });
    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down();
    await page.mouse.move(panStart.x + 60, panStart.y + 35, { steps: 8 });
    await page.mouse.up();
    check('panning from an unselected outline does not select it on release', await page.getByTestId('button-edit-unit').count() === 0);
    await page.getByTestId('button-zoom-reset').click();

    await page.getByTestId('pill-draw-unit').click();
    for (const point of [{ x: 0.2, y: 0.4 }, { x: 0.22, y: 0.4 }, { x: 0.22, y: 0.42 }]) await clickPoint(page, point);
    check('three corners enable Finish outline', await page.getByTestId('button-finish-outline').isEnabled());
    await page.getByTestId('button-undo-point').click();
    check('Undo removes one corner and disables an incomplete outline', await page.getByTestId('button-finish-outline').isDisabled());
    await page.getByTestId('button-cancel-drawing').click();
    check('cancelling drawing creates no unit', Number((await db.query('SELECT count(*) AS n FROM evidence_plan_units WHERE plan_id=$1', [PLAN])).rows[0].n) === 12);

    // All corners land inside an existing outline: Draw must own those events.
    const polygon = rectangle(0.29, 0.56, 0.025, 0.025);
    const drawn = await drawPolygon(page, polygon, 'QA-DRAW');
    check('drawing over an existing unit records exactly four distinct corners', drawn.polygon.length === 4 && new Set(drawn.polygon.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`)).size === 4);
    const adopted = (await db.query('SELECT unit_id FROM evidence_plan_entries WHERE id=$1', [UNMATCHED_ENTRY])).rows[0];
    check('matching previously unlinked evidence adopts the drawn unit', adopted.unit_id === drawn.id);

    await page.getByTestId('button-redraw-unit').click();
    const corrected = rectangle(0.29, 0.30, 0.035, 0.035);
    for (const point of corrected) await clickPoint(page, point);
    await page.getByTestId('button-finish-outline').click();
    check('redrawing keeps the current unit reference fixed', await page.getByTestId('input-unit-ref').inputValue() === 'QA-DRAW' && await page.getByTestId('input-unit-ref').isDisabled());
    await page.getByTestId('button-save-unit-ref').click();
    await page.getByTestId('input-unit-ref').waitFor({ state: 'hidden' });
    await eventually(async () => { const row = await unitRow(drawn.id); return row?.polygon.length === 4 && Math.abs(row.polygon[0].y - corrected[0].y) < 0.002; }, 'corrected outline persisted');
    check('redraw keeps the unit ID and its linked evidence', (await db.query('SELECT unit_id FROM evidence_plan_entries WHERE id=$1', [UNMATCHED_ENTRY])).rows[0].unit_id === drawn.id);
    await page.getByTestId('button-close-unit').click();
    await page.getByTestId('input-unit-search').fill('QA-EMPTY');
    await page.getByTestId(`unit-row-${EMPTY_UNIT}`).waitFor({ state: 'visible' });
    check('unit search includes a record with no evidence', await page.getByTestId(`unit-row-${EMPTY_UNIT}`).isVisible() && await page.getByTestId(`unit-row-${id(101)}`).count() === 0);
    await page.getByTestId('input-unit-search').fill('');

    await selectUnit(page, EMPTY_UNIT);
    await page.getByTestId('button-edit-unit').click();
    await page.getByTestId('unit-field-notes').fill('QA draft retained after failed save');
    await page.getByTestId('unit-field-passingRent').fill('0');
    let failNext = true;
    const unitUrl = `**/api/evidence-plans/units/${EMPTY_UNIT}`;
    const failSave = route => route.request().method() === 'PUT' && failNext ? (failNext = false, route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic save failure' }) })) : route.continue();
    await context.route(unitUrl, failSave);
    await page.getByTestId('button-save-unit').click();
    await page.getByTestId('unit-save-error').waitFor({ state: 'visible' });
    check('failed manual save keeps entered notes and numeric zero available', await page.getByTestId('unit-field-notes').inputValue() === 'QA draft retained after failed save' && await page.getByTestId('unit-field-passingRent').inputValue() === '0');
    await page.getByTestId('button-save-unit').click();
    await eventually(async () => (await unitRow(EMPTY_UNIT))?.notes === 'QA draft retained after failed save', 'retried manual edit persisted');
    check('manual zero value is saved as zero', Number((await unitRow(EMPTY_UNIT)).passing_rent) === 0);
    await context.unroute(unitUrl, failSave);
    await screenshot(page, 'desktop-manual-unit-saved');

    // Link through the actual UI, then edit the matched canonical schedule row.
    await page.getByTestId('button-link-property').click();
    await page.getByTestId('select-link-property').selectOption(PROPERTY);
    await page.getByTestId('button-save-property-link').click();
    await page.getByTestId('select-link-property').waitFor({ state: 'hidden' });
    await eventually(async () => (await page.getByTestId('button-link-property').innerText()).includes('QA Brent Cross schedule fixture'), 'linked property and schedule data rendered');
    await selectUnit(page, id(101));
    await page.getByTestId('button-edit-unit').click();
    await page.getByTestId('unit-field-passingRent').fill('234567');
    await page.getByTestId('button-save-unit').click();
    await eventually(async () => Number((await db.query('SELECT passing_rent_pa FROM tenancy_schedule_units WHERE id=$1', [TS_D2])).rows[0].passing_rent_pa) === 234567, 'canonical schedule edit persisted');
    check('matched Unit D02/D2 edit updates the canonical schedule', true);
    check('matched schedule edit does not overwrite obsolete plan-local facts', Number((await unitRow(id(101))).passing_rent) === 10001);
    await selectUnit(page, EMPTY_UNIT);
    await page.getByTestId('select-unit-schedule').locator('..').locator('summary').click();
    await page.getByTestId('select-unit-schedule').selectOption(TS_EXPLICIT);
    await page.getByTestId('button-link-unit-schedule').click();
    await eventually(async () => (await unitRow(EMPTY_UNIT)).unit_ref === 'TS-X77', 'explicit schedule reference persisted');
    const linked = await api(page, `/api/evidence-plans/${PLAN}`);
    check('explicit schedule linking resolves the chosen row from its saved reference', linked.body.units.find(unit => unit.id === EMPTY_UNIT)?.ts_row_id === TS_EXPLICIT);

    await selectUnit(page, id(106));
    await page.getByTestId(`button-edit-evidence-${id(406)}`).click();
    await page.getByTestId('evidence-field-zoneA').fill('333');
    await page.getByTestId('button-save-evidence').click();
    await eventually(async () => Number((await db.query('SELECT zone_a FROM evidence_plan_entries WHERE id=$1', [id(406)])).rows[0].zone_a) === 333, 'existing evidence edit persisted');
    await page.getByTestId(`unit-marker-${id(106)}`).getByText('£333', { exact: true }).waitFor({ state: 'visible' });
    check('editing evidence updates the existing entry and plan marker', true);

    for (const zoomed of [false, true]) {
      await page.getByTestId('button-zoom-reset').click();
      if (zoomed) for (let n = 0; n < 3; n++) await page.getByTestId('button-zoom-in').click();
      if (zoomed) {
        const canvas = await page.getByTestId('evidence-plan-canvas').boundingBox();
        await page.mouse.move(canvas.x + 50, canvas.y + canvas.height - 65);
        await page.mouse.down();
        await page.mouse.move(canvas.x + 85, canvas.y + canvas.height - 85, { steps: 8 });
        await page.mouse.up();
      }
      const marker = page.getByTestId(`unit-marker-${id(106)}`);
      const old = await unitRow(id(106));
      const startBox = await marker.boundingBox();
      const target = await planPoint(page, { x: old.dot.x + 0.008, y: old.dot.y + 0.006 });
      let release, held = false;
      const gate = new Promise(resolve => { release = resolve; });
      const delaySave = async route => {
        if (route.request().method() === 'PUT') { held = true; await gate; }
        return route.continue();
      };
      const markerUrl = `**/api/evidence-plans/units/${id(106)}`;
      if (!zoomed) await context.route(markerUrl, delaySave);
      try {
        await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(target.x, target.y, { steps: 8 });
        await page.mouse.up();
        if (!zoomed) {
          await eventually(() => held, 'delayed marker save started');
          await page.getByText('Saving label…', { exact: true }).waitFor({ state: 'visible' });
          const pendingBox = await marker.boundingBox();
          check('label stays at its dragged position while the save is pending', Math.abs(pendingBox.x + pendingBox.width / 2 - target.x) < 3 && Math.abs(pendingBox.y + pendingBox.height / 2 - target.y) < 3);
        }
      } finally { release(); }
      await eventually(async () => { const fresh = await unitRow(id(106)); return Math.abs(fresh.dot.x - old.dot.x - 0.008) < 0.002 && Math.abs(fresh.dot.y - old.dot.y - 0.006) < 0.002; }, `marker saved at ${zoomed ? 'zoomed and panned' : '1×'} coordinates`);
      check(`marker drag saves correct normalised coordinates at ${zoomed ? 'zoomed and panned' : '1×'} scale`, true);
      if (!zoomed) await context.unroute(markerUrl, delaySave);
    }
    await page.getByText('Saving label…', { exact: true }).waitFor({ state: 'hidden' });
    const beforeKey = (await unitRow(id(106))).dot;
    await page.getByTestId(`unit-marker-${id(106)}`).focus();
    await page.keyboard.press('ArrowLeft');
    await eventually(async () => (await unitRow(id(106))).dot.x < beforeKey.x, 'keyboard marker movement persisted');
    check('selected marker can be adjusted with keyboard arrows', true);
    await page.getByText('Saving label…', { exact: true }).waitFor({ state: 'hidden' });
    await page.getByTestId('button-zoom-reset').click();
    const boundsMarker = page.getByTestId(`unit-marker-${id(106)}`);
    const boundsStart = await boundsMarker.boundingBox();
    const beyondBoundary = await planPoint(page, { x: 0.66, y: 0.63 });
    let boundarySave = false;
    const onBoundarySave = response => { if (response.url().endsWith(`/api/evidence-plans/units/${id(106)}`) && response.request().method() === 'PUT' && response.ok()) boundarySave = true; };
    page.on('response', onBoundarySave);
    await page.mouse.move(boundsStart.x + boundsStart.width / 2, boundsStart.y + boundsStart.height / 2);
    await page.mouse.down();
    await page.mouse.move(beyondBoundary.x, beyondBoundary.y, { steps: 10 });
    await page.mouse.up();
    await eventually(() => boundarySave, 'boundary-constrained label saved');
    page.off('response', onBoundarySave);
    const constrained = (await unitRow(id(106))).dot;
    check('dragging beyond the unit keeps its saved label inside its own outline', constrained.x >= 0.47 && constrained.x <= 0.57 && constrained.y >= 0.44 && constrained.y <= 0.54);
    await page.getByText('Saving label…', { exact: true }).waitFor({ state: 'hidden' });
    await screenshot(page, 'desktop-edited-plan');
    await page.reload();
    await page.getByTestId(`unit-marker-${id(106)}`).waitFor({ state: 'visible', timeout: 25000 });
    const afterReload = await api(page, `/api/evidence-plans/${PLAN}`);
    check('reload retains explicit schedule link and revised evidence', afterReload.body.units.find(u => u.id === EMPTY_UNIT)?.ts_row_id === TS_EXPLICIT && Number(afterReload.body.entries.find(e => e.id === id(406))?.zone_a) === 333);

    // This is the actual image-processing route, not a mocked polygon response.
    const tracePath = `/api/evidence-plans/levels/${LEVEL}/trace-unit`;
    const countBeforeTrace = Number((await db.query('SELECT count(*) AS n FROM evidence_plan_units WHERE plan_id=$1', [PLAN])).rows[0].n);
    await page.getByTestId('pill-trace-unit').click();
    const goodTraceResponse = page.waitForResponse(response => new URL(response.url()).pathname === tracePath && response.request().method() === 'POST');
    await clickPoint(page, { x: 0.132, y: 0.40 });
    const goodTrace = await goodTraceResponse;
    const preview = await goodTrace.json();
    check('Trace unit reads the original John Lewis boundary through the actual endpoint', goodTrace.status() === 200 && preview.polygon?.length > 4 && insidePolygon({ x: 0.132, y: 0.40 }, preview.polygon));
    check('tracing previews an outline without writing a unit', Number((await db.query('SELECT count(*) AS n FROM evidence_plan_units WHERE plan_id=$1', [PLAN])).rows[0].n) === countBeforeTrace);
    await page.getByTestId('input-unit-ref').fill('QA-TRACE');
    await page.getByTestId('button-save-unit-ref').click();
    await page.getByTestId('input-unit-ref').waitFor({ state: 'hidden' });
    let tracedUnit;
    await eventually(async () => { tracedUnit = (await db.query('SELECT * FROM evidence_plan_units WHERE plan_id=$1 AND unit_ref=$2', [PLAN, 'QA-TRACE'])).rows[0]; return !!tracedUnit; }, 'traced outline persisted');
    check('saving a traced outline preserves its nonrectangular preview and interior point', JSON.stringify(tracedUnit.polygon) === JSON.stringify(preview.polygon) && insidePolygon(tracedUnit.dot, tracedUnit.polygon));
    const traceMarker = page.getByTestId(`unit-marker-${tracedUnit.id}`);
    await traceMarker.waitFor({ state: 'visible' });
    const disc = await traceMarker.locator('circle').evaluate(circle => ({ x: Number(circle.getAttribute('cx')) / 100, y: Number(circle.getAttribute('cy')) / (100 * 1280 / 1707), radius: Number(circle.getAttribute('r')) / 100 }));
    check('the traced unit label disc stays inside the actual shop boundary', Array.from({ length: 24 }, (_, n) => n * Math.PI / 12).every(angle => insidePolygon({ x: disc.x + Math.cos(angle) * disc.radius, y: disc.y + Math.sin(angle) * disc.radius / (1280 / 1707) }, tracedUnit.polygon)));
    await screenshot(page, 'desktop-traced-john-lewis');
    await page.getByTestId('button-close-unit').click();
    await page.getByTestId('pill-trace-unit').click();
    const badTraceResponse = page.waitForResponse(response => new URL(response.url()).pathname === tracePath && response.request().method() === 'POST');
    await clickPoint(page, { x: 660 / 1707, y: 654 / 1280 });
    const badTrace = await badTraceResponse;
    check('a mall click is rejected instead of tracing surrounding circulation', badTrace.status() === 422);
    await page.getByText("Couldn't trace this unit", { exact: true }).waitFor({ state: 'visible' });
    check('failed tracing shows guidance and creates no unit or naming dialog', await page.getByTestId('input-unit-ref').count() === 0 && Number((await db.query('SELECT count(*) AS n FROM evidence_plan_units WHERE plan_id=$1', [PLAN])).rows[0].n) === countBeforeTrace + 1);
    await screenshot(page, 'desktop-mall-trace-rejected');
    await page.getByTestId('button-cancel-drawing').click();

    // A late preview for A must never replace a new drawing operation for B.
    await selectUnit(page, id(106));
    await page.getByTestId('button-trace-boundary').click();
    const beforeOtherOutline = JSON.stringify((await unitRow(EMPTY_UNIT)).polygon);
    let releaseTrace, traceHeld = false;
    const traceGate = new Promise(resolve => { releaseTrace = resolve; });
    const delayTrace = async route => { traceHeld = true; await traceGate; return route.continue(); };
    await context.route(`**${tracePath}`, delayTrace);
    try {
      const staleTraceResponse = page.waitForResponse(response => new URL(response.url()).pathname === tracePath && response.request().method() === 'POST');
      await clickPoint(page, { x: 0.132, y: 0.40 });
      await eventually(() => traceHeld, 'first unit trace request held');
      await page.getByTestId('button-cancel-drawing').click();
      await selectUnit(page, EMPTY_UNIT);
      await page.getByTestId('button-redraw-unit').click();
      await clickPoint(page, { x: 0.50, y: 0.26 });
      releaseTrace();
      const staleResponse = await staleTraceResponse;
      assert.equal(staleResponse.status(), 200, 'Delayed request must complete successfully to exercise stale-response rejection');
      await staleResponse.finished();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      check('a cancelled trace response cannot open a stale naming dialog over a different redraw', await page.getByTestId('input-unit-ref').count() === 0 && await page.getByTestId('button-finish-outline').isVisible() && await page.getByTestId('button-finish-outline').isDisabled());
      check('the newer unit drawing and saved geometry survive the old trace response', await page.getByText('1 points', { exact: true }).isVisible() && JSON.stringify((await unitRow(EMPTY_UNIT)).polygon) === beforeOtherOutline);
      await screenshot(page, 'desktop-stale-trace-ignored');
      await page.getByTestId('button-cancel-drawing').click();
    } finally {
      releaseTrace();
      await context.unroute(`**${tracePath}`, delayTrace);
    }

    const countBeforeChangedImage = Number((await db.query('SELECT count(*) AS n FROM evidence_plan_units WHERE plan_id=$1', [PLAN])).rows[0].n);
    const changedImageTrace = async route => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, backgroundKey: `${FILE_KEY}-new-frame` } });
    };
    await context.route(`**${tracePath}`, changedImageTrace);
    try {
      await page.getByTestId('pill-trace-unit').click();
      await clickPoint(page, { x: 0.132, y: 0.40 });
      await page.getByText('The plan image changed while tracing. Reload this level before tracing its current boundaries.', { exact: true }).waitFor({ state: 'visible' });
      check('a trace for a changed image shows reload guidance without opening or saving an outline', await page.getByTestId('input-unit-ref').count() === 0 && Number((await db.query('SELECT count(*) AS n FROM evidence_plan_units WHERE plan_id=$1', [PLAN])).rows[0].n) === countBeforeChangedImage);
      await screenshot(page, 'desktop-stale-image-trace-rejected');
      await page.getByTestId('button-cancel-drawing').click();
    } finally { await context.unroute(`**${tracePath}`, changedImageTrace); }
    await context.close();

    const phoneContext = await newContext(true);
    const phone = await login(phoneContext);
    check('phone has no horizontal page overflow', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await screenshot(phone, 'phone-original-plan');
    await selectUnit(phone, EMPTY_UNIT);
    await phone.getByTestId('button-edit-unit').click();
    await phone.getByTestId('unit-field-notes').fill('QA phone edit');
    await phone.getByTestId('button-save-unit').click();
    await eventually(async () => (await unitRow(EMPTY_UNIT))?.notes === 'QA phone edit', 'phone unit edit persisted');
    check('phone unit panel remains usable for real edits', true);
    await phone.getByTestId('button-edit-unit').waitFor({ state: 'visible' });
    await phone.getByTestId('button-edit-unit').scrollIntoViewIfNeeded();
    await screenshot(phone, 'phone-unit-edited');
    await phone.getByTestId('button-close-unit').click();
    await phone.getByTestId('button-close-unit').waitFor({ state: 'hidden' });
    await phone.getByTestId('button-plan-details').click();
    await phone.getByTestId('input-unit-search').fill('TS-X77');
    await phone.getByTestId(`unit-row-${EMPTY_UNIT}`).click();
    await phone.getByTestId('button-edit-unit').waitFor({ state: 'visible' });
    check('phone sheet closes and reopens the same unit through its searchable list', await phone.getByRole('heading', { name: 'Unit TS-X77', exact: true }).isVisible());
    await phoneContext.close();
    check('no uncaught browser errors', results.pageErrors.length === 0);
  }
} catch (error) {
  results.failure = error.stack;
  console.error(error);
  if (activePage && !activePage.isClosed()) await screenshot(activePage, 'failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (!results.fixture.retained) await cleanup();
  await db.end();
  results.passed = !results.failure && results.pageErrors.length === 0;
  writeFileSync(join(OUTPUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`${results.passed ? 'PASS' : 'FAIL'} ${results.checks.length} evidence-plan checks; fixture ${results.fixture.retained ? 'retained by explicit EVIDENCE_FIXTURE_ONLY' : 'cleaned up'}`);
}
