import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { phoneFixtureConfig } from '../phone-property-brand-fixture.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, ts } = require('./source-harness.cjs');

test('phone smoke fixture writes are restricted to dedicated local smoke databases', () => {
  assert.equal(phoneFixtureConfig('postgresql://postgres@localhost:5432/bgpsmoke').database, 'bgpsmoke');
  assert.equal(phoneFixtureConfig('postgresql:///bgp_smoke?host=/tmp/bgp-phone-test/socket&port=55446&user=postgres').host, '/tmp/bgp-phone-test/socket');
  for (const url of [undefined, 'postgresql://remote.example/bgpsmoke', 'postgresql://localhost/production', 'postgresql://localhost/bgpsmoke?host=remote.example', 'postgresql://localhost/bgpsmoke?hostaddr=8.8.8.8', 'postgresql:///bgp_smoke?host=/tmp/ordinary/socket']) {
    assert.throws(() => phoneFixtureConfig(url), /smoke|disposable/i);
  }
});

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants(node.props.children)];
}
function content(node) {
  if (Array.isArray(node)) return node.map(content).join(' ');
  if (React.isValidElement(node)) return content(node.props.children);
  return node == null ? '' : String(node);
}

// Execute the real phone hook against device inputs. This checks routing, not
// browser layout; visual/touch behavior still needs the emulated browser suite.
function deviceFixture({ width = 390, height = 844, touch = true, ua = 'iPhone Mobile', desktop = false } = {}) {
  const file = 'client/src/hooks/use-mobile.tsx';
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const code = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
  const slots = [], effects = [], listeners = new Map(), storage = new Map(desktop ? [['bgp-force-desktop', 'true']] : []);
  let cursor = 0;
  const window = { innerWidth: width, innerHeight: height,
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener() {},
    dispatchEvent(event) { listeners.get(event.type)?.(); },
    matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
  };
  if (touch) window.ontouchstart = null;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = value; }]; },
    useEffect(fn) { const index = cursor++; if (!(index in slots)) { slots[index] = true; effects.push(fn); } },
  };
  const bindings = { React: hooks, exports: {}, window, navigator: { userAgent: ua, maxTouchPoints: touch ? 5 : 0 },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, Event };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, bindings);
  return { window, hooks: bindings.exports,
    render() { cursor = 0; const result = bindings.exports.useIsMobile(); while (effects.length) effects.shift()(); return result; },
    resize(width, height) { window.innerWidth = width; window.innerHeight = height; window.dispatchEvent(new Event('resize')); },
  };
}

test('actual mobile routing requires touch plus a phone UA, handles rotation and honours desktop preference', () => {
  for (const ua of ['iPhone Mobile', 'Mozilla/5.0 (Linux; Android 14) Mobile']) {
    const phone = deviceFixture({ ua });
    assert.equal(phone.render(), true);
    phone.resize(844, 390);
    assert.equal(phone.render(), true, 'landscape phone retains its phone shell');
    phone.hooks.setForceDesktop(true);
    assert.equal(phone.render(), false);
    assert.equal(phone.hooks.isNativeMobile(), true);
    phone.hooks.setForceDesktop(false);
    assert.equal(phone.render(), true);
  }
  assert.equal(deviceFixture({ ua: 'Macintosh', touch: false }).render(), false, 'narrow desktop is not a phone check');
  assert.equal(deviceFixture({ ua: 'Windows', touch: true }).render(), false, 'touch desktop keeps desktop routing');
  assert.equal(deviceFixture({ touch: false }).render(), false);
  assert.equal(deviceFixture({ width: 1024, height: 1366, ua: 'iPad' }).render(), false);
});

function componentFixture(file, name, props, input) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name || ts.isVariableStatement(node));
  const slots = [], effects = [], calls = [], profileRefreshHooks = [], bindings = {};
  let cursor = 0, dirty = false;
  for (const node of ast.statements) if (ts.isImportDeclaration(node)) {
    for (const member of node.importClause?.namedBindings?.elements || []) bindings[member.name.text] = function Leaf() { return null; };
  }
  Object.assign(bindings, {
    React, exports: {}, console, URL, Date,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { const value = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; } }]; },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useEffect(fn, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) { slots[index] = deps; effects.push(fn); } },
    useQuery({ queryKey }) { return { data: queryKey[0] === '/api/auth/me' ? input.user : queryKey.at(-1) === 'profile' ? input.profile : queryKey.at(-1) === 'preparation' ? input.preparation : undefined, isLoading: false, isError: queryKey.at(-1) === 'profile' && input.failed, refetch: () => calls.push('retry saved profile') }; },
    useToast: () => ({ toast() {} }), useMutation: () => ({ isPending: false, mutate: (...args) => calls.push(args) }),
    useBrand: () => ({ brand: { id: input.brandId || 'bgp' } }),
    useBrandProfileRefresh(companyId, enabled) {
      profileRefreshHooks.push({ companyId, enabled });
      return {
        isPending: !!input.refreshPending,
        message: enabled ? input.refreshMessage || '' : '',
        mutate() {
          assert.equal(enabled, true, 'client controls must not call the staff refresh action');
          calls.push({ action: 'refresh profile', companyId });
        },
      };
    },
  });
  const compiled = ts.transpileModule(declarations.map(node => node.getText(ast)).join('\n'), { fileName: 'fixture.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(compiled, bindings);
  return { props, bindings, input, calls, profileRefreshHooks,
    render() { let tree; for (let pass = 0; pass < 10; pass++) { cursor = 0; dirty = false; tree = bindings.exports[name](props); while (effects.length) effects.shift()(); if (!dirty) return tree; } throw new Error('Render did not settle'); },
    find(tree, id) { return descendants(tree).find(node => node.props['data-testid'] === id); },
  };
}

const profile = () => ({ company: { id: 'brand', name: 'Phone QA Brand', company_type: 'Tenant - Retail' }, contacts: [{ id: 'brand-contact', name: 'Brand contact' }], representedBy: [
  { id: 'unknown-firm', agent_type: 'tenant_rep', contact_name: 'Named agent', primary_contact_id: 'agent-contact' },
  { id: 'known-firm', agent_type: 'tenant_rep', agent_name: 'Recorded Agency', agent_company_id: 'agency', contact_name: 'Agency person', primary_contact_id: 'agency-contact', region: 'south_east' },
] });
const phoneBrand = (user = { role: 'Client', companyScopeId: 'client' }, extra = {}) => componentFixture('client/src/components/mobile-brand-view.tsx', 'MobileBrandView', { companyId: 'brand' }, { user, profile: profile(), ...extra });

test('phone Contacts renders named representations with canonical contact and confirmed-firm links, without inventing employers', () => {
  for (const user of [{ role: 'Client', companyScopeId: 'client' }, { role: 'Admin' }]) {
    const app = phoneBrand(user);
    let tree = app.render();
    if (user.role !== 'Client') { app.find(tree, 'company-section-contacts').props.onClick(); tree = app.render(); }
    assert.equal(app.find(tree, 'company-section-contacts').props.active, true);
    const block = app.find(tree, 'company-phone-represented-by');
    assert.match(content(block), /Named agent.*Firm unconfirmed.*Agency person.*Recorded Agency/s);
    assert.deepEqual(descendants(block).filter(node => node.type === app.bindings.Link).map(node => node.props.href), ['/contacts/agent-contact', '/contacts/agency-contact', '/companies/agency']);
    const contactBoard = descendants(tree).find(node => node.type === app.bindings.CompanyContactsBoard);
    assert.equal(contactBoard.props.contacts, app.input.profile.contacts, 'existing canonical contacts and controls remain');
    assert.equal(descendants(block).some(node => node.props.onClick || node.type === 'button'), false, 'representation display creates no new write capability');
    assert.deepEqual(app.calls, [], 'opening and switching sections does not trigger enrichment or writes');
  }
});

test('phone representations without record IDs render text and do not create broken links', () => {
  const app = phoneBrand();
  app.input.profile.representedBy = [{ id: 'legacy', contact_name: 'Legacy named contact', agent_name: 'Unconfirmed name' }];
  const tree = app.render(), block = app.find(tree, 'company-phone-represented-by');
  assert.match(content(block), /Legacy named contact.*Firm unconfirmed/s);
  assert.equal(descendants(block).filter(node => node.type === app.bindings.Link).length, 0);
  app.input.profile.representedBy = [];
  assert.equal(app.find(app.render(), 'company-phone-represented-by'), undefined);
});

test('phone saved-profile retry and staff refresh remain explicit while client controls remain unchanged', () => {
  const failed = phoneBrand({ role: 'Admin' }, { failed: true });
  const tree = failed.render();
  assert.match(content(tree), /saved brand profile could not be loaded/);
  descendants(tree).find(node => node.type === failed.bindings.Button).props.onClick();
  assert.deepEqual(failed.calls, ['retry saved profile']);
  const client = phoneBrand();
  assert.equal(client.find(client.render(), 'button-brand-refresh'), undefined);
  assert.ok(client.profileRefreshHooks.every(call => call.companyId === 'brand' && call.enabled === false));
  assert.deepEqual(client.calls, []);
  const staff = phoneBrand({ role: 'Admin' });
  const refresh = staff.find(staff.render(), 'button-brand-refresh');
  assert.ok(refresh);
  assert.deepEqual(staff.calls, []);
  assert.ok(staff.profileRefreshHooks.every(call => call.companyId === 'brand' && call.enabled === true));
  refresh.props.onClick();
  assert.deepEqual(staff.calls, [{ action: 'refresh profile', companyId: 'brand' }]);
});

test('phone staff refresh displays its pending and completed messages without starting work on render', () => {
  const app = phoneBrand({ role: 'Admin' }, { refreshPending: true, refreshMessage: 'Refreshing saved facts.' });
  let tree = app.render();
  assert.equal(app.find(tree, 'button-brand-refresh').props.disabled, true);
  assert.match(content(app.find(tree, 'brand-profile-refresh-status')), /Refreshing saved facts/);
  assert.equal(app.find(tree, 'brand-profile-refresh-status').props.role, 'status');
  app.input.refreshPending = false;
  app.input.refreshMessage = 'Profile checked. No saved facts changed.';
  tree = app.render();
  assert.equal(app.find(tree, 'button-brand-refresh').props.disabled, false);
  // Success commentary is not shown (Woody, 2026-09-23) — only progress and problems.
  assert.equal(app.find(tree, 'brand-profile-refresh-status'), undefined);
  assert.deepEqual(app.calls, []);
});

test('phone-shared preparation control separates core readiness from contact review and keeps details reachable', () => {
  const app = componentFixture('client/src/components/brand-profile-overview.tsx', 'BrandPreparationStatus', { companyId: 'brand', refreshedAt: null }, { preparation: {
    ready: true, preparedSections: 2, totalSections: 9, contactReviewRequired: true, identity: { status: 'verified' },
    stages: [{ stage: 'identity', status: 'ready' }, { stage: 'profile', status: 'ready' }, { stage: 'contacts', status: 'needs_review', reason: 'Review linked contacts before marking this section complete' }],
  } });
  const tree = app.render();
  assert.equal(tree.type, 'details');
  const summary = content(descendants(tree).find(node => node.type === 'summary'));
  // A prepared profile says nothing in the summary; contact review lives in Key contacts (Woody, 2026-09-23).
  assert.match(summary, /Details/); assert.doesNotMatch(summary, /Core facts prepared|Contacts need review/);
  assert.match(content(tree), /2.*of.*9.*automatic sections prepared/);
  assert.match(content(tree), /background preparation does not verify people/);
});

test('phone Overview shows Schemes and units to staff and a Landsec view only, with the take, the CRM plan and Menu highlights once each', () => {
  const cases = [
    { user: { role: 'Admin', email: 'agent@brucegillinghampollard.com' }, brandId: 'bgp', client: false },
    { user: { role: 'Client', companyScopeId: 'landsec-company' }, brandId: 'landsec', client: true },
    { user: { role: 'Admin', email: 'agent@brucegillinghampollard.com', companyScopeId: 'landsec-company' }, brandId: 'landsec', client: true },
    { user: { role: 'Client', companyScopeId: 'another-landlord' }, brandId: 'client', client: null },
  ];
  for (const { user, brandId, client } of cases) {
    const app = phoneBrand(user, { brandId });
    const tree = app.render();
    const drawn = name => descendants(tree).filter(node => node.type === app.bindings[name]);
    const overview = descendants(tree).find(node => node.type === 'div' && descendants(node.props.children).some(child => child.type === app.bindings.BgpTakeStrip));
    const onOverview = name => descendants(overview.props.children).filter(node => node.type === app.bindings[name]);
    assert.equal(drawn('SchemePlanCard').length, client === null ? 0 : 1, `${brandId} view`);
    if (client !== null) {
      assert.equal(onOverview('SchemePlanCard').length, 1, 'the card sits on Overview');
      assert.deepEqual({ companyId: drawn('SchemePlanCard')[0].props.companyId, client: drawn('SchemePlanCard')[0].props.client }, { companyId: 'brand', client });
    }
    // Targeted and Pitched leave the old lists only where the card replaces them.
    assert.equal(drawn('PortfolioActivityBlock').length, 1);
    assert.equal(drawn('PortfolioActivityBlock')[0].props.schemePlan, client !== null);
    for (const name of ['BgpTakeStrip', 'LandlordEngagementPanel', 'MenuIntelCard']) assert.equal(drawn(name).length, 1, `${name} once for the ${brandId} view`);
  }
  // A company that is not a tenant brand gets no card, whoever is looking.
  const agency = phoneBrand({ role: 'Admin', email: 'agent@brucegillinghampollard.com' });
  agency.input.profile.company.company_type = 'Agent';
  assert.equal(descendants(agency.render()).some(node => node.type === agency.bindings.SchemePlanCard), false);
});

test('phone brand Contacts gives BGP staff the landlord-style board with the account contacts; a client keeps the board and contacts it has today', () => {
  const workspace = { contacts: [{ contactId: 'workspace-contact' }] };
  const mapped = [{ id: 'workspace-contact' }];
  const board = (user, type = 'Tenant - Retail') => {
    const app = phoneBrand(user);
    app.input.profile.company.company_type = type;
    app.input.profile.dismissedDiscoveries = ['contact:email:gone@brand.test'];
    const asked = [];
    app.bindings.useAccountWorkspace = id => { asked.push(id); return { data: id ? workspace : undefined }; };
    app.bindings.accountBoardContacts = ws => (assert.equal(ws, workspace), mapped);
    app.bindings.isLandlordCompany = () => false;
    const props = descendants(app.render()).find(node => node.type === app.bindings.CompanyContactsBoard).props;
    return { props, asked, profile: app.input.profile };
  };
  const staff = board({ role: 'Admin', email: 'agent@brucegillinghampollard.com' });
  assert.deepEqual(staff.asked.at(-1), 'brand');
  assert.equal(staff.props.contacts, mapped);
  assert.equal(staff.props.isLandlord, true, 'the board the desktop brand page uses');
  assert.equal(staff.props.meetingHistory, false, 'meeting history stays landlord only');
  assert.deepEqual(staff.props.dismissedSuggestions, ['contact:email:gone@brand.test']);
  for (const user of [{ role: 'Client', companyScopeId: 'client' }, { role: 'Admin', email: 'agent@brucegillinghampollard.com', companyScopeId: 'landsec-company' }]) {
    const client = board(user);
    assert.deepEqual(client.asked, client.asked.map(() => undefined), 'no account contacts are requested for a client view');
    assert.equal(client.props.contacts, client.profile.contacts);
    assert.equal(client.props.isLandlord, false);
  }
  // A company that is not a tenant brand is untouched.
  const agency = board({ role: 'Admin', email: 'agent@brucegillinghampollard.com' }, 'Agent');
  assert.equal(agency.props.isLandlord, false);
  assert.equal(agency.props.contacts, agency.profile.contacts);
});
