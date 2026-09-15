import { test } from "@playwright/test";

const PAGES = [
  ["dashboard", "/"],
  ["my-tasks", "/my-tasks"],
  ["deals", "/deals"],
  ["requirements", "/requirements"],
  ["brands", "/brands"],
  ["crm-contacts", "/contacts"],
  ["comps", "/comps"],
  ["properties", "/properties"],
  ["letting-tracker", "/available-units"],
  ["sharepoint", "/sharepoint"],
  ["calendar", "/calendar"],
  ["prop-intel", "/property-intelligence"],
  ["deals-properties", "/deals/properties"],
  ["chatbgp", "/chatbgp"],
  ["image-studio", "/image-studio"],
];

test("landsec visual journey", async ({ page }) => {
  test.setTimeout(300000);
  const failures: string[] = [];
  page.on("response", (r) => {
    if ([403, 500, 502].includes(r.status()) && r.url().includes("/api/")) {
      failures.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
    }
  });
  page.on("pageerror", (e) => failures.push(`JS-ERROR ${e.message.slice(0, 120)}`));

  await page.goto("http://127.0.0.1:5001/");
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 5; i++) {
    if (await page.getByTestId("form-guest-login").isVisible().catch(() => false)) break;
    await page.getByTestId("button-show-guest-login").click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.getByTestId("input-guest-email").fill("mark@landsec-test.example");
  await page.getByTestId("input-guest-password").fill("smoketest123");
  await page.getByTestId("button-guest-login").click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  
  const SP = process.env.SP;
  const shot = (n) => page.screenshot({ path: `${SP}/vj-${n}.png` });
  const notes = [];

  // 1. Dashboard
  await page.goto("http://127.0.0.1:5001/"); await page.waitForTimeout(3000); await shot("01-dashboard");

  // 2. Deals page — create a deal
  await page.goto("http://127.0.0.1:5001/deals"); await page.waitForTimeout(3000); await shot("02-deals");
  const newDeal = page.getByRole("button", { name: /new deal|add deal/i }).first();
  if (await newDeal.isVisible().catch(()=>false)) { await newDeal.click(); await page.waitForTimeout(1200); await shot("03-new-deal-dialog"); notes.push("deals: New Deal dialog opens"); await page.keyboard.press("Escape"); }
  else notes.push("deals: NO create-deal button visible for client");

  // 3. Letting Tracker — add unit dialog
  await page.goto("http://127.0.0.1:5001/deals/letting"); await page.waitForTimeout(3500); await shot("04-tracker");
  const addUnit = page.getByRole("button", { name: /add unit/i }).first();
  if (await addUnit.isVisible().catch(()=>false)) { await addUnit.click(); await page.waitForTimeout(1000); await shot("05-add-unit-dialog"); notes.push("tracker: Add Unit dialog opens"); await page.keyboard.press("Escape"); }
  else notes.push("tracker: NO Add Unit button");

  // 4. Costs/Details inline editor
  await page.waitForTimeout(500);
  const costs = page.locator("[data-testid^='costs-cell-']").first();
  if (await costs.isVisible().catch(()=>false)) { await costs.click(); await page.waitForTimeout(900); await shot("06-costs-details-popover"); notes.push("tracker: Costs/Details popover opens"); await page.keyboard.press("Escape"); }
  else notes.push("tracker: costs cell not found");

  // 5. HOTs dialog
  const hots = page.locator("[data-testid^='button-hots-']").first();
  if (await hots.isVisible().catch(()=>false)) { await hots.scrollIntoViewIfNeeded(); await hots.click(); await page.waitForTimeout(1000); await shot("07-hots-dialog"); notes.push("tracker: HOTs dialog opens"); await page.keyboard.press("Escape"); }
  else notes.push("tracker: HOTs button not found");

  // 6. Properties tab
  await page.goto("http://127.0.0.1:5001/deals/properties"); await page.waitForTimeout(3000); await shot("08-properties-tab");

  // 7. Property detail
  const prop = await page.evaluate(async () => { const r = await fetch("/api/crm/properties", {credentials:"include"}); const d = await r.json(); return d[0]?.id; });
  await page.goto(`http://127.0.0.1:5001/properties/${prop}`); await page.waitForTimeout(5000); await shot("09-property-detail");

  // 8. Property Intelligence
  await page.goto("http://127.0.0.1:5001/property-intelligence"); await page.waitForTimeout(4000); await shot("10-property-intelligence");

  // 9. Brand Intelligence
  await page.goto("http://127.0.0.1:5001/brands"); await page.waitForTimeout(3000); await shot("11-brands");

  // 10. CRM
  await page.goto("http://127.0.0.1:5001/contacts"); await page.waitForTimeout(3000); await shot("12-crm");

  // 11. SharePoint
  await page.goto("http://127.0.0.1:5001/sharepoint"); await page.waitForTimeout(3000); await shot("13-sharepoint");

  // 12. Calendar
  await page.goto("http://127.0.0.1:5001/calendar"); await page.waitForTimeout(3000); await shot("14-calendar");

  console.log("=== JOURNEY NOTES ===\n" + notes.join("\n"));
});
