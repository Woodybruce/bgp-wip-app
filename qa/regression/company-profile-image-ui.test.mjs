import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { selectCompanyHeroImage, rankCompanyHeroImages, companyImageHeroIssue } from '../../shared/brand-image-selection.ts';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : []; }
function text(node) { return Array.isArray(node) ? node.map(text).join(' ') : React.isValidElement(node) ? text(node.props.children) : node == null ? '' : String(node); }
function component(name, bindings = {}, file = 'client/src/components/company-profile-image.tsx') {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const sandbox = { exports: {}, require, encodeURIComponent, selectCompanyHeroImage, rankCompanyHeroImages, companyImageHeroIssue,
    useState: initial => [initial, () => {}], Button: 'Button', Star: 'Star', ImageIcon: 'ImageIcon', BrandImageRefreshButton: 'BrandImageRefreshButton', ...bindings };
  vm.runInNewContext(ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  return sandbox.exports[name];
}
const photo = { id: 'photo', file_name: 'shop.jpg', width: 1400, height: 900, tags: ['image-kind:storefront', 'image-quality:v1'], thumbnail_data: 'tiny-thumbnail' };
const logo = { id: 'logo', file_name: 'brand-logo.png', width: 1200, height: 800, tags: ['brand-hero'] };
const props = { companyId: 'company', companyName: 'Example', companyType: 'Tenant', images: [logo, photo] };

test('desktop and phone cover uses a suitable full original, never the embedded thumbnail or logo', () => {
  const tree = component('CompanyProfileImage')(props);
  const image = nodes(tree).find(node => node.type === 'img');
  assert.equal(image.props.src, '/api/brand/gallery-image/photo?full=1');
  assert.equal(image.props.alt, 'Example cover photo');
  assert.match(image.props.className, /object-cover/);
  assert.doesNotMatch(image.props.src, /thumbnail|logo/);
});

test('logos only give a compact empty state with existing staff refresh restriction', () => {
  const render = component('CompanyProfileImage');
  const staff = render({ ...props, images: [logo], canRefresh: true });
  const client = render({ ...props, images: [logo], canRefresh: false });
  assert.match(text(staff), /No suitable cover photo yet/);
  assert.equal(nodes(staff).some(node => node.type === 'img'), false);
  assert.equal(nodes(staff).some(node => node.type === 'BrandImageRefreshButton'), true);
  assert.equal(nodes(client).some(node => node.type === 'BrandImageRefreshButton'), false);
});

test('lost original gives an honest error state and does not upscale a thumbnail', () => {
  let failed = [];
  const render = component('CompanyProfileImage', { useState: () => [failed, value => { failed = typeof value === 'function' ? value(failed) : value; }] });
  nodes(render(props)).find(node => node.type === 'img').props.onError();
  const failedTree = render(props);
  assert.match(text(failedTree), /cover photos could not be loaded/);
  assert.equal(nodes(failedTree).some(node => node.type === 'img'), false);
  assert.equal(nodes(render({ ...props, images: [{ ...photo, id: 'replacement' }] })).some(node => node.type === 'img'), true);
});

test('failed preferred original falls through suitable saved photos once, skipping logos and small images', () => {
  let failed = [];
  const render = component('CompanyProfileImage', { useState: () => [failed, value => { failed = typeof value === 'function' ? value(failed) : value; }] });
  const preferred = { ...photo, id: 'preferred', tags: [...photo.tags, 'brand-hero'] };
  const backup = { ...photo, id: 'backup' };
  const candidates = { ...props, images: [logo, preferred, { ...photo, id: 'small', width: 120, height: 80 }, backup] };
  const first = nodes(render(candidates)).find(node => node.type === 'img');
  assert.equal(first.props.src, '/api/brand/gallery-image/preferred?full=1');
  first.props.onError();
  first.props.onError();
  const next = nodes(render(candidates)).find(node => node.type === 'img');
  assert.equal(next.props.src, '/api/brand/gallery-image/backup?full=1');
  assert.equal(failed.length, 1);
  next.props.onError();
  assert.equal(nodes(render(candidates)).some(node => node.type === 'img'), false);
  assert.equal(failed.length, 2);
  assert.match(text(render(candidates)), /cover photos could not be loaded/);
  assert.equal(nodes(render({ ...candidates, companyId: 'different-company' })).find(node => node.type === 'img').props.src, '/api/brand/gallery-image/preferred?full=1');
});

test('a pinned logo remains available to unpin but cannot become a new cover', () => {
  let action;
  const render = component('CompanyImageCoverChoice');
  const pinned = render({ image: logo, images: [logo, photo], pending: false, onToggle: value => { action = value; } });
  const pinnedButton = nodes(pinned).find(node => node.type === 'Button');
  assert.equal(pinnedButton.props.disabled, false);
  pinnedButton.props.onClick();
  assert.equal(action, true);
  assert.match(text(pinned), /Logos are shown in the gallery/);
  const unpinned = render({ image: { ...logo, tags: [] }, images: [photo], pending: false, onToggle() {} });
  assert.equal(nodes(unpinned).find(node => node.type === 'Button').props.disabled, true);
});

test('cover choice explains one visible photo and keeps existing choices until explicitly unpinned', () => {
  const first = { ...photo, id: 'first', tags: [...photo.tags, 'brand-hero'] };
  const second = { ...photo, id: 'second' };
  const render = component('CompanyImageCoverChoice');
  const choice = render({ image: second, images: [first, second], pending: false, onToggle() {} });
  assert.match(text(choice), /Unpin the current choice/);
  assert.equal(nodes(choice).find(node => node.type === 'Button').props.disabled, true);
  const oldPin = { ...second, tags: [...second.tags, 'brand-hero'] };
  const saved = render({ image: oldPin, images: [first, oldPin], pending: false, onToggle() {} });
  assert.match(text(saved), /saved choice is behind another pinned photo/);
  assert.equal(nodes(saved).find(node => node.type === 'Button').props.disabled, false);
});

test('low resolution photo stays gallery-only with an actionable explanation', () => {
  const small = { ...photo, width: 160, height: 100 };
  const tree = component('CompanyImageCoverChoice')({ image: small, images: [small], pending: false, onToggle() {} });
  assert.match(text(tree), /too small/);
  assert.equal(nodes(tree).find(node => node.type === 'Button').props.disabled, true);
});

test('refresh does not claim success when nothing was imported or the search was skipped', () => {
  const feedback = component('brandImageRefreshFeedback', {}, 'client/src/components/brand-profile-overview.tsx');
  assert.equal(feedback({ imported: 0, skipped: 'Confirm the official website first.' }).title, 'No new photos added');
  assert.equal(feedback({ imported: 0, skipped: 'Confirm the official website first.' }).description, 'Confirm the official website first.');
  assert.match(feedback({ imported: 2 }).description, /2 new photos added/);
  assert.match(feedback({ imported: 0, reason: 'Photo review unavailable; existing photos kept.' }).description, /review unavailable/);
});

test('manual refresh requests new candidates and propagates stopped jobs as an error', async () => {
  let mutation;
  const calls = [];
  component('BrandImageRefreshButton', {
    useQueryClient: () => ({}), useToast: () => ({}), RefreshCw: 'RefreshCw', Date,
    useMutation: options => { mutation = options; return { isPending: false }; },
    setTimeout: resolve => { resolve(); },
    apiRequest: async (...args) => { calls.push(args); return { json: async () => ({ state: 'idle' }) }; },
  }, 'client/src/components/brand-profile-overview.tsx')({ companyId: 'company' });
  await assert.rejects(mutation.mutationFn(), /stopped before reporting a result/);
  assert.equal(calls[0][0], 'POST');
  assert.equal(calls[0][2].force, true);
});
