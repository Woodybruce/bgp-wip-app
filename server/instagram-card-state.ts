// ─────────────────────────────────────────────────────────────────────────
// Instagram card state (Delivery 4, Task 4).
//
// Pure state matrix for GET /api/brand/:companyId/instagram so the UI can
// distinguish "feed service isn't configured", "feed creation failed at the
// provider", "not connected", and "connected but no posts yet" — today all
// four collapse into an empty card that reads as a quiet account.
//
// Feed eligibility (isFeedEligibleCompany) widens feed provisioning beyond
// tenant brands: landlord-shaped company types qualify only when the brand
// identity is verified (the handle hangs off a confirmed official identity).
// Tenants keep today's behaviour exactly.
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

// Landlord-shaped company types — the same vocabulary as the isLandlord SQL
// rule in brand-profile.ts. Anything tenant-prefixed stays eligible exactly
// as before; landlord-shaped rows must carry a verified brand identity.
const LANDLORD_FEED_TYPES = new Set(["landlord", "landlord/freeholder", "investor", "reit", "developer", "fund"]);

export function isFeedEligibleCompany(companyType: string | null | undefined, identityVerified: boolean): boolean {
  const t = (companyType || "").trim().toLowerCase();
  if (!t) return false;
  if (t.startsWith("tenant")) return true;
  if (LANDLORD_FEED_TYPES.has(t)) return identityVerified;
  return false;
}
