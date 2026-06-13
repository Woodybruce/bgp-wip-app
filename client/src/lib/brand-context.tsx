import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useTeam } from "@/lib/team-context";
import { BRANDS, getBrand, type BrandConfig } from "@shared/brand";

// Re-exported so existing imports from this module keep working.
export { BRANDS };
export type { BrandConfig };

interface BrandContextType {
  brand: BrandConfig;
  isLandsec: boolean;
}

const BrandContext = createContext<BrandContextType>({
  brand: BRANDS.bgp,
  isLandsec: false,
});

/**
 * Resolves the active brand. The deployment's brand is set at build time via
 * VITE_BRAND (defaults to bgp); the Landsec client-view is still selected by
 * team context within the BGP tenant.
 */
function resolveBrand(teamName: string | null | undefined): BrandConfig {
  if (teamName === "Landsec") return BRANDS.landsec;
  return getBrand(import.meta.env.VITE_BRAND as string | undefined);
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const { activeTeam } = useTeam();

  const value = useMemo<BrandContextType>(() => {
    const brand = resolveBrand(activeTeam);
    return { brand, isLandsec: brand.id === "landsec" };
  }, [activeTeam]);

  return (
    <BrandContext.Provider value={value}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}
