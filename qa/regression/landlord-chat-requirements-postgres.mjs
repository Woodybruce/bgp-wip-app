import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runLandlordRequirementTool, landlordRequirementTools } from '../../server/landlord-chat-requirements.ts';

test('landlord chat writes the current investment board, links its company, preserves notes and denies cross-company updates', async () => {
  const schema = `landlord_requirements_test_${randomUUID().replaceAll('-', '')}`;
  const pool = new pg.Pool({ host: '/tmp', database: 'postgres', max: 1 });
  const companyId = randomUUID(), otherId = randomUUID();
  const context = { companyId, threadId: randomUUID(), messageId: randomUUID(), userId: randomUUID() };
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema}`);
    await pool.query(`CREATE TABLE crm_companies(id text PRIMARY KEY,name text);
      CREATE TABLE crm_requirements_investment(id text PRIMARY KEY,name text NOT NULL,company_id text,status text,group_name text,
      use_types text[],requirement_types text[],size_range text[],requirement_locations text[],locations text,contact_name text,
      comments text,requirement_date text,bgp_contact_user_ids text[],updated_at timestamp DEFAULT now());`);
    await pool.query('INSERT INTO crm_companies VALUES ($1,$2),($3,$4)', [companyId, 'Synthetic landlord', otherId, 'Other landlord']);
    const input = { budget: '£5m–£10m', use: ['Retail'], requirementLocations: ['London'], notes: 'User-provided brief', sizeMin: '2,000 sq ft' };
    const saved = await runLandlordRequirementTool(pool, context, 'create_requirement', input);
    assert.equal(saved.data.success, true);
    assert.equal(saved.action.companyId, companyId);
    assert.equal(saved.action.success, true);
    assert.match(saved.action.url, /requirements\?type=investment&requirementId=/);
    assert.deepEqual(saved.data.record.size_range, ['£5m–£10m']);
    assert.match(saved.data.record.comments, /Minimum floor area: 2,000 sq ft/);
    const retry = await runLandlordRequirementTool(pool, context, 'create_requirement', input);
    assert.equal(retry.data.id, saved.data.id); assert.equal(retry.data.reused, true);
    assert.equal((await pool.query('SELECT count(*)::int n FROM crm_requirements_investment')).rows[0].n, 1);
    const updated = await runLandlordRequirementTool(pool, context, 'update_requirement', { id: saved.data.id, budget: '£12m', notes: 'Needs ground floor frontage' });
    assert.equal(updated.action.type, 'crm_updated');
    assert.match(updated.data.record.comments, /User-provided brief/); assert.match(updated.data.record.comments, /Needs ground floor frontage/);
    const repeatUpdate = await runLandlordRequirementTool(pool, context, 'update_requirement', { id: saved.data.id, notes: 'Needs ground floor frontage' });
    assert.equal(repeatUpdate.data.record.comments.match(/Needs ground floor frontage/g).length, 1);
    const denied = await runLandlordRequirementTool(pool, { ...context, companyId: otherId }, 'update_requirement', { id: saved.data.id, notes: 'Not allowed' });
    assert.equal(denied.data.success, false); assert.equal(denied.action, undefined);
    const malformed = await runLandlordRequirementTool(pool, context, 'create_requirement', { companyId: otherId, notes: 'Injected scope' });
    assert.equal(malformed.data.success, false);
    const blank = await runLandlordRequirementTool(pool, context, 'create_requirement', {});
    assert.equal(blank.data.success, false);
    const search = await runLandlordRequirementTool(pool, context, 'search_landlord_requirements', {});
    assert.equal(search.data.requirements.length, 1); assert.equal(search.data.requirements[0].id, saved.data.id);
    assert.deepEqual((await runLandlordRequirementTool(pool, { ...context, companyId: otherId }, 'search_landlord_requirements', {})).data.requirements, []);
    await pool.query(`ALTER TABLE crm_requirements_investment ADD CONSTRAINT reject_synthetic CHECK (name <> 'Rejected write')`);
    await assert.rejects(runLandlordRequirementTool(pool, { ...context, messageId: randomUUID() }, 'create_requirement', { name: 'Rejected write', budget: '£1m' }), /reject_synthetic/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM crm_requirements_investment')).rows[0].n, 1, 'failed write rolls back');
    assert.ok(landlordRequirementTools.some(t => t.function.name === 'search_landlord_requirements'));
  } finally { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); }
});
