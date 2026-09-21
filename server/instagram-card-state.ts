// ─────────────────────────────────────────────────────────────────────────
// Instagram card state (Delivery 4, Task 4).
//
// Pure state matrix for GET /api/brand/:companyId/instagram so the UI can
// distinguish "feed service isn't configured", "feed creation failed at the
// provider", "not connected", and "connected but no posts yet" — today all
// four collapse into an empty card that reads as a quiet account.
//
// Feed eligibility stays tenant-only: Woody (2026-09-21) took Instagram off
// landlord boards entirely ("not of interest") — landlords get no feed
// provisioning, no handle backfill, no card. Tenants keep today's behaviour
// exactly; the identityVerified argument is accepted for caller compatibility
// but no longer widens eligibility.
// ─────────────────────────────────────────────────────────────────────────

export type InstagramCardStatus = "not_configured" | "no_handle" | "feed_error" | "handle_only" | "feed";

export interface InstagramCardStateInput {
  configured: boolean;             // RSS.app credentials present
  handle: string | null;           // cleaned handle, null when none on file
  hasFeedSource: boolean;          // live rssapp_instagram news_sources row
  lastSyncedAt: string | null;     // MAX(published_at) over the source's articles
  failure: { attempts: number; lastError: string | null } | null;
}

export interface InstagramCardState {
  status: InstagramCardStatus;
  externalUrl: string | null;      // working instagram.com link whenever a handle exists
  lastSyncedAt: string | null;
  error: string | null;            // specific provider error, feed_error only
  attempts: number | null;
}

export function instagramCardState(input: InstagramCardStateInput): InstagramCardState {
  const externalUrl = input.handle ? `https://instagram.com/${input.handle}` : null;
  const base = { externalUrl, lastSyncedAt: null as string | null, error: null as string | null, attempts: null as number | null };

  if (!input.handle) return { ...base, status: "no_handle" };
  if (!input.configured) return { ...base, status: "not_configured" };
  if (input.hasFeedSource) return { ...base, status: "feed", lastSyncedAt: input.lastSyncedAt };
  if (input.failure) {
    return {
      ...base,
      status: "feed_error",
      error: input.failure.lastError || "Feed creation failed",
      attempts: input.failure.attempts,
    };
  }
  return { ...base, status: "handle_only" };
}

// Tenant-only per Woody's call (see header): landlord-shaped company types
// are never feed-eligible, whatever their identity status.
export function isFeedEligibleCompany(companyType: string | null | undefined, _identityVerified: boolean): boolean {
  const t = (companyType || "").trim().toLowerCase();
  return t.startsWith("tenant");
}
