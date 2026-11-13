import test from "node:test";
import assert from "node:assert/strict";
import { restrictedLandsecApiRule } from "../shared/landsec";

const U = "36c81e04-6f16-4951-8ea7-cbaf16b83741";
const X = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

// method, path, joint agent, asset manager
type Row = [string, string, "allow" | "deny", "allow" | "deny"];

const OPENED_FOR_JOINT_AGENTS: Row[] = [
  // 1. Share with a brand
  ["GET", `/api/unit-share/${U}/options`, "allow", "deny"],
  ["GET", `/api/unit-share/${U}/history`, "allow", "deny"],
  ["POST", `/api/unit-share/${U}/send`, "allow", "deny"],
  ["GET", `/api/unit-share/pack/${X}/file`, "allow", "deny"],
  // 2. Add a unit
  ["POST", "/api/available-units", "allow", "deny"],
  // 3. One unit: read and change
  ["GET", `/api/available-units/${U}`, "allow", "deny"],
  ["PATCH", `/api/available-units/${U}`, "allow", "deny"],
  // 4. Interest and viewings on a unit
  ["GET", `/api/available-units/${U}/interest`, "allow", "deny"],
  ["POST", `/api/available-units/${U}/interest`, "allow", "deny"],
  ["DELETE", `/api/available-units/interest/${X}`, "allow", "deny"],
  ["GET", `/api/available-units/${U}/viewings`, "allow", "deny"],
  ["POST", `/api/available-units/${U}/viewings`, "allow", "deny"],
  ["PATCH", `/api/available-units/viewings/${X}`, "allow", "deny"],
  ["DELETE", `/api/available-units/viewings/${X}`, "allow", "deny"],
  // 5. Offers on a unit
  ["GET", `/api/available-units/${U}/offers`, "allow", "deny"],
  ["POST", `/api/available-units/${U}/offers`, "allow", "deny"],
  ["PATCH", `/api/available-units/offers/${X}`, "allow", "deny"],
  ["DELETE", `/api/available-units/offers/${X}`, "allow", "deny"],
  // 7. The viewings calendar
  ["GET", "/api/leasing-viewings", "allow", "deny"],
  ["GET", "/api/leasing-viewings/options", "allow", "deny"],
  ["GET", "/api/leasing-viewings/report", "allow", "deny"],
  ["PATCH", `/api/leasing-viewings/${X}`, "allow", "deny"],
  ["POST", `/api/leasing-viewings/${X}/units`, "allow", "deny"],
  ["POST", `/api/leasing-viewings/${X}/offers/${U}/confirm`, "allow", "deny"],
  // 8. Their own tasks
  ["GET", "/api/tasks", "allow", "deny"],
  ["PATCH", `/api/tasks/${X}`, "allow", "deny"],
];

const OPEN_TO_BOTH: Row[] = [
  ["GET", "/api/landsec/home", "allow", "allow"],
  ["GET", "/api/landsec/tracker", "allow", "allow"],
  ["GET", `/api/landsec/unit/${U}`, "allow", "allow"],
  ["GET", "/api/heartbeat", "allow", "allow"],
  ["GET", "/api/notifications", "allow", "allow"],
  ["GET", "/api/users", "allow", "allow"],
  ["GET", "/api/unit-briefs", "allow", "allow"],
  ["POST", "/api/unit-briefs/start", "allow", "allow"],
  ["PATCH", `/api/unit-briefs/${X}`, "allow", "allow"],
  ["POST", `/api/unit-briefs/${X}/targets`, "allow", "allow"],
  ["PATCH", `/api/unit-briefs/targets/${X}`, "allow", "allow"],
  ["DELETE", `/api/unit-briefs/targets/${X}`, "allow", "allow"],
  ["PUT", `/api/unit-briefs/${X}/agent-fee-split`, "allow", "allow"],
  ["POST", `/api/unit-offers/${X}/status`, "allow", "allow"],
  ["POST", `/api/unit-hots/${U}/issue`, "allow", "allow"],
  ["GET", `/api/deal-checklists/${U}`, "allow", "allow"],
  ["GET", `/api/unit-recommendations/${U}`, "allow", "allow"],
  ["GET", `/api/available-units/${U}/brief`, "allow", "allow"],
  ["POST", `/api/available-units/${U}/brief`, "allow", "allow"],
  ["POST", `/api/available-units/${U}/brief/draft-ai`, "allow", "allow"],
  ["GET", `/api/available-units/${U}/files`, "allow", "allow"],
  ["POST", `/api/available-units/${U}/files`, "allow", "allow"],
  ["PATCH", `/api/available-units/files/${X}`, "allow", "allow"],
  ["DELETE", `/api/available-units/files/${X}`, "allow", "allow"],
  ["GET", `/api/plans/${X}/image`, "allow", "allow"],
  ["GET", `/api/properties/${X}/brochures/${U}/file`, "allow", "allow"],
];

const ASSET_MANAGER_ONLY: Row[] = [
  ["GET", `/api/crm/companies/${X}`, "deny", "allow"],
  ["GET", `/api/brands/${X}`, "deny", "allow"],
  ["GET", `/api/brand/${X}/preparation`, "deny", "allow"],
  ["GET", `/api/client/crm/brands`, "deny", "allow"],
  ["GET", `/api/covenant/by-crm/${X}`, "deny", "allow"],
  ["GET", "/api/landsec/brand-cases", "deny", "allow"],
  ["GET", `/api/landsec/brand-case/${X}`, "deny", "allow"],
  ["POST", `/api/unit-briefs/${X}/generate-document`, "deny", "allow"],
];

const CLOSED_TO_BOTH: Row[] = [
  // The unit list, the firm-wide aggregates, the unit search
  ["GET", "/api/available-units", "deny", "deny"],
  ["GET", "/api/available-units/", "deny", "deny"],
  ["GET", "/api/available-units/all-files", "deny", "deny"],
  ["GET", "/api/available-units/all-viewings", "deny", "deny"],
  ["GET", "/api/available-units/all-viewings-counts", "deny", "deny"],
  ["GET", "/api/available-units/all-offers", "deny", "deny"],
  ["GET", "/api/available-units/all-offers-counts", "deny", "deny"],
  ["GET", "/api/available-units/all-interest", "deny", "deny"],
  ["GET", "/api/available-units/all-interest-counts", "deny", "deny"],
  ["GET", "/api/letting/unit-search", "deny", "deny"],
  // Deleting a unit, and the other verbs on it
  ["DELETE", `/api/available-units/${U}`, "deny", "deny"],
  ["PUT", `/api/available-units/${U}`, "deny", "deny"],
  ["POST", `/api/available-units/${U}`, "deny", "deny"],
  ["PATCH", "/api/available-units", "deny", "deny"],
  ["PATCH", "/api/available-units/all-files", "deny", "deny"],
  // The deal, the old HOTs routes, brand matching, the info sheet
  ["POST", `/api/available-units/${U}/link-deal`, "deny", "deny"],
  ["POST", `/api/available-units/${U}/ensure-deal`, "deny", "deny"],
  ["POST", `/api/available-units/${U}/create-deal`, "deny", "deny"],
  ["GET", `/api/available-units/${U}/hots`, "deny", "deny"],
  ["PUT", `/api/available-units/${U}/hots`, "deny", "deny"],
  ["GET", `/api/available-units/${U}/hots/pdf`, "deny", "deny"],
  ["POST", `/api/available-units/${U}/hots/populate`, "deny", "deny"],
  ["POST", `/api/available-units/${U}/hots-docx-populate`, "deny", "deny"],
  ["POST", `/api/available-units/${U}/photos-from-brochure`, "deny", "deny"],
  ["POST", `/api/available-units/${U}/info-sheet`, "deny", "deny"],
  ["GET", `/api/available-units/${U}/brand-suggestions`, "deny", "deny"],
  ["GET", `/api/available-units/matches/${U}`, "deny", "deny"],
  ["POST", "/api/available-units/backfill-leasing-schedule", "deny", "deny"],
  ["GET", `/api/available-units/${U}/interest/extra`, "deny", "deny"],
  ["GET", `/api/available-units/${U}/offers/${X}`, "deny", "deny"],
  ["GET", "/api/available-units/files", "deny", "deny"],
  ["GET", "/api/available-units/offers", "deny", "deny"],
  // Viewings: the CRM requirement, and anything not on the list
  ["POST", `/api/leasing-viewings/${X}/requirement`, "deny", "deny"],
  ["POST", "/api/leasing-viewings", "deny", "deny"],
  ["DELETE", `/api/leasing-viewings/${X}`, "deny", "deny"],
  ["GET", `/api/leasing-viewings/${X}`, "deny", "deny"],
  ["POST", "/api/leasing-viewings/options", "deny", "deny"],
  ["PATCH", `/api/leasing-viewings/${X}/units`, "deny", "deny"],
  ["GET", `/api/leasing-viewings/${X}/offers/${U}/confirm`, "deny", "deny"],
  // Tasks: no create, delete, reorder, import or notebook links
  ["POST", "/api/tasks", "deny", "deny"],
  ["DELETE", `/api/tasks/${X}`, "deny", "deny"],
  ["POST", "/api/tasks/reorder", "deny", "deny"],
  ["GET", "/api/tasks/onenote/status", "deny", "deny"],
  ["GET", "/api/tasks/import/onenote/notebooks", "deny", "deny"],
  ["POST", "/api/tasks/import/onenote", "deny", "deny"],
  ["POST", "/api/tasks/import/evernote", "deny", "deny"],
  ["POST", `/api/tasks/${X}/link-onenote`, "deny", "deny"],
  ["DELETE", `/api/tasks/${X}/link-onenote`, "deny", "deny"],
  ["POST", `/api/tasks/${X}/export-evernote`, "deny", "deny"],
  ["POST", "/api/tasks/suggestions/run", "deny", "deny"],
  ["PATCH", `/api/tasks/${X}/link-onenote`, "deny", "deny"],
  // BGP's CRM, deals, ChatBGP, search, correspondence
  ["GET", "/api/crm/contacts", "deny", "deny"],
  ["POST", "/api/crm/contacts", "deny", "deny"],
  // The email a contact was added from opens BGP's mail: staff only.
  ["GET", `/api/crm/contacts/${X}/source-email`, "deny", "deny"],
  ["GET", "/api/crm/deals", "deny", "deny"],
  ["GET", `/api/crm/deals/${X}`, "deny", "deny"],
  ["GET", `/api/crm/deals/${X}/fee-allocations`, "deny", "deny"],
  ["GET", "/api/crm/properties", "deny", "deny"],
  ["GET", "/api/crm/requirements-leasing", "deny", "deny"],
  ["POST", `/api/crm/companies/${X}`, "deny", "deny"],
  ["GET", "/api/search", "deny", "deny"],
  ["POST", "/api/chatbgp/chat", "deny", "deny"],
  ["GET", "/api/chat/threads", "deny", "deny"],
  ["GET", `/api/activity/brand/${X}`, "deny", "deny"],
  ["GET", `/api/interactions/company/${X}`, "deny", "deny"],
  ["GET", "/api/microsoft/calendar/events", "deny", "deny"],
  ["GET", "/api/accounts", "deny", "deny"],
  ["GET", "/api/dashboard/stats", "deny", "deny"],
  ["GET", "/api/tenancy-schedule", "deny", "deny"],
  ["GET", "/api/leasing-schedule", "deny", "deny"],
  ["POST", "/api/users", "deny", "deny"],
  ["GET", `/api/users/${X}`, "deny", "deny"],
  ["GET", "/api/unit-share", "deny", "deny"],
  ["GET", "/api/unit-shares", "deny", "deny"],
  ["GET", "/api/tasks-export", "deny", "deny"],
];

const check = (rows: Row[]) => {
  for (const [method, path, jointAgent, assetManager] of rows) {
    assert.equal(restrictedLandsecApiRule("joint_agent", method, path), jointAgent, `joint agent ${method} ${path}`);
    assert.equal(restrictedLandsecApiRule("asset_manager", method, path), assetManager, `asset manager ${method} ${path}`);
  }
};

test("a joint agent reaches the letting work, an asset manager gets nothing new", () => check(OPENED_FOR_JOINT_AGENTS));
test("what both restricted roles already reached is unchanged", () => check(OPEN_TO_BOTH));
test("brand pages and brand cases are the asset manager's only; a joint agent does not make the Targeting Brief document", () => check(ASSET_MANAGER_ONLY));
test("everything else is refused for both", () => check(CLOSED_TO_BOTH));

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
