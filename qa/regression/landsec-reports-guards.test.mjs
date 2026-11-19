// Landsec reports (Woody, 2026-11-19): source guards.
//
// The reports are built from the feeds the pages read, key by key. These
// guards fail the build when the builders name anything of BGP's own (what it
// earns, how that is shared, its remarks on a record, who at BGP runs it, its
// mail, its compliance working), when a query of their own reaches past the
// few tables they are allowed, or when the access checks are taken off.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LANDSEC_REPORTS } from '../../shared/landsec-reports.ts';

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const BUILDERS = 'server/landsec-reports.ts';
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(line => line.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/ .*$/, '')).join('\n');
const builders = code(read(BUILDERS));

// Each is tried as a whole word, as a snake_case part and as a camelCase part.
const NEVER_NAMED = [
  'fee', 'fees', 'commission', 'allocation', 'allocations', 'invoice', 'invoiced', 'invoicing', 'xero', 'wip',
  'note', 'notes', 'comment', 'comments', 'commentary',
  'internal', 'agent_ids', 'bgp_contact', 'covers',
  'email', 'emails', 'mailbox', 'interaction', 'interactions', 'attendees',
  'aml', 'kyc', 'pep', 'compliance',
  'landlord_pack', 'extract', 'source_details', 'take',
];

test('the report builders never name a fee, a split, BGP notes, an internal agent, mail or compliance field', () => {
  // "jointAgent" (the joint agent's name on a deal, which a Landsec login reads on its Deals page) is the one allowed "agent" word.
  const words = builders.replace(/jointAgent|joint_agent/g, 'JOINTAGENT');
  const tokens = new Set();
  for (const id of words.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
    tokens.add(id.toLowerCase());
    for (const part of id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split('_')) if (part) tokens.add(part);
  }
  const named = NEVER_NAMED.filter(word => tokens.has(word) || new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i').test(words.toLowerCase().replace(/[^a-z_]+/g, ' ')));
  assert.deepEqual(named, [], `server/landsec-reports.ts names: ${named.join(', ')}`);
  // The clock feed's row carries BGP's fee for staff. A row is never spread into a report.
  assert.doesNotMatch(builders, /\.\.\.\s*d\b/, 'a deal row is never spread: every key is named');
  assert.doesNotMatch(builders, /\.\.\.\s*(u|v|c)\b(?!\.)/, 'a unit, viewing or comparable is never spread: every key is named');
});

test('the queries of their own read only deal dates, company names and who is asking', () => {
  const sql = Array.from(builders.matchAll(/pool\.query\(\s*`([\s\S]*?)`/g)).map(m => m[1]);
  assert.equal(sql.length, 3, 'three queries: deal dates, brand names for requirements, the name of who made the report');
  const tables = new Set();
  for (const text of sql) for (const m of text.matchAll(/\b(?:FROM|JOIN)\s+(?:LATERAL\s*\(\s*SELECT[\s\S]*?FROM\s+)?([a-z_]+)/gi)) tables.add(m[1].toLowerCase());
  for (const table of tables) {
    assert.ok(['crm_deals', 'crm_companies', 'available_units', 'tenancy_schedule_units', 'deal_audit_log', 'users'].includes(table), `a report query reads ${table}`);
  }
  assert.ok(tables.has('crm_deals') && tables.has('deal_audit_log'));
  for (const text of sql) {
    assert.doesNotMatch(text, /SELECT\s+\*|\b[a-z]+\.\*/i, 'named columns only');
    assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i, 'the reports write nothing');
  }
});

test('units, deals, viewings, requirements and the category count come from the pages\' own feeds', () => {
  for (const feed of ['propertyReadBlocked(ctx.req, property.id)', 'loadPropertyUnits(pool, property.id)', 'unitsForViewer(feed, viewer)', 'unitViewerFor(ctx.req)',
    'landsecDealsFeed(ctx.req)', 'listLeasingViewings({ companyId: viewer.companyId', 'requirementReason(r).clientText', 'storage.getCrmRequirementsLeasing(', 'storage.getCrmComps(', 'categoryMixByProperty(']) {
    assert.ok(builders.includes(feed), `the builders call ${feed}`);
  }
  // Viewings are read as a Landsec login reads them, never as BGP staff (no company = every landlord's viewings).
  assert.doesNotMatch(builders, /listLeasingViewings\(\s*(null|\{\s*companyId:\s*null)/);
  // A requirement goes out as the client wording of what it is: never its state or who confirmed it.
  for (const never of ['lastConfirmed', 'last_confirmed', 'confirmedHow', 'confirmed_how', 'bgpContactUser', '.text,', 'reason.text', 'requirementLive(']) {
    assert.ok(!builders.includes(never), `the builders do not use ${never}`);
  }
});

test('every route asks who is calling first, and a joint agent or another landlord\'s login gets nothing', () => {
  const routes = builders.slice(builders.indexOf('export function setupLandsecReportRoutes'));
  const handlers = routes.split(/app\.get\(/).slice(1);
  assert.equal(handlers.length, 2, 'the index and one report');
  for (const handler of handlers) {
    assert.match(handler, /^"\/api\/landsec\/reports(\/:key)?", requireAuth, async/);
    const first = handler.slice(handler.indexOf('try {') + 5).trim();
    assert.match(first, /^const viewer = await reportViewer\(req\);\s*if \(!viewer\) return res\.status\(403\)/, 'the viewer is resolved before anything else');
  }
  assert.match(builders, /export async function reportViewer\(req: Request\): Promise<LandsecViewer \| null> \{\s*const viewer = await landsecViewer\(req\);\s*if \(!viewer \|\| viewer\.role === "joint_agent"\) return null;/);
  // The schemes come from the login, and a key that is asked for only narrows them.
  assert.match(builders, /portfolio\.schemes\.filter\(s => viewerCanSeeScheme\(viewer, s\.key\)\)/);
  assert.match(builders, /return allowed\.filter\(s => want\.has\(s\.key\)\);/);
  assert.match(routes, /pickSchemes\(await reportSchemesFor\(viewer\), req\.query\.schemes\)/);
  // The period is the one rule.
  assert.match(routes, /parseReportPeriod\(req\.query\.from, req\.query\.to\)/);
  assert.doesNotMatch(routes, /app\.(post|put|patch|delete)\(/, 'reports are read only');
});

test('the gateways: a client login reaches the reports, a joint agent is refused in both lists', () => {
  const index = read('server/index.ts');
  const allowed = index.slice(index.indexOf('const CLIENT_ALLOWED_API = ['));
  assert.match(allowed.slice(0, allowed.indexOf('];')), /"\/api\/landsec\/"/, 'GET /api/landsec/reports passes the client gateway');
  assert.match(index, /import \{ setupLandsecReportRoutes \} from "\.\/landsec-reports";/);
  assert.match(index, /\n\s*setupLandsecReportRoutes\(app\);/);
  const landsec = read('shared/landsec.ts');
  const denied = landsec.slice(landsec.indexOf('export function jointAgentApiDenied'), landsec.indexOf('export function landsecLoginSchemes'));
  assert.match(denied, /if \(\/\^\\\/api\\\/landsec\\\/reports\(\\\/\|\$\)\/\.test\(p\)\) return true;/);
  const rule = landsec.slice(landsec.indexOf('export function restrictedLandsecApiRule'));
  assert.match(rule, /if \(jointAgent && \/\^\\\/api\\\/landsec\\\/reports\(\\\/\|\$\)\/\.test\(p\)\) return "deny";\s*return "allow";/, 'the shared /api/landsec/ prefix does not open reports to a joint agent');
});

test('every report on the registry has a builder, and no builder is off the registry', () => {
  const body = builders.slice(builders.indexOf('export async function buildLandsecReport'), builders.indexOf('export function setupLandsecReportRoutes'));
  const built = Array.from(body.matchAll(/case "([a-z-]+)":/g)).map(m => m[1]);
  assert.deepEqual(built.slice().sort(), LANDSEC_REPORTS.map(r => r.key).sort());
  assert.match(body, /default: throw new Error/);
  // Budgets are not held, so no sheet of that name is made.
  assert.doesNotMatch(builders, /budget/i);
});

test('every workbook opens on an About sheet that says what it holds', () => {
  assert.match(builders, /const about = wb\.addWorksheet\("About"\);/);
  for (const line of ['["Period", ctx.period.label]', '["Schemes", ctx.schemes.map(s => s.name).join(", ")]', '["Made by", ctx.madeBy]', '["Made on", longDay(ctx.madeAt)]', '["Source", `ChatBGP. ${HELD}`]']) {
    assert.ok(builders.includes(line), line);
  }
  assert.match(builders, /const HELD = "It holds what is recorded in ChatBGP on the day it was made\./);
});

test('the page only asks: the list and the rule come from the shared file, and it calls the reports addresses alone', () => {
  const page = code(read('client/src/pages/landsec-reports.tsx'));
  assert.match(page, /from "@shared\/landsec-reports";/);
  assert.match(page, /parseReportPeriod\(from, to\)/);
  assert.match(page, /data\.reports\.map\(def =>/);
  const called = Array.from(page.matchAll(/["`](\/api\/[^"`?$]*)/g)).map(m => m[1]);
  assert.ok(called.length >= 2);
  for (const address of called) assert.match(address, /^\/api\/landsec\/reports\/?$/, address);
  assert.doesNotMatch(page, /landsecRole|joint_agent|isStaff/, 'who may run a report is decided on the server');
  const app = read('client/src/App.tsx');
  assert.match(app, /<Route path="\/landsec\/reports" component=\{LandsecReports\} \/>/);
});
