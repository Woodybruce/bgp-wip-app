import test from 'node:test';
import assert from 'node:assert/strict';
import { softRedirectTarget, discoverAndVerifyBrandWebsite, readBrandOfficialEvidence } from '../../server/brand-identity-verification.ts';

const HG_HOME = `<!DOCTYPE html><html lang="es"><head><meta http-equiv="refresh" content="0; url=/es/" /><script>
const supported = ['es', 'en', 'ca', 'pt', 'fr']; const redirectLang = supported.includes(lang) ? lang : 'es';
window.location.replace(\`/\${redirectLang}/\`);</script></head><body></body></html>`;

test('a language-redirect placeholder homepage resolves to the English page', () => {
  assert.equal(softRedirectTarget(HG_HOME, 'https://www.honestgreens.com/', 'honestgreens.com'), 'https://www.honestgreens.com/en/');
  assert.equal(softRedirectTarget('<meta http-equiv="refresh" content="0; url=/home">', 'https://brand.com/', 'brand.com'), 'https://brand.com/home');
  assert.equal(softRedirectTarget('<link rel="alternate" hreflang="en-gb" href="https://brand.com/uk/">', 'https://brand.com/', 'brand.com'), 'https://brand.com/uk/');
});

test('soft redirects never leave the site and never fire on a real homepage', () => {
  assert.equal(softRedirectTarget('<meta http-equiv="refresh" content="0; url=https://evil.example/">', 'https://brand.com/', 'brand.com'), null);
  assert.equal(softRedirectTarget(`<meta http-equiv="refresh" content="0; url=/es/"><p>${'Real content about the brand. '.repeat(20)}</p>`, 'https://brand.com/', 'brand.com'), null);
});

test('evidence is read from the English landing page, not the empty homepage', async () => {
  const calls = [];
  const pages = await readBrandOfficialEvidence('honestgreens.com', async url => {
    calls.push(url);
    return { url, html: url.endsWith('/en/') ? '<p>Honest Greens - Chef Driven Real Food</p><a href="/en/legal-notice">Legal Notice</a>' : url.includes('legal') ? '<p>Legal notice</p>' : HG_HOME };
  });
  assert.deepEqual(calls, ['https://honestgreens.com/', 'https://honestgreens.com/en/', 'https://honestgreens.com/en/legal-notice']);
  assert.match(pages[0].text, /Honest Greens/);
});

function database(current) {
  const writes = [];
  const client = { query: async (sql, values) => { writes.push({ sql, values }); return { rows: sql.startsWith('SELECT * FROM crm_companies') ? [current] : [], rowCount: 1 }; }, release() {} };
  return { writes, connect: async () => client, query: client.query };
}
const hg = () => ({ id: 'hg', name: 'Honest Greens', company_type: 'Tenant', industry: 'Fast-casual restaurant', domain: null, domain_url: null, website: null, updated_at: '2026-09-03T04:27:24Z', ai_generated_fields: {} });
const operatorQuote = 'Honest Greens - Chef Driven Real Food & Specialty Coffee';
const businessQuote = 'Real food Revolution. Market Plates Garden Bowls and specialty coffee in our restaurants.';
const page = url => ({ url, html: `<p>${operatorQuote}</p><p>${businessQuote}</p>` });
const verdict = (domain) => ({ decision: 'verified', confidence: 0.97, brandName: 'Honest Greens', officialDomain: domain, relationship: 'operator', operatesOfficialWebsite: true, conflicts: [], reason: 'Own site',
  evidence: [{ url: `https://${domain}/`, quote: operatorQuote, kind: 'operator' }, { url: `https://${domain}/`, quote: businessQuote, kind: 'business' }] });

test('an obvious discovered website is verified and saved automatically', async () => {
  const row = hg(), db = database(row);
  const result = await discoverAndVerifyBrandWebsite(db, row, { candidates: async () => ['deliveroo.co.uk', 'honestgreens.com'].filter(d => d !== 'deliveroo.co.uk'), fetchPage: async url => page(url), assess: async c => verdict(c.domain) });
  assert.equal(result.status, 'ready'); assert.equal(result.domain, 'honestgreens.com');
  const update = db.writes.find(w => w.sql.startsWith('UPDATE crm_companies'));
  assert.ok(update.values.includes('honestgreens.com'));
  const meta = update.values.map(v => { try { return JSON.parse(v); } catch { return null; } }).find(v => v?.brand_identity);
  assert.equal(meta.brand_identity.status, 'verified'); assert.equal(meta.brand_identity.verifiedBy, 'official-website-discovered');
});

test('an unproven discovery is only suggested, never saved as the identity', async () => {
  const row = hg(), db = database(row);
  const result = await discoverAndVerifyBrandWebsite(db, row, { candidates: async () => ['honestgreens.com'], fetchPage: async url => page(url), assess: async c => ({ ...verdict(c.domain), confidence: 0.7 }) });
  assert.equal(result.status, 'needs_review');
  assert.equal(db.writes.some(w => w.sql.startsWith('UPDATE crm_companies SET domain') || /brand_identity/.test(JSON.stringify(w.values || []))), false);
  assert.ok(db.writes.some(w => /website_suggestion/.test(w.sql)));
});

test('discovery never overrides a saved website', async () => {
  let asked = 0;
  const result = await discoverAndVerifyBrandWebsite(database(hg()), { ...hg(), website: 'https://wrong.example' }, { candidates: async () => { asked++; return []; } });
  assert.equal(result.status, 'needs_review'); assert.equal(asked, 0);
});

import { registrableLabel, isDeadWebsiteError, verifyBrandIdentityFromOfficialSite, OfficialSiteRedirectError } from '../../server/brand-identity-verification.ts';

test('registrable label matches a brand across .co.uk / .com / www', () => {
  assert.equal(registrableLabel('www.honestgreens.co.uk'), 'honestgreens');
  assert.equal(registrableLabel('honestgreens.com'), 'honestgreens');
  assert.equal(registrableLabel('shop.brand.com'), 'brand');
  assert.notEqual(registrableLabel('brand.com'), registrableLabel('otherbrand.com'));
});

test('dead-website detection is limited to a missing domain or refused connection', () => {
  assert.equal(isDeadWebsiteError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND x.com' }), true);
  assert.equal(isDeadWebsiteError(new Error('connect ECONNREFUSED 1.2.3.4:443')), true);
  assert.equal(isDeadWebsiteError(new Error('Official website verification timed out')), false);
  assert.equal(isDeadWebsiteError(new Error('getaddrinfo EAI_AGAIN x.com')), false);
});

test('a saved brand.co.uk forwarding to brand.com is verified on, and saved as, brand.com', async () => {
  const row = { ...hg(), domain: 'honestgreens.co.uk', domain_url: 'https://honestgreens.co.uk', website: null }, db = database(row);
  const result = await verifyBrandIdentityFromOfficialSite(db, row, async (url, domain) => {
    if (domain === 'honestgreens.co.uk') throw new OfficialSiteRedirectError('honestgreens.com');
    return page(url);
  }, async c => verdict(c.domain));
  assert.equal(result.status, 'ready');
  const meta = db.writes.find(w => w.sql.startsWith('UPDATE crm_companies')).values.map(v => { try { return JSON.parse(v); } catch { return null; } }).find(v => v?.brand_identity);
  assert.equal(meta.brand_identity.domain, 'honestgreens.com'); assert.equal(meta.brand_identity.verifiedBy, 'official-website-replaced');
});

test('a forward to an unrelated domain is still refused', async () => {
  const row = { ...hg(), domain: 'honestgreens.co.uk' }, db = database(row);
  await assert.rejects(() => verifyBrandIdentityFromOfficialSite(db, row, async () => { throw new OfficialSiteRedirectError('parkingpage.net'); }, async () => null), /different website/);
  assert.equal(db.writes.length, 0);
});

test('a dead saved website is replaced only when a discovered site proves out', async () => {
  const row = { ...hg(), domain: 'honestgreens.old' }, db = database(row);
  const ok = await discoverAndVerifyBrandWebsite(db, row, { replaceDeadWebsite: true, candidates: async () => ['honestgreens.old', 'honestgreens.com'], fetchPage: async url => page(url), assess: async c => verdict(c.domain) });
  assert.equal(ok.status, 'ready'); assert.equal(ok.domain, 'honestgreens.com'); assert.deepEqual(ok.tried, ['honestgreens.com']);
  const db2 = database(row);
  const no = await discoverAndVerifyBrandWebsite(db2, row, { replaceDeadWebsite: true, candidates: async () => ['honestgreens.com'], fetchPage: async url => page(url), assess: async c => ({ ...verdict(c.domain), confidence: 0.5 }) });
  assert.equal(no.status, 'needs_review'); assert.equal(db2.writes.some(w => /brand_identity/.test(JSON.stringify(w.values || []))), false);
});
