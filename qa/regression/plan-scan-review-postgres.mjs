// Actual scan-review transactions against an isolated schema in the disposable Unix-socket database.
// No provider calls, environment files or live database access.
// EVIDENCE_PLAN_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' node --import tsx qa/regression/plan-scan-review-postgres.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';
import { applyPlanScanReview, readPlanScanReview, buildPlanScanReview, persistPlanScanReview, planScanReviewKey } from '../../server/plan-scan-review.ts';
import { pointInPolygon } from '../../shared/plan-geometry.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const { normaliseUnitRef } = evaluate(find('server/evidence-plan.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'normaliseUnitRef'));
const supplied = process.env.EVIDENCE_PLAN_DATABASE_URL;
if (!supplied) throw new Error('Provide EVIDENCE_PLAN_DATABASE_URL for the disposable database');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_crm_directory_regression' || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) throw new Error('Refusing non-disposable database');
const schema = `qa_scan_review_${process.pid}_${Date.now()}`;
const db = new pg.Pool({ connectionString: supplied, ssl: false, max: 8, options: `-c search_path=${schema}` });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PLAN = id(1), LEVEL = id(2), JOB = id(3), A1 = id(11), A2 = id(12), OLD = id(13), MANUAL = id(14), ENTRY = id(21);
const box = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const candidate = (n, ref, polygon) => ({ id: `candidate-${n}`, unitRef: ref, tenantName: `Detected ${ref}`, polygon,
  dot: { x: (polygon[0].x + polygon[2].x) / 2, y: (polygon[0].y + polygon[2].y) / 2 }, status: 'review', unitId: null, suggestedUnitIds: [], reason: 'Old AI outlines overlap' });
const candidates = [candidate(1, 'A1', box(.1, .1, .2, .4)), candidate(2, 'A2', box(.35, .1, .2, .4)), candidate(3, 'C1', box(.65, .1, .15, .4))];
const allow = async () => true;
const apply = body => applyPlanScanReview(db, PLAN, JOB, body, allow, normaliseUnitRef);
const row = async unitId => (await db.query('SELECT * FROM evidence_plan_units WHERE id=$1', [unitId])).rows[0];
const rows = async () => (await db.query('SELECT * FROM evidence_plan_units ORDER BY id')).rows;
const entries = async () => (await db.query('SELECT * FROM evidence_plan_entries ORDER BY id')).rows;
const assignment = (n, unitId, extra = {}) => ({ candidateId: `candidate-${n}`, unitId, ...extra });
const unaffected = ({ polygon, dot, source, updated_at, ...facts }) => facts;
async function snapshot() { return JSON.stringify({ units: await rows(), entries: await entries(), files: (await db.query('SELECT * FROM file_storage ORDER BY storage_key')).rows, plans: (await db.query('SELECT * FROM evidence_plans ORDER BY id')).rows }); }
async function rejected(body, status = 409) { const before = await snapshot(); await assert.rejects(() => apply(body), error => error.status === status); assert.equal(await snapshot(), before, 'failed review is fully rolled back'); }
let checks = 0;
async function check(name, fn) { await seed(); await fn(); checks++; console.log(`PASS ${name}`); }
async function seed() {
  await db.query('TRUNCATE file_storage, evidence_plan_entries, evidence_plan_units, evidence_plan_jobs, evidence_plan_levels, evidence_plans');
  await db.query('INSERT INTO evidence_plans (id, property_id) VALUES ($1,$2)', [PLAN, 'fixture-property']);
  await db.query('INSERT INTO evidence_plan_levels (id, plan_id, background_key) VALUES ($1,$2,$3)', [LEVEL, PLAN, 'synthetic-plan.png']);
  await db.query("INSERT INTO evidence_plan_jobs (id,plan_id,level_id,kind,status) VALUES ($1,$2,$3,'detect','done')", [JOB, PLAN, LEVEL]);
  for (const [unitId, ref, polygon, source] of [[A1, 'A1', box(.4, .4, .25, .4), 'ai'], [A2, 'A2', box(.2, .2, .3, .4), 'ai'], [OLD, 'Legacy broad box', box(.05, .05, .85, .85), 'ai'], [MANUAL, 'M1', box(.85, .8, .1, .1), 'manual']]) {
    await db.query(`INSERT INTO evidence_plan_units (id,plan_id,level_id,unit_ref,tenant_name,polygon,dot,source,passing_rent,lease_expiry,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,120000,'2031-02-03','Keep local facts')`, [unitId, PLAN, LEVEL, ref, `Saved ${ref}`, JSON.stringify(polygon), JSON.stringify({ x: polygon[0].x + .02, y: polygon[0].y + .02 }), source]);
  }
  await db.query('INSERT INTO evidence_plan_entries (id,plan_id,unit_id,unit_ref,tenant,zone_a,notes) VALUES ($1,$2,$3,$4,$5,220,$6)', [ENTRY, PLAN, A1, 'A1', 'Original evidence tenant', 'Preserve evidence exactly']);
  await persistPlanScanReview(db, buildPlanScanReview({ planId: PLAN, levelId: LEVEL, jobId: JOB, backgroundKey: 'synthetic-plan.png', candidates: structuredClone(candidates), existingUnits: await rows() }));
}
async function changeArtifact(fn) {
  const result = await db.query('SELECT data FROM file_storage WHERE storage_key=$1', [planScanReviewKey(PLAN, JOB)]);
  const review = JSON.parse(result.rows[0].data.toString()); fn(review); await persistPlanScanReview(db, review);
}
try {
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`
    CREATE TABLE evidence_plans (id uuid PRIMARY KEY, property_id varchar, updated_at timestamptz DEFAULT now());
    CREATE TABLE evidence_plan_levels (id uuid PRIMARY KEY, plan_id uuid, background_key text);
    CREATE TABLE evidence_plan_jobs (id uuid PRIMARY KEY, plan_id uuid, level_id uuid, kind text, status text, created_at timestamptz DEFAULT now());
    CREATE TABLE evidence_plan_units (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid, level_id uuid, unit_ref text, tenant_name text,
      polygon jsonb, dot jsonb, source text, passing_rent numeric, lease_expiry date, notes text, updated_at timestamptz DEFAULT now());
    CREATE TABLE evidence_plan_entries (id uuid PRIMARY KEY, plan_id uuid, unit_id uuid, unit_ref text, tenant text, zone_a numeric, notes text);
    CREATE TABLE file_storage (storage_key text PRIMARY KEY, data bytea, content_type text, original_name text, size integer);
  `);
  await check('review survives reload and exposes every blocked candidate without changing the saved plan', async () => {
    const before = await snapshot(); const result = await readPlanScanReview(db, PLAN, { levelId: LEVEL }, allow);
    assert.equal(result.review.candidates.length, 3); assert.equal(result.review.summary.needsReview, 3); assert.equal(result.legacyNeedsRescan, false);
    assert.equal('applicationRequests' in result.review, false); assert.equal(await snapshot(), before);
  });
  await check('explicit replacement repairs displaced AI geometry in place and preserves evidence and facts', async () => {
    const before = await row(A1), evidence = await entries(), other = await row(OLD);
    const result = await apply({ assignments: [assignment(1, A1)] }); const after = await row(A1);
    assert.deepEqual(unaffected(after), unaffected(before)); assert.deepEqual(after.polygon, candidates[0].polygon); assert.equal(after.source, 'manual');
    assert.ok(pointInPolygon(after.dot, after.polygon)); assert.deepEqual(await entries(), evidence); assert.deepEqual(await row(OLD), other);
    assert.equal(result.applied['candidate-1'].unitId, A1); assert.equal(result.applied['candidate-1'].action, 'replaced');
  });
  await check('saved marker is retained when already inside the reviewed outline', async () => {
    await db.query('UPDATE evidence_plan_units SET dot=$1 WHERE id=$2', [JSON.stringify({ x: .2, y: .2 }), A1]);
    await changeArtifact(review => { review.existingUnits.find(unit => unit.id === A1).dot = { x: .2, y: .2 }; });
    await apply({ assignments: [assignment(1, A1)] }); assert.deepEqual((await row(A1)).dot, { x: .2, y: .2 });
  });
  await check('explicit creation keeps every old record and does not guess evidence links', async () => {
    const before = await rows(), evidence = await entries(); const result = await apply({ assignments: [assignment(3, null, { newUnitRef: 'C-NEW' })] });
    const created = await row(result.applied['candidate-3'].unitId);
    assert.equal(created.unit_ref, 'C-NEW'); assert.equal(created.tenant_name, 'Detected C1'); assert.equal(created.source, 'manual');
    assert.deepEqual((await rows()).filter(unit => unit.id !== created.id), before); assert.deepEqual(await entries(), evidence);
  });
  await check('explicitly clearing an old outline retains its unit, marker, facts and linked evidence', async () => {
    const before = await row(A1), evidence = await entries(); await apply({ assignments: [], clearOutlineUnitIds: [A1] }); const after = await row(A1);
    assert.deepEqual(unaffected(after), unaffected(before)); assert.equal(after.polygon, null); assert.deepEqual(after.dot, before.dot); assert.equal(after.source, 'manual'); assert.deepEqual(await entries(), evidence);
  });
  await check('current manual outlines cannot be replaced or cleared', async () => {
    await rejected({ assignments: [assignment(1, MANUAL)] }); await rejected({ assignments: [], clearOutlineUnitIds: [MANUAL] });
  });
  await check('stale source image prevents applying or clearing any proposal', async () => {
    await db.query("UPDATE evidence_plan_levels SET background_key='replacement.png' WHERE id=$1", [LEVEL]);
    await assert.rejects(() => readPlanScanReview(db, PLAN, { levelId: LEVEL }, allow), error => error.status === 409);
    await rejected({ assignments: [assignment(1, A1)], clearOutlineUnitIds: [OLD] });
  });
  for (const [name, sql, value] of [['reference', 'unit_ref', 'Changed reference'], ['tenant', 'tenant_name', 'Changed tenant'], ['polygon', 'polygon', JSON.stringify(box(.1, .1, .1, .1))], ['marker', 'dot', JSON.stringify({ x: .15, y: .15 })], ['source', 'source', 'import']]) {
    await check(`concurrent ${name} changes reject stale replacement without overwriting edits`, async () => {
      await db.query(`UPDATE evidence_plan_units SET ${sql}=$1 WHERE id=$2`, [value, A1]); await rejected({ assignments: [assignment(1, A1)] });
    });
  }
  await check('unrelated fact changes after scanning are retained when applying geometry', async () => {
    await db.query("UPDATE evidence_plan_units SET passing_rent=999, notes='Updated meanwhile' WHERE id=$1", [A1]);
    await apply({ assignments: [assignment(1, A1)] }); const unit = await row(A1); assert.equal(unit.passing_rent, '999'); assert.equal(unit.notes, 'Updated meanwhile');
  });
  await check('duplicate candidate, target and clear instructions are rejected atomically', async () => {
    await rejected({ assignments: [assignment(1, A1), assignment(1, A2)] }, 400);
    await rejected({ assignments: [assignment(1, A1), assignment(2, A1)] }, 400);
    await rejected({ assignments: [assignment(1, A1)], clearOutlineUnitIds: [A1] }, 400);
  });
  await check('creating a duplicate saved reference or duplicate references within a batch is rejected', async () => {
    await rejected({ assignments: [assignment(3, null, { newUnitRef: 'Unit A01' })] });
    await rejected({ assignments: [assignment(1, null, { newUnitRef: 'NEW1' }), assignment(2, null, { newUnitRef: 'NEW1' })] }, 400);
  });
  await check('overlapping proposed boundaries and collisions with manual geometry are rejected', async () => {
    await changeArtifact(review => { review.candidates[1].polygon = candidates[0].polygon; });
    await rejected({ assignments: [assignment(1, A1), assignment(2, A2)] });
    await changeArtifact(review => { review.candidates[0].polygon = box(.84, .79, .11, .11); });
    await rejected({ assignments: [assignment(1, A1)] });
  });
  await check('neighbouring proposals apply together despite old AI boxes overlapping them', async () => {
    await apply({ assignments: [assignment(1, A1), assignment(2, A2)] });
    assert.deepEqual((await row(A1)).polygon, candidates[0].polygon); assert.deepEqual((await row(A2)).polygon, candidates[1].polygon);
    assert.deepEqual((await row(OLD)).polygon, box(.05, .05, .85, .85));
  });
  await check('exact retries are idempotent, while changed target or new reference returns conflict', async () => {
    const request = { assignments: [assignment(1, A1), assignment(3, null, { newUnitRef: 'C-NEW' })], clearOutlineUnitIds: [OLD] };
    const first = await apply(request), before = await snapshot(); const second = await apply(request);
    assert.deepEqual(second.applied, first.applied); assert.equal(await snapshot(), before);
    await rejected({ assignments: [assignment(1, A2)] }); await rejected({ assignments: [assignment(3, null, { newUnitRef: 'OTHER' })] });
  });
  await check('concurrent identical apply requests create one unit and return the same identity', async () => {
    const request = { assignments: [assignment(3, null, { newUnitRef: 'C-NEW' })] };
    const result = await Promise.all([apply(request), apply(request), apply(request)]);
    assert.equal(new Set(result.map(item => item.applied['candidate-3'].unitId)).size, 1); assert.equal((await rows()).filter(unit => unit.unit_ref === 'C-NEW').length, 1);
  });
  await check('artifact write failure rolls back proposed geometry and clearing together', async () => {
    const before = await snapshot(); const broken = { ...db, connect: async () => { const client = await db.connect(); return { query: (sql, values) => { if (sql.startsWith('INSERT INTO file_storage')) throw new Error('Synthetic artifact write failure'); return client.query(sql, values); }, release: () => client.release() }; } };
    await assert.rejects(() => applyPlanScanReview(broken, PLAN, JOB, { assignments: [assignment(1, A1)], clearOutlineUnitIds: [OLD] }, allow, normaliseUnitRef), /Synthetic artifact write failure/);
    assert.equal(await snapshot(), before);
  });
  await check('scope checks, foreign jobs and legacy results are enforced', async () => {
    await assert.rejects(() => readPlanScanReview(db, PLAN, { levelId: LEVEL }, async () => false), error => error.status === 403);
    await assert.rejects(() => applyPlanScanReview(db, PLAN, JOB, { assignments: [assignment(1, A1)] }, async () => false, normaliseUnitRef), error => error.status === 403);
    await db.query('DELETE FROM file_storage'); const result = await readPlanScanReview(db, PLAN, { levelId: LEVEL }, allow); assert.equal(result.legacyNeedsRescan, true); assert.equal(result.review, null);
    await rejected({ assignments: [assignment(1, A1)] });
  });
  await check('a unit moved to another level or removed cannot receive a stale proposal', async () => {
    await db.query('UPDATE evidence_plan_units SET level_id=$1 WHERE id=$2', [id(99), A1]);
    await rejected({ assignments: [assignment(1, A1)] });
    await db.query('DELETE FROM evidence_plan_units WHERE id=$1', [A2]);
    await rejected({ assignments: [assignment(2, A2)] });
  });
  await check('incomplete jobs and corrupt stored artifacts never apply geometry', async () => {
    await db.query("UPDATE evidence_plan_jobs SET status='running' WHERE id=$1", [JOB]);
    await rejected({ assignments: [assignment(1, A1)] });
    await db.query("UPDATE evidence_plan_jobs SET status='done' WHERE id=$1", [JOB]);
    await db.query('UPDATE file_storage SET data=$1 WHERE storage_key=$2', [Buffer.from('{broken'), planScanReviewKey(PLAN, JOB)]);
    await rejected({ assignments: [assignment(1, A1)] });
  });
  console.log(`PASS ${checks} PostgreSQL scan-review checks`);
} finally { try { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await db.end(); } }
