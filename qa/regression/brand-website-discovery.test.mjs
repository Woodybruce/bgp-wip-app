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
