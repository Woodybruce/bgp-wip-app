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
