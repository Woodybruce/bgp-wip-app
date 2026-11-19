// Clearing the offers the 14 August 2026 email import left on the Letting
// Tracker (Woody, 19 November 2026: an admin Preview then Apply): the source
// guards need no database; the SQL runs for real in a throwaway schema of a
// local disposable database. After `bash qa/start-postgres.sh`:
// EMAIL_OFFER_CLEANUP_DATABASE_URL='postgresql://postgres:qa-local-pg@127.0.0.1:5432/postgres' node --import tsx --test qa/regression/email-offer-cleanup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { IMPORT_COMMENT_PREFIX, IMPORT_KEY_PREFIX } from '../../shared/email-offer-cleanup.ts';
import {
  BATCH_PREFIX, DRY_RUN_KEY, OFFER_LOCK_PREFIX, RUNS_KEY,
  applyEmailOfferCleanup, emailOfferCleanupRuns, previewEmailOfferCleanup, undoEmailOfferCleanup,
} from '../../server/email-offer-cleanup.ts';

const source = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const supplied = process.env.EMAIL_OFFER_CLEANUP_DATABASE_URL;
const skip = supplied ? false : 'Provide EMAIL_OFFER_CLEANUP_DATABASE_URL (a local disposable database) to run';

test('the rule reads exactly the comment and key the import wrote', () => {
  const sync = source('server/viewing-sync.ts');
  const fn = sync.slice(sync.indexOf('export async function backfillActivityFromInteractions'));
  assert.match(fn, /`Backfilled from synced email: "\$\{row\.subject \|\| ""\}" — figures need confirming\.`, `int_\$\{row\.id\}`\]/);
  assert.equal(IMPORT_COMMENT_PREFIX, 'Backfilled from synced email: ');
  assert.equal(IMPORT_KEY_PREFIX, 'int_');
  // The live inbox sweep never writes the import's key.
  const sweep = sync.slice(sync.indexOf('export async function syncOfferEmails'), sync.indexOf('export function looksLikeInterest'));
  assert.match(sweep, /const convKey = msg\.conversationId \? `conv_\$\{msg\.conversationId\}` : `msg_\$\{msg\.id\}`;/);
});

test('the one-off import stays uncalled, so nothing puts the cleared rows back', () => {
  const callers = [];
  for (const dir of ['server', 'shared', 'script']) {
    for (const file of readdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true })) {
      if (!/\.(ts|tsx|mjs|cjs|js)$/.test(file)) continue;
      const text = source(`${dir}/${file}`);
      if (text.includes('backfillActivityFromInteractions(') && !text.includes('export async function backfillActivityFromInteractions(')) callers.push(`${dir}/${file}`);
    }
  }
  assert.deepEqual(callers, []);
});

test('admin only, mounted once, and never run at boot or on a timer', () => {
  const mod = source('server/email-offer-cleanup.ts');
  for (const route of ['app.get("/api/admin/email-offer-cleanup/runs", requireAuth, requireAdmin,',
    'app.post("/api/admin/email-offer-cleanup", requireAuth, requireAdmin,',
    'app.post("/api/admin/email-offer-cleanup/undo", requireAuth, requireAdmin,']) {
    assert.ok(mod.includes(route), route);
  }
  assert.equal((mod.match(/app\.(get|post|put|patch|delete)\(/g) || []).length, 3, 'no other route');
  const index = source('server/index.ts');
  assert.match(index, /registerEmailOfferCleanupRoutes\(app, \{ pool, requireAuth, requireAdmin \}\);/);
  // Apply and undo are reached only through those routes.
  for (const dir of ['server', 'shared']) {
    for (const file of readdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true })) {
      if (!/\.ts$/.test(file) || file === 'email-offer-cleanup.ts') continue;
      const text = source(`${dir}/${file}`);
      assert.ok(!/applyEmailOfferCleanup|undoEmailOfferCleanup/.test(text), `${dir}/${file} calls the clean-up`);
    }
  }
  assert.doesNotMatch(mod, /setInterval|setTimeout|cron/i);
});

test('the clean-up takes the negotiation log\'s own lock on each offer', () => {
  assert.equal(OFFER_LOCK_PREFIX, 'unit_offer:');
  assert.match(source('server/unit-negotiation.ts'), /const offerLockKey = \(offerId: string\) => `unit_offer:\$\{offerId\}`;/);
});

test('apply deletes and records each row in one statement, inside a transaction per unit', () => {
  const mod = source('server/email-offer-cleanup.ts');
  const apply = mod.slice(mod.indexOf('export async function applyEmailOfferCleanup'), mod.indexOf('export async function undoEmailOfferCleanup'));
  assert.match(apply, /if \(!opts\.by \|\| dry\.by !== opts\.by \|\| opts\.previewedAt !== dry\.at\)/);
  assert.match(apply, /Date\.now\(\) - new Date\(dry\.at\)\.getTime\(\) > DRY_RUN_TTL_MS/);
  const begin = apply.indexOf('await client.query("BEGIN");');
  const commit = apply.indexOf('await client.query("COMMIT");');
  const offers = apply.indexOf('WITH gone AS (DELETE FROM unit_offers WHERE id = ANY($1::varchar[]) RETURNING *)');
  const rounds = apply.indexOf('WITH gone AS (DELETE FROM unit_offer_rounds WHERE offer_id = ANY($1::varchar[]) RETURNING *)');
  assert.ok(begin > 0 && begin < rounds && rounds < offers && offers < commit, 'BEGIN, rounds, offers, COMMIT');
  assert.equal((apply.match(/INSERT INTO investment_comp_migration_log/g) || []).length, 2);
  // Re-read under the lock, and only what the rule still clears goes.
  assert.ok(apply.indexOf('FOR UPDATE') > apply.indexOf('pg_advisory_xact_lock'));
  assert.match(apply, /if \(!mayClear\(verdict\.group\)\)/);
  assert.doesNotMatch(apply, /DELETE FROM unit_offers WHERE (?!id = ANY\(\$1::varchar\[\]\))/);
});

test('the panel sits with the other letting repairs in Settings, and ChatBGP knows where', () => {
  const settings = source('client/src/pages/settings.tsx');
  const backfills = settings.slice(settings.indexOf('data-testid="section-letting-backfills"'));
  assert.ok(backfills.indexOf('<EmailOfferCleanupPanel />') > 0);
  assert.ok(backfills.indexOf('<EmailOfferCleanupPanel />') < backfills.indexOf('</CardContent>'));
  assert.match(source('server/chatbgp-app-map.ts'), /Offers from the 14 August email import/);
});

// ---------------------------------------------------------------------------
// The SQL, for real.

const COMMENT = subject => `Backfilled from synced email: "${subject}" — figures need confirming.`;

async function schemaPool(withOptional = true) {
  if (!['', 'localhost', '127.0.0.1'].includes(new URL(supplied).hostname)) throw new Error('Refusing a database that is not local');
  const schema = `eoc_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Pool({ connectionString: supplied, ssl: false, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: supplied, ssl: false, max: 4, options: `-c search_path=${schema}` });
  const run = (sql, params = []) => pool.query(sql, params);
  await run(`CREATE TABLE system_settings (key text PRIMARY KEY, value jsonb, updated_at timestamp)`);
  await run(`CREATE TABLE users (id varchar PRIMARY KEY, name text, email text, username text)`);
  await run(`CREATE TABLE crm_properties (id varchar PRIMARY KEY, name text)`);
  await run(`CREATE TABLE crm_companies (id varchar PRIMARY KEY, name text, company_type text)`);
  await run(`CREATE TABLE available_units (id varchar PRIMARY KEY, unit_name text, property_id varchar${withOptional ? ', hots_offer_id varchar' : ''})`);
  await run(`CREATE TABLE unit_offers (
    id varchar PRIMARY KEY, unit_id varchar NOT NULL, company_name text, contact_name text, contact_id varchar, company_id varchar,
    offer_date text NOT NULL, rent_pa real, rent_free_months real, term_years real, break_option text, incentives text, premium real,
    fitting_out_contribution real, status text DEFAULT 'Pending', comments text, source text, email_conversation_id text,
    viewing_id varchar, confirmed_at timestamptz, rent_review text, rent_deposit text, turnover_rent_pct real,
    updated_at timestamp, created_at timestamp DEFAULT now(), agreed_at timestamp, agreed_by_user_id varchar, agreed_by_name text)`);
  await run(`CREATE UNIQUE INDEX unit_offers_email_conversation_idx ON unit_offers (email_conversation_id) WHERE email_conversation_id IS NOT NULL`);
  if (withOptional) {
    await run(`CREATE TABLE unit_offer_rounds (
      id varchar PRIMARY KEY, offer_id varchar NOT NULL, unit_id varchar NOT NULL, round_no integer NOT NULL, party text NOT NULL,
      round_date text NOT NULL, rent_pa real, rent_free_months real, term_years real, break_option text, incentives text, premium real,
      fitting_out_contribution real, rent_review text, rent_deposit text, turnover_rent_pct real, note text,
      created_by_user_id varchar, created_by_name text, created_at timestamp DEFAULT now(), updated_at timestamp)`);
    await run(`CREATE TABLE unit_recommendations (id varchar PRIMARY KEY, unit_id varchar, offer_id varchar)`);
    await run(`CREATE TABLE letting_suggestions (id varchar PRIMARY KEY, record_kind text, record_id varchar)`);
  }
  await run(`CREATE TABLE investment_comp_migration_log (
    id SERIAL PRIMARY KEY, batch TEXT NOT NULL, table_name TEXT NOT NULL, record_id VARCHAR NOT NULL, action TEXT NOT NULL,
    prior JSONB, tracker_id VARCHAR, note TEXT, created_at TIMESTAMP NOT NULL DEFAULT now())`);
  await run(`INSERT INTO users (id, name, email) VALUES ('u-admin', 'Ada Admin', 'ada@example.test'), ('u-other', 'Otto Other', 'otto@example.test')`);
  await run(`INSERT INTO crm_properties (id, name) VALUES ('p1', 'Cathedral Walk'), ('p2', 'Kilburn Station')`);
  await run(`INSERT INTO crm_companies (id, name, company_type) VALUES ('c-landsec', 'Landsec', 'Landlord'), ('c-brand', 'Krispy Kreme', 'Tenant - Restaurant')`);
  await run(`INSERT INTO available_units (id, unit_name, property_id) VALUES ('au1', 'Unit 4', 'p1'), ('au2', 'Kiosk', 'p2')`);
  const offer = (id, unit, over = {}) => {
    const row = {
      id, unit_id: unit, company_name: null, company_id: null, offer_date: '2026-07-06', status: 'Pending',
      comments: COMMENT(`RE: ${id} offer`), source: 'email', email_conversation_id: `int_${id}`, created_at: '2026-08-14 10:00:00', ...over,
    };
    const cols = Object.keys(row);
    return run(`INSERT INTO unit_offers (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map(c => row[c]));
  };
  const drop = async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  };
  return { pool, run, offer, drop };
}

test('preview, apply and undo, for real', { skip }, async () => {
  const { pool, run, offer, drop } = await schemaPool();
  try {
    await offer('o1', 'au1');
    await run(`INSERT INTO unit_offer_rounds (id, offer_id, unit_id, round_no, party, round_date, created_at) VALUES ('r1', 'o1', 'au1', 1, 'tenant', '2026-07-06', '2026-08-14 10:00:00')`);
    await offer('o2', 'au1', { company_name: 'Landsec', company_id: 'c-landsec' });
    await offer('o3', 'au2', { company_name: 'Krispy Kreme', company_id: 'c-brand' });
    await offer('o4', 'au1', { status: 'Rejected' });
    await offer('o5', 'au1');
    await run(`INSERT INTO unit_offer_rounds (id, offer_id, unit_id, round_no, party, round_date) VALUES ('r5a', 'o5', 'au1', 1, 'tenant', '2026-07-06'),
      ('r5b', 'o5', 'au1', 2, 'landlord', '2026-09-01')`);
    await run(`UPDATE unit_offer_rounds SET created_by_user_id = 'u-admin', created_by_name = 'Ada Admin' WHERE id = 'r5b'`);
    await offer('o6', 'au1', { rent_pa: 95000 });
    await offer('o-hots', 'au2');
    await run(`UPDATE available_units SET hots_offer_id = 'o-hots' WHERE id = 'au2'`);
    await offer('o-rec', 'au2');
    await run(`INSERT INTO unit_recommendations (id, unit_id, offer_id) VALUES ('rec1', 'au2', 'o-rec')`);
    await offer('o-sug', 'au2');
    await run(`INSERT INTO letting_suggestions (id, record_kind, record_id) VALUES ('s1', 'offer', 'o-sug')`);
    await offer('o-orphan', 'gone-unit');
    // Not the import's: never listed, and they stay.
    await offer('o-sweep', 'au1', { comments: "Detected in peter@example.test's inbox: \"Offer\"", email_conversation_id: 'conv_abc' });
    await offer('o-manual', 'au1', { source: null, email_conversation_id: null, comments: 'Starbucks £95k, 10 years', rent_pa: 95000 });

    const before = (await run(`SELECT to_jsonb(o) AS row FROM unit_offers o WHERE id = 'o1'`)).rows[0].row;
    const beforeRound = (await run(`SELECT to_jsonb(r) AS row FROM unit_offer_rounds r WHERE id = 'r1'`)).rows[0].row;

    const preview = await previewEmailOfferCleanup(pool, { by: 'u-admin' });
    assert.deepEqual(preview.counts, { offers: 10, units: 3, clear: 3, brand: 1, kept: 6 });
    const unit = id => preview.units.find(u => u.unitId === id);
    assert.deepEqual(unit('au1').counts, { clear: 2, brand: 0, kept: 3 });
    assert.equal(unit('au1').otherOffers, 2, 'the sweep row and the person\'s offer stay');
    assert.equal(unit('au1').propertyName, 'Cathedral Walk');
    assert.equal(unit('gone-unit').onTracker, false);
    const row = id => preview.units.flatMap(u => u.rows).find(r => r.id === id);
    assert.equal(row('o1').subject, 'RE: o1 offer');
    assert.equal(row('o3').group, 'brand');
    assert.deepEqual(row('o4').keptBecause, ['status is Rejected']);
    assert.deepEqual(row('o5').keptBecause, ['negotiation logged']);
    assert.deepEqual(row('o6').keptBecause, ['terms entered']);
    assert.deepEqual(row('o-hots').keptBecause, ["the unit's Heads of Terms name it"]);
    assert.deepEqual(row('o-rec').keptBecause, ['a recommendation names it']);
    assert.deepEqual(row('o-sug').keptBecause, ['logged from a comment']);
    assert.equal(row('o-sweep'), undefined);
    const dry = (await run(`SELECT value FROM system_settings WHERE key = $1`, [DRY_RUN_KEY])).rows[0].value;
    assert.deepEqual(Object.keys(dry.ids).sort(), ['o-orphan', 'o1', 'o2', 'o3']);

    // Refused: another preview, another admin, nothing ticked.
    await assert.rejects(applyEmailOfferCleanup(pool, { by: 'u-admin', ids: ['o1'], previewedAt: '2026-01-01T00:00:00.000Z' }), e => e.status === 409);
    await assert.rejects(applyEmailOfferCleanup(pool, { by: 'u-other', ids: ['o1'], previewedAt: preview.previewedAt }), e => e.status === 409);
    await assert.rejects(applyEmailOfferCleanup(pool, { by: 'u-admin', ids: [], previewedAt: preview.previewedAt }), e => e.status === 400);

    // A person works on o2 after the preview: it is left.
    await run(`UPDATE unit_offers SET status = 'Negotiating', updated_at = now() WHERE id = 'o2'`);
    const out = await applyEmailOfferCleanup(pool, { by: 'u-admin', ids: ['o1', 'o2', 'o3', 'o4', 'o-orphan', 'nope'], previewedAt: preview.previewedAt });
    assert.ok(out.batch.startsWith(BATCH_PREFIX));
    assert.deepEqual(out.counts, { deleted: 3, rounds: 1, units: 3, skipped: 1, notPreviewed: 2, failed: 0 });
    assert.equal(out.byName, 'Ada Admin');
    assert.deepEqual(out.skipped, [{ id: 'o2', reason: 'status is Negotiating, saved since the import' }]);
    const left = (await run(`SELECT id FROM unit_offers ORDER BY id`)).rows.map(r => r.id);
    assert.deepEqual(left, ['o-hots', 'o-manual', 'o-rec', 'o-sug', 'o-sweep', 'o2', 'o4', 'o5', 'o6']);
    assert.deepEqual((await run(`SELECT id FROM unit_offer_rounds ORDER BY id`)).rows.map(r => r.id), ['r5a', 'r5b']);
    const log = (await run(`SELECT table_name, record_id, action, prior FROM investment_comp_migration_log WHERE batch = $1 ORDER BY table_name, record_id`, [out.batch])).rows;
    assert.deepEqual(log.map(l => [l.table_name, l.record_id, l.action]), [
      ['unit_offer_rounds', 'r1', 'deleted'], ['unit_offers', 'o-orphan', 'deleted'], ['unit_offers', 'o1', 'deleted'], ['unit_offers', 'o3', 'deleted'],
    ]);
    assert.deepEqual(log.find(l => l.record_id === 'o1').prior, before, 'the whole row is recorded');
    // The preview is used up; the run is recorded.
    await assert.rejects(applyEmailOfferCleanup(pool, { by: 'u-admin', ids: ['o2'], previewedAt: preview.previewedAt }), e => e.status === 409);
    assert.equal((await run(`SELECT 1 FROM system_settings WHERE key = $1`, [DRY_RUN_KEY])).rows.length, 0);
    assert.equal((await emailOfferCleanupRuns(pool))[0].batch, out.batch);

    // Undo: o3's email key has been taken since, and o-orphan's unit is gone.
    await offer('o-new', 'au2', { email_conversation_id: 'int_o3' });
    await assert.rejects(undoEmailOfferCleanup(pool, { batch: 'something-else', by: 'u-admin' }), e => e.status === 400);
    await assert.rejects(undoEmailOfferCleanup(pool, { batch: `${BATCH_PREFIX}2020-01-01T00:00:00.000Z`, by: 'u-admin' }), e => e.status === 404);
    const undo = await undoEmailOfferCleanup(pool, { batch: out.batch, by: 'u-admin' });
    assert.deepEqual(undo.counts, { restored: 1, rounds: 1, notRestored: 2 });
    assert.deepEqual((await run(`SELECT to_jsonb(o) AS row FROM unit_offers o WHERE id = 'o1'`)).rows[0].row, before, 'put back exactly');
    assert.deepEqual((await run(`SELECT to_jsonb(r) AS row FROM unit_offer_rounds r WHERE id = 'r1'`)).rows[0].row, beforeRound);
    const runs = await emailOfferCleanupRuns(pool);
    assert.equal(runs[0].kind, 'undo');
    assert.equal(runs[0].undoOf, out.batch);
    assert.ok(runs[1].undoneAt);
    const runsSetting = (await run(`SELECT value FROM system_settings WHERE key = $1`, [RUNS_KEY])).rows[0].value;
    assert.equal(runsSetting.length, 2);
    // A second undo finds nothing to put back.
    assert.deepEqual((await undoEmailOfferCleanup(pool, { batch: out.batch, by: 'u-admin' })).counts, { restored: 0, rounds: 0, notRestored: 3 });
  } finally {
    await drop();
  }
});

test('an offer someone is logging a position on is waited for, then left', { skip }, async () => {
  const { pool, offer, drop } = await schemaPool();
  try {
    await offer('o1', 'au1');
    await offer('o2', 'au1');
    const preview = await previewEmailOfferCleanup(pool, { by: 'u-admin' });
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['unit_offer:o1']);
    let settled = false;
    const applying = applyEmailOfferCleanup(pool, { by: 'u-admin', ids: ['o1', 'o2'], previewedAt: preview.previewedAt }).finally(() => { settled = true; });
    await new Promise(r => setTimeout(r, 400));
    assert.equal(settled, false, 'apply waits for the negotiation log');
    await blocker.query(`INSERT INTO unit_offer_rounds (id, offer_id, unit_id, round_no, party, round_date, created_by_user_id, created_by_name)
      VALUES ('rp', 'o1', 'au1', 1, 'tenant', '2026-07-06', 'u-other', 'Otto Other')`);
    await blocker.query('COMMIT');
    blocker.release();
    const out = await applying;
    assert.deepEqual(out.counts, { deleted: 1, rounds: 0, units: 1, skipped: 1, notPreviewed: 0, failed: 0 });
    assert.deepEqual(out.skipped, [{ id: 'o1', reason: 'negotiation logged' }]);
    assert.deepEqual((await pool.query(`SELECT id FROM unit_offers`)).rows.map(r => r.id), ['o1']);
  } finally {
    await drop();
  }
});

test('a database without the rounds, recommendations or suggestions tables still previews and applies', { skip }, async () => {
  const { pool, offer, drop } = await schemaPool(false);
  try {
    await offer('o1', 'au1');
    await offer('o2', 'au1', { status: 'Withdrawn' });
    const preview = await previewEmailOfferCleanup(pool, { by: 'u-admin' });
    assert.deepEqual(preview.counts, { offers: 2, units: 1, clear: 1, brand: 0, kept: 1 });
    const out = await applyEmailOfferCleanup(pool, { by: 'u-admin', ids: ['o1'], previewedAt: preview.previewedAt });
    assert.deepEqual(out.counts, { deleted: 1, rounds: 0, units: 1, skipped: 0, notPreviewed: 0, failed: 0 });
    const undo = await undoEmailOfferCleanup(pool, { batch: out.batch, by: 'u-admin' });
    assert.deepEqual(undo.counts, { restored: 1, rounds: 0, notRestored: 0 });
  } finally {
    await drop();
  }
});
