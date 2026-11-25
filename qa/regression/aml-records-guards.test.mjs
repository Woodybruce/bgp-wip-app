// The AML items built on 19 November 2026 (Woody: "Go ahead and build", on
// the list left out of the AML policy build): the EU sanctions list, the
// Register of Overseas Entities, agents on HMRC's register, the AML register
// (suspicions to the NCA, sanctions to OFSI, discrepancies, unregistered
// agents), training records and the five-year deletion. Source guards; the
// rules are tested in server/aml-records.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const index = read('server/index.ts');

test('every new address is outside the retired /api/aml/ and on no client gateway list', () => {
  const retired = /^\/api\/(aml|kyc-clouseau|sanctions|comply-advantage)(\/|$)/;
  for (const path of ['/api/aml-register', '/api/aml-register/mine', '/api/aml-training/me', '/api/aml-retention/preview', '/api/agent-aml/company/x', '/api/deals/1/agents-aml']) {
    assert.equal(retired.test(path), false, path);
  }
  const allowed = index.slice(index.indexOf('const CLIENT_ALLOWED_API = ['), index.indexOf('const CLIENT_ALLOWED_WRITES = [') + 6000);
  for (const prefix of ['/api/aml-register', '/api/aml-training', '/api/aml-retention', '/api/agent-aml']) {
    assert.ok(!allowed.includes(`"${prefix}`), prefix);
  }
  for (const r of ['amlRegisterRouter', 'amlTrainingRouter', 'agentAmlRouter', 'amlRetentionRouter']) assert.match(index, new RegExp(`app\\.use\\(${r}\\);`), r);
  for (const m of ['AML_REGISTER_MIGRATIONS', 'AML_TRAINING_MIGRATIONS', 'AGENT_AML_MIGRATIONS', 'AML_RETENTION_LOG_MIGRATIONS']) assert.match(index, new RegExp(`\\.\\.\\.${m},`), m);
});

test('the register is read and decided only by the officers, and nothing about an entry reaches the KYC history or an email', () => {
  const reg = read('server/aml-register.ts');
  for (const route of ['router.get("/api/aml-register",', 'router.patch("/api/aml-register/:id"']) {
    const at = reg.indexOf(route);
    assert.ok(at > 0, route);
    assert.match(reg.slice(at, at + 700), /if \(!actor\.isMlro\) return res\.status\(403\)/, route);
  }
  // Raising and your own list: BGP staff signed in as themselves.
  for (const route of ['router.post("/api/aml-register",', 'router.get("/api/aml-register/mine"']) {
    const at = reg.indexOf(route);
    assert.match(reg.slice(at, at + 300), /const me = await staffMe\(req\);\n    if \(!me\) return res\.status\(403\)/, route);
  }
  // No company audit line (the KYC history is read by every BGP login).
  assert.doesNotMatch(reg, /kyc_audit_log|kycCompanyAudit/);
  // The reporter's own view carries no decision, reference or outcome.
  assert.match(reg, /res\.json\(\{ entries: rows\.map\(reporterView\) \}\)/);
  // The officers' email says a report is waiting, never what it says.
  const req = read('shared/kyc-request.ts');
  const email = req.slice(req.indexOf('export function amlRegisterNoticeEmail'), req.indexOf('// The message an agent sends from their own WhatsApp'));
  assert.match(email, /ctx: \{ raisedBy: string \| null; link: string; sentFrom: string \}/);
  assert.match(email, /What it is about is not in this email/);
});

test('training is recorded by the officers and admins; each person confirms reading the policy for themselves', () => {
  const t = read('server/aml-training.ts');
  for (const route of ['router.get("/api/aml-training",', 'router.post("/api/aml-training",', 'router.delete("/api/aml-training/:id"']) {
    const at = t.indexOf(route);
    assert.ok(at > 0, route);
    assert.match(t.slice(at, at + 500), /if \(!\(await managesTraining\(req, me\)\)\) return res\.status\(403\)/, route);
  }
  const read_ = t.slice(t.indexOf('router.post("/api/aml-training/me/read-policy"'), t.indexOf('router.get("/api/aml-training/person/:userId"'));
  assert.match(read_, /WHERE user_id = \$1 AND training_type = 'policy_read' AND title = \$2/);
  assert.match(read('client/src/pages/hr.tsx'), /value="aml-training"[\s\S]{0,400}AmlTrainingPanel userId=\{String\(person\.id\)\} isOwn=\{isOwn\}/);
});

test('the five-year deletion runs only when an officer applies their own preview, never by itself', () => {
  const r = read('server/aml-records-retention.ts');
  for (const route of ['router.post("/api/aml-retention/preview"', 'router.post("/api/aml-retention/apply"', 'router.get("/api/aml-retention/log"']) {
    const at = r.indexOf(route);
    assert.ok(at > 0, route);
    assert.match(r.slice(at, at + 300), /const me = await officer\(req, res\);\n    if \(!me\) return;/, route);
  }
  const apply = r.slice(r.indexOf('router.post("/api/aml-retention/apply"'), r.indexOf('router.get("/api/aml-retention/log"'));
  assert.match(apply, /!== RETENTION_CONFIRM_WORD/);
  assert.match(apply, /saved\.by !== me\.id/);
  assert.match(apply, /RETENTION_PREVIEW_MINUTES \* 60_000/);
  assert.match(apply, /ids\.filter\(id => !allowed\.has\(id\)\)/);
  // Each item checked again inside its own transaction before anything goes.
  assert.match(r, /const verdict = f \? partyRetention\(f, cutoff\)/);
  assert.match(r, /INSERT INTO aml_deletion_log/);
  // Nothing on a timer or at boot.
  assert.doesNotMatch(r, /setInterval|setTimeout|cron|schedule/i);
  assert.doesNotMatch(index, /previewRetention|applyRetentionItem/);
  for (const f of ['server/scheduler.ts', 'server/jobs.ts']) {
    try { assert.doesNotMatch(read(f), /aml-records-retention|previewRetention|applyRetentionItem/, f); } catch (e) { if (e?.code !== 'ENOENT') throw e; }
  }
});

test('agents: BGP staff record the check, and the deal box lists every agent on the deal', () => {
  const a = read('server/agent-aml.ts');
  for (const route of ['router.get("/api/agent-aml/company/:companyId"', 'router.post("/api/agent-aml/company/:companyId/search"', 'router.put("/api/agent-aml/company/:companyId"', 'router.get("/api/deals/:id/agents-aml"']) {
    const at = a.indexOf(route);
    assert.ok(at > 0, route);
    assert.match(a.slice(at, at + 260), /staffMe\(req\)/, route);
  }
  assert.match(a, /joint_agent_fee_pct/);
  // HMRC's register is read as a stream from the file GOV.UK names, never loaded whole.
  const h = read('server/hmrc-register.ts');
  assert.match(h, /www\.gov\.uk\/api\/content\/guidance\/money-laundering-regulations-supervised-business-register/);
  assert.match(h, /unzipper\.ParseOne\(\/\^content\\\.xml\$\/\)/);
  assert.doesNotMatch(h, /readFile|xlsx/);
  const card = read('client/src/components/deal-aml-status.tsx');
  assert.match(card, /<DealAgentsAml dealId=\{dealId\} bare \/>/);
  // The transaction's own lines in the parties' card and step look (24 November 2026).
  assert.match(card, /\{staffView && data\.counterparties\.length > 0 && \([\s\S]{0,120}<div className=\{`rounded-lg border border-border bg-card px-4 py-1\$\{mirror \? " aml-view-only" : ""\}`\} data-testid="aml-deal-sections"/);
  assert.match(card, /<AmlStep id=\{`aml-\$\{dealId\}-agents`\} testId="aml-section-agents" label="Agents"/);
  // Reporting a concern is in the box's menu for every BGP person (22 November 2026).
  assert.match(card, /<DropdownMenuItem onSelect=\{\(\) => setReport\(true\)\} data-testid="deal-aml-raise-report">Report a concern to the Nominated Officer<\/DropdownMenuItem>/);
  assert.match(card, /\{report && <RaiseReportDialog dealId=\{dealId\} officer=\{officer\} onClose=\{\(\) => setReport\(false\)\} \/>\}/);
  assert.match(read('client/src/components/brand-profile-panel.tsx'), /<AgentAmlCard companyId=\{companyId\} companyName=\{c\.name\} \/>/);
});

test('the EU list is screened beside the UK and US lists, and named as itself', () => {
  const s = read('server/sanctions-screening.ts');
  assert.match(s, /webgate\.ec\.europa\.eu\/fsd\/fsf\/public\/files\/csvFullSanctionsList_1_1/);
  assert.match(s, /loadEuEntries\(\)/);
  assert.match(s, /lists\.push\("the EU consolidated list"\)/);
  const pre = read('server/kyc-prechecks.ts');
  assert.match(pre, /source: sanctionsListCode\(entry\.source\)/);
  assert.doesNotMatch(pre, /entry\.source === "US-OFAC" \? "US" : "UK"/);
  const shared = read('shared/kyc-prechecks.ts');
  assert.doesNotMatch(shared, /\? "UK Sanctions List" : "US OFAC list"/);
});

test('an overseas party is looked for on the Register of Overseas Entities when it has no UK number', () => {
  const pre = read('server/kyc-prechecks.ts');
  assert.match(pre, /if \(!number && !isPublicBody && subjectKind === "company" && process\.env\.COMPANIES_HOUSE_API_KEY\) \{\n    const names = /);
  assert.match(pre, /company_type=registered-overseas-entity/);
  assert.match(pre, /\.\.\.\(p\.is_sanctioned === true \? \{ sanctioned: true \} : \{\}\)/);
  // A busy Companies House is rethrown, so the check counts as unfinished.
  assert.match(pre, /e\?\.name === "ChBusyError"/);
});
