// The CRM page for a client login, the diary for every kind and the CRM
// layer on the Landsec calendar (Woody, 2026-11-15). Source-level guards:
// what a client's screens may ask for, and who the wider diary is for.
//   node --import tsx --test qa/regression/crm-client-hub-guards.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { landsecCrmEntries } from '../../client/src/components/landsec/landsec-meetings.ts';

const source = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
// Code only: comments may name the addresses a screen must not call.
const code = path => source(path).split('\n').filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

test("a client's Brands list asks only for the client's own feeds and draws none of BGP's own cells", () => {
  const list = code('client/src/components/crm-hub/client-brand-list.tsx');
  const asked = [...list.matchAll(/["'`](\/api\/[^"'`?$]+)/g)].map(match => match[1]).sort();
  assert.deepEqual([...new Set(asked)], ['/api/client/brand-directory', '/api/landsec/diary']);
  // BGP's owner, last contact, strategies and the staff people feed stay off a client's row.
  for (const own of ['OwnersCell', 'ContactCell', 'StrategyCell', 'PeopleBlock', 'CRM_HUB_KEY', 'StartStrategyDialog']) assert.doesNotMatch(list, new RegExp(`\\b${own}\\b`), own);
  // The row is built with those fields empty, whatever the feeds carry.
  assert.match(list, /owners: \[\], lastContactAt: null, nextContactAt: null,/);
  assert.match(list, /strategies: \[\],/);
  // The ids other suites press are kept.
  for (const id of ['client-add-contact-', 'client-edit-contact-', 'client-brand-search', 'client-rel-', 'client-prop-filter']) assert.ok(list.includes(id), id);
});

test("the CRM page gives a client login its own hub and never BGP's lists, engine or kick-off", () => {
  const page = code('client/src/pages/people.tsx');
  const hub = page.slice(page.indexOf('function ClientCrmHub'), page.indexOf('function ContactQuickDialog'));
  assert.ok(hub.length > 500);
  for (const own of ['CrmCompanyList', 'CrmEngagementPanel', 'StartStrategyDialog', 'ContactDataHealth', 'CrmMeetingsTab', 'scope="all"']) assert.ok(!hub.includes(own), own);
  assert.match(hub, /<Diary staff=\{false\} \/>/);
  assert.match(page, /if \(user\?\.role === "Client" \|\| !!\(user as any\)\?\.companyScopeId\) return <ClientCrmHub \/>;/);
  // In the Landsec view BGP staff lose Landlords and Lenders, nothing else.
  assert.match(page, /const LANDSEC_HIDDEN: PeopleTab\[\] = \["landlords", "lenders"\];/);
  // The three older tab designs are gone.
  for (const old of ['function LandlordsTab', 'function AgentsTab', 'function LendersTab']) assert.ok(!page.includes(old), old);
});

test('the diary for every kind is behind the staff door, and a client viewer is never given it', () => {
  const diary = code('server/brand-crm-diary.ts');
  const staffRoute = diary.slice(diary.indexOf('app.get("/api/brand-crm/diary"'), diary.indexOf('app.get("/api/landsec/diary"'));
  assert.ok(staffRoute.indexOf('staffDoor(req, res)') > 0 && staffRoute.indexOf('staffDoor(req, res)') < staffRoute.indexOf('scope:'));
  const landsecRoute = diary.slice(diary.indexOf('app.get("/api/landsec/diary"'));
  assert.doesNotMatch(landsecRoute, /scope/);
  assert.match(diary, /const everyKind = staff && options\.scope === "all";/);
});

test('the note box that fills a CRM form is never drawn for a client login', () => {
  const box = code('client/src/components/crm-engagement/note-fill.tsx');
  assert.match(box, /const staff = !!me && me\.role !== "Client" && !me\.companyScopeId;/);
  assert.match(box, /if \(!staff\) return null;/);
});

test('the CRM layer on the Landsec calendar: dated diary lines only, never a booked viewing twice', () => {
  const item = over => ({ id: 'crm_action:a1', kind: 'crm_action', title: 'Send the plans', date: '2026-11-20', daysWaiting: null, overdue: false,
    brand: { id: 'b1', name: 'Wingstop' }, scheme: { key: 'bluewater', name: 'Bluewater' }, unitLabel: 'Unit 4', owner: 'Emily', waitingOn: null,
    raisedBy: 'bgp', status: 'todo', actionId: null, canComplete: false, url: '/companies/b1', ...over });
  const entries = landsecCrmEntries({ items: [
    item({}),
    item({ id: 'viewing_booked:v1', kind: 'viewing_booked' }),
    item({ id: 'deal_waiting:d1', kind: 'deal_waiting', date: null }),
    item({ id: 'viewing_followup:v2', kind: 'viewing_followup', title: 'Follow up the viewing', brand: { id: null, name: 'Dishoom' }, raisedBy: null }),
    item({ id: 'crm_action:a2', raisedBy: 'client' }),
  ] });
  assert.deepEqual(entries.map(entry => entry.id), ['crm:crm_action:a1', 'crm:viewing_followup:v2', 'crm:crm_action:a2']);
  assert.deepEqual(entries[0].crm, { label: 'CRM action', url: '/companies/b1', owner: 'Emily', companyId: 'b1', company: 'Wingstop', place: 'Bluewater · Unit 4', detail: 'From BGP' });
  assert.equal(entries[1].crm.companyId, null);
  assert.equal(entries[1].crm.label, 'Viewing follow-up');
  assert.equal(entries[2].crm.detail, 'Your request to BGP');
  assert.equal(entries[0].time, null);
  assert.deepEqual(landsecCrmEntries(null), []);
  // The calendar asks only the Landsec door for it.
  assert.match(code('client/src/pages/available-units.tsx'), /apiRequest\("GET", "\/api\/landsec\/diary"\)/);
});
