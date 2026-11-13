// Property page rebuild (docs/property-page-rebuild-2026-11-13.md): the rules
// the unit feed and the plan matching must keep, checked against the source
// (and, where a handler can be run on its own, against the handler) so a later
// change that breaks one fails here.
//   node --import tsx --test qa/regression/property-units-guards.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { restrictedLandsecApiRule } from '../../shared/landsec.ts';
import { LETTING_STATUS_LABELS, TRACKER_LIVE_STATUSES } from '../../shared/letting-rules.ts';
import { unitStateLabel, UNIT_OCCUPANCY_LABELS } from '../../shared/property-units.ts';
import { bulkAcceptable } from '../../shared/property-plan-match.ts';
import * as links from '../../server/property-plan-links.ts';
import { PropertyPlanScanError, requirePropertyPlan, validPlanId } from '../../server/property-plan-scan-store.ts';
import { planPoints } from '../../server/property-plan-scan.ts';
import { planPolygonsOverlap } from '../../server/plan-unit-detection.ts';
import { isValidPolygon } from '../../shared/plan-geometry.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');

const UNITS = 'server/property-units.ts';
const MATCH = 'server/property-plan-match.ts';
const PLANS = 'server/property-plans.ts';
const SCHEDULE = 'server/tenancy-schedule.ts';

const tree = file => ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
// Comments describe what the code must not do, so they are left out of the
// checks: the file as the TypeScript printer writes it with no comments.
const code = file => ts.createPrinter({ removeComments: true }).printFile(tree(file));
const identifiers = file => {
  const out = [];
  (function visit(node) { if (ts.isIdentifier(node)) out.push(node.text); ts.forEachChild(node, visit); })(tree(file));
  return out;
};
const fn = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const constant = (file, name) => find(file, (node, ast) => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === name));
const routeNode = (file, method, path) => {
  const ast = tree(file);
  let found;
  (function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(ast) === 'router'
      && node.expression.name.text === method && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === path) found = node;
    ts.forEachChild(node, visit);
  })(ast);
  assert.ok(found, `Missing route ${method} ${path} in ${file}`);
  return { node: found, ast, text: found.getText(ast) };
};
const routes = file => {
  const ast = tree(file);
  const out = [];
  (function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(ast) === 'router'
      && ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'].includes(node.expression.name.text)) out.push(`${node.expression.name.text} ${node.arguments[0]?.getText(ast)}`);
    ts.forEachChild(node, visit);
  })(ast);
  return out;
};
// The statements inside a route handler's try block.
const tryStatements = ({ node, ast }) => {
  const handler = node.arguments[node.arguments.length - 1];
  const body = handler.body;
  const attempt = body.statements.find(s => ts.isTryStatement(s));
  assert.ok(attempt, 'handler has a try block');
  return attempt.tryBlock.statements.map(s => s.getText(ast));
};
const collapse = text => text.replace(/\s+/g, ' ').trim();
// From an opening parenthesis at `start`, the text up to its matching close.
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

// 1 ─────────────────────────────────────────────────────────────────────────
// The four ways a tracker row is tied to a schedule row, with the aliases made
// neutral: S is the schedule row in the NOT EXISTS, T the tracker row.
function trackerTies(file, anchor) {
  const text = source(file);
  const at = text.indexOf(anchor);
  assert.ok(at >= 0, `${file}: ${anchor} not found`);
  const open = text.indexOf('NOT EXISTS (', at);
  assert.ok(open > at, `${file}: no NOT EXISTS after ${anchor}`);
  let block = collapse(balanced(text, open + 'NOT EXISTS '.length));
  const head = collapse(text.slice(at, open));
  const outer = head.match(/FROM available_units (\w+)\b/)?.[1];
  const inner = block.match(/FROM tenancy_schedule_units (\w+)\b/)?.[1];
  assert.ok(outer && inner, `${file}: aliases not found`);
  block = block.replace(new RegExp(`\\b${inner}\\.`, 'g'), 'S.').replace(new RegExp(`\\b${outer}\\.`, 'g'), 'T.')
    .replace(new RegExp(`FROM tenancy_schedule_units ${inner}\\b`), 'FROM tenancy_schedule_units S');
  const scoped = block.indexOf('WHERE S.property_id = T.property_id AND (');
  assert.ok(scoped > 0, `${file}: the schedule row is not limited to the tracker row's property: ${block}`);
  const ties = topLevelOr(balanced(block, scoped + 'WHERE S.property_id = T.property_id AND '.length));
  return { block, ties, outer, inner };
}
const PROPERTY_UNITS_ANCHOR = 'const TRACKER_ONLY_SQL';
const SCHEDULE_ANCHOR = 'const vacant = await pool.query';
const identity = (file, name, alias) => {
  const text = constant(file, name).replace(/^[^`]*`|`;?$/g, '');
  return collapse(text).replace(new RegExp(`\\b${alias}\\.`, 'g'), 'T.');
};
function compareTies(ours, theirs) {
  assert.equal(ours.ties.length, 4, `property units: expected four ties, found ${ours.ties.length}: ${ours.ties.join(' | ')}`);
  assert.equal(theirs.ties.length, 4, `tenancy schedule: expected four ties, found ${theirs.ties.length}: ${theirs.ties.join(' | ')}`);
  const names = ['tenancy id', 'letting tracker id', 'physical unit', 'normalised unit name'];
  const kinds = [/^S\.id::text = T\.tenancy_unit_id::text$/, /^S\.letting_tracker_unit_id = T\.id$/, /S\.property_unit_id = T\.unit_id/, /normUnitSql\("T\.unit_name"\)/];
  names.forEach((name, i) => {
    assert.match(ours.ties[i], kinds[i], `property units tie ${i + 1} is not the ${name}`);
    assert.equal(ours.ties[i], theirs.ties[i], `the ${name} tie differs between ${UNITS} and ${SCHEDULE}`);
  });
  assert.equal(ours.block, theirs.block, 'the NOT EXISTS blocks differ');
}

test('1. the tracker-only test stays in step with the tenancy schedule\'s own', () => {
  const ours = trackerTies(UNITS, PROPERTY_UNITS_ANCHOR);
  const theirs = trackerTies(SCHEDULE, SCHEDULE_ANCHOR);
  compareTies(ours, theirs);
  // The physical tie only applies when the tracker row has no tenancy link,
  // and the name tie only when the physical ids cannot contradict it.
  assert.match(ours.ties[2], /^\(T\.tenancy_unit_id IS NULL AND T\.unit_id IS NOT NULL AND S\.property_unit_id = T\.unit_id\)$/);
  assert.match(ours.ties[3], /T\.tenancy_unit_id IS NULL AND \(T\.unit_id IS NULL OR S\.property_unit_id IS NULL\)/);
  // One unit per physical id, else name, else tracker row, on both screens.
  assert.equal(identity(UNITS, 'TRACKER_IDENTITY', ours.outer), identity(SCHEDULE, 'vacancyIdentity', theirs.outer));
  // A change to one side without the other is caught.
  const changed = { ...ours, ties: [...ours.ties], block: ours.block.replace('S.letting_tracker_unit_id = T.id', 'S.letting_tracker_unit_id = T.deal_id') };
  changed.ties[1] = 'S.letting_tracker_unit_id = T.deal_id';
  assert.throws(() => compareTies(changed, theirs));
  assert.throws(() => compareTies({ ...ours, ties: ours.ties.slice(0, 3) }, theirs));
});

// 2 ─────────────────────────────────────────────────────────────────────────
test('2. the unit routes check propertyReadBlocked before they load anything', () => {
  const blocked = fn(UNITS, 'propertyReadBlocked');
  assert.match(blocked, /if \(await clientBlockedForProperty\(req, propertyId\)\) return true;/);
  assert.match(blocked, /const scope = await resolveCompanyScope\(req\);\s+return !!scope && !\(await isPropertyInScope\(scope, propertyId\)\);/);
  const expected = { '/api/properties/:propertyId/units': 'loadPropertyUnits(pool, propertyId)', '/api/properties/:propertyId/units/:unitId': 'loadPropertyUnitDetail(pool, propertyId,' };
  assert.deepEqual(routes(UNITS).sort(), Object.keys(expected).map(p => `get "${p}"`).sort(), 'every route in the file is one of the two checked here');
  for (const [path, load] of Object.entries(expected)) {
    const route = routeNode(UNITS, 'get', path);
    assert.match(route.text, /requireAuth/);
    const statements = tryStatements(route);
    assert.equal(statements[0], 'const propertyId = String(req.params.propertyId);', path);
    assert.match(statements[1], /^if \(await propertyReadBlocked\(req, propertyId\)\) return res\.status\(403\)/, `${path}: the read check is not the first thing it does`);
    const rest = statements.slice(2).join('\n');
    assert.ok(rest.includes(load), `${path} loads through ${load}`);
    assert.ok(route.text.indexOf('propertyReadBlocked') < route.text.indexOf(load));
  }
});

test('2. the match routes reach their work only through requirePropertyPlan with the propertyReadBlocked check', () => {
  const text = code(MATCH);
  assert.match(source(MATCH), /const access = \(req: Request\): CanAccess => async propertyId => !\(await propertyReadBlocked\(req, propertyId\)\);/);
  assert.match(source(MATCH), /import \{ propertyReadBlocked \} from "\.\/property-units";/);
  assert.doesNotMatch(text, /\bpool\.(query|connect)\b/, 'no handler queries the pool around the access check');
  assert.deepEqual(routes(MATCH).sort(), ['get "/api/plans/:planId/match"', 'post "/api/plans/:planId/match/accept"', 'post "/api/plans/:planId/match/accept-suggested"', 'post "/api/plans/:planId/match/dismiss"'].sort());
  const board = tryStatements(routeNode(MATCH, 'get', '/api/plans/:planId/match'));
  assert.equal(board[0], 'const plan = await requirePropertyPlan(pool, String(req.params.planId), access(req));');
  assert.match(board.join('\n'), /loadPlanMatchBoard\(pool, plan,/);
  for (const [path, work] of [['/api/plans/:planId/match/accept', 'acceptPlanProposal'], ['/api/plans/:planId/match/accept-suggested', 'acceptSuggestedPlanProposals'], ['/api/plans/:planId/match/dismiss', 'dismissPlanProposal']]) {
    const statements = tryStatements(routeNode(MATCH, 'post', path));
    assert.equal(statements.length, 1, path);
    assert.match(statements[0], new RegExp(`^res\\.json\\(await ${work}\\(pool, String\\(req\\.params\\.planId\\), .*access\\(req\\)\\)\\);$`), path);
    assert.match(fn(MATCH, work), /return transaction\(database, planId, scanId, canAccess, async \(db, propertyId\) =>/, `${work} works inside transaction()`);
  }
  // transaction() authorises the plan before it takes a connection, and the
  // locked work is held to the property that was authorised.
  const transaction = fn(MATCH, 'transaction');
  const authorise = transaction.indexOf('const authorised = await requirePropertyPlan(database, planId, canAccess);');
  assert.ok(authorise > 0 && authorise < transaction.indexOf('database.connect()'));
  assert.match(transaction, /work\(db, authorised\.property_id\)/);
  assert.match(fn(MATCH, 'lockScan'), /requirePropertyPlan\(db, planId, async id => id === propertyId, true\)/);
});

test('2. requirePropertyPlan refuses before handing back a plan the caller may not read', async () => {
  const plan = { id: '11111111-1111-4111-8111-111111111111', property_id: 'other' };
  const db = { query: async () => ({ rows: [plan] }) };
  await assert.rejects(requirePropertyPlan(db, plan.id, async () => false), error => error.status === 403);
  assert.equal((await requirePropertyPlan(db, plan.id, async () => true)).id, plan.id);
});

// 3 ─────────────────────────────────────────────────────────────────────────
// Every SQL string in the feed and detail reads.
function sqlStrings(file) {
  const ast = tree(file);
  const out = [];
  (function visit(node) {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || ts.isStringLiteral(node)) {
      const text = node.getText(ast);
      if (/\b(SELECT|FROM|JOIN)\b/.test(text)) out.push(text);
    }
    ts.forEachChild(node, visit);
  })(ast);
  return out;
}

test('3. neither read selects BGP\'s fee, fee split, internal agents or notes on targets', () => {
  const sql = sqlStrings(UNITS);
  assert.ok(sql.length >= 10, `expected the feed and detail queries, found ${sql.length}`);
  for (const text of sql) {
    assert.doesNotMatch(text, /fee|internal_agent|bgp_take|bgp_house|commission/i, `a read selects a fee or internal column: ${collapse(text).slice(0, 200)}`);
  }
  // unit_target_operators: only these columns are read, never BGP's notes or rationale.
  const targetColumns = new Set();
  for (const text of sql.filter(t => /unit_target_operators/.test(t))) {
    const alias = text.match(/unit_target_operators (\w+)/)[1];
    for (const m of text.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))) targetColumns.add(m[1]);
    assert.doesNotMatch(text, new RegExp(`\\b${alias}\\.\\*|notes|rationale|bgp_`), 'a target read takes BGP\'s notes');
  }
  for (const column of targetColumns) assert.ok(['id', 'operator_name', 'company_id', 'status', 'priority', 'sort_order', 'brief_id'].includes(column), `unit_target_operators.${column} is read`);
  // The deal columns sent are a fixed list.
  assert.equal(collapse(constant(UNITS, 'DEAL_COLUMNS')),
    'const DEAL_COLUMNS = `d.id AS deal_id, d.deal_ref, d.name AS deal_name, d.deal_type, d.status AS deal_status, d.stage_entered_at, d.created_at AS deal_created_at, dc.name AS deal_tenant`;');
  // The reply objects carry no fee either.
  for (const name of identifiers(UNITS)) assert.doesNotMatch(name, /fee(?!d)|internalAgent|bgpTake|commission/i, `the feed names ${name}`);
});

test('3. a viewing\'s contact name is sent only to BGP staff', () => {
  const detail = fn(UNITS, 'loadPropertyUnitDetail');
  assert.match(detail, /contact: viewer\.staff \? text\(v\.contact_name\) : null/);
  assert.equal(detail.match(/contact_name/g).length, 2, 'contact_name is selected once and read once, in the staff-only ternary');
  assert.equal((code(UNITS).match(/contact_name/g) || []).length, 2, 'contact_name appears nowhere else in the feed');
  const statements = tryStatements(routeNode(UNITS, 'get', '/api/properties/:propertyId/units/:unitId'));
  assert.ok(statements.includes('const staff = !(await resolveCompanyScope(req));'), 'staff means no client scope (a client login, and staff viewing as one, are not staff)');
  assert.match(statements.join('\n'), /loadPropertyUnitDetail\(pool, propertyId, String\(req\.params\.unitId\), \{ staff \}\)/);
});

// 4 ─────────────────────────────────────────────────────────────────────────
test('4. loadPropertyUnits runs a fixed number of queries', () => {
  const ast = tree(UNITS);
  let target;
  (function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'loadPropertyUnits') target = node; ts.forEachChild(node, visit); })(ast);
  assert.ok(target);
  const loops = [ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement];
  const nested = [ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.MethodDeclaration];
  let queries = 0, uses = 0;
  (function visit(node) {
    if (ts.isIdentifier(node) && node.text === 'db' && !ts.isParameter(node.parent)) {
      uses++;
      for (let up = node.parent; up && up !== target; up = up.parent) {
        assert.ok(!loops.includes(up.kind), `db is used inside a loop: ${up.getText(ast).slice(0, 120)}`);
        assert.ok(!nested.includes(up.kind), `db is used inside a callback: ${up.getText(ast).slice(0, 120)}`);
      }
      if (ts.isPropertyAccessExpression(node.parent) && node.parent.name.text === 'query') queries++;
    }
    ts.forEachChild(node, visit);
  })(target.body);
  assert.equal(queries, 7, 'the property, then six reads in one Promise.all');
  assert.equal(uses, 8, 'the seven queries and one stageSinceFor call');
  assert.match(target.getText(ast), /const since = await stageSinceFor\(dealIds, db\);/);
  // stageSinceFor is itself a fixed two queries for all the deals (the
  // history, and the dates set by hand), never one per deal.
  const since = fn('server/landsec-unit.ts', 'stageSinceFor');
  assert.equal((since.match(/db\.query\(/g) || []).length, 2);
  assert.match(since, /deal_id = ANY\(\$1\)/);
  assert.doesNotMatch(since, /\bfor\b[^\n]*\n[^\n]*db\.query/);
});

// 5 ─────────────────────────────────────────────────────────────────────────
test('5. the Landsec gateway keeps asset managers and joint agents off the unit feed and the match routes', () => {
  const P = '36c81e04-6f16-4951-8ea7-cbaf16b83741', PLAN = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', UNIT = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const calls = [
    ['GET', `/api/properties/${P}/units`], ['GET', `/api/properties/${P}/units/`], ['GET', `/API/Properties/${P}/Units`],
    ['GET', `/api/properties/${P}/units/${UNIT}`], ['GET', `/api/properties/${P}/units/tracker:${UNIT}`],
    ['GET', `/api/plans/${PLAN}/match`], ['GET', `/api/plans/${PLAN}/match/`],
    ['POST', `/api/plans/${PLAN}/match/accept`], ['POST', `/api/plans/${PLAN}/match/accept-suggested`], ['POST', `/api/plans/${PLAN}/match/dismiss`],
    ['POST', `/api/plans/${PLAN}/match/anything-new`], ['post', `/api/plans/${PLAN}/match/accept`],
  ];
  for (const role of ['asset_manager', 'joint_agent']) {
    for (const [method, path] of calls) assert.equal(restrictedLandsecApiRule(role, method, path), 'deny', `${role} ${method} ${path}`);
  }
});

// 6 ─────────────────────────────────────────────────────────────────────────
test('6. the stage words are the Letting Tracker\'s own', () => {
  for (const code of ['OPP', 'AVA', 'NEG', 'HOT', 'SOL']) assert.equal(unitStateLabel(code), LETTING_STATUS_LABELS[code], code);
  assert.deepEqual([...TRACKER_LIVE_STATUSES], ['OPP', 'AVA', 'NEG', 'HOT', 'SOL']);
  assert.equal(unitStateLabel('AVA'), 'Marketing');
  for (const key of ['occupied', 'vacant', 'unknown']) assert.equal(unitStateLabel(key), UNIT_OCCUPANCY_LABELS[key]);
});

// 7 ─────────────────────────────────────────────────────────────────────────
test('7. the plan never writes to the tenancy schedule', () => {
  const text = code(MATCH);
  assert.doesNotMatch(text, /\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+(ONLY\s+)?"?tenancy_schedule_units\b/i);
  assert.doesNotMatch(text, /\bMERGE\s+INTO\s+tenancy_schedule_units\b|\bTRUNCATE\b/i);
  const written = new Set([...text.matchAll(/\b(?:INSERT\s+INTO|DELETE\s+FROM)\s+(\w+)|\bUPDATE\s+(\w+)\s+SET\b/gi)].map(m => m[1] || m[2]));
  assert.deepEqual([...written].sort(), ['property_plan_scans', 'property_plan_units'], 'the match file writes outlines and scans only');
  // The helpers it calls to link a row read the schedule, never write it.
  assert.doesNotMatch(fn('server/property-plan-links.ts', 'validatePlanUnitLink'), /\b(INSERT|UPDATE|DELETE)\b(?!\s*")/);
  assert.doesNotMatch(fn('server/property-plan-scan-store.ts', 'expirePropertyPlanScans'), /tenancy_schedule_units/);
});

// 8 ─────────────────────────────────────────────────────────────────────────
// The older save routes, run on their own with a scripted database.
const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const SCAN_ID = '22222222-2222-4222-8222-222222222222';
const square = (x, y, s = 0.1) => ({ points: [[x, y], [x + s, y], [x + s, y + s], [x, y + s]] });
function scriptedDb({ outlineOnRow }) {
  const log = [];
  const answer = sql => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return [];
    if (/FROM property_plans WHERE id = \$1/.test(sql)) return [{ id: PLAN_ID, property_id: 'property', storage_key: 'plan.png' }];
    if (/FROM tenancy_schedule_units WHERE id = \$1 AND property_id = \$2/.test(sql)) return [{ id: 'row-1', property_unit_id: null }];
    if (/SELECT 1 FROM property_plan_units WHERE plan_id = \$1 AND/.test(sql)) return outlineOnRow ? [{ '?column?': 1 }] : [];
    if (/SELECT u\.plan_id, p\.property_id FROM property_plan_units u/.test(sql)) return [{ plan_id: PLAN_ID, property_id: 'property' }];
    if (/SELECT \* FROM property_plan_units WHERE id = \$1 AND plan_id = \$2/.test(sql)) return [{ id: 'outline-2', plan_id: PLAN_ID, tenancy_unit_id: null }];
    if (/^INSERT INTO property_plan_units/.test(sql)) return [{ id: 'outline-new' }];
    if (/^UPDATE property_plan_units/.test(sql)) return [];
    throw new Error(`unscripted query: ${sql}`);
  };
  const query = async (sql, values) => { const s = collapse(sql); log.push(s); return { rows: answer(s) }; };
  return { log, pool: { query, connect: async () => ({ query, release() {} }) } };
}
function plansRoutes(pool) {
  const handlers = new Map();
  const ast = tree(PLANS);
  const constants = ast.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'STATUS_OVERRIDES')).map(n => n.getText(ast));
  evaluate([...constants, ...['inputStatus', 'inputLabel', 'errorResponse', 'planForRequest', 'unitOwnerForRequest', 'unitForRequest'].map(name => fn(PLANS, name)),
    routeNode(PLANS, 'post', '/api/plans/:planId/units').text + ';', routeNode(PLANS, 'patch', '/api/plan-units/:id').text + ';'].join('\n'), {
    ...links, pool, requireAuth() {}, clientBlockedForProperty: async () => false,
    router: { post: (path, _auth, handler) => handlers.set(`post ${path}`, handler), patch: (path, _auth, handler) => handlers.set(`patch ${path}`, handler) },
  });
  return async (key, params, body) => {
    let status = 200, data;
    const res = { status(value) { status = value; return res; }, json(value) { data = value; return res; } };
    await handlers.get(key)({ params, body }, res);
    return { status, data };
  };
}

test('8. the older save routes refuse a second outline for one schedule row on a plan', async () => {
  for (const [key, params, body, write] of [
    ['post /api/plans/:planId/units', { planId: PLAN_ID }, { polygon: square(0.1, 0.1), tenancy_unit_id: 'row-1' }, /^INSERT INTO property_plan_units/],
    ['patch /api/plan-units/:id', { id: 'outline-2' }, { tenancy_unit_id: 'row-1' }, /^UPDATE property_plan_units/],
  ]) {
    const refused = scriptedDb({ outlineOnRow: true });
    const result = await plansRoutes(refused.pool)(key, params, body);
    assert.equal(result.status, 409, `${key}: ${JSON.stringify(result.data)}`);
    assert.match(result.data.error, /already has an outline on this floor/);
    assert.ok(!refused.log.some(sql => write.test(sql)), `${key} wrote after refusing`);
    assert.equal(refused.log.at(-1), 'ROLLBACK');
    const dup = refused.log.find(sql => /SELECT 1 FROM property_plan_units WHERE plan_id/.test(sql));
    // The same rule as the match routes: the schedule row, or the physical unit behind it.
    assert.match(dup, /tenancy_unit_id = \$2\) OR \(\$3::text IS NOT NULL AND unit_id = \$3\)/);
    if (key.startsWith('patch')) assert.match(dup, /AND id <> \$4/, 'an outline is not its own duplicate');
    const allowed = scriptedDb({ outlineOnRow: false });
    const saved = await plansRoutes(allowed.pool)(key, params, body);
    assert.equal(saved.status, 200, `${key}: ${JSON.stringify(saved.data)}`);
    assert.ok(allowed.log.some(sql => write.test(sql)), `${key} saves when the row has no outline on the plan`);
  }
});

// The match file's save functions, run with a scripted database.
function matchFunctions(extra = {}) {
  const names = ['lockScan', 'transaction', 'acceptPlanProposal', 'acceptSuggestedPlanProposals'];
  const script = [constant(MATCH, 'CANDIDATE_ID'), constant(MATCH, 'ALREADY_DRAWN'), constant(MATCH, 'saveCandidates'), constant(MATCH, 'ROWS_SQL'), constant(MATCH, 'matchRow'),
    ...names.map(name => fn(MATCH, name)), `exports.acceptPlanProposal = acceptPlanProposal; exports.acceptSuggestedPlanProposals = acceptSuggestedPlanProposals;`].join('\n');
  return evaluate(script, {
    requirePropertyPlan, validPlanId, PropertyPlanScanError, planPoints, isValidPolygon, planPolygonsOverlap,
    validatePlanUnitLink: links.validatePlanUnitLink, bulkAcceptable, JSON,
    openPlanCandidates: candidates => candidates, suggestPlanMatches: () => { throw new Error('not scripted'); }, ...extra,
  });
}
function scanDb({ candidates, outlines, rows = [], live = true }) {
  const log = [];
  const answer = sql => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return [];
    if (/FROM property_plans WHERE id = \$1/.test(sql)) return [{ id: PLAN_ID, property_id: 'property', storage_key: 'plan.png', floor: 'Ground' }];
    if (/FROM property_plan_scans WHERE id = \$1 AND plan_id = \$2 FOR UPDATE/.test(sql)) return [{ id: SCAN_ID, plan_id: PLAN_ID, image_key: 'plan.png', status: 'ready', candidates }];
    if (/FROM property_plan_units WHERE plan_id = \$1 ORDER BY id FOR UPDATE/.test(sql)) return outlines;
    if (/FROM tenancy_schedule_units WHERE id = \$1 AND property_id = \$2/.test(sql)) return [{ id: 'row', property_unit_id: null }];
    if (/\) live WHERE live\.id = \$2/.test(sql)) return live ? [{ '?column?': 1 }] : [];
    if (/FROM tenancy_schedule_units t/.test(sql)) return rows;
    if (/^INSERT INTO property_plan_units/.test(sql)) return [{ id: `outline-${log.filter(s => s.startsWith('INSERT')).length}` }];
    if (/^UPDATE property_plan_scans SET candidates/.test(sql)) return [];
    throw new Error(`unscripted query: ${sql}`);
  };
  const query = async sql => { const s = collapse(sql); log.push(s); return { rows: answer(s) }; };
  return { log, db: { query, connect: async () => ({ query, release() {} }) } };
}

test('8. acceptPlanProposal refuses a second outline for one schedule row on a plan', async () => {
  const { acceptPlanProposal } = matchFunctions();
  const candidates = [{ id: 'candidate-1', label: 'A1', polygon: square(0.6, 0.6) }];
  const taken = scanDb({ candidates, outlines: [{ id: 'outline-a', label: 'A1 (old)', polygon: square(0.1, 0.1), tenancy_unit_id: 'row-1', unit_id: null }] });
  await assert.rejects(acceptPlanProposal(taken.db, PLAN_ID, SCAN_ID, { candidateId: 'candidate-1', scheduleRowId: 'row-1' }, async () => true),
    error => error.status === 409 && /already has an outline on this floor/.test(error.message));
  assert.ok(!taken.log.some(sql => sql.startsWith('INSERT')), 'nothing is drawn');
  assert.equal(taken.log.at(-1), 'ROLLBACK');
  const free = scanDb({ candidates, outlines: [{ id: 'outline-a', label: 'B1', polygon: square(0.1, 0.1), tenancy_unit_id: 'row-2', unit_id: null }] });
  const saved = await acceptPlanProposal(free.db, PLAN_ID, SCAN_ID, { candidateId: 'candidate-1', scheduleRowId: 'row-1' }, async () => true);
  assert.equal(saved.reused, false);
  assert.ok(free.log.some(sql => sql.startsWith('INSERT INTO property_plan_units')));
  // An archived schedule row is not a unit, so nothing is drawn onto it.
  const archived = scanDb({ candidates, outlines: [], live: false });
  await assert.rejects(acceptPlanProposal(archived.db, PLAN_ID, SCAN_ID, { candidateId: 'candidate-1', scheduleRowId: 'row-1' }, async () => true),
    error => error.status === 400 && /archived/.test(error.message));
  assert.ok(!archived.log.some(sql => sql.startsWith('INSERT')), 'nothing is drawn on an archived row');
});

// 9 ─────────────────────────────────────────────────────────────────────────
test('9. bulk acceptance takes only what bulkAcceptable allows', async () => {
  const body = fn(MATCH, 'acceptSuggestedPlanProposals');
  assert.match(collapse(body), /const suggested = suggestPlanMatches\(.*\)\.filter\(bulkAcceptable\);/);
  assert.match(body, /for \(const proposal of suggested\)/);
  const proposal = (n, extra) => ({ id: `candidate-${n}`, label: `U${n}`, tenant: null, polygon: square(0.1 * n, 0.1, 0.05), suggestedRowId: `row-${n}`, method: 'code', possibleRowIds: [], tenantDiffers: false, floorDiffers: false, ...extra });
  const proposals = [proposal(1), proposal(2, { method: 'tenant' }), proposal(3, { method: 'floor' }), proposal(4, { tenantDiffers: true }), proposal(5, { floorDiffers: true }), proposal(6, { suggestedRowId: null, method: null })];
  assert.deepEqual(proposals.map(bulkAcceptable), [true, true, false, false, false, false]);
  const { acceptSuggestedPlanProposals } = matchFunctions({ suggestPlanMatches: () => proposals });
  const run = scanDb({ candidates: proposals.map(p => ({ id: p.id, label: p.label, polygon: p.polygon })), outlines: [] });
  const result = await acceptSuggestedPlanProposals(run.db, PLAN_ID, SCAN_ID, async () => true);
  assert.equal(result.created, 2);
  assert.equal(JSON.stringify(result.skipped), '[]');
  assert.equal(run.log.filter(sql => sql.startsWith('INSERT INTO property_plan_units')).length, 2);
});

// 10 ────────────────────────────────────────────────────────────────────────
test('10. the feed matches brands for the whole schedule with the resolver\'s own normalisation', async () => {
  process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:1/test';   // the module opens no connection until it is asked a question
  const resolver = await import('../../server/tenant-brand-resolver.ts');
  const perRow = resolver.resolveBrandIdSubquery('x');
  const key = resolver.brandNameKeySql('x');
  // The same company-suffix list and the same two replacements, word for word.
  const suffixes = /'\\s\+\((?:[a-z]+\|)+[a-z]+\)\\\.\?\$'/;
  assert.match(perRow, suffixes);
  assert.equal(perRow.match(suffixes)[0], key.match(suffixes)[0], 'one list of company suffixes');
  assert.ok(perRow.includes("'[^a-z0-9]+', ' ', 'g'") && key.includes("'[^a-z0-9]+', ' ', 'g'"), 'one rule for punctuation');
  assert.match(resolver.BRAND_KEYS_CTE, /DISTINCT ON \(norm_key\)[\s\S]*merged_into_id IS NULL[\s\S]*trading_entities[\s\S]*ORDER BY norm_key, brand_id/, 'every brand name and trading-entity name, one brand per key, the same one each time');
  // The feed uses the set form, never the per-row subquery (about two seconds on a 190-row schedule).
  const feed = source('server/property-units.ts');
  assert.match(feed, /WITH \$\{BRAND_KEYS_CTE\}/);
  assert.doesNotMatch(feed, /resolveBrandIdSubquery/);
});
