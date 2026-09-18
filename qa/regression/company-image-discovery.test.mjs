import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { extractCompanyImageCandidates, extractCompanyImageUrls, discoverCompanyPhotographyPages, isPublicImageSourceUrl } from '../../server/company-image-discovery.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const base = 'https://retailer.example.com/stores/';

test('responsive photography chooses the largest declared width rather than the final entry', () => {
  const images = extractCompanyImageCandidates(`<img alt="Flagship interior" width="400" height="300"
    src="/thumbnail.jpg" srcset="/large.jpg 1600w, /medium.jpg 800w, /small.jpg 400w">`, base);
  assert.equal(images.length, 1);
  assert.equal(images[0].url, 'https://retailer.example.com/large.jpg');
  assert.equal(images[0].width, 1600);
  assert.equal(images[0].height, 1200);
  assert.equal(images[0].caption, 'Flagship interior');
});

test('density descriptors and CDN transformation commas retain the actual image URL', () => {
  const images = extractCompanyImageUrls(`<img srcset="https://cdn.example.com/c_limit,w_1800/interior.jpg 3x,
    https://cdn.example.com/c_limit,w_600/interior.jpg 1x">`, base);
  assert.deepEqual(images, ['https://cdn.example.com/c_limit,w_1800/interior.jpg']);
});

test('picture sources, lazy images and order-independent social metadata are discovered', () => {
  const images = extractCompanyImageCandidates(`
    <meta content='/hero.jpg?a=1&amp;b=2' property='og:image'>
    <meta content='/social-photo.jpg' name='twitter:image'>
    <picture><source data-srcset='/large.webp 1400w, /small.webp 400w'>
      <img alt='Shop interior' src='data:image/gif;base64,AA' data-original='/original.jpg'></picture>
    <img src='/placeholder.gif' data-lazy-src='/building.jpg'>
    <img src='/spacer.png' data-src='/restaurant.jpg'>`, base);
  const urls = images.map(image => image.url);
  for (const path of ['/hero.jpg?a=1&b=2', '/social-photo.jpg', '/large.webp', '/original.jpg', '/building.jpg', '/restaurant.jpg']) {
    assert.ok(urls.includes(`https://retailer.example.com${path}`), path);
  }
  assert.equal(images.find(image => image.url.endsWith('/large.webp')).caption, 'Shop interior');
  assert.ok(urls.every(url => !/placeholder|spacer|data:/.test(url)));
});

test('inline background styles decode entities and accept lazy backgrounds', () => {
  const images = extractCompanyImageUrls(`<div aria-label="Building exterior" style="background-image:url(&quot;/exterior.jpg?width=1600&amp;quality=90&quot;)"></div>
    <section data-background-image='/portfolio.webp'></section>
    <div style="background: #fff url('/terrace.jpg') center center"></div>
    <style>.hero {background-image:url('/office-facade.jpg')} .logo {background-image:url('/BrandLogoDark.png')}</style>`, base, 10, 'landlord');
  assert.deepEqual(new Set(images), new Set(['/exterior.jpg?width=1600&quality=90', '/portfolio.webp', '/terrace.jpg', '/office-facade.jpg'].map(path => `https://retailer.example.com${path}`)));
});

test('logo, icon, promotion and investor assets are rejected before the candidate cap', () => {
  const images = extractCompanyImageUrls(`
    <meta property='og:image' content='/brand-logo.jpg'>
    ${Array.from({ length: 25 }, (_, i) => `<img src='/asset${i}.png' alt='Company logo'>`).join('')}
    <picture><source srcset='/cryptic.webp 2000w'><img alt='Company logo' src='/cryptic.png'></picture>
    <img src='/payment-icons.png'><img src='/gift-card.jpg'><img src='/director-portrait.jpg'>
    <img src='/sale-banner.jpg'><img src='/annual-report.jpg'>
    <img alt='New flagship shopfront' src='/storefront.jpg'>
    <img src='/logo-design-portfolio/terrace.jpg'>`, base, 2, 'landlord');
  assert.deepEqual(images, ['https://retailer.example.com/storefront.jpg', 'https://retailer.example.com/logo-design-portfolio/terrace.jpg']);
});

test('scripts, comments, protocols and private hosts cannot become image candidates', () => {
  const urls = extractCompanyImageUrls(`<script>let template='<img src="/fake.jpg">'</script>
    <!-- <img src='/old.jpg'> -->
    <img src='http://127.0.0.1/photo.jpg'><img src='http://169.254.169.254/latest'>
    <img src='https://localhost/photo.jpg'><img src='https://internal.local/photo.jpg'>
    <img src='file:///tmp/photo.jpg'><img src='javascript:alert(1)'>
    <img src='https://user:secret@cdn.example.com/photo.jpg'><img src='/valid.jpg'>`, base);
  assert.deepEqual(urls, ['https://retailer.example.com/valid.jpg']);
  for (const invalid of ['https://[::1]/', 'http://2130706433/', 'http://0x7f000001/', 'https://example.com:8443/', 'https://metadata.internal/']) {
    assert.equal(isPublicImageSourceUrl(invalid), false, invalid);
  }
});

test('discovery follows observed official venue pages before press and keeps encoded query values', () => {
  const pages = discoverCompanyPhotographyPages(`
    <a href='/newsroom'>Newsroom</a><a href='/stores'>Find stores</a>
    <a href='/stores/london?size=large&amp;view=photo&amp;utm_source=menu'><span>London shop</span></a>
    <a href='https://www.retailer.example.com/locations/manchester'>Our venue</a>
    <a href='https://retailer.example.com.evil.com/stores'>Stores</a>
    <a href='//internal.local/portfolio'>Portfolio</a>
    <a href='https://other.example.com/stores'>Store</a>
    <a href='/account/stores'>Store account</a><a href='/stores/map.pdf'>Store map</a>`, 'https://retailer.example.com/', { kind: 'brand', limit: 4 });
  assert.deepEqual(pages, ['https://retailer.example.com/stores/london?size=large&view=photo',
    'https://www.retailer.example.com/locations/manchester', 'https://retailer.example.com/stores', 'https://retailer.example.com/newsroom']);
});

test('landlords follow asset details and exclude investor/personnel pages', () => {
  const pages = discoverCompanyPhotographyPages(`<a href='/our-places/bluewater'>Bluewater</a>
    <a href='/portfolio/centre'>Our centre</a><a href='/properties/offices'>Offices</a>
    <a href='/investors/portfolio'>Investor portfolio</a><a href='/board/our-places'>Board</a>
    <a href='/careers/portfolio'>Portfolio vacancies</a>`, 'https://landlord.example.com/', { kind: 'landlord' });
  assert.deepEqual(pages, ['https://landlord.example.com/our-places/bluewater', 'https://landlord.example.com/portfolio/centre', 'https://landlord.example.com/properties/offices']);
});

const declaration = name => find('server/landlord-scraper.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const constant = name => find('server/landlord-scraper.ts', node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(d => d.name.getText() === name));

test('actual landlord scrape retains per-page provenance and bounded discovery despite homepage image volume', async () => {
  const calls = [], writes = [];
  const description = 'This is a commercial property owned and operated by this landlord. '.repeat(10);
  const pages = new Map([
    ['/', `<p>${description}</p>${Array.from({ length: 10 }, (_, i) => `<img src='/home-${i}.jpg'><a href='/press/story-${i}'>Press</a>`).join('')}<a href='/our-places/centre'>Our centre</a>`],
    ['/our-places', `<p>${description}</p><img src='/place-index.jpg'><a href='/portfolio/offices'>Offices</a>`],
    ['/portfolio', `<p>${description}</p><img src='/portfolio-index.jpg'>`],
    ['/our-places/centre', `<p>${description}</p><img src='/centre-exterior.jpg'>`],
    ['/portfolio/offices', `<p>${description}</p><img src='/offices-interior.jpg'>`],
  ]);
  const compiled = evaluate(['LANDLORD_INITIAL_PATHS', 'LANDLORD_FALLBACK_PATHS', 'LANDLORD_PAGE_LIMIT'].map(constant).join('\n')
    + '\n' + ['condenseHtml', 'buildPrompt', 'scrapeLandlordWebsite'].map(declaration).join('\n'), {
    URL, progress: {}, ensureTable: async () => {}, isScraperApiAvailable: () => true,
    isPublicImageSourceUrl, extractCompanyImageUrls, discoverCompanyPhotographyPages,
    console: { log() {}, warn() {} },
    pool: { query: async (sql, values) => {
      if (/^SELECT id, name/.test(sql)) return { rows: [{ id: 'landlord', name: 'Landlord', domain: 'landlord.example.com' }] };
      writes.push([sql, values]); return { rows: [] };
    } },
    scraperFetch: async url => {
      calls.push(url);
      const path = new URL(url).pathname;
      if (path === '/') await new Promise(resolve => setTimeout(resolve, 5));
      return { ok: pages.has(path), status: pages.has(path) ? 200 : 404, text: async () => pages.get(path) || '' };
    },
    callClaude: async () => ({ choices: [{ message: { content: '{"properties":[]}' } }] }),
    safeParseJSON: JSON.parse, CHATBGP_HELPER_MODEL: 'fixture',
    autoLinkScrapedProperties: async () => ({ linked: 0, skipped: [] }),
  });
  const result = await compiled.scrapeLandlordWebsite('landlord');
  assert.equal(result.ok, true);
  assert.equal(calls.length, 8, 'the existing render budget stays bounded');
  assert.equal(new Set(calls).size, 8);
  assert.ok(calls.includes('https://landlord.example.com/our-places/centre'));
  assert.ok(calls.includes('https://landlord.example.com/portfolio/offices'));
  const sources = JSON.parse(writes.find(([sql]) => /INSERT INTO landlord_website_findings/.test(sql))[1][1]);
  assert.equal(sources[0].url, 'https://landlord.example.com/', 'completion timing does not reorder provenance');
  assert.deepEqual(sources.find(page => page.url.endsWith('/our-places/centre')).image_urls, ['https://landlord.example.com/centre-exterior.jpg']);
  assert.equal(result.findings.image_urls[0], 'https://landlord.example.com/place-index.jpg');
  assert.ok(result.findings.image_urls.includes('https://landlord.example.com/centre-exterior.jpg'));
});
