// The Landsec menu (docs/landsec-menu-plan-2026-11-12.md, parts 1, 2 and 6):
// what each login's side bar and phone tabs hold, and who is sent on from the
// old addresses. The lists are cut from the source and run, so a change to a
// label or an address shows here. The lit-entry rule itself is tested in
// server/landsec-menu.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { LANDSEC_MENU, LANDSEC_RESTRICTED_MENU, LANDSEC_STAFF_TASKS, landsecMenuActive, landsecRestrictedRole, landsecTasksPath } from '../../shared/landsec-menu.ts';
import { RESTRICTED_LANDSEC_ROLES } from '../../shared/landsec.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');

const SIDEBAR = 'client/src/components/app-sidebar.tsx', TABS = 'client/src/components/mobile-bottom-nav.tsx', APP = 'client/src/App.tsx';
const statement = (file, start) => find(file, node => ts.isVariableStatement(node) && node.getText().startsWith(start));
const fn = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
// Values made inside the evaluated source belong to another realm.
const plain = value => JSON.parse(JSON.stringify(value));
const ICONS = Object.fromEntries(['LayoutDashboard', 'Building2', 'BarChart3', 'Store', 'Handshake', 'Layers', 'Eye', 'ListTodo', 'Target', 'MessageCircle', 'CheckSquare'].map(name => [name, name]));
const BINDINGS = { ...ICONS, LANDSEC_MENU, LANDSEC_RESTRICTED_MENU, LANDSEC_STAFF_TASKS, landsecTasksPath };

const sidebar = evaluate([
  statement(SIDEBAR, 'export const LANDSEC_NAV ='),
  statement(SIDEBAR, 'const LANDSEC_RESTRICTED_NAV ='),
  statement(SIDEBAR, 'export const LANDSEC_JOINT_AGENT_NAV ='),
  statement(SIDEBAR, 'const LANDSEC_TASKS_NAV ='),
  statement(SIDEBAR, 'const JOINT_AGENT_BRAND_CRM ='),
  fn(SIDEBAR, 'landsecNavFor'),
  fn(SIDEBAR, 'withOpenTaskCount'),
].join('\n'), BINDINGS);
const menu = (role, staffView = false) => plain(sidebar.landsecNavFor(role, staffView)).map(i => [i.title, i.url]);

const tabs = evaluate([
  statement(TABS, 'const LANDSEC_NAV_ITEMS ='),
  statement(TABS, 'const LANDSEC_STAFF_NAV_ITEMS ='),
  statement(TABS, 'const LANDSEC_JOINT_AGENT_NAV_ITEMS ='),
  'exports.full = LANDSEC_NAV_ITEMS; exports.staff = LANDSEC_STAFF_NAV_ITEMS; exports.jointAgent = LANDSEC_JOINT_AGENT_NAV_ITEMS;',
].join('\n'), BINDINGS);
const phone = which => plain(tabs[which]).map(i => [i.label, i.path]);

const FULL_MENU = [['Properties', '/deals/properties'], ['Deals', '/deals'], ['Letting Tracker', '/deals/letting'], ['Tasks', '/landsec/tasks'], ['Brands', '/brands']];
const GONE = ['Portfolio', 'Scheme', 'Lettings', 'Ask'];

test('a full Landsec login, a leasing manager and an asset manager have Properties, Deals, Letting Tracker, Tasks, Brands', () => {
  for (const role of [null, undefined, '', 'leasing_manager', 'asset_manager']) assert.deepEqual(menu(role), FULL_MENU, String(role));
});

// Woody, 2026-11-13: "asset managers and leasing landsec should be the same".
test('an asset manager has the full Landsec menu and phone tabs: the role names no menu of its own', () => {
  assert.deepEqual(menu('asset_manager'), menu(null));
  assert.doesNotMatch(source(SIDEBAR), /"asset_manager"/);
  const tabsSource = source(TABS);
  assert.doesNotMatch(tabsSource, /asset_manager|ASSET_MANAGER/);
  // A Client login that is not a joint agent gets the six tabs, Tasks and Chat included.
  assert.match(tabsSource, /landsecRole === "joint_agent"[\s\S]*?: navUser\?\.role === "Client"\s*\? LANDSEC_NAV_ITEMS/);
  // The chat unread feed is asked for by everyone but a joint agent.
  assert.match(tabsSource, /enabled: !!navUser && landsecRole !== "joint_agent",/);
});

// Woody, 2026-11-13: "we need each person to have this update their own task
// list ... and add to the side bar".
test('every Landsec role has one Tasks entry, at /landsec/tasks; BGP staff viewing as Landsec keep My Tasks', () => {
  for (const role of [null, 'leasing_manager', 'asset_manager', 'joint_agent']) {
    assert.deepEqual(menu(role).filter(([title]) => title === 'Tasks'), [['Tasks', '/landsec/tasks']], String(role));
  }
  assert.deepEqual(menu(null, true), FULL_MENU.map(([title, url]) => [title, title === 'Tasks' ? '/tasks' : url]));
  // An asset manager's phone tabs are the full login's (no list of its own).
  for (const which of ['full', 'jointAgent']) {
    assert.deepEqual(phone(which).filter(([label]) => label === 'Tasks'), [['Tasks', '/landsec/tasks']], which);
  }
  assert.deepEqual(phone('staff').filter(([label]) => label === 'Tasks'), [['Tasks', '/tasks']]);
});

test('the Tasks entry carries the number of open tasks, and nothing at nought', () => {
  const counted = (n, role = null) => plain(sidebar.withOpenTaskCount(sidebar.landsecNavFor(role), n)).filter(i => i.badge).map(i => [i.title, i.badge]);
  assert.deepEqual(counted(3), [['Tasks', '3']]);
  assert.deepEqual(counted(12, 'asset_manager'), [['Tasks', '12']]);
  assert.deepEqual(counted(1, 'joint_agent'), [['Tasks', '1']]);
  assert.deepEqual(counted(0), []);
  // The side bar and the phone tabs read the login's own task feed for it.
  assert.match(source(SIDEBAR), /withOpenTaskCount\(landsecNavFor\(\(user as any\)\?\.landsecRole, !isRealClientLogin\), openTaskCount\(landsecTaskRows\)\)/);
  assert.match(source(TABS), /const openTasks = isLandsecNav \? openTaskCount\(landsecTaskRows\) : 0;/);
});

// Until 13 November 2026 the route guard kept an asset manager off the
// tracker and viewings pages. It is a full Landsec login now: the guard
// names only the joint agent, and an asset manager opens what the ordinary
// client route list opens, its task list (/landsec/tasks) included.
test('an asset manager takes the ordinary client routes: the route guard does not name the role', () => {
  const guard = fn(APP, 'ClientRouteGuard');
  assert.doesNotMatch(guard, /asset_manager/);
  assert.match(guard, /const routes = restricted \|\| CLIENT_ALLOWED_ROUTES;/);
  const routes = plain(evaluate(`${statement(APP, 'const CLIENT_ALLOWED_ROUTES')}\nexports.routes = CLIENT_ALLOWED_ROUTES;`).routes);
  const allowed = url => routes.some(p => p === '/' ? url === '/' : (url === p || url.startsWith(p + '/')));
  for (const [title, url] of menu('asset_manager')) assert.ok(allowed(url), `${title} ${url}`);
  for (const url of ['/landsec/tasks', '/messages', '/chatbgp', '/companies/x']) assert.ok(allowed(url), url);
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
  for (const which of ['full', 'staff', 'jointAgent']) {
    for (const [label] of phone(which)) assert.ok(!GONE.includes(label), `${which}: ${label}`);
  }
});

test('a joint agent has no Brands entry on either menu', () => {
  assert.ok(!menu('joint_agent').some(([, url]) => url.startsWith('/brands')));
  assert.ok(!phone('jointAgent').some(([, path]) => path.startsWith('/brands')));
});

test('phone tabs: Properties, Deals, Tracker, Tasks, Brands, Chat for a Landsec login', () => {
  assert.deepEqual(phone('full'), [['Properties', '/deals/properties'], ['Deals', '/deals'], ['Tracker', '/deals/letting'], ['Tasks', '/landsec/tasks'], ['Brands', '/brands'], ['Chat', '/messages']]);
});

test('phone tabs: staff viewing as Landsec keep Home, the way out of the Landsec view, in place of Brands', () => {
  assert.deepEqual(phone('staff'), [['Home', '/'], ['Properties', '/deals/properties'], ['Deals', '/deals'], ['Tracker', '/deals/letting'], ['Tasks', '/tasks'], ['Chat', '/messages']]);
});

test('phone tabs: a joint agent has no Chat tab', () => {
  assert.deepEqual(phone('jointAgent'), [['Properties', '/'], ['Deals', '/landsec/deals'], ['Tracker', '/landsec/tracker'], ['Viewings', '/landsec/viewings'], ['Tasks', '/landsec/tasks']]);
  // The joint agent's sixth tab, CRM, is added where the tabs are chosen.
  assert.match(source(TABS), /\[\.\.\.LANDSEC_JOINT_AGENT_NAV_ITEMS, \{ label: "CRM", icon: Target, path: "\/landsec\/brand-crm" \}\]/);
});

test('each entry is the only one lit on its own address', () => {
  for (const list of [menu(null), menu(null, true), phone('full'), phone('staff')]) {
    for (const [name, url] of list) {
      const lit = list.filter(([, other]) => landsecMenuActive(other, url)).map(([n]) => n);
      assert.deepEqual(lit, [name], url);
    }
  }
});

test('a joint agent is never sent to an address its route list refuses', () => {
  const routes = plain(evaluate(`${statement(APP, 'const LANDSEC_RESTRICTED_ROUTES')}\nexports.routes = LANDSEC_RESTRICTED_ROUTES;`).routes);
  // The joint agent is the only login with a route jail of its own: an asset
  // manager takes the ordinary client routes, as a full Landsec login does.
  assert.deepEqual(Object.keys(routes), ['joint_agent']);
  assert.deepEqual(routes.joint_agent, ['/', '/home', '/landsec', '/settings/profile']);
  assert.doesNotMatch(source(APP), /"asset_manager"/);
  for (const role of ['joint_agent']) {
    const allowed = url => routes[role].some(p => p === '/' ? url === '/' : (url === p || url.startsWith(p + '/')));
    for (const [title, url] of menu(role)) assert.ok(allowed(url), `${role}: ${title} ${url}`);
    // The reason they are left out of the redirects: these would bounce.
    for (const url of [LANDSEC_MENU.properties, LANDSEC_MENU.deals, LANDSEC_MENU.tracker]) assert.ok(!allowed(url), `${role}: ${url}`);
  }
  // Each redirect asks the role first and gives a joint agent its own page.
  for (const [name, page] of [['Home', 'LandsecHome'], ['LandsecDealsRoute', 'LandsecDeals'], ['LandsecSchemeRoute', 'LandsecScheme']]) {
    const body = fn(APP, name);
    const keeps = body.indexOf(`return <${page} />`), moves = body.indexOf('<LandsecMoved');
    assert.ok(body.includes('landsecRestrictedRole('), name);
    assert.ok(keeps > 0 && moves > keeps, `${name}: the joint agent's page must be returned before the redirect`);
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

test('the chat rail is hidden for a joint agent only', () => {
  const app = source(APP);
  assert.match(app, /\{!landsecRestricted && <div className="flex" onMouseLeave=/);
  // landsecRestricted is the shared list, and the list is the joint agent alone.
  assert.match(app, /const landsecRestricted = \(RESTRICTED_LANDSEC_ROLES as string\[\]\)\.includes\(/);
  assert.deepEqual(RESTRICTED_LANDSEC_ROLES, ['joint_agent']);
  assert.equal(landsecRestrictedRole('asset_manager'), false);
  assert.equal(landsecRestrictedRole('joint_agent'), true);
});

test('the unit page and the brand page do not key anything on the asset manager role', () => {
  for (const file of ['client/src/pages/landsec-unit.tsx', 'client/src/pages/landsec-home.tsx', 'client/src/pages/landsec-tasks.tsx', 'client/src/pages/landsec-viewings.tsx', 'client/src/components/brand-profile-panel.tsx', 'client/src/components/mobile-brand-view.tsx']) {
    assert.doesNotMatch(source(file), /=== "asset_manager"|!== "asset_manager"/, file);
  }
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
