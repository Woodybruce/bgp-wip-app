// The AML retention trigger, run for real in an isolated schema of a local
// disposable database. After `bash qa/start-postgres.sh`:
// AML_RETENTION_DATABASE_URL='postgresql://postgres:qa-local-pg@127.0.0.1:5432/postgres' node --import tsx --test qa/regression/aml-retention-postgres.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { AML_RETENTION_MIGRATIONS } from '../../server/aml-retention.ts';

const supplied = process.env.AML_RETENTION_DATABASE_URL;
const skip = supplied ? false : 'Provide AML_RETENTION_DATABASE_URL (a local disposable database) to run';

test('deleting a deal or company with AML history archives it for five years, without warnings', { skip }, async t => {
  const url = new URL(supplied);
  if (!['', 'localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Refusing a database that is not local');
  const schema = 'aml_retention_' + randomUUID().replaceAll('-', '');
  const db = new pg.Client({ connectionString: supplied, ssl: false });
  const notices = [];
  db.on('notice', n => notices.push(`${n.severity}: ${n.message}`));
  await db.connect();
  const archive = async () => (await db.query('SELECT entity_type, entity_id, data, reason, archived_by, retain_until FROM aml_retention_archive ORDER BY id')).rows;
  const warnings = () => notices.filter(n => n.startsWith('WARNING'));
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path TO ${schema}`);
    // Each table carries only its own AML columns, as in the app schema.
    await db.query(`
      CREATE TABLE crm_companies(id varchar PRIMARY KEY, name text, kyc_status text, aml_checklist jsonb, companies_house_number text);
      CREATE TABLE crm_deals(id varchar PRIMARY KEY, name text, status text, kyc_approved boolean DEFAULT false, aml_check_completed text);
      CREATE TABLE kyc_documents(id serial PRIMARY KEY, company_id varchar);
      CREATE TABLE kyc_investigations(id serial PRIMARY KEY, crm_company_id varchar);
      CREATE TABLE deal_events(id serial PRIMARY KEY, deal_id varchar, event_type text);`);
    // Boot runs these on every start, so they must apply twice over.
    for (const sql of [...AML_RETENTION_MIGRATIONS, ...AML_RETENTION_MIGRATIONS]) await db.query(sql);
    notices.length = 0;
    const seed = () => db.query(`
      TRUNCATE crm_companies, crm_deals, kyc_documents, kyc_investigations, deal_events, aml_retention_archive RESTART IDENTITY;
      INSERT INTO crm_companies(id, name, kyc_status, aml_checklist, companies_house_number) VALUES
        ('company-kyc', 'KYC status', 'approved', NULL, NULL),
        ('company-checklist', 'Checklist', NULL, '{"id_verified":{"ticked":true}}', NULL),
        ('company-number', 'Registered number', NULL, NULL, '01234567'),
        ('company-document', 'KYC document', NULL, NULL, ''),
        ('company-investigation', 'Investigation', NULL, NULL, NULL),
        ('company-plain', 'No AML history', NULL, NULL, '');
      INSERT INTO kyc_documents(company_id) VALUES ('company-document');
      INSERT INTO kyc_investigations(crm_company_id) VALUES ('company-investigation');
      INSERT INTO crm_deals(id, name, status, kyc_approved, aml_check_completed) VALUES
        ('deal-kyc', 'KYC approved', 'NEG', true, NULL),
        ('deal-check', 'AML check done', 'NEG', false, '2026-10-01'),
        ('deal-stage', 'Past solicitors', 'SOL', false, NULL),
        ('deal-event', 'KYC run', 'NEG', false, NULL),
        ('deal-plain', 'No AML history', 'NEG', false, NULL),
        ('deal-null', 'No AML history, nulls', NULL, NULL, NULL);
      INSERT INTO deal_events(deal_id, event_type) VALUES ('deal-event', 'kyc_orchestrator_run'), ('deal-plain', 'stage_change');`);

    await t.test('a deal with kyc_approved = true is archived once', async () => {
      await seed();
      assert.equal((await db.query(`DELETE FROM crm_deals WHERE id = 'deal-kyc'`)).rowCount, 1);
      const rows = await archive();
      assert.equal(rows.length, 1);
      const [row] = rows;
      assert.deepEqual([row.entity_type, row.entity_id, row.reason], ['crm_deals', 'deal-kyc', 'deleted or merged']);
      assert.deepEqual(row.data, { id: 'deal-kyc', name: 'KYC approved', status: 'NEG', kyc_approved: true, aml_check_completed: null });
      assert.equal(row.archived_by, (await db.query('SELECT current_user AS u')).rows[0].u);
      const { years } = (await db.query(`SELECT (retain_until = archived_at + interval '5 years') AS years FROM aml_retention_archive`)).rows[0];
      assert.equal(years, true);
      assert.deepEqual(warnings(), []);
    });

    await t.test('a company with a kyc_status is archived once', async () => {
      await seed();
      assert.equal((await db.query(`DELETE FROM crm_companies WHERE id = 'company-kyc'`)).rowCount, 1);
      const rows = await archive();
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].entity_type, rows[0].entity_id, rows[0].reason], ['crm_companies', 'company-kyc', 'deleted or merged']);
      assert.deepEqual(rows[0].data, { id: 'company-kyc', name: 'KYC status', kyc_status: 'approved', aml_checklist: null, companies_house_number: null });
      assert.deepEqual(warnings(), []);
    });

    await t.test('every retention condition archives; records with no AML history do not', async () => {
      await seed();
      assert.equal((await db.query('DELETE FROM crm_deals')).rowCount, 6);
      assert.equal((await db.query('DELETE FROM crm_companies')).rowCount, 6);
      assert.deepEqual((await archive()).map(r => `${r.entity_type}:${r.entity_id}`).sort(), [
        'crm_companies:company-checklist', 'crm_companies:company-document', 'crm_companies:company-investigation',
        'crm_companies:company-kyc', 'crm_companies:company-number',
        'crm_deals:deal-check', 'crm_deals:deal-event', 'crm_deals:deal-kyc', 'crm_deals:deal-stage',
      ]);
      assert.deepEqual(warnings(), []);
    });

    await t.test('a failure inside the trigger warns and never stops the delete', async () => {
      await seed();
      await db.query('ALTER TABLE deal_events RENAME TO deal_events_missing');
      try {
        assert.equal((await db.query(`DELETE FROM crm_deals WHERE id = 'deal-plain'`)).rowCount, 1);
        assert.equal(warnings().length, 1);
        assert.match(warnings()[0], /aml_retain_on_delete: .*deal_events/);
      } finally {
        await db.query('ALTER TABLE deal_events_missing RENAME TO deal_events');
        notices.length = 0;
      }
    });
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await db.end();
  }
});
