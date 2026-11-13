import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RESTRICTED_LANDSEC_ROLES, restrictedLandsecApiRule, landsecBriefSignerOnly } from "../shared/landsec";

const U = "36c81e04-6f16-4951-8ea7-cbaf16b83741";
const X = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

// The gateway rule is asked for a joint agent only. An asset manager is a
// full Landsec login (Woody, 2026-11-13: "asset managers and leasing landsec
// should be the same"): it is not a restricted role, so the ordinary client
// gateway decides for it and this list never does.
// method, path, joint agent
type Row = [string, string, "allow" | "deny"];

const OPENED_FOR_JOINT_AGENTS: Row[] = [
  // 1. Share with a brand
  ["GET", `/api/unit-share/${U}/options`, "allow"],
  ["GET", `/api/unit-share/${U}/history`, "allow"],
  ["POST", `/api/unit-share/${U}/send`, "allow"],
  ["GET", `/api/unit-share/pack/${X}/file`, "allow"],
  // 2. Add a unit
  ["POST", "/api/available-units", "allow"],
  // 3. One unit: read and change
  ["GET", `/api/available-units/${U}`, "allow"],
  ["PATCH", `/api/available-units/${U}`, "allow"],
  // 4. Interest and viewings on a unit
  ["GET", `/api/available-units/${U}/interest`, "allow"],
  ["POST", `/api/available-units/${U}/interest`, "allow"],
  ["DELETE", `/api/available-units/interest/${X}`, "allow"],
  ["GET", `/api/available-units/${U}/viewings`, "allow"],
  ["POST", `/api/available-units/${U}/viewings`, "allow"],
  ["PATCH", `/api/available-units/viewings/${X}`, "allow"],
  ["DELETE", `/api/available-units/viewings/${X}`, "allow"],
  // 5. Offers on a unit
  ["GET", `/api/available-units/${U}/offers`, "allow"],
  ["POST", `/api/available-units/${U}/offers`, "allow"],
  ["PATCH", `/api/available-units/offers/${X}`, "allow"],
  ["DELETE", `/api/available-units/offers/${X}`, "allow"],
  // 7. The viewings calendar
  ["GET", "/api/leasing-viewings", "allow"],
  ["GET", "/api/leasing-viewings/options", "allow"],
  ["GET", "/api/leasing-viewings/report", "allow"],
  ["PATCH", `/api/leasing-viewings/${X}`, "allow"],
  ["POST", `/api/leasing-viewings/${X}/units`, "allow"],
  ["POST", `/api/leasing-viewings/${X}/offers/${U}/confirm`, "allow"],
  // 8. Their own tasks
  ["GET", "/api/tasks", "allow"],
  ["PATCH", `/api/tasks/${X}`, "allow"],
];

const OPEN_ON_THE_SHARED_LIST: Row[] = [
  ["GET", "/api/landsec/home", "allow"],
  ["GET", "/api/landsec/tracker", "allow"],
  ["GET", `/api/landsec/unit/${U}`, "allow"],
  ["GET", "/api/heartbeat", "allow"],
  ["GET", "/api/notifications", "allow"],
  ["GET", "/api/users", "allow"],
  ["GET", "/api/unit-briefs", "allow"],
  ["POST", "/api/unit-briefs/start", "allow"],
  ["PATCH", `/api/unit-briefs/${X}`, "allow"],
  ["POST", `/api/unit-briefs/${X}/targets`, "allow"],
  ["PATCH", `/api/unit-briefs/targets/${X}`, "allow"],
  ["DELETE", `/api/unit-briefs/targets/${X}`, "allow"],
  ["PUT", `/api/unit-briefs/${X}/agent-fee-split`, "allow"],
  ["POST", `/api/unit-offers/${X}/status`, "allow"],
  ["POST", `/api/unit-hots/${U}/issue`, "allow"],
  ["GET", `/api/deal-checklists/${U}`, "allow"],
  ["GET", `/api/unit-recommendations/${U}`, "allow"],
  ["GET", `/api/available-units/${U}/brief`, "allow"],
  ["POST", `/api/available-units/${U}/brief`, "allow"],
  ["POST", `/api/available-units/${U}/brief/draft-ai`, "allow"],
  ["GET", `/api/available-units/${U}/files`, "allow"],
  ["POST", `/api/available-units/${U}/files`, "allow"],
  ["PATCH", `/api/available-units/files/${X}`, "allow"],
  ["DELETE", `/api/available-units/files/${X}`, "allow"],
  ["GET", `/api/plans/${X}/image`, "allow"],
  ["GET", `/api/properties/${X}/brochures/${U}/file`, "allow"],
];

// Brand pages, brand cases and the generated Targeting Brief document.
const NEVER_FOR_A_JOINT_AGENT: Row[] = [
  ["GET", `/api/crm/companies/${X}`, "deny"],
  ["GET", `/api/brands/${X}`, "deny"],
  ["GET", `/api/brand/${X}/preparation`, "deny"],
  ["GET", `/api/client/crm/brands`, "deny"],
  ["GET", `/api/covenant/by-crm/${X}`, "deny"],
  ["GET", "/api/landsec/brand-cases", "deny"],
  ["GET", `/api/landsec/brand-case/${X}`, "deny"],
  ["POST", `/api/unit-briefs/${X}/generate-document`, "deny"],
];

const CLOSED: Row[] = [
  // The unit list, the firm-wide aggregates, the unit search
  ["GET", "/api/available-units", "deny"],
  ["GET", "/api/available-units/", "deny"],
  ["GET", "/api/available-units/all-files", "deny"],
  ["GET", "/api/available-units/all-viewings", "deny"],
  ["GET", "/api/available-units/all-viewings-counts", "deny"],
  ["GET", "/api/available-units/all-offers", "deny"],
  ["GET", "/api/available-units/all-offers-counts", "deny"],
  ["GET", "/api/available-units/all-interest", "deny"],
  ["GET", "/api/available-units/all-interest-counts", "deny"],
  ["GET", "/api/letting/unit-search", "deny"],
  // Deleting a unit, and the other verbs on it
  ["DELETE", `/api/available-units/${U}`, "deny"],
  ["PUT", `/api/available-units/${U}`, "deny"],
  ["POST", `/api/available-units/${U}`, "deny"],
  ["PATCH", "/api/available-units", "deny"],
  ["PATCH", "/api/available-units/all-files", "deny"],
  // The deal, the old HOTs routes, brand matching, the info sheet
  ["POST", `/api/available-units/${U}/link-deal`, "deny"],
  ["POST", `/api/available-units/${U}/ensure-deal`, "deny"],
  ["POST", `/api/available-units/${U}/create-deal`, "deny"],
  ["GET", `/api/available-units/${U}/hots`, "deny"],
  ["PUT", `/api/available-units/${U}/hots`, "deny"],
  ["GET", `/api/available-units/${U}/hots/pdf`, "deny"],
  ["POST", `/api/available-units/${U}/hots/populate`, "deny"],
  ["POST", `/api/available-units/${U}/hots-docx-populate`, "deny"],
  ["POST", `/api/available-units/${U}/photos-from-brochure`, "deny"],
  ["POST", `/api/available-units/${U}/info-sheet`, "deny"],
  ["GET", `/api/available-units/${U}/brand-suggestions`, "deny"],
  ["GET", `/api/available-units/matches/${U}`, "deny"],
  ["POST", "/api/available-units/backfill-leasing-schedule", "deny"],
  ["GET", `/api/available-units/${U}/interest/extra`, "deny"],
  ["GET", `/api/available-units/${U}/offers/${X}`, "deny"],
  ["GET", "/api/available-units/files", "deny"],
  ["GET", "/api/available-units/offers", "deny"],
  // Viewings: the CRM requirement, and anything not on the list
  ["POST", `/api/leasing-viewings/${X}/requirement`, "deny"],
  ["POST", "/api/leasing-viewings", "deny"],
  ["DELETE", `/api/leasing-viewings/${X}`, "deny"],
  ["GET", `/api/leasing-viewings/${X}`, "deny"],
  ["POST", "/api/leasing-viewings/options", "deny"],
  ["PATCH", `/api/leasing-viewings/${X}/units`, "deny"],
  ["GET", `/api/leasing-viewings/${X}/offers/${U}/confirm`, "deny"],
  // Tasks: no create, delete, reorder, import or notebook links
  ["POST", "/api/tasks", "deny"],
  ["DELETE", `/api/tasks/${X}`, "deny"],
  ["POST", "/api/tasks/reorder", "deny"],
  ["GET", "/api/tasks/onenote/status", "deny"],
  ["GET", "/api/tasks/import/onenote/notebooks", "deny"],
  ["POST", "/api/tasks/import/onenote", "deny"],
  ["POST", "/api/tasks/import/evernote", "deny"],
  ["POST", `/api/tasks/${X}/link-onenote`, "deny"],
  ["DELETE", `/api/tasks/${X}/link-onenote`, "deny"],
  ["POST", `/api/tasks/${X}/export-evernote`, "deny"],
  ["POST", "/api/tasks/suggestions/run", "deny"],
  ["PATCH", `/api/tasks/${X}/link-onenote`, "deny"],
  // BGP's CRM, deals, ChatBGP, search, correspondence
  ["GET", "/api/crm/contacts", "deny"],
  ["POST", "/api/crm/contacts", "deny"],
  ["GET", "/api/crm/deals", "deny"],
  ["GET", `/api/crm/deals/${X}`, "deny"],
  ["GET", `/api/crm/deals/${X}/fee-allocations`, "deny"],
  ["GET", "/api/crm/properties", "deny"],
  ["GET", "/api/crm/requirements-leasing", "deny"],
  ["POST", `/api/crm/companies/${X}`, "deny"],
  ["GET", "/api/search", "deny"],
  ["POST", "/api/chatbgp/chat", "deny"],
  ["GET", "/api/chat/threads", "deny"],
  ["GET", `/api/activity/brand/${X}`, "deny"],
  ["GET", `/api/interactions/company/${X}`, "deny"],
  ["GET", "/api/microsoft/calendar/events", "deny"],
  ["GET", "/api/accounts", "deny"],
  ["GET", "/api/dashboard/stats", "deny"],
  ["GET", "/api/tenancy-schedule", "deny"],
  ["GET", "/api/leasing-schedule", "deny"],
  ["POST", "/api/users", "deny"],
  ["GET", `/api/users/${X}`, "deny"],
  ["GET", "/api/unit-share", "deny"],
  ["GET", "/api/unit-shares", "deny"],
  ["GET", "/api/tasks-export", "deny"],
];

const check = (rows: Row[]) => {
  for (const [method, path, jointAgent] of rows) {
    assert.equal(restrictedLandsecApiRule("joint_agent", method, path), jointAgent, `joint agent ${method} ${path}`);
  }
};

test("a joint agent reaches the letting work", () => check(OPENED_FOR_JOINT_AGENTS));
test("what a joint agent already reached is unchanged", () => check(OPEN_ON_THE_SHARED_LIST));
test("a joint agent has no brand pages or brand cases and does not make the Targeting Brief document", () => check(NEVER_FOR_A_JOINT_AGENT));
test("everything else is refused", () => check(CLOSED));

test("only a joint agent is a restricted role: an asset manager is a full Landsec login", () => {
  assert.deepEqual(RESTRICTED_LANDSEC_ROLES, ["joint_agent"]);
  // The rule holds nothing for an asset manager. It is never asked for one
  // (restrictedLandsecApiDecision answers null first); if it ever were, it
  // gives the shared list and nothing of the brand pages it used to open.
  for (const [method, path] of NEVER_FOR_A_JOINT_AGENT.filter(r => !r[1].startsWith("/api/landsec/") && !r[1].startsWith("/api/unit-briefs/"))) {
    assert.equal(restrictedLandsecApiRule("asset_manager", method, path), "deny", `${method} ${path}`);
  }
});

// The role as a label on the older two-signature brief: a role login signs
// its own line only, and that is the one thing an asset manager and a login
// with no role do differently. The unit page hides the other line's button
// from the same rule, so it never offers a press the server refuses.
test("a role login signs its own line of the agreed brief; a login with no role signs either", () => {
  assert.equal(landsecBriefSignerOnly("asset_manager"), "am");
  assert.equal(landsecBriefSignerOnly("leasing_manager"), "leasing");
  for (const role of [null, undefined, "", "joint_agent"]) assert.equal(landsecBriefSignerOnly(role), null, String(role));
  const server = readFileSync(new URL("./landsec-unit.ts", import.meta.url), "utf8");
  assert.match(server, /const only = landsecBriefSignerOnly\(access\.role\);\s+if \(only && role !== only\) return res\.status\(403\)/);
  assert.match(server, /if \(access\.role === "joint_agent"\) return res\.status\(403\)\.json\(\{ error: "Joint agents do not sign the brief" \}\)/);
  const page = readFileSync(new URL("../client/src/pages/landsec-unit.tsx", import.meta.url), "utf8");
  assert.match(page, /signerOnly=\{landsecBriefSignerOnly\(viewer\.role\)\}/);
  assert.match(page, /signerOnly && signerOnly !== role \? null :/);
});

// A joint agent is an outside firm's login. Another role gives it the full
// Landsec view, so that save needs the admin's explicit confirmation, and a
// new login in the panel starts with no role chosen.
test("a joint agent login is not given another role without the admin confirming the full view", () => {
  const access = readFileSync(new URL("./landsec-access.ts", import.meta.url), "utf8");
  const post = access.slice(access.indexOf('app.post("/api/landsec/access"'), access.indexOf('app.delete("/api/landsec/access/:userId"'));
  const guard = post.indexOf('before?.landsec_role === "joint_agent" && role !== "joint_agent" && b.confirmFullView !== true');
  assert.ok(guard > 0, "the guard is in the save");
  // It is checked before the password or the role row is written.
  assert.ok(guard < post.indexOf("UPDATE users SET password"), "before the password change");
  assert.ok(guard < post.indexOf("INSERT INTO landsec_access"), "before the role is saved");
  const panel = readFileSync(new URL("../client/src/components/landsec-access-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /role: "" as LandsecRole \| ""/);
  assert.match(panel, /disabled=\{save\.isPending \|\| !form\.email \|\| !form\.role\}/);
  assert.match(panel, /stored\?\.role === "joint_agent" && form\.role !== "joint_agent"/);
  assert.match(panel, /confirmFullView: true/);
});

test("a unit id must be a unit id: the list and the aggregates cannot be reached as one", () => {
  for (const id of ["all-files", "all-offers", "ALL-VIEWINGS", "interest", "files", "matches", "backfill-leasing-schedule", "x", "36c81e04"]) {
    for (const method of ["GET", "PATCH"]) {
      assert.equal(restrictedLandsecApiRule("joint_agent", method, `/api/available-units/${id}`), "deny", `${method} ${id}`);
    }
    // "interest/<id>" and "files/<id>" are the real per-line routes.
    if (id === "interest" || id === "files") continue;
    for (const sub of ["interest", "viewings", "offers"]) {
      assert.equal(restrictedLandsecApiRule("joint_agent", "GET", `/api/available-units/${id}/${sub}`), "deny", `${id}/${sub}`);
    }
  }
});

test("the method and the case of the path do not open anything", () => {
  assert.equal(restrictedLandsecApiRule("joint_agent", "get", `/API/Available-Units/${U.toUpperCase()}`), "allow");
  assert.equal(restrictedLandsecApiRule("joint_agent", "delete", `/API/Available-Units/${U.toUpperCase()}`), "deny");
  assert.equal(restrictedLandsecApiRule("joint_agent", "HEAD", "/api/available-units"), "deny");
  assert.equal(restrictedLandsecApiRule("joint_agent", "GET", "/api/tasks/"), "allow");
  assert.equal(restrictedLandsecApiRule("joint_agent", "GET", "/api/unit-share/../crm/contacts"), "allow", "under the share prefix: no handler there, never the CRM route");
  assert.equal(restrictedLandsecApiRule("joint_agent", "GET", "/api/crm/contacts/../../unit-share/x"), "deny");
});
