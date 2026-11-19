// The deal page rebuild (Woody, 18 November 2026: "Yep go ahead" on
// docs/deal-page-review-2026-11-18.md steps 3 to 5 and 7). Source guards: the
// page's reads write nothing and are cut on the server like the deal itself,
// the clock opens to BGP staff on any letting through one rule, the
// conversation is the property's shared thread cut to the deal, the AML card
// is read only when its section is opened, and the page stops downloading
// the whole company, contact and property lists to look up a few names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const feed = read('server/deal-page.ts');
const unit = read('server/landsec-unit.ts');
const checklist = read('server/deal-checklist.ts');
const landsec = read('shared/landsec.ts');
const record = read('server/record-conversation.ts');
const page = read('client/src/components/deal-detail.tsx');
const convo = read('client/src/components/deal-page/deal-conversation.tsx');
const dialogs = read('client/src/components/deal-page/letting-dialogs.tsx');
const activity = read('client/src/components/activity-summary.tsx');
const index = read('server/index.ts');

test('the page and timeline reads are mounted, keyed by the deal, and write nothing', () => {
  assert.match(index, /setupDealPageRoutes\(app\);/);
  assert.ok(feed.includes('app.get("/api/crm/deals/:id/page", requireAuth'));
  assert.ok(feed.includes('app.get("/api/crm/deals/:id/timeline", requireAuth'));
  assert.doesNotMatch(feed, /\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b/, 'no write in the deal page reads');
  assert.doesNotMatch(feed, /app\.(post|put|patch|delete)\(/);
});

test('who may read is who may open the deal, as GET /api/crm/deals/:id decides', () => {
  const viewer = feed.slice(feed.indexOf('async function viewerFor('), feed.indexOf('async function trackerUnitFor('));
  assert.match(viewer, /if \(!scope\) return \(await isClientRequestUser\(req\)\) \? null : "staff";/);
  assert.match(viewer, /if \(!\(await isDealInScope\(scope, deal\.id\)\)\) return null;/);
  assert.match(viewer, /schemeLimitedPropertyIdsOrNone\(req, "deal-page"\)/);
  assert.match(viewer, /\(await isJointAgentLogin\(req\)\) \? "joint_agent" : "client"/);
  // The letting's pieces only for a caller who may open the unit's brief.
  assert.match(feed, /const access = found \? await briefAccess\(req, found\.property_id\) : null;\s*const unit = found && access \? found : null;/);
});

test("BGP's own records stay BGP's", () => {
  assert.match(feed, /return sortEvents\(eventsForViewer\(events, viewer\)\);/);
  const rules = read('shared/deal-page.ts');
  assert.match(rules, /STAFF_ONLY_EVENTS: readonly DealEventKind\[\] = \["aml", "invoiced", "invoice"\]/);
  // AML lines, client checks, KYC4U requests and invoices are read for staff only.
  for (const table of ['FROM deal_audit_log\n        WHERE deal_id = $1 AND field = ANY', 'FROM kyc_upload_tokens', 'FROM kyc4u_drafts', 'FROM xero_invoices']) {
    const at = feed.indexOf(table);
    assert.ok(at > 0, table);
    assert.match(feed.slice(at - 200, at), /staff \? pool\.query\(/, `${table} is read for staff only`);
  }
  // A client check's token is the client's key: never selected.
  assert.match(feed, /`SELECT contact_name, contact_email, created_at, completed_at, revoked_at, request->'person'->>'name' AS person_name, request->>'sentAt' AS sent_at FROM kyc_upload_tokens/);
  // Tasks: BGP staff read every task on the deal; anyone else only their own.
  assert.match(feed, /AND \(\$2::boolean OR t\.user_id = \$3\)/);
  // A joint agent: company names with no ids, and a contact's name only on its own offer.
  assert.match(feed, /id: viewer === "joint_agent" \? null : c\.id/);
  assert.match(feed, /const own = !jointAgent \|\| \(!!r\.first_by && r\.first_by === access\?\.userId\);/);
  // The property's folder links and the deal's own unit record are BGP staff's.
  assert.match(feed, /folderTeams: staff &&/);
  assert.match(feed, /staff && deal\.unit_id \? pool\.query\(`SELECT id, unit_name, property_id, unit_address/);
});

test('a joint agent reaches the two reads, GET only, and not the change log', () => {
  assert.match(landsec, /const JOINT_AGENT_DEAL_PAGE = new RegExp\(`\^\/api\/crm\/deals\/\$\{UNIT_ID\}\/\(page\|timeline\)\$`\);/);
  const get = landsec.slice(landsec.indexOf('    if (m === "GET") {'), landsec.indexOf('if (JOINT_AGENT_SCHEDULE.test(p))'));
  assert.ok(get.includes('if (JOINT_AGENT_DEAL_PAGE.test(p)) return "allow";'), 'opened under GET only');
});

test('the clock: one rule for who writes it, BGP staff on any letting', () => {
  const writer = unit.slice(unit.indexOf('export async function clockWriterFor('), unit.indexOf('export async function clockForDeal('));
  assert.match(writer, /const access = await unitAccess\(req, deal\.property_id\);/);
  assert.match(writer, /if \(!\(await contactViewer\(req\)\)\.staff\) return null;/);
  assert.match(writer, /if \(isLettingType\(deal\.deal_type\)\) return \{ kind: "staff", visible: null \};/);
  assert.match(writer, /SELECT 1 FROM available_units WHERE deal_id = \$1 LIMIT 1/);
  for (const route of ['app.get("/api/landsec/deal/:id/waiting-options"', 'app.put("/api/landsec/deal/:id/clock"']) {
    const body = unit.slice(unit.indexOf(route), unit.indexOf('} catch', unit.indexOf(route)));
    assert.match(body, /clockWriterFor\(req, deal\)/, `${route} asks the one rule`);
    assert.doesNotMatch(body.slice(0, 600), /if \(!access\) return res\.status\(403\)/, `${route} no longer refuses BGP staff off the schemes`);
  }
  // The checklist's "Deal is waiting on this" asks the same rule.
  assert.match(checklist, /const \{ clockWriterFor \} = await import\("\.\/landsec-unit"\);\s*return !!\(await clockWriterFor\(req, deal\)\);/);
  assert.match(checklist, /if \(access\.isStaff && !access\.scope\) return true;/);
});

test('the conversation is the property\'s shared thread, cut to the deal', () => {
  assert.ok(convo.includes('apiRequest("POST", `/api/chat/threads/record/property/${encodeURIComponent(propertyId)}`)'));
  // It joins only when the box is opened.
  assert.match(convo, /if \(!open \|\| threadId \|\| !propertyId\) return;/);
  assert.match(convo, /const tags = \[`\(tag:deal\/\$\{dealId\}\)`, \.\.\.\(unitId \? \[`\(tag:unit\/\$\{unitId\}\)`\] : \[\]\)\];/);
  assert.match(convo, /buildTagToken\("deal", dealId, dealLabel\)/);
  assert.match(convo, /buildTagToken\("unit", unit\.id, unit\.name\)/);
  // The count: a property the caller may open, and it never joins.
  const route = record.slice(record.indexOf('router.get("/api/chat/threads/record/deal-comments"'));
  assert.match(route, /if \(await propertyReadBlocked\(req, propertyId\)\) return res\.status\(403\)/);
  assert.doesNotMatch(route.slice(0, route.indexOf('export default')), /addChatThreadMember/);
  // The old Comments box is read only.
  assert.doesNotMatch(page + convo, /\/api\/crm\/deals\/\$\{dealId\}\/comments/);
});

test('the page: one frame, the AML card only in its own section, no whole lists to look up names', () => {
  assert.match(page, /<CompanyKindPage key=\{id\} testId="deal-page" sectionTestPrefix="deal-section" scrollOnPhone>/);
  assert.doesNotMatch(page, /useDealAmlStatus/, 'reading the AML status starts the paid checks before asking: only the Parties & AML section reads it');
  const top = page.slice(page.indexOf('export function DealDetail('), page.indexOf('function DealPartiesCard('));
  for (const list of ['"/api/crm/companies"', '"/api/crm/contacts"', '"/api/crm/properties"', '"/api/property-units"']) {
    assert.doesNotMatch(top, new RegExp(`useQuery<[^(]*\\(\\{\\s*queryKey: \\[${list.replace(/[/]/g, '\\/')}\\]`), `${list} is not downloaded on every deal page`);
  }
  assert.match(page, /\{!jointAgent && \(\s*<Button variant="outline" size="sm" onClick=\{\(\) => setEditOpen\(true\)\} data-testid="button-edit-deal">/, 'a joint agent does not edit deals here');
  // The unit editor starts from the unit's own address, so Save keeps it.
  assert.match(page, /unitAddress: linkedUnit\?\.unitAddress \|\| ""/);
  // The unit's own dialogs open only on the deal that is the unit's current letting.
  assert.match(dialogs, /open=\{live && dialog\?\.to === "hots"\}/);
  assert.match(dialogs, /open=\{live && dialog\?\.to === "checklist"\}/);
});

test('the activity feed on a deal leaves out its own moves and does not link back to itself', () => {
  assert.match(activity, /filter\(a => !\(dealId && a\.kind === "deal" && \(!a\.deal_id \|\| a\.deal_id === dealId\)\)\)/);
  assert.match(activity, /const dealId = itemDealId && itemDealId !== feedDealId \? itemDealId : null;/);
  assert.match(activity, /Object\.keys\(kindCounts\)\.length > 1/);
});
