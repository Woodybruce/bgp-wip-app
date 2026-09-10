import { getBrandIdentity, normalizeBrandDomain } from "./brand-identity";
import { randomUUID } from "node:crypto";

export function isOfficialBrandWebsite(company: any, website: unknown): boolean {
  const identity = getBrandIdentity(company);
  const host = normalizeBrandDomain(website);
  return identity.status === "verified" && !!host && !!identity.domain
    && (host === identity.domain || host.endsWith(`.${identity.domain}`));
}

export function brandImageIdentityTag(company: any): string {
  return `brand-identity:${getBrandIdentity(company).fingerprint}`;
}

export function publishableBrandImage(company: any, image: any): boolean {
  if (image.company_id && image.company_id !== company.id) return false;
  const tags = Array.isArray(image.tags) ? image.tags : [];
  if (tags.includes("identity-review")) return false;
  const automatic = ["brand-auto", "logo-dev-cache", "website-refresh", "bulk-import"].some(tag => tags.includes(tag));
  if (!automatic) return image.company_id === company.id
    || (!image.company_id && image.brand_name?.toLowerCase() === company.name?.toLowerCase());
  if (tags.includes("brand-hero")) return image.company_id === company.id;
  return image.company_id === company.id && getBrandIdentity(company).status === "verified"
    && tags.includes(brandImageIdentityTag(company));
}

export function publishableBrandStore(company: any, store: any): boolean {
  if (!["google_places", "google_places_verified", "identity_review"].includes(store.source_type)) return true;
  if (store.source_type !== "google_places_verified") return false;
  try {
    const provenance = JSON.parse(store.notes || "{}").brandIdentity;
    return getBrandIdentity(company).status === "verified"
      && provenance?.fingerprint === getBrandIdentity(company).fingerprint
      && isOfficialBrandWebsite(company, provenance?.website);
  } catch { return false; }
}

export function prepareBrandIdentityUpdate(company: any, input: any, actor: string | null, now = new Date()): { fields: Record<string, any>; identityChanged: boolean } {
  const domain = normalizeBrandDomain(input.domain);
  if (!domain) throw new Error("Enter the official website, such as cookfood.net.");
  const aliases = input.aliases === undefined ? company.ai_generated_fields?.brand_identity?.aliases || [] : input.aliases;
  if (!Array.isArray(aliases) || aliases.length > 20 || aliases.some(v => typeof v !== "string" || !v.trim() || v.length > 150)) {
    throw new Error("Use up to 20 trading or legal names, each under 150 characters.");
  }
  const country = input.country === undefined ? company.ai_generated_fields?.brand_identity?.country || null : input.country;
  if (country !== null && (typeof country !== "string" || country.length > 80)) throw new Error("Enter a valid country.");
  const metadata: Record<string, any> = { ...(company.ai_generated_fields || {}), brand_identity: {
    ...(company.ai_generated_fields?.brand_identity || {}),
    status: "verified", domain, aliases: [...new Set(aliases.map((v: string) => v.trim()))], country,
    verifiedAt: now.toISOString(), verifiedBy: actor,
  } };
  const fields: Record<string, any> = { domain, domain_url: `https://${domain}`, ai_generated_fields: metadata };
  if (Object.hasOwn(company, "website")) fields.website = `https://${domain}`;
  const identityChanged = getBrandIdentity(company).fingerprint !== getBrandIdentity({ ...company, ...fields }).fingerprint;
  if (identityChanged) {
    // Only explicitly attributed automated facts are cleared; unmarked human
    // facts stay available for review and correction.
    for (const key of ["description", "industry", "head_office_address", "employee_count", "annual_revenue", "founded_year", "phone", "linkedin_url",
      "concept_pitch", "store_count", "rollout_status", "backers", "instagram_handle", "tiktok_handle", "x_handle", "dept_store_presence", "franchise_activity"]) {
      if (metadata[key] && Object.hasOwn(company, key)) { fields[key] = null; delete metadata[key]; }
    }
    for (const key of ["brand_analysis", "brand_analysis_at", "ai_competitors", "ai_competitors_at", "menu_intel", "menu_intel_at", "last_enriched_at"]) {
      if (Object.hasOwn(company, key)) fields[key] = null;
    }
    metadata.brand_identity.previousFactsNeedReview = true;
    delete metadata.backers_detail;
  }
  delete metadata.domain; delete metadata.domain_url;
  return { fields, identityChanged };
}

/** Caller owns the transaction, including the company update that follows. */
export async function quarantineBrandIdentityDependents(db: { query: Function }, company: any, actor: string | null): Promise<void> {
  const stores = (await db.query("SELECT * FROM brand_stores WHERE brand_company_id = $1 AND source_type IN ('google_places', 'google_places_verified')", [company.id])).rows;
  const images = (await db.query("SELECT id, tags FROM image_studio_images WHERE company_id = $1 AND tags && ARRAY['brand-auto','logo-dev-cache','website-refresh','bulk-import']::text[] AND NOT ('brand-hero' = ANY(tags))", [company.id])).rows;
  const signals = (await db.query("SELECT id, ai_relevant FROM brand_signals WHERE brand_company_id = $1 AND (ai_generated = true OR source = 'apollo')", [company.id])).rows;
  await db.query("INSERT INTO system_settings(key, value) VALUES ($1, $2::jsonb)", [
    `brand-identity-history:${company.id}:${randomUUID()}`,
    JSON.stringify({ at: new Date().toISOString(), actor, company, stores, images, signals }),
  ]);
  await db.query("UPDATE brand_stores SET source_type = 'identity_review', updated_at = now() WHERE id::text = ANY($1::text[])", [stores.map((s: any) => s.id)]);
  await db.query("UPDATE image_studio_images SET tags = array_append(tags, 'identity-review') WHERE id::text = ANY($1::text[])", [images.map((i: any) => i.id)]);
  await db.query("UPDATE brand_signals SET ai_relevant = false WHERE id::text = ANY($1::text[])", [signals.map((s: any) => s.id)]);
}
