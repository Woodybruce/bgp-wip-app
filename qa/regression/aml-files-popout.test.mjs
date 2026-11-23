// A party's files as thumbnails that open in a pop-out viewer (Woody, 23 November
// 2026: "on the files can the app show the files so can check them at any point
// rather than having to download a zip just a thumbnail can click and it pops
// out?"). Source guards: the files come from the AML board's own trail route
// (BGP staff only), the viewer fetches only this app's addresses with the
// signed-in headers, and never draws an SVG or HTML file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const viewer = read('client/src/components/file-popout.tsx');
const files = read('client/src/components/aml-files.tsx');
const box = read('client/src/components/deal-aml-status.tsx');
const docs = read('client/src/components/kyc-documents.tsx');
const board = read('client/src/pages/aml-dashboard.tsx');
const checks = read('client/src/components/kyc-client-checks.tsx');
const rules = read('shared/file-preview.ts');
const trail = read('server/aml-dashboard.ts');

test('the files are the AML trail route, read with the signed-in headers', () => {
  assert.match(files, /\/api\/aml-dashboard\/party\?dealId=/);
  assert.match(files, /credentials: "include", headers: getAuthHeaders\(\)/);
  const route = trail.slice(trail.indexOf('router.get("/api/aml-dashboard/party"'), trail.indexOf('router.get("/api/aml-dashboard/party"') + 600);
  assert.match(route, /staffMe\(req\)|contactViewer\(req\)/);
});

test('the viewer fetches only in-app files, as a blob, and never draws SVG or HTML', () => {
  assert.match(viewer, /inAppFileUrl\(/);
  assert.match(viewer, /credentials: "include"/);
  assert.match(viewer, /getAuthHeaders\(\)/);
  assert.match(viewer, /URL\.createObjectURL\(/);
  assert.match(rules, /svg\|html\?\|xml\|xhtml/);
  assert.doesNotMatch(viewer, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(viewer, /<iframe/);
});

test('the thumbnails are on each party\'s Documents step, the AML board\'s trail, the upload box and the client checks', () => {
  assert.match(box, /<PartyFiles dealId=\{dealId\} role=\{cp\.role\} \/>/);
  assert.match(board, /<FileThumbGrid files=\{partyFilesForPreview\(trail\.documents\)\}/);
  assert.match(docs, /<FilePopout files=\{\[\{ key: doc\.id/);
  assert.match(checks, /<FileThumbGrid\b/);
});
