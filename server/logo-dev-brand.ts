// ─────────────────────────────────────────────────────────────────────────
// logo.dev Brand API enrichment.
//
// One GET https://api.logo.dev/brand/{domain} returns a structured brand
// profile: canonical name, description, logo/brandmark CDN URLs, dominant
// colours and social links. We use it as the FIRST enrichment source —
// deterministic and ~1¢/lookup vs a Claude+Perplexity pass — to fill blank
// socials (instagram/tiktok/x handles feed the Brand Hunter score),
// description and linkedin. Fill-blanks only: anything already set (by a
// human or a previous source) is never overwritten.
//
// Auth: LOGO_DEV_SECRET_KEY (sk_..., server-side only — distinct from the
// publishable LOGO_DEV_TOKEN used for logo images). 5 credits per request,
// 402 when the plan's credits run out — treated as "not configured" until
// the next window rather than an error.
// ─────────────────────────────────────────────────────────────────────────
import { pool } from "./db";

const API_BASE = "https://api.logo.dev/brand";

export function isLogoDevBrandConfigured(): boolean {
  return !!process.env.LOGO_DEV_SECRET_KEY;
}

let creditsExhaustedUntil = 0; // back off for an hour on 402 instead of burning requests

function cleanDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].trim().toLowerCase();
  return d.includes(".") ? d : null;
}

export async function fetchLogoDevBrand(domain: string): Promise<any | null> {
  const key = process.env.LOGO_DEV_SECRET_KEY;
  if (!key || Date.now() < creditsExhaustedUntil) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000); // docs: allow up to 30s
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(domain)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (res.status === 402) {
      creditsExhaustedUntil = Date.now() + 60 * 60 * 1000;
      console.warn("[logo-dev-brand] out of credits (402) — backing off for 1h");
      return null;
    }
    if (!res.ok) return null;
    return await res.json();
  } catch (e: any) {
    console.warn(`[logo-dev-brand] ${domain}: ${e?.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Socials arrive either as {platform: url} or [{platform/name, url/link}] —
// normalise to a platform→url map, keys lowercased.
function normaliseSocials(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  if (Array.isArray(raw)) {
    for (const s of raw) {
      const platform = String(s?.platform || s?.name || "").toLowerCase();
      const url = s?.url || s?.link;
      if (platform && typeof url === "string") out[platform] = url;
    }
  } else if (typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") out[k.toLowerCase()] = v;
      else if (v && typeof (v as any).url === "string") out[k.toLowerCase()] = (v as any).url;
    }
  }
  return out;
}

function handleFromUrl(url: string): string | null {
  const m = url.match(/(?:instagram\.com|tiktok\.com|twitter\.com|x\.com)\/@?([A-Za-z0-9._-]+)/i);
  return m ? m[1].replace(/^@/, "") : null;
}

// Fill blank fields on a crm_companies row from the Brand API. Never
// overwrites; stamps ai_generated_fields so a later human edit takes over
// as source of truth (same contract as brand-enrichment.ts). Skips the API
// call entirely when nothing is blank — each request costs credits.
export async function enrichCompanyFromLogoDev(companyId: string): Promise<{ updated: string[] } | null> {
  if (!isLogoDevBrandConfigured()) return null;
  const q = await pool.query(
    `SELECT id, name, domain, domain_url, description, instagram_handle,
            tiktok_handle, x_handle, linkedin_url, ai_generated_fields
       FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const c = q.rows[0];
  if (!c) return null;
  const domain = cleanDomain(c.domain) || cleanDomain(c.domain_url);
  if (!domain) return null;

  const blank = (v: any) => v === null || v === undefined || String(v).trim() === "";
  const targets = ["description", "instagram_handle", "tiktok_handle", "x_handle", "linkedin_url"] as const;
  if (!targets.some(f => blank(c[f]))) return { updated: [] };

  const brand = await fetchLogoDevBrand(domain);
  if (!brand) return null;

  const socials = normaliseSocials(brand.socials);
  const candidates: Record<string, string | null> = {
    description: typeof brand.description === "string" ? brand.description.trim() : null,
    instagram_handle: socials.instagram ? handleFromUrl(socials.instagram) : null,
    tiktok_handle: socials.tiktok ? handleFromUrl(socials.tiktok) : null,
    x_handle: (socials.x || socials.twitter) ? handleFromUrl(socials.x || socials.twitter) : null,
    linkedin_url: socials.linkedin || null,
  };

  const aiFields: Record<string, any> = c.ai_generated_fields || {};
  const sets: string[] = [];
  const vals: any[] = [];
  const updated: string[] = [];
  let i = 1;
  for (const field of targets) {
    if (!blank(c[field])) continue;
    const v = candidates[field];
    if (!v) continue;
    sets.push(`${field} = $${i++}`);
    vals.push(v);
    aiFields[field] = `logo.dev ${new Date().toISOString()}`;
    updated.push(field);
  }
  if (updated.length === 0) return { updated: [] };

  sets.push(`ai_generated_fields = $${i++}`, `updated_at = now()`);
  vals.push(JSON.stringify(aiFields), companyId);
  await pool.query(`UPDATE crm_companies SET ${sets.join(", ")} WHERE id = $${i}`, vals);
  console.log(`[logo-dev-brand] ${c.name}: filled ${updated.join(", ")}`);
  return { updated };
}

// Extract logo + brand colours from a logo.dev Brand API payload and stamp
// them on a company so the client app can skin itself in the client's own
// brand ("their version of the app"). The Brand API returns logos + colours
// in a few shapes across accounts; parse defensively.
function pickLogoUrl(brand: any): string | null {
  if (typeof brand?.logo === "string") return brand.logo;
  const logos = Array.isArray(brand?.logos) ? brand.logos : [];
  // Prefer a light-theme wordmark/icon that reads on a dark sidebar; else first.
  const byTheme = logos.find((l: any) => /light/i.test(l?.theme || "")) || logos[0];
  return byTheme?.url || byTheme?.src || (typeof logos[0] === "string" ? logos[0] : null) || null;
}
function pickColours(brand: any): { primary: string | null; secondary: string | null } {
  const raw = brand?.colors ?? brand?.colours ?? [];
  const arr: any[] = Array.isArray(raw) ? raw : Object.values(raw || {});
  const hexOf = (c: any): string | null => {
    const h = typeof c === "string" ? c : (c?.hex || c?.value || c?.color);
    return typeof h === "string" && /^#?[0-9a-f]{6}$/i.test(h.trim()) ? (h.trim().startsWith("#") ? h.trim() : `#${h.trim()}`) : null;
  };
  const typed = (want: RegExp) => arr.find((c: any) => typeof c === "object" && want.test(String(c?.type || c?.name || "")));
  const primary = hexOf(typed(/accent|primary|brand|base|dark/i)) || hexOf(arr[0]) || null;
  const secondary = hexOf(typed(/secondary|light|background|muted/i)) || hexOf(arr.find((c: any) => hexOf(c) && hexOf(c) !== primary)) || null;
  return { primary, secondary };
}

export async function fetchBrandThemeForCompany(companyId: string, opts: { force?: boolean } = {}): Promise<{
  logoUrl: string | null; primary: string | null; secondary: string | null;
} | null> {
  if (!isLogoDevBrandConfigured()) return null;
  const q = await pool.query(
    `SELECT id, name, domain, domain_url, logo_url, brand_primary_color, brand_secondary_color FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const c = q.rows[0];
  if (!c) return null;
  // Fill-blanks unless forced (a manual refresh from the company page).
  if (!opts.force && c.logo_url && c.brand_primary_color) {
    return { logoUrl: c.logo_url, primary: c.brand_primary_color, secondary: c.brand_secondary_color };
  }
  const domain = cleanDomain(c.domain) || cleanDomain(c.domain_url);
  if (!domain) return null;
  const brand = await fetchLogoDevBrand(domain);
  if (!brand) return null;
  const logoUrl = pickLogoUrl(brand);
  const { primary, secondary } = pickColours(brand);
  await pool.query(
    `UPDATE crm_companies
        SET logo_url = COALESCE($1, logo_url),
            brand_primary_color = COALESCE($2, brand_primary_color),
            brand_secondary_color = COALESCE($3, brand_secondary_color),
            updated_at = now()
      WHERE id = $4`,
    [logoUrl, primary, secondary, companyId]
  );
  console.log(`[logo-dev-brand] ${c.name}: theme logo=${!!logoUrl} primary=${primary || "—"} secondary=${secondary || "—"}`);
  return { logoUrl, primary, secondary };
}

// Bulk backfill over the brand book — brands with a domain and at least one
// blank target field. Sequential (the API allows bursts, but credits are
// the real constraint) with a hard per-run limit.
export async function runLogoDevBackfill(limit = 100, hospitalityOnly = false): Promise<{
  configured: boolean; candidates: number; processed: number; filled: number; fieldsFilled: number;
}> {
  // hospitalityOnly = the client-visible (Landsec) brand slice only.
  const sliceFilter = hospitalityOnly ? `AND company_type ~* $2` : "";
  const params: any[] = [Math.min(limit, 500)];
  if (hospitalityOnly) {
    const { CLIENT_VISIBLE_BRAND_RE } = await import("./company-scope");
    params.push(CLIENT_VISIBLE_BRAND_RE.source);
  }
  const candidatesQ = await pool.query(
    `SELECT id FROM crm_companies
      WHERE company_type ILIKE 'Tenant%' AND merged_into_id IS NULL ${sliceFilter}
        AND COALESCE(NULLIF(TRIM(COALESCE(domain, domain_url)), ''), NULL) IS NOT NULL
        AND (COALESCE(TRIM(description), '') = '' OR COALESCE(TRIM(instagram_handle), '') = ''
             OR COALESCE(TRIM(tiktok_handle), '') = '' OR COALESCE(TRIM(x_handle), '') = ''
             OR COALESCE(TRIM(linkedin_url), '') = '')
      ORDER BY is_tracked_brand DESC NULLS LAST, name
      LIMIT $1`,
    params
  );
  const stats = { configured: isLogoDevBrandConfigured(), candidates: candidatesQ.rows.length, processed: 0, filled: 0, fieldsFilled: 0 };
  if (!stats.configured) return stats;
  for (const row of candidatesQ.rows) {
    const r = await enrichCompanyFromLogoDev(row.id).catch(() => null);
    stats.processed++;
    if (r && r.updated.length > 0) { stats.filled++; stats.fieldsFilled += r.updated.length; }
  }
  return stats;
}
