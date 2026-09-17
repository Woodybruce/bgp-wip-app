import { createHash } from "node:crypto";
import { getBrandIdentity } from "./brand-identity";

const REVIEW_FIELDS = ["description", "industry", "head_office_address", "linkedin_url"] as const;
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function readBrandFactReview(company: any) {
  const required = company.ai_generated_fields?.brand_identity?.previousFactsNeedReview === true;
  const facts = Object.fromEntries(REVIEW_FIELDS.map(field => [field, company[field] ?? null]));
  const identity = getBrandIdentity(company);
  const token = createHash("sha256").update(JSON.stringify(canonical({ identity: identity.fingerprint, required, facts }))).digest("hex");
  return { required, token, facts };
}

export function prepareBrandFactReview(company: any, input: any, actor: string | null, now = new Date()) {
  const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
  const current = readBrandFactReview(company);
  const identity = getBrandIdentity(company);
  if (!actor) fail("Sign in before reviewing brand facts.", 401);
  if (identity.status !== "verified") fail("Confirm the official website before reviewing these facts.", 409);
  if (!current.required || input?.token !== current.token) fail("The brand identity or retained facts changed. Reload the review before saving.", 409);
  if (input.confirmed !== true) fail("Confirm that you have checked these facts against the official brand.");
  const text = (value: any, label: string, max: number, required = false) => {
    if (value !== null && typeof value !== "string") fail(`${label} must be text.`);
    const trimmed = (value || "").trim();
    if (trimmed.length > max || (required && !trimmed)) fail(`Enter ${label.toLowerCase()}${required ? "" : " or leave it blank"} (up to ${max} characters).`);
    return trimmed || null;
  };
  const description = text(input.description, "Description", 4000, true);
  const industry = text(input.industry, "Industry", 300, true);
  const linkedin = text(input.linkedin_url, "LinkedIn company page", 1000);
  if (linkedin) {
    let parsed: URL;
    try { parsed = new URL(linkedin); } catch { fail("Enter the full LinkedIn company page URL, or leave it blank."); }
    if (parsed!.protocol !== "https:" || parsed!.username || parsed!.password || parsed!.port
      || !/^(?:[a-z]{2,3}\.)?linkedin\.com$/i.test(parsed!.hostname)
      || !/^\/company\/[^/]+\/?$/.test(parsed!.pathname)) fail("Use a LinkedIn company page on linkedin.com, or leave it blank.");
  }
  let address: Record<string, string> | null = null;
  if (input.head_office_address !== null) {
    if (!input.head_office_address || typeof input.head_office_address !== "object" || Array.isArray(input.head_office_address)) fail("Enter a head office address or leave it blank.");
    address = {};
    for (const field of ["street", "city", "region", "postcode", "country"]) {
      const value = text(input.head_office_address[field] ?? null, "Head office address", 500);
      if (value) address[field] = value;
    }
    if (!Object.keys(address).length) address = null;
  }
  const facts = { description, industry, head_office_address: address, linkedin_url: linkedin };
  const review = { at: now.toISOString(), actor, identity: identity.fingerprint, previous: current.facts, facts };
  const metadata: Record<string, any> = { ...(company.ai_generated_fields || {}), brand_identity: {
    ...company.ai_generated_fields.brand_identity, previousFactsNeedReview: false,
    factReview: { at: review.at, actor, identity: identity.fingerprint, fields: [...REVIEW_FIELDS] },
  } };
  for (const field of REVIEW_FIELDS) delete metadata[field];
  return { fields: { ...facts, ai_generated_fields: metadata }, review };
}
