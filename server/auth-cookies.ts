// Authenticated press scraping — injects subscriber cookies for paywalled
// publications so og:image extraction + (eventually) full-text scraping
// returns the real article page rather than the paywall stub.
//
// BGP subscribes to:
//   - Business of Fashion        → env BOF_AUTH_COOKIE
//   - Drapers                    → env DRAPERS_AUTH_COOKIE
//   - Retail Week                → env RETAILWEEK_AUTH_COOKIE
//   - Vogue Business             → env VOGUEBUSINESS_AUTH_COOKIE
//
// Each env var holds the FULL cookie header string from a logged-in browser
// session, e.g. "session_id=abc; subscriber=true; _ga=GA1.2.…".
//
// How to extract one (per publication, ~2 min):
//   1. Log in to e.g. businessoffashion.com in Chrome
//   2. Open any subscriber article
//   3. F12 → Application tab → Storage → Cookies → businessoffashion.com
//   4. Right-click → Copy → Copy all as cookie string (or assemble manually
//      "name=value; name=value; …" for the auth cookies)
//   5. Paste into Railway env var, redeploy
//
// Cookies typically last 30-90 days; if a publication's og:image starts
// returning paywall stubs again, the cookie has expired and needs refresh.

const COOKIE_RULES: Array<{ pattern: RegExp; envVar: string; label: string }> = [
  { pattern: /\b(businessoffashion\.com)\b/i, envVar: "BOF_AUTH_COOKIE",            label: "Business of Fashion" },
  { pattern: /\b(drapersonline\.com)\b/i,     envVar: "DRAPERS_AUTH_COOKIE",        label: "Drapers" },
  { pattern: /\b(retailweek\.com)\b/i,        envVar: "RETAILWEEK_AUTH_COOKIE",     label: "Retail Week" },
  { pattern: /\b(voguebusiness\.com)\b/i,     envVar: "VOGUEBUSINESS_AUTH_COOKIE",  label: "Vogue Business" },
];

// Returns a Cookie header value for the given URL, or null if we don't have
// (or aren't configured for) a subscription for its publisher.
export function authCookieForUrl(url: string): string | null {
  if (!url) return null;
  for (const rule of COOKIE_RULES) {
    if (rule.pattern.test(url)) {
      const v = process.env[rule.envVar];
      return v && v.trim() ? v.trim() : null;
    }
  }
  return null;
}

// Header bundle to merge into fetch() calls. Returns {} when no auth applies,
// so this is safe to spread on every request.
export function authHeadersForUrl(url: string): Record<string, string> {
  const cookie = authCookieForUrl(url);
  return cookie ? { Cookie: cookie } : {};
}

// Diagnostic — surfaces which publications have a cookie configured (without
// leaking the cookie value). Used by /api/news-feed/auth-cookies/health.
export function authCookieStatus(): Array<{ label: string; envVar: string; configured: boolean }> {
  return COOKIE_RULES.map(r => ({
    label: r.label,
    envVar: r.envVar,
    configured: !!(process.env[r.envVar] && process.env[r.envVar]!.trim()),
  }));
}
