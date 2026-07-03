/**
 * Refresh the Edozo API token by headless login. Run manually or from a
 * scheduler:
 *   tsx scripts/refresh-edozo-token.ts
 * Needs EDOZO_USERNAME + EDOZO_PASSWORD in the environment and Chromium
 * available (Playwright).
 */
import { refreshEdozoToken } from "../server/edozo-refresh";

refreshEdozoToken()
  .then((r) => {
    if (r.ok) {
      console.log(`OK — token refreshed, expires ${r.expiresAt?.toISOString() || "unknown"}`);
      process.exit(0);
    }
    console.error(`FAILED — ${r.reason}`);
    process.exit(1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
