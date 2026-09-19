import { getBrandIdentity } from "./brand-identity";

export type OfficialProfilePage = { url: string; text: string };
const normalized = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

export function hasOfficialProfileQuote(value: any, pages: OfficialProfilePage[]): boolean {
  return typeof value?.quote === "string" && value.quote.trim().length >= 20
    && typeof value?.url === "string" && pages.some(page => page.url === value.url
      && normalized(page.text).includes(normalized(value.quote)));
}

export function prepareOfficialProfileEvidence(company: any, output: any, pages: OfficialProfilePage[], now = new Date()) {
  const identity = getBrandIdentity(company);
  const profile = output?.official_profile;
  if (identity.status !== "verified" || typeof profile?.description !== "string" || !profile.description.trim()
    || profile.description.length > 4000 || typeof profile.industry !== "string" || !profile.industry.trim()
    || profile.industry.length > 300 || !hasOfficialProfileQuote(profile, pages)) return null;
  return { fingerprint: identity.fingerprint, checkedAt: now.toISOString(),
    description: profile.description.trim(), industry: profile.industry.trim(), url: profile.url, quote: profile.quote.trim() };
}

export function currentOfficialProfileEvidence(company: any) {
  const evidence = company?.ai_generated_fields?.official_profile;
  if (!evidence || evidence.fingerprint !== getBrandIdentity(company).fingerprint
    || typeof evidence.description !== "string" || !evidence.description.trim()
    || typeof evidence.industry !== "string" || !evidence.industry.trim()
    || typeof evidence.url !== "string" || !evidence.quote
    || !Number.isFinite(Date.parse(evidence.checkedAt)) || Date.now() - Date.parse(evidence.checkedAt) > 30 * 86400000) return null;
  return evidence;
}

export function retainedProfileFactsCorroborated(company: any, output: any, pages: OfficialProfilePage[]): boolean {
  const fields = ["description", "industry", "head_office_address", "linkedin_url"];
  const populated = fields.filter(field => company[field] != null && company[field] !== "");
  return populated.every(field => output?.retained_fact_checks?.[field]?.supported === true
    && hasOfficialProfileQuote(output.retained_fact_checks[field], pages));
}
