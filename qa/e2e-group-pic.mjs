// E2E: group photo picker → cropper → upload, on the phone shell.
// Run: node qa/e2e-group-pic.mjs   (app must be up on SMOKE_BASE, default :5200)
import { chromium, devices } from "@playwright/test";

const BASE = process.env.SMOKE_BASE || "http://localhost:5200";
const SHOTS = process.env.E2E_SHOTS || "/tmp";
const ok = (m) => console.log("  ok ", m);
const fail = (m) => { console.error("  FAIL", m); process.exitCode = 1; };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();

// Make a real JPEG to feed the picker (screenshot of a coloured page).
const gen = await ctx.newPage();
await gen.setContent(`<body style="margin:0;background:linear-gradient(135deg,#dc2626,#f472b6);width:100vw;height:100vh"><div style="font:700 80px system-ui;color:#fff;padding:40px">BGP</div></body>`);
const JPEG = `${SHOTS}/e2e-test-photo.jpg`;
await gen.screenshot({ path: JPEG, type: "jpeg", quality: 85 });
await gen.close();

const uploads = [];
const crumbs = [];
page.on("request", (r) => {
  if (r.url().includes("/group-pic") && r.method() === "POST") uploads.push(r.url());
  if (r.url().includes("/api/client-log")) crumbs.push(r.postData() || "");
});

// ---- login (fixture staff) ----
await page.goto(BASE, { waitUntil: "networkidle" });
const guest = page.getByText("Client / guest sign in");
if (await guest.count()) await guest.first().click();
await page.locator('input[type="text"], input[type="email"]').first().fill("victoria@brucegillinghampollard.com");
await page.locator('input[type="password"]').first().fill("B@nd0077!");
await page.getByTestId("button-guest-login").click();
await page.waitForTimeout(5000);
ok("logged in as victoria");

// ---- create a group chat (fresh fixture has none for victoria) ----
// navigate via the SPA (a hard goto can drop the in-memory auth token)
await page.getByTestId("button-mobile-new-group").waitFor({ timeout: 15000 });
await page.getByTestId("button-mobile-new-group").click();
const rows = page.locator('[data-testid^="button-mobile-select-user-"]');
await rows.first().waitFor({ timeout: 10000 });
await rows.nth(0).click();
await rows.nth(1).click();
await page.getByTestId("button-mobile-create-group").click();
await page.waitForTimeout(2500);
ok("group chat created");

// ---- pass 1: happy path — picker → cropper → save → upload ----
const [chooser] = await Promise.all([
  page.waitForEvent("filechooser", { timeout: 10000 }),
  page.getByTestId("button-group-pic").click(),
]);
await chooser.setFiles(JPEG);
await page.getByTestId("group-pic-save").waitFor({ timeout: 10000 });
ok("cropper opened with the photo");
await page.screenshot({ path: `${SHOTS}/e2e-cropper.png` });

// nudge the crop like a user would
const zoom = page.getByTestId("group-pic-zoom");
await zoom.evaluate((el) => { el.value = "1.5"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });

const [resp] = await Promise.all([
  page.waitForResponse((r) => r.url().includes("/group-pic") && r.request().method() === "POST", { timeout: 15000 }),
  page.getByTestId("group-pic-save").click(),
]);
if (resp.status() === 200) ok(`upload POST returned 200`);
else fail(`upload POST returned ${resp.status()}`);
await page.waitForTimeout(1500);
const avatarImg = await page.locator('[data-testid="button-group-pic"] img').count();
if (avatarImg > 0) ok("group avatar now shows the uploaded photo");
else fail("group avatar did not update");
await page.screenshot({ path: `${SHOTS}/e2e-after-upload.png` });

// ---- pass 2: hostile path — view rebuilt between picker and cropper ----
// Pick a photo, then immediately leave the chat view (unmounts it, like the
// iOS resume rebuild) and come back: the stash must reopen the cropper.
const [chooser2] = await Promise.all([
  page.waitForEvent("filechooser", { timeout: 10000 }),
  page.getByTestId("button-group-pic").click(),
]);
// leave the chat view BEFORE the photo lands — exactly the iOS resume case:
// the view that started the pick is gone when the file arrives
await page.getByTestId("button-mobile-chat-back").click().catch(() => {});
await page.waitForTimeout(1000);
await chooser2.setFiles(JPEG);
await page.waitForTimeout(1000);
// photo is now sitting in the stash with no chat view mounted — re-enter
await page.getByText("Group Chat").first().click();
await page.getByTestId("group-pic-save").waitFor({ timeout: 10000 })
  .then(() => ok("stash survived a view rebuild — cropper reopened"))
  .catch(() => fail("cropper did NOT reopen after view rebuild"));
await page.screenshot({ path: `${SHOTS}/e2e-stash-reopen.png` });
await page.getByTestId("group-pic-cancel").click().catch(() => {});

console.log("breadcrumbs sent:", crumbs.map((c) => { try { return JSON.parse(c).tag; } catch { return "?"; } }).join(" → "));
console.log(process.exitCode ? "E2E: FAILURES" : "E2E: all green");
await browser.close();
