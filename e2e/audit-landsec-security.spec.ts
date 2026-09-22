import { test, expect, request as pwRequest } from "@playwright/test";

// Cross-tenant / privilege probes for the Landsec client login. Seeds a
// rival landlord's records, then asserts the client can reach NONE of them
// by direct id, and that BGP-internal writes/financials stay blocked.
// Requires the rival rows seeded by e2e/seed-rival.cjs (run in CI before this).
const RIVAL = {
  deal: "44444444-4444-4444-4444-444444444444",
  property: "22222222-2222-2222-2222-222222222222",
  contact: "33333333-3333-3333-3333-333333333333",
  unit: "55555555-5555-5555-5555-555555555555",
};

test("landsec client: cross-tenant + privilege probes", async () => {
  const ctx = await pwRequest.newContext({ baseURL: "http://127.0.0.1:5001" });
  const login = await ctx.post("/api/auth/login", { data: { username: "mark@landsec-test.example", password: "smoketest123" } });
  const token = (await login.json()).token as string;
  const H = { Authorization: `Bearer ${token}` };

  // Direct-id access to a rival's records must 403 (never leak content).
  for (const [name, url] of [
    ["rival deal", `/api/crm/deals/${RIVAL.deal}`],
    ["rival property", `/api/crm/properties/${RIVAL.property}`],
    ["rival contact", `/api/crm/contacts/${RIVAL.contact}`],
    ["rival unit files", `/api/available-units/${RIVAL.unit}/files`],
    ["rival unit viewings", `/api/available-units/${RIVAL.unit}/viewings`],
    ["rival unit offers", `/api/available-units/${RIVAL.unit}/offers`],
    ["rival unit hots", `/api/available-units/${RIVAL.unit}/hots`],
  ] as const) {
    const r = await ctx.get(url, { headers: H });
    expect(r.status(), name).toBe(403);
  }

  // List endpoints must not contain rival rows.
  const deals = await (await ctx.get("/api/crm/deals", { headers: H })).json();
  expect(deals.some((d: any) => (d.name || "").includes("Secret")), "no rival deal in list").toBe(false);
  const units = await (await ctx.get("/api/available-units", { headers: H })).json();
  expect(units.some((u: any) => (u.unitName || "").includes("Rival")), "no rival unit in list").toBe(false);

  // BGP-internal financials / writes stay blocked.
  expect((await ctx.get("/api/wip", { headers: H })).status(), "WIP blocked").toBe(403);
  expect((await ctx.post("/api/microsoft/property-folders", { headers: H, data: { propertyName: "x", team: "Landsec" } })).status(), "M365 blocked").toBe(403);

  await ctx.dispose();
});
