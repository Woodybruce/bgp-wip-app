import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');

// The BGP team is the first group of Key contacts on landlord and brand pages
// (Woody, 2026-11-14). It keeps what the old landlord team block did: each
// person's emails and meetings with the landlord open their own history, and
// a client login gets the people on the account and nothing of BGP's record.
const file = 'client/src/components/company-bgp-team.tsx';
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
function load(bindings) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const kept = ast.statements.filter(n => ts.isVariableStatement(n) || (ts.isFunctionDeclaration(n) && n.name?.text === 'CompanyBgpTeam'));
  const tags = {};
  for (const n of ast.statements) if (ts.isImportDeclaration(n)) for (const el of n.importClause?.namedBindings?.elements || []) tags[el.name.text] = el.name.text;
  const sandbox = { exports: {}, ...tags, canonicalBgpRole: v => v || null, BGP_ACCOUNT_ROLES: [], LANDLORD_TEAM_ROLES: ['Relationship lead'], ...bindings };
  vm.runInNewContext(ts.transpileModule(`${kept.map(n => n.getText(ast)).join('\n')}\nexports.component = CompanyBgpTeam;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, { ...sandbox, React });
  return sandbox.exports.component;
}
const member = { id: 'sam', name: 'Sam Morgan', title: 'Director', profilePicUrl: null, email: 'sam@example.test', phone: null, active: true, assigned: true, assignedRole: 'Relationship lead', emailCount: 12, meetingCount: 3, dealCount: 2, conversationCount: 4, lastInteractionAt: '2026-10-27T10:00:00Z', contexts: [{ id: 'tenant-role', role: 'Tenant representative', propertyId: 'high-street', propertyName: 'High Street', origin: 'suggested', notes: 'Tenant-side work only.', sources: [] }] };
function harness({ staff = true, members = [member, { ...member, id: 'jo', name: 'Jo Reed' }], coverers = [] } = {}) {
  let index = 0; const state = [];
  const render = load({
    useState: initial => { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; },
    useQueryClient: () => ({ invalidateQueries: () => {} }), useToast: () => ({ toast: () => {} }), useMutation: () => ({ mutate: () => {}, isPending: false }),
    useQuery: ({ queryKey, enabled }) => ({ data: enabled === false ? undefined : queryKey[0] === '/api/users' ? [] : { members, properties: [], issues: [] } }),
  });
  return () => { index = 0; return render({ companyId: 'landlord', companyName: 'Example Estates', coverers, landlord: true, staff }); };
}
const plain = v => JSON.parse(JSON.stringify(v));
const group = tree => nodes(tree).find(n => n.type === 'BgpTeamGroup');

test('each person’s emails and meetings open only their own history', () => {
  const tree = harness();
  const people = group(tree()).props.people;
  assert.deepEqual(plain(people.map(p => p.name)), ['Sam Morgan', 'Jo Reed']);
  assert.deepEqual(plain(people[0].history.map(h => h.label)), ['12 emails', '3 meetings', '2 transactions', '4 chat messages']);
  assert.match(people[0].note, /Suggested from records: Tenant representative · High Street/);
  assert.equal(people[0].email, 'sam@example.test');
  assert.equal(nodes(tree()).some(n => n.type === 'BrandEmailHistory' || n.type === 'LandlordMeetingsHistory'), false);
  people[0].history[0].onOpen();
  let dialog = nodes(tree()).find(n => n.type === 'BrandEmailHistory');
  assert.equal(dialog.props.landlord, true);
  assert.deepEqual(JSON.parse(JSON.stringify(dialog.props.person)), { userId: 'sam', name: 'Sam Morgan' });
  dialog.props.onOpenChange(false);
  assert.equal(nodes(tree()).some(n => n.type === 'BrandEmailHistory'), false);
  group(tree()).props.people[1].history[1].onOpen();
  dialog = nodes(tree()).find(n => n.type === 'LandlordMeetingsHistory');
  assert.deepEqual(JSON.parse(JSON.stringify(dialog.props.person)), { userId: 'jo', name: 'Jo Reed' });
  assert.equal(dialog.props.initialPeriod, 'recent');
});

test('a client login sees the people on the account and none of BGP’s record', () => {
  const tree = harness({ staff: false, coverers: [{ id: 'sam', name: 'Sam Morgan', email: 'sam@example.test', role: 'Relationship lead', threads: 40, last_touch: '2026-10-27T10:00:00Z' }] });
  const g = group(tree());
  assert.equal(g.props.addControl, null);
  const [p] = g.props.people;
  assert.deepEqual(plain(p.roles), ['Relationship lead']);
  assert.deepEqual(plain(p.history), []);
  assert.equal(p.lastAt, null);
  assert.equal(p.note, null);
  assert.equal(g.props.menuFor(p), null);
});
