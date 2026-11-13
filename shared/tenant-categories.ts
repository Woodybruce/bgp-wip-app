// Canonical retail/leisure tenant-category taxonomy. Shared so the server
// (AI brief drafting) and the client (category pickers via crm-options)
// stay in sync — one list, no drift.
export const TENANT_CATEGORIES = [
  // ── Luxury ──
  "Tenant - Luxury",
  "Tenant - Luxury Accessories",
  "Tenant - Luxury Beauty",
  // ── Retail: Fashion ──
  "Tenant - Flagship Fashion",
  "Tenant - Fashion",
  "Tenant - Athleisure",
  "Tenant - Sportswear",
  "Tenant - Footwear",
  "Tenant - Accessories & Footwear",
  "Tenant - Jewellery & Watches",
  // ── Retail: Beauty ──
  "Tenant - Beauty",
  "Tenant - Skincare",
  "Tenant - Fragrance",
  // ── Retail: Home & Lifestyle ──
  "Tenant - Homewares",
  "Tenant - Lifestyle & Home",
  "Tenant - Gifts & Perfumes",
  // ── Retail: Other ──
  "Tenant - Department Store",
  "Tenant - Technology",
  "Tenant - Automotive",
  "Tenant - Telecoms",
  "Tenant - Grocery",
  "Tenant - Books & Stationery",
  "Tenant - Financial Services",
  "Tenant - Services",
  "Tenant - Retail",
  // ── Restaurants ──
  "Tenant - Fine Dining",
  "Tenant - Casual Dining",
  "Tenant - Restaurant",
  "Tenant - Quick Service",
  "Tenant - Café",
  "Tenant - Bar",
  "Tenant - Bakery",
  // ── Leisure ──
  "Tenant - Cinema",
  "Tenant - Experiential",
  "Tenant - Immersive Experience",
  "Tenant - Gaming",
  "Tenant - Family Entertainment",
  "Tenant - Leisure",
  // ── Health & Fitness ──
  "Tenant - Gym",
  "Tenant - Wellness",
  "Tenant - Yoga",
] as const;

// The hospitality / F&B / leisure / fitness slice a landlord client's CRM is
// scoped to (Landsec, 2026-08). Restaurants & cafés + leisure & entertainment
// + fitness & wellness — no fashion/beauty/luxury/retail. A client can still
// add any other brand from the global directory via their extra-brands list.
export const CLIENT_CRM_CATEGORIES = [
  // Restaurants & cafés
  "Tenant - Fine Dining", "Tenant - Casual Dining", "Tenant - Restaurant",
  "Tenant - Quick Service", "Tenant - Café", "Tenant - Bar", "Tenant - Bakery",
  // Leisure & entertainment
  "Tenant - Cinema", "Tenant - Experiential", "Tenant - Immersive Experience",
  "Tenant - Gaming", "Tenant - Family Entertainment", "Tenant - Leisure",
  // Fitness & wellness
  "Tenant - Gym", "Tenant - Wellness", "Tenant - Yoga",
] as const;

// Case-insensitive membership test for a company_type string.
export function isClientCrmCategory(companyType: string | null | undefined): boolean {
  if (!companyType) return false;
  const t = companyType.trim().toLowerCase();
  return (CLIENT_CRM_CATEGORIES as readonly string[]).some(c => c.toLowerCase() === t);
}

// What the CRM company routes never send a client login about a company:
// BGP's own notes and prospecting flags on it (letting and investment
// hunter picks, distress, acquiring and disposing, lending appetite), BGP's
// AML working (every aml column: risk level, PEP, source of wealth, enhanced
// checks, the CDD form, notes, who approved), the saved AI fields (they hold
// the summary of BGP's emails with the company), BGP's saved analysis, the
// last-touch date and the "On hold" flag. One list, so a new BGP-only column
// is added here and nowhere else (the test in
// qa/regression/brand-crm-guards.test.mjs fails on a new notes or aml column
// that is not on it). The brand page has its own cut (clientProfileCompanyView
// below), which keeps four of these on purpose: the PEP flag, the Hunter
// pick, the analysis without its advice and two saved AI keys.
export const BGP_ONLY_COMPANY_FIELDS = [
  "lettingHunterNotes", "investmentHunterNotes", "distressNotes", "acquiringNowNotes", "disposingNowNotes", "lendingAppetiteNotes",
  "hunterFlag", "lettingHunterFlag", "investmentHunterFlag", "distressFlag", "acquiringNow", "disposingNow",
  "amlChecklist", "amlRiskLevel", "amlPepStatus", "amlSourceOfWealth", "amlSourceOfWealthNotes", "amlEddRequired", "amlEddReason", "amlNotes",
  "amlSubjectType", "amlFeeEarnerApprovedBy", "amlFeeEarnerApprovedAt", "amlCddForm",
  "kycApprovedBy", "aiGeneratedFields", "brandAnalysis", "brandAnalysisAt", "lastInteraction", "conceptStatus",
] as const;
// BGP's compliance record on a company: its KYC status and dates, and the
// Companies House officers and ownership BGP pulled for it.
const COMPANY_COMPLIANCE_FIELDS = ["kycStatus", "kycCheckedAt", "kycExpiresAt", "companiesHouseOfficers", "companiesHouseData"] as const;
// Who at BGP covers the company.
const COMPANY_BGP_CONTACT_FIELDS = ["bgpContactCrm", "bgpContactUserIds"] as const;

const without = <T extends Record<string, any>>(row: T, ...lists: readonly (readonly string[])[]): T => {
  const view: Record<string, any> = { ...row };
  for (const list of lists) for (const field of list) delete view[field];
  return view as T;
};

// The three cuts of a company row (camelCase, as the CRM routes send it) for
// a client login. Each returns a copy; the row it is given is not changed.
//
// Another company's record (a brand in the client's CRM, an agent firm):
// none of the BGP-only fields, nor BGP's compliance record on it, nor who at
// BGP covers it. This is the cut the single-record read has always made,
// with the newer AML columns added.
export function clientBrandCompanyView<T extends Record<string, any>>(company: T): T {
  return without(company, BGP_ONLY_COMPANY_FIELDS, COMPANY_COMPLIANCE_FIELDS, COMPANY_BGP_CONTACT_FIELDS);
}

// The client's OWN company record: the same, except that who at BGP looks
// after the client stays (its contact page shows them). BGP's compliance
// record on the client itself is not sent back to it: the rule the client
// dashboard follows (company-portfolio in server/routes.ts).
export function clientOwnCompanyView<T extends Record<string, any>>(company: T): T {
  return without(company, BGP_ONLY_COMPANY_FIELDS, COMPANY_COMPLIANCE_FIELDS);
}

// A row of the company list: the brand cut, except that the KYC status and
// its expiry stay, on every row. The Deals page's AML mark reads those two
// for each party to a deal, the client's own company included; without them
// every deal would read "no checks run".
export function clientCompanyListRow<T extends Record<string, any>>(company: T): T {
  const row: Record<string, any> = clientBrandCompanyView(company);
  for (const field of ["kycStatus", "kycExpiresAt"]) if (field in company) row[field] = company[field];
  return row as T;
}

// The saved AI fields a client's brand page draws: the backers list and the
// "likely website". Everything else in that column is BGP's (the summary of
// BGP's emails with the brand, the deal document a UK entity was read from,
// who verified the brand's identity), so a new key reaches a client only
// when it is added here.
export const CLIENT_PROFILE_AI_KEYS = ["backers_detail", "website_suggestion"] as const;

// BGP's saved analysis of a brand ends with BGP's own pitch advice
// ("Recommendation: ..."). A client is shown the analysis without it: the
// brand page has always cut it on the screen, and the server now cuts it
// before it leaves, for the page's data and the Brand Pack alike. The same
// rule as the screen's (client/src/components/brand-profile-panel.tsx).
export function clientBrandAnalysis<T extends string | null | undefined>(text: T): T | string {
  if (!text) return text;
  return String(text).split(/\*{0,2}Recommendation\b/i)[0].replace(/[\s*—:-]+$/, "");
}

// The cut for the brand page's own company row (snake_case, a named column
// list in server/brand-profile.ts). That row carries no AML notes, and the
// page draws its KYC status, PEP flag, lead and Hunter pick for a client
// (the Company checks card), so what comes out is BGP's AML risk level
// (no client screen draws it), BGP's letting and investment prospecting
// flags and notes, the raw list of BGP user ids, the "On hold" flag, the
// pitch advice at the end of the saved analysis, and every saved AI field
// not on CLIENT_PROFILE_AI_KEYS. Returns a copy: the handler goes on reading
// the full row. undefined is dropped when the reply is written.
export function clientProfileCompanyView<T extends Record<string, any>>(company: T): T {
  const saved = company.ai_generated_fields;
  let savedForClient = saved;
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    savedForClient = {} as Record<string, any>;
    for (const key of CLIENT_PROFILE_AI_KEYS) if (key in saved) savedForClient[key] = saved[key];
  }
  return {
    ...company, concept_status: undefined, bgp_contact_user_ids: undefined, aml_risk_level: undefined,
    letting_hunter_flag: undefined, letting_hunter_notes: undefined, investment_hunter_flag: undefined, investment_hunter_notes: undefined,
    ai_generated_fields: savedForClient,
    ...("brand_analysis" in company ? { brand_analysis: clientBrandAnalysis(company.brand_analysis) } : {}),
  };
}
