import { createContext, useContext, useMemo, useEffect } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTeam } from "@/lib/team-context";
import { getAuthHeaders } from "@/lib/queryClient";

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
    footerText: "© Bruce Gillingham Pollard",
  },
  landsec: {
    id: "landsec",
    name: "Landsec",
    primaryColor: "#00263A", // Landsec navy — fallback until logo.dev fills it
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

// ── Colour helpers: hex → "H S% L%" (the shape our CSS vars use) ──────────
function hexToHslTriplet(hex: string): string | null {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
function luminance(hex: string): number {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const c = [((n >> 16) & 255), ((n >> 8) & 255), (n & 255)].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const { activeTeam, userTeam } = useTeam();

  // The caller's own company brand theme (logo + colours from logo.dev).
  // Scoped server-side; returns { scoped:false } for BGP staff not in a
  // client view, so this quietly no-ops for the internal app.
  const { data: theme } = useQuery<any>({
    queryKey: ["/api/client/brand-theme"],
    queryFn: () => fetch("/api/client/brand-theme", { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()).catch(() => null),
    staleTime: 10 * 60 * 1000,
  });

  const value = useMemo<BrandContextType>(() => {
    // Brand follows the active team, but falls back to the user's OWN team
    // when no team is actively selected (e.g. a client login whose team
    // switcher is locked). Without this fallback a Landsec client briefly
    // — or permanently — sees the BGP brand instead of their own.
    const effective = activeTeam && activeTeam !== "all" ? activeTeam : userTeam;
    const base = resolveBrand(effective);
    // Overlay the fetched theme when the app is scoped to a client company.
    if (theme?.scoped) {
      return {
        brand: {
          ...base,
          id: base.id === "bgp" ? "client" : base.id,
          name: theme.name || base.name,
          logoUrl: theme.logoUrl || base.logoUrl,
          primaryColor: theme.primaryColor || base.primaryColor,
          accentColor: theme.secondaryColor || base.accentColor,
        },
        isLandsec: base.id === "landsec" || !!theme.scoped,
      };
    }
    return { brand: base, isLandsec: base.id === "landsec" };
  }, [activeTeam, userTeam, theme]);

  // Skin the app in the client's brand colours by overriding the core CSS
  // vars on <html>. Only while a client brand is active; cleared otherwise
  // so the internal BGP app is never recoloured.
  useEffect(() => {
    const root = document.documentElement;
    const vars = ["--primary", "--primary-foreground", "--accent", "--accent-foreground", "--ring", "--sidebar", "--sidebar-foreground", "--sidebar-primary", "--sidebar-ring"];
    const active = theme?.scoped && theme?.primaryColor;
    if (!active) { vars.forEach(v => root.style.removeProperty(v)); return; }
    const primary = hexToHslTriplet(theme.primaryColor);
    const accent = theme.secondaryColor ? hexToHslTriplet(theme.secondaryColor) : primary;
    if (!primary) return;
    const primaryFg = luminance(theme.primaryColor) > 0.5 ? "0 0% 10%" : "0 0% 100%";
    root.style.setProperty("--primary", primary);
    root.style.setProperty("--primary-foreground", primaryFg);
    // --accent is shadcn's HOVER/HIGHLIGHT surface (dropdown rows, command
    // items, menu focus). Skinning it with the raw brand colour painted
    // every highlighted row a saturated full-bleed bar with white text —
    // "44 Brekkie" in the Letting Tracker brand picker. Keep the brand HUE
    // but as a pale tint so highlights stay quiet and text stays dark.
    const accentTint = (accent || primary).replace(/^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/,
      (_m, h, s) => `${h} ${Math.min(Number(s), 60)}% 92%`);
    root.style.setProperty("--accent", accentTint);
    root.style.setProperty("--accent-foreground", "0 0% 10%");
    root.style.setProperty("--ring", accent || primary);
    // Sidebar takes the deep primary with light text.
    root.style.setProperty("--sidebar", primary);
    root.style.setProperty("--sidebar-foreground", "0 0% 95%");
    root.style.setProperty("--sidebar-primary", accent || primary);
    root.style.setProperty("--sidebar-ring", accent || primary);
    return () => { vars.forEach(v => root.style.removeProperty(v)); };
  }, [theme]);

  return (
    <BrandContext.Provider value={value}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}
