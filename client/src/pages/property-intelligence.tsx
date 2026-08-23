import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Map, ShieldCheck, Landmark, Receipt, Sparkles, ImageIcon, Globe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PropertyImageryPicker } from "@/components/property-imagery-picker";
import { PropertyProvider, usePropertySetter } from "@/lib/property-context";

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

function readSearchFromUrl(): { address: string; postcode: string | null } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const address = params.get("address") || "";
  const postcode = params.get("postcode") || "";
  if (!address && !postcode) return null;
  return { address, postcode: postcode || null };
}

const TabLoader = () => (
  <div className="flex items-center justify-center h-64">
    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
  </div>
);

// Client quick-pick (UX #69): every tool on the hub started empty for a
// client — Map on default London, Land Registry "No searches yet", Business
// Rates blank — so they re-typed their own property's address into each
// tab. One tap here resolves the property page-wide: the context setter
// prefills Land Registry + Business Rates, and onPick seeds the Map.
// /api/crm/properties is client-scoped server-side, so this lists only
// their own portfolio.
function MyPropertiesBar({ onPick }: { onPick: (p: { id: string; name: string; postcode: string | null }) => void }) {
  const setCtxProperty = usePropertySetter();
  const { data: mineRaw } = useQuery<any[]>({ queryKey: ["/api/crm/properties"] });
  const mine = Array.isArray(mineRaw) ? mineRaw : [];
  if (mine.length === 0) return null;
  return (
    <div className="px-4 lg:px-6 pb-2 flex items-center gap-1.5 flex-wrap" data-testid="pi-my-properties">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mr-1">My properties</span>
      {mine.slice(0, 8).map((p: any) => (
        <button
          key={p.id}
          type="button"
          onClick={() => {
            const rp = { id: p.id, name: p.name, postcode: p.postcode || null };
            setCtxProperty(rp);
            onPick(rp);
          }}
          className="inline-flex items-center rounded-full border px-2.5 py-[5px] leading-none text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground hover:border-indigo-400 transition-colors"
          data-testid={`pi-my-property-${p.id}`}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

export default function PropertyIntelligence() {
  const [, navigate] = useLocation();
  // Client logins (e.g. Landsec) don't get Pathway (BGP's internal pitch
  // pipeline), Imagery (firm-wide image studio picker), or Investigator
  // (every /api/kyc-clouseau route is client-blocked by the API gateway,
  // so the tool can only dead-end for them). (Landsec audit.)
  const { data: piUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const piIsClient = piUser?.role === "Client" || !!(piUser as any)?.companyScopeId;
  const CLIENT_HIDDEN_TABS: TabId[] = ["pathway", "imagery", "investigator"];
  const visibleTabs = piIsClient ? TABS.filter(t => !CLIENT_HIDDEN_TABS.includes(t.id)) : TABS;
  // wouter's search string updates on every query-string change (including the
  // 'Open in Map' links from the Pathway tab, which only change ?tab/?address).
  const search = useSearch();
  const [tab, setTab] = useState<TabId>(readTabFromUrl());
  // Clients land on Map — the default (Pathway) is a hidden staff tab for them.
  useEffect(() => {
    if (piIsClient && CLIENT_HIDDEN_TABS.includes(tab)) setTab("map");
  }, [piIsClient, tab]);

  const handleTabChange = (next: string) => {
    const nextTab = next as TabId;
    setTab(nextTab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", nextTab);
    // Push (don't replace) so browser back steps through tab history.
    navigate(`/property-intelligence?${params.toString()}`);
  };

  // Pre-load a pendingSearch when we arrive via ?address=&postcode= URL params
  // (e.g. the 'Open in Map' button from the Pathway page). This makes the
  // Pathway map the canonical Goad/street-plan view across the app — no more
  // separate Retail Context Plan modal flow.
  const [pendingSearch, setPendingSearch] = useState<{ address: string; postcode: string | null } | null>(readSearchFromUrl());

  // Re-sync the active tab and the map's pending search whenever the URL query
  // changes. This is what makes 'Open in Map' work even when we're already on
  // the page (the link only changes ?tab=map&address=… — no remount), instead
  // of silently staying on the current tab.
  useEffect(() => {
    setTab(readTabFromUrl());
    const next = readSearchFromUrl();
    if (next) setPendingSearch(next);
  }, [search]);

  useEffect(() => {
    if (piIsClient && CLIENT_HIDDEN_TABS.includes(tab)) setTab("map");
  }, [piIsClient, tab]);
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
    {/* UX #83: min-h-screen only from md up — on phones the mobile shell
        already sizes this page to the space above the fixed bottom nav, and
        forcing 100vh pushed the map (h-full chain) underneath it, half-hiding
        the zoom controls. */}
    <div className="flex flex-col h-full md:min-h-screen">
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
          {/* Page-level resolver bar retired — the Map tab's sidebar now
              hosts the same PropertyResolverBar, and resolution flows up
              via onResolveProperty so every other tab still prefills via
              PropertyContext + the resolvedProperty state below. Saves a
              full bar of vertical real estate above the tab strip. */}
          <div className="px-4 lg:px-6 pt-3">
            <TabsList className="bg-transparent p-0 h-auto gap-x-1 gap-y-0.5 flex flex-wrap lg:flex-nowrap lg:w-max">
              {visibleTabs.map((t) => {
                const Icon = t.icon;
                return (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="flex items-center gap-1.5 px-2.5 lg:px-4 py-2.5 text-sm font-medium rounded-none border-b-2 -mb-px border-transparent text-muted-foreground hover:text-foreground data-[state=active]:border-indigo-500 data-[state=active]:text-indigo-600 data-[state=active]:shadow-none shrink-0 whitespace-nowrap"
                    data-testid={`pi-tab-${t.id}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          {piIsClient && (
            <MyPropertiesBar
              onPick={(p) => {
                setResolvedProperty(p);
                setPendingSearch({ address: p.name, postcode: p.postcode });
              }}
            />
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <Suspense fallback={<TabLoader />}>
            {/* forceMount keeps Pathway alive when user flips to Map/Investigator
                etc. so an in-flight background run keeps polling + state
                survives. Radix toggles data-state; we hide with display:none.
                Not mounted at all for clients — the tab is hidden for them and
                forceMount would fire staff-only pathway calls (403 noise). */}
            {!piIsClient && (
            <TabsContent
              value="pathway"
              forceMount
              className="m-0 data-[state=inactive]:hidden"
            >
              <PropertyPathway />
            </TabsContent>
            )}
            <TabsContent value="map" className="m-0 h-full">
              <EdozoMap
                initialSearch={pendingSearch}
                onSearchConsumed={() => setPendingSearch(null)}
                onResolveProperty={(p) => {
                  setResolvedProperty({ id: p.id, name: p.name, postcode: p.postcode });
                  setPendingSearch({ address: p.name, postcode: p.postcode });
                }}
              />
            </TabsContent>
            {/* Not mounted for clients — a ?tab=investigator deep link would
                otherwise mount KYC Clouseau for one render before the
                redirect effect runs, firing its (client-blocked) queries. */}
            {!piIsClient && (
            <TabsContent value="investigator" className="m-0 h-full">
              <KycClouseau />
            </TabsContent>
            )}
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
