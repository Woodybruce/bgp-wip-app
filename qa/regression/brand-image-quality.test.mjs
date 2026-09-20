import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { BRAND_IMAGE_QUALITY_TAG, MAX_IMAGE_BYTES, fetchPublicImageSource, prepareBrandPhoto,
  parseImageJudgment, isSuitableBrandPhoto, brandPhotoRank, brandPhotoQualityTags, isPublicImageAddress } from '../../server/brand-image-quality.ts';
import { getBrandIdentity } from '../../server/brand-identity.ts';
import { brandImageIdentityTag, publishableBrandImage } from '../../server/brand-publishing.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const extract = name => find('server/brand-images.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const pass = (kind = 'storefront', quality = 85) => ({ keep: true, photograph: true, relevant: true, kind, quality });
const { interleaveImageCandidates } = evaluate(extract('interleaveImageCandidates'));
const publicDns = async () => [{ address: '93.184.216.34' }];
const image = async (width = 1000, height = 700) => sharp({ create: { width, height, channels: 3, background: '#578987' } }).jpeg().toBuffer();

test('decoded pixels, not compressed byte count, set the minimum usable photo size', async () => {
  const small = await image(400, 300);
  assert.equal(await prepareBrandPhoto(Buffer.concat([small, Buffer.alloc(16000)])), null);
  const full = await image(1000, 700);
  assert.ok(full.length < 8000, 'well-compressed photography must still reach the visual check');
  const prepared = await prepareBrandPhoto(full);
  assert.equal(prepared.width, 1000); assert.equal(prepared.height, 700); assert.equal(prepared.mime, 'image/jpeg');
  assert.equal(await prepareBrandPhoto(await image(1600, 400)), null);
  assert.equal(await prepareBrandPhoto(await image(600, 900)) === null, false);
  assert.equal(await prepareBrandPhoto(await image(799, 500)), null);
});

test('source orientation is honoured, oversized input and corrupt or vector pixels rejected', async () => {
  const input = await sharp(await image(3000, 2000)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const prepared = await prepareBrandPhoto(input);
  assert.equal(prepared.width, 1600); assert.equal(prepared.height, 2400);
  assert.equal(await prepareBrandPhoto(Buffer.alloc(MAX_IMAGE_BYTES + 1)), null);
  assert.equal(await prepareBrandPhoto(Buffer.from('<svg width="1000" height="700"></svg>')), null);
  assert.equal(await prepareBrandPhoto((await image()).subarray(0, 200)), null);
});

test('strict image review never treats string false, invalid scores or wrapped prose as permission', () => {
  for (const value of [ { ...pass(), keep: 'false' }, { ...pass(), relevant: 'true' }, { ...pass(), photograph: 1 },
    { ...pass(), quality: '90' }, { ...pass(), quality: 101 }, { ...pass(), quality: 70.5 }, { ...pass(), kind: 'portrait' }, {} ]) {
    assert.equal(parseImageJudgment(JSON.stringify(value)), null);
  }
  assert.equal(parseImageJudgment('Prose before ```json\n' + JSON.stringify(pass()) + '\n```'), null);
  assert.equal(parseImageJudgment('Explanation ' + JSON.stringify(pass())), null);
  assert.deepEqual(parseImageJudgment(JSON.stringify(pass())), pass());
});

test('logos, low quality, unrelated or nonphotographic imagery cannot enter either gallery', () => {
  for (const verdict of [ null, { ...pass(), kind: 'logo' }, { ...pass(), kind: 'graphic' }, { ...pass(), quality: 69 },
    { ...pass(), relevant: false }, { ...pass(), photograph: false }, { ...pass(), keep: false } ]) {
    assert.equal(isSuitableBrandPhoto(verdict), false);
  }
  assert.equal(isSuitableBrandPhoto(pass('food'), false), true);
  assert.equal(isSuitableBrandPhoto(pass('food'), true), false);
  assert.equal(isSuitableBrandPhoto(pass('building'), true), true);
  assert.ok(brandPhotoRank(pass('storefront'), 1200, 800) > brandPhotoRank(pass('product'), 1200, 800));
  assert.ok(brandPhotoRank(pass('building'), 1200, 800, true) > brandPhotoRank(pass('interior'), 1200, 800, true));
  assert.deepEqual(brandPhotoQualityTags(pass()), ['image-quality:v1', 'image-kind:storefront', 'image-quality-score:85']);
});

test('download refuses nonpublic redirect targets before requesting them', async () => {
  const calls = [];
  const fetched = await fetchPublicImageSource('https://retailer.example.com/photo', { resolveHost: publicDns,
    fetcher: async url => { calls.push(url); return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secrets' } }); } });
  assert.equal(fetched, null); assert.equal(calls.length, 1);
  let requested = false;
  assert.equal(await fetchPublicImageSource('https://retailer.example.com/photo', { resolveHost: async () => [{ address: '10.0.0.5' }],
    fetcher: async () => { requested = true; return new Response(); } }), null);
  assert.equal(requested, false);
  for (const address of ['127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.2','::1','::ffff:127.0.0.1','fe80::1','fc00::1']) assert.equal(isPublicImageAddress(address), false);
});

test('download bounds streamed bodies without trusting content-length and accepts a public CDN redirect', async () => {
  let cancelled = false;
  const oversized = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(16)); }, cancel() { cancelled = true; } });
  const tooLarge = await fetchPublicImageSource('https://retailer.example.com/photo', { maxBytes: 20, resolveHost: publicDns,
    fetcher: async () => new Response(oversized, { headers: { 'content-type': 'image/jpeg' } }) });
  assert.equal(tooLarge, null); assert.equal(cancelled, true);
  const calls = [];
  const valid = await fetchPublicImageSource('https://retailer.example.com/photo', { resolveHost: publicDns, fetcher: async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'manual');
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://images.example.com/full.jpg' } })
      : new Response('photo', { headers: { 'content-type': 'image/jpeg; charset=binary' } });
  } });
  assert.equal(valid.toString(), 'photo'); assert.equal(calls.length, 2);
});

const company = { id: 'company-1', name: 'Synthetic brand', domain: 'retailer.example.com', company_type: 'Tenant', industry: 'Retail',
  ai_generated_fields: { brand_identity: { status: 'verified', domain: 'retailer.example.com' } } };
function orchestrator({ candidates = [], verdicts = [], existing = [], storeFailure = false, currentCompany = company } = {}) {
  const writes = [], stored = [];
  const { refreshBrandImages } = evaluate(extract('refreshBrandImages'), {
    TARGET_IMAGES_PER_BRAND: 5, BRAND_IMAGE_QUALITY_TAG, getBrandIdentity, interleaveImageCandidates, brandImageIdentityTag: () => 'identity:synthetic',
    extractDomain: value => value, reviewExistingBrandPhotos: async () => ({ reviewed: 0, retired: 0, unavailable: 0 }),
    dedupeBrandImageRows: async () => ({ retired: 0 }), findLandlordWebsiteImages: async () => [], findHomepageImages: async () => candidates,
    findPlacesPhotos: async () => [], findPressImages: async () => [], isOfficialBrandWebsite: () => true,
    ImageDeduper: class { async preload() {} async isDuplicate() { return false; } async remember() {} },
    fetchImage: async url => ({ buffer: Buffer.from(url), width: 1200, height: 800, mime: 'image/jpeg' }),
    aiJudgeBrandImage: async (_name, _industry, buffer) => verdicts[candidates.findIndex(c => c.url === buffer.toString())] ?? null,
    isSuitableBrandPhoto, brandPhotoQualityTags, brandPhotoRank,
    storeImageFromBuffer: async args => { if (storeFailure) throw new Error('synthetic store failure'); stored.push(args); return { id: `stored-${stored.length}` }; },
    pool: { query: async (sql, values) => {
      if (sql.startsWith('SELECT *')) return { rows: [currentCompany] };
      if (sql.startsWith('SELECT id, tags')) return { rows: existing };
      if (sql.startsWith('UPDATE')) { writes.push({ sql, values }); return { rowCount: existing.length }; }
      throw new Error(`Unexpected query ${sql}`);
    } },
  });
  return { run: opts => refreshBrandImages(company.id, opts), writes, stored };
}
const candidate = n => ({ url: `https://images.example.com/photo-${n}.jpg`, source: 'homepage', pageUrl: 'https://retailer.example.com/stores' });

test('all candidate photos are scored before selecting the best storefront, rather than first scraped product', async () => {
  const qa = orchestrator({ candidates: [candidate(1), candidate(2), candidate(3)], verdicts: [pass('product'), pass('storefront'), pass('logo')] });
  const result = await qa.run({ target: 1 });
  assert.equal(result.attempted, 3); assert.equal(result.imported, 1);
  assert.equal(qa.stored[0].buffer.toString(), candidate(2).url);
  assert.ok(qa.stored[0].tags.includes(BRAND_IMAGE_QUALITY_TAG));
  assert.match(qa.stored[0].description, /retailer.example.com\/stores/);
});

test('old unreviewed automatic rows cannot satisfy the gallery target', async () => {
  const qa = orchestrator({ candidates: [candidate(1)], verdicts: [pass()], existing: [{ id: 'old', tags: ['brand-auto'] }] });
  const result = await qa.run({ target: 1 }); assert.equal(result.imported, 1);
  const reviewed = orchestrator({ existing: [{ id: 'good', tags: ['brand-auto', BRAND_IMAGE_QUALITY_TAG] }] });
  assert.match((await reviewed.run({ target: 1 })).skipped, /Already have 1 reviewed/);
});

test('unavailable review fails closed and forced refresh never removes the existing gallery first', async () => {
  const qa = orchestrator({ candidates: [candidate(1)], existing: [{ id: 'old', tags: ['brand-auto', BRAND_IMAGE_QUALITY_TAG] }] });
  const result = await qa.run({ force: true, target: 1 });
  assert.equal(result.imported, 0); assert.equal(qa.writes.length, 0); assert.equal(result.deleted, 0);
  assert.match(result.skipped, /review unavailable/);
  const failedStore = orchestrator({ candidates: [candidate(1)], verdicts: [pass()], storeFailure: true,
    existing: [{ id: 'old', tags: ['brand-auto', BRAND_IMAGE_QUALITY_TAG] }] });
  assert.equal((await failedStore.run({ force: true, target: 1 })).imported, 0); assert.equal(failedStore.writes.length, 0);
});

test('forced refresh only supersedes unpinned automatic rows after a complete new set is stored', async () => {
  const old = [{ id: 'old', tags: ['brand-auto', BRAND_IMAGE_QUALITY_TAG] }];
  const partial = orchestrator({ candidates: [candidate(1)], verdicts: [pass()], existing: old });
  assert.equal((await partial.run({ force: true, target: 2 })).imported, 1); assert.equal(partial.writes.length, 0);
  const complete = orchestrator({ candidates: [candidate(1), candidate(2)], verdicts: [pass(), pass()], existing: old });
  assert.equal((await complete.run({ force: true, target: 2 })).imported, 2);
  assert.equal(complete.writes.length, 1); assert.match(complete.writes[0].sql, /NOT \('brand-hero' = ANY\(tags\)\)/);
  assert.match(complete.writes[0].sql, /'brand-auto' = ANY\(tags\)/); assert.match(complete.writes[0].sql, /image-quality-review/);
  assert.doesNotMatch(complete.writes[0].sql, /DELETE/);
});

test('legacy review cannot condemn a valid original when AI is unavailable, and never reads a thumbnail', async () => {
  const writes = [], readPaths = [];
  const photo = await image();
  const { reviewExistingBrandPhotos } = evaluate(extract('reviewExistingBrandPhotos') + '\nexports.reviewExistingBrandPhotos=reviewExistingBrandPhotos;', {
    BRAND_IMAGE_QUALITY_TAG, getBrandIdentity, prepareBrandPhoto, isSuitableBrandPhoto, brandPhotoQualityTags,
    readPersistedImage: async path => { readPaths.push(path); return photo; }, aiJudgeBrandImage: async () => null,
    pool: { query: async sql => {
      if (sql.startsWith('SELECT id')) return { rows: [{ id: 'legacy', local_path: 'original.jpg', tags: ['brand-auto'] }] };
      writes.push(sql); return { rows: [company] };
    } },
  });
  const result = await reviewExistingBrandPhotos(company, 'identity', false, company.domain);
  assert.equal(result.reviewed, 0); assert.equal(result.unavailable, 1); assert.equal(writes.length, 0);
  assert.deepEqual(readPaths, ['original.jpg']);
});

test('dedupe keeps manual and pinned records, marks only unpinned automatic duplicates recoverably', async () => {
  const original = await image(); const writes = [];
  const rows = [ { id: 'pinned', local_path: 'original', tags: ['brand-auto', 'brand-hero'] },
    { id: 'manual', local_path: 'original', tags: [] }, { id: 'pinned2', local_path: 'original', tags: ['brand-auto', 'brand-hero'] },
    { id: 'auto', local_path: 'original', tags: ['brand-auto'] } ];
  const { dedupeBrandImageRows } = evaluate(extract('averageHash') + '\n' + extract('hammingDistance') + '\n' + extract('dedupeBrandImageRows'), {
    crypto, sharp, NEAR_DUPLICATE_BITS: 5, readPersistedImage: async () => original,
    pool: { query: async (sql, values) => { if (sql.startsWith('SELECT')) return { rows }; writes.push({ sql, values }); return { rowCount: 1 }; } },
  });
  const result = await dedupeBrandImageRows(company.id);
  assert.equal(result.deleted, 0); assert.equal(result.retired, 1);
  assert.deepEqual(writes.map(write => write.values[0]), ['auto']); assert.ok(writes.every(write => !write.sql.includes('DELETE')));
});

test('official page redirects cannot attribute an unrelated destination as the brand source', async () => {
  const calls = [];
  const result = await fetchPublicImageSource('https://retailer.example.com/stores', { html: true, resolveHost: publicDns,
    fetcher: async url => { calls.push(url); return new Response(null, { status: 302, headers: { location: 'https://unrelated.example.com/photos' } }); } });
  assert.equal(result, null); assert.equal(calls.length, 1);
});

test('confirmed legacy logo is retained for review and concurrent human tag edits cannot be overwritten', async () => {
  const photo = await image(); const writes = [];
  const { reviewExistingBrandPhotos } = evaluate(extract('reviewExistingBrandPhotos') + '\nexports.reviewExistingBrandPhotos=reviewExistingBrandPhotos;', {
    BRAND_IMAGE_QUALITY_TAG, getBrandIdentity, prepareBrandPhoto, isSuitableBrandPhoto, brandPhotoQualityTags,
    readPersistedImage: async () => photo, aiJudgeBrandImage: async () => ({ ...pass('logo'), keep: false }),
    pool: { query: async (sql, values) => {
      if (sql.startsWith('SELECT id')) return { rows: [{ id: 'logo', local_path: 'original.jpg', tags: ['brand-auto', 'identity'] }] };
      if (sql.startsWith('SELECT *')) return { rows: [company] };
      writes.push({ sql, values }); return { rowCount: 1 };
    } },
  });
  const result = await reviewExistingBrandPhotos(company, 'identity', false, company.domain);
  assert.equal(result.retired, 1); assert.equal(writes.length, 1);
  assert.ok(writes[0].values[1].includes('image-quality-review')); assert.ok(writes[0].values[1].includes('image-kind:logo'));
  assert.match(writes[0].sql, /tags IS NOT DISTINCT FROM/); assert.match(writes[0].sql, /NOT \('brand-hero'/);
});

test('alternate website refresh uses the same photo gate and never deletes current rows', async () => {
  const src = find('server/refresh-website-images.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'refreshImagesForCompany');
  const writes = [], calls = [];
  const { refreshImagesForCompany } = evaluate(src + '\nexports.refreshImagesForCompany=refreshImagesForCompany;', {
    getBrandIdentity, brandImageIdentityTag, normalizeBrandDomain: value => value, REFRESH_TAG: 'website-refresh',
    scrapeLogoFromWebsite: async () => null,
    refreshBrandImages: async (id, opts) => { calls.push({ id, opts }); return { imported: 0, skipped: 'No suitable new photos' }; },
    pool: { query: async sql => { assert.ok(sql.startsWith('SELECT'), 'Existing gallery must never be deleted'); return { rows: [company] }; } },
    storeImageFromBuffer: async args => { writes.push(args); return { id: 'new-logo' }; },
  });
  const result = await refreshImagesForCompany({ companyId: company.id, brandName: company.name, domain: company.domain, maxHero: 3 });
  assert.equal(result.removedExisting, 0); assert.equal(result.photoRefresh.imported, 0); assert.match(result.photoReason, /No suitable/);
  assert.equal(calls.length, 1); assert.equal(calls[0].id, company.id); assert.equal(calls[0].opts.target, 3); assert.equal(calls[0].opts.force, true);
  assert.equal(writes.length, 0);
});


test('cached landlord photos cannot exhaust the candidate budget before fresh site discoveries', () => {
  const cache = Array.from({ length: 40 }, (_, n) => ({ url: `cached-${n}` }));
  const fresh = Array.from({ length: 15 }, (_, n) => ({ url: `fresh-${n}` }));
  const result = interleaveImageCandidates([cache, fresh]).slice(0, 24);
  assert.equal(result.filter(item => item.url.startsWith('fresh')).length, 12);
  assert.equal(result.filter(item => item.url.startsWith('cached')).length, 12);
});

test('checking a rejected image cannot poison duplicate detection for later candidates', async () => {
  const cls = find('server/brand-images.ts', n => ts.isClassDeclaration(n) && n.name?.text === 'ImageDeduper');
  const { ImageDeduper } = evaluate(extract('averageHash') + '\n' + extract('hammingDistance') + '\n' + cls + '\nexports.ImageDeduper=ImageDeduper;', {
    crypto, sharp, NEAR_DUPLICATE_BITS: 5,
  });
  const deduper = new ImageDeduper(); const photo = await image();
  assert.equal(await deduper.isDuplicate(photo), false);
  assert.equal(await deduper.isDuplicate(photo), false, 'a check is not acceptance');
  await deduper.remember(photo);
  assert.equal(await deduper.isDuplicate(photo), true);
});


function logoRefreshHarness(afterFetch = company) {
  const src = find('server/refresh-website-images.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'refreshImagesForCompany');
  const stored = [];
  let fetched = false;
  const { refreshImagesForCompany } = evaluate(src + '\nexports.refreshImagesForCompany=refreshImagesForCompany;', {
    getBrandIdentity, brandImageIdentityTag, normalizeBrandDomain: value => value, REFRESH_TAG: 'website-refresh',
    scrapeLogoFromWebsite: async () => {
      fetched = true;
      return { buffer: Buffer.from('synthetic-logo'), source: 'header', url: `https://${company.domain}/logo.png`, mime: 'image/png' };
    },
    pool: { query: async sql => { assert.ok(sql.startsWith('SELECT')); return { rows: [fetched ? afterFetch : company] }; } },
    storeImageFromBuffer: async args => { stored.push(args); return { id: 'new-logo' }; },
  });
  return { stored, run: () => refreshImagesForCompany({ companyId: company.id, brandName: company.name, domain: company.domain, logoOnly: true }) };
}

test('verified company website logo retains its identity tag and is publishable', async () => {
  const qa = logoRefreshHarness();
  const result = await qa.run();
  assert.equal(result.ok, true); assert.equal(result.logo.storedId, 'new-logo'); assert.equal(qa.stored.length, 1);
  const saved = qa.stored[0];
  assert.equal(saved.companyId, company.id);
  assert.ok(saved.tags.includes(brandImageIdentityTag(company)));
  assert.equal(publishableBrandImage(company, { company_id: saved.companyId, brand_name: saved.brandName, tags: saved.tags }), true);
});

test('company identity changed during website scrape prevents saving the stale logo', async () => {
  const changed = { ...company, domain: 'replacement.example.com',
    ai_generated_fields: { brand_identity: { status: 'verified', domain: 'replacement.example.com' } } };
  const qa = logoRefreshHarness(changed);
  const result = await qa.run();
  assert.equal(result.ok, false); assert.match(result.error, /identity changed/);
  assert.equal(result.logo, null); assert.equal(qa.stored.length, 0);
});

test('official CDN raster photos served as application/octet-stream reach the same pixel gate', async () => {
  const original = await image(1200, 800);
  const downloaded = await fetchPublicImageSource('https://assets.example.com/shop.jpg', { resolveHost: publicDns,
    fetcher: async () => new Response(original, { headers: { 'content-type': 'application/octet-stream' } }) });
  assert.ok(downloaded);
  const photo = await prepareBrandPhoto(downloaded);
  assert.equal(photo.width, 1200); assert.equal(photo.height, 800);
  for (const invalid of ['<html>Access denied</html>', '<svg width="1200" height="800"></svg>', 'not an image']) {
    assert.equal(await fetchPublicImageSource('https://assets.example.com/shop.jpg', { resolveHost: publicDns,
      fetcher: async () => new Response(invalid, { headers: { 'content-type': 'application/octet-stream' } }) }), null);
  }
  const thumb = await fetchPublicImageSource('https://assets.example.com/small.jpg', { resolveHost: publicDns,
    fetcher: async () => new Response(await image(300, 272), { headers: { 'content-type': 'application/octet-stream' } }) });
  assert.equal(await prepareBrandPhoto(thumb), null);
});


test('one complete JSON fence is accepted without relaxing verdict types or permitting prose and trailing data', () => {
  const json = JSON.stringify(pass());
  for (const fenced of ['```json\n' + json + '\n```', '```\n' + json + '\n```', '  ```JSON\r\n' + json + '\r\n```  ']) {
    assert.deepEqual(parseImageJudgment(fenced), pass());
  }
  for (const invalid of ['Here is the JSON: ```json\n' + json + '\n```', '```json\n' + json + '\n``` extra',
    '```json\n' + json + '\n```\n```json\n' + json + '\n```', '```javascript\n' + json + '\n```', json + json,
    '```json\n' + JSON.stringify({ ...pass(), keep: 'true' }) + '\n```',
    '```json\n' + JSON.stringify({ ...pass(), quality: '85' }) + '\n```']) assert.equal(parseImageJudgment(invalid), null);
});

async function judgeResponse(response) {
  const warnings = [], requests = [];
  const { aiJudgeBrandImage } = evaluate(extract('aiJudgeBrandImage') + '\nexports.aiJudgeBrandImage=aiJudgeBrandImage;', {
    sharp, parseImageJudgment,
    process: { env: { ANTHROPIC_API_KEY: 'synthetic-test-key' } },
    console: { warn: (...args) => warnings.push(args) },
    require: name => {
      assert.equal(name, '@anthropic-ai/sdk');
      return { default: class MockAnthropic {
        constructor(options) { assert.equal(options.maxRetries, 0); }
        messages = { create: async request => { requests.push(request); return response; } };
      } };
    },
  });
  const result = await aiJudgeBrandImage('Private test company', 'Private industry', await image(),
    { landlord: false, domain: 'private.example.com', source: 'homepage', caption: 'Private source caption' });
  return { result, warnings, requests };
}

test('actual vision judge accepts the fully fenced valid response and preserves the suitability gate', async () => {
  const qa = await judgeResponse({ content: [{ type: 'text', text: '```json\n' + JSON.stringify(pass()) + '\n```' }],
    stop_reason: 'end_turn', usage: { input_tokens: 450, output_tokens: 55 } });
  assert.deepEqual(qa.result, pass()); assert.equal(isSuitableBrandPhoto(qa.result), true);
  assert.equal(qa.warnings.length, 0); assert.equal(qa.requests.length, 1);
  assert.equal(qa.requests[0].messages[0].content[0].type, 'image');
  const rejected = await judgeResponse({ content: [{ type: 'text', text: '```json\n' + JSON.stringify({ ...pass(), keep: false }) + '\n```' }],
    stop_reason: 'end_turn', usage: { input_tokens: 450, output_tokens: 55 } });
  assert.equal(isSuitableBrandPhoto(rejected.result), false);
});

test('actual vision judge logs malformed response metadata without image, source, company or response text', async () => {
  const qa = await judgeResponse({ content: [{ type: 'text', text: 'private response text {"keep":' }],
    stop_reason: 'max_tokens', usage: { input_tokens: 450, output_tokens: 180 } });
  assert.equal(qa.result, null); assert.equal(qa.warnings.length, 1);
  const metadata = qa.warnings[0][1];
  assert.equal(metadata.stopReason, 'max_tokens'); assert.deepEqual(Array.from(metadata.contentTypes), ['text']);
  assert.equal(metadata.inputTokens, 450); assert.equal(metadata.outputTokens, 180);
  assert.doesNotMatch(JSON.stringify(qa.warnings), /private|synthetic-test-key|base64|data:image/i);
});
