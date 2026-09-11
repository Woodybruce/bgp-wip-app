import { test, expect } from "@playwright/test";

test("client dashboard: move My Tasks & Briefing to the top", async ({ page }) => {
  page.on("console", m => { if (m.type() === "error") console.log("PAGE-ERR:", m.text().slice(0, 200)); });
  await page.goto("http://127.0.0.1:5001/");
  await page.waitForLoadState("networkidle");
  // The guest form can collapse if the page re-renders during hydration —
  // retry the expand until the form is actually open.
  for (let i = 0; i < 5; i++) {
    if (await page.getByTestId("form-guest-login").isVisible().catch(() => false)) break;
    await page.getByTestId("button-show-guest-login").click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.getByTestId("input-guest-email").fill("mark@landsec-test.example");
  await page.getByTestId("input-guest-password").fill("smoketest123");
  await page.getByTestId("button-guest-login").click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: process.env.SP + "/1-dashboard.png", fullPage: false });

  // Enter customise/edit mode
  const editBtn = page.getByTestId("button-edit-dashboard");
  await expect(editBtn).toBeVisible({ timeout: 15000 });
  await editBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: process.env.SP + "/2-edit-mode.png", fullPage: false });

  // Find the My Tasks widget grid item + its drag handle
  const gridItem = page.getByTestId("grid-item-my-tasks");
  await expect(gridItem).toBeVisible({ timeout: 10000 });
  const gridPos = () => gridItem.evaluate((el) => (el as HTMLElement).style.transform);
  const before = await gridItem.boundingBox();
  console.log("BEFORE-POS", JSON.stringify(before), "TRANSFORM", await gridPos());

  const handle = gridItem.locator(".grid-drag-handle");
  await handle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await expect(handle).toBeVisible();
  const hb = (await handle.boundingBox())!;
  console.log("HANDLE-BOX", JSON.stringify(hb));
  // Drag to the very top of the grid: pick up the handle, park the cursor
  // near the top edge of the viewport and jiggle so the edge auto-scroll
  // carries the drag up the page, then drop at the grid's top.
  const cx = hb.x + hb.width / 2;
  await page.mouse.move(cx, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx, hb.y + hb.height / 2 - 30, { steps: 5 });
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(cx + (i % 2), 40 + (i % 2), { steps: 1 });
    await page.waitForTimeout(50);
    const atTop = await gridItem.evaluate((el) => {
      const scroller = el.closest(".overflow-y-auto") as HTMLElement | null;
      return scroller ? scroller.scrollTop <= 0 : window.scrollY <= 0;
    });
    if (atTop) break;
  }
  // Cursor to where the grid's first row now sits, then release
  await page.mouse.move(cx, 260, { steps: 10 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(2500); // let the debounced save fire

  const after = await gridItem.boundingBox();
  console.log("AFTER-POS", JSON.stringify(after), "TRANSFORM", await gridPos());
  await page.screenshot({ path: process.env.SP + "/3-after-drag.png", fullPage: false });

  // Reload — does the new position persist?
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  const reloadedItem = page.getByTestId("grid-item-my-tasks");
  const reloaded = await reloadedItem.boundingBox();
  const reloadedTf = await reloadedItem.evaluate((el) => (el as HTMLElement).style.transform).catch(() => "n/a");
  console.log("RELOADED-POS", JSON.stringify(reloaded), "TRANSFORM", reloadedTf);
  await page.screenshot({ path: process.env.SP + "/4-after-reload.png", fullPage: false });
});
