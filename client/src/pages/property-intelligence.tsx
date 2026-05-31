import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Map, ShieldCheck, Landmark, Receipt, Sparkles, ImageIcon, Globe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PropertyResolverBar } from "@/components/property-resolver-bar";
import { PropertyImageryPicker } from "@/components/property-imagery-picker";
import { PropertyProvider } from "@/lib/property-context";

const EdozoMap = lazy(() => import("@/pages/edozo-map"));
const KycClouseau = lazy(() => import("@/pages/kyc-clouseau"));
const LandRegistry = lazy(() => import("@/pages/land-registry"));
const VoaRatings = lazy(() => import("@/pages/voa-ratings"));
const PropertyPathway = lazy(() => import("@/pages/property-pathway"));

type TabId = "pathway" | "map" | "investigator" | "land-registry" | "business-rates" | "imagery";

const TABS: Array<{ id: TabId; label: string; icon: any }> = [
  { id: "pathway", label: "Pathway", icon: Sparkles },
  { id: "map", label: "Map", icon: Map },
  { id: "investigator", label: "Investigator", icon: ShieldCheck },
  { id: "land-registry", label: "Land Registry", icon: Landmark },
  { id: "business-rates", label: "Business Rates", icon: Receipt },
  { id: "imagery", label: "Imagery", icon: ImageIcon },
];

function readTabFromUrl(): TabId {
  if (typeof window === "undefined") return "pathway";
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get("tab") || "").toLowerCase();
  // Redirect the old Investigation Board tab to the new Pathway
  if (raw === "board") return "pathway";
  if (TABS.some((x) => x.id === raw)) return raw as TabId;
  // Handle legacy path redirects
  const path = window.location.pathname;
  if (path.startsWith("/land-registry")) return "land-registry";
  if (path.startsWith("/business-rates")) return "business-rates";
  return "pathway";
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
    // Push (don't replace) so browser back steps through tab history.
    navigate(`/property-intelligence?${params.toString()}`);
  };

  useEffect(() => {
    const handler = () => setTab(readTabFromUrl());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // Pre-load a pendingSearch when we arrive via ?address=&postcode= URL params
  // (e.g. the 'Open in Map' button from the Pathway page). This makes the
  // Pathway map the canonical Goad/street-plan view across the app — no more
  // separate Retail Context Plan modal flow.
  const initialPendingSearch = (() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const address = params.get("address") || "";
    const postcode = params.get("postcode") || "";
    if (!address && !postcode) return null;
    return { address, postcode: postcode || null };
  })();
  const [pendingSearch, setPendingSearch] = useState<{ address: string; postcode: string | null } | null>(initialPendingSearch);
  // Canonical property identity for the whole page — once resolved, every tab
  // can read this and stop doing its own ad-hoc lookups. v1: state only;
  // v2 will pass propertyId into the lazy tab components as a prop.
  const [resolvedProperty, setResolvedProperty] = useState<{ id: string; name: string; postcode: string | null } | null>(null);

  const openMap = (search?: any) => {
    if (search?.address) {
      setPendingSearch({ address: search.address, postcode: search.postcode });
    } else {
      setPendingSearch(null);
    }
    handleTabChange("map");
  };

  return (
    <PropertyProvider initial={resolvedProperty}>
    <div className="flex flex-col h-full min-h-screen">
      <Tabs value={tab} onValueChange={handleTabChange} className="flex flex-col h-full">
        <div className="border-b bg-background sticky top-0 z-10">
          <div className="px-4 lg:px-6 pt-4">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="w-6 h-6 text-indigo-500" />
              Property Intelligence
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pathway, mapping, ownership and rating intelligence for any property — in one place.
            </p>
          </div>
          <div className="px-4 lg:px-6 pt-3 pb-2">
            <PropertyResolverBar
              current={resolvedProperty}
              onResolve={(id, prop) => {
                setResolvedProperty({ id, name: prop.name, postcode: prop.postcode });
                // Drive every tab — Map via pendingSearch, others via the
                // PropertyContext (each can call usePropertyContext() to
                // read the canonical selection and prefill).
                setPendingSearch({ address: prop.name, postcode: prop.postcode });
              }}
            />
          </div>
          <div className="px-4 lg:px-6 pt-3 overflow-x-auto">
            <TabsList className="bg-transparent p-0 h-auto gap-1 w-max">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-none border-b-2 -mb-px border-transparent text-muted-foreground hover:text-foreground data-[state=active]:border-indigo-500 data-[state=active]:text-indigo-600 data-[state=active]:shadow-none shrink-0 whitespace-nowrap"
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
            {/* forceMount keeps Pathway alive when user flips to Map/Investigator
                etc. so an in-flight background run keeps polling + state
                survives. Radix toggles data-state; we hide with display:none. */}
            <TabsContent
              value="pathway"
              forceMount
              className="m-0 data-[state=inactive]:hidden"
            >
              <PropertyPathway />
            </TabsContent>
            <TabsContent value="map" className="m-0 h-full">
              <EdozoMap initialSearch={pendingSearch} onSearchConsumed={() => setPendingSearch(null)} />
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
            <TabsContent value="imagery" className="m-0 p-4 lg:p-6">
              {resolvedProperty ? (
                <PropertyImageryPicker propertyId={resolvedProperty.id} />
              ) : (
                <Card><CardContent className="p-12 text-center text-muted-foreground">
                  <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>Resolve a property above to see and curate its imagery — heroes, internals, location plans, floor plans.</p>
                </CardContent></Card>
              )}
            </TabsContent>
          </Suspense>
        </div>
      </Tabs>
    </div>
    </PropertyProvider>
  );
}
