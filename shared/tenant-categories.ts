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
