// ─────────────────────────────────────────────────────────────────────────
// Brand-logo candidate planning + the "checked official logo" contract.
//
// Pure decision logic lifted out of image-studio's prepareBrandLogo so the
// ordering rules are unit-testable without a database or network:
//
//   1. existing   — any publishable logo already on file (incl. a manually
//                   chosen one) always wins; preparation never replaces it.
//   2. findings   — the official logo the landlord website scraper found
//                   (landlord_website_findings.logo_url). Preferred over
//                   logo.dev: it's the company's own published asset.
//   3. logo_dev   — the logo.dev image API for the verified domain.
//   4. website_scrape — last resort: scrapeLogoFromWebsite on the verified
//                   domain (schema.org / og / apple-touch / header img).
//
// Steps whose inputs are absent are dropped from the plan.
// ─────────────────────────────────────────────────────────────────────────

export type LogoSourceStep = "existing" | "findings" | "logo_dev" | "website_scrape";

export function planLogoSources(args: {
  hasExistingPublishable: boolean;
  findingsLogoUrl: string | null | undefined;
  logoDevConfigured: boolean;
  domain: string | null | undefined;
}): LogoSourceStep[] {
  if (args.hasExistingPublishable) return ["existing"];
  const steps: LogoSourceStep[] = [];
  if (args.findingsLogoUrl && String(args.findingsLogoUrl).trim()) steps.push("findings");
  if (args.logoDevConfigured) steps.push("logo_dev");
  if (args.domain && String(args.domain).trim()) steps.push("website_scrape");
  return steps;
}

export const LOGO_MIN_BYTES = 800;          // below this it's a tracker/favicon
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

// The "checked" contract for an official logo download: real HTTP 200,
// an actual image content-type, and a plausible byte size. Anything else
// is rejected before it can reach the gallery or the company header.
export function isCheckedLogoDownload(input: {
  status: number;
  mime: string | null | undefined;
  bytes: number;
}): { ok: boolean; reason?: string } {
  if (input.status !== 200) return { ok: false, reason: `download returned HTTP ${input.status}` };
  const mime = (input.mime || "").toLowerCase();
  if (!mime.startsWith("image/")) return { ok: false, reason: "download was not an image" };
  if (input.bytes < LOGO_MIN_BYTES) return { ok: false, reason: "download was too small to be a real logo" };
  if (input.bytes > LOGO_MAX_BYTES) return { ok: false, reason: "logo exceeds the size limit" };
  return { ok: true };
}
