import { test, expect } from "@playwright/test";

test("staff view: Landsec company page paired boards", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("http://127.0.0.1:5001/");
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 5; i++) {
    if (await page.getByTestId("form-guest-login").isVisible().catch(() => false)) break;
    await page.getByTestId("button-show-guest-login").click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.getByTestId("input-guest-email").fill("test-staff@brucegillinghampollard.com");
  await page.getByTestId("input-guest-password").fill("smoketest123");
  await page.getByTestId("button-guest-login").click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  await page.goto("http://127.0.0.1:5001/companies/d25ec158-82df-4f50-8188-cae113af5f9f");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: process.env.SP + "/landsec-top.png", fullPage: false });
  // scroll to the sidebar cards region (below the main panel on landlords)
  await page.evaluate(() => {
    const el = document.querySelector(".overflow-y-auto");
    if (el) el.scrollTop = el.scrollHeight * 0.55;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: process.env.SP + "/landsec-mid.png", fullPage: false });
  await page.evaluate(() => {
    const el = document.querySelector(".overflow-y-auto");
    if (el) el.scrollTop = el.scrollHeight * 0.8;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: process.env.SP + "/landsec-low.png", fullPage: false });
  expect(true).toBe(true);
});
