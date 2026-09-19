export const NEWS_ERROR_TITLES = [
  "verifying device", "verifying your device", "verifying your browser",
  "checking your browser", "checking your browser before accessing",
  "just a moment", "attention required", "attention required | cloudflare",
  "access denied", "request blocked", "403 forbidden", "403 - forbidden",
  "404 not found", "404 - not found", "page not found", "service unavailable",
  "bad gateway", "502 bad gateway", "503 service unavailable", "504 gateway timeout",
] as const;

export function isNewsErrorTitle(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const title = value.trim().replace(/\s+/g, " ").replace(/[.!…]+\s*$/, "").trim().toLowerCase();
  return (NEWS_ERROR_TITLES as readonly string[]).includes(title);
}
