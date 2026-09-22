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

test("landsec client audit — every nav page", async ({ page }) => {
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

  for (const [name, path] of PAGES) {
    failures.length = 0;
    await page.goto(`http://127.0.0.1:5001${path}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 400);
    const blank = bodyText.trim().length < 40;
    await page.screenshot({ path: `${process.env.SP}/audit-${name}.png`, fullPage: false });
    console.log(`PAGE ${name}: ${blank ? "SUSPICIOUSLY-EMPTY " : ""}${failures.length ? "FAILS: " + [...new Set(failures)].join(" ; ") : "clean"}`);
  }
});
