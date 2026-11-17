// The BGP staff side bar and phone menu after Woody's tidy of 16 November
// 2026: one Brands entry as on the Landsec menu (the Brand CRM is a pill
// inside it), My BGP in place of My Card and Business card (both folded into
// each person's own HR page), Website in Admin, no Lease Advisory or
// Investment for the leasing teams and Tenant Rep, and investment
// requirements only under Investment. The lists are cut from the source and
// run, so a change to a label or an address shows here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { leasingSideOnly, LEASING_SIDE_HIDDEN_URLS, TEAM_ROSTER_2026, NO_TEAM_ROSTER_2026 } from '../../shared/teams.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');

const SIDEBAR = 'client/src/components/app-sidebar.tsx';
const statement = (file, start) => find(file, node => ts.isVariableStatement(node) && node.getText().startsWith(start));
const plain = value => JSON.parse(JSON.stringify(value));
const listSource = [
  statement(SIDEBAR, 'const coreNavBase ='),
  statement(SIDEBAR, 'const adminNavBase ='),
  statement(SIDEBAR, 'export const mobileOverlayItems ='),
];
// Each icon is bound to its own name.
const ICONS = Object.fromEntries([...listSource.join('\n').matchAll(/icon: (\w+)/g)].map(m => [m[1], m[1]]));
const lists = evaluate([...listSource,
  'exports.core = coreNavBase; exports.admin = adminNavBase; exports.phone = mobileOverlayItems;',
].join('\n'), ICONS);
const core = plain(lists.core), admin = plain(lists.admin), phone = plain(lists.phone);
const titles = items => items.map(i => i.title);

test('one Brands entry on the side bar and the phone menu, as on the Landsec menu', () => {
  for (const items of [core, phone]) {
    assert.deepEqual(items.filter(i => i.url.startsWith('/brands')).map(i => [i.title, i.url]), [['Brands', '/brands']]);
    assert.ok(!titles(items).includes('Brand CRM') && !titles(items).includes('Brand Intelligence'));
  }
  assert.match(source('client/src/pages/brands-hub.tsx'), /tracking-tight">Brands<\/h1>/);
});

test('My BGP is People & HR renamed, with My Card and Business card folded in', () => {
  // Woody, 2026-11-17: "remove the my BGP link from the side bar and rename People and HR to my BGP".
  for (const items of [core, phone]) {
    assert.deepEqual(items.filter(i => i.title === 'My BGP').map(i => i.url), ['/hr']);
    assert.ok(!titles(items).includes('People & HR'));
    assert.ok(!items.some(i => i.url === '/my-bgp'), 'no second My BGP entry');
    for (const gone of ['My Card', 'Business card']) assert.ok(!titles(items).includes(gone), gone);
    assert.ok(!items.some(i => i.url === '/my-expenses' || i.url === '/business-card'));
  }
  const app = source('client/src/App.tsx');
  assert.match(app, /<Route path="\/my-bgp" component=\{MyBgpPage\} \/>/);
  // The old addresses still open: expense notifications and the phone's Business card tile link to them.
  assert.match(app, /<Route path="\/my-expenses" component=\{MyExpenses\} \/>/);
  assert.match(app, /<Route path="\/business-card" component=\{BusinessCardPage\} \/>/);
  // A client login is never let in.
  const allowed = find('client/src/App.tsx', node => ts.isVariableStatement(node) && node.getText().startsWith('const CLIENT_ALLOWED_ROUTES ='));
  assert.ok(!allowed.includes('"/my-bgp"'));
  // The phone folds it in too (Woody, 2026-11-16: "Fold into my BGP"): no Business card tile.
  const home = source('client/src/components/mobile-home.tsx');
  assert.match(home, /const CORE_BOARD_URLS = new Set\(\["\/comps", "\/brands", "\/property-intelligence", "\/sharepoint", "\/hr"\]\);/);
  assert.ok(!home.includes('BUSINESS_CARD_BOARD'));
  assert.match(source('client/src/pages/mobile-profile.tsx'), /navigate\("\/my-bgp\?tab=business-card"\)/);
  const hr = source('client/src/pages/hr.tsx');
  assert.match(hr, /export function MyBgpPage\(\)/);
  // The page is titled My BGP, and your own profile carries the heading from it too.
  assert.match(hr, /data-testid="text-hr-title">\s*My BGP\s*<\/h1>/);
  assert.match(hr, /\{\(myBgp \|\| isOwn\) && \(/);
  // KYC4U is a pill there for admins, and off the menus (Woody, 2026-11-17).
  assert.match(hr, /\.\.\.\(isAdmin \? \[\{ value: "kyc4u", label: "KYC4U" \}\] : \[\]\)/);
  assert.match(hr, /<Kyc4uPanel \/>/);
  for (const items of [core, phone]) assert.ok(!items.some(i => i.url === '/kyc-clouseau'), 'KYC4U off the menu');
  const unfinished = find(SIDEBAR, node => ts.isVariableStatement(node) && node.getText().startsWith('const unfinishedNav ='));
  assert.ok(!unfinished.includes('url: "/kyc-clouseau"'));
  assert.match(source('client/src/App.tsx'), /<Route path="\/kyc-clouseau" component=\{KycHub\} \/>/);
  assert.match(hr, /\{isOwn && <TabsTrigger value="business-card"/);
  assert.match(hr, /\{isOwn \? "Card & expenses" : "Expenses"\}/);
  assert.match(hr, /<MyCardAndExpenses embedded \/>/);
  assert.match(hr, /<BusinessCardPanel embedded \/>/);
});

test('Website is in Admin: off Core, admin only on the phone', () => {
  assert.ok(!core.some(i => i.url === '/website'));
  assert.deepEqual(admin.filter(i => i.url === '/website').map(i => i.title), ['Website']);
  assert.deepEqual(phone.filter(i => i.url === '/website').map(i => i.adminOnly), [true]);
});

test('the leasing teams and Tenant Rep have no Lease Advisory or Investment; everyone else keeps both', () => {
  assert.deepEqual(LEASING_SIDE_HIDDEN_URLS, ['/pla/matters', '/investment']);
  for (const url of LEASING_SIDE_HIDDEN_URLS) assert.ok(core.some(i => i.url === url) && phone.some(i => i.url === url), url);
  assert.equal(leasingSideOnly(['Shopping Centre']), true);
  assert.equal(leasingSideOnly(['London Estate', 'City']), true);
  assert.equal(leasingSideOnly(['Tenant Rep', 'Shopping Centre', 'London Estate']), true);
  assert.equal(leasingSideOnly(['Lease Advisory', 'City']), false, 'Pete runs Lease Advisory');
  assert.equal(leasingSideOnly(['Investment']), false);
  assert.equal(leasingSideOnly([]), false, 'no team: the board, support and consultants');
  assert.equal(leasingSideOnly([null, undefined]), false);
  // A client view on the login (staff who may view as Landsec) is not a team.
  assert.equal(leasingSideOnly(['Shopping Centre', 'Landsec']), true);
  assert.equal(leasingSideOnly(['Lease Advisory', 'Landsec']), false);
  assert.equal(leasingSideOnly(['Landsec']), false);
  assert.equal(leasingSideOnly(['National']), false, 'a retired team name hides nothing');
  for (const person of TEAM_ROSTER_2026) {
    const keeps = person.teams.includes('Investment') || person.teams.includes('Lease Advisory');
    assert.equal(leasingSideOnly(person.teams), !keeps, person.name);
  }
  assert.ok(NO_TEAM_ROSTER_2026.length > 0);
  const sidebar = source(SIDEBAR);
  assert.match(sidebar, /leasingOnly \? coreNavStaff\.filter\(i => !LEASING_SIDE_HIDDEN_URLS\.includes\(i\.url\)\)/);
  // Also while the team switcher is on a leasing team (Woody, 2026-11-17), and a
  // leasing-side login's switcher offers neither team.
  assert.match(sidebar, /const leasingOnly = !isClientUser && \(leasingSideLogin \|\| leasingSideOnly\(\[activeTeam\]\)\);/);
  assert.match(sidebar, /TEAMS\.filter\(\(team\) => !\(leasingSideLogin && \(team === "Investment" \|\| team === "Lease Advisory"\)\)\)/);
  for (const team of ['Shopping Centre', 'London Estate', 'High Street', 'City', 'Tenant Rep']) assert.equal(leasingSideOnly([team]), true, team);
  for (const team of ['all', 'Investment', 'Lease Advisory', 'Landsec', null]) assert.equal(leasingSideOnly([team]), false, String(team));
  // Viewing as a team that is not your own: no admin groups, and a line saying where they are.
  assert.match(sidebar, /const viewingAsTeam = !isClientUser && isBgpTeam\(activeTeam\) && activeTeam !== user\?\.team/);
  assert.match(sidebar, /\{user\?\.isAdmin && !viewingAsTeam && \(/);
  assert.match(sidebar, /data-testid="nav-viewing-as-team"/);
  assert.match(sidebar, /overlayLeasingOnly && LEASING_SIDE_HIDDEN_URLS\.includes\(i\.url\)/);
  assert.match(source('client/src/pages/deals-hub.tsx'), /if \(leasingOnly \|\| \(activeTeam && activeTeam !== "all"\)\) return allTabs\.filter\(t => t\.key !== "investment"\);/);
});

test('Requirements is leasing only; investment links go to Investment with what they carried', () => {
  const page = source('client/src/pages/requirements.tsx');
  assert.ok(!page.includes('button-investment-view'), 'no Investment switch on Requirements');
  const { investmentRequirementsHref } = evaluate(find('client/src/pages/requirements.tsx',
    node => ts.isFunctionDeclaration(node) && node.name?.text === 'investmentRequirementsHref'), { URLSearchParams });
  const go = query => investmentRequirementsHref(new URLSearchParams(query));
  assert.equal(go('type=investment'), '/investment/requirements');
  assert.equal(go('type=investment&requirementId=r%201&team=Investment&new=1'), '/investment/requirements?requirementId=r+1&team=Investment&new=1');
  assert.equal(go('type=investment&companyId=c1&list=live'), '/investment/requirements');
  const hub = source('client/src/pages/investment-hub.tsx');
  assert.match(hub, /<InvestmentRequirements teamFilter=\{teamFilter\} autoCreate=\{autoCreate\} requirementId=\{requirementId\} \/>/);
});
