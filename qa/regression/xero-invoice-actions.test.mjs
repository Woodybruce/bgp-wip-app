// Xero invoices worked from the app (Woody, 20 November 2026: see and edit the
// draft in the app, delete it when the transaction is deleted, approve and
// email from the app "so layla doesn't need to go on to Xero"; 24 November
// 2026, asked who may approve and send: "xero all admin"). Source guards; the
// rules are tested in server/xero-invoice.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const actions = read('server/xero-invoice-actions.ts');
const xero = read('server/xero.ts');

const route = (method, path) => {
  const at = actions.indexOf(`app.${method}("${path}"`);
  assert.ok(at >= 0, `missing route ${method} ${path}`);
  const next = actions.indexOf('\n  app.', at + 10);
  return actions.slice(at, next < 0 ? undefined : next);
};

test('only an admin approves, emails and voids; any BGP person reads, changes and deletes a draft', () => {
  for (const p of ['/api/xero/invoices/:id/approve', '/api/xero/invoices/:id/email', '/api/xero/invoices/:id/void', '/api/xero/invoices/:id/recipients']) {
    assert.match(route(p === '/api/xero/invoices/:id/recipients' ? 'get' : 'post', p), /if \(!me\?\.admin\) return res\.status\(403\)/, p);
  }
  for (const [m, p] of [['get', '/api/xero/invoices/:id/detail'], ['get', '/api/xero/invoices/:id/pdf'], ['put', '/api/xero/invoices/:id'], ['post', '/api/xero/invoices/:id/delete-draft'], ['delete', '/api/xero/invoices/:id']]) {
    assert.match(route(m, p), /if \(!me\) return res\.status\(403\)/, `${m} ${p}`);
  }
  // Admin is requireAdmin's test: is_admin or ADMIN_EMAILS; staff signed in as themselves.
  const who = actions.slice(actions.indexOf('async function caller('), actions.indexOf('async function rowOf('));
  assert.match(who, /contactViewer\(req\)\)\.staff/);
  assert.match(who, /admin: !!u\.is_admin \|\| ADMIN_EMAILS\.has\(email\)/);
});

test('writes go through the person\'s own Xero login; a stopped transaction is neither approved nor emailed', () => {
  assert.match(route('post', '/api/xero/invoices/:id/approve'), /fetchInvoice\(req\.session, row\.xeroInvoiceId, true\)/);
  assert.match(route('post', '/api/xero/invoices/:id/approve'), /const stop = await stopped\(row\.dealId\);/);
  assert.match(route('post', '/api/xero/invoices/:id/email'), /const stop = await stopped\(row\.dealId\);/);
  assert.match(route('put', '/api/xero/invoices/:id'), /xeroApi\(req\.session, "\/Invoices", \{ method: "POST"/);
  // The old routes in server/xero.ts are gone, so these are the ones that answer.
  assert.doesNotMatch(xero, /app\.put\("\/api\/xero\/invoices\/:id"/);
  assert.doesNotMatch(xero, /app\.delete\("\/api\/xero\/invoices\/:id"/);
  const index = read('server/index.ts');
  assert.ok(index.indexOf('setupXeroRoutes(app);') < index.indexOf('setupXeroInvoiceRoutes(app);'));
});

test('a changed draft names its contact by the Xero id only, and every line is sent', () => {
  const rules = read('shared/xero-invoice.ts');
  assert.match(rules, /if \(edit\.contactId\) payload\.Contact = \{ ContactID: edit\.contactId \};/);
  assert.doesNotMatch(actions, /Contact: \{ Name/);
  assert.match(route('put', '/api/xero/invoices/:id'), /AccountCode: salesAccountCode\(l\.AccountCode\)/);
});

test('emailing goes once: an idempotency key, then asks before a second send within ten minutes; a blank address only is filled', () => {
  const email = actions.slice(actions.indexOf('async function emailInvoice('), actions.indexOf('app.post("/api/xero/invoices/:id/approve"'));
  assert.match(email, /headers: \{ "Idempotency-Key": `email-\$\{key\}` \}/);
  assert.match(email, /code: "SENT_RECENTLY"/);
  assert.match(email, /if \(!recipients\.primary && !recipients\.others\.length\) \{/);
  assert.match(email, /ContactPersons: contact\.ContactPersons/, 'the contact persons go back as they were');
  assert.match(email, /SentToContact: true/);
});

test('deleting a transaction deletes its drafts in Xero first and keeps it while an approved or paid invoice stands', () => {
  const storage = read('server/storage.ts');
  const del = storage.slice(storage.indexOf('async deleteCrmDeal(id: string)'), storage.indexOf('async getDealFeeAllocations'));
  assert.ok(del.indexOf('xeroBeforeDealDelete([id], null)') > 0 && del.indexOf('xeroBeforeDealDelete([id], null)') < del.indexOf('db.transaction'));
  assert.match(del, /throw Object\.assign\(new Error\(xero\.message\), \{ code: xero\.code, status: 409 \}\)/);
  assert.match(del, /await tx\.delete\(xeroInvoices\)\.where\(eq\(xeroInvoices\.dealId, id\)\);/);
  const crm = read('server/crm.ts');
  for (const from of ['app.post("/api/crm/deals/bulk-delete"', 'app.delete("/api/crm/deals/:id"']) {
    const body = crm.slice(crm.indexOf(from), crm.indexOf('\n  });', crm.indexOf(from)));
    assert.ok(body.indexOf('xeroBeforeDealDelete(') > 0 && body.indexOf('xeroBeforeDealDelete(') < body.indexOf('storage.deleteCrmDeal('), from);
  }
  // ChatBGP says why a transaction was kept.
  const chat = read('server/chatbgp.ts');
  assert.equal((chat.match(/try \{ await deleteFn\(fnArgs\.id\); \} catch \(e: any\) \{ if \(e\?\.status === 409\)/g) || []).length, 2);
  assert.match(read('server/models.ts'), /try \{ await deleteFn\(input\.id\); \} catch \(e: any\) \{ if \(e\?\.status === 409\)/);
  // A draft Xero could not be reached for keeps the transaction.
  const guard = actions.slice(actions.indexOf('export async function xeroBeforeDealDelete('), actions.indexOf('export function setupXeroInvoiceRoutes('));
  assert.match(guard, /code: "XERO_UNREACHABLE"/);
  assert.match(guard, /Status: "DELETED"/);
});

test('the window offers only what the server says this person may do', () => {
  const win = read('client/src/components/xero-invoice-window.tsx');
  for (const a of ['actions.approve', 'actions.email', 'actions.void', 'actions.deleteDraft', 'actions.edit', 'actions.pdf']) assert.ok(win.includes(`{${a} && (`), a);
  const deals = read('client/src/pages/deals.tsx');
  assert.match(deals, /<XeroInvoiceWindow/);
  assert.match(deals, /if \(out\?\.invoice\?\.id\) setOpenInvoice\(String\(out\.invoice\.id\)\);/);
});

test('a client login never reads the invoice lines on a transaction\'s history', () => {
  assert.match(read('server/crm.ts'), /!\/\^\(aml\|kyc\|client_checks\|xero\)\/i\.test\(String\(l\.field \|\| ""\)\)/);
});
