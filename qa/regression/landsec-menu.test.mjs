// The Landsec menu (docs/landsec-menu-plan-2026-11-12.md, parts 1, 2 and 6):
// what each login's side bar and phone tabs hold, and who is sent on from the
// old addresses. The lists are cut from the source and run, so a change to a
// label or an address shows here. The lit-entry rule itself is tested in
// server/landsec-menu.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { LANDSEC_MENU, JOINT_AGENT_MENU, LANDSEC_STAFF_TASKS, jointAgentRealPage, landsecMenuActive, landsecRestrictedRole, landsecTasksPath } from '../../shared/landsec-menu.ts';
import { RESTRICTED_LANDSEC_ROLES } from '../../shared/landsec.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');

const SIDEBAR = 'client/src/components/app-sidebar.tsx', TABS = 'client/src/components/mobile-bottom-nav.tsx', APP = 'client/src/App.tsx';
const statement = (file, start) => find(file, node => ts.isVariableStatement(node) && node.getText().startsWith(start));
const fn = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
// Values made inside the evaluated source belong to another realm.
const plain = value => JSON.parse(JSON.stringify(value));
const ICONS = Object.fromEntries(['Users', 'Calendar', 'CalendarDays', 'LayoutDashboard', 'Building2', 'BarChart3', 'Store', 'Handshake', 'Layers', 'Eye', 'ListTodo', 'Target', 'MessageCircle', 'CheckSquare'].map(name => [name, name]));
const BINDINGS = { ...ICONS, LANDSEC_MENU, JOINT_AGENT_MENU, LANDSEC_STAFF_TASKS, landsecTasksPath };

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

const FULL_MENU = [['Properties', '/deals/properties'], ['Deals', '/deals'], ['Letting Tracker', '/deals/letting'], ['Calendar', '/landsec/calendar'], ['Tasks', '/landsec/tasks'], ['Brands', '/brands'], ['CRM', '/contacts']];
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
  // The chat unread feed is asked for by every login (a joint agent's count
  // shows on its own Chat tab).
  assert.match(tabsSource, /queryKey: \["\/api\/chat\/notifications"\],[\s\S]{0,120}?enabled: !!navUser,/);
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
  assert.match(guard, /let ok = CLIENT_ALLOWED_ROUTES\.some\(at\);/);
  const routes = plain(evaluate(`${statement(APP, 'const CLIENT_ALLOWED_ROUTES')}\nexports.routes = CLIENT_ALLOWED_ROUTES;`).routes);
  const allowed = url => routes.some(p => p === '/' ? url === '/' : (url === p || url.startsWith(p + '/')));
  for (const [title, url] of menu('asset_manager')) assert.ok(allowed(url), `${title} ${url}`);
  for (const url of ['/landsec/tasks', '/messages', '/chatbgp', '/companies/x']) assert.ok(allowed(url), url);
});

// Woody, 2026-11-14: "joint agent can do anything other than see brands".
// Woody, 2026-11-14: "The only difference is the lack of access to the brands page": a Landsec login's menu
// less Brands, with its own tracker (BGP's notes on target brands left out) and its Brand CRM.
test('a joint agent has the real Properties and Deals, its own Letting Tracker, the Calendar, Tasks and Brand CRM', () => {
  assert.deepEqual(menu('joint_agent'), [
    ['Properties', '/deals/properties'], ['Deals', '/deals'],
    ['Letting Tracker', '/landsec/tracker'], ['Calendar', '/landsec/calendar'], ['Tasks', '/landsec/tasks'],
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

test('phone tabs: Properties, Deals, Tracker, Calendar, Tasks, Brands, Chat for a Landsec login', () => {
  assert.deepEqual(phone('full'), [['Properties', '/deals/properties'], ['Deals', '/deals'], ['Tracker', '/deals/letting'], ['Calendar', '/landsec/calendar'], ['Tasks', '/landsec/tasks'], ['Brands', '/brands'], ['Chat', '/messages']]);
});

test('phone tabs: staff viewing as Landsec keep Home, the way out of the Landsec view, in place of Brands', () => {
  assert.deepEqual(phone('staff'), [['Home', '/'], ['Properties', '/deals/properties'], ['Deals', '/deals'], ['Tracker', '/deals/letting'], ['Calendar', '/landsec/calendar'], ['Tasks', '/tasks'], ['Chat', '/messages']]);
});

// Woody, 2026-11-13, asked whether to build chat for joint agents: "yes go ahead".
test('phone tabs: a joint agent has its own Chat tab, never Messages', () => {
  assert.deepEqual(phone('jointAgent'), [['Properties', '/deals/properties'], ['Deals', '/deals'], ['Tracker', '/landsec/tracker'], ['Calendar', '/landsec/calendar'], ['Tasks', '/landsec/tasks']]);
  // CRM and Chat are added where the tabs are chosen. Chat is the joint
  // agent's own page, not /messages (the staff and client chat).
  const tabsSource = source(TABS);
  assert.match(tabsSource, /\[\.\.\.LANDSEC_JOINT_AGENT_NAV_ITEMS, \{ label: "CRM", icon: Target, path: "\/landsec\/brand-crm" \}, \{ label: "Chat", icon: MessageCircle, path: JOINT_AGENT_CHAT_PATH \}\]/);
  assert.match(tabsSource, /const JOINT_AGENT_CHAT_PATH = "\/landsec\/chat";/);
  assert.match(tabsSource, /BOTTOM_NAV_PATHS = \[[^\]]*"\/landsec\/chat"\]/);
});

test('each entry is the only one lit on its own address', () => {
  for (const list of [menu(null), menu(null, true), phone('full'), phone('staff')]) {
    for (const [name, url] of list) {
      const lit = list.filter(([, other]) => landsecMenuActive(other, url)).map(([n]) => n);
      assert.deepEqual(lit, [name], url);
    }
  }
});

// Since 14 November 2026 a joint agent takes the ordinary client routes, less brand pages, company
// records, contacts and brand cases (the server refuses their data too: jointAgentApiDenied).
test('a joint agent opens every page on its menus and is sent away from brand pages', () => {
  const guard = fn(APP, 'ClientRouteGuard');
  const routes = plain(evaluate(`${statement(APP, 'const CLIENT_ALLOWED_ROUTES')}\nexports.routes = CLIENT_ALLOWED_ROUTES;`).routes);
  const blocked = plain(evaluate(`${statement(APP, 'const JOINT_AGENT_BLOCKED_ROUTES')}\nexports.b = JOINT_AGENT_BLOCKED_ROUTES;`).b);
  assert.doesNotMatch(source(APP), /"asset_manager"/);
  // The staff Letting Tracker sends it to its own.
  assert.match(guard, /if \(location === "\/deals\/letting" \|\| location === "\/available"\) \{ navigate\(JOINT_AGENT_MENU\.tracker\); return; \}/);
  const at = url => p => p === '/' ? url === '/' : (url === p || url.startsWith(p + '/'));
  const allowed = url => routes.some(at(url)) && !blocked.some(at(url));
  for (const [title, url] of menu('joint_agent')) assert.ok(allowed(url), `${title} ${url}`);
  for (const [label, url] of phone('jointAgent')) assert.ok(allowed(url), `${label} ${url}`);
  for (const url of [LANDSEC_MENU.brands, '/brands/x', '/companies/x', '/contacts', '/landsec/brand-case/c1']) assert.ok(!allowed(url), url);
  for (const name of ['Home', 'LandsecDealsRoute', 'LandsecSchemeRoute']) assert.doesNotMatch(fn(APP, name), /landsecRestrictedRole\(/, name);
  assert.doesNotMatch(fn(APP, 'Home'), /LandsecHome/);
});

test('the old Deals and scheme addresses redirect only in the Landsec view', () => {
  // BGP staff on All Teams or their own team follow /landsec/scheme/<key>
  // from the staff Brand CRM. Their property page has no Units and lettings
  // section and their Deals page no clock, so they keep the old pages.
  assert.match(fn(APP, 'LandsecDealsRoute'), /if \(brand\.id !== "landsec"\) return <LandsecDeals \/>;/);
  const scheme = fn(APP, 'LandsecSchemeRoute');
  assert.match(scheme, /const restricted = brand\.id !== "landsec";/);
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

test('on a phone only a real Landsec login is sent from the home page to ChatBGP', () => {
  const app = source(APP);
  // Woody, 15 November 2026: the Landsec view opens on ChatBGP, phone and computer.
  assert.match(app, /if \(landsecPhoneHome\) navigate\(LANDSEC_MENU\.chat, \{ replace: true \}\);/);
  assert.match(app, /return <LandsecMoved to=\{LANDSEC_MENU\.chat\} \/>;\n\}\n\nfunction LandsecMoved/);
  const rule = app.slice(app.indexOf('const landsecPhoneHome ='), app.indexOf('useEffect', app.indexOf('const landsecPhoneHome =')));
  assert.match(rule, /role === "Client"/);
  assert.match(rule, /shellBrand\.id === "landsec"/);
  assert.match(rule, /!landsecRestricted/);
});

test('a joint agent has its own chat on the rail, never the staff chat panel', () => {
  const app = source(APP);
  // The staff and client panel (ChatPanel) is mounted for everyone else.
  assert.match(app, /\{!landsecRestricted && <div className="flex" onMouseLeave=/);
  assert.equal(app.split('<ChatPanel ').length, 2);
  // The joint agent's rail holds only its own chat component.
  assert.match(app, /\{landsecRestricted && location !== "\/landsec\/chat" && <div className="flex">[\s\S]{0,400}?<JointAgentChat variant="rail"/);
  // The staff chat pages are never mounted for it: both old addresses go to
  // its own page, with the thread a notification named, and its route list
  // holds that page (under /landsec).
  assert.match(app, /const landsecNoChatPage = landsecRestricted && \(location === "\/chatbgp" \|\| location === "\/messages"\);/);
  assert.match(app, /if \(landsecNoChatPage\) navigate\(`\/landsec\/chat\$\{window\.location\.search \|\| ""\}`, \{ replace: true \}\);/);
  assert.match(app, /if \(landsecNoChatPage\) return null;/);
  assert.match(app, /<Route path="\/landsec\/chat" component=\{LandsecChat\} \/>/);
  // The route guard leaves those two addresses to that redirect.
  assert.match(fn(APP, 'ClientRouteGuard'), /if \(location === "\/chatbgp" \|\| location === "\/messages"\) ok = true;/);
  // In the shell landsecRestricted is the joint agent alone (its own chat, no global search);
  // no role is restricted to its own pages any more (Woody, 2026-11-14).
  assert.match(app, /const landsecRestricted = String\(\(currentUser as any\)\?\.landsecRole \|\| ""\) === "joint_agent";/);
  assert.deepEqual(RESTRICTED_LANDSEC_ROLES, []);
  assert.equal(landsecRestrictedRole('asset_manager'), false);
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

// Woody, 2026-11-14: "delete brand case from everything".
test('no screen offers a brand case', () => {
  for (const file of ['client/src/pages/brands-hub.tsx', 'client/src/components/brand-profile-panel.tsx', 'client/src/components/brand-crm/scheme-plan-card.tsx']) {
    assert.doesNotMatch(source(file), /\/landsec\/brand-case/, file);
  }
  assert.match(source(APP), /<Route path="\/landsec\/brand-cases">\{\(\) => <Redirect to="\/brands" \/>\}<\/Route>/);
});

// A joint agent's chat screen calls only what the gateway opens to it and
// links to none of BGP's pages.
test("the joint agent's chat screen calls only its own addresses", () => {
  const chat = source('client/src/components/landsec/joint-agent-chat.tsx');
  const called = [...chat.matchAll(/["`](\/api\/[a-z-]+(?:\/[a-z-]+)*)/g)].map(m => m[1]);
  const allowed = ['/api/auth/me', '/api/chat/threads', '/api/landsec/chat/people', '/api/chat/tag-search', '/api/chat/upload', '/api/chat-media', '/api/chatbgp/chat', '/api/chatbgp/threads', '/api/chat/notifications'];
  for (const path of called) assert.ok(allowed.includes(path), path);
  for (const closed of ['/api/users', '/api/crm', '/api/search', '/api/brand', '/members', 'auto-title', 'group-pic', 'chat-with-files', '/api/chat/search']) assert.ok(!chat.includes(closed), closed);
  // Never the staff tag links, the staff markdown or the staff panel.
  assert.doesNotMatch(chat, /chat-tags|chatbgp-markdown|chat-panel|tagPath/);
  for (const page of ['/companies', '/contacts', '/properties', '/deals/', '/available', '/brands']) assert.ok(!chat.includes(`"${page}`) && !chat.includes(`\`${page}`), page);
  // A unit opens its own tracker and a deal its own Deals page.
  assert.match(chat, /`\/landsec\/tracker\?unit=\$\{encodeURIComponent\(m\[3\]\)\}`/);
  assert.match(chat, /"\/landsec\/deals"/);
  // ChatBGP says in one line what it can answer.
  assert.match(chat, /ChatBGP answers from your schemes: units, viewings, offers, heads of terms, checklists and tasks\./);
});
