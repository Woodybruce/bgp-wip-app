// The Landsec menu (docs/landsec-menu-plan-2026-11-12.md, parts 1, 2 and 6):
// what each login's side bar and phone tabs hold, and who is sent on from the
// old addresses. The lists are cut from the source and run, so a change to a
// label or an address shows here. The lit-entry rule itself is tested in
// server/landsec-menu.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { LANDSEC_MENU, LANDSEC_RESTRICTED_MENU, landsecMenuActive } from '../../shared/landsec-menu.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');

const SIDEBAR = 'client/src/components/app-sidebar.tsx', TABS = 'client/src/components/mobile-bottom-nav.tsx', APP = 'client/src/App.tsx';
const statement = (file, start) => find(file, node => ts.isVariableStatement(node) && node.getText().startsWith(start));
const fn = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
// Values made inside the evaluated source belong to another realm.
const plain = value => JSON.parse(JSON.stringify(value));
const ICONS = Object.fromEntries(['LayoutDashboard', 'Building2', 'BarChart3', 'Store', 'Handshake', 'Layers', 'Eye', 'ListTodo', 'Target', 'MessageCircle', 'CheckSquare'].map(name => [name, name]));
const BINDINGS = { ...ICONS, LANDSEC_MENU, LANDSEC_RESTRICTED_MENU };

const sidebar = evaluate([
  statement(SIDEBAR, 'export const LANDSEC_NAV ='),
  statement(SIDEBAR, 'const LANDSEC_RESTRICTED_NAV ='),
  statement(SIDEBAR, 'export const LANDSEC_JOINT_AGENT_NAV ='),
  statement(SIDEBAR, 'const JOINT_AGENT_BRAND_CRM ='),
  fn(SIDEBAR, 'landsecNavFor'),
].join('\n'), BINDINGS);
const menu = role => plain(sidebar.landsecNavFor(role)).map(i => [i.title, i.url]);

const tabs = evaluate([
  statement(TABS, 'const LANDSEC_NAV_ITEMS ='),
  statement(TABS, 'const LANDSEC_STAFF_NAV_ITEMS ='),
  statement(TABS, 'const LANDSEC_ASSET_MANAGER_NAV_ITEMS ='),
  statement(TABS, 'const LANDSEC_JOINT_AGENT_NAV_ITEMS ='),
  'exports.full = LANDSEC_NAV_ITEMS; exports.staff = LANDSEC_STAFF_NAV_ITEMS; exports.assetManager = LANDSEC_ASSET_MANAGER_NAV_ITEMS; exports.jointAgent = LANDSEC_JOINT_AGENT_NAV_ITEMS;',
].join('\n'), BINDINGS);
const phone = which => plain(tabs[which]).map(i => [i.label, i.path]);

const FULL_MENU = [['Properties', '/deals/properties'], ['Deals', '/deals'], ['Letting Tracker', '/deals/letting'], ['Brands', '/brands']];
const GONE = ['Portfolio', 'Scheme', 'Lettings', 'Ask'];

test('a full Landsec login and a leasing manager have Properties, Deals, Letting Tracker, Brands', () => {
  for (const role of [null, undefined, '', 'leasing_manager']) assert.deepEqual(menu(role), FULL_MENU, String(role));
});

test('an asset manager keeps the scheme-limited pages under the new names, and Brands', () => {
  assert.deepEqual(menu('asset_manager'), [['Properties', '/'], ['Deals', '/landsec/deals'], ['Brands', '/brands']]);
});

test('a joint agent keeps Tracker, Viewings, Tasks and Brand CRM, in that order, after the two renamed entries', () => {
  assert.deepEqual(menu('joint_agent'), [
    ['Properties', '/'], ['Deals', '/landsec/deals'],
    ['Tracker', '/landsec/tracker'], ['Viewings', '/landsec/viewings'], ['Tasks', '/landsec/tasks'],
    ['Brand CRM', '/landsec/brand-crm'],
  ]);
});

test('no login has a Portfolio, Scheme, Lettings or Ask entry, or a menu entry to ChatBGP', () => {
  for (const role of [null, 'leasing_manager', 'asset_manager', 'joint_agent']) {
    for (const [title, url] of menu(role)) {
      assert.ok(!GONE.includes(title), `${role}: ${title}`);
      assert.ok(url !== '/chatbgp' && url !== '/messages', `${role}: ${url}`);
    }
  }
  for (const which of ['full', 'staff', 'assetManager', 'jointAgent']) {
    for (const [label] of phone(which)) assert.ok(!GONE.includes(label), `${which}: ${label}`);
  }
});

test('a joint agent has no Brands entry on either menu', () => {
  assert.ok(!menu('joint_agent').some(([, url]) => url.startsWith('/brands')));
  assert.ok(!phone('jointAgent').some(([, path]) => path.startsWith('/brands')));
});

test('phone tabs: Properties, Deals, Tracker, Brands, Chat for a Landsec login', () => {
  assert.deepEqual(phone('full'), [['Properties', '/deals/properties'], ['Deals', '/deals'], ['Tracker', '/deals/letting'], ['Brands', '/brands'], ['Chat', '/messages']]);
});

test('phone tabs: staff viewing as Landsec keep Home, the way out of the Landsec view, in place of Brands', () => {
  assert.deepEqual(phone('staff'), [['Home', '/'], ['Properties', '/deals/properties'], ['Deals', '/deals'], ['Tracker', '/deals/letting'], ['Chat', '/messages']]);
});

test('phone tabs: an asset manager and a joint agent have no Chat tab', () => {
  assert.deepEqual(phone('assetManager'), [['Properties', '/'], ['Deals', '/landsec/deals'], ['Brands', '/brands']]);
  assert.deepEqual(phone('jointAgent'), [['Properties', '/'], ['Deals', '/landsec/deals'], ['Tracker', '/landsec/tracker'], ['Viewings', '/landsec/viewings'], ['Tasks', '/landsec/tasks']]);
  // The joint agent's sixth tab, CRM, is added where the tabs are chosen.
  assert.match(source(TABS), /\[\.\.\.LANDSEC_JOINT_AGENT_NAV_ITEMS, \{ label: "CRM", icon: Target, path: "\/landsec\/brand-crm" \}\]/);
});

test('each entry is the only one lit on its own address', () => {
  for (const list of [menu(null), phone('full'), phone('staff')]) {
    for (const [name, url] of list) {
      const lit = list.filter(([, other]) => landsecMenuActive(other, url)).map(([n]) => n);
      assert.deepEqual(lit, [name], url);
    }
  }
});

test('an asset manager or joint agent is never sent to an address their route list refuses', () => {
  const routes = plain(evaluate(`${statement(APP, 'const LANDSEC_RESTRICTED_ROUTES')}\nexports.routes = LANDSEC_RESTRICTED_ROUTES;`).routes);
  for (const role of ['asset_manager', 'joint_agent']) {
    const allowed = url => routes[role].some(p => p === '/' ? url === '/' : (url === p || url.startsWith(p + '/')));
    for (const [title, url] of menu(role)) assert.ok(allowed(url), `${role}: ${title} ${url}`);
    // The reason they are left out of the redirects: these would bounce.
    for (const url of [LANDSEC_MENU.properties, LANDSEC_MENU.deals, LANDSEC_MENU.tracker]) assert.ok(!allowed(url), `${role}: ${url}`);
  }
  // Each redirect asks the role first and gives those two their own page.
  for (const [name, page] of [['Home', 'LandsecHome'], ['LandsecDealsRoute', 'LandsecDeals'], ['LandsecSchemeRoute', 'LandsecScheme']]) {
    const body = fn(APP, name);
    const keeps = body.indexOf(`return <${page} />`), moves = body.indexOf('<LandsecMoved');
    assert.ok(body.includes('landsecRestrictedRole('), name);
    assert.ok(keeps > 0 && moves > keeps, `${name}: the restricted roles' page must be returned before the redirect`);
  }
});

test('the old Deals and scheme addresses redirect only in the Landsec view', () => {
  // BGP staff on All Teams or their own team follow /landsec/scheme/<key>
  // from the staff Brand CRM. Their property page has no Units and lettings
  // section and their Deals page no clock, so they keep the old pages.
  assert.match(fn(APP, 'LandsecDealsRoute'), /if \(brand\.id !== "landsec" \|\| landsecRestrictedRole\(/);
  const scheme = fn(APP, 'LandsecSchemeRoute');
  assert.match(scheme, /const restricted = brand\.id !== "landsec" \|\| landsecRestrictedRole\(/);
  assert.match(scheme, /if \(restricted\) return <LandsecScheme \/>;/);
  // The property page section and the unit page breadcrumb use the same test.
  assert.match(source('client/src/components/property-detail.tsx'), /const landsecView = useIsLandsecView\(\);/);
  assert.match(source('client/src/pages/landsec-unit.tsx'), /viewer\.role === "joint_agent" \|\| !landsecView \?/);
});

test('Properties, Deals, the property page and the landing page ask one question for the Landsec view', () => {
  const properties = source('client/src/pages/properties.tsx');
  assert.match(properties, /const isLandsecView = useIsLandsecView\(\);/);
  assert.doesNotMatch(properties, /activeTeam === "Landsec"/);
});

test('on a phone only a real Landsec login is sent from the home page to Properties', () => {
  const app = source(APP);
  const rule = app.slice(app.indexOf('const landsecPhoneHome ='), app.indexOf('useEffect', app.indexOf('const landsecPhoneHome =')));
  assert.match(rule, /role === "Client"/);
  assert.match(rule, /shellBrand\.id === "landsec"/);
  assert.match(rule, /!landsecRestricted/);
});

test('the chat rail is still hidden for an asset manager and a joint agent', () => {
  assert.match(source(APP), /\{!landsecRestricted && <div className="flex" onMouseLeave=/);
});

test('Deals hides its own tab row in the Landsec view only', () => {
  const hub = source('client/src/pages/deals-hub.tsx');
  assert.match(hub, /const menuHasTabs = isClient && brand\.id === "landsec";/);
  assert.match(hub, /tabs\.length <= 1 \|\| menuHasTabs \? "hidden" : ""/);
});

test('Brand cases is one link on Brands, never for a joint agent', () => {
  const hub = source('client/src/pages/brands-hub.tsx');
  // The Landsec view, never a joint agent, and only once there is a case to
  // open (2026-11-13: with none the button led to an empty page).
  assert.match(hub, /const mayHaveBrandCases = !!hubUser && hubBrand\.id === "landsec" && hubUser\.landsecRole !== "joint_agent";/);
  assert.match(hub, /queryKey: \["\/api\/landsec\/brand-cases"\], staleTime: 60 \* 1000, enabled: mayHaveBrandCases \}\);/);
  assert.match(hub, /const showBrandCases = mayHaveBrandCases && \(hubBrandCases\?\.cases\?\.length \|\| 0\) > 0;/);
  assert.match(hub, /\{showBrandCases && <Link href="\/landsec\/brand-cases">/);
});
