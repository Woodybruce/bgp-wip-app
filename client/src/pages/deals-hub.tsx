import { lazy, Suspense, useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Store, TrendingUp, FileText } from "lucide-react";
import { useTeam } from "@/lib/team-context";

const Deals = lazy(() => import("@/pages/deals"));
const AvailableUnits = lazy(() => import("@/pages/available-units"));
const InvestmentTracker = lazy(() => import("@/pages/investment-tracker"));
const WipReport = lazy(() => import("@/pages/wip-report"));

function PageLoader() {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[400px] w-full" />
    </div>
  );
}

type TabKey = "wip" | "letting" | "investment" | "wip-report";

const TAB_PATHS = new Set(["letting", "investment", "report"]);

function getTabFromLocation(loc: string): TabKey | null {
  if (loc.startsWith("/deals/letting")) return "letting";
  if (loc.startsWith("/deals/investment") || loc.startsWith("/investment-tracker")) return "investment";
  if (loc.startsWith("/deals/report") || loc.startsWith("/wip-report")) return "wip-report";
  if (loc === "/deals") return "wip";
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
  const [tab, setTab] = useState<TabKey>(() => getTabFromLocation(location) || "wip");
  const isProfile = isDealProfile(location);

  useEffect(() => {
    if (isProfile) return;
    const t = getTabFromLocation(location);
    if (t) setTab(t);
  }, [location, isProfile]);

  const allTabs = useMemo(() => [
    { key: "wip" as const, label: "WIP", icon: BarChart3 },
    { key: "letting" as const, label: "Letting Tracker", icon: Store },
    { key: "investment" as const, label: "Investment", icon: TrendingUp },
    { key: "wip-report" as const, label: "WIP Report", icon: FileText },
  ], []);

  const tabs = useMemo(() => {
    if (activeTeam === "Investment") return allTabs.filter(t => t.key !== "letting");
    if (activeTeam && activeTeam !== "all") return allTabs.filter(t => t.key !== "investment");
    return allTabs;
  }, [activeTeam, allTabs]);

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
      wip: "/deals",
      letting: "/deals/letting",
      investment: "/deals/investment",
      "wip-report": "/deals/report",
    };
    const target = routes[t];
    if (location !== target) setLocation(target);
  };

  return (
    <div>
      <div className="flex items-center gap-1 px-4 pt-4 md:px-6 md:pt-6 shrink-0">
        <div className="inline-flex rounded-lg border bg-muted p-0.5" data-testid="toggle-deals-tabs">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => switchTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
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
        {tab === "wip" && <Deals />}
        {tab === "letting" && <AvailableUnits />}
        {tab === "investment" && <InvestmentTracker />}
        {tab === "wip-report" && <WipReport />}
      </Suspense>
    </div>
  );
}
