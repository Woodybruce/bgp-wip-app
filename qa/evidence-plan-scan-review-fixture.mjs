// Create or remove ONLY this synthetic local browser fixture. No app server or provider requests.
// EVIDENCE_SMOKE_DATABASE_URL='postgresql:///bgp_smoke?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' node --import tsx qa/evidence-plan-scan-review-fixture.mjs [--cleanup]
import assert from 'node:assert/strict';
import pg from 'pg';
import sharp from 'sharp';
import { buildPlanScanReview, persistPlanScanReview, planScanReviewKey } from '../server/plan-scan-review.ts';
const supplied = process.env.EVIDENCE_SMOKE_DATABASE_URL;
if (!supplied) throw new Error('Provide the disposable EVIDENCE_SMOKE_DATABASE_URL');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_smoke' || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) throw new Error('Refusing non-disposable database');
const id = n => `ecd09077-0907-4000-8000-${String(n).padStart(12, '0')}`;
const PLAN = id(1), LEVEL = id(2), JOB = id(3), A1 = id(11), A2 = id(12), OLD = id(13), MANUAL = id(14), ENTRY = id(21);
const FILE = `qa/evidence-plan-${PLAN}/synthetic-review.png`, REVIEW = planScanReviewKey(PLAN, JOB);
const box = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const candidate = (n, ref, polygon, suggested = []) => ({ id: `candidate-${n}`, unitRef: ref, tenantName: `Detected shop ${ref}`, polygon,
  dot: { x: (polygon[0].x + polygon[2].x) / 2, y: (polygon[0].y + polygon[2].y) / 2 }, status: 'review', unitId: null, suggestedUnitIds: suggested, reason: 'The detected boundary overlaps an old AI outline. Choose the correct saved unit.' });
const candidates = [candidate(1, 'A1', box(.1, .15, .2, .4), [A1]), candidate(2, 'A2', box(.35, .15, .2, .4), [A2]), candidate(3, 'C1', box(.65, .15, .15, .4))];
const db = new pg.Client({ connectionString: supplied, ssl: false });
await db.connect();
try {
  await db.query('BEGIN');
  if (process.argv.includes('--cleanup')) {
    const existing = (await db.query('SELECT name FROM evidence_plans WHERE id=$1', [PLAN])).rows[0];
    if (existing) assert.equal(existing.name, 'QA scan review fixture', 'Refusing unexpected record');
    for (const table of ['evidence_plan_entries', 'evidence_plan_units', 'evidence_plan_jobs', 'evidence_plan_levels']) await db.query(`DELETE FROM ${table} WHERE plan_id=$1`, [PLAN]);
    await db.query('DELETE FROM evidence_plans WHERE id=$1', [PLAN]);
    await db.query('DELETE FROM file_storage WHERE storage_key=ANY($1::text[])', [[FILE, REVIEW]]);
    await db.query('COMMIT'); console.log('Synthetic scan-review fixture removed');
  } else {
    assert.equal((await db.query('SELECT id FROM evidence_plans WHERE id=$1', [PLAN])).rows.length, 0, 'Fixture already exists: clean it up first');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#fff"/><text x="60" y="65" font-size="30" font-family="Arial">Synthetic plan — scan review QA</text>${candidates.map(c => `<rect x="${c.polygon[0].x*1200}" y="${c.polygon[0].y*800}" width="${(c.polygon[1].x-c.polygon[0].x)*1200}" height="${(c.polygon[2].y-c.polygon[0].y)*800}" fill="#7cbebb" stroke="#333" stroke-width="3"/><text x="${c.dot.x*1200}" y="${c.dot.y*800}" text-anchor="middle" font-family="Arial" font-size="36">${c.unitRef}</text>`).join('')}<rect x="1020" y="640" width="120" height="80" fill="#afcae4" stroke="#333"/><text x="1080" y="690" text-anchor="middle" font-family="Arial" font-size="24">M1</text></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    await db.query('INSERT INTO file_storage(storage_key,data,content_type,original_name,size) VALUES ($1,$2,$3,$4,$5)', [FILE, png, 'image/png', 'synthetic-review.png', png.length]);
    await db.query('INSERT INTO evidence_plans(id,name,background_key,background_width,background_height) VALUES ($1,$2,$3,1200,800)', [PLAN, 'QA scan review fixture', FILE]);
    await db.query('INSERT INTO evidence_plan_levels(id,plan_id,name,background_key,background_width,background_height) VALUES ($1,$2,$3,$4,1200,800)', [LEVEL, PLAN, 'Ground floor', FILE]);
    for (const [unitId, ref, polygon, source] of [[A1,'A1',box(.4,.4,.25,.4),'ai'], [A2,'A2',box(.2,.2,.3,.4),'ai'], [OLD,'Legacy broad box',box(.05,.1,.85,.8),'ai'], [MANUAL,'M1',box(.85,.8,.1,.1),'manual']]) {
      await db.query(`INSERT INTO evidence_plan_units(id,plan_id,level_id,unit_ref,tenant_name,polygon,dot,source,passing_rent,notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,120000,'Synthetic saved facts — keep')`, [unitId,PLAN,LEVEL,ref,`Saved shop ${ref}`,JSON.stringify(polygon),JSON.stringify({ x: polygon[0].x+.02, y: polygon[0].y+.02 }),source]);
    }
    await db.query('INSERT INTO evidence_plan_entries(id,plan_id,unit_id,unit_ref,tenant,transaction_type,zone_a,notes) VALUES ($1,$2,$3,$4,$5,$6,220,$7)', [ENTRY,PLAN,A1,'A1','Original evidence tenant','OML','Synthetic evidence — preserve']);
    await db.query("INSERT INTO evidence_plan_jobs(id,plan_id,level_id,kind,status,total_docs,done_docs,extracted,created,error) VALUES ($1,$2,$3,'detect','done',1,1,3,0,'3 detected outlines need review')", [JOB,PLAN,LEVEL]);
    const units = (await db.query('SELECT * FROM evidence_plan_units WHERE plan_id=$1 ORDER BY id', [PLAN])).rows;
    await persistPlanScanReview(db, buildPlanScanReview({ planId: PLAN, levelId: LEVEL, jobId: JOB, backgroundKey: FILE, candidates, existingUnits: units }));
    await db.query('COMMIT');
    console.log(JSON.stringify({ planId: PLAN, levelId: LEVEL, jobId: JOB, units: { a1: A1, a2: A2, old: OLD, manual: MANUAL }, entryId: ENTRY, path: `/evidence-plans/${PLAN}`, provenance: 'Synthetic geometry, names and facts only; no live plan cloned; no provider calls' }, null, 2));
  }
} catch (error) { await db.query('ROLLBACK'); throw error; } finally { await db.end(); }
