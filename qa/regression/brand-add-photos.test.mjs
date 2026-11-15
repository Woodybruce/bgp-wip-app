// Fixes from filming the phone scenes (Woody, 15 November 2026, "fix the phone
// issues"): Add photos on a brand's page is BGP staff's and goes through the
// existing upload and Attach to brand routes; the Tenant rep line carries the
// agent's number; the covenant badge's read answers quietly when nothing is
// held and is not asked twice after a refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, route, evaluate } = require('./source-harness.cjs');

test('Add photos files each upload against the brand through the existing routes, and only BGP staff are offered it', () => {
  const photos = source('client/src/components/brand-page/brand-photos.tsx');
  assert.match(photos, /fetch\("\/api\/image-studio\/upload", \{ method: "POST"/);
  assert.match(photos, /for \(const image of saved\) await apiRequest\("POST", `\/api\/image-studio\/\$\{image\.id\}\/attach`, \{ targetType: "brand", targetId: companyId \}\);/);
  assert.match(photos, /<input[^>]*\bmultiple\b/s, 'several images in one go');
  assert.match(photos, /action=\{canAdd \? <BrandAddPhotos /, 'the card draws the control only when told the viewer may add');
  assert.match(source('client/src/components/mobile-brand-view.tsx'), /<BrandPhotosCard [^\n]*canAdd=\{!isClientViewer\} \/>/);
  const panel = source('client/src/components/brand-profile-panel.tsx');
  const uses = panel.split('\n').filter(line => line.includes('<BrandAddPhotos '));
  assert.equal(uses.length, 2);
  assert.ok(uses.some(line => /\{!sbIsClient && !isLandlord && <BrandAddPhotos /.test(line)), 'desktop gallery: never drawn for a client login');
  assert.match(panel, /brandPage && !sbIsClient && uniqueImages\.length === 0 && \(\s*<BrandQuietBlock testId="brand-gallery-quiet">\s*<BrandQuietLine testId="brand-gallery-empty">\s*No saved images yet · <BrandAddPhotos /,
    'desktop, no image yet: the quiet line is staff only');
  // The server's own rule is unchanged: a client login attaches only to its own company.
  const attach = route('server/image-studio.ts', 'post', '/api/image-studio/:id/attach');
  assert.match(attach, /\(\(targetType === "brand" \|\| targetType === "company"\) && targetId === attachScope\);\s*if \(!targetOk\) return res\.status\(403\)/);
});

test('the Tenant rep lines are sent the named agent\'s number as the client Agents list words it', () => {
  const profile = source('server/brand-profile.ts');
  assert.match(profile, /ct\.name AS contact_name, ct\.email AS contact_email,\s*COALESCE\(NULLIF\(ct\.phone_mobile, ''\), ct\.phone\) AS contact_phone\s*FROM brand_agent_representations r/);
  assert.match(source('server/client-agent-directory.ts'), /COALESCE\(NULLIF\(ct\.phone_mobile, ''\), ct\.phone\) AS "contactPhone"/);
  // A client is still sent tenant-rep representation only.
  assert.match(profile, /representedBy: bpScope\s*\? repsForBrand\.rows\.filter\(\(r: any\) => r\.agent_type === "tenant_rep"\)/);
});

function covenantRoute({ number, report, key }) {
  let handler;
  const app = { get: (_path, _auth, fn) => { handler = fn; } };
  evaluate(route('server/covenant-engine.ts', 'get', '/api/covenant/by-crm/:companyId'), {
    app, requireAuth: () => {}, process: { env: key ? { COMPANIES_HOUSE_API_KEY: 'set' } : {} },
    pool: { query: async () => ({ rows: number ? [{ companies_house_number: number }] : [] }) },
    getCovenantReport: async () => { if (report) return report; throw new Error('Companies House API key not configured'); },
  });
  return async () => {
    const out = { status: 200, body: undefined };
    const res = { status(code) { out.status = code; return res; }, json(body) { out.body = body; return res; }, end() { return res; } };
    await handler({ params: { companyId: 'brand' } }, res);
    return out;
  };
}

test('the covenant badge read answers 204 when nothing is held, and keeps its error when Companies House is set up', async () => {
  assert.equal((await covenantRoute({ number: null, key: false })()).status, 204, 'no Companies House number');
  assert.equal((await covenantRoute({ number: '00214436', key: false })()).status, 204, 'no key and no stored report: nothing held');
  assert.deepEqual(await covenantRoute({ number: '00214436', key: false, report: { grade: 'A' } })(), { status: 200, body: { grade: 'A' } }, 'a stored report is still served with no key');
  assert.equal((await covenantRoute({ number: '00214436', key: true })()).status, 400, 'a real failure is still reported');
  assert.match(source('client/src/components/covenant-badge.tsx'), /retry: \(failures, error\) => failures < 1 && !\/\^4\\d\\d:\/\.test\(/, 'a refusal is not asked for twice');
});
