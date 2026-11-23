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
import { leasingSideOnly, LEASING_SIDE_HIDDEN_URLS, investmentSideOnly, INVESTMENT_SIDE_HIDDEN_URLS, TEAM_ROSTER_2026, NO_TEAM_ROSTER_2026 } from '../../shared/teams.ts';
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
  // KYC4U was a pill there for admins (Woody, 2026-11-17) and moved to
  // Subscriptions & APIs (Woody, 2026-11-21: "Move KYC4U into subscriptions
  // and APIS"); an old link to the pill goes there. It stays off the menus.
  assert.ok(!/value: "kyc4u"/.test(hr) && !/<Kyc4uPanel \/>/.test(hr), 'KYC4U is no longer a My BGP pill');
  assert.match(hr, /if \(sectionParam === "kyc4u"\) navigate\("\/subscriptions\?section=kyc4u", \{ replace: true \}\)/);
  const subs = source('client/src/pages/subscriptions.tsx');
  assert.match(subs, /<Kyc4uPanel \/>/);
  assert.match(subs, /new URLSearchParams\(window\.location\.search\)\.get\("section"\) === "kyc4u"/);
  assert.match(source('client/src/pages/kyc-hub.tsx'), /params\.set\("section", "kyc4u"\);\s*navigate\(`\/subscriptions\?\$\{params\.toString\(\)\}`, \{ replace: true \}\)/);
  for (const items of [core, phone]) assert.ok(!items.some(i => i.url === '/kyc-clouseau'), 'KYC4U off the menu');
  assert.match(source('client/src/App.tsx'), /<Route path="\/kyc-clouseau" component=\{KycHub\} \/>/);
  assert.match(hr, /\{isOwn && <TabsTrigger value="business-card"/);
  assert.match(hr, /\{isOwn \? "Card & expenses" : "Expenses"\}/);
  assert.match(hr, /<MyCardAndExpenses embedded \/>/);
  assert.match(hr, /<BusinessCardPanel embedded \/>/);
});

test('the More group is archived; Double Bill is in Admin', () => {
  // Woody, 2026-11-23: "move doubkle bill to admin and archive out all the more stuff".
  const sidebar = source(SIDEBAR);
  assert.ok(!sidebar.includes('const unfinishedNav') && !/label="More"/.test(sidebar), 'no More group');
  assert.deepEqual(admin.filter(i => i.url === '/leisure-platform').map(i => i.title), ['Double Bill']);
  assert.deepEqual(phone.filter(i => i.url === '/leisure-platform').map(i => i.adminOnly), [true]);
  for (const url of ['/portfolios', '/tenant-rep', '/hunters/letting', '/hunters/investment', '/landlords', '/westminster-restaurants', '/models', '/document-studio', '/document-briefs', '/leads', '/enrichment']) {
    for (const items of [core, admin, phone]) assert.ok(!items.some(i => i.url === url), url);
  }
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

test('Requirements is a pill in Brands for every login; Reporting and Board Report are off the menus', () => {
  // Woody, 2026-11-17: "put requirements in the brands section for everyone" and
  // "fold reporting and board report in to finance".
  for (const items of [core, phone]) {
    for (const url of ['/requirements', '/reporting', '/board-report']) assert.ok(!items.some(i => i.url === url), url);
  }
  const hub = source('client/src/pages/brands-hub.tsx');
  assert.match(hub, /const HUB_TABS: HubTab\[\] = \["overview", "explorer", "requirements", "turnover", "hunter", "crm"\];/);
  assert.match(hub, /\{ key: "requirements", label: "Requirements", icon: ClipboardList \}/);
  // Only the Brand CRM is cut by login; Requirements shows for staff, Landsec and every client, and on a phone.
  assert.match(hub, /\.filter\(t => t\.key !== "crm" \|\| showBrandCrm\)\n\s*\.filter\(t => !isMobile \|\| t\.key === "explorer" \|\| t\.key === "requirements" \|\| t\.key === "crm"\);/);
  assert.match(hub, /\{activeTab === "requirements" && \(\s*<Suspense fallback=\{<Skeleton className="h-64 w-full" \/>\}>\s*<RequirementsPage embedded \/>/);
  const app = source('client/src/App.tsx');
  assert.match(app, /function RequirementsToBrands\(\) \{\s*const params = new URLSearchParams\(useSearch\(\)\);\s*params\.set\("tab", "requirements"\);\s*return <Redirect to=\{`\/brands\?\$\{params\.toString\(\)\}`\} replace \/>;/);
  assert.match(app, /<Route path="\/requirements">\{\(\) => <RequirementsToBrands \/>\}<\/Route>/);
  const allowed = find('client/src/App.tsx', node => ts.isVariableStatement(node) && node.getText().startsWith('const CLIENT_ALLOWED_ROUTES ='));
  assert.ok(allowed.includes('"/brands"') && allowed.includes('"/requirements"'), 'a client login can still open both addresses');
  const page = source('client/src/pages/requirements.tsx');
  assert.match(page, /export default function Requirements\(\{ embedded = false \}: \{ embedded\?: boolean \} = \{\}\)/);
  assert.match(page, /\{!embedded && <h1 /);
});

test('the Investment team has no Brands on its menus; everyone else keeps it', () => {
  // Woody, 17 November 2026: "move brands out of investment side panel".
  assert.deepEqual(INVESTMENT_SIDE_HIDDEN_URLS, ['/brands']);
  for (const url of INVESTMENT_SIDE_HIDDEN_URLS) assert.ok(core.some(i => i.url === url) && phone.some(i => i.url === url), url);
  assert.equal(investmentSideOnly(['Investment']), true);
  assert.equal(investmentSideOnly(['Investment', 'Landsec']), true, 'a client view is not a team');
  assert.equal(investmentSideOnly(['Investment', 'Lease Advisory']), false);
  assert.equal(investmentSideOnly(['Investment', 'City']), false);
  assert.equal(investmentSideOnly(['Shopping Centre']), false);
  assert.equal(investmentSideOnly([]), false, 'no team: the board, support and consultants');
  assert.equal(investmentSideOnly([null, undefined, 'all']), false);
  const investmentOnly = TEAM_ROSTER_2026.filter(p => investmentSideOnly(p.teams)).map(p => p.name).sort();
  assert.deepEqual(investmentOnly, TEAM_ROSTER_2026.filter(p => p.teams.length && p.teams.every(t => t === 'Investment')).map(p => p.name).sort());
  assert.ok(investmentOnly.includes('Jack Barratt'));
  const sidebar = source(SIDEBAR);
  // The team on the switcher decides when it is a BGP team (so viewing as
  // Investment hides Brands, and an Investment login viewing a leasing team
  // sees that team's menu); else the login's own teams.
  assert.match(sidebar, /const investmentOnly = !isClientUser && \(isBgpTeam\(activeTeam\) \? activeTeam === "Investment" : investmentSideOnly\(ownTeams\)\);/);
  assert.match(sidebar, /const coreNavTeam = investmentOnly \? coreNavLeasing\.filter\(i => !INVESTMENT_SIDE_HIDDEN_URLS\.includes\(i\.url\)\) : coreNavLeasing;/);
  assert.match(sidebar, /overlayInvestmentOnly && INVESTMENT_SIDE_HIDDEN_URLS\.includes\(i\.url\)/);
});

test('Approvals is in Admin for admins, its count on the closed group; a non-admin approver keeps it in Core', () => {
  // Woody, 17 November 2026: "move approvals into admin". Every approver
  // today is on the admin list; one who is not would have no Admin group.
  const sidebar = source(SIDEBAR);
  assert.ok(!core.some(i => i.url === '/expenses/approvals') && !admin.some(i => i.url === '/expenses/approvals'), 'added only when there is something to approve');
  assert.match(sidebar, /const coreWithApprovals = approvalsEntry && !user\?\.isAdmin \? \[\.\.\.coreNavFiltered, approvalsEntry\] : coreNavFiltered;/);
  assert.match(sidebar, /const adminNav = approvalsEntry \? adminNavBase\.flatMap\(i => i\.url === "\/expenses" \? \[i, approvalsEntry\] : \[i\]\) : adminNavBase;/);
  assert.match(sidebar, /closedBadge=\{approvalsEntry \? \{ text: approvalsEntry\.badge,/);
  assert.match(sidebar, /\{!open && closedBadge && \(/);
  assert.ok(admin.some(i => i.url === '/expenses'), 'Approvals goes in beside Expenses');
});
