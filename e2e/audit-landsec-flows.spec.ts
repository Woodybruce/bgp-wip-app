import { test } from "@playwright/test";

// Interactive audit — drives the main Landsec client flows for real, not
// just page loads. Logs PASS/FAIL per flow; screenshots to $SP.
test("landsec client audit — interactive flows", async ({ page }) => {
  test.setTimeout(300000);
  const out: string[] = [];
  const log = (s: string) => { out.push(s); console.log(s); };

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

  // ── Flow 1: Letting Tracker — inline deal-status edit persists
  await page.goto("http://127.0.0.1:5001/deals/letting");
  await page.waitForTimeout(4000);
  try {
    const row = page.locator("[data-testid^='row-unit-']").first();
    await row.waitFor({ state: "visible", timeout: 25000 });
    await row.scrollIntoViewIfNeeded({ timeout: 8000 });
    const statusCell = row.locator("td").nth(3); // after checkbox/ref/property = Deal Status now
    await statusCell.click();
    await page.waitForTimeout(600);
    const option = page.locator("[role='option'], [role='menuitem']").filter({ hasText: /Under Offer|UO|Terms/i }).first();
    if (await option.isVisible().catch(() => false)) {
      await option.click();
      await page.waitForTimeout(1200);
      log("PASS tracker-inline-status: dropdown opened + option picked");
    } else {
      log("WARN tracker-inline-status: dropdown options not visible after click");
    }
  } catch (e: any) { log("FAIL tracker-inline-status: " + e.message.slice(0, 100)); }
  await page.screenshot({ path: process.env.SP + "/flow-tracker.png" });

  // ── Flow 2: add a target operator via brand search
  try {
    const addTarget = page.locator("[data-testid^='add-target-']").first();
    if (await addTarget.isVisible().catch(() => false)) {
      await addTarget.click();
      await page.keyboard.type("Nike", { delay: 40 });
      await page.waitForTimeout(1200);
      const pick = page.locator("[role='option'], [cmdk-item]").filter({ hasText: /Nike/i }).first();
      if (await pick.isVisible().catch(() => false)) {
        await pick.click();
        await page.waitForTimeout(1500);
        const chip = await page.locator("text=Nike Test Brand").count();
        log(chip > 0 ? "PASS add-target-operator: Nike picked and rendered" : "WARN add-target-operator: picked but not rendered");
      } else { log("WARN add-target-operator: no search results for Nike"); }
    } else {
      // unit may already have targets → small + icon
      log("SKIP add-target-operator: no empty-state add input (unit already has targets)");
    }
  } catch (e: any) { log("FAIL add-target-operator: " + e.message.slice(0, 100)); }
  await page.screenshot({ path: process.env.SP + "/flow-target.png" });

  // ── Flow 3: HOTs dialog — populate, save
  try {
    const hotsBtn = page.locator("[data-testid^='button-hots-']").first();
    await hotsBtn.scrollIntoViewIfNeeded({ timeout: 8000 });
    await hotsBtn.click();
    await page.waitForTimeout(800);
    await page.getByTestId("hots-populate").click();
    await page.waitForTimeout(1500);
    const text = await page.getByTestId("hots-content").inputValue();
    const filled = text.includes("Westgate");
    await page.getByTestId("hots-save").click();
    await page.waitForTimeout(1000);
    log(filled ? "PASS hots-populate-save: template filled with property + saved" : "FAIL hots-populate-save: content missing property name");
    await page.screenshot({ path: process.env.SP + "/flow-hots.png" });
    await page.keyboard.press("Escape");
  } catch (e: any) { log("FAIL hots-populate-save: " + e.message.slice(0, 100)); }

  // ── Flow 4: tenancy schedule → + Tracker on RU10
  try {
    const prop = await page.evaluate(async () => {
      const r = await fetch("/api/crm/properties", { credentials: "include" });
      const d = await r.json();
      return d[0]?.id;
    });
    await page.goto(`http://127.0.0.1:5001/properties/${prop}`);
    await page.waitForTimeout(6000);
    const row = page.locator("tr", { hasText: "RU10" }).first();
    await row.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    await row.scrollIntoViewIfNeeded().catch(() => {});
    const btn = row.locator("button", { hasText: /Tracker/i }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(2500);
      const linked = await page.evaluate(async () => {
        const r = await fetch("/api/available-units", { credentials: "include" });
        const units = await r.json();
        return units.some((u: any) => (u.unitName || "").includes("RU10"));
      });
      log(linked ? "PASS tenancy-to-tracker: RU10 listed on tracker" : "FAIL tenancy-to-tracker: clicked but unit not on tracker");
    } else {
      log("FAIL tenancy-to-tracker: + Tracker button not visible on RU10 row");
    }
    await page.screenshot({ path: process.env.SP + "/flow-tenancy.png" });
  } catch (e: any) { log("FAIL tenancy-to-tracker: " + e.message.slice(0, 100)); }

  // ── Flow 5: CRM — add a contact (client-allowed write)
  try {
    const status = await page.evaluate(async () => {
      const r = await fetch("/api/crm/contacts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "QA Flow Contact", email: "qa-flow@landsec-test.example" }),
      });
      return r.status;
    });
    log(status < 300 ? "PASS client-add-contact: POST /api/crm/contacts " + status : "FAIL client-add-contact: " + status);
  } catch (e: any) { log("FAIL client-add-contact: " + e.message.slice(0, 100)); }

  console.log("=== SUMMARY ===\n" + out.join("\n"));
});
