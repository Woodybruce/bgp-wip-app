// The joint agent's checks (Woody, 22 November 2026: "Let's get the app to
// follow HMRC rules and also send them an email so they can load everything
// up or email the aml? If they email or upload it can we then upload it and
// check it in the app?"). Source guards; the rules are tested in
// server/joint-agent-checks.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("every joint agent route is BGP staff's, signed in as themselves, and the router is mounted", () => {
  const s = read("server/joint-agent-checks.ts");
  const routes = [...s.matchAll(/jointAgentRouter\.(get|post)\("([^"]+)"/g)].map(m => m[2]);
  assert.deepEqual(routes.sort(), [
    "/api/deals/:id/joint-agent-checks", "/api/deals/:id/joint-agent-checks", "/api/deals/:id/joint-agent-checks/:ref/chase",
    "/api/deals/:id/joint-agent-checks/:ref/reliance.pdf", "/api/deals/:id/joint-agent-checks/read", "/api/deals/:id/joint-agent-checks/upload",
  ].sort());
  for (const block of s.split(/jointAgentRouter\.(?:get|post)\(/).slice(1)) {
    assert.match(block.slice(0, 600), /await staffMe\(req\)/, block.slice(0, 80));
  }
  // The upload knows who it is before multer reads a file.
  assert.match(s, /"\/api\/deals\/:id\/joint-agent-checks\/upload", signedIn, async \(req: Request, res: Response, next: NextFunction\) => \{\s*\/\/ Who it is before multer reads a file\.\s*const me = await staffMe\(req\)/);
  assert.match(read("server/index.ts"), /app\.use\(jointAgentRouter\);/);
});

test("the reader is Anthropic, called directly with a forced tool, under a daily allowance, and sent the file alone", () => {
  const s = read("server/joint-agent-checks.ts");
  assert.match(s, /getAnthropicClient\(true\)\.messages\.create\(/);
  assert.match(s, /tool_choice: \{ type: "tool", name: JOINT_FILE_TOOL\.name \}/);
  assert.match(s, /claimDailyRead\(USAGE_KEY, jointReaderDailyCap\(\)\)/);
  assert.match(s, /process\.env\.JOINT_AGENT_READER_DAILY_CAP/);
  assert.match(s, /\[\.\.\.parts, \{ type: "text", text: "Read this document\." \}\]/);
  assert.doesNotMatch(s, /callClaude\(/);
});

test("a reading and the joint agent's agreement change only their own key of the request", () => {
  const s = read("server/joint-agent-checks.ts");
  assert.match(s, /jsonb_set\(request, '\{jointAgent,readings\}'/);
  const portal = read("server/aml-portal.ts");
  assert.match(portal, /jsonb_set\(request, '\{jointAgent,reliance\}', \$2::jsonb\)/);
  assert.match(portal, /jsonb_set\(request, '\{openedAt\}', to_jsonb\(\$2::text\)\)/);
});

test("the joint agent's request is never the party's own client checks", () => {
  assert.match(read("server/kyc-people.ts"), /COALESCE\(request->>'audience', 'client'\) <> 'joint_agent' ORDER BY created_at/);
  assert.match(read("server/deal-party-aml.ts"), /AND COALESCE\(request->>'audience', 'client'\) <> 'joint_agent' LIMIT 1/);
  assert.match(read("server/kyc-red-flags.ts"), /AND COALESCE\(request->>'audience', 'client'\) <> 'joint_agent'/);
  const portal = read("server/aml-portal.ts");
  assert.match(portal, /is_test IS NOT TRUE AND \$\{NOT_JOINT_SQL\(\)\} ORDER BY created_at DESC/);
  assert.match(portal, /if \(!row\.company_id \|\| row\.is_test \|\| !row\.request \|\| row\.request\.person \|\| isJointRequest\(row\.request\)\) return null;/);
  // The joint agent's page cannot hand out the party's owners' links.
  assert.match(portal, /if \(row\.is_test \|\| request\.person \|\| isJointRequest\(request\) \|\| request\.kind !== "company" \|\| !row\.company_id\)/);
  const board = read("server/aml-dashboard.ts");
  assert.match(board, /const partyTokens = allTokens\.filter\(\(t: any\) => !isJoint\(t\)\);/);
});

test("a reply by email is filed from the address asked, or a colleague at the same firm, never a free mail service", () => {
  const portal = read("server/aml-portal.ts");
  // Also a request sent through the party's own agent (23 November 2026).
  assert.match(portal, /const sameFirm = \(isJointRequest\(row\.request\) \|\| !!viaAgent\) && sameFirmDomain\(from, cleanEmail\(row\.contact_email\)\);/);
  assert.match(portal, /const FREE_MAIL = new Set\(\["gmail\.com"/);
  assert.match(portal, /return !!da && da === db && !FREE_MAIL\.has\(da\);/);
});

test("Not required on a joint agent's party follows HMRC: a record on a sale, never on a letting in scope", () => {
  const route = read("server/deal-party-aml.ts");
  assert.match(route, /notRequiredInput\(req\.body, \{ rule: party\.jointRule, requests: await jointRequestsForRecord\(pool, party\.dealId, party\.brandId\)/);
  assert.match(route, /asked_on, asked_how, asked_whom, asked_outcome, joint_ref/);
  assert.match(read("server/index.ts"), /ALTER TABLE kyc_party_exemptions ADD COLUMN IF NOT EXISTS asked_outcome text/);
  // A mark that no longer counts is not honoured anywhere loadNotRequired is read.
  assert.match(read("server/aml-policy.ts"), /lapsed/);
});

test("the reliance is recorded by the officers, with the joint agent's agreement as the firm's letter", () => {
  const route = read("server/deal-party-aml.ts");
  assert.match(route, /router\.post\("\/api\/deals\/:id\/parties\/:role\/reliance", deciderFirst, takeFiles,/);
  assert.match(route, /const joint = await jointRelianceForRecord\(pool, party\.dealId, party\.brandId, jointRef\);/);
  assert.match(route, /const filed = jointPdf \? \[jointPdf, \.\.\.entries\] : entries;/);
});

test("the AML box carries the Joint agent line and its Next step", () => {
  const box = read("client/src/components/deal-aml-status.tsx");
  // Any party BGP does not act for: the joint agent, or its own agent with the client checks to pass on (23 November 2026).
  assert.match(box, /label="Joint agent" quiet \/>/);
  assert.match(box, /label=\{askAgentLabel\(askParty\)\}/);
  assert.match(box, /const askParty = jointAskable\(jointQ\.data, cp\.id\);/);
  assert.match(box, /joint: jointBoxFacts\(jointQ\.data, cp\.id\),/);
  assert.match(box, /case "joint": return <Button/);
  const page = read("client/src/pages/kyc-upload.tsx");
  assert.match(page, /if \(view\.joint\) return <JointAgentPage/);
});

test("what is missing is chased every three days by the daily job, never for a decided party, and stops with a note", () => {
  const s = read("server/joint-agent-checks.ts");
  assert.match(s, /settled: gaps\.length \? await partySettled\(db, row\) : true/);
  assert.match(s, /if \(!portal\.clientChecksOn\(\) \|\| !jointWorkingDay\(now\)\) return out;/);
  assert.match(s, /jointAgentChaseStoppedEmail\(/);
  // Only the chase's keys of the request: a file's reading may be saved meanwhile.
  assert.match(s, /jsonb_set\(jsonb_set\(request, '\{jointAgent,chases\}'/);
  const portal = read("server/aml-portal.ts");
  assert.match(portal, /AND expires_at > now\(\) AND COALESCE\(reminders_sent, 0\) < \$1 AND \$\{NOT_JOINT_SQL\(\)\}/);
  assert.match(portal, /m\.chaseJointAgents\(now\)/);
});

test("a file not read yet is read before the chase, and nothing it may hold is asked for", () => {
  const s = read("server/joint-agent-checks.ts");
  // The daily chase reads a waiting file first, then works out what to ask for.
  assert.match(s, /if \(await readPendingFiles\(db, row, files, now\)\) \{/);
  // The deal says it is being chased only when there is something to ask them for.
  assert.match(s, /shown\.sentAt && !shown\.chaseStoppedAt && theirs\.length\)/);
  assert.match(s, /return \{ \.\.\.not\("failed", prepared\.unreadable\), unreadable: true \};/);
});

test("the reliance waits for their files to cover everyone, unless an officer says how they checked by hand", () => {
  const route = read("server/deal-party-aml.ts");
  assert.match(route, /if \(joint\.gaps\.length\) \{/);
  assert.match(route, /if \(handNote\.length < JOINT_BY_HAND_MIN\) \{\s*return res\.status\(409\)/);
  assert.match(route, /asked_missing, asked_note\)/);
  assert.match(read("server/index.ts"), /ALTER TABLE kyc_party_exemptions ADD COLUMN IF NOT EXISTS asked_missing text/);
});

// Woody, 23 November 2026: "the reliance on the joint agent doesnt work we cant agree reliance. What we need is an
// email ... saying we are finalising the KYC on this joint agent transaction and need you to upload or email back the
// following files", and "should also be able to reply with the documents".
test("the joint agent is asked for the documents, never to agree reliance; Joint agent under Other ways sends the email", () => {
  assert.match(read("shared/joint-agent-checks.ts"), /export const JOINT_ASKS_RELIANCE = false;/);
  assert.match(read("server/joint-agent-checks.ts"), /reliance: JOINT_ASKS_RELIANCE && isLettingRule\(request\.jointAgent\?\.rule\)/);
  assert.match(read("server/aml-portal.ts"), /terms: letting && joint\?\.reliance \? jointRelianceTerms\(request\.partyName\) : null,/);
  const box = read("client/src/components/deal-aml-status.tsx");
  assert.doesNotMatch(box, /<RelianceButton/, "no reliance under Other ways");
  assert.match(box, /<AskJointAgentButton dealId=\{dealId\} view=\{jointQ\.data\} party=\{askParty\} label="Joint agent" quiet \/>/);
  const email = read("shared/kyc-request.ts");
  assert.match(email, /Finalising our KYC on /);
  assert.match(email, /Or reply to this email with the documents attached/);
});
