import { createHash } from "node:crypto";

export type BrandIdentity = {
  status: "verified" | "review";
  domain: string | null;
  aliases: string[];
  country: string | null;
  fingerprint: string;
  reason: string | null;
};
export type BrandProviderMatch = {
  status: "matched" | "no_match" | "blocked";
  reason: string | null;
  fingerprint: string;
};

export function normalizeBrandDomain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const raw = value.trim();
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}$/.test(host)) return null;
    return host;
  } catch { return null; }
}

function normalizedName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z\d]+/g, " ").trim()
    .replace(/(?:\s+(?:limited|ltd|plc|llp|incorporated|inc|corporation|corp))+$/, "").trim();
}

function country(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const c = value.trim().toLowerCase();
  if (["uk", "gb", "gbr", "united kingdom", "great britain", "england", "scotland", "wales", "northern ireland"].includes(c)) return "gb";
  if (["us", "usa", "united states", "united states of america"].includes(c)) return "us";
  if (["cn", "chn", "china", "people s republic of china", "people's republic of china"].includes(c)) return "cn";
  return c;
}

export function getBrandIdentity(company: any): BrandIdentity {
  const saved = company?.ai_generated_fields?.brand_identity;
  const domains = [...new Set([company?.domain, company?.domain_url, company?.website]
    .map(normalizeBrandDomain).filter((d): d is string => !!d))];
  const domain = normalizeBrandDomain(saved?.domain) || domains[0] || null;
  const names = [company?.name, company?.uk_entity_name,
    ...(Array.isArray(company?.trading_entities) ? company.trading_entities.map((t: any) => typeof t === "string" ? t : t?.name) : []),
    ...(Array.isArray(saved?.aliases) ? saved.aliases : [])];
  const aliases = [...new Set(names.filter((v): v is string => typeof v === "string" && !!v.trim()).map(v => v.trim()))].slice(0, 100);
  const countryCode = country(saved?.country);
  const reason = saved?.status !== "verified" ? "Confirm the brand's official website before refreshing company data."
    : !domain || domains.length !== 1 || domains[0] !== domain ? "The website has changed or conflicts with the verified brand identity."
    : !aliases.some(normalizedName) ? "Add the brand name before verifying its identity." : null;
  const status = reason ? "review" : "verified";
  const fingerprint = createHash("sha256").update(JSON.stringify({ id: company?.id || null, status, domain,
    names: [...new Set(aliases.map(normalizedName).filter(Boolean))].sort(), country: countryCode })).digest("hex");
  return { status, domain, aliases, country: countryCode, fingerprint, reason };
}

function providerIdentity(candidate: any) {
  return {
    name: candidate?.name || candidate?.organization_name,
    domains: [...new Set([candidate?.primary_domain, candidate?.email_domain, candidate?.domain, candidate?.website_url, candidate?.website]
      .map(normalizeBrandDomain).filter((d): d is string => !!d))],
    country: country(candidate?.country_code || candidate?.country || (typeof candidate?.hq === "string" ? candidate.hq.split(",").at(-1) : null)),
  };
}

export function assessBrandProviderMatch(company: any, candidate: any): BrandProviderMatch {
  const identity = getBrandIdentity(company);
  const result = (status: BrandProviderMatch["status"], reason: string | null): BrandProviderMatch => ({ status, reason, fingerprint: identity.fingerprint });
  if (identity.status !== "verified") return result("blocked", identity.reason);
  if (!candidate || typeof candidate !== "object") return result("no_match", "No matching company was returned by this source.");
  const provider = providerIdentity(candidate);
  if (provider.domains.length !== 1 || provider.domains[0] !== identity.domain) {
    return result("blocked", "The source's website does not match the verified brand website.");
  }
  if (!normalizedName(provider.name) || !identity.aliases.some(alias => normalizedName(alias) === normalizedName(provider.name))) {
    return result("blocked", "The source's company name is not the brand or one of its approved trading names.");
  }
  if (identity.country && provider.country && identity.country !== provider.country) {
    return result("blocked", "The source's country conflicts with the verified brand identity.");
  }
  return result("matched", null);
}

export function selectBrandProviderMatch(company: any, candidates: unknown): BrandProviderMatch & { candidate: any | null } {
  const identity = getBrandIdentity(company);
  if (identity.status !== "verified") return { ...assessBrandProviderMatch(company, null), candidate: null };
  const rows = Array.isArray(candidates) ? candidates.filter(row => row && typeof row === "object") : [];
  const matched = rows.filter(row => assessBrandProviderMatch(company, row).status === "matched");
  if (matched.length === 1) return { ...assessBrandProviderMatch(company, matched[0]), candidate: matched[0] };
  if (matched.length > 1) return { status: "blocked", reason: "More than one source company matches. Choose the correct organisation before using its data.", fingerprint: identity.fingerprint, candidate: null };
  return { ...(rows.length ? assessBrandProviderMatch(company, rows[0]) : assessBrandProviderMatch(company, null)), candidate: null };
}

export function stampBrandProviderPayload(payload: any, match: BrandProviderMatch, checkedAt = new Date().toISOString()): any {
  return { ...(match.status === "matched" ? payload : {}),
    _brandIdentity: { status: match.status, reason: match.reason, fingerprint: match.fingerprint, checkedAt } };
}

export function publicBrandProviderPayload(company: any, payload: any): any | null {
  const match = assessBrandProviderMatch(company, payload);
  if (match.status !== "matched" || payload?._brandIdentity?.status !== "matched"
    || payload._brandIdentity.fingerprint !== match.fingerprint) return null;
  return payload;
}

export function brandProviderCacheResult(company: any, cached: any): BrandProviderMatch & { payload: any | null } {
  const identity = getBrandIdentity(company);
  const payload = publicBrandProviderPayload(company, cached);
  if (payload) return { ...assessBrandProviderMatch(company, payload), payload };
  if (identity.status !== "verified") return { status: "blocked", reason: identity.reason, fingerprint: identity.fingerprint, payload: null };
  if (cached?._brandIdentity?.fingerprint === identity.fingerprint && ["no_match", "blocked"].includes(cached._brandIdentity.status)) {
    return { status: cached._brandIdentity.status, reason: cached._brandIdentity.reason || "This source needs review.", fingerprint: identity.fingerprint, payload: null };
  }
  return { status: "blocked", reason: "Refresh this source against the verified brand identity before using its data.", fingerprint: identity.fingerprint, payload: null };
}
