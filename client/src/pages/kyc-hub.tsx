import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, LayoutGrid, GraduationCap, Settings } from "lucide-react";

// Lazy so we only parse each tab's bundle when the user actually opens it.
const ComplianceBoard = lazy(() => import("@/pages/compliance-board"));
const AmlTraining = lazy(() => import("@/pages/aml-training"));
const AmlCompliance = lazy(() => import("@/pages/aml-compliance"));

type TabId = "board" | "training" | "settings";

const TABS: Array<{ id: TabId; label: string; icon: any }> = [
  { id: "board", label: "Compliance Board", icon: LayoutGrid },
  { id: "training", label: "Training", icon: GraduationCap },
  { id: "settings", label: "Firm Settings", icon: Settings },
];

function readTabFromUrl(): TabId {
  if (typeof window === "undefined") return "board";
  const params = new URLSearchParams(window.location.search);
  const t = (params.get("tab") || "").toLowerCase() as TabId;
  if (TABS.some(x => x.id === t)) return t;
  // Fallback for legacy routes
  const path = window.location.pathname;
  if (path.startsWith("/compliance-board")) return "board";
  if (path.startsWith("/aml-training")) return "training";
  if (path.startsWith("/aml-compliance")) return "settings";
  return "board";
}

export default function KycHub() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<TabId>(readTabFromUrl());

  const handleTabChange = (next: string) => {
    const nextTab = next as TabId;
    setTab(nextTab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", nextTab);
    navigate(`/kyc-clouseau?${params.toString()}`, { replace: true });
  };

  useEffect(() => {
    const handler = () => setTab(readTabFromUrl());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-screen">
      <Tabs value={tab} onValueChange={handleTabChange} className="flex flex-col h-full">
        <div className="border-b bg-background sticky top-0 z-10">
          <div className="px-4 lg:px-6 pt-3">
            <TabsList className="bg-transparent p-0 h-auto gap-1">
              {TABS.map(t => {
                const Icon = t.icon;
                return (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="flex items-center gap-1.5 px-4 py-2 data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-t-md rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary"
                    data-testid={`kyc-hub-tab-${t.id}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
            <TabsContent value="board" className="m-0">
              <ComplianceBoard />
            </TabsContent>
            <TabsContent value="training" className="m-0">
              <AmlTraining />
            </TabsContent>
            <TabsContent value="settings" className="m-0">
              <AmlCompliance />
            </TabsContent>
          </Suspense>
        </div>
      </Tabs>
    </div>
  );
}
