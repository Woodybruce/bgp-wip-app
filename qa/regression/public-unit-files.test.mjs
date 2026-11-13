// The public website's file list (bgp.uk.com, and the old WordPress site
// through the hourly sync): which of a unit's files may leave without a
// login. Checked against the source so a later change that opens it fails
// here.
//   node --import tsx --test qa/regression/public-unit-files.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, find, route, ts } = require('./source-harness.cjs');

const ROUTES = 'server/routes.ts';
const publicUnitFile = () => find(ROUTES, (n, ast) => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'publicUnitFile');
const quoted = text => [...text.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
const { publicUnitFileSql, publicUnitPhotoSql, PUBLIC_UNIT_FILE_TYPE, PUBLIC_UNIT_FILE_CATEGORIES } = await import('../../shared/letting-rules.ts');

test('the public file rule offers only files stored as uploads: never the brief, the final HOTs or the generated info sheet', () => {
  const rule = publicUnitFileSql();
  // One public type. Everything the app generates is some other type, so it
  // is kept back without having to be named (the info sheet prints the
  // tracker row's Notes box under "The opportunity").
  assert.equal(PUBLIC_UNIT_FILE_TYPE, 'upload');
  assert.match(rule, /COALESCE\(unit_marketing_files\.file_type, 'upload'\) = 'upload' AND /, 'the rule no longer limits the public files to uploads');
  assert.doesNotMatch(rule, /NOT IN/, 'a list of types to keep back lets a new generated type out by default');
  const sections = rule.match(/category, 'brochure'\) IN \(([^)]*)\)/);
  assert.ok(sections, 'the rule no longer names the sections it allows');
  assert.deepEqual(quoted(sections[1]).sort(), ['brochure', 'floorplan', 'photo']);
  assert.deepEqual([...PUBLIC_UNIT_FILE_CATEGORIES].sort(), ['brochure', 'floorplan', 'photo']);
  // The routes read that rule, not a copy of it.
  assert.match(publicUnitFile(), /publicUnitFile = sql\.raw\(publicUnitFileSql\(\)\)/);
});

test('the tracker and ChatBGP count a photo for the website by the same rule the website uses', () => {
  // The Website pill said Live on a picture the site cannot show (one
  // borrowed from Image Studio, a SharePoint link): the listing then
  // stayed off the feed with nothing on the row to say why.
  const photo = publicUnitPhotoSql('f');
  assert.ok(photo.startsWith(publicUnitFileSql('f')), 'a photo for the website must first be a public file');
  assert.match(photo, /\(f\.category = 'photo' OR f\.mime_type LIKE 'image\/%'\)$/);
  const list = route(ROUTES, 'get', '/api/available-units');
  assert.match(list, /WHERE f\.unit_id = au\.id AND \$\{publicUnitPhotoSql\("f"\)\}\)::int AS "photoCount"/);
  const chat = find('server/letting-tracker-chat.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'websiteMissingFor');
  assert.match(chat, /WHERE f\.unit_id = au\.id AND \$\{publicUnitPhotoSql\("f"\)\}\)::int AS photos/);
});

test('the info sheet, the Targeting Brief and the final HOTs are each stored under their own type, never as an upload', () => {
  assert.match(source('server/unit-info-sheet.ts'), /fileType: "infosheet"/);
  assert.doesNotMatch(source('server/unit-info-sheet.ts'), /fileType: "upload"/);
  assert.match(source('server/unit-brief-doc.ts'), /fileType: "targeting_brief"/);
  assert.doesNotMatch(source('server/unit-brief-doc.ts'), /fileType: "upload"/);
  assert.match(source('server/unit-hots.ts'), /VALUES \(\$1, \$2, \$3, 'hots_final', \$4, \$5, 'other'\)/);
});

test('the files meant for the website are stored as uploads: a person\'s own, and what the tracker chat files or cuts from a brochure', () => {
  // These are public on purpose. A new document the app writes must not go
  // through addUnitFile or be typed "upload", or the website would get it.
  const addUnitFile = find('server/letting-tracker-chat.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'addUnitFile');
  assert.match(addUnitFile, /fileType: "upload"/);
  assert.match(addUnitFile, /category: "brochure" \| "photo" \| "floorplan"/, 'addUnitFile files under a section the website does not take');
});

test('every public route reads unit files through that one rule', () => {
  for (const url of ['/api/public/leasing-listings', '/api/public/leasing-listings/:id', '/api/public/unit-files/:fileId']) {
    const handler = route(ROUTES, 'get', url);
    const reads = handler.match(/\.from\(unitMarketingFiles\)\s*\.where\(([^\n]*)\)/g) || [];
    assert.ok(reads.length > 0, `${url} no longer reads unit files`);
    for (const read of reads) assert.match(read, /publicUnitFile/, `${url} reads unit files without the public rule`);
  }
});

test('a listing never carries the Notes box or a file path', () => {
  const columns = find(ROUTES, (n, ast) => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'publicListingColumns');
  assert.doesNotMatch(columns, /availableUnits\.notes|availableUnits\.restrictions|availableUnits\.fee/);
  for (const url of ['/api/public/leasing-listings', '/api/public/leasing-listings/:id']) {
    assert.doesNotMatch(route(ROUTES, 'get', url), /unitMarketingFiles\.(filePath|fileType)/, `${url} sends a stored path or file type`);
  }
});

test('the WordPress sync takes its files from the public feed only', () => {
  const sync = source('server/wp-listings-sync.ts');
  const run = find('server/wp-listings-sync.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'runWpListingsSync');
  assert.match(run, /fetchFeed<FeedListing\[\]>\("\/api\/public\/leasing-listings"\)/);
  assert.doesNotMatch(run, /unitMarketingFiles|unit_marketing_files|getFile\(/);
  const media = find('server/wp-listings-sync.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'ensureMedia');
  assert.match(media, /fetchFeedBytes\(`\/api\/public\/unit-files\//);
  assert.ok(sync.includes('FEED_URL'));
});

test('with no PDF in the feed the website makes its own particulars from the listing, without the Notes box', () => {
  assert.match(source('marketing/src/pages/ListingDetail.tsx'), /downloadParticulars\(listing\)/);
  assert.doesNotMatch(source('marketing/src/lib/particulars-pdf.ts'), /\.notes\b/);
});
