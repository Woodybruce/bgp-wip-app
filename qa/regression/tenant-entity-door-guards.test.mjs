// Source guards for the company on the lease (tenancy_schedule_units.tenant_entity_id):
// the column, its one write door and the schedule routes that use it. Only this
// package's files are read. The rules are tested in shared/tenant-entity.test.ts
// and the SQL in server/tenancy-tenant.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, find, ts } = require('./source-harness.cjs');

const SCHEDULE = 'server/tenancy-schedule.ts';
const DOOR = 'server/tenancy-tenant.ts';
const RESOLVER = 'server/tenant-brand-resolver.ts';

test('tenant_entity_id is written only by the tenant door', () => {
  assert.match(source(DOOR), /tenant_entity_id = \$\d/);
  for (const file of [SCHEDULE, RESOLVER, 'shared/tenant-entity.ts']) {
    assert.doesNotMatch(source(file), /tenant_entity_id\s*=(?!=)/, `${file} writes tenant_entity_id`);
  }
});

test('the migration is on the boot list and in the schema', () => {
  const sql = source('migrations/0061_tenancy_tenant_entity.sql');
  assert.match(sql, /ALTER TABLE tenancy_schedule_units ADD COLUMN IF NOT EXISTS tenant_entity_id varchar/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS/);
  assert.match(source('server/schema-drift.ts'), /"0060_letting_suggestions\.sql",\s*"0061_tenancy_tenant_entity\.sql",/);
  assert.match(source('shared/schema.ts'), /tenantEntityId: varchar\("tenant_entity_id"\)/);
});

test('neither the brand nor the company on the lease is on TENANCY_FIELDS', () => {
  const fields = find(SCHEDULE, (node, ast) => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'TENANCY_FIELDS'));
  assert.doesNotMatch(fields, /tenant_company_id|tenant_entity_id/);
});

test('the tenant route checks the scope before it reads or writes anything', () => {
  const route = find(SCHEDULE, (node, ast) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText(ast) === 'router' && node.expression.name.text === 'put'
    && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/api/tenancy-schedule/unit/:id/tenant');
  const scope = route.indexOf('resolveCompanyScope');
  assert.ok(scope > 0);
  for (const later of ['pool.query', 'setTenancyTenant', 'isClientVisibleBrand(']) {
    const at = route.indexOf(later);
    assert.ok(at > scope, `${later} comes after the scope check`);
  }
  assert.ok(route.indexOf('vacant-') < scope, 'a vacant id is refused first');
  // A client is sent the row as staff are (Woody, 2026-11-13: "yes"), without the picker's matchesLease.
  assert.match(route, /if \(sc\) return res\.json\(\{ row, notes \}\);/);
  assert.doesNotMatch(source(SCHEDULE), /withoutLeaseCompany/);
});

test('the company is made with DO NOTHING and never written to the brand\'s trading_entities list', () => {
  const insert = find(DOOR, node => ts.isFunctionDeclaration(node) && node.name?.text === 'insertTradingEntity');
  assert.match(insert, /ON CONFLICT \(parent_company_id, LOWER\(name\)\) DO NOTHING/);
  assert.match(insert, /SAVEPOINT/);
  assert.doesNotMatch(insert, /DO UPDATE|is_default|notes/);
  assert.doesNotMatch(source(DOOR), /trading_entities\s*=|UPDATE crm_companies|UPDATE crm_trading_entities/);
});

test('the per-row resolver picks the lower id on a tie, as the set form does', () => {
  const perRow = find(RESOLVER, node => ts.isFunctionDeclaration(node) && node.name?.text === 'resolveBrandIdSubquery');
  assert.match(perRow, /ORDER BY bkn\.brand_id\s+LIMIT 1/);
});

test('the schedule matches a brand on a trading name that is not blank', () => {
  const s = source(SCHEDULE);
  assert.doesNotMatch(s, /coalesce\((t\.)?trading_name, (t\.)?tenant_name, ''\)/);
  assert.match(source(RESOLVER), /nullif\(btrim\(\$\{alias\}\.trading_name\), ''\)/);
});

test('the schedule PUT and the add form go through the door, and nothing here uses an AI provider', () => {
  const s = source(SCHEDULE);
  assert.match(s, /relinkTenantAfterNameEdit\(client, id, previous, actor\)/);
  assert.match(s, /setTenancyTenant\(pool, newId, \{ companyId: pickedBrand \}/);
  for (const file of [DOOR, 'shared/tenant-entity.ts']) assert.doesNotMatch(source(file), /anthropic|openai|perplexity|callClaude|ai-provider/i);
});
