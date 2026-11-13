// Brand contacts in line with landlord contacts (Brand CRM step 7): one
// person's email history and the dismiss control work on a tenant brand, the
// dialog says "brand" there, and a joint agent is not sent the brand's
// contact at a viewing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { landlordContactSuggestionKeys } from '../../shared/landlord-contact-suggestions.ts';
import { landlordActivityPersonQuery } from '../../shared/landlord-activity-person.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');

// Values made inside the evaluated source belong to another realm.
const plain = value => JSON.parse(JSON.stringify(value));
const text = node => Array.isArray(node) ? node.map(text).join(' ') : React.isValidElement(node) ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node);
const words = node => text(node).replace(/\s+/g, ' ').trim();

function emailLoader(company) {
  const queries = [];
  const declaration = find('server/brand-email-threads.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadConversations');
  const { load } = evaluate(`${declaration}\nexports.load=loadConversations;`, {
    brandFor: async () => company,
    pool: { query: (sql, params) => { queries.push({ sql, params }); return Promise.resolve({ rows: /FROM crm_contacts/.test(sql) ? [{ id: 'jo-id', email: 'jo@brand.test' }, { id: 'sam-id', email: 'sam@gmail.com' }] : [] }); } },
    landlordDomains: entry => [entry.domain].filter(Boolean),
    groupEmailConversations: (rows, domain, linkedEmails, domains) => { queries.push({ grouped: { domain, linkedEmails: linkedEmails ? [...linkedEmails] : null, domains } }); return []; },
    LANDLORD_EMAIL_ROWS_SQL: 'LINKED', BRAND_EMAIL_ROWS_SQL: 'BY DOMAIN',
    LandlordPersonScopeError: class extends Error {},
  });
  return { load, queries };
}

test('one person\'s email history loads on a tenant brand through the linked-correspondence query, scoped to that person', async () => {
  const brand = { id: 'brand', name: 'Honest Greens', domain: 'brand.test', is_landlord: false };
  const person = { key: 'contact:jo-id', name: 'Jo', email: 'jo@brand.test', contactId: 'jo-id' };
  const scoped = emailLoader(brand);
  const out = await scoped.load('brand', person);
  assert.equal(out.company, brand);
  const linked = scoped.queries.find(query => query.sql === 'LINKED');
  assert.deepEqual(plain(linked.params), ['brand', ['brand.test'], ['jo@brand.test', 'sam@gmail.com'], 'jo@brand.test', 'jo-id', ['jo-id', 'sam-id']]);
  assert.equal(scoped.queries.some(query => query.sql === 'BY DOMAIN'), false);
  assert.deepEqual(plain(scoped.queries.find(query => query.grouped).grouped), { domain: 'brand.test', linkedEmails: ['jo@brand.test', 'sam@gmail.com'], domains: ['brand.test'] });

  // A brand with no website on file still opens a saved person's history.
  const noDomain = emailLoader({ ...brand, domain: '' });
  await noDomain.load('brand', person);
  assert.deepEqual(plain(noDomain.queries.find(query => query.sql === 'LINKED').params.slice(0, 2)), ['brand', []]);
});

test('a brand\'s whole email history keeps its own query by domain, and a landlord\'s is unchanged', async () => {
  const whole = emailLoader({ id: 'brand', name: 'Honest Greens', domain: 'brand.test', is_landlord: false });
  await whole.load('brand', null);
  assert.deepEqual(whole.queries.filter(query => query.sql).map(query => query.sql), ['BY DOMAIN']);
  assert.deepEqual(plain(whole.queries[0].params), ['%@brand.test', 'brand']);
  assert.equal(whole.queries.find(query => query.grouped).grouped.linkedEmails, null);

  const empty = emailLoader({ id: 'brand', name: 'No site', domain: '', is_landlord: false });
  assert.deepEqual(plain((await empty.load('brand', null)).conversations), []);
  assert.equal(empty.queries.length, 0);

  const landlord = emailLoader({ id: 'aew', name: 'AEW', domain: 'aew.com', is_landlord: true });
  await landlord.load('aew', null);
  assert.deepEqual(plain(landlord.queries.find(query => query.sql === 'LINKED').params), ['aew', ['aew.com'], ['jo@brand.test', 'sam@gmail.com'], null, null, ['jo-id', 'sam-id']]);
});

test('person histories stay behind both staff checks, so no client login gains one', () => {
  const file = source('server/brand-email-threads.ts');
  const scope = find('server/brand-email-threads.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'emailPersonScope');
  assert.match(scope, /canReadLandlordMeetings\(req\)\) throw new LandlordPersonScopeError\("Person histories are available to BGP staff only",403\)/);
  for (const route of file.split('router.').slice(1)) assert.match(route, /if \(!\(await staffOnly\(req, res\)\)\) return;\s+(const companyId = [^\n]+\n\s+)?const person = await emailPersonScope\(req\);/);
  assert.doesNotMatch(file, /landlords only/);
});

function dismissRoute({ staff = true, found = true } = {}) {
  let handler; const sql = [], writes = [];
  const route = find('server/contacts-discovery.ts', node => ts.isCallExpression(node) && node.expression.getText() === 'router.post' && node.arguments[0]?.text === '/api/landlord/:companyId/dismiss-contact-suggestion');
  evaluate(route, { requireAuth() {}, landlordContactSuggestionKeys, LANDLORD_CATALOGUE_PREDICATE: 'IS_LANDLORD', router: { post: (_path, ...chain) => handler = chain.at(-1) },
    pool: { query: async statement => { sql.push(statement); return { rows: found ? [{ id: 'brand' }] : [] }; } },
    require: module => module === './landlord-meetings' ? { canReadLandlordMeetings: async () => staff }
      : module === './landlord-scraper' ? { dismissDiscovery: async (companyId, key) => { writes.push(`${companyId}|${key}`); } } : assert.fail(module),
  });
  return { sql, writes, async post(body) { let status = 200, data; await handler({ params: { companyId: 'brand' }, body }, { status(code) { status = code; return this; }, json(out) { data = out; return this; } }); return { status, data }; } };
}

test('a suggested contact can be dismissed on a tenant brand as on a landlord, by staff only', async () => {
  const brand = dismissRoute();
  const saved = await brand.post({ name: 'Jo Bloggs', email: 'jo@brand.test' });
  assert.equal(saved.status, 200);
  assert.deepEqual(plain(saved.data.dismissedKeys), ['contact:email:jo@brand.test', 'contact:name:jo bloggs']);
  assert.deepEqual(brand.writes, ['brand|contact:email:jo@brand.test', 'brand|contact:name:jo bloggs']);
  assert.match(brand.sql[0], /\(\(IS_LANDLORD\)\s+OR \(c\.merged_into_id IS NULL AND LOWER\(COALESCE\(c\.company_type, ''\)\) LIKE 'tenant%'\)\)/);

  const client = dismissRoute({ staff: false });
  assert.equal((await client.post({ email: 'jo@brand.test' })).status, 403);
  assert.deepEqual([client.sql.length, client.writes.length], [0, 0]);
  const other = dismissRoute({ found: false });
  assert.equal((await other.post({ email: 'jo@brand.test' })).status, 404);
  assert.equal(other.writes.length, 0);
});

test('the contact discovery honours a brand\'s dismissals', () => {
  const cascade = find('server/contacts-discovery.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleContactsCascade');
  assert.match(cascade, /const dismissible = company\.is_landlord \|\| \/\^tenant\/i\.test\(company\.company_type \|\| ""\);/);
  assert.match(cascade, /const dismissedContactKeys: string\[\] = dismissible\s+\? await/);
  assert.match(cascade, /\.\.\.\(dismissible \? \{ dismissedContactKeys \} : \{\}\)/);
});

test('the person email history says brand on a brand board and keeps the landlord wording on a landlord', () => {
  const file = 'client/src/components/brand-email-history.tsx';
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const script = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
  const tags = {}; (function visit(node) { if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) tags[node.tagName.text] = node.tagName.text; ts.forEachChild(node, visit); })(ast);
  const compiled = ts.transpileModule(script, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const draw = props => {
    const requests = [];
    const app = evaluate(compiled, { require, ...tags, landlordActivityPersonQuery, useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {}, queryClient: { setQueryData() {} },
      useQuery: options => { requests.push(options.queryKey); return { data: { domain: 'brand.test', total: 0, conversations: [], summary: null }, isLoading: false, isError: false }; },
      useMutation: () => ({ isPending: false, isError: false }), apiRequest: async () => ({ json: async () => ({}) }) });
    return { words: words(app.BrandEmailHistory({ companyId: 'brand', companyName: 'Honest Greens', open: true, onOpenChange() {}, person: { contactId: 'jo-id', name: 'Jo' }, ...props })), key: Array.from(requests[0]) };
  };
  const brand = draw({ landlord: true, linkedNoun: 'brand' });
  assert.match(brand.words, /Emails with Honest Greens · Jo/);
  assert.match(brand.words, /No email conversations linked to this brand yet\./);
  assert.doesNotMatch(brand.words, /landlord/i);
  assert.deepEqual(brand.key, ['/api/brand', 'brand', 'email-threads', '?personContactId=jo-id']);
  assert.match(draw({ landlord: true }).words, /No email conversations linked to this landlord yet\./);

  const row = find('client/src/components/company-contacts-board.tsx', node => ts.isFunctionDeclaration(node) && node.name?.text === 'KeyContactRow');
  assert.match(row, /<BrandEmailHistory companyId=\{companyId\} companyName=\{companyName\} landlord linkedNoun=\{meetingHistory \? "landlord" : "brand"\} person=/);
  assert.match(row, /const canOpenHistory = isLandlord && !rowIsClient && !!contact\.id;/, 'still staff only');
});

test('Add contact appears once on a tenant company\'s page: the header leaves it to the Key contacts board', () => {
  const panel = source('client/src/components/brand-profile-panel.tsx');
  assert.match(panel, /\{!isBrand && <>\s+<Button variant="outline" size="sm" onClick=\{\(\) => setAddContactOpen\(true\)\} data-testid="button-add-contact-brand">/);
  assert.equal(panel.split('data-testid="button-add-contact-brand"').length - 1, 1);
  // One component draws it, as a button or (a brand's own page) as a text link in the card's header: never both.
  const actions = find('client/src/components/brand-profile-panel.tsx', node => ts.isFunctionDeclaration(node) && node.name?.text === 'LandlordContactActions');
  assert.match(actions, /if \(links\) return <span[^\n]*\n\s+<button [^\n]*data-testid="button-add-contact-landlord">Add contact<\/button>/);
  assert.equal(actions.split('data-testid="button-add-contact-landlord"').length - 1, 2);
  assert.equal(panel.split('data-testid="button-add-contact-landlord"').length - 1, 2);
  assert.match(panel, /headerActions=\{brandPage && !sbIsClient \? <LandlordContactActions links /);
  assert.match(panel, /topSlot=\{brandPage \? null : isBrand \? <><TenantRepsBlock [^\n]*\{!sbIsClient && <LandlordContactActions /);
});

test('the Landsec unit page sends a joint agent no brand contact name on a viewing; other roles are unchanged', () => {
  const expression = find('server/landsec-unit.ts', node => ts.isPropertyAssignment(node) && node.name.getText() === 'viewings' && ts.isConditionalExpression(node.initializer)).replace(/^viewings:\s*/, '');
  const rows = [{ id: 'v1', company_name: 'Wingstop', contact_name: 'Jo Bloggs', viewing_date: '2026-11-20', outcome: null }];
  const sent = role => evaluate(`exports.out = (${expression});`, { access: { role }, viewings: { rows } }).out;
  assert.deepEqual(plain(sent('joint_agent')), [{ id: 'v1', company_name: 'Wingstop', contact_name: null, viewing_date: '2026-11-20', outcome: null }]);
  for (const role of ['bgp', 'landsec', 'leasing_manager', 'asset_manager']) assert.equal(sent(role), rows);
  assert.equal(rows[0].contact_name, 'Jo Bloggs', 'the stored rows are not changed');
});
