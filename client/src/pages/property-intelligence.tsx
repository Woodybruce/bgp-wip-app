import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Map, LayoutGrid, ShieldCheck, Landmark, Receipt, FileSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const EdozoMap = lazy(() => import("@/pages/edozo-map"));
const KycClouseau = lazy(() => import("@/pages/kyc-clouseau"));
const LandRegistry = lazy(() => import("@/pages/land-registry"));
const VoaRatings = lazy(() => import("@/pages/voa-ratings"));

type TabId = "map" | "board" | "investigator" | "land-registry" | "business-rates";

const TABS: Array<{ id: TabId; label: string; icon: any }> = [
  { id: "map", label: "Map", icon: Map },
  { id: "board", label: "Investigation Board", icon: LayoutGrid },
  { id: "investigator", label: "Investigator", icon: ShieldCheck },
  { id: "land-registry", label: "Land Registry", icon: Landmark },
  { id: "business-rates", label: "Business Rates", icon: Receipt },
];

const SEARCH_STATUSES = ["New", "Investigating", "Contacted Owner", "No Interest", "Acquired"] as const;

function statusColor(status: string | null): string {
  switch (status) {
    case "Acquired": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    case "Investigating": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    case "Contacted Owner": return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
    case "No Interest": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    default: return "bg-muted text-muted-foreground";
  }
}

function riskColor(level: string | null): string {
  if (!level) return "";
  if (level === "high") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  if (level === "medium") return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
  return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
}

interface SavedSearch {
  id: number;
  address: string;
  postcode: string | null;
  freeholdsCount: number;
  leaseholdsCount: number;
  intelligence: Record<string, any> | null;
  aiSummary: any | null;
  ownership: any | null;
  crmPropertyId: string | null;
  notes: string | null;
  tags: string[];
  status: string | null;
  voaRateableValue: number | null;
  kycRiskLevel: string | null;
  createdAt: string;
}

function InvestigationBoard({ onOpenInMap }: { onOpenInMap: (search: SavedSearch) => void }) {
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const { data: searches = [], isLoading } = useQuery<SavedSearch[]>({
    queryKey: ["/api/land-registry/searches"],
    queryFn: async () => {
      const res = await fetch("/api/land-registry/searches", {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const headers: Record<string, string> = {
        ...getAuthHeaders(),
        "Content-Type": "application/json",
      };
      const res = await fetch(`/api/land-registry/searches/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/land-registry/searches"] });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const filtered =
    filterStatus === "all"
      ? searches
      : searches.filter((s) => s.status === filterStatus);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">Investigation Board</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {searches.length} saved investigation{searches.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-44 h-8 text-sm">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {SEARCH_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenInMap({ id: 0, address: "", postcode: null, freeholdsCount: 0, leaseholdsCount: 0, intelligence: null, aiSummary: null, ownership: null, crmPropertyId: null, notes: null, tags: [], status: "New", voaRateableValue: null, kycRiskLevel: null, createdAt: new Date().toISOString() })}
          >
            <Map className="w-3.5 h-3.5 mr-1.5" />
            New Search
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <FileSearch className="w-12 h-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground font-medium">No investigations yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Use the Map tab to search a property — results are saved here automatically.
          </p>
          <Button className="mt-4" size="sm" onClick={() => onOpenInMap({ id: 0, address: "", postcode: null, freeholdsCount: 0, leaseholdsCount: 0, intelligence: null, aiSummary: null, ownership: null, crmPropertyId: null, notes: null, tags: [], status: "New", voaRateableValue: null, kycRiskLevel: null, createdAt: new Date().toISOString() })}>
            <Map className="w-3.5 h-3.5 mr-1.5" />
            Open Map
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((search) => (
            <Card
              key={search.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => onOpenInMap(search)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{search.address}</p>
                    {search.postcode && (
                      <p className="text-xs text-muted-foreground mt-0.5">{search.postcode}</p>
                    )}
                  </div>
                  <Badge className={`text-[10px] shrink-0 ${statusColor(search.status)}`}>
                    {search.status || "New"}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {search.freeholdsCount > 0 && (
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                      {search.freeholdsCount} freehold{search.freeholdsCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {search.leaseholdsCount > 0 && (
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                      {search.leaseholdsCount} leasehold{search.leaseholdsCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {search.voaRateableValue ? (
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                      RV £{search.voaRateableValue.toLocaleString()}
                    </span>
                  ) : null}
                  {search.kycRiskLevel ? (
                    <Badge className={`text-[10px] ${riskColor(search.kycRiskLevel)}`}>
                      {search.kycRiskLevel.toUpperCase()} RISK
                    </Badge>
                  ) : null}
                </div>

                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(search.createdAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={search.status || "New"}
                      onValueChange={(val) =>
                        updateMutation.mutate({ id: search.id, status: val })
                      }
                    >
                      <SelectTrigger className="h-6 text-[10px] w-36 border-0 bg-transparent p-0 focus:ring-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SEARCH_STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function readTabFromUrl(): TabId {
  if (typeof window === "undefined") return "map";
  const params = new URLSearchParams(window.location.search);
  const t = (params.get("tab") || "").toLowerCase() as TabId;
  if (TABS.some((x) => x.id === t)) return t;
  // Handle legacy path redirects
  const path = window.location.pathname;
  if (path.startsWith("/land-registry")) return "land-registry";
  if (path.startsWith("/business-rates")) return "business-rates";
  return "map";
}

const TabLoader = () => (
  <div className="flex items-center justify-center h-64">
    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
  </div>
);

export default function PropertyIntelligence() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<TabId>(readTabFromUrl());

  const handleTabChange = (next: string) => {
    const nextTab = next as TabId;
    setTab(nextTab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", nextTab);
    navigate(`/property-intelligence?${params.toString()}`, { replace: true });
  };

  useEffect(() => {
    const handler = () => setTab(readTabFromUrl());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const [pendingSearch, setPendingSearch] = useState<{ address: string; postcode: string | null } | null>(null);

  const openMap = (search?: any) => {
    if (search?.address) {
      setPendingSearch({ address: search.address, postcode: search.postcode });
    } else {
      setPendingSearch(null);
    }
    handleTabChange("map");
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      <Tabs value={tab} onValueChange={handleTabChange} className="flex flex-col h-full">
        <div className="border-b bg-background sticky top-0 z-10">
          <div className="px-4 lg:px-6 pt-3">
            <TabsList className="bg-transparent p-0 h-auto gap-1">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="flex items-center gap-1.5 px-4 py-2 data-[state=active]:bg-muted data-[state=active]:text-foreground rounded-t-md rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary"
                    data-testid={`pi-tab-${t.id}`}
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
          <Suspense fallback={<TabLoader />}>
            <TabsContent value="map" className="m-0 h-full">
              <EdozoMap initialSearch={pendingSearch} onSearchConsumed={() => setPendingSearch(null)} />
            </TabsContent>
            <TabsContent value="board" className="m-0">
              <InvestigationBoard onOpenInMap={openMap} />
            </TabsContent>
            <TabsContent value="investigator" className="m-0 h-full">
              <KycClouseau />
            </TabsContent>
            <TabsContent value="land-registry" className="m-0">
              <LandRegistry />
            </TabsContent>
            <TabsContent value="business-rates" className="m-0">
              <VoaRatings />
            </TabsContent>
          </Suspense>
        </div>
      </Tabs>
    </div>
  );
}
