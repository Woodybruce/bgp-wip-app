/**
 * Edozo token refresher.
 *
 * Edozo has no API/machine credential — the only way to mint the 24h
 * `edozo_jwt` API token is the interactive login. So we drive it headlessly
 * with Playwright: log in as the configured user, read the `edozo_jwt` cookie,
 * and store it for the web server to use.
 *
 * Playwright is imported dynamically so it stays out of the main server bundle
 * (it's marked external at build time) and is only loaded when a refresh runs.
 * Requires Chromium in the image — see the Railway Dockerfile.
 */
import { execSync } from "child_process";
import { setStoredEdozoToken } from "./edozo-token-store";

const LOGIN_START = "https://occupiers.edozo.com/create";

// Resolve a Chromium executable. Prefer an explicit override, else find one on
// PATH (Railway/Nixpacks installs `chromium`). Returning undefined lets
// Playwright fall back to its own downloaded browser (local dev).
function resolveChromiumPath(): string | undefined {
  if (process.env.EDOZO_CHROMIUM_PATH) return process.env.EDOZO_CHROMIUM_PATH;
  for (const bin of ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"]) {
    try {
      const p = execSync(`command -v ${bin}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      if (p) return p;
    } catch {
      // not found; try next
    }
  }
  return undefined;
}

function decodeJwtExpiry(jwt: string): Date | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload.exp ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}

export function isEdozoRefreshConfigured(): boolean {
  return Boolean(process.env.EDOZO_USERNAME && process.env.EDOZO_PASSWORD);
}

export async function refreshEdozoToken(): Promise<{ ok: boolean; expiresAt: Date | null; reason?: string }> {
  const username = process.env.EDOZO_USERNAME;
  const password = process.env.EDOZO_PASSWORD;
  if (!username || !password) return { ok: false, expiresAt: null, reason: "EDOZO_USERNAME/PASSWORD not set" };

  // Indirect specifier so this typechecks without Playwright's types present in
  // dev; it's installed as a dependency and loaded at runtime on the server.
  const playwrightModule = "playwright";
  const { chromium } = (await import(playwrightModule)) as any;
  const browser = await chromium.launch({
    headless: true,
    executablePath: resolveChromiumPath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(LOGIN_START, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);

    if (page.url().includes("login.edozo.com")) {
      await page.locator('input[type="email"], input[name="username"]').first().fill(username);
      const pass = page.locator('input[type="password"]').first();
      if (await pass.isVisible().catch(() => false)) {
        await pass.fill(password);
      } else {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(2500);
        await page.locator('input[type="password"]').first().fill(password);
      }
      await page.locator('button[type="submit"], input[type="submit"]').first().click().catch(() => page.keyboard.press("Enter"));
      await page.waitForTimeout(9000);
    }

    // Read the edozo_jwt cookie (domain .edozo.com). This is the API bearer.
    const cookies = await context.cookies(["https://occupiers.edozo.com", "https://api.edozo.com"]);
    const jwt = cookies.find((c) => c.name === "edozo_jwt")?.value;
    if (!jwt) return { ok: false, expiresAt: null, reason: "edozo_jwt cookie not found after login" };

    const expiresAt = decodeJwtExpiry(jwt);
    await setStoredEdozoToken(jwt, expiresAt);
    console.log(`[edozo-refresh] stored token, expires ${expiresAt?.toISOString() || "unknown"}`);
    return { ok: true, expiresAt };
  } finally {
    await browser.close();
  }
}
