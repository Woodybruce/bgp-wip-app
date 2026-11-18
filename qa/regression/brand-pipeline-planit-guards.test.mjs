// The planning check and PlanIt's rate limit (Woody, 2026-11-18: "can we do
// planning for the last 12 months? And is it actually working?"). The
// nightly run asked PlanIt about 26 times a minute and most brands were
// refused; every PlanIt request now takes its turn and honours Retry-After,
// and the twelve-month check is started by an admin, never at boot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const pipeline = read('server/brand-pipeline.ts');
const index = read('server/index.ts');
const between = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

test('every PlanIt request takes its turn first and honours Retry-After', () => {
  assert.equal((pipeline.match(/\$\{PLANIT_URL\}\?/g) || []).length, 1, 'one place asks PlanIt');
  const read = between(pipeline, 'async function readPlanning', '\ninterface JobsOutcome');
  assert.ok(read.indexOf('await planitTurn(gate, sleep, maxWaitMs)') < read.indexOf('${PLANIT_URL}?'));
  assert.match(read, /res\.status === 429/);
  assert.match(read, /retryAfterMs\(\(res as any\)\.headers\?\.get\?\.\("retry-after"\)/);
  assert.match(pipeline, /export const PLANIT_GAP_MS = 6000;/);
});

test('the twelve-month check asks PlanIt only, and is started by an admin, never at boot', () => {
  const run = between(pipeline, 'async function runPlanningSweep', 'let sweepRun');
  assert.doesNotMatch(run, /readJobs\(|ADZUNA_URL/);
  assert.match(run, /readPlanning\(names, deps, PLANIT_SWEEP_WAIT_MS\)/);
  assert.doesNotMatch(index, /startPlanningSweep/);
  assert.match(index, /import\("\.\/brand-pipeline"\)\.then\(m => m\.resumePlanningSweep\(\)\)/);
  for (const route of ['router.get("/api/admin/brand-pipeline/planning-sweep"', 'router.post("/api/admin/brand-pipeline/planning-sweep"']) {
    assert.match(pipeline, new RegExp(`${route.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}, requireAuth, requireAdmin,`));
  }
});

test('the nightly run stops for the night when PlanIt keeps refusing', () => {
  const nightly = between(pipeline, 'export async function nightlyPipelinePass', '// ─── Twelve months');
  assert.match(nightly, /refreshOne\(String\(row\.id\), deps, PLANIT_NIGHTLY_WAIT_MS\)/);
  assert.match(nightly, /if \(r\.planning\.limited\) \{ out\.stoppedEarly = [^;]+; break; \}/);
});
