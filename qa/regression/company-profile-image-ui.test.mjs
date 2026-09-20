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
    useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }), useEffect: () => {}, useQuery: () => ({ data: undefined, isError: false }), Button: 'Button', Star: 'Star', ImageIcon: 'ImageIcon', BrandImageRefreshButton: 'BrandImageRefreshButton', ...bindings };
  vm.runInNewContext(ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  return sandbox.exports[name];
}
const photo = { id: 'photo', file_name: 'shop.jpg', width: 1400, height: 900, tags: ['image-kind:storefront', 'image-quality:v1'], thumbnail_data: 'tiny-thumbnail' };
const logo = { id: 'logo', file_name: 'brand-logo.png', width: 1200, height: 800, tags: ['brand-hero'] };
const props = { companyId: 'company', companyName: 'Example', companyType: 'Tenant', images: [logo, photo] };

test('desktop and phone cover fits the whole original in a bounded frame without cropping the shop fascia', () => {
  const tree = component('CompanyProfileImage')(props);
  const image = nodes(tree).find(node => node.type === 'img');
  assert.equal(image.props.src, '/api/brand/gallery-image/photo?full=1');
  assert.equal(image.props.alt, 'Example cover photo');
  assert.match(image.props.className, /object-contain/);
  assert.match(image.props.className, /h-auto/);
  assert.match(image.props.className, /max-h-72/);
  assert.match(image.props.className, /sm:max-h-80/);
  assert.doesNotMatch(image.props.className, /object-cover/);
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

test('manual refresh requests new candidates and a stopped status remains an error', async () => {
  let mutation, query, cached;
  const calls = [];
  component('BrandImageRefreshButton', {
    useQueryClient: () => ({ cancelQueries: async () => {}, setQueryData: (_key, data) => { cached = data; }, getQueryData: () => cached }),
    useToast: () => ({}), RefreshCw: 'RefreshCw', Date, getAuthHeaders: () => ({}),
    useQuery: options => { query = options; return { data: undefined, isError: false }; },
    useMutation: options => { mutation = options; return { isPending: false }; },
    apiRequest: async (...args) => { calls.push(args); return { json: async () => ({ accepted: true }) }; },
    fetch: async () => ({ ok: true, json: async () => ({ state: 'idle' }) }),
  }, 'client/src/components/brand-profile-overview.tsx')({ companyId: 'company' });
  assert.equal(calls.length, 0);
  await mutation.onMutate('company');
  await mutation.mutationFn('company');
  const status = await query.queryFn({ signal: new AbortController().signal });
  assert.match(status.error, /stopped before reporting a result/);
  assert.equal(calls[0][0], 'POST');
  assert.equal(calls[0][2].force, true);
});

function imageRefreshFixture(initial) {
  const cache = new Map(), queries = [], invalidated = [], requests = [], toasts = [], refs = [];
  if (initial) cache.set('company', { ...initial, companyId: 'company' });
  let effects, refIndex, query, mutation;
  const feedback = component('brandImageRefreshFeedback', {}, 'client/src/components/brand-profile-overview.tsx');
  const renderComponent = component('BrandImageRefreshButton', {
    useRef: initial => refs[refIndex++] ||= { current: initial }, useEffect: effect => effects.push(effect),
    useQueryClient: () => ({ getQueryData: key => cache.get(key[1]), setQueryData: (key, data) => cache.set(key[1], data), cancelQueries: async () => {}, invalidateQueries: async ({ queryKey }) => invalidated.push(queryKey) }),
    useToast: () => ({ toast: value => toasts.push(value) }), getAuthHeaders: () => ({}), brandImageRefreshFeedback: feedback, RefreshCw: 'RefreshCw',
    useQuery: options => { query = options; queries.push(options.queryKey); return { data: cache.get(options.queryKey[1]), isError: false }; },
    useMutation: options => { mutation = options; return { isPending: false }; },
    apiRequest: async (...args) => { requests.push(args); return { json: async () => ({ accepted: true }) }; },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => initial || ({ state: 'idle' }) }; },
  }, 'client/src/components/brand-profile-overview.tsx');
  const render = (companyId = 'company') => { effects = []; refIndex = 0; const tree = renderComponent({ companyId }); effects.forEach(effect => effect()); return tree; };
  render();
  return { render, cache, queries, invalidated, requests, toasts, get query() { return query; }, get mutation() { return mutation; } };
}

test('image refresh restores the reason inline without starting a search or repeating a toast', async () => {
  const app = imageRefreshFixture({ state: 'done', result: { imported: 0, skipped: 'No photos passed the identity and quality review.' } });
  const tree = app.render();
  const status = nodes(tree).find(node => node.props['data-testid'] === 'brand-image-refresh-status');
  assert.match(text(status), /No new photos added/);
  assert.match(text(status), /identity and quality review/);
  assert.equal(status.props.role, 'status');
  assert.equal(app.requests.length, 0);
  assert.equal(app.toasts.length, 0);
  await app.query.queryFn({ signal: new AbortController().signal });
  assert.equal(app.requests[0].url, '/api/brand/company/refresh-images/status');
  assert.equal(app.query.refetchOnMount, 'always');
});

test('image refresh keeps completed and failed outcomes visible and isolates other companies', () => {
  for (const [initial, expected] of [
    [{ state: 'done', result: { imported: 2 } }, /2 new photos added/],
    [{ state: 'error', error: 'Image review is temporarily unavailable.' }, /review is temporarily unavailable/],
  ]) {
    const app = imageRefreshFixture(initial);
    assert.match(text(app.render()), expected);
    assert.doesNotMatch(text(app.render('other-company')), expected);
    assert.equal(app.toasts.length, 0);
  }
});

test('image job polling stops at completion and invalidates the profile without a status-refetch loop', () => {
  const app = imageRefreshFixture({ state: 'running' });
  assert.equal(app.query.refetchInterval({ state: { status: 'success', data: { state: 'running' } } }), 5000);
  assert.match(text(app.render()), /Searching for suitable photos/);
  app.cache.set('company', { companyId: 'company', state: 'done', result: { imported: 0 } });
  app.render();
  const count = app.invalidated.length;
  app.render();
  assert.equal(app.invalidated.length, count);
  assert.equal(app.invalidated.some(key => key.includes('refresh-images')), false);
  assert.equal(app.query.refetchInterval({ state: { data: { state: 'done' } } }), false);
});

test('new official sourced profile is ready even while older retained fields await review', () => {
  const data = { ready: false, officialProfileReady: true, factReviewRequired: true, identity: { status: 'verified' }, preparedSections: 2, totalSections: 9, stages: [{ stage: 'identity', status: 'ready' }, { stage: 'profile', status: 'ready' }] };
  const render = component('BrandPreparationStatus', { useQuery: () => ({ data }), shortDate: () => null }, 'client/src/components/brand-profile-overview.tsx');
  const tree = render({ companyId: 'company', refreshedAt: null });
  assert.match(text(tree), /Official profile prepared/);
  assert.match(text(tree), /can support a new BGP brief/);
  assert.match(text(tree), /Older retained.*separate review/);
  data.officialProfileReady = false;
  assert.match(text(render({ companyId: 'company', refreshedAt: null })), /Core facts need review/);
});
