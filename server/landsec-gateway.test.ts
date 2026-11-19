import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import express from "express";
import { RESTRICTED_LANDSEC_ROLES, restrictedLandsecApiRule, routedApiPath, landsecBriefSignerOnly, jointAgentApiDenied } from "../shared/landsec";

const U = "36c81e04-6f16-4951-8ea7-cbaf16b83741";
const X = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

// The gateway rule is asked for a joint agent only. An asset manager is a
// full Landsec login (Woody, 2026-11-13: "asset managers and leasing landsec
// should be the same"): it is not a restricted role, so the ordinary client
// gateway decides for it and this list never does. (Until that day this
// table had a fourth column for an asset manager; its brand reads answered
// "client", on to the ordinary client checks. Every request it makes goes
// through those checks now: qa/regression/client-gateway-path.test.mjs runs
// the real gateway as an asset manager and as a full Landsec login.)
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
  // 8. Comments not yet logged: the list, the count, log it or dismiss it
  ["GET", "/api/letting-suggestions", "allow"],
  ["GET", "/api/letting-suggestions/", "allow"],
  ["GET", "/api/letting-suggestions/count", "allow"],
  ["get", "/API/Letting-Suggestions/Count/", "allow"],
  ["POST", `/api/letting-suggestions/${X}/confirm`, "allow"],
  ["POST", `/api/letting-suggestions/${X}/dismiss`, "allow"],
];

// Comments not yet logged: a joint agent reads the list and the count, and
// marks a suggestion as logged or dismissed. Nothing else under the path, and
// never the admin preview or apply.
const SUGGESTIONS_CLOSED: Row[] = [
  ["POST", "/api/letting-suggestions", "deny"],
  ["DELETE", "/api/letting-suggestions", "deny"],
  ["POST", "/api/letting-suggestions/count", "deny"],
  ["GET", `/api/letting-suggestions/${X}`, "deny"],
  ["DELETE", `/api/letting-suggestions/${X}`, "deny"],
  ["PATCH", `/api/letting-suggestions/${X}`, "deny"],
  ["GET", `/api/letting-suggestions/${X}/confirm`, "deny"],
  ["GET", `/api/letting-suggestions/${X}/dismiss`, "deny"],
  ["PUT", `/api/letting-suggestions/${X}/dismiss`, "deny"],
  ["POST", `/api/letting-suggestions/${X}/reopen`, "deny"],
  ["POST", `/api/letting-suggestions/${X}/confirm/extra`, "deny"],
  ["POST", "/api/letting-suggestions/scan", "deny"],
  ["GET", "/api/admin/letting-suggestions/preview", "deny"],
  ["POST", "/api/admin/letting-suggestions/apply", "deny"],
];

// Their own task list: read it and tick a task (Woody, 2026-11-13: "we need
// each person to have this update their own task list"). The handler behind
// both paths sends only the caller's own tasks at their own schemes and
// takes only a tick. An asset manager has the ordinary client task list.
const OWN_TASKS: Row[] = [
  ["GET", "/api/tasks", "allow"],
  ["GET", "/api/tasks/", "allow"],
  ["get", "/API/Tasks", "allow"],
  ["PATCH", `/api/tasks/${X}`, "allow"],
  ["patch", `/API/TASKS/${X.toUpperCase()}/`, "allow"],
];

const OPEN_ON_THE_SHARED_LIST: Row[] = [
  ["GET", "/api/landsec/home", "allow"],
  ["GET", "/api/landsec/tracker", "allow"],
  ["GET", `/api/landsec/unit/${U}`, "allow"],
  ["GET", "/api/heartbeat", "allow"],
  ["GET", "/api/notifications", "allow"],
  ["GET", "/api/config/maps-key", "allow"],
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
  // Describe the brief in your own words (2026-11-19): the handler checks briefAccess.
  ["POST", "/api/unit-briefs/read-note", "allow"],
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
  ["GET", `/api/crm/companies/${X}/deals`, "deny"],
  ["GET", `/api/crm/companies/${X}/trading-entities`, "deny"],
  ["GET", `/api/brands/${X}`, "deny"],
  ["GET", `/api/brand/${X}/preparation`, "deny"],
  ["GET", `/api/brand/${X}/profile`, "deny"],
  ["GET", `/api/brand/${X}/pack.pdf`, "deny"],
  ["GET", `/api/brand/${X}/suggested-units`, "deny"],
  ["GET", `/api/brand-logo/${X}`, "deny"],
  ["GET", `/api/brand/gallery-image/${X}`, "deny"],
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
  // Tasks: no create, delete, reorder, import or notebook links, and no
  // other verb on the list or on one task
  ["POST", "/api/tasks", "deny"],
  ["PUT", "/api/tasks", "deny"],
  ["PATCH", "/api/tasks", "deny"],
  ["DELETE", "/api/tasks", "deny"],
  ["HEAD", "/api/tasks", "deny"],
  ["GET", `/api/tasks/${X}`, "deny"],
  ["PUT", `/api/tasks/${X}`, "deny"],
  ["POST", `/api/tasks/${X}`, "deny"],
  ["DELETE", `/api/tasks/${X}`, "deny"],
  ["PATCH", `/api/tasks/${X}/status`, "deny"],
  ["GET", "/api/tasks/reorder", "deny"],
  ["GET", "/api/tasks/import/onenote/sections/abc", "deny"],
  ["GET", "/api/tasks/onenote/pages/abc", "deny"],
  ["POST", `/api/tasks/${X}/export-onenote`, "deny"],
  ["POST", `/api/tasks/${X}/link-evernote`, "deny"],
  ["DELETE", `/api/tasks/${X}/link-evernote`, "deny"],
  ["GET", "/api/tasksx", "deny"],
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
  // The email a contact was added from opens BGP's mail: staff only.
  ["GET", `/api/crm/contacts/${X}/source-email`, "deny"],
  ["GET", `/api/crm/deals/${X}/fee-allocations`, "deny"],
  ["GET", "/api/crm/requirements-leasing", "deny"],
  ["POST", `/api/crm/companies/${X}`, "deny"],
  ["GET", "/api/search", "deny"],
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
  // The mapping key the server pays for, and anything else under /api/config
  ["GET", "/api/config/os-key", "deny"],
  ["GET", "/api/config", "deny"],
  ["GET", "/api/config/maps-key-2", "deny"],
  ["POST", "/api/config/os-key", "deny"],
  // Nothing is written on a brand
  ["POST", `/api/brand/${X}/credit-check`, "deny"],
  ["PATCH", `/api/brand/${X}`, "deny"],
  ["PUT", `/api/crm/companies/${X}`, "deny"],
  ["HEAD", `/api/brand/${X}/profile`, "deny"],
  // Adding a brand to the list is a full client login's (and BGP's): a
  // joint agent never makes one, however the address is spelt
  ["POST", "/api/crm/companies", "deny"],
  ["POST", "/API/CRM/Companies/", "deny"],
  // The property page's people and the role at a property
  ["GET", "/api/properties/p1/people", "deny"],
  ["GET", `/api/properties/${X}/people`, "deny"],
  ["PUT", "/api/properties/p1/people", "deny"],
  ["GET", "/api/properties/p1/people/c1/client-role", "deny"],
  ["PUT", "/api/properties/p1/people/c1/client-role", "deny"],
  ["DELETE", "/api/properties/p1/people/c1/client-role", "deny"],
  ["PUT", `/api/properties/${X}/people/${U}/client-role`, "deny"],
];

// Chat for a joint agent (Woody, 2026-11-13: "yes go ahead"). Two rows that
// sat in CLOSED until then moved here: POST /api/chatbgp/chat and
// GET /api/chat/threads. Each address is opened by itself, by method.
// The real Properties and Deals pages (Woody, 2026-11-14: "joint agent can
// do anything other than see brands"): reads only, one record by its id, and
// each handler cuts the answer to the joint agent's schemes.
const REAL_PAGES: Row[] = [
  ["GET", "/api/crm/properties", "allow"],
  ["GET", `/api/crm/properties/${X}`, "allow"],
  ["GET", "/api/crm/deals", "allow"],
  ["GET", `/api/crm/deals/${X}`, "allow"],
  ["GET", `/api/tenancy-schedule/property/${X}`, "allow"],
  ["GET", `/api/tenancy-schedule/property/${X}/links`, "allow"],
  ["GET", `/api/properties/${X}/plans`, "allow"],
  // The plan-led property page (2026-11-14): the unit list, one unit and a plan's outlines, read only.
  ["GET", `/api/properties/${X}/units`, "allow"],
  ["GET", `/api/properties/${X}/units/${X}`, "allow"],
  ["GET", `/api/properties/${X}/units/tracker:${X}`, "allow"],
  ["GET", `/api/plans/${X}/match`, "allow"],
  ["GET", `/api/properties/${X}/brochures`, "allow"],
  ["GET", `/api/properties/${X}/schemes`, "allow"],
  // No writes, no other part of a record, and no record by anything but its id.
  ["PUT", `/api/crm/properties/${X}`, "deny"],
  ["PATCH", `/api/crm/properties/${X}`, "deny"],
  ["POST", "/api/crm/properties", "deny"],
  ["PUT", `/api/crm/deals/${X}`, "deny"],
  ["POST", "/api/crm/deals", "deny"],
  ["DELETE", `/api/crm/deals/${X}`, "deny"],
  ["GET", `/api/crm/deals/${X}/audit`, "deny"],
  ["GET", `/api/crm/deals/${X}/related-emails`, "deny"],
  // The deal page's own reads (18 November 2026): read only; the change log stays closed.
  ["GET", `/api/crm/deals/${X}/page`, "allow"],
  ["GET", `/api/crm/deals/${X}/timeline`, "allow"],
  ["POST", `/api/crm/deals/${X}/page`, "deny"],
  ["PUT", `/api/crm/deals/${X}/timeline`, "deny"],
  ["GET", `/api/crm/deals/${X}/audit-log`, "deny"],
  ["GET", `/api/crm/deals/not-an-id/page`, "deny"],
  ["GET", "/api/crm/deals/wip-badges", "deny"],
  ["GET", "/api/crm/deals/po-numbers", "deny"],
  ["GET", "/api/crm/properties/by-name/bluewater", "deny"],
  ["GET", `/api/crm/properties/${X}/contacts`, "deny"],
  ["GET", "/api/crm/property-tenants", "deny"],
  ["GET", "/api/crm/property-agents", "deny"],
  ["GET", "/api/crm/companies", "deny"],
  ["PUT", `/api/tenancy-schedule/unit/${X}`, "deny"],
  ["GET", `/api/tenancy-schedule/property/${X}/export-excel`, "deny"],
  ["GET", `/api/tenancy-schedule/property/${X}/sharepoint-candidates`, "deny"],
  ["POST", `/api/properties/${X}/plans`, "deny"],
  // A property's page at its schemes goes to the client checks in
  // restrictedLandsecApiDecision (not this rule): the rule itself refuses.
  ["GET", `/api/properties/${X}/people`, "deny"],
  ["POST", `/api/plans/${X}/match/accept`, "deny"],
  ["GET", `/api/properties/${X}/units/x/y`, "deny"],
  ["GET", `/api/properties/${X}/linked-contacts`, "deny"],
  ["GET", `/api/properties/${X}/tasks`, "deny"],
  ["GET", `/api/properties/${X}/ai-targets`, "deny"],
  ["GET", `/api/properties/${X}/asset-brief`, "deny"],
  ["GET", `/api/properties/${X}/news`, "deny"],
  ["GET", `/api/property/${X}/brand-gaps`, "deny"],
  ["GET", "/api/activity-summary", "deny"],
];

const CHAT_OPENED: Row[] = [
  ["GET", "/api/landsec/chat/people", "allow"],
  ["GET", "/api/chat/threads", "allow"],
  ["POST", "/api/chat/threads", "allow"],
  ["GET", `/api/chat/threads/${U}`, "allow"],
  ["DELETE", `/api/chat/threads/${U}`, "allow"],
  ["POST", `/api/chat/threads/${U}/messages`, "allow"],
  ["PUT", `/api/chat/threads/${U}/messages/${X}`, "allow"],
  ["DELETE", `/api/chat/threads/${U}/messages/${X}`, "allow"],
  ["GET", "/api/chat/notifications", "allow"],
  ["GET", "/api/chat/tag-search", "allow"],
  ["POST", "/api/chat/upload", "allow"],
  ["GET", "/api/chat-media/1731500000000-0a1b2c3d4e5f6a7b.pdf", "allow"],
  ["GET", "/api/chatbgp/status", "allow"],
  ["POST", "/api/chatbgp/chat", "allow"],
  ["GET", `/api/chatbgp/threads/${U}/active-run`, "allow"],
  ["POST", `/api/chatbgp/threads/${U}/cancel-run`, "allow"],
];

const CHAT_CLOSED: Row[] = [
  // Renaming, linking and members after a conversation is made
  ["PUT", `/api/chat/threads/${U}`, "deny"],
  ["PATCH", `/api/chat/threads/${U}`, "deny"],
  ["POST", `/api/chat/threads/${U}/members`, "deny"],
  ["DELETE", `/api/chat/threads/${U}/members/${X}`, "deny"],
  ["DELETE", `/api/chat/threads/${U}/members/__chatbgp__`, "deny"],
  ["POST", `/api/chat/threads/${U}/auto-title`, "deny"],
  ["GET", `/api/chat/threads/${U}/media`, "deny"],
  ["POST", `/api/chat/threads/${U}/group-pic`, "deny"],
  ["POST", `/api/chat/threads/${U}/group-pic-from-url`, "deny"],
  // Search and anything across conversations
  ["POST", "/api/chat/project-summary", "deny"],
  ["GET", "/api/chat/search", "deny"],
  ["GET", "/api/chat/threads-tagging", "deny"],
  ["POST", "/api/proxy-image", "deny"],
  ["GET", "/api/chat-drafts", "deny"],
  ["POST", "/api/chat-drafts/x", "deny"],
  // Every other ChatBGP door
  ["POST", "/api/chatbgp/chat-with-files", "deny"],
  ["POST", "/api/chatbgp/excel-chat", "deny"],
  ["POST", "/api/chatbgp/addin-chat", "deny"],
  ["POST", "/api/chatbgp/powerpoint-chat", "deny"],
  ["POST", "/api/chatbgp/excel-tool-result", "deny"],
  ["GET", "/api/chatbgp/excel-session/x", "deny"],
  ["POST", "/api/chatbgp/excel-session/x", "deny"],
  ["GET", "/api/chatbgp", "deny"],
  ["POST", "/api/chatbgp", "deny"],
  ["GET", "/api/chatbgp/threads", "deny"],
  ["GET", `/api/chatbgp/threads/${U}`, "deny"],
  ["GET", "/api/knowledge-base", "deny"],
  ["GET", "/api/chatbgp-learnings", "deny"],
  ["GET", "/api/favorite-instructions", "deny"],
  ["GET", "/api/search", "deny"],
  // The wrong method on an opened address
  ["GET", "/api/chatbgp/chat", "deny"],
  ["PUT", "/api/chatbgp/chat", "deny"],
  ["POST", "/api/chatbgp/status", "deny"],
  ["POST", "/api/chat/tag-search", "deny"],
  ["POST", "/api/chat/notifications", "deny"],
  ["GET", "/api/chat/upload", "deny"],
  ["DELETE", "/api/chat/threads", "deny"],
  ["PUT", "/api/chat/threads", "deny"],
  ["HEAD", "/api/chat/threads", "deny"],
  ["HEAD", `/api/chat/threads/${U}`, "deny"],
  ["HEAD", "/api/chat/tag-search", "deny"],
  ["HEAD", "/api/chat-media/a.pdf", "deny"],
  ["HEAD", "/api/chatbgp/status", "deny"],
  ["GET", `/api/chat/threads/${U}/messages`, "deny"],
  ["PATCH", `/api/chat/threads/${U}/messages/${X}`, "deny"],
  ["POST", `/api/chat/threads/${U}/messages/${X}`, "deny"],
  ["POST", `/api/chatbgp/threads/${U}/active-run`, "deny"],
  ["GET", `/api/chatbgp/threads/${U}/cancel-run`, "deny"],
  ["POST", "/api/chat-media/a.pdf", "deny"],
  ["DELETE", "/api/chat-media/a.pdf", "deny"],
  // An address that only looks like an opened one
  ["POST", `/api/chat/threads/${U}/messages/${X}/x`, "deny"],
  ["DELETE", `/api/chat/threads/${U}/messages/${X}/x`, "deny"],
  ["GET", "/api/chat/threads/not-a-thread-id", "deny"],
  ["GET", "/api/chat/threads/search", "deny"],
  ["POST", "/api/chat/threads/x/messages", "deny"],
  ["PUT", `/api/chat/threads/${U}/messages/x`, "deny"],
  ["GET", "/api/chat-media/a/b", "deny"],
  ["GET", "/api/chat-media", "deny"],
  ["GET", "/api/chat/threadsx", "deny"],
  ["GET", "/api/chat", "deny"],
  ["POST", "/api/chatbgp/chatx", "deny"],
  ["POST", "/api/chatbgp/chat/x", "deny"],
  ["GET", "/api/chatbgp/threads/x/active-run", "deny"],
  ["GET", `/api/chatbgp/threads/${U}/active-run/x`, "deny"],
];

const check = (rows: Row[]) => {
  for (const [method, path, jointAgent] of rows) {
    assert.equal(restrictedLandsecApiRule("joint_agent", method, path), jointAgent, `joint agent ${method} ${path}`);
  }
};

test("a joint agent reaches the letting work", () => check(OPENED_FOR_JOINT_AGENTS));
test("what a joint agent already reached is unchanged", () => check(OPEN_ON_THE_SHARED_LIST));
test("a joint agent reads its own task list and ticks a task, and nothing else on it", () => check(OWN_TASKS));
test("a joint agent has no brand pages or brand cases and does not make the Targeting Brief document", () => check(NEVER_FOR_A_JOINT_AGENT));
test("everything else is refused", () => check(CLOSED));
test("comments not yet logged: only the list, the count, confirm and dismiss", () => check(SUGGESTIONS_CLOSED));
test("the real Properties and Deals pages: reads of its schemes' records, nothing else", () => check(REAL_PAGES));
test("chat: a joint agent reaches its conversations and its own ChatBGP chat", () => check(CHAT_OPENED));
test("chat: every other chat and ChatBGP address stays closed to a joint agent", () => check(CHAT_CLOSED));
// Woody, 2026-11-14: "log in for people from landsec with access only to their
// properties and the same for joint agents. The only difference is the lack of
// access to the brands page". Since then NO role is a restricted role
// (RESTRICTED_LANDSEC_ROLES is empty): a joint agent is a Landsec login at its
// own schemes, and its difference is two lists in shared/landsec.ts. What
// restrictedLandsecApiRule opens stays open (its own chat addresses among
// them), jointAgentApiDenied refuses brand pages, BGP's records and every
// other chat door, and everything else goes to the ordinary client checks.
// (Until that day these two tests expected ["joint_agent"].)
test("chat: the rule is asked for a joint agent only, and every chat door it does not open is shut", () => {
  assert.deepEqual(RESTRICTED_LANDSEC_ROLES, []);
  for (const [method, path, jointAgent] of [...CHAT_OPENED, ...CHAT_CLOSED]) {
    // The chat, ChatBGP and chat-media addresses: any other row on those lists (an image proxy) goes to the client checks.
    if (jointAgent === "allow" || !/^\/api\/(chat|chatbgp|chat-media)(\/|$)/.test(path)) continue;
    assert.equal(jointAgentApiDenied(method, path), true, `${method} ${path} is not open to a joint agent, so it must be refused`);
  }
  // An asset manager is never asked the rule: the ordinary client gateway decides every chat address for it.
});

test("no role is a restricted role: a joint agent's difference is the deny list, an asset manager is a full Landsec login", () => {
  assert.deepEqual(RESTRICTED_LANDSEC_ROLES, []);
  // Brand pages and the hub, a company record, contacts, the CRM plan, landlord records, brand cases, the
  // correspondence log, the generated Targeting Brief, a requirement from a viewing, deleting a unit.
  for (const [method, path] of [["GET", "/api/brand/b1/profile"], ["GET", "/api/brands/hub"], ["GET", "/api/brand-crm/plan"], ["GET", "/api/brand-pack/b1"],
    ["GET", "/api/covenant/by-crm/b1"], ["GET", "/api/crm/companies/b1"], ["PUT", "/api/crm/companies/b1"], ["GET", "/api/crm/contacts"], ["GET", "/api/crm/contacts/c1"],
    ["GET", "/api/crm/engagement"], ["GET", "/api/crm/landlords/l1/team"], ["GET", "/api/interactions/company/b1"], ["GET", "/api/landsec/brand-case/b1"],
    ["POST", "/api/unit-briefs/u1/generate-document"], ["POST", "/api/leasing-viewings/v1/requirement"], ["DELETE", "/api/available-units/u1"]] as const) {
    assert.equal(jointAgentApiDenied(method, path), true, `${method} ${path}`);
  }
  // What it is not refused goes to the ordinary client checks, cut to its schemes. The company LIST is one of
  // those on purpose: a brand picker reads it (qa/regression/client-gateway-path.test.mjs pins the 200).
  for (const [method, path] of [["GET", "/api/crm/companies"], ["GET", "/api/crm/deals"], ["GET", "/api/crm/properties"], ["PATCH", "/api/available-units/u1"], ["GET", "/api/activity-summary"]] as const) {
    assert.equal(jointAgentApiDenied(method, path), false, `${method} ${path}`);
  }
  // The rule holds nothing for an asset manager. It is never asked for one
  // (restrictedLandsecApiDecision answers null first); if it ever were, it
  // gives the shared list and nothing of the brand pages it used to open.
  for (const [method, path] of NEVER_FOR_A_JOINT_AGENT.filter(r => !r[1].startsWith("/api/landsec/") && !r[1].startsWith("/api/unit-briefs/"))) {
    assert.equal(restrictedLandsecApiRule("asset_manager", method, path), "deny", `${method} ${path}`);
  }
});

// Reports (Woody, 2026-11-19; who runs them: "yes landsec and BGP"). A joint
// agent runs none: the index and every export are refused before a handler
// runs, and the handler refuses the role again (server/landsec-reports.ts).
test("a joint agent is refused the reports index and every report", () => {
  for (const path of ["/api/landsec/reports", "/api/landsec/reports/", "/api/landsec/reports/tenancy-schedule", "/api/landsec/reports/portfolio?from=2026-08&to=2026-10",
    "/API/Landsec/Reports/asset-profile", "/api/landsec/reports/anything/else"]) {
    for (const method of ["GET", "HEAD", "POST"]) {
      assert.equal(restrictedLandsecApiRule("joint_agent", method, path), "deny", `${method} ${path}: never on the list a joint agent reaches`);
      assert.equal(jointAgentApiDenied(method, path), true, `${method} ${path}`);
    }
  }
  // Nothing else under /api/landsec/ is caught by the reports line.
  for (const path of ["/api/landsec/reports-old", "/api/landsec/report", "/api/landsec/home", "/api/landsec/deals"]) assert.equal(jointAgentApiDenied("GET", path), false, path);
});

// The board report's market report (Woody, 2026-11-19): read, save and draft
// sit under the reports address, so the same two lines refuse a joint agent.
test("a joint agent is refused the board report's market report: reading, saving and drafting", () => {
  for (const [method, path] of [["GET", "/api/landsec/reports/board-report/market?from=2026-08&to=2026-10"], ["PUT", "/api/landsec/reports/board-report/market"],
    ["POST", "/api/landsec/reports/board-report/market/draft"], ["GET", "/api/landsec/reports/board-report"], ["GET", "/api/landsec/reports/board-report-figures"],
    // The market report, its items and what its sections are written from (the team's own posts among them).
    ["GET", "/api/landsec/reports/market-report"], ["GET", "/api/landsec/reports/market-report?format=pptx"], ["GET", "/api/landsec/reports/market-report-items"],
    ["GET", "/api/landsec/reports/board-report/market/material?from=2026-09&to=2026-11"]] as const) {
    assert.equal(restrictedLandsecApiRule("joint_agent", method, path), "deny", `${method} ${path}`);
    assert.equal(jointAgentApiDenied(method, path), true, `${method} ${path}`);
  }
});

// Every leasing requirement is open to a client login since 17 November 2026,
// to read, add and amend (Woody: "keep all requirements open for clients and
// access to amend and add"). A joint agent is another agency with no Brands:
// it is refused every route that hands out requirements or the brand and agent
// contacts on them, by jointAgentApiDenied, so the ordinary client checks
// (which now open them) are never reached for it.
test("a joint agent is refused the requirements, their writes and every route that hands them out", () => {
  const refused: Array<[string, string]> = [
    ["GET", "/api/crm/requirements-leasing"], ["GET", "/api/crm/requirements-leasing/"], ["GET", "/API/CRM/Requirements-Leasing"],
    ["GET", `/api/crm/requirements-leasing/${X}`], ["GET", "/api/crm/requirements-leasing/matches"],
    ["POST", "/api/crm/requirements-leasing"], ["PUT", `/api/crm/requirements-leasing/${X}`], ["PATCH", `/api/crm/requirements-leasing/${X}`],
    ["DELETE", `/api/crm/requirements-leasing/${X}`], ["POST", `/api/crm/requirements-leasing/${X}/landlord-pack`],
    ["POST", "/api/crm/requirements-leasing/agent-audit"], ["GET", "/api/crm/requirements-leasing?status=Active"],
    ["GET", `/api/requirements/matches/${X}`], ["GET", `/api/available-units/matches/${U}`], ["GET", `/api/available-units/${U}/brand-suggestions`],
    ["GET", "/api/requirement-suggestions"], ["POST", `/api/requirement-centre/requirements/${X}/still-live`],
    ["GET", "/api/client/agent-directory"], ["GET", "/api/client/agents-overview"],
  ];
  for (const [method, path] of refused) {
    assert.equal(jointAgentApiDenied(method, path), true, `${method} ${path}`);
    assert.equal(restrictedLandsecApiRule("joint_agent", method, path), "deny", `${method} ${path} is not opened by the rule either`);
  }
  // What it still reads on its own schemes goes on to the client checks: a
  // unit's own record, the viewings calendar, the property page's Brand Gap
  // (cut to PIPnet listings in the handler for a joint agent).
  for (const [method, path] of [["GET", `/api/available-units/${U}`], ["GET", "/api/leasing-viewings/options"], ["GET", `/api/property/${X}/brand-gaps`]] as const) {
    assert.equal(jointAgentApiDenied(method, path), false, `${method} ${path}`);
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

// The gate must read the path the router reads. A "#" in the request line
// ends the path for the router, so the text up to "?" is not that path:
// "/api/available-units/#/files" is routed to the unit list, and read as
// text it looked like one unit's files.
test("the gate judges the path the router matches on, whatever else is in the request line", async () => {
  const app = express();
  const seen: { judged: string; upToQuery: string }[] = [];
  app.use("/api", (req, res, next) => {
    const judged = routedApiPath(req);
    seen.push({ judged, upToQuery: (req.originalUrl || "").split("?")[0].replace(/\/+$/, "") });
    if (restrictedLandsecApiRule("joint_agent", req.method, judged) !== "allow") return res.status(403).json({ refused: true });
    next();
  });
  app.get("/api/available-units", (_req, res) => res.json({ route: "the unit list" }));
  app.get("/api/available-units/:id", (_req, res) => res.json({ route: "one unit" }));
  app.get("/api/available-units/:id/files", (_req, res) => res.json({ route: "one unit's files" }));
  app.get("/api/crm/contacts", (_req, res) => res.json({ route: "the CRM contacts" }));
  // A route with a free first segment (the app has none): what a request
  // read two ways would land on, if the gate let one through.
  app.get("/api/:anything/landsec/home", (_req, res) => res.json({ route: "past the gate" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const port = (server.address() as any).port;
  // http.request sends the path as written; fetch and browsers drop the "#".
  const get = (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", agent: false }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
  try {
    // The real addresses still work.
    assert.match((await get(`/api/available-units/${U}/files`)).body, /one unit's files/);
    assert.match((await get(`/api/available-units/${U}/files?x=1`)).body, /one unit's files/);
    assert.match((await get(`/api/available-units/${U}`)).body, /one unit"/);
    assert.equal(seen[seen.length - 1].judged, `/api/available-units/${U}`);

    // The trick: the router serves the list, so the gate must judge the list.
    seen.length = 0;
    const trick = await get("/api/available-units/#/files");
    assert.equal(seen[0].judged, "/api/available-units");
    assert.equal(seen[0].upToQuery, "/api/available-units/#/files", "the old reading of the same request");
    assert.equal(restrictedLandsecApiRule("joint_agent", "GET", seen[0].upToQuery), "allow", "which the rule lets in as one unit's files");
    assert.equal(trick.status, 403);
    assert.doesNotMatch(trick.body, /unit list/);

    // Nothing written after the path changes what is judged, and none of
    // these is ever answered with the list or with BGP's contacts.
    const tricks = [
      "/api/available-units#/files",
      "/api/available-units/#",
      `/api/available-units/#/${U}/files`,
      `/api/available-units#${U}`,
      `/api/available-units/#${U}`,
      "/api/available-units/?#/files",
      "/api/available-units?x=1#/files",
      "/API/Available-Units/#/files",
      "/api/available-units//#/files",
      `/api/crm/contacts#/api/available-units/${U}/files`,
      `/api/crm/contacts/#/../available-units/${U}`,
      `/api/crm/contacts?/api/available-units/${U}/files`,
      `/api/crm/contacts#?/api/unit-briefs/x`,
      "/api/crm/contacts/#/api/unit-briefs",
      "/api/crm/contacts#/api/landsec/home",
      // An encoded letter in a fixed name: the router decodes it only inside
      // a parameter, so this is the one-unit route with the id "all-files".
      "/api/available-units/all%2Dfiles",
      "/api/available-units/all%2dfiles#/files",
      "/api%2Fcrm%2Fcontacts",
      "/api/crm%2Fcontacts",
      "/api/./crm/contacts",
      "/api/unit-briefs/../crm/contacts",
      "/api/unit-briefs/..%2Fcrm%2Fcontacts",
      // Not an address at all once the mount is taken off: reading its path
      // throws. Refused, never a server error.
      "/api//x@y[/foo#",
      "/api//x@[::1/foo#",
      `/api//x@y[/../available-units/${U}/files#`,
      // Read two ways: below the mount the slower reader turns "\" into "/"
      // and takes "//a@b" for a host, leaving "/landsec/home" (which a joint
      // agent may open), while the routes are matched on the whole line.
      "/api\\a@b/landsec/home#",
      "/api//a@b/landsec/home#",
      "/api\\a@b/landsec/home#/x?y",
    ];
    for (const path of tricks) {
      const answer = await get(path);
      assert.doesNotMatch(answer.body, /unit list|CRM contacts|past the gate/, `${path} was served`);
      assert.notEqual(answer.status, 200, `${path} answered 200`);
      assert.notEqual(answer.status, 500, `${path} made the gate throw`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("the path the router matches on: the mount put back, no query, no trailing slash", () => {
  assert.equal(routedApiPath({ baseUrl: "/api", path: "/available-units/" }), "/api/available-units");
  assert.equal(routedApiPath({ baseUrl: "/api", path: "/" }), "/api");
  assert.equal(routedApiPath({ baseUrl: "/API", path: "/Brand/X/profile" }), "/API/Brand/X/profile");
  assert.equal(routedApiPath({}), "");
  // Where the request line is there to compare, the two must agree.
  assert.equal(routedApiPath({ baseUrl: "/api", path: "/available-units", originalUrl: "/api/available-units?x=1" }), "/api/available-units");
  assert.equal(routedApiPath({ baseUrl: "/api", path: "/available-units", originalUrl: "/api/available-units/#/files" }), "/api/available-units");
  assert.equal(routedApiPath({ baseUrl: "/api", path: "/x", originalUrl: "http://host.example/api/x?y" }), "/api/x");
  assert.equal(routedApiPath({ baseUrl: "/api", path: "/landsec/home", originalUrl: "/api\\a@b/landsec/home#" }), "", "two readings of one request are never judged");
  assert.equal(routedApiPath({ baseUrl: "/api", path: "/landsec/home", originalUrl: "/api//a@b/landsec/home#" }), "");
  // A request whose path cannot be read at all: the empty path, which no rule allows.
  const unreadable = { baseUrl: "/api", get path(): string { throw new TypeError("Invalid URL"); } };
  assert.equal(routedApiPath(unreadable), "");
  assert.equal(restrictedLandsecApiRule("joint_agent", "GET", routedApiPath(unreadable)), "deny");
});

test("a joint agent's request about a property's page names the property, a plan, an outline, a schedule row or a review item", async () => {
  const { jointAgentPropertyRef } = await import("../shared/landsec");
  assert.deepEqual(jointAgentPropertyRef(`/api/properties/${X}/people`), { kind: "property", id: X });
  assert.deepEqual(jointAgentPropertyRef(`/api/property/${X}/brand-gaps`), { kind: "property", id: X });
  assert.deepEqual(jointAgentPropertyRef(`/api/crm/properties/${X}`), { kind: "property", id: X });
  assert.deepEqual(jointAgentPropertyRef(`/api/tenancy-schedule/property/${X}`), { kind: "property", id: X });
  assert.deepEqual(jointAgentPropertyRef(`/api/plans/${X}/match/accept`), { kind: "plan", id: X });
  assert.deepEqual(jointAgentPropertyRef(`/api/plan-units/${X}`), { kind: "plan-unit", id: X });
  assert.deepEqual(jointAgentPropertyRef(`/api/tenancy-schedule/unit/${X}`), { kind: "tenancy-unit", id: X });
  assert.deepEqual(jointAgentPropertyRef(`/api/review-items/${X}/resolve`), { kind: "review-item", id: X });
  assert.deepEqual(jointAgentPropertyRef("/api/activity-summary", { propertyId: X }), { kind: "property", id: X });
  // No property, no pass: the brand pages, the company list, an unscoped feed.
  for (const path of [`/api/brand/${X}/profile`, "/api/crm/companies", "/api/activity-summary", "/api/crm/properties", "/api/lease-events"]) {
    assert.equal(jointAgentPropertyRef(path), null, path);
  }
});
