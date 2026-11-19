// Every place that holds a requirement's id opens its panel on the board
// (docs/requirements-board-review-2026-11-19.md, section 5 and findings 16 to
// 19; Woody, 19 November 2026: "carry on"), the brand page shows the brand's
// market listings to BGP staff with Confirm (decision 7), and the deal page
// names the requirement it answers. Source guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const panelLink = (expr) => new RegExp(`/requirements\\?requirementId=\\$\\{encodeURIComponent\\(${expr.replace(/[.?()[\]]/g, (c) => `\\${c}`)}\\)\\}`);

test('the places that held a requirement id but opened the brand list now open the requirement', () => {
  assert.match(read('client/src/components/leasing-viewings.tsx'), panelLink('selected.requirementId'));
  const plan = read('client/src/components/brand-crm/scheme-plan-card.tsx');
  assert.match(plan, panelLink('req.id'));
  // A joint agent (restricted) or a requirement whose detail is hidden from the viewer gets plain text.
  assert.match(plan, /\{!restricted && !req\.detailHidden\s+\? <Link href=/);
  // "Open requirements" still opens the brand's list (pinned by brand-scheme-plan-card.test.mjs).
  assert.match(plan, /href=\{`\/requirements\?companyId=\$\{encodeURIComponent\(companyId\)\}`\}/);
  // The Brands overview's radar linked to a tab the company page ignores.
  const hub = read('client/src/pages/brands-hub.tsx');
  assert.doesNotMatch(hub, /\?tab=requirements/);
  assert.match(hub, panelLink('r.id'));
  // The dashboard alert, its phone twin and the widget's rows.
  const dash = read('client/src/pages/dashboard.tsx');
  assert.match(dash, /alert\.entityType === "requirement" \? \(alert\.entityId \? `\/requirements\?requirementId=\$\{encodeURIComponent\(alert\.entityId\)\}` : `\/requirements`\)/);
  assert.match(dash, /isInvestmentTeam \? `\/investment\/requirements\?requirementId=\$\{encodeURIComponent\(r\.id\)\}` : `\/requirements\?requirementId=\$\{encodeURIComponent\(r\.id\)\}`/);
  assert.match(read('client/src/components/mobile-home.tsx'), /a\.entityId \? `\/requirements\?requirementId=\$\{encodeURIComponent\(a\.entityId\)\}` : `\/requirements`/);
  assert.match(read('client/src/components/suggest-targets-dialog.tsx'), panelLink('s.requirementId'));
});

test("ChatBGP's receipts open the requirement itself", () => {
  const chat = read('server/chatbgp-requirements.ts');
  assert.match(chat, /const pageUrl = \(requirementId: string \| null \| undefined, companyId\?: string \| null\) =>\s+requirementId \? `\/requirements\?requirementId=\$\{encodeURIComponent\(requirementId\)\}`/);
  for (const call of chat.match(/url: pageUrl\([^)]*\)/g) || []) assert.match(call, /pageUrl\((out\.)?requirement\.id, /, call);
  assert.ok((chat.match(/url: pageUrl\(/g) || []).length >= 5);
});

test("Brand Gap reads a brand's requirement past the top 30, carries its id and opens it", () => {
  const gap = read('server/property-gap-analysis.ts');
  assert.match(gap, /\}\)\.sort\(\(a: any, b: any\) => b\.weight - a\.weight\)\)\.catch\(\(\) => \[\] as any\[\]\);/);
  assert.match(gap, /const listedRequirements = matchingRequirements\.slice\(0, 30\);/);
  assert.match(gap, /for \(const r of matchingRequirements\) if \(r\.company_id && !reqByCompany\.has/);
  assert.match(gap, /\? listedRequirements\.filter\(\(r: any\) => !r\.company_id \|\| sliceFilter!\(String\(r\.company_id\)\)\)\s+: listedRequirements\)/);
  // A joint agent has no requirements to open.
  assert.match(gap, /requirement_id: reqViewer === "joint_agent" \? null : r\?\.id \?\? null/);
  const panel = read('client/src/components/brand-gap-panel.tsx');
  assert.match(panel, /href=\{t\.requirement_id \? `\/requirements\?requirementId=\$\{encodeURIComponent\(t\.requirement_id\)\}`/);
  assert.match(panel, /"None that fits a unit here"/);
});

test('the brand page: each requirement opens its panel and BGP staff see market listings with Confirm', () => {
  const profile = read('server/brand-profile.ts');
  const listings = profile.slice(profile.indexOf('const marketListingsQ'), profile.indexOf('// Recent contacts'));
  assert.ok(listings.length > 0);
  // Never for a client login: it reads every requirement in `requirements` already.
  assert.match(listings, /const marketListingsQ = bpScope \? Promise\.resolve\(\{ rows: \[\] as any\[\] \}\) : pool\.query\(/);
  assert.match(listings, /\$\{requirementStateSql\("r"\)\} = 'background'/);
  assert.match(listings, /\.filter\(\(\{ live \}\) => live\.importOnly\)/);
  assert.match(listings, /list: boardListOf\(live\)/);
  assert.match(profile, /marketListings: marketListings\.rows,/);

  const desk = read('client/src/components/brand-profile-panel.tsx');
  assert.match(desk, /const marketListings = isClientViewer \? \[\] : \(data\.marketListings \|\| \[\]\);/);
  assert.match(desk, panelLink('r.id'));
  assert.match(desk, /const hasRequirements = liveRequirementCount > 0 \|\| marketListings\.length > 0 \|\| /);
  assert.match(desk, /\{bgpRequirementsBlock\}\{marketListingsBlock\}\{pipnetRequirementsBlock\}/);
  // A count opens the board filtered to the brand.
  assert.match(desk, /href=\{`\/requirements\?companyId=\$\{encodeURIComponent\(companyId\)\}`\} className="hover:text-foreground underline decoration-dotted underline-offset-2" data-testid="link-brand-requirements-count"/);

  const phone = read('client/src/components/mobile-brand-view.tsx');
  assert.match(phone, /const marketListings: BrandMarketListing\[\] = isClientViewer \? \[\] : /);
  assert.match(phone, panelLink('r.id'));
  assert.match(phone, /<BrandMarketListings companyId=\{companyId\} listings=\{marketListings\} phone/);

  const piece = read('client/src/components/brand-page/market-listings.tsx');
  assert.match(piece, panelLink('l.id'));
  assert.match(piece, /apiRequest\("POST", `\/api\/requirement-centre\/requirements\/\$\{id\}\/still-live`, how \? \{ how \} : \{\}\)/);
  assert.match(piece, /<ConfirmHowDialog /);
  assert.match(piece, /l\.list === "older" \? "Older · " : ""/);
});

test('the deal page names the requirement it answers; a joint agent gets none', () => {
  const feed = read('server/deal-page.ts');
  const fn = feed.slice(feed.indexOf('async function requirementsFor'), feed.indexOf('export async function buildDealPage'));
  assert.match(fn, /if \(ctx\.viewer === "joint_agent"\) return \[\];/);
  assert.match(fn, /WHERE r\.deal_id = \$1/);
  // The state for BGP staff only; a client reads what it is and its own date.
  assert.match(fn, /ctx\.viewer === "staff" \? \{ stateLabel: live\.stateLabel, dateLine: live\.dateLabel \} : \{ dateLine: requirementReason\(row\)\.clientText \}/);
  assert.doesNotMatch(fn, /\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b/);
  assert.match(feed, /letting: lettingSummary, checklist, tasks, requirements,/);
  const page = read('client/src/components/deal-detail.tsx');
  assert.match(page, panelLink('r.id'));
  assert.match(page, /data-testid="deal-requirements"/);
});
