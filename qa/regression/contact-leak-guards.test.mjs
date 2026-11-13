// BGP's contact record is for BGP staff (contact board plan, WP-A, 2026-11-13):
// a client login is never sent a contact's last interaction or the rest of
// the stored crm_contacts row, and a property's client-team link is changed
// only on the property it belongs to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, route, evaluate, ts } = require('./source-harness.cjs');

const CRM = 'server/crm.ts';
const BRIEF = 'server/property-asset-brief.ts';
const plain = value => JSON.parse(JSON.stringify(value));

test('the staff test is one function, built on the landlord meetings check', () => {
  const viewer = source('server/contact-viewer.ts');
  assert.match(viewer, /export async function contactViewer\(req: Request\): Promise<\{ staff: boolean \}>/);
  assert.match(viewer, /await import\("\.\/landlord-meetings"\)/);
  assert.match(viewer, /staff: await canReadLandlordMeetings\(req\)/);
});

test('the /clients read asks contactViewer and builds the client contact from an explicit list', () => {
  const get = route(CRM, 'get', '/api/crm/properties/:id/clients');
  assert.match(get, /contactViewer\(req\)/);
  const clientBranch = get.slice(get.indexOf('contactViewer'), get.indexOf('const result'));
  assert.doesNotMatch(clientBranch, /\.\.\.\s*(contact|l)\b/, 'no spread of the stored rows in the client branch');
  assert.match(clientBranch, /contact: contact \? \{ id: contact\.id, name: contact\.name, role: contact\.role, email: contact\.email, phone: contact\.phone, companyId: contact\.companyId \}/);
});

function clientsGet({ staff, scope = null, inScope = true }) {
  let handler;
  const links = [{ id: 'link-1', propertyId: 'p1', contactId: 'c1', role: 'Asset manager', createdAt: '2026-01-01' }];
  const contacts = [{ id: 'c1', name: 'Ann Owner', role: 'Director', email: 'ann@owner', phone: '0207', companyId: 'owner',
    lastInteraction: '2031-01-01', notes: 'CANARY-NOTE', enrichmentSource: 'CANARY-ENRICH', bgpContactUserIds: ['canary-user-id'] }];
  let call = 0;
  const db = { select: () => ({ from: () => ({ where: async () => (call++ === 0 ? links : contacts) }) }) };
  evaluate(route(CRM, 'get', '/api/crm/properties/:id/clients'), {
    app: { get: (_p, fn) => { handler = fn; } },
    db, eq: () => null, inArray: () => null,
    crmPropertyClients: { propertyId: 'property_id' }, crmContacts: { id: 'id' },
    resolveCompanyScope: async () => scope, isPropertyInScope: async (s, id) => { assert.equal(s, scope); assert.equal(id, 'p1'); return inScope; },
    contactViewer: async () => ({ staff }),
  });
  return async () => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ params: { id: 'p1' } }, res);
    return res;
  };
}

test('a client login is sent the person and nothing else of the contact record', async () => {
  const res = await clientsGet({ staff: false, scope: 'owner' })();
  assert.equal(res.code, 200);
  const body = plain(res.body);
  assert.deepEqual(body, [{ id: 'link-1', propertyId: 'p1', contactId: 'c1', role: 'Asset manager',
    contact: { id: 'c1', name: 'Ann Owner', role: 'Director', email: 'ann@owner', phone: '0207', companyId: 'owner' } }]);
  const json = JSON.stringify(body);
  for (const canary of ['2031', 'CANARY-NOTE', 'CANARY-ENRICH', 'canary-user-id', 'lastInteraction']) assert.equal(json.includes(canary), false, canary);
});

test('a client login is refused the client team of a property it does not own', async () => {
  const res = await clientsGet({ staff: false, scope: 'owner', inScope: false })();
  assert.equal(res.code, 403);
  assert.equal(JSON.stringify(res.body).includes('Ann Owner'), false);
});

test('BGP staff still get the whole contact on /clients', async () => {
  const res = await clientsGet({ staff: true })();
  assert.equal(res.body[0].contact.lastInteraction, '2031-01-01');
  assert.equal(res.body[0].createdAt, '2026-01-01');
});

for (const method of ['put', 'delete']) {
  test(`${method.toUpperCase()} on a client-team link checks the link is on the property in the address`, async () => {
    const handlerSource = route(CRM, method, '/api/crm/properties/:id/clients/:clientId');
    assert.match(handlerSource, /and\(eq\(crmPropertyClients\.id, req\.params\.clientId\), eq\(crmPropertyClients\.propertyId, req\.params\.id\)\)/);
    let handler; const wheres = [];
    const chain = { set: () => chain, where: w => { wheres.push(w); return chain; }, returning: async () => [], then: undefined };
    const db = { update: () => chain, delete: () => ({ where: async w => { wheres.push(w); } }) };
    evaluate(handlerSource, {
      app: { [method]: (_p, fn) => { handler = fn; } }, db,
      eq: (col, val) => ({ col, val }), and: (...parts) => parts,
      crmPropertyClients: { id: 'id', propertyId: 'property_id' },
    });
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ params: { id: 'p1', clientId: 'link-on-p2' }, body: { role: 'Director' } }, res);
    assert.deepEqual(plain(wheres[0]), [{ col: 'id', val: 'link-on-p2' }, { col: 'property_id', val: 'p1' }]);
    if (method === 'put') assert.equal(res.code, 404, 'a link on another property is not found here');
  });
}

test('linked-contacts asks contactViewer and only adds last_interaction for staff', () => {
  const handler = ts.createSourceFile(BRIEF, source(BRIEF), ts.ScriptTarget.Latest, true);
  let text = '';
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(handler) === 'router.get' && node.arguments[0]?.text === '/api/properties/:id/linked-contacts') text = node.getText(handler);
    ts.forEachChild(node, visit);
  };
  visit(handler);
  assert.ok(text, 'route found');
  assert.match(text, /const \{ staff \} = await contactViewer\(req\)/);
  assert.ok(text.indexOf('contactViewer(req)') < text.indexOf('res.json('), 'the viewer is known before the reply is built');
  const outsideSql = text.replace(/`[\s\S]*?`/g, '``').replace(/^\s*\/\/.*$/gm, '');
  const mentions = outsideSql.match(/last_interaction/g) || [];
  assert.equal(mentions.length, 2, 'last_interaction is written in one place (and read once), outside the SQL');
  assert.match(outsideSql, /const lastInteraction = \(r: any\) => \(staff \? \{ last_interaction: r\.last_interaction \?\? null \} : \{\}\)/);
});
