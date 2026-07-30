import { defineConfig } from "@playwright/test";

// Smoke suite config. Local sandboxes and CI both point BASE_URL at a
// locally-booted production build; the pinned chromium comes from the
// environment (PW_CHROMIUM) when the default download isn't available.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL || "http://127.0.0.1:5001",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    viewport: { width: 1600, height: 1000 },
  },
});
