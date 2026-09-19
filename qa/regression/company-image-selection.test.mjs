import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { selectCompanyHeroImage, rankCompanyHeroImages, companyImageHeroIssue, isCompanyImageLogo } from '../../shared/brand-image-selection.ts';
import { publishableBrandImage } from '../../server/brand-publishing.ts';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const photo = (id, kind = 'storefront', extra = {}) => ({ id, width: 1600, height: 1000, file_name: 'Shop photograph', tags: ['image-quality:v1', `image-kind:${kind}`, 'image-quality-score:85'], ...extra });

test('a saved logo, graphic, thumbnail or panoramic banner cannot become the cover even when pinned', () => {
  for (const image of [photo('logo', 'logo'), photo('logo', 'storefront', { source: 'website-logo' }),
    photo('logo', 'storefront', { file_name: 'COOK — Logo' }), photo('graphic', 'graphic'),
    photo('small', 'storefront', { width: 400, height: 400 }), photo('banner', 'building', { width: 2500, height: 350 })]) {
    assert.ok(companyImageHeroIssue({ ...image, tags: [...image.tags, 'brand-hero'] }), image.id);
    assert.equal(selectCompanyHeroImage([image]), null);
  }
  assert.equal(isCompanyImageLogo(photo('shop', 'storefront', { file_name: 'COOK — homepage' })), false);
});

test('brand shopfronts and landlord buildings outrank product imagery independently of insertion order', () => {
  const images = [photo('meal', 'food'), photo('product', 'product'), photo('building', 'building'), photo('shop', 'storefront')];
  assert.equal(selectCompanyHeroImage(images, 'Tenant - Retail').id, 'shop');
  assert.equal(selectCompanyHeroImage(images, 'Landlord / Client').id, 'building');
  assert.equal(selectCompanyHeroImage(images, 'Client').id, 'building');
  assert.equal(images[0].id, 'meal', 'selection must not reorder cached data');
});

test('an explicitly pinned suitable photo stays selected and unknown legacy rows do not displace it', () => {
  const pinned = photo('chosen', 'interior', { tags: ['brand-hero'], width: null, height: null });
  assert.equal(selectCompanyHeroImage([{ id: 'unknown' }, photo('new'), pinned]).id, 'chosen');
  assert.equal(selectCompanyHeroImage([{ id: 'unknown', tags: [] }]), null);
  assert.equal(selectCompanyHeroImage([photo('legacy', 'storefront', { tags: [] })]).id, 'legacy');
});

test('quality-reviewed candidates beat unreviewed photos, with quality score breaking same-kind ties', () => {
  const ranked = rankCompanyHeroImages([photo('legacy', 'storefront', { tags: [] }), photo('good'),
    photo('better', 'storefront', { tags: ['image-quality:v1', 'image-kind:storefront', 'image-quality-score:95'] })]);
  assert.deepEqual(ranked.map(image => image.id), ['better', 'good', 'legacy']);
});

test('retired automatic candidates are hidden from profiles but manual gallery records are retained', () => {
  const company = { id: 'company', name: 'Example' };
  assert.equal(publishableBrandImage(company, { company_id: 'company', tags: ['brand-auto', 'image-quality-review'] }), false);
  assert.equal(publishableBrandImage(company, { company_id: 'company', tags: ['image-quality-review'] }), true);
  assert.equal(companyImageHeroIssue(photo('retired', 'storefront', { tags: ['brand-hero', 'image-quality-review'] })), 'This image did not pass the photo quality review.');
});

const galleryRoute = find('server/brand-profile.ts', (n, ast) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
  && n.expression.getText(ast) === 'router.get' && n.arguments[0]?.text === '/api/brand/gallery-image/:imageId');
async function gallery({ full = false, original = null, thumbnail = null } = {}) {
  let handler; const queries = [];
  evaluate(galleryRoute, {
    router: { get(_url, _auth, fn) { handler = fn; } }, requireAuth() {},
    pool: { async query(sql) { queries.push(sql); return { rows: [{ local_path: '/synthetic', mime_type: 'image/png', thumbnail_data: thumbnail }] }; } },
    require(name) { assert.equal(name, './image-studio'); return { readPersistedImage: async () => original }; },
  });
  const response = { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ params: { imageId: 'image' }, query: full ? { full: '1' } : {} }, response);
  assert.equal(queries.length, 1, 'reading an unavailable image must not delete its record');
  return response;
}

test('cover endpoint serves original bytes and refuses a thumbnail-only substitute', async () => {
  const bytes = Buffer.from('original image bytes'), thumbnail = `data:image/jpeg;base64,${Buffer.from('tiny thumbnail').toString('base64')}`;
  const original = await gallery({ full: true, original: bytes, thumbnail });
  assert.deepEqual(original.body, bytes); assert.equal(original.headers['Cache-Control'], 'private, max-age=86400');
  const missing = await gallery({ full: true, thumbnail }); assert.equal(missing.code, 404); assert.equal(missing.body, null);
});

test('small gallery fallback correctly decodes stored data URLs and does not corrupt image content', async () => {
  const bytes = Buffer.from('thumbnail bytes');
  const result = await gallery({ thumbnail: `data:image/jpeg;base64,${bytes.toString('base64')}` });
  assert.deepEqual(result.body, bytes); assert.equal(result.headers['Content-Type'], 'image/jpeg');
  assert.equal((await gallery()).code, 404);
});

test('PDF cover strip skips lost originals and genuinely undersized files instead of upscaling thumbnails', async () => {
  const small = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#888888' } }).jpeg().toBuffer();
  const large = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#888888' } }).jpeg().toBuffer();
  const declaration = find('server/brand-pack.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'loadHeroImages');
  const { loadHeroImages } = evaluate(`export ${declaration}`, { companyImageHeroIssue,
    require(name) { return name === 'sharp' ? { default: sharp } : { readPersistedImage: async path => path === 'large' ? large : path === 'small' ? small : null }; },
  });
  const rows = [photo('lost', 'storefront', { local_path: 'lost', thumbnail_data: large.toString('base64') }),
    photo('mislabelled', 'storefront', { local_path: 'small' }), photo('valid', 'storefront', { local_path: 'large' })];
  const images = await loadHeroImages(rows, 250, 180);
  assert.equal(images.length, 1);
  const metadata = await sharp(images[0]).metadata();
  assert.equal(metadata.width, 500); assert.equal(metadata.height, 360);
});
