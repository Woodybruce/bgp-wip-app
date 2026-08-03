import { lazy, Suspense, useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Store, TrendingUp, Building2, FileText } from "lucide-react";
import { useTeam } from "@/lib/team-context";
import { useIsMobile } from "@/hooks/use-mobile";

const Deals = lazy(() => import("@/pages/deals"));
const AvailableUnits = lazy(() => import("@/pages/available-units"));
const InvestmentTracker = lazy(() => import("@/pages/investment-tracker"));
const WipReport = lazy(() => import("@/pages/wip-report"));
const Properties = lazy(() => import("@/pages/properties"));

function PageLoader() {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[400px] w-full" />
    </div>
  );
}

// Tab keys mirror the segment under /deals/* except 'deals' itself is
// the default root tab (/deals). The 'wip' historical key was renamed
// to 'deals' so the TabKey, label and URL all carry the same word.
type TabKey = "deals" | "letting" | "investment" | "wip-report" | "properties";

const TAB_PATHS = new Set(["letting", "investment", "report", "properties", "list"]);

function getTabFromLocation(loc: string): TabKey | null {
  if (loc.startsWith("/deals/letting")) return "letting";
  if (loc.startsWith("/deals/investment") || loc.startsWith("/investment-tracker")) return "investment";
  if (loc.startsWith("/deals/report") || loc.startsWith("/wip-report")) return "wip-report";
  if (loc.startsWith("/deals/properties") || loc === "/properties" || loc.startsWith("/properties/")) return "properties";
  if (loc.startsWith("/deals/list")) return "deals";
  // Bare /deals → null so the component picks the landing tab by device:
  // WIP Report on desktop (the financial roll-up), Deals on mobile (WIP is
  // hidden there). The Deals schedule lives at /deals/list.
  return null;
}

function isDealProfile(loc: string): boolean {
  const match = loc.match(/^\/deals\/([^/]+)/);
  if (!match) return false;
  return !TAB_PATHS.has(match[1]);
}

export default function DealsHub() {
  const [location, setLocation] = useLocation();
  const { activeTeam } = useTeam();
  const isMobile = useIsMobile();
  // Client logins (e.g. Landsec) only get the Deals list — never the WIP
  // Report (BGP financials), Letting Tracker or Investment tabs.
  const { data: dhUser, isLoading: dhUserLoading } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClient = dhUser?.role === "Client" || !!(dhUser as any)?.companyScopeId;
  const [tab, setTab] = useState<TabKey>(() =>
    getTabFromLocation(location) || ((typeof window !== "undefined" && window.innerWidth < 768) ? "deals" : "wip-report")
  );
  const isProfile = isDealProfile(location);

  useEffect(() => {
    if (isProfile) return;
    const t = getTabFromLocation(location);
    if (isClient) {
      // Clients: Deals + Letting Tracker + Properties (scoped to their own
      // portfolio server-side); anything else → Deals.
      setTab(t === "letting" || t === "properties" ? t : "deals");
      return;
    }
    if (t) setTab(t);
  }, [location, isProfile, isClient]);

  // WIP Report — the financial roll-up every agent wants. Now shown on both
  // desktop and mobile (the wide table scrolls horizontally on a phone).
  const allTabs = useMemo(() => [
    { key: "wip-report" as const, label: "WIP Report", icon: FileText },
    { key: "properties" as const, label: "Properties", icon: Building2 },
    { key: "deals" as const, label: "Deals", icon: BarChart3 },
    { key: "letting" as const, label: "Letting Tracker", icon: Store },
    { key: "investment" as const, label: "Investment", icon: TrendingUp },
  ], [isMobile]);

  const tabs = useMemo(() => {
    if (isClient) return allTabs.filter(t => t.key === "deals" || t.key === "letting" || t.key === "properties");
    if (activeTeam === "Investment") return allTabs.filter(t => t.key !== "letting");
    if (activeTeam && activeTeam !== "all") return allTabs.filter(t => t.key !== "investment");
    return allTabs;
  }, [activeTeam, allTabs, isClient]);

  if (isProfile) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Deals />
      </Suspense>
    );
  }

  const switchTab = (t: TabKey) => {
    setTab(t);
    const routes: Record<TabKey, string> = {
      "wip-report": "/deals",
      deals: "/deals/list",
      letting: "/deals/letting",
      investment: "/deals/investment",
      properties: "/deals/properties",
    };
    const target = routes[t];
    if (location !== target) setLocation(target);
  };

  return (
    <div>
      <div className={`flex items-center gap-1 px-4 pt-4 md:px-6 md:pt-6 shrink-0 ${tabs.length <= 1 ? "hidden" : ""}`}>
        <div className="flex flex-wrap md:inline-flex md:min-w-max rounded-lg border bg-muted p-0.5 gap-0.5" data-testid="toggle-deals-tabs">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => switchTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 md:px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
                tab === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`toggle-deals-${key}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <Suspense fallback={<PageLoader />}>
        {tab === "deals" && <Deals />}
        {tab === "letting" && <AvailableUnits />}
        {tab === "investment" && <InvestmentTracker />}
        {/* Don't mount the staff WIP report until we know the viewer isn't a
            client — the default tab is wip-report, so a client's first paint
            briefly mounted it and fired staff-only /api/wip calls (403s). */}
        {tab === "wip-report" && !dhUserLoading && !isClient && <WipReport />}
        {tab === "properties" && <Properties />}
      </Suspense>
    </div>
  );
}
