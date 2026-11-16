// Cropping a property plan (Woody, 2026-11-16). The rules themselves are
// tested in shared/plan-crop.test.ts; these pin how the server and the
// screens use them. Run with: node --import tsx --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const plans = read('server/property-plans.ts');
const between = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from) + from.length));

test('the crop route checks the property, the image and the outlines before it cuts anything', () => {
  const route = between(plans, 'router.post("/api/plans/:planId/crop",', 'router.post("/api/plans/:planId/crop/undo"');
  const order = ['await planForRequest(req, res)', 'req.body.imageKey !== plan.storage_key', 'readPlanCropRect(req.body)', 'getFile(plan.storage_key)',
    'planCropPixels(', 'judge(before).refusal', '.extract(crop.pixels)', 'saveFile(storageKey', 'changePlanImage('];
  let at = -1;
  for (const step of order) { const next = route.indexOf(step); assert.ok(next > at, `${step} is missing or out of order`); at = next; }
  assert.match(route, /if \(early\) return res\.status\(409\)/);
  // The outlines are measured against the pixels actually cut, not the box as dragged.
  assert.match(route, /planCropOutcome\(rows\.map\([^]*?\), crop\.rect\)/);
});

test('the image and its outlines change together, under the plan lock, and are judged again inside it', () => {
  const change = between(plans, 'async function changePlanImage(', 'router.post("/api/plans/:planId/crop",');
  assert.match(change, /await planForRequest\(req, res, db, true, plan\.property_id\)/);
  assert.match(change, /locked\.storage_key !== plan\.storage_key/);
  assert.match(change, /FROM property_plan_units WHERE plan_id = \$1 ORDER BY id FOR UPDATE/);
  assert.match(change, /if \(result\.refusal\) \{ await db\.query\("ROLLBACK"\); res\.status\(409\)/);
  assert.ok(change.indexOf('UPDATE property_plan_units SET polygon') < change.indexOf('UPDATE property_plans SET storage_key'));
  assert.ok(change.indexOf('UPDATE property_plans SET storage_key') < change.indexOf('await db.query("COMMIT")'));
  // A scan of the old image is stopped, and started again only after the commit.
  assert.match(change, /UPDATE property_plan_scans SET status = 'failed'[^]*?WHERE plan_id = \$1 AND status = 'running'/);
  assert.ok(change.indexOf('await db.query("COMMIT")') < change.indexOf('autoScanPlans(req, [updated])'));
});

test('restoring the whole page reads the page from the image key and refuses a plan that is not a crop', () => {
  const undo = between(plans, 'router.post("/api/plans/:planId/crop/undo"', 'router.get("/api/plans/:planId/units"');
  assert.match(undo, /await planForRequest\(req, res\)/);
  assert.match(undo, /planCropOrigin\(plan\.storage_key\)/);
  assert.match(undo, /if \(!origin\) return res\.status\(400\)/);
  assert.match(undo, /getFile\(origin\.pageKey\)/);
  assert.match(undo, /uncropPlanOutline\(outlinePoints\(row\.polygon\), origin\.rect\)/);
});

test('the plan image is revalidated by its key, so a cropped plan never shows the old picture', () => {
  const image = between(plans, 'router.get("/api/plans/:planId/image"', 'router.post("/api/plans/:planId/crop",');
  assert.match(image, /createHash\("sha1"\)\.update\(String\(plan\.storage_key\)\)/);
  assert.match(image, /res\.setHeader\("Cache-Control", "private, no-cache"\)/);
  assert.match(image, /if \(req\.headers\["if-none-match"\] === etag\) return res\.status\(304\)\.end\(\)/);
  assert.doesNotMatch(image, /max-age/);
  assert.ok(image.indexOf('await planForRequest(req, res)') < image.indexOf('res.status(304)'), 'access is checked before a 304');
  const hook = read('client/src/components/property-plan-preview.tsx');
  assert.match(hook, /queryKey: imageKey \? \["\/api\/plans", planId, "image", imageKey\] : \["\/api\/plans", planId, "image"\]/);
  assert.match(hook, /\/api\/plans\/\$\{planId\}\/image\?v=2/);
});

test('a client login reaches the crop routes through the same door as the other plan edits', () => {
  const index = read('server/index.ts');
  assert.match(index, /req\.method === "POST" && \/\^\\\/api\\\/plans\\\/\[\^\/\]\+\\\/\(units\|trace-unit\|crop\|crop\\\/undo\)\$\/\.test\(p\)/);
});

test('loading a plan holds the scan until each page is cropped or used whole', () => {
  const panel = read('client/src/components/property-plans-panel.tsx');
  const upload = between(panel, 'function UploadPlanButton(', 'function OriginalPdfLink(');
  assert.equal((upload.match(/form\.append\("autoScan", "false"\)/g) || []).length, 2, 'both upload requests hold the scan');
  assert.match(upload, /if \(crop\) await planCrop\.crop\(plan, cropRect, true\); else await startScan\(plan\);/);
  // Closing part way never leaves a page with no scan.
  assert.match(upload, /if \(!value && loaded\.current\.length\) \{ void useRest\(loaded\.current\.slice\(\)\); return; \}/);
  assert.match(upload, /disabled=\{settling \|\| isWholePage\(cropRect\)\}/);
  for (const id of ['button-plan-crop-apply', 'button-plan-crop-skip', 'button-plan-crop-skip-all']) assert.ok(upload.includes(`data-testid="${id}"`), id);
  const menu = between(panel, 'function PlanEditMenu(', 'function DeletePlanButton(');
  assert.ok(menu.includes('data-testid="button-plan-crop"'));
  assert.match(menu, /\{plan\.cropped && <DropdownMenuItem[^]*?data-testid="button-plan-crop-undo"/);
  const crop = read('client/src/components/property-plan-crop.tsx');
  assert.match(crop, /apiRequest\("POST", `\/api\/plans\/\$\{plan\.id\}\/crop`, \{ \.\.\.rect, imageKey: plan\.storage_key, scan \}\)/);
});
