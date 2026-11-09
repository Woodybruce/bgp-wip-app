/**
 * Investment hub — the investment team's own sidebar entry (Woody,
 * 2026-09-28): Investment Tracker, investment Requirements and Investment
 * Comps under one pill row. The old URLs (/investment-tracker,
 * /requirements?type=investment, /investment-comps) keep working.
 */

import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "@/components/ui/pill";
import { TrendingUp } from "lucide-react";

const InvestmentTracker = lazy(() => import("@/pages/investment-tracker"));
const InvestmentComps = lazy(() => import("@/pages/investment-comps"));
const InvestmentRequirements = lazy(() =>
  import("@/pages/requirements").then((m) => ({ default: m.InvestmentTable })),
);

type TabKey = "tracker" | "requirements" | "comps";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "tracker", label: "Tracker" },
  { key: "requirements", label: "Requirements" },
  { key: "comps", label: "Comps" },
];

function tabFromLocation(loc: string): TabKey {
  const seg = loc.split("?")[0].split("/")[2];
  return seg === "requirements" || seg === "comps" ? seg : "tracker";
}

function PageLoader() {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[400px] w-full" />
    </div>
  );
}

export default function InvestmentHub() {
  const [location, navigate] = useLocation();
  const tab = tabFromLocation(location);
  const { data: user, isLoading: userLoading } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClient = user?.role === "Client" || !!user?.companyScopeId;

  // ?new=1 (e.g. a dashboard "Add") opens the new investment requirement
  // dialog; strip it so a refresh doesn't reopen it.
  const [autoCreate] = useState(
    () => typeof window !== "undefined"
      && tabFromLocation(window.location.pathname) === "requirements"
      && new URLSearchParams(window.location.search).has("new"),
  );
  useEffect(() => {
    if (!autoCreate) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [autoCreate]);

  return (
    <div className="flex flex-col h-full" data-testid="investment-hub">
      <div className="border-b bg-background px-4 lg:px-6 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-investment-hub-title">Investment</h1>
            <p className="text-sm text-muted-foreground">Tracker, requirements and comps</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-3" data-testid="investment-hub-tabs">
          {TABS.map(({ key, label }) => (
            <Pill
              key={key}
              active={tab === key}
              onClick={() => { if (tab !== key) navigate(`/investment/${key}`); }}
              data-testid={`pill-investment-${key}`}
            >
              {label}
            </Pill>
          ))}
        </div>
      </div>
      {userLoading ? (
        <PageLoader />
      ) : isClient ? (
        <div className="p-4 sm:p-6 text-sm text-muted-foreground">Investment isn't available in the client view.</div>
      ) : (
        <Suspense fallback={<PageLoader />}>
          {tab === "tracker" && <InvestmentTracker />}
          {tab === "requirements" && (
            <div className="p-4 sm:p-6 max-w-[1600px] mx-auto w-full">
              <InvestmentRequirements teamFilter={null} autoCreate={autoCreate} />
            </div>
          )}
          {tab === "comps" && (
            <div className="flex-1 min-h-0">
              <InvestmentComps embedded />
            </div>
          )}
        </Suspense>
      )}
    </div>
  );
}
