// Synthetic browser QA only. Never connects to a remote database or a provider.
// Run with node --import tsx; cleanup deletes only this fixture's reserved IDs.
import assert from 'node:assert/strict';
import pg from 'pg';
import sharp from 'sharp';
import { getBrandIdentity, assessBrandProviderMatch, stampBrandProviderPayload } from '../server/brand-identity.ts';

const supplied = process.env.BRAND_SMOKE_DATABASE_URL;
const url = new URL(supplied || 'file:///');
if (url.protocol !== 'postgresql:' || url.hostname || url.pathname !== '/bgp_smoke'
  || !['/tmp/bgp-smoke-20260909/socket', '/private/tmp/bgp-smoke-20260909/socket'].includes(url.searchParams.get('host'))
  || url.searchParams.get('port') !== '55441'
  || [...url.searchParams.keys()].some(key => !['host', 'port', 'user'].includes(key))) {
  throw new Error('Only the exact disposable bgp_smoke database/socket on port 55441 is allowed');
}
const id = number => `b9a09100-0910-4000-8000-${String(number).padStart(12, '0')}`;
const VERIFIED = id(1), PENDING = id(2), IMAGES = [id(11), id(12)];
const STORES = Array.from({ length: 19 }, (_, index) => id(100 + index));
const files = IMAGES.map(image => `qa-brand-overview/${image}.png`);
const names = new Map([[VERIFIED, 'QA brand overview — prepared'], [PENDING, 'QA brand overview — awaiting identity']]);
const stages = ['identity', 'profile', 'apollo', 'rocketreach', 'stores', 'images', 'logo', 'brief', 'contacts'];
const keys = [...names.keys()].flatMap(company => [
  ...stages.map(stage => `brand-preparation:${company}:${stage}`),
  `brand-preparation-request:${company}`,
  ...['brand', 'uk', 'activity', 'intel'].map(tab => `brand-prepared-take:${company}:${tab}`),
]);
const db = new pg.Client({ connectionString: supplied, ssl: false });
await db.connect();
try {
  const connection = (await db.query("SELECT current_database() AS database, inet_server_addr() AS address, current_setting('port') AS port")).rows[0];
  assert.deepEqual(connection, { database: 'bgp_smoke', address: null, port: '55441' });
  await db.query('BEGIN');
  const existing = (await db.query('SELECT id,name FROM crm_companies WHERE id=ANY($1::text[])', [[VERIFIED, PENDING]])).rows;
  for (const company of existing) assert.equal(company.name, names.get(company.id), 'Reserved ID belongs to a different record');
  if (process.argv.includes('--cleanup')) {
    await db.query('DELETE FROM system_settings WHERE key=ANY($1::text[])', [keys]);
    for (const company of names.keys()) await db.query('DELETE FROM system_settings WHERE key LIKE $1', [`brand-identity-history:${company}:%`]);
    for (const table of ['brand_apollo_data', 'brand_rocketreach_data']) {
      if ((await db.query('SELECT to_regclass($1) AS name', [table])).rows[0].name) {
        await db.query(`DELETE FROM ${table} WHERE company_id=ANY($1::text[])`, [[VERIFIED, PENDING]]);
      }
    }
    await db.query('DELETE FROM brand_stores WHERE id=ANY($1::text[]) AND brand_company_id=$2', [STORES, VERIFIED]);
    await db.query('DELETE FROM image_studio_images WHERE id=ANY($1::text[]) AND company_id=$2', [IMAGES, VERIFIED]);
    await db.query('DELETE FROM file_storage WHERE storage_key=ANY($1::text[])', [files]);
    await db.query('DELETE FROM crm_companies WHERE id=ANY($1::text[])', [[VERIFIED, PENDING]]);
  } else {
    assert.equal(existing.length, 0, 'Fixture exists; run --cleanup before reseeding');
    const now = new Date();
    const identityMetadata = { brand_identity: { status: 'verified', domain: 'qa-brand.example', aliases: ['QA Brand Trading Limited'], country: 'GB', verifiedAt: now.toISOString(), verifiedBy: 'disposable-local-fixture' } };
    const company = (await db.query(`INSERT INTO crm_companies
      (id,name,company_type,domain,domain_url,description,industry,store_count,rollout_status,employee_count,ai_generated_fields,last_enriched_at,ai_disabled)
      VALUES ($1,$2,'Tenant - Retail','qa-brand.example','https://qa-brand.example',$3,'Food retail',100,'scaling',950,$4::jsonb,now(),true) RETURNING *`,
      [VERIFIED, names.get(VERIFIED), 'QA Brand is a fictional food retailer used only to test the BGP profile layout. Its reported footprint is 100 stores; this local fixture maps a smaller set of locations.', JSON.stringify(identityMetadata)])).rows[0];
    await db.query(`INSERT INTO crm_companies (id,name,company_type,domain,domain_url,ai_generated_fields,ai_disabled)
      VALUES ($1,$2,'Tenant - Retail','unconfirmed-brand.example','https://unconfirmed-brand.example',$3::jsonb,true)`,
      [PENDING, names.get(PENDING), JSON.stringify({ brand_identity: { status: 'review', domain: 'unconfirmed-brand.example' } })]);
    const identity = getBrandIdentity(company);
    assert.equal(identity.status, 'verified');
    for (let index = 0; index < STORES.length; index++) {
      await db.query(`INSERT INTO brand_stores (id,brand_company_id,name,address,lat,lng,country,status,source_type,researched_at)
        VALUES ($1,$2,$3,$4,$5,$6,'GB',$7,'manual',now())`,
        [STORES[index], VERIFIED, `QA Brand ${String(index + 1).padStart(2, '0')}`, `${index + 1} Example Street, ${index % 2 ? 'York YO1 1QA' : 'London W1 1QA'}`,
          index < 17 ? 51.5 + index * .005 : null, index < 17 ? -.12 + index * .005 : null, index === 18 ? 'closed' : 'open']);
    }
    for (let index = 0; index < IMAGES.length; index++) {
      const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="440"><rect width="1000" height="440" fill="${index ? '#e9ece8' : '#efe7db'}"/><rect x="180" y="150" width="640" height="250" fill="#fff" stroke="#403c36" stroke-width="5"/><rect x="180" y="115" width="640" height="80" fill="#744a34"/><text x="500" y="167" font-family="serif" font-size="40" text-anchor="middle" fill="white">QA BRAND</text><rect x="230" y="220" width="200" height="160" fill="#c8d9d2"/><rect x="570" y="220" width="200" height="160" fill="#c8d9d2"/><text x="500" y="62" font-family="sans-serif" font-size="22" text-anchor="middle">Synthetic local fixture · ${index ? 'prepared source image' : 'staff-approved hero'}</text></svg>`)).png().toBuffer();
      await db.query('INSERT INTO file_storage(storage_key,data,content_type,original_name,size) VALUES ($1,$2,$3,$4,$5)', [files[index], png, 'image/png', `qa-brand-${index}.png`, png.length]);
      await db.query(`INSERT INTO image_studio_images (id,company_id,brand_name,file_name,category,tags,description,source,mime_type,file_size,width,height,thumbnail_data)
        VALUES ($1,$2,$3,$4,'Brand imagery',$5::text[],$6,$7,'image/png',$8,1000,440,$9)`,
        [IMAGES[index], VERIFIED, company.name, `qa-brand-${index}.png`, index ? ['brand-auto', `brand-identity:${identity.fingerprint}`] : ['brand-hero'],
          'Synthetic fixture image, generated locally without provider calls.', index ? 'website' : 'upload', png.length, png.toString('base64')]);
    }
    await db.query('INSERT INTO system_settings(key,value,updated_at) VALUES ($1,$2::jsonb,now())',
      [`brand-prepared-take:${VERIFIED}:brand`, JSON.stringify({ text: 'QA Brand has room to grow in the test portfolio. BGP angle: review the available locations with the property team. Next step: arrange a requirements meeting and record an owner and due date. This is a synthetic QA brief, not advice about a real business.', fingerprint: identity.fingerprint, generatedAt: now.getTime(), expiresAt: now.getTime() + 86400000, dataHash: 'synthetic-fixture' })]);
    for (const stage of stages) await db.query('INSERT INTO system_settings(key,value,updated_at) VALUES ($1,$2::jsonb,now())',
      [`brand-preparation:${VERIFIED}:${stage}`, JSON.stringify({ stage, fingerprint: identity.fingerprint, status: stage === 'contacts' ? 'needs_review' : 'ready', lastAttemptAt: now.toISOString(), lastSuccessAt: stage === 'contacts' ? null : now.toISOString(), nextAttemptAt: new Date(now.getTime() + 86400000).toISOString(), reason: stage === 'contacts' ? 'No confirmed property contact in this synthetic fixture' : null })]);
    if ((await db.query("SELECT to_regclass('brand_apollo_data') AS name")).rows[0].name) {
      const payload = { name: company.name, domain: company.domain, country: 'GB', employees: 0, headcountGrowth12m: 0, hq: 'London, United Kingdom', latestFundingStage: 'Private' };
      await db.query('INSERT INTO brand_apollo_data(company_id,payload,fetched_at) VALUES ($1,$2::jsonb,now())',
        [VERIFIED, JSON.stringify(stampBrandProviderPayload(payload, assessBrandProviderMatch(company, payload), now.toISOString()))]);
      await db.query('INSERT INTO brand_apollo_data(company_id,payload,fetched_at) VALUES ($1,$2::jsonb,now())',
        [PENDING, JSON.stringify({ name: 'Different business', domain: 'wrong.example', employees: 0, hq: 'Beijing, China' })]);
    }
  }
  await db.query('COMMIT');
  console.log(JSON.stringify({ cleanup: process.argv.includes('--cleanup'), verifiedId: VERIFIED, pendingId: PENDING,
    verifiedUrl: `http://localhost:5101/companies/${VERIFIED}`, pendingUrl: `http://localhost:5101/companies/${PENDING}`, images: IMAGES,
    expected: { storedLocations: 19, mappedLocations: 17, reportedTotal: 100, sourceEmployeesZeroMustBeHidden: true, blockedSourceBeijingMustBeHidden: true, contactsNeedReview: true } }, null, 2));
} catch (error) { await db.query('ROLLBACK'); throw error; }
finally { await db.end(); }
