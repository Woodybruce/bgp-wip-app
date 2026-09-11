import { test, expect } from "@playwright/test";

test("client dashboard shows the mirrored relationship commentary", async ({ page }) => {
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
  await page.waitForTimeout(1500);

  // The BGP Relationship board should now carry the AI activity card,
  // and the activity GET must not 403 for the client's own company.
  const card = page.locator("[data-testid^='ai-activity-landlord-']");
  await card.first().scrollIntoViewIfNeeded().catch(() => {});
  const count = await card.count();
  console.log("AI-ACTIVITY-CARD-COUNT", count);
  expect(count).toBeGreaterThan(0);
  await expect(card.first()).toBeVisible();
  const text = await card.first().innerText();
  console.log("CARD-TEXT", text.slice(0, 200).replace(/\n/g, " | "));
  await page.screenshot({ path: process.env.SP + "/relationship-board.png", fullPage: false });
});
