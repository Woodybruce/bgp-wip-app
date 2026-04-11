import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useTeam } from "@/lib/team-context";

/** Brand configuration per client */
export interface BrandConfig {
  id: string;
  name: string;
  logoUrl?: string;
  primaryColor: string; // hex
  accentColor: string;
  headerText: string;
  footerText: string;
}

export const BRANDS: Record<string, BrandConfig> = {
  bgp: {
    id: "bgp",
    name: "Bruce Gillingham Pollard",
    primaryColor: "#2E5E3F",
    accentColor: "#C4A35A",
    headerText: "BGP Dashboard",
    footerText: "\u00A9 Bruce Gillingham Pollard",
  },
  landsec: {
    id: "landsec",
    name: "Landsec",
    primaryColor: "#00263A", // Landsec navy
    accentColor: "#00A3E0", // Landsec blue
    headerText: "Landsec Portfolio",
    footerText: "Powered by Bruce Gillingham Pollard",
  },
};

interface BrandContextType {
  brand: BrandConfig;
  isLandsec: boolean;
}

const BrandContext = createContext<BrandContextType>({
  brand: BRANDS.bgp,
  isLandsec: false,
});

/** Resolves the active brand from the current team context */
function resolveBrand(teamName: string | null | undefined): BrandConfig {
  if (teamName === "Landsec") return BRANDS.landsec;
  return BRANDS.bgp;
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
