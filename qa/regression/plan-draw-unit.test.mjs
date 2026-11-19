// Draw a unit on the plan-led property page (19 November 2026). Woody: "the
// plan on the property page has lost the ability to draw a unit and allocate
// to the tenancy schedule where the scan hasn't worked. we had that in the
// lease advisory version works well". The Plans window's Trace and Draw tools
// did not come across when the plan's tools moved onto the Plan tab on
// 16 November; "Draw a unit" above the plan brings them back, outline first,
// then the unit on the schedule (or grey), as the lease advisory plans do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const workspace = read('client/src/components/property-page/plan-workspace.tsx');

test('Draw a unit sits above the plan for everyone who can amend it', () => {
  assert.match(workspace, /const drawButton = canEdit && \(/);
  assert.match(workspace, /data-testid="property-plan-draw-unit"/);
  assert.match(workspace, /<>\{drawButton\}\{planMenu\}<\/>/, 'beside Edit plan in the plan\'s header');
  // Corner by corner first, with clicking inside to find the walls a press away.
  assert.match(workspace, /setFinding\(\{ rowId: null, step: "corners", how: "corners", error: null, saved: null \}\)/);
  assert.match(workspace, /data-testid="plan-find-click-inside"/);
  assert.match(workspace, /data-testid="plan-find-corners"/);
});

test('once drawn, the outline is given its unit on the schedule, or saved grey', () => {
  assert.match(workspace, /<RowPicker label="Choose the unit" rows=\{freeRows\}[^>]*onChoose=\{rowId => void saveFinding\(rowId\)\} testId="plan-draw-choose" \/>/s,
    'only units with no outline on this floor are offered');
  assert.match(workspace, /onClick=\{\(\) => void saveFinding\(null\)\} data-testid="plan-draw-save-grey"/);
  // An outline already on the plan is relinked, never saved twice; grey is not offered for it.
  assert.match(workspace, /drawingFromPlan && preview\?\.kind !== "outline" && \(\s*<Button [^\n]*data-testid="plan-draw-save-grey"/);
  // Drawing carries on with the next unit until Done.
  assert.match(workspace, /if \(finding\.rowId === null\) setFinding\(\{ \.\.\.finding, step: finding\.how, error: null, saved: done \}\);/);
  // The click on Save outline is never read as a unit.
  assert.doesNotMatch(workspace, /onClick=\{saveFinding\}/);
});

test('a hand-drawn grey outline is marked unlinked on purpose, as a grey scan outline is', () => {
  const hook = read('client/src/components/property-page/use-property-page.ts');
  assert.match(hook, /saveTraced: input => run\("POST", `\$\{plan\}\/units`, \{[^}]*status_override: input\.scheduleRowId \? null : "unlinked" \}\)/);
});

test('the plan still never writes to the tenancy schedule', () => {
  assert.doesNotMatch(workspace, /\/api\/tenancy-schedule/);
  const server = read('server/property-plans.ts');
  const at = server.indexOf('router.post("/api/plans/:planId/units"');
  const body = server.slice(at, server.indexOf('\n});\n', at));
  assert.match(body, /This unit already has an outline on this floor/, 'one outline per schedule unit per floor');
  assert.doesNotMatch(body, /INSERT INTO tenancy_schedule_units|UPDATE tenancy_schedule_units/);
});

test('the empty plan and a failed or empty scan point at Draw a unit', () => {
  assert.match(workspace, /Scan it from Edit plan, or use Draw a unit\./);
  assert.match(workspace, /data-testid="property-plan-scan-failed-draw"/);
  assert.match(read('server/property-plan-scan.ts'), /Use Draw a unit above the plan to outline each unit/);
});
