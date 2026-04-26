/**
 * Shared ScraperAPI helper. Wraps fetch() with sane defaults for routing
 * UK web traffic through ScraperAPI's residential proxies — the same way
 * the planning-docs scraper already does, but as a reusable function so
 * other modules (PIPnet, TRL, Companies House PDFs, Rightmove etc) can
 * delegate without copy-pasting the URL-building boilerplate.
 *
 * BGP is on the Business plan which includes UK geotargeting, premium
 * residential IPs, and 50+ concurrency. Defaults below assume that —
 * downgrade callers (or the plan) and they'll keep working but with
 * generic IPs.
 *
 * Two patterns:
 *
 *   1) **Stateless single fetch** — `scraperFetch(url, opts)`.
 *      Direct replacement for `fetch()` when you need the response once.
 *
 *   2) **Sticky session** — `new ScraperSession()` + `.fetch(url, opts)`.
 *      Pins all calls to the same upstream proxy IP via ScraperAPI's
 *      `session_number` param. Critical for any site that keeps state in
 *      cookies behind the proxy (PIPnet's JSESSIONID, TRL's Memberstack
 *      session, Idox's WAF token). Without this, every request rotates
 *      to a fresh IP and the origin throws away your cookie.
 *
 * Why not do this directly with fetch+proxy header? ScraperAPI's API is
 * URL-based (you pass the target URL as a query param), not a forward
 * proxy, so the request body still goes through node fetch — we just
 * rewrite the URL.
 */

const SCRAPERAPI_ENDPOINT = "https://api.scraperapi.com/";

export interface ScraperOptions {
  /** Use ScraperAPI's premium residential pool. Defaults true on Business plan. */
  premium?: boolean;
  /** Run a headless browser before returning HTML (for JS-rendered pages). Off by default. */
  render?: boolean;
  /** Geotarget UK IPs (Business plan and above). Defaults true. */
  uk?: boolean;
  /** Forward the request's headers (Cookie, Authorization, etc) to the origin. Defaults true. */
  keepHeaders?: boolean;
  /** Sticky session number — same number = same upstream IP. Used internally by ScraperSession. */
  sessionNumber?: number;
  /** Per-request timeout in ms. Default 30s for non-render, 60s for render. */
  timeoutMs?: number;
}

function buildScraperUrl(targetUrl: string, opts: ScraperOptions = {}): string {
  const apiKey = process.env.SCRAPERAPI_KEY;
  if (!apiKey) throw new Error("SCRAPERAPI_KEY env var is not set");
  const params = new URLSearchParams({
    api_key: apiKey,
    url: targetUrl,
  });
  if (opts.premium !== false) params.set("premium", "true");
  if (opts.render === true) params.set("render", "true");
  if (opts.uk !== false) params.set("country_code", "uk");
  if (opts.keepHeaders !== false) params.set("keep_headers", "true");
  if (opts.sessionNumber != null) params.set("session_number", String(opts.sessionNumber));
  return `${SCRAPERAPI_ENDPOINT}?${params.toString()}`;
}

/**
 * Stateless fetch via ScraperAPI. Same shape as global fetch.
 *
 *   const res = await scraperFetch("https://idoxpa.westminster.gov.uk/...", { render: true });
 *
 * Headers on the RequestInit are forwarded to the origin (cookies,
 * referer, user-agent etc) when keepHeaders defaults to true.
 */
export async function scraperFetch(
  targetUrl: string,
  init: RequestInit & ScraperOptions = {},
): Promise<Response> {
  const { premium, render, uk, keepHeaders, sessionNumber, timeoutMs, ...fetchInit } = init;
  const proxiedUrl = buildScraperUrl(targetUrl, { premium, render, uk, keepHeaders, sessionNumber });
  const defaultTimeout = render ? 60000 : 30000;
  return fetch(proxiedUrl, {
    ...fetchInit,
    signal: fetchInit.signal ?? AbortSignal.timeout(timeoutMs ?? defaultTimeout),
  });
}

/**
 * Sticky session — every fetch through this instance hits the same
 * upstream proxy IP, so cookies set by the origin persist for the life
 * of the session. Generates a random session_number on construction.
 *
 *   const session = new ScraperSession();
 *   await session.fetch(loginUrl, { method: "POST", body: ... });   // sets JSESSIONID
 *   await session.fetch(dataUrl, { headers: { Cookie: "JSESSIONID=..." } });  // re-uses it
 *
 * Sessions persist for ~10 minutes on ScraperAPI's side (long enough for
 * a typical multi-page scrape).
 */
export class ScraperSession {
  readonly sessionNumber: number;
  constructor(sessionNumber?: number) {
    // ScraperAPI accepts any integer — use a random 32-bit value so two
    // concurrent sessions don't collide.
    this.sessionNumber = sessionNumber ?? Math.floor(Math.random() * 0x7fffffff);
  }
  fetch(targetUrl: string, init: RequestInit & ScraperOptions = {}): Promise<Response> {
    return scraperFetch(targetUrl, { ...init, sessionNumber: this.sessionNumber });
  }
}

/** True iff SCRAPERAPI_KEY is set. Useful for callers that want to fall back to direct fetch. */
export function isScraperApiAvailable(): boolean {
  return !!process.env.SCRAPERAPI_KEY;
}
