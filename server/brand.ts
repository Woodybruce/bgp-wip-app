import { getBrand, type BrandConfig } from "@shared/brand";

/**
 * The active brand for this deployment, selected by the BRAND env var
 * (defaults to bgp). Use this anywhere the server needs the tenant's name,
 * product label, email domain, admin list, etc. — never hardcode them.
 */
export function activeBrand(): BrandConfig {
  return getBrand(process.env.BRAND);
}
