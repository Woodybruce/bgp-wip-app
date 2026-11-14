// The property page's People feed (docs/contacts-board-plan-2026-11-13.md):
// the rules server/property-people.ts and shared/record-people.ts must keep,
// checked against the source so a later change that breaks one fails here.
//   node --import tsx --test qa/regression/property-people-guards.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { restrictedLandsecApiRule } from '../../shared/landsec.ts';
const require = createRequire(import.meta.url);
const { source, find, ts } = require('./source-harness.cjs');

const PEOPLE = 'server/property-people.ts';
const RULE = 'shared/record-people.ts';
const UNITS = 'server/property-units.ts';

const tree = file => ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
// Comments describe what the code must not do, so they are left out.
const code = file => ts.createPrinter({ removeComments: true }).printFile(tree(file));
const fn = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const route = (method, path) => find(PEOPLE, (node, ast) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
  && node.expression.expression.getText(ast) === 'router' && node.expression.name.text === method
  && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === path);
const collapse = text => text.replace(/\s+/g, ' ').trim();
const before = (text, first, second) => {
  const a = text.indexOf(first), b = text.indexOf(second);
  assert.ok(a >= 0, `missing ${first}`);
  assert.ok(b >= 0, `missing ${second}`);
  assert.ok(a < b, `${first} must come before ${second}`);
};
function balanced(text, start) {
  assert.equal(text[start], '(');
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('unbalanced');
}
function topLevelOr(group) {
  const inner = group.slice(1, -1);
  const parts = [];
  let depth = 0, from = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') depth--;
    else if (depth === 0 && inner.startsWith(' OR ', i)) { parts.push(inner.slice(from, i).trim()); from = i + 4; }
  }
  parts.push(inner.slice(from).trim());
  return parts;
}

const GET = '/api/properties/:id/people';
const ROLE = '/api/properties/:id/people/:contactId/client-role';

test('the GET checks the property before anything else, then the viewer, and sends only the feed', () => {
  const handler = collapse(route('get', GET));
  before(handler, 'propertyReadBlocked(req, propertyId)', 'contactViewer(req)');
  before(handler, 'contactViewer(req)', 'loadPropertyPeople(');
  assert.ok(!/\.query\(/.test(handler), 'the handler runs no query of its own');
  assert.match(handler, /if \(await propertyReadBlocked\(req, propertyId\)\) return res\.status\(403\)/);
  const sends = handler.match(/res(?:\.status\(\d+\))?\.json\(/g) || [];
  assert.equal(sends.length, 3, 'a 403, the feed and a 500');
  assert.match(handler, /res\.json\(await loadPropertyPeople\(pool, propertyId, \{ staff, scopeCompanyId, brandSliceSql \}\)\)/);
  // The feed's people are the rule's output and nothing else.
  const load = collapse(fn(PEOPLE, 'loadPropertyPeople'));
  assert.match(load, /\.map\(entry => recordPersonForViewer\(entry, \{ staff: viewer\.staff \}\)\)/);
  assert.match(load, /return \{ people, hiddenCount: Number\(hidden\.rows\[0\]\?\.n \|\| 0\), viewer: recordViewer\(viewer\.staff\), \.\.\.\(viewer\.staff \? \{ plan \} : \{\}\) \};/);
  assert.equal((load.match(/recordPersonForViewer/g) || []).length, 1);
});

test('the GET path writes nothing', () => {
  for (const part of [route('get', GET), fn(PEOPLE, 'loadPropertyPeople'), fn(PEOPLE, 'buildPropertyPeopleQuery'),
    fn(PEOPLE, 'mapPropertyPeopleRows'), fn(PEOPLE, 'addBgpTeam')]) {
    assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE)\b/.test(part), part.slice(0, 80));
  }
});

test('the CRM plan is read once, for staff only, and a failure degrades', () => {
  const load = collapse(fn(PEOPLE, 'loadPropertyPeople'));
  assert.equal((load.match(/planForCompanies\(/g) || []).length, 1);
  assert.match(load, /if \(viewer\.staff\) \{ .* try \{ const plans = await planForCompanies\(db, companyIds, \{ propertyId, tenancyUnitIds \}\);/);
  assert.match(load, /catch \(error: any\) \{ .* plan = "unavailable"; \}/);
  // Every read of the plan tables stays in server/crm-engagement.ts.
  assert.ok(!/crm_engagement_|crm_strategy_targets|marketing_campaigns/.test(code(PEOPLE)));
});

test('every hide test in property mode is on the page\'s own property', () => {
  const body = fn(PEOPLE, 'buildPropertyPeopleQuery');
  const calls = [...body.matchAll(/\bvisible\(([^)]*)\)/g)].map(m => m[1]).filter(args => !args.includes(': string'));
  assert.ok(calls.length >= 12, `found ${calls.length} hide tests`);
  for (const args of calls) assert.match(args, /^"[a-z_.]+", "\$1"$/, `visible(${args})`);
});

// The four ties between a tracker row and a schedule row, in the units feed's
// TRACKER_ONLY_SQL and in the People feed's tracker_rows. The People feed
// works the unit names out once per row (schedule_names, tracker_names), so its
// two name columns are put back to the expressions they hold before comparing.
function unitsTies() {
  const text = source(UNITS);
  const at = text.indexOf('const TRACKER_ONLY_SQL');
  assert.ok(at >= 0);
  const open = text.indexOf('NOT EXISTS (', at);
  const block = collapse(balanced(text, open + 'NOT EXISTS '.length));
  const outer = collapse(text.slice(at, open)).match(/FROM available_units (\w+)\b/)[1];
  const inner = block.match(/FROM tenancy_schedule_units (\w+)\b/)[1];
  const scoped = `WHERE ${inner}.property_id = ${outer}.property_id AND `;
  const where = block.indexOf(scoped);
  assert.ok(where > 0, `units: ${block}`);
  return { ties: topLevelOr(balanced(block, where + scoped.length)), inner, outer };
}
function peopleTies() {
  const text = source(PEOPLE);
  const cte = (name) => {
    const at = text.indexOf(`${name} AS MATERIALIZED (`);
    assert.ok(at >= 0, `${name} not found`);
    return collapse(balanced(text, text.indexOf('(', at + name.length)));
  };
  const scheduleNames = cte('schedule_names'), trackerNames = cte('tracker_names');
  const label = scheduleNames.match(/(\$\{normUnitSql\(.*?\)\}) AS norm_label/)[1];
  const name = trackerNames.match(/(\$\{normUnitSql\(.*?\)\}) AS norm_name/)[1];
  // Each name column is worked out from the table's own row, on this property only.
  assert.match(scheduleNames, /FROM tenancy_schedule_units ts WHERE ts\.property_id = \$1 ?\)$/);
  assert.match(trackerNames, /FROM available_units au WHERE au\.property_id = \$1 ?\)$/);
  const at = text.indexOf('tracker_rows AS (');
  const lateral = text.indexOf('LEFT JOIN LATERAL (', at);
  const block = collapse(balanced(text, lateral + 'LEFT JOIN LATERAL '.length));
  const outer = collapse(text.slice(at, lateral)).match(/FROM tracker_names (\w+)\b/)[1];
  const inner = block.match(/FROM schedule_names (\w+)\b/)[1];
  const scoped = `WHERE ${inner}.property_id = ${outer}.property_id AND `;
  const where = block.indexOf(scoped);
  assert.ok(where > 0, `people: ${block}`);
  const ties = topLevelOr(balanced(block, where + scoped.length))
    .map(tie => tie.replaceAll(`${inner}.norm_label`, label.replaceAll('ts.', `${inner}.`)).replaceAll(`${outer}.norm_name`, name.replaceAll('au.', `${outer}.`)));
  return { ties, inner, outer, order: block };
}
const neutral = ({ ties, inner, outer }) => ties.map(tie => tie.replace(new RegExp(`\\b${inner}\\.`, 'g'), 'S.').replace(new RegExp(`\\b${outer}\\.`, 'g'), 'T.'));

test('the People feed ties a tracker row to its schedule row exactly as the units feed does', () => {
  const ours = neutral(peopleTies()), theirs = neutral(unitsTies());
  assert.equal(theirs.length, 4);
  assert.equal(ours.length, 4, ours.join(' | '));
  ours.forEach((tie, i) => assert.equal(tie, theirs[i], `tie ${i + 1}`));
  // A change to one tie is caught.
  const changed = [...ours]; changed[1] = changed[1].replace('T.id', 'T.deal_id');
  assert.notDeepEqual(changed, theirs);
  // First match in the units feed's order: the tenancy link, then the tracker link, then the physical unit.
  assert.match(peopleTies().order, /ORDER BY \(ts\.id::text = au\.tenancy_unit_id::text\) DESC NULLS LAST, \(ts\.letting_tracker_unit_id = au\.id\) DESC NULLS LAST, \(ts\.property_unit_id = au\.unit_id\) DESC NULLS LAST/);
});

test('the role write is BGP staff only, owner people only, from the list, under a lock', () => {
  for (const method of ['put', 'delete']) {
    const handler = collapse(route(method, ROLE));
    before(handler, 'contactViewer(req)', method === 'put' ? 'setPropertyClientRole(' : 'removePropertyClientRole(');
    assert.match(handler, /if \(!staff\) return res\.status\(403\)/);
  }
  const set = collapse(fn(PEOPLE, 'setPropertyClientRole'));
  assert.match(set, /PROPERTY_CLIENT_ROLES as readonly string\[\]\)\.includes\(role\)/);
  before(set, 'PROPERTY_CLIENT_ROLES', 'withRoleLock(');
  before(set, "A role at this property is for the owner's own people", 'UPDATE crm_property_clients');
  before(set, 'UPDATE crm_property_clients', 'INSERT INTO crm_property_clients');
  assert.match(set, /WHERE NOT EXISTS/);
  const lock = collapse(fn(PEOPLE, 'withRoleLock'));
  before(lock, 'BEGIN', 'pg_advisory_xact_lock');
  before(lock, 'pg_advisory_xact_lock', 'await work(q)');
});

test('nothing runs at boot or on a timer', () => {
  const people = code(PEOPLE);
  assert.ok(!/setInterval|setTimeout|cron|schedule\(/i.test(people.replace(/schedule_names|schedule_row_id|scheduleRow/g, '')));
  // At module level the file only declares things and its routes.
  const ast = tree(PEOPLE);
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    assert.match(statement.getText(ast), /^router\.(get|put|delete)\(/, statement.getText(ast).slice(0, 60));
  }
  const index = source('server/index.ts');
  const mentions = index.split('\n').filter(line => /property-people|propertyPeopleRouter/.test(line)).map(line => line.trim());
  assert.deepEqual(mentions, ['import { propertyPeopleRouter } from "./property-people";', 'app.use(propertyPeopleRouter);']);
});

test('the rule builds each person from an allow-list and never copies its input', () => {
  for (const name of ['recordPersonForViewer', 'relationshipFor']) {
    const body = code(RULE).slice(code(RULE).indexOf(`function ${name}(`));
    const own = body.slice(0, body.indexOf('\n}') + 2);
    assert.ok(!/\.\.\.(p|rel|entry|person|input)\b/.test(own), `${name} spreads its input`);
    assert.ok(!/Object\.assign|structuredClone|JSON\.parse/.test(own), `${name} copies its input`);
  }
  // The handler sends the rule's output, never an entry.
  assert.ok(!/\.\.\.entry\b/.test(collapse(fn(PEOPLE, 'loadPropertyPeople'))));
});

test('restricted Landsec roles cannot reach the people or the role routes', () => {
  for (const role of ['asset_manager', 'joint_agent']) {
    for (const [method, path] of [['GET', '/api/properties/p1/people'], ['PUT', '/api/properties/p1/people/c1/client-role'], ['DELETE', '/api/properties/p1/people/c1/client-role']]) {
      assert.equal(restrictedLandsecApiRule(role, method, path), 'deny', `${role} ${method} ${path}`);
    }
  }
});
