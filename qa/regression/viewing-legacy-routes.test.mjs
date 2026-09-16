import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { sql, and, eq, inArray, isNull } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
const require = createRequire(import.meta.url);
const { find, route, evaluate, ts } = require('./source-harness.cjs');
const file = 'server/routes.ts';
const helper = name => find(file, node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText() === name));
const serializerSource = find('server/leasing-viewings.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'serializeViewingForScope');
const { serializeViewingForScope } = evaluate(serializerSource);
const helpers = [helper('camelRow'), helper('viewingRowForScope')].join('\n');
const dialect = new PgDialect();
const response = () => ({ code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const rawInvitation = { subject: 'Private calendar subject', location: 'Private meeting location', bodyPreview: 'Sensitive invitation text', issues: ['Review booking'] };
const camel = { id: 'viewing-1', unitId: 'unit-1', viewingDate: '2026-09-18', status: 'scheduled', notes: 'Shared viewing notes', sourceDetails: rawInvitation };
const snake = { id: 'viewing-1', unit_id: 'unit-1', viewing_date: '2026-09-18', status: 'scheduled', notes: 'Shared viewing notes', source_details: rawInvitation };
function fixture(path, { client = true, propertyId = 'property-in-scope', rows = [camel] } = {}) {
  let handler;
  const queries = [];
  const unitViewings = Object.fromEntries(['unitId', 'viewingDate', 'status', 'deletedAt'].map(name => [name, sql.raw(name.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`))]));
  const record = query => { const compiled = dialect.sqlToQuery(query); queries.push(compiled); return compiled; };
  evaluate(`${helpers}\n${route(file, 'get', path)}`, {
    requireAuth() {},
    app: { get: (_path, _auth, fn) => { handler = fn; } },
    clientUnitScopeSql: async () => client ? 'portfolio-id' : null,
    assertUnitInClientScope: async (_req, property) => client && property !== 'property-in-scope' ? 'out-of-scope' : null,
    storage: { getAvailableUnit: async () => ({ id: 'unit-1', propertyId }) },
    sql, and, eq, inArray, isNull, serializeViewingForScope,
    db: {
      execute: async query => { record(query); return { rows }; },
      select: () => ({ from: () => ({ where: condition => ({ orderBy: async () => { record(sql`SELECT * FROM unit_viewings WHERE ${condition}`); return rows; } }) }) }),
    },
    require: name => { assert.equal(name, '@shared/schema'); return { unitViewings }; },
  });
  return { queries, async run() { const res = response(); await handler({ params: { id: 'unit-1' } }, res); return res; } };
}

test('legacy all-viewings strips raw invitation details for scoped clients while retaining shared fields', async () => {
  const app = fixture('/api/available-units/all-viewings', { rows: [snake] });
  const result = await app.run();
  assert.equal(result.code, 200);
  assert.equal(result.body[0].sourceDetails, undefined);
  assert.equal(result.body[0].source_details, undefined);
  assert.equal(result.body[0].notes, 'Shared viewing notes');
  assert.equal(result.body[0].viewingDate, '2026-09-18');
  assert.equal(snake.source_details, rawInvitation, 'serialization does not mutate the staff/source record');
  assert.ok(app.queries[0].params.includes('portfolio-id'));
});

test('scoped diary notes redact the generated calendar subject, including quoted multiline canaries, and preserve human notes', () => {
  const subject = 'CANARY: private "board" meeting\nwith a private second line';
  const suffix = '\nPete: agreed a second viewing. "Keep this note."';
  const record = { source: 'diary', notes: `Synced from Outlook: "${subject}"${suffix}`, sourceDetails: { subject, location: 'Private location' } };
  const result = serializeViewingForScope(record, true);
  assert.equal(result.notes, `Captured from Outlook.${suffix}`);
  assert.ok(!JSON.stringify(result).includes('CANARY'));
  assert.ok(!('sourceDetails' in result));
  assert.equal(record.notes, `Synced from Outlook: "${subject}"${suffix}`, 'source record remains unchanged');
  const sameLine = { ...record, notes: `Synced from Outlook: "${subject}" — Pete: tenant said "yes"` };
  assert.equal(serializeViewingForScope(sameLine, true).notes, 'Captured from Outlook. — Pete: tenant said "yes"');
});

test('legacy diary provenance without metadata is redacted while later human notes survive', () => {
  const record = { source: 'diary', notes: 'Synced from Outlook: "CANARY private subject"\nCharlotte: send the floor plan.', source_details: null };
  const result = serializeViewingForScope(record, true);
  assert.equal(result.notes, 'Captured from Outlook.\nCharlotte: send the floor plan.');
  assert.ok(!('source_details' in result));
});

test('manual notes and staff records retain their authored content', () => {
  const note = 'Synced from Outlook: "this was typed by an agent"';
  assert.equal(serializeViewingForScope({ source: 'manual', notes: note }, true).notes, note);
  assert.equal(serializeViewingForScope({ source: 'diary', notes: 'Pete noted: ' + note }, true).notes, 'Pete noted: ' + note);
  const staff = { source: 'diary', notes: note, sourceDetails: rawInvitation };
  assert.equal(serializeViewingForScope(staff, false), staff);
});

for (const path of ['/api/available-units/all-viewings', '/api/available-units/:id/viewings']) test(`calendar subject cannot leak through legacy diary notes on ${path}`, async () => {
  const row = { ...camel, source: 'diary', notes: 'Synced from Outlook: "Private calendar subject"\nAgent follow-up remains visible.' };
  const result = await fixture(path, { rows: [row] }).run();
  assert.equal(result.code, 200);
  assert.equal(result.body[0].notes, 'Captured from Outlook.\nAgent follow-up remains visible.');
  assert.ok(!JSON.stringify(result.body).includes('Private calendar subject'));
});

test('legacy per-unit viewings remove invitation evidence for clients and retain terminal history', async () => {
  const app = fixture('/api/available-units/:id/viewings', { rows: [camel, { ...camel, id: 'cancelled', status: 'cancelled' }] });
  const result = await app.run();
  assert.equal(result.code, 200);
  assert.equal(result.body.length, 2);
  assert.equal(result.body[1].status, 'cancelled');
  assert.ok(result.body.every(row => !('sourceDetails' in row)));
  assert.equal(result.body[0].unitId, 'unit-1');
  assert.equal(camel.sourceDetails, rawInvitation);
  assert.match(app.queries[0].sql, /deleted_at is null/i);
});

test('out-of-scope per-unit viewing requests are rejected before records are read', async () => {
  const app = fixture('/api/available-units/:id/viewings', { propertyId: 'foreign-property' });
  const result = await app.run();
  assert.equal(result.code, 403);
  assert.equal(app.queries.length, 0);
});

for (const path of ['/api/available-units/all-viewings', '/api/available-units/:id/viewings']) test(`staff keep matching evidence on ${path}`, async () => {
  const app = fixture(path, { client: false });
  const result = await app.run();
  assert.equal(result.code, 200);
  assert.equal(result.body[0].sourceDetails, rawInvitation);
});

for (const client of [true, false]) test(`tracker aggregate feed and count use the same active statuses (${client ? 'client' : 'staff'})`, async () => {
  for (const path of ['/api/available-units/all-viewings', '/api/available-units/all-viewings-counts']) {
    const app = fixture(path, { client, rows: [] });
    assert.equal((await app.run()).code, 200);
    const query = app.queries[0];
    assert.match(query.sql, /deleted_at(?:"?) is null/i);
    assert.ok(query.sql.includes("'scheduled','completed'") || query.params.includes('scheduled') && query.params.includes('completed'));
    if (client) {
      assert.match(query.sql, /EXISTS \(SELECT 1 FROM crm_company_properties/);
      assert.doesNotMatch(query.sql, /JOIN crm_company_properties/);
    }
  }
});

for (const path of ['/api/available-units/all-offers', '/api/available-units/all-offers-counts']) test(`duplicate portfolio membership cannot multiply scoped rows on ${path}`, async () => {
  const app = fixture(path, { rows: [] });
  assert.equal((await app.run()).code, 200);
  assert.match(app.queries[0].sql, /EXISTS \(SELECT 1 FROM crm_company_properties/);
  assert.doesNotMatch(app.queries[0].sql, /JOIN crm_company_properties/);
});
