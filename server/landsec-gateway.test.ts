import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { restrictedLandsecApiRule, routedApiPath } from "../shared/landsec";

const U = "36c81e04-6f16-4951-8ea7-cbaf16b83741";
const X = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

// method, path, joint agent, asset manager. "client" = not final: the gateway
// goes on to apply the ordinary client checks (the brand must be one the
// client may see).
type Row = [string, string, "allow" | "deny", "allow" | "deny" | "client"];

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
  // 8. Comments not yet logged: the list, the count, log it or dismiss it
  ["GET", "/api/letting-suggestions", "allow", "deny"],
  ["GET", "/api/letting-suggestions/", "allow", "deny"],
  ["GET", "/api/letting-suggestions/count", "allow", "deny"],
  ["get", "/API/Letting-Suggestions/Count/", "allow", "deny"],
  ["POST", `/api/letting-suggestions/${X}/confirm`, "allow", "deny"],
  ["POST", `/api/letting-suggestions/${X}/dismiss`, "allow", "deny"],
];

// Comments not yet logged: a joint agent reads the list and the count, and
// marks a suggestion as logged or dismissed. Nothing else under the path, and
// never the admin preview or apply.
const SUGGESTIONS_CLOSED: Row[] = [
  ["POST", "/api/letting-suggestions", "deny", "deny"],
  ["DELETE", "/api/letting-suggestions", "deny", "deny"],
  ["POST", "/api/letting-suggestions/count", "deny", "deny"],
  ["GET", `/api/letting-suggestions/${X}`, "deny", "deny"],
  ["DELETE", `/api/letting-suggestions/${X}`, "deny", "deny"],
  ["PATCH", `/api/letting-suggestions/${X}`, "deny", "deny"],
  ["GET", `/api/letting-suggestions/${X}/confirm`, "deny", "deny"],
  ["GET", `/api/letting-suggestions/${X}/dismiss`, "deny", "deny"],
  ["PUT", `/api/letting-suggestions/${X}/dismiss`, "deny", "deny"],
  ["POST", `/api/letting-suggestions/${X}/reopen`, "deny", "deny"],
  ["POST", `/api/letting-suggestions/${X}/confirm/extra`, "deny", "deny"],
  ["POST", "/api/letting-suggestions/scan", "deny", "deny"],
  ["GET", "/api/admin/letting-suggestions/preview", "deny", "deny"],
  ["POST", "/api/admin/letting-suggestions/apply", "deny", "deny"],
];

// Their own task list: read it and tick a task. An asset manager has one too
// (Woody, 2026-11-13: "we need each person to have this update their own
// task list"). The handler behind both paths sends only the caller's own
// tasks at their own schemes and takes only a tick.
const OWN_TASKS: Row[] = [
  ["GET", "/api/tasks", "allow", "allow"],
  ["GET", "/api/tasks/", "allow", "allow"],
  ["get", "/API/Tasks", "allow", "allow"],
  ["PATCH", `/api/tasks/${X}`, "allow", "allow"],
  ["patch", `/API/TASKS/${X.toUpperCase()}/`, "allow", "allow"],
];

const OPEN_TO_BOTH: Row[] = [
  ["GET", "/api/landsec/home", "allow", "allow"],
  ["GET", "/api/landsec/tracker", "allow", "allow"],
  ["GET", `/api/landsec/unit/${U}`, "allow", "allow"],
  ["GET", "/api/heartbeat", "allow", "allow"],
  ["GET", "/api/notifications", "allow", "allow"],
  ["GET", "/api/config/maps-key", "allow", "allow"],
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
  // Brand reads are never let straight through: the ordinary client checks
  // decide whether the brand is one this client may see.
  ["GET", `/api/crm/companies/${X}`, "deny", "client"],
  ["GET", `/api/crm/companies/${X}/deals`, "deny", "client"],
  ["GET", `/api/crm/companies/${X}/trading-entities`, "deny", "client"],
  ["GET", `/api/brands/${X}`, "deny", "client"],
  ["GET", `/api/brand/${X}/preparation`, "deny", "client"],
  ["GET", `/api/brand/${X}/profile`, "deny", "client"],
  ["GET", `/api/brand/${X}/pack.pdf`, "deny", "client"],
  ["GET", `/api/brand/${X}/suggested-units`, "deny", "client"],
  ["GET", `/api/brand-logo/${X}`, "deny", "client"],
  ["GET", `/api/brand/gallery-image/${X}`, "deny", "client"],
  ["GET", `/api/client/crm/brands`, "deny", "client"],
  ["GET", `/api/covenant/by-crm/${X}`, "deny", "client"],
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
  // Tasks: no create, delete, reorder, import or notebook links, and no
  // other verb on the list or on one task
  ["POST", "/api/tasks", "deny", "deny"],
  ["PUT", "/api/tasks", "deny", "deny"],
  ["PATCH", "/api/tasks", "deny", "deny"],
  ["DELETE", "/api/tasks", "deny", "deny"],
  ["HEAD", "/api/tasks", "deny", "deny"],
  ["GET", `/api/tasks/${X}`, "deny", "deny"],
  ["PUT", `/api/tasks/${X}`, "deny", "deny"],
  ["POST", `/api/tasks/${X}`, "deny", "deny"],
  ["DELETE", `/api/tasks/${X}`, "deny", "deny"],
  ["PATCH", `/api/tasks/${X}/status`, "deny", "deny"],
  ["GET", "/api/tasks/reorder", "deny", "deny"],
  ["GET", "/api/tasks/import/onenote/sections/abc", "deny", "deny"],
  ["GET", "/api/tasks/onenote/pages/abc", "deny", "deny"],
  ["POST", `/api/tasks/${X}/export-onenote`, "deny", "deny"],
  ["POST", `/api/tasks/${X}/link-evernote`, "deny", "deny"],
  ["DELETE", `/api/tasks/${X}/link-evernote`, "deny", "deny"],
  ["GET", "/api/tasksx", "deny", "deny"],
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
  // The mapping key the server pays for, and anything else under /api/config
  ["GET", "/api/config/os-key", "deny", "deny"],
  ["GET", "/api/config", "deny", "deny"],
  ["GET", "/api/config/maps-key-2", "deny", "deny"],
  ["POST", "/api/config/os-key", "deny", "deny"],
  // An asset manager writes nothing on a brand
  ["POST", `/api/brand/${X}/credit-check`, "deny", "deny"],
  ["PATCH", `/api/brand/${X}`, "deny", "deny"],
  ["PUT", `/api/crm/companies/${X}`, "deny", "deny"],
  ["HEAD", `/api/brand/${X}/profile`, "deny", "deny"],
];

const check = (rows: Row[]) => {
  for (const [method, path, jointAgent, assetManager] of rows) {
    assert.equal(restrictedLandsecApiRule("joint_agent", method, path), jointAgent, `joint agent ${method} ${path}`);
    assert.equal(restrictedLandsecApiRule("asset_manager", method, path), assetManager, `asset manager ${method} ${path}`);
  }
};

test("a joint agent reaches the letting work, an asset manager gets nothing new", () => check(OPENED_FOR_JOINT_AGENTS));
test("what both restricted roles already reached is unchanged", () => check(OPEN_TO_BOTH));
test("both restricted roles read their own task list and tick a task, and nothing else on it", () => check(OWN_TASKS));
test("brand pages and brand cases are the asset manager's only; a joint agent does not make the Targeting Brief document", () => check(ASSET_MANAGER_ONLY));
test("everything else is refused for both", () => check(CLOSED_TO_BOTH));
test("comments not yet logged: only the list, the count, confirm and dismiss, and only for a joint agent", () => check(SUGGESTIONS_CLOSED));

// The task list is the one thing an asset manager gained on 2026-11-13: every
// other path opened for joint agents stays shut to them, whatever the method.
test("the task list is all an asset manager gained", () => {
  for (const [, path] of OPENED_FOR_JOINT_AGENTS) {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(restrictedLandsecApiRule("asset_manager", method, path), "deny", `asset manager ${method} ${path}`);
    }
  }
  for (const method of ["POST", "PUT", "DELETE"]) {
    assert.equal(restrictedLandsecApiRule("asset_manager", method, "/api/tasks"), "deny", method);
    assert.equal(restrictedLandsecApiRule("asset_manager", method, `/api/tasks/${X}`), "deny", method);
  }
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
  for (const role of ["asset_manager", "joint_agent"] as const) assert.equal(restrictedLandsecApiRule(role, "GET", routedApiPath(unreadable)), "deny");
});
