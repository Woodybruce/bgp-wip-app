import test from 'node:test';
import assert from 'node:assert/strict';
// kyc4u.ts imports the db module, which only needs a URL to load.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:1/test';
const { requestsFromLibrary } = await import('../../server/kyc4u.ts');

const base = '/sites/customers/CST1092/Shared Documents';
const f = (id, path, type = 0, modified = '2026-09-28T14:25:00Z') => ({ id: String(id), fields: { FileRef: `${base}/${path}`, FSObjType: type }, created: modified, modified });

test('KYC4U request folders fold into one request each', () => {
  const out = requestsFromLibrary({ id: 'lib', name: 'Documents', items: [
    f(1, 'REQ113355  Iris Ave Ltd', 1),
    f(2, 'REQ113355  Iris Ave Ltd/1.0 HOTs', 1),
    f(3, 'REQ113355  Iris Ave Ltd/1.0 HOTs/HoTs signed.pdf'),
    f(4, 'REQ113355  Iris Ave Ltd/2.0 KYC Entity/Certificate.pdf'),
    f(5, 'REQ113355  Iris Ave Ltd/5.0 UBOs/Passport.pdf', 0, '2026-09-28T15:00:00Z'),
    f(6, 'REQ113400 Nando\'s Chickenland Ltd/Cover note.pdf'),
    f(7, 'Templates/Blank form.docx'),
  ] }, 'https://kyc4ultd.sharepoint.com');
  assert.equal(out.id, 'lib:requests');
  assert.equal(out.items.length, 2);
  const iris = out.items.find(i => i.id === 'REQ113355');
  assert.equal(iris.fields.Entity, 'Iris Ave Ltd');
  assert.equal(iris.fields.Files, 3);
  assert.equal(iris.fields.Status, '3 files · HOTs, KYC Entity, UBOs');
  assert.equal(iris.modified, '2026-09-28T15:00:00Z');
  assert.match(iris.url, /^https:\/\/kyc4ultd\.sharepoint\.com\/sites\/customers\/CST1092\/Shared%20Documents\/REQ113355%20%20Iris%20Ave%20Ltd$/);
  const nandos = out.items.find(i => i.id === 'REQ113400');
  assert.equal(nandos.fields.Entity, "Nando's Chickenland Ltd");
  assert.equal(nandos.fields.Status, '1 file');
});

test('a library with no request folders gives nothing', () => {
  assert.equal(requestsFromLibrary({ id: 'lib', name: 'Documents', items: [f(1, 'Templates/x.docx')] }), null);
});

test('a nested REQ-number folder is not read as a section', () => {
  const out = requestsFromLibrary({ id: 'lib', name: 'Documents', items: [
    f(1, 'REQ113355  Iris Ave Ltd/REQ113355/1.0 HOTs/a.pdf'),
    f(2, 'REQ113355  Iris Ave Ltd/REQ113355/5.0 UBOs/b.pdf'),
  ] });
  assert.equal(out.items[0].fields.Status, '2 files · HOTs, UBOs');
});

test('KYC4U entity names give the names a CRM company goes by', async () => {
  const { entityNameCandidates } = await import('../../server/kyc4u.ts');
  const enmei = entityNameCandidates('ENMEI CANARY WHARF LIMITED Company number 17152601');
  assert.equal(enmei.chNumber, '17152601');
  assert.ok(enmei.names.includes('ENMEI CANARY WHARF LIMITED'));
  assert.ok(enmei.names.includes('ENMEI CANARY'));
  const cf = entityNameCandidates('SPORTSWIFT LTD _Card Factory_');
  assert.ok(cf.names.includes('SPORTSWIFT LTD'));
  assert.ok(cf.names.includes('Card Factory'));
  assert.ok(entityNameCandidates('Waterstones Booksellers Limited').names.includes('Waterstones'));
  assert.ok(!entityNameCandidates('Amelia Vero Ltd').names.includes('Amelia'));
  assert.ok(!entityNameCandidates('Restaurant Counter Limited').names.includes('Restaurant'));
  assert.ok(entityNameCandidates('Etta Health _London_ Limited').names.includes('Etta Health London Limited'));
});
