// Authenticated press scraping — injects subscriber cookies for paywalled
// publications so og:image extraction + (eventually) full-text scraping
// returns the real article page rather than the paywall stub.
//
// Cookies can be set two ways:
//   1. In-app: News → Sources → "Paywall logins" (stored in system_settings,
//      no redeploy needed). This takes priority.
//   2. Env vars (BOF_AUTH_COOKIE etc.) as a fallback.
//
// Each value is the FULL cookie header string from a logged-in browser
// session, e.g. "session_id=abc; subscriber=true; _ga=GA1.2.…".
// Cookies typically last 30-90 days; refresh in the Sources panel when a
// publication's images start returning paywall stubs again.

import { db } from "./db";
import { systemSettings } from "@shared/schema";
import { eq } from "drizzle-orm";

const STORAGE_KEY = "integration:paywall_cookies";

export const COOKIE_RULES: Array<{ pattern: RegExp; envVar: string; label: string; domain: string }> = [
  { pattern: /\b(greenstreetnews\.com)\b/i,   envVar: "GREENSTREET_AUTH_COOKIE",   label: "Green Street News",   domain: "greenstreetnews.com" },
  { pattern: /\b(propertyweek\.com)\b/i,      envVar: "PROPERTYWEEK_AUTH_COOKIE",  label: "Property Week",       domain: "propertyweek.com" },
  { pattern: /\b(businessoffashion\.com)\b/i, envVar: "BOF_AUTH_COOKIE",           label: "Business of Fashion", domain: "businessoffashion.com" },
  { pattern: /\b(drapersonline\.com)\b/i,     envVar: "DRAPERS_AUTH_COOKIE",       label: "Drapers",             domain: "drapersonline.com" },
  { pattern: /\b(retailweek\.com)\b/i,        envVar: "RETAILWEEK_AUTH_COOKIE",    label: "Retail Week",         domain: "retailweek.com" },
  { pattern: /\b(voguebusiness\.com)\b/i,     envVar: "VOGUEBUSINESS_AUTH_COOKIE", label: "Vogue Business",      domain: "voguebusiness.com" },
];

// In-memory cache of DB-stored cookies (envVar -> cookie string). Loaded at
// startup and refreshed on every save so authCookieForUrl stays synchronous
// (the scrape paths that call it are sync).
let dbCookies: Record<string, string> = {};

// Load DB-stored cookies into the in-memory cache. Call once at startup.
export async function loadPaywallCookies(): Promise<void> {
  try {
    const rows = await db.select().from(systemSettings).where(eq(systemSettings.key, STORAGE_KEY)).limit(1);
    const stored = rows[0]?.value as Record<string, string> | null | undefined;
    dbCookies = stored && typeof stored === "object" ? stored : {};
  } catch (err: any) {
    console.warn("[paywall cookies] DB load failed, env-only:", err?.message);
    dbCookies = {};
  }
}

// Returns a Cookie header value for the given URL, or null if we don't have
// (or aren't configured for) a subscription for its publisher. DB takes
// priority over the env var.
export function authCookieForUrl(url: string): string | null {
  if (!url) return null;
  for (const rule of COOKIE_RULES) {
    if (rule.pattern.test(url)) {
      const fromDb = dbCookies[rule.envVar];
      if (fromDb && fromDb.trim()) return fromDb.trim();
      const fromEnv = process.env[rule.envVar];
      return fromEnv && fromEnv.trim() ? fromEnv.trim() : null;
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

// Save a cookie for a publication (by envVar key) to the DB + cache.
export async function setPaywallCookie(envVar: string, cookie: string): Promise<void> {
  if (!COOKIE_RULES.some(r => r.envVar === envVar)) throw new Error("Unknown publication");
  dbCookies = { ...dbCookies, [envVar]: (cookie || "").trim() };
  const existing = await db.select().from(systemSettings).where(eq(systemSettings.key, STORAGE_KEY)).limit(1);
  if (existing.length > 0) {
    await db.update(systemSettings).set({ value: dbCookies, updatedAt: new Date() }).where(eq(systemSettings.key, STORAGE_KEY));
  } else {
    await db.insert(systemSettings).values({ key: STORAGE_KEY, value: dbCookies });
  }
}

// Remove a publication's DB cookie (falls back to env var if one is set).
export async function clearPaywallCookie(envVar: string): Promise<void> {
  const { [envVar]: _removed, ...rest } = dbCookies;
  dbCookies = rest;
  const existing = await db.select().from(systemSettings).where(eq(systemSettings.key, STORAGE_KEY)).limit(1);
  if (existing.length > 0) {
    await db.update(systemSettings).set({ value: dbCookies, updatedAt: new Date() }).where(eq(systemSettings.key, STORAGE_KEY));
  }
}

// Diagnostic — surfaces which publications have a cookie configured (without
// leaking the cookie value) and where it came from. Drives the Sources panel.
export function authCookieStatus(): Array<{ label: string; envVar: string; domain: string; configured: boolean; source: "db" | "env" | "none" }> {
  return COOKIE_RULES.map(r => {
    const fromDb = dbCookies[r.envVar];
    if (fromDb && fromDb.trim()) return { label: r.label, envVar: r.envVar, domain: r.domain, configured: true, source: "db" as const };
    const fromEnv = process.env[r.envVar];
    if (fromEnv && fromEnv.trim()) return { label: r.label, envVar: r.envVar, domain: r.domain, configured: true, source: "env" as const };
    return { label: r.label, envVar: r.envVar, domain: r.domain, configured: false, source: "none" as const };
  });
}
