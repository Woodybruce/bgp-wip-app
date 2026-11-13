// Back goes back (Woody, 2026-11-13: "back buttons should just always take
// back to the screen before"). The rule lives in client/src/lib/go-back.ts;
// these are source-level guards that no screen grows its own again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const clientFiles = (dir = 'client/src') => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
  const file = `${dir}/${entry.name}`;
  if (entry.isDirectory()) return clientFiles(file);
  return /\.(ts|tsx)$/.test(entry.name) ? [file] : [];
});

test('no screen asks the browser how many entries it holds: that counts pages from before the app', () => {
  // The helper reads it once, at load, and only to tell a link opened in a new tab.
  const offenders = clientFiles().filter(file => file !== 'client/src/lib/go-back.ts' && /window\.history\.length/.test(read(file)));
  assert.deepEqual(offenders, []);
});

test('the helper walks history only while there is a screen before in the app, and replaces on the way to a parent', () => {
  const helper = read('client/src/lib/go-back.ts');
  assert.match(helper, /if \(canGoBackInApp\(\)\) window\.history\.back\(\);/);
  assert.match(helper, /navigate\(parent \|\| pageParent \|\| backParent\(window\.location\.pathname\), \{ replace: true \}\)/);
  assert.match(read('client/src/main.tsx'), /installBackTracking\(\);[\s\S]*createRoot\(rootEl\)/, 'tracking starts before the app mounts');
});

test('every Back around brands uses the one helper', () => {
  for (const file of ['client/src/pages/contacts.tsx', 'client/src/pages/companies.tsx', 'client/src/components/deal-detail.tsx',
    'client/src/components/property-detail.tsx', 'client/src/components/header-back.tsx', 'client/src/components/smart-back.tsx', 'client/src/App.tsx']) {
    assert.match(read(file), /useGoBack\(/, file);
  }
  for (const file of ['client/src/pages/companies.tsx', 'client/src/components/deal-detail.tsx', 'client/src/components/property-detail.tsx',
    'client/src/components/header-back.tsx', 'client/src/components/smart-back.tsx', 'client/src/App.tsx', 'client/src/pages/contacts.tsx']) {
    assert.doesNotMatch(read(file), /window\.history\.back\(\)/, `${file} walks history itself`);
  }
});

test('the contact page Back is the screen before, with the company\'s People & checks as its parent', () => {
  const contacts = read('client/src/pages/contacts.tsx');
  const button = contacts.slice(contacts.indexOf('function ContactDetail('), contacts.indexOf('function ContactDetail(') + 12000);
  assert.match(button, /useGoBack\(contact\?\.companyId \? `\/companies\/\$\{contact\.companyId\}\?section=people` : "\/contacts"\)/);
  assert.match(button, /data-testid="button-back-contacts" onClick=\{goBack\}/);
  assert.doesNotMatch(button, /<Link href="\/contacts">\s*<Button[^>]*button-back-contacts/);
});

test('a deal on a brand\'s Deals card opens the deal page, and is plain text for a login with no deal page', () => {
  const card = read('client/src/components/brand-page/brand-deals-card.tsx');
  assert.doesNotMatch(card, /\/deals\?id=/);
  assert.equal((card.match(/href=\{`\/deals\/\$\{d\.id\}`\}/g) || []).length, 2);
  assert.match(card, /const plain = useLandsecRestricted\(\);/);
  assert.match(card, /d\.property_id && !plain \? <Link/);
  for (const file of ['client/src/components/account-deals-board.tsx', 'client/src/components/account-workspace-cards.tsx', 'client/src/components/brand-profile-panel.tsx']) {
    assert.doesNotMatch(read(file), /\/deals\?id=/, file);
  }
});

test('a pill or tab change replaces the entry; a refused page is replaced, never stacked', () => {
  assert.match(read('client/src/components/mobile-brand-view.tsx'), /url\.searchParams\.set\("section", PHONE_SECTION_SLUG\[section\]\);\s*window\.history\.replaceState\(window\.history\.state, "", url\);/);
  assert.match(read('client/src/components/brand-profile-panel.tsx'), /url\.searchParams\.set\("section", BRAND_SECTION_SLUG\[section\]\);\s*window\.history\.replaceState\(/);
  assert.match(read('client/src/pages/deals-hub.tsx'), /setLocation\(target, \{ replace: true \}\)/);
  const hub = read('client/src/pages/brands-hub.tsx');
  assert.doesNotMatch(hub, /<Link href="\/brands\?tab=[a-z]+">/, 'a tab link inside the hub replaces');
  const app = read('client/src/App.tsx');
  const guard = app.slice(app.indexOf('function ClientRouteGuard()'), app.indexOf('function ClientRouteGuard()') + 1600);
  assert.match(guard, /const navigate = useCallback\(\(to: string\) => setLocation\(to, \{ replace: true \}\), \[setLocation\]\);/);
  assert.match(guard, /if \(!ok\) navigate\("\/"\);/);
});

test('the phone and desktop pills use the same names in the address', () => {
  const phone = read('client/src/components/mobile-brand-view.tsx');
  const desktop = read('client/src/components/brand-profile-panel.tsx');
  const desktopSlugs = [...desktop.match(/const BRAND_SECTION_SLUG[^\n]*/)[0].matchAll(/: "([a-z]+)"/g)].map(m => m[1]);
  const phoneSlugs = [...phone.match(/const PHONE_SECTION_SLUG[^\n]*/)[0].matchAll(/: "([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(desktopSlugs.sort(), ['deals', 'expansion', 'news', 'overview', 'people', 'stores']);
  for (const slug of desktopSlugs) assert.ok(phoneSlugs.includes(slug), slug);
});

test('a deal page is not a tab root: the phone shell keeps its arrow and the top bar leaves the list tabs their Back', () => {
  const helper = read('client/src/lib/go-back.ts');
  const pattern = new RegExp(helper.match(/const DEAL_PAGE = \/(.+)\/;/)[1]);
  for (const tab of ['/deals', '/deals/letting', '/deals/properties', '/deals/report', '/deals/list', '/deals/investment', '/deals/letting/x']) assert.equal(pattern.test(tab), false, tab);
  for (const page of ['/deals/b9a6e000-0000-4000-8000-000000000301', '/deals/123']) assert.equal(pattern.test(page), true, page);
  assert.match(read('client/src/App.tsx'), /const isBottomNavRoute = !isDealPage\(location\) && \(/);
  assert.match(read('client/src/components/header-back.tsx'), /isDealPage\(location\)/);
});

test('search opens the record it found', () => {
  const search = read('client/src/components/global-search.tsx');
  assert.match(search, /contact: \{[^}]*href: \(id\) => `\/contacts\/\$\{id\}`/);
  assert.match(search, /company: \{[^}]*href: \(id\) => `\/companies\/\$\{id\}`/);
});

test('a hash change on the same page is one step on, not a fresh start', async () => {
  // PropertyTenancySchedule sets location.hash ("view on plan"): a new entry
  // with no position. Back from the property must still reach the screen before.
  const entries = [{ state: null, url: '/companies/a?section=deals' }];
  let pos = 0;
  const listeners = {};
  const fire = type => (listeners[type] || []).forEach(fn => fn());
  const part = () => entries[pos].url.split('#')[0];
  const before = globalThis.window;
  globalThis.window = {
    history: {
      get state() { return entries[pos].state; },
      get length() { return entries.length; },
      replaceState(state, _title, url) { entries[pos] = { state, url: url ?? entries[pos].url }; fire('replaceState'); },
      pushState(state, _title, url) { entries.splice(pos + 1); entries.push({ state, url }); pos += 1; fire('pushState'); },
      back() { pos -= 1; fire('popstate'); },
    },
    location: {
      get pathname() { return part().split('?')[0]; },
      get search() { return part().includes('?') ? `?${part().split('?')[1]}` : ''; },
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  };
  const unstamped = url => { entries.splice(pos + 1); entries.push({ state: null, url }); pos += 1; fire('popstate'); };
  try {
    const { installBackTracking, canGoBackInApp } = await import('../../client/src/lib/go-back.ts');
    installBackTracking();
    assert.equal(canGoBackInApp(), false, 'a pasted link has no screen before');
    window.history.pushState(null, '', '/properties/p');
    assert.equal(entries[pos].state.bgpIdx, 1);
    unstamped('/properties/p#plan-tenancy-1');
    assert.equal(entries[pos].state.bgpIdx, 2, 'the hash entry is one step on from the property');
    assert.equal(canGoBackInApp(), true);
    window.history.back();
    assert.equal(entries[pos].state.bgpIdx, 1);
    assert.equal(canGoBackInApp(), true, 'Back from the property still walks to the brand');
    unstamped('/somewhere/else');
    assert.equal(entries[pos].state.bgpIdx, 0, 'any other entry with no position is still a fresh start');
  } finally {
    globalThis.window = before;
  }
});
