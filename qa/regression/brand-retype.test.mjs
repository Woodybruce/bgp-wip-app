// The admin's tool that sorts brands on a catch-all type into the categories
// of Landsec's agency brief (Woody, 2026-11-16): the rules in
// shared/brand-retype.ts and the preview, apply and undo in
// server/brand-retype.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { suggestTenantType, isCatchAllTenantType, CATCH_ALL_TENANT_TYPES } from '../../shared/brand-retype.ts';
import { TENANT_CATEGORIES } from '../../shared/tenant-categories.ts';
import { landsecCategoryLabel, landsecCategoryOf } from '../../shared/landsec.ts';

const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');

const suggest = (name, companyType, description = null) => suggestTenantType({ name, companyType, description });

test('a brand on a catch-all type is offered the type its name or description points to', () => {
  assert.deepEqual(suggest('Flight Club', 'Tenant - Experiential'), { type: 'Tenant - Competitive Socialising', reason: 'Name says “Flight Club”' });
  assert.equal(suggest('Pret A Manger', 'Tenant - Restaurant')?.type, 'Tenant - Café');
  assert.equal(suggest('Greggs', 'Tenant - Restaurant')?.type, 'Tenant - Bakery');
  assert.equal(suggest('KFC', 'Tenant - Restaurant')?.type, 'Tenant - Quick Service');
  assert.equal(suggest("Jersey Mike's Subs", 'Tenant - Restaurant')?.type, 'Tenant - Quick Service');
  assert.equal(suggest('Odeon', 'Tenant - Leisure')?.type, 'Tenant - Cinema');
  assert.equal(suggest('Kerb', 'Tenant - Leisure')?.type, 'Tenant - Food Hall');
  assert.equal(suggest('Gravity Active Entertainment', 'Tenant - Family Entertainment')?.type, 'Tenant - Active Leisure');
  assert.deepEqual(suggest('Court Club', 'Tenant - Leisure', 'Indoor padel courts and a bar'), { type: 'Tenant - Active Leisure', reason: 'Description says “padel”' });
  assert.equal(suggest('Therme', 'Tenant')?.type, 'Tenant - Theme & Water Park');
});

test('nothing is offered where the type is a person\'s choice, the category would not change, or no rule fits', () => {
  assert.equal(suggest('Gym King', 'Tenant - Fashion'), null, 'a specific type is never second-guessed');
  assert.equal(suggest('Hollywood Bowl', 'Tenant - Gaming'), null, 'already competitive socialising');
  assert.equal(suggest("Nando's", 'Tenant - Restaurant'), null, 'no rule: a restaurant stays a restaurant');
  assert.equal(suggest('Belle Vue Bistro', 'Tenant - Restaurant'), null, '"Vue" inside a name is not the cinema');
  assert.equal(suggest('Flight Club', 'Landlord'), null);
  assert.equal(isCatchAllTenantType('  tenant - restaurant '), true);
  assert.equal(isCatchAllTenantType('Tenant - Retail'), false, 'retail is left out: a fashion brand named Gym King is not a gym');
});

test('every type a rule offers is on the type list, and every catch-all type sorts somewhere or to "other"', () => {
  const source = readFileSync(new URL('../../shared/brand-retype.ts', import.meta.url), 'utf8');
  const offered = [...source.matchAll(/type: "(Tenant - [^"]+)"/g)].map(m => m[1]);
  assert.ok(offered.length >= 13);
  for (const type of offered) assert.ok(TENANT_CATEGORIES.includes(type), `${type} is not on the type list`);
  for (const type of CATCH_ALL_TENANT_TYPES) assert.notEqual(landsecCategoryOf(type), null, type);
});

test('apply changes only brands still on the type read, keeps the batch, and Undo puts it back once', async () => {
  const file = 'server/brand-retype.ts';
  const named = name => find(file, n => ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name?.text === name)
    || (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === name)));
  const code = ['LAST_KEY', 'MAX_CHANGES', 'RetypeError', 'previewRetype', 'lastRetype', 'saveLast', 'checkRetypeChanges', 'applyRetype', 'undoRetype'].map(named).join('\n');
  const api = evaluate(code, { suggestTenantType, isCatchAllTenantType, CATCH_ALL_TENANT_TYPES, TENANT_CATEGORIES, landsecCategoryLabel, landsecCategoryOf });

  const settings = new Map();
  const sql = [];
  const query = async (text, params) => {
    sql.push(text);
    if (/SELECT value FROM system_settings/.test(text)) return { rows: settings.has(params[0]) ? [{ value: settings.get(params[0]) }] : [] };
    if (/INSERT INTO system_settings/.test(text)) { settings.set(params[0], JSON.parse(params[1])); return { rows: [] }; }
    // b2 was re-typed by a person after the preview: the guard leaves it alone.
    if (/SET company_type = x\.to_type/.test(text)) return { rows: params[0].map((id, i) => ({ id, name: id.toUpperCase(), from_type: params[1][i], to_type: params[2][i] })).filter(r => r.id !== 'b2') };
    if (/SET company_type = x\.from_type/.test(text)) return { rows: params[0].map(id => ({ id })) };
    if (/FROM crm_companies/.test(text)) return { rows: [
      { id: 'b1', name: 'KFC', company_type: 'Tenant - Restaurant' },
      { id: 'b3', name: "Nando's", company_type: 'Tenant - Restaurant' },
    ] };
    throw new Error(`unexpected: ${text}`);
  };

  const preview = await api.previewRetype(query);
  assert.equal(preview.catchAll, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(preview.rows.map(r => [r.id, r.to, r.fromCategory, r.toCategory]))), [['b1', 'Tenant - Quick Service', 'Restaurants & Bars', 'Café, Grab & Go and QSR']]);

  for (const [bad, why] of [[[], 'nothing ticked'], [[{ id: 'b1', from: 'Tenant - Fashion', to: 'Tenant - Café' }], 'not a catch-all'],
    [[{ id: 'b1', from: 'Tenant - Restaurant', to: 'Tenant - Spaceship' }], 'not on the list'],
    [[{ id: 'b1', from: 'Tenant - Restaurant', to: 'Tenant - Café' }, { id: 'b1', from: 'Tenant - Restaurant', to: 'Tenant - Bar' }], 'twice']]) {
    await assert.rejects(api.applyRetype(query, bad, 'Admin'), e => e.status === 400, why);
  }

  const result = await api.applyRetype(query, [
    { id: 'b1', from: 'Tenant - Restaurant', to: 'Tenant - Quick Service' },
    { id: 'b2', from: 'Tenant - Leisure', to: 'Tenant - Cinema' },
  ], 'Admin', new Date('2026-11-16T12:00:00Z'));
  assert.equal(result.applied.length, 1);
  assert.equal(result.skipped, 1);
  assert.match(sql.find(s => /SET company_type = x\.to_type/.test(s)), /c\.company_type = x\.from_type/, 'a brand changes only while it holds the type read');
  assert.deepEqual(settings.get('brand_retype_last').changes, [{ id: 'b1', name: 'B1', from: 'Tenant - Restaurant', to: 'Tenant - Quick Service' }]);

  assert.deepEqual(JSON.parse(JSON.stringify(await api.undoRetype(query, 'Admin'))), { restored: 1 });
  assert.match(sql.find(s => /SET company_type = x\.from_type/.test(s)), /c\.company_type = x\.to_type/, 'undo puts back only a brand still on the type given');
  assert.ok(settings.get('brand_retype_last').undoneAt);
  await assert.rejects(api.undoRetype(query, 'Admin'), e => e.status === 409, 'one undo per apply');
});

test('the routes are admin only and the tool never runs by itself', () => {
  const server = readFileSync(new URL('../../server/brand-retype.ts', import.meta.url), 'utf8');
  for (const route of ['"/api/admin/brand-retype"', '"/api/admin/brand-retype/apply"', '"/api/admin/brand-retype/undo"']) {
    assert.match(server, new RegExp(`${route.replace(/[/]/g, '\\/')}, requireAuth, requireAdmin`));
  }
  assert.doesNotMatch(server, /setInterval|cron|schedule/i);
  assert.doesNotMatch(server, /callClaude|anthropic|openai|perplexity/i, 'rules only, no AI');
  const hub = readFileSync(new URL('../../client/src/pages/brands-hub.tsx', import.meta.url), 'utf8');
  assert.match(hub, /exUser\?\.isAdmin && <BrandRetypeButton \/>/);
});
