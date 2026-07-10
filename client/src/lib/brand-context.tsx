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
  const { activeTeam, userTeam } = useTeam();

  const value = useMemo<BrandContextType>(() => {
    // Brand follows the active team, but falls back to the user's OWN team
    // when no team is actively selected (e.g. a client login whose team
    // switcher is locked). Without this fallback a Landsec client briefly
    // — or permanently — sees the BGP brand instead of their own.
    const effective = activeTeam && activeTeam !== "all" ? activeTeam : userTeam;
    const brand = resolveBrand(effective);
    return { brand, isLandsec: brand.id === "landsec" };
  }, [activeTeam, userTeam]);

  return (
    <BrandContext.Provider value={value}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}
