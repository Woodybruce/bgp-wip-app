// Real transaction/concurrency checks using only the disposable audit database.
// EVIDENCE_PLAN_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' node --import tsx qa/regression/evidence-plan-detection-postgres.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';
import sharp from 'sharp';
import * as detection from '../../server/plan-unit-detection.ts';
import * as geometry from '../../shared/plan-geometry.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const supplied = process.env.EVIDENCE_PLAN_DATABASE_URL;
if (!supplied) throw new Error('Provide EVIDENCE_PLAN_DATABASE_URL for the disposable audit database');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_crm_directory_regression' || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) throw new Error('Refusing non-disposable database');
const schema = `qa_evidence_detection_${process.pid}_${Date.now()}`;
const db = new pg.Pool({ connectionString: supplied, ssl: false, max: 8, options: `-c search_path=${schema}` });
const declaration = name => find('server/evidence-plan.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const { start } = evaluate(declaration('startDetectJob') + '\nexports.start = startDetectJob;', { pool: db });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const planId = id(1), levelId = id(2);
const raw = Buffer.alloc(240 * 180 * 3, 255);
for (let y = 20; y < 120; y++) for (let x = 20; x < 90; x++) {
  const i = (y * 240 + x) * 3; raw[i] = 110; raw[i + 1] = 190; raw[i + 2] = 185;
}
const png = await sharp(raw, { raw: { width: 240, height: 180, channels: 3 } }).png().toBuffer();
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
async function runWorker(jobId, expireAtSave = false) {
  let tiles = 0;
  const workerPool = {
    query: (sql, values) => db.query(sql, values),
    connect: async () => {
      const client = await db.connect();
      return { query: async (sql, values) => {
        const result = await client.query(sql, values);
        if (expireAtSave && sql.startsWith('SELECT background_key')) {
          await db.query("UPDATE evidence_plan_jobs SET status = 'error', error = 'Expired by a concurrent request' WHERE id = $1", [jobId]);
        }
        return result;
      }, release: () => client.release() };
    },
  };
  const { run } = evaluate(declaration('runDetectJob') + '\nexports.run = runDetectJob;', {
    pool: workerPool, setInterval, clearInterval,
    getFile: async () => ({ data: png }),
    detectTile: async () => tiles++ === 0 ? [{ unitRef: 'A1', tenant: 'Synthetic Shop', seed: { x: .2, y: .35 }, polygon: null }] : [],
    normaliseUnitRef: value => String(value).trim().toUpperCase(), normTenantName: value => String(value || '').toUpperCase(),
    relinkAllEntries: async (plan, connection) => {
      const result = await connection.query(`UPDATE evidence_plan_entries SET unit_id = (SELECT id FROM evidence_plan_units WHERE plan_id = $1 LIMIT 1) WHERE plan_id = $1 AND unit_id IS NULL`, [plan]);
      return result.rowCount;
    },
    require: name => {
      if (name === 'sharp') return { default: sharp };
      if (name === './plan-unit-detection') return detection;
      if (name === '@shared/plan-geometry') return geometry;
      throw new Error(`Unexpected module ${name}`);
    },
  });
  await run(planId, jobId, { id: levelId, background_key: 'synthetic-plan' }, null, true);
}
try {
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`
    CREATE TABLE evidence_plans (id uuid PRIMARY KEY, updated_at timestamptz DEFAULT now());
    CREATE TABLE evidence_plan_levels (id uuid PRIMARY KEY, plan_id uuid, background_key text);
    CREATE TABLE evidence_plan_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid, level_id uuid, kind text,
      status text DEFAULT 'running', total_docs int DEFAULT 0, done_docs int DEFAULT 0, created int DEFAULT 0,
      extracted int DEFAULT 0, linked int DEFAULT 0, error text, created_by varchar,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE evidence_plan_units (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid, level_id uuid,
      unit_ref text, tenant_name text, polygon jsonb, dot jsonb, source text);
    CREATE TABLE evidence_plan_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid, unit_ref text, unit_id uuid);
  `);
  await db.query('INSERT INTO evidence_plans (id) VALUES ($1)', [planId]);
  await db.query('INSERT INTO evidence_plan_levels VALUES ($1, $2, $3)', [levelId, planId, 'synthetic-plan']);
  await db.query("INSERT INTO evidence_plan_entries (plan_id, unit_ref) VALUES ($1, 'A1')", [planId]);
  const concurrent = await Promise.all(Array.from({ length: 12 }, () => start(planId, levelId, 'test-user')));
  check('12 simultaneous start requests create exactly one job', () => {
    assert.equal(new Set(concurrent.map(row => row.jobId)).size, 1);
    assert.equal(concurrent.filter(row => !row.reused).length, 1);
  });
  const firstId = concurrent[0].jobId;
  await db.query("UPDATE evidence_plan_jobs SET updated_at = now() - interval '4 minutes' WHERE id = $1", [firstId]);
  const replacement = await start(planId, levelId, 'test-user');
  const first = (await db.query('SELECT * FROM evidence_plan_jobs WHERE id = $1', [firstId])).rows[0];
  check('stale jobs expire before a replacement starts', () => {
    assert.equal(first.status, 'error'); assert.notEqual(replacement.jobId, firstId); assert.equal(replacement.reused, false);
  });
  await runWorker(firstId);
  const countAfterOld = (await db.query('SELECT count(*)::int AS n FROM evidence_plan_units')).rows[0].n;
  check('an already expired worker cannot revive itself or write geometry', () => assert.equal(countAfterOld, 0));
  await db.query("UPDATE evidence_plan_jobs SET created_at = now() - interval '31 minutes', updated_at = now() WHERE id = $1", [replacement.jobId]);
  const fresh = await start(planId, levelId, 'test-user');
  const deadline = (await db.query('SELECT status FROM evidence_plan_jobs WHERE id = $1', [replacement.jobId])).rows[0];
  check('hard expiry stops a job even while its heartbeat is fresh', () => { assert.equal(deadline.status, 'error'); assert.notEqual(fresh.jobId, replacement.jobId); });
  await runWorker(fresh.jobId, true);
  const raceUnits = (await db.query('SELECT count(*)::int AS n FROM evidence_plan_units')).rows[0].n;
  const raceEntry = (await db.query('SELECT unit_id FROM evidence_plan_entries')).rows[0];
  const raceJob = (await db.query('SELECT * FROM evidence_plan_jobs WHERE id = $1', [fresh.jobId])).rows[0];
  check('expiry between the last heartbeat and save aborts the actual transaction', () => {
    assert.equal(raceUnits, 0); assert.equal(raceEntry.unit_id, null); assert.equal(raceJob.status, 'error'); assert.equal(raceJob.error, 'Expired by a concurrent request');
  });
  const success = await start(planId, levelId, 'test-user');
  await runWorker(success.jobId);
  const finished = (await db.query('SELECT * FROM evidence_plan_jobs WHERE id = $1', [success.jobId])).rows[0];
  const unit = (await db.query('SELECT * FROM evidence_plan_units')).rows[0];
  const entry = (await db.query('SELECT * FROM evidence_plan_entries')).rows[0];
  check('verified geometry, evidence link and completion counters persist together', () => {
    assert.equal(finished.status, 'done'); assert.equal(finished.total_docs, 10); assert.equal(finished.done_docs, 10);
    assert.equal(finished.created, 1); assert.equal(finished.linked, 1); assert.equal(entry.unit_id, unit.id);
  });
  const completeBefore = JSON.stringify(finished);
  await runWorker(success.jobId);
  const completeAfter = (await db.query('SELECT * FROM evidence_plan_jobs WHERE id = $1', [success.jobId])).rows[0];
  check('a duplicate worker cannot rewrite completed job data', () => assert.equal(JSON.stringify(completeAfter), completeBefore));
  console.log(`PASS ${checks} PostgreSQL detection concurrency checks`);
} finally {
  try { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await db.end(); }
}
