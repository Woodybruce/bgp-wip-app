import { useState, useMemo, useEffect, lazy, Suspense } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { countLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { extractDomain, guessDomain, localBrandLogoUrl } from "@/lib/company-logos";
import {
  Store, TrendingUp, Flame, Star, Search, ChevronRight,
  MapPin, Maximize2, Zap, BarChart3, RefreshCw, Building2,
  FileText, Trophy, Sparkles, Play, Pause, Newspaper, ExternalLink,
  LayoutGrid, Crown, Shirt, Activity, ShoppingBag, Home as HomeIcon,
  Gift, Landmark, Briefcase, Utensils, Coffee, Wine, CakeSlice,
  UtensilsCrossed, Soup, Diamond, Car, Wifi, BookOpen, Smartphone,
  Flower2, Clapperboard, Tv, Gamepad2, Baby, Palette, PartyPopper,
  HeartPulse, Bath, Dumbbell, Tag, Wrench, Watch, Gem, Footprints,
  ShoppingCart, Crosshair, TrendingDown, Eye, Lightbulb, Target, ClipboardList,
  Plus, Check, Loader2, Phone, Mail,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAuthHeaders } from "@/lib/queryClient";

const TurnoverBoard = lazy(() => import("@/pages/turnover-board"));
const BrandHunterBoard = lazy(() => import("@/components/brand-hunter-board"));

interface HubData {
  stats: {
    total_brands: string;
    brands_with_turnover: string;
    brands_active_req: string;
  };
  categoryCounts: { company_type: string; count: string }[];
  hotBrands: HotBrand[];
  superBrands: Brand[];
  topTurnover: TurnoverEntry[];
  activeRequirements: ActiveReq[];
}

interface Brand {
  id: string;
  name: string;
  company_type: string | null;
  domain: string | null;
  description: string | null;
}

interface HotBrand extends Brand {
  last_activity: string;
  deal_count: string;
  req_count: string;
  contact_count: string;
}

interface TurnoverEntry {
  id: string;
  company_id: string;
  company_name: string;
  turnover: number;
  turnover_per_sqft: number | null;
  period: string;
  source: string;
  confidence: string;
  category: string | null;
  company_type: string | null;
  domain: string | null;
}

interface ActiveReq {
  id: string;
  company_id: string;
  company_name: string;
  company_type: string | null;
  domain: string | null;
  size: string[] | null;
  use: string[] | null;
  requirement_locations: string[] | null;
  comments: string | null;
  created_at: string;
  contact_count: string;
}

function formatTurnover(val: number): string {
  // Round before picking the unit so 999,999 shows as £1.0m, not £1000k.
  if (Math.round(val / 1_000_000) >= 1_000) return `£${(val / 1_000_000_000).toFixed(1)}bn`;
  if (Math.round(val / 1_000) >= 1_000) return `£${(val / 1_000_000).toFixed(1)}m`;
  if (Math.round(val) >= 1_000) return `£${(val / 1_000).toFixed(0)}k`;
  return `£${val.toFixed(0)}`;
}

function formatSize(sizes: string[] | null): string {
  if (!sizes?.length) return "—";
  return sizes.join(", ");
}

function BrandLogo({ name, domain, size = 32 }: { name: string; domain?: string | null; size?: number }) {
  const [failCount, setFailCount] = useState(0);

  const d = extractDomain(domain ?? null);
  const guessed = guessDomain(name);

  // Only source: /api/brand-logo/...  — the server redirects to logo.dev
  // (or Google favicons) when there's no local image. Clearbit was killed by
  // HubSpot March 2025 and the domain literally doesn't resolve any more.
  const sources: string[] = [];
  const local = localBrandLogoUrl(name, domain ?? guessed ?? null);
  if (local) sources.push(local);

  if (failCount < sources.length) {
    return (
      <img
        src={sources[failCount]}
        alt={name}
        loading="lazy"
        decoding="async"
        className="rounded object-contain bg-white"
        style={{ width: size, height: size }}
        onError={() => setFailCount(c => c + 1)}
      />
    );
  }

  const initial = name.charAt(0).toUpperCase();
  const colours = ["bg-rose-800","bg-red-900","bg-violet-900","bg-orange-900","bg-amber-800","bg-teal-900","bg-slate-700","bg-emerald-900"];
  const colour = colours[name.charCodeAt(0) % colours.length];
  return (
    <div className={`${colour} rounded flex items-center justify-center text-white font-bold`} style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initial}
    </div>
  );
}

function confidenceColour(c: string) {
  if (c === "High") return "bg-emerald-500";
  if (c === "Medium") return "bg-amber-500";
  return "bg-slate-400";
}

type HubTab = "overview" | "explorer" | "turnover" | "hunter";

export default function BrandsHub() {
  const { toast } = useToast();
  const searchParams = useSearch();
  const rawTab = new URLSearchParams(searchParams).get("tab");
  const isMobile = useIsMobile();
  // Mobile goes straight to Brand Explorer; desktop keeps the Overview landing.
  const initialTab: HubTab = rawTab && ["overview", "explorer", "turnover", "hunter"].includes(rawTab)
    ? rawTab as HubTab
    : (typeof window !== "undefined" && window.innerWidth < 768 ? "explorer" : "overview");
  const [activeTab, setActiveTab] = useState<HubTab>(initialTab);
  // Client logins (e.g. Landsec) get the full hub read-only — all four
  // boards; only the "Research Turnover" trigger panel stays staff-only
  // (the research POSTs are 403 for client accounts).
  const { data: hubUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClientHub = hubUser?.role === "Client" || !!hubUser?.companyScopeId;
  // The other boards (Overview/Turnover/Hunter) are still being built, so on
  // mobile we show only Brand Explorer. Desktop keeps the full tab bar.
  const VISIBLE_HUB_TABS = ([
    { key: "overview", label: "Overview", icon: BarChart3 },
    { key: "explorer", label: "Brand Explorer", icon: LayoutGrid },
    { key: "turnover", label: "Turnover Board", icon: TrendingUp },
    { key: "hunter",  label: "Brand Hunter",   icon: Crosshair },
  ] as { key: HubTab; label: string; icon: any }[])
    .filter(t => !isMobile || t.key === "explorer");
  const [search, setSearch] = useState("");
  const [researchingId, setResearchingId] = useState<string | null>(null);

  // Clients get the full Brand Intelligence hub (all four boards) — the
  // data endpoints scope the brand slice server-side. (Landsec request.)

  const { data, isLoading } = useQuery<HubData>({
    queryKey: ["/api/brands/hub"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/brands/hub");
      return res.json();
    },
    staleTime: 60_000,
  });

  const researchMut = useMutation({
    mutationFn: async (companyId: string) => {
      setResearchingId(companyId);
      const res = await apiRequest("POST", `/api/brands/research-turnover/${companyId}`);
      return res.json();
    },
    onSuccess: (result) => {
      setResearchingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/brands/hub"] });
      const t = result.researched?.turnover;
      toast({
        title: "Turnover researched",
        description: t && t > 0
          ? `${result.entry?.company_name}: ${formatTurnover(t)} (${result.researched.confidence} confidence)`
          : `No public turnover found for this brand`,
      });
    },
    onError: () => {
      setResearchingId(null);
      toast({ title: "Research failed", variant: "destructive" });
    },
  });

  const totalBrands = parseInt(data?.stats?.total_brands || "0");
  const brandsWithTurnover = parseInt(data?.stats?.brands_with_turnover || "0");
  const activeReqs = parseInt(data?.stats?.brands_active_req || "0");

  const filteredHot = useMemo(() => {
    if (!data?.hotBrands) return [];
    if (!search.trim()) return data.hotBrands;
    return data.hotBrands.filter(b => b.name.toLowerCase().includes(search.toLowerCase()));
  }, [data?.hotBrands, search]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Brand Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{isClientHub ? "Brands across your portfolio and the wider hospitality market" : "Live view of every brand across the Hub"}</p>
        </div>
        <div className="flex items-center gap-2">
          {isClientHub && <ClientAddBrandButton />}
          <Link href="/companies?tab=tenants">
            <Button variant="outline" size="sm">
              All Brands <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      {/* Mobile shows only Brand Explorer (the other boards are still being
          built); desktop keeps the full tab bar. Hidden tabs stay reachable
          via ?tab= for development. */}
      {VISIBLE_HUB_TABS.length > 1 && (
      <div className="flex gap-1.5 flex-wrap">
        {(VISIBLE_HUB_TABS as { key: HubTab; label: string; icon: any }[]).map(t => (
          <Pill key={t.key} active={activeTab === t.key} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </Pill>
        ))}
      </div>
      )}

      {activeTab === "overview" && (<>

      {/* ── Stats bar ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Brands", value: totalBrands },
          { label: "Brands with Live Requirements", value: activeReqs },
          { label: "With Turnover Data", value: brandsWithTurnover },
          { label: "Categories", value: BRAND_CATEGORIES.length },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
              <div className="text-2xl font-bold font-mono tabular-nums mt-0.5">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Top row: Turnover Leaders + Who's Hot + Super Brands ─────
           Three-column 'at a glance' strip. Layout collapses to 1-col
           on mobile / 2-col on tablet / 3-col on lg+ so the three
           snapshots stay legible without becoming postage stamps. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">

        {/* Turnover Leaderboard */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3 pt-4 px-5">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Turnover Leaders</CardTitle>
              <Badge variant="secondary" className="text-[10px]">{data?.topTurnover?.length || 0}</Badge>
            </div>
            <Link href="/brands?tab=turnover">
              <Button variant="ghost" size="sm" className="text-xs h-7">
                Show all <ChevronRight className="w-3 h-3 ml-0.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {!data?.topTurnover?.length ? (
              <div className="text-center py-6 text-muted-foreground">
                <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-xs">No turnover data yet</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-1">
                {data.topTurnover.slice(0, 10).map((t, i) => (
                  <div key={t.id} className="flex items-center gap-2 py-1.5 border-b last:border-0">
                    <span className={`text-xs font-bold w-4 shrink-0 ${i < 3 ? "text-primary" : "text-muted-foreground"}`}>
                      {i + 1}
                    </span>
                    <BrandLogo name={t.company_name} domain={t.domain} size={22} />
                    <div className="flex-1 min-w-0">
                      <Link href={`/companies/${t.company_id}`}>
                        <p className="text-xs font-medium hover:underline truncate">{t.company_name}</p>
                      </Link>
                      <p className="text-[9px] text-muted-foreground truncate">{(t.company_type || "").replace("Tenant - ", "")} · {t.period}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-emerald-600">{formatTurnover(t.turnover)}</p>
                      {t.turnover_per_sqft && (
                        <p className="text-[9px] text-muted-foreground">£{t.turnover_per_sqft.toFixed(0)}/sqft</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Who's Hot */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3 pt-4 px-5">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-500" />
              <CardTitle className="text-sm font-semibold">Who's Hot</CardTitle>
              <Badge variant="secondary" className="text-[10px]">{filteredHot.length}</Badge>
            </div>
            <span className="text-[10px] text-muted-foreground">last 90 days</span>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {!filteredHot.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">No recent brand activity</p>
            ) : (
              <div className="space-y-1 max-h-[460px] overflow-y-auto pr-1">
                {filteredHot.slice(0, 10).map(b => {
                  const daysAgo = Math.floor((Date.now() - new Date(b.last_activity).getTime()) / 86400000);
                  return (
                    <Link key={b.id} href={`/companies/${b.id}`}>
                      <div className="flex items-center gap-2 py-1.5 border-b last:border-0 hover:bg-muted/50 rounded -mx-1 px-1 transition-colors cursor-pointer">
                        <BrandLogo name={b.name} domain={b.domain} size={22} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{b.name}</p>
                          <p className="text-[9px] text-muted-foreground truncate">{(b.company_type || "").replace("Tenant - ", "")}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="flex items-center gap-1 justify-end">
                            {(parseInt(b.deal_count) || 0) > 0 && <Badge variant="secondary" className="text-[9px] px-1">{b.deal_count} deal{parseInt(b.deal_count) > 1 ? "s" : ""}</Badge>}
                            {(parseInt(b.req_count) || 0) > 0 && <Badge className="text-[9px] px-1">{b.req_count} req</Badge>}
                          </div>
                          <p className="text-[9px] text-muted-foreground mt-0.5">{daysAgo === 0 ? "today" : `${daysAgo}d ago`}</p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Super Brands — luxury/flagship intel, staff only (server sends
            [] for clients, so the card would sit permanently empty). */}
        {!isClientHub && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3 pt-4 px-5">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Super Brands</CardTitle>
              <Badge variant="secondary" className="text-[10px]">{data?.superBrands?.length || 0}</Badge>
            </div>
            <Link href="/companies?tab=tenants&cat=luxury">
              <Button variant="ghost" size="sm" className="text-xs h-7">
                Show all <ChevronRight className="w-3 h-3 ml-0.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <div className="flex flex-wrap gap-1.5 max-h-[460px] overflow-y-auto pr-1">
              {(data?.superBrands || []).map(b => (
                <Link key={b.id} href={`/companies/${b.id}`}>
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border bg-card hover:bg-muted/60 transition-colors cursor-pointer" title={b.name}>
                    <BrandLogo name={b.name} domain={b.domain} size={16} />
                    <span className="text-[11px] font-medium">{b.name}</span>
                  </div>
                </Link>
              ))}
              {!data?.superBrands?.length && (
                <p className="text-sm text-muted-foreground py-4">No luxury/flagship brands added yet</p>
              )}
            </div>
          </CardContent>
        </Card>
        )}
      </div>

      {/* ── Active Requirements Radar ───────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3 pt-4 px-5">
          <div className="flex items-center gap-2">
            <Maximize2 className="w-4 h-4 text-blue-500" />
            <CardTitle className="text-sm font-semibold">Active Requirements Radar</CardTitle>
            <Badge variant="secondary" className="text-[10px]">{data?.activeRequirements?.length || 0} brands searching</Badge>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          {!data?.activeRequirements?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No active requirements logged</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {data.activeRequirements.map(r => (
                <Link key={r.id} href={`/companies/${r.company_id}?tab=requirements`}>
                  <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors cursor-pointer">
                    <BrandLogo name={r.company_name} domain={r.domain} size={28} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.company_name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{(r.company_type || "").replace("Tenant - ", "")}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {/* max-w-full + truncate — free-text sizes ("Prezzo:
                            2,500-3,500 sq ft; Jamie's Italian: …") must clip
                            inside the card, not bleed across the grid. */}
                        {r.size?.length ? (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 max-w-full" title={formatSize(r.size)}>
                            <Maximize2 className="w-2.5 h-2.5 mr-0.5 shrink-0" />
                            <span className="truncate">{formatSize(r.size)}</span>
                          </Badge>
                        ) : null}
                        {r.requirement_locations && r.requirement_locations.length > 0 && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 max-w-full" title={r.requirement_locations.join(", ")}>
                            <MapPin className="w-2.5 h-2.5 mr-0.5 shrink-0" />
                            <span className="truncate">{r.requirement_locations.slice(0, 2).join(", ")}</span>
                          </Badge>
                        )}
                        {r.use?.length ? (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 max-w-full" title={r.use.join(", ")}>
                            <span className="truncate">{r.use.join(", ")}</span>
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Turnover Research Panel — staff-only (research POSTs are
             403 for client accounts, so don't show the trigger UI). ── */}
      {!isClientHub && (
      <Card>
        <CardHeader className="pb-3 pt-4 px-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-500" />
              <CardTitle className="text-sm font-semibold">Research Turnover</CardTitle>
            </div>
            <AutoTurnoverStatus />
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <TurnoverResearchPanel onResearch={(id) => researchMut.mutate(id)} researchingId={researchingId} />
        </CardContent>
      </Card>
      )}

      </>)}

      {activeTab === "explorer" && (
        <BrandExplorer />
      )}

      {activeTab === "turnover" && (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <TurnoverBoard embedded={true} />
        </Suspense>
      )}

      {activeTab === "hunter" && (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <BrandHunterBoard />
        </Suspense>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand Explorer (moved from People Hub)
// ─────────────────────────────────────────────────────────────────────────────

type SubCat = { key: string; label: string; icon: any; match: string[] };
type TopCat = { key: string; label: string; icon: any; color: string; gradient: string; subs: SubCat[] };

const BRAND_CATEGORIES: TopCat[] = [
  {
    key: "luxury", label: "Luxury", icon: Diamond, color: "bg-amber-800", gradient: "from-amber-800 to-amber-900",
    subs: [
      { key: "luxury-fashion", label: "Luxury Fashion", icon: Crown, match: ["Tenant - Luxury", "Tenant - Luxury Fashion"] },
      { key: "luxury-accessories", label: "Luxury Accessories", icon: Gem, match: ["Tenant - Luxury Accessories"] },
      { key: "luxury-beauty", label: "Luxury Beauty", icon: Sparkles, match: ["Tenant - Luxury Beauty"] },
      { key: "watches-jewellery", label: "Watches & Jewellery", icon: Watch, match: ["Tenant - Jewellery & Watches", "Tenant - Jewellery", "Tenant - Watches"] },
    ],
  },
  {
    key: "retail", label: "Fashion & Retail", icon: Store, color: "bg-rose-800", gradient: "from-rose-800 to-rose-900",
    subs: [
      { key: "flagship-fashion", label: "Flagship Fashion", icon: Crown, match: ["Tenant - Flagship Fashion"] },
      { key: "fashion", label: "Fashion", icon: Shirt, match: ["Tenant - Fashion", "Tenant - Clothing", "Tenant - Apparel", "Tenant - Womenswear", "Tenant - Menswear", "Tenant - Kidswear", "Tenant - Lingerie"] },
      { key: "athleisure", label: "Athleisure", icon: Activity, match: ["Tenant - Athleisure", "Tenant - Sportswear"] },
      { key: "footwear", label: "Footwear", icon: Footprints, match: ["Tenant - Footwear", "Tenant - Shoes"] },
      { key: "accessories", label: "Accessories", icon: ShoppingBag, match: ["Tenant - Accessories & Footwear", "Tenant - Accessories"] },
      { key: "beauty", label: "Beauty / Skincare / Fragrance", icon: Sparkles, match: ["Tenant - Beauty", "Tenant - Skincare", "Tenant - Fragrance", "Tenant - Beauty & Wellness", "Tenant - Cosmetics"] },
      { key: "homewares", label: "Homewares", icon: HomeIcon, match: ["Tenant - Homewares", "Tenant - Home", "Tenant - Interiors"] },
      { key: "lifestyle", label: "Lifestyle & Home", icon: Flower2, match: ["Tenant - Lifestyle & Home", "Tenant - Lifestyle", "Tenant - Art"] },
      { key: "gifts", label: "Gifts & Perfumes", icon: Gift, match: ["Tenant - Gifts & Perfumes", "Tenant - Gifts", "Tenant - Gifts & Speciality"] },
      { key: "department", label: "Department Stores", icon: Building2, match: ["Tenant - Department Store"] },
      { key: "technology", label: "Technology & Electronics", icon: Smartphone, match: ["Tenant - Technology", "Tenant - Electronics", "Tenant - Tech"] },
      { key: "automotive", label: "Automotive", icon: Car, match: ["Tenant - Automotive", "Tenant - Cars"] },
      { key: "telecoms", label: "Telecoms", icon: Wifi, match: ["Tenant - Telecoms", "Tenant - Telecommunications"] },
      { key: "books", label: "Books & Stationery", icon: BookOpen, match: ["Tenant - Books", "Tenant - Stationery", "Tenant - Books & Stationery"] },
      { key: "financial", label: "Financial Services", icon: Landmark, match: ["Tenant - Financial Services", "Tenant - Bank", "Tenant - Finance"] },
      { key: "services", label: "Services", icon: Briefcase, match: ["Tenant - Services", "Tenant - Optician", "Tenant - Travel", "Tenant - Other Services"] },
      // "National & Regional" dissolved (Woody, 2026-08-24: "doesn't make
      // any sense") — its sub-sectors live here so no brand loses a home.
      { key: "grocery", label: "Grocery & Convenience", icon: ShoppingCart, match: ["Tenant - Grocery", "Tenant - Convenience", "Tenant - Supermarket"] },
      { key: "value-retail", label: "Value & Discount", icon: Tag, match: ["Tenant - Value Retail", "Tenant - Discount", "Tenant - Pound Store"] },
      { key: "trade-diy", label: "Trade & DIY", icon: Wrench, match: ["Tenant - Trade", "Tenant - DIY", "Tenant - Hardware", "Tenant - Builders Merchants"] },
      { key: "national-other", label: "National Retail", icon: Building2, match: ["Tenant - National Retail", "Tenant - High Street"] },
      { key: "other-retail", label: "Other Retail", icon: Store, match: ["Tenant - Retail", "Tenant - General Retail"] },
    ],
  },
  {
    key: "restaurants", label: "Food & Drink", icon: Utensils, color: "bg-red-900", gradient: "from-red-900 to-rose-950",
    subs: [
      { key: "fine-dining", label: "Fine Dining", icon: UtensilsCrossed, match: ["Tenant - Fine Dining"] },
      { key: "casual-dining", label: "Casual Dining", icon: Utensils, match: ["Tenant - Casual Dining", "Tenant - Restaurant", "Tenant - Food & Drink"] },
      { key: "quick-service", label: "Quick Service", icon: Soup, match: ["Tenant - Quick Service", "Tenant - Fast Casual", "Tenant - Fast Food", "Tenant - QSR"] },
      { key: "cafes", label: "Cafés & Coffee", icon: Coffee, match: ["Tenant - Café", "Tenant - Coffee", "Tenant - Café & Coffee", "Tenant - F&B"] },
      { key: "bars", label: "Bars & Pubs", icon: Wine, match: ["Tenant - Bar", "Tenant - Pub", "Tenant - Wine Bar"] },
      { key: "bakery", label: "Bakery & Patisserie", icon: CakeSlice, match: ["Tenant - Bakery", "Tenant - Patisserie"] },
    ],
  },
  {
    key: "leisure", label: "Leisure & Experience", icon: Clapperboard, color: "bg-violet-900", gradient: "from-violet-900 to-purple-950",
    subs: [
      { key: "cinema", label: "Cinema", icon: Tv, match: ["Tenant - Cinema", "Tenant - Cinema & Film"] },
      { key: "experiential", label: "Experiential", icon: PartyPopper, match: ["Tenant - Experiential", "Tenant - Activation", "Tenant - Entertainment"] },
      { key: "immersive", label: "Immersive Experience", icon: Zap, match: ["Tenant - Immersive Experience", "Tenant - Immersive"] },
      { key: "gaming", label: "Gaming & Escape Rooms", icon: Gamepad2, match: ["Tenant - Gaming", "Tenant - Escape Room", "Tenant - Bowling", "Tenant - Arcade"] },
      { key: "family", label: "Family Entertainment", icon: Baby, match: ["Tenant - Family Entertainment", "Tenant - Family", "Tenant - Soft Play", "Tenant - Kids Entertainment"] },
      { key: "leisure-other", label: "Other Leisure", icon: Clapperboard, match: ["Tenant - Leisure"] },
      { key: "arts", label: "Arts & Culture", icon: Palette, match: ["Tenant - Arts", "Tenant - Culture", "Tenant - Gallery"] },
    ],
  },
  {
    key: "health", label: "Health & Wellness", icon: Dumbbell, color: "bg-orange-900", gradient: "from-orange-900 to-amber-950",
    subs: [
      { key: "gym", label: "Gym & Fitness", icon: Dumbbell, match: ["Tenant - Gym", "Tenant - Fitness", "Tenant - Gym & Fitness", "Tenant - Health & Fitness"] },
      { key: "wellness", label: "Wellness & Spa", icon: Bath, match: ["Tenant - Wellness", "Tenant - Spa", "Tenant - Hair", "Tenant - Nails", "Tenant - Aesthetics"] },
      { key: "yoga", label: "Yoga & Pilates", icon: HeartPulse, match: ["Tenant - Yoga", "Tenant - Pilates"] },
    ],
  },
  // "National & Regional" was retired as a top category (Woody, 2026-08-24:
  // "doesn't make any sense") — its sub-categories (grocery, value, trade &
  // DIY, high street) live under Fashion & Retail above.
];

function catMatch(companyType: string, cat: TopCat): boolean {
  const t = (companyType || "").toLowerCase().trim();
  return cat.subs.some(s => s.match.some(m => m.toLowerCase() === t));
}
function subMatch(companyType: string, sub: SubCat): boolean {
  const t = (companyType || "").toLowerCase().trim();
  return sub.match.some(m => m.toLowerCase() === t);
}

function BrandExplorer() {
  // Clients only receive the curated hospitality/F&B/leisure/fitness slice,
  // so hide the category cards that can never have brands for them (Luxury,
  // Fashion & Retail, …) rather than showing a row of zeros.
  const { data: exUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClientExplorer = exUser?.role === "Client" || !!exUser?.companyScopeId;
  // Phone landing search — one box over brands, contacts at brands and
  // acting agents (Woody, 2026-08-25: the category browser buried search
  // on mobile). Typing swaps the tiles for grouped results; clearing
  // brings the browser back.
  const isMobileExplorer = useIsMobile();
  const [quickQ, setQuickQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(quickQ), 250);
    return () => clearTimeout(t);
  }, [quickQ]);
  const quickActive = isMobileExplorer && debouncedQ.trim().length >= 2;
  const { data: quick, isFetching: quickLoading } = useQuery<{ brands: any[]; contacts: any[]; agents: any[] }>({
    queryKey: ["/api/brands/search", debouncedQ],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/brands/search?q=${encodeURIComponent(debouncedQ.trim())}`);
      return r.json();
    },
    enabled: quickActive,
    staleTime: 60_000,
  });
  // Phone lands clean every visit — All Brands, no remembered category or
  // search, market view only after a tap (Woody, 2026-08-25: "Brands from
  // the dashboard" should always look the same). Desktop keeps the memory.
  // window check mirrors BrandsHub's initialTab — useIsMobile's first
  // render can't be trusted inside a useState initializer.
  const landsClean = typeof window !== "undefined" && window.innerWidth < 768;
  const [activeCat, setActiveCat] = useState<string | null>(() => {
    if (landsClean) return null;
    // Saved selections may reference a retired category (e.g. "national") —
    // fall back to All rather than silently applying no filter.
    try {
      const saved = localStorage.getItem("brand-explorer-cat") || null;
      return saved && BRAND_CATEGORIES.some(c => c.key === saved) ? saved : null;
    } catch { return null; }
  });
  const [activeSub, setActiveSub] = useState<string | null>(() => {
    if (landsClean) return null;
    try {
      const saved = localStorage.getItem("brand-explorer-sub") || null;
      return saved && BRAND_CATEGORIES.some(c => c.subs.some(s => s.key === saved)) ? saved : null;
    } catch { return null; }
  });
  const [search, setSearch] = useState(() => {
    if (landsClean) return "";
    try { return localStorage.getItem("brand-explorer-search") || ""; } catch { return ""; }
  });
  const [relFilter, setRelFilter] = useState<string>("all");
  const [propFilter, setPropFilter] = useState<string>("all");

  const { data: allCompanies = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/companies"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/crm/companies");
      return res.json();
    },
    staleTime: 120_000,
  });

  // Firm-wide relationship flags per brand (staff only) — powers the
  // relationship pills, the targeted-at-property dropdown and card chips.
  const { data: explorerFlags = {} } = useQuery<Record<string, {
    isTenant: boolean;
    targetedAt: { propertyId: string; propertyName: string; unitName: string | null }[];
    hasContacts: boolean;
    hunterFlag: boolean;
    liveRequirement: boolean;
  }>>({
    queryKey: ["/api/brands/explorer-flags"],
    enabled: !isClientExplorer,
    staleTime: 120_000,
  });

  const targetProperties = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of Object.values(explorerFlags)) {
      for (const t of f.targetedAt || []) m.set(t.propertyId, t.propertyName);
    }
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [explorerFlags]);

  const companies = useMemo(
    () => (allCompanies as any[]).filter((c: any) => (c.companyType || "").startsWith("Tenant")),
    [allCompanies]
  );

  const companyById = useMemo(
    () => new Map((allCompanies as any[]).map((c: any) => [c.id, c])),
    [allCompanies]
  );

  const { data: brandNews = [] } = useQuery<any[]>({
    queryKey: ["/api/news-feed/articles", "brand-explorer"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/news-feed/articles?limit=40");
      const all = await res.json();
      return (all as any[])
        .filter((a: any) => a.category === "Retail" || a.category === "Hospitality")
        .slice(0, 12);
    },
    staleTime: 300_000,
  });

  const setCat = (v: string | null) => {
    setActiveCat(v);
    try { if (v) localStorage.setItem("brand-explorer-cat", v); else localStorage.removeItem("brand-explorer-cat"); } catch {}
  };
  const setSub = (v: string | null) => {
    setActiveSub(v);
    try { if (v) localStorage.setItem("brand-explorer-sub", v); else localStorage.removeItem("brand-explorer-sub"); } catch {}
  };
  const setSearchPersist = (v: string) => {
    setSearch(v);
    try { if (v) localStorage.setItem("brand-explorer-search", v); else localStorage.removeItem("brand-explorer-search"); } catch {}
  };

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    BRAND_CATEGORIES.forEach(cat => {
      counts[cat.key] = companies.filter(c => catMatch(c.companyType, cat)).length;
      cat.subs.forEach(sub => {
        counts[sub.key] = companies.filter(c => subMatch(c.companyType, sub)).length;
      });
    });
    return counts;
  }, [companies]);

  const activeCatObj = BRAND_CATEGORIES.find(c => c.key === activeCat);

  const filtered = useMemo(() => {
    let list = companies;
    if (activeSub && activeCatObj) {
      const sub = activeCatObj.subs.find(s => s.key === activeSub);
      if (sub) list = list.filter(c => subMatch(c.companyType, sub));
    } else if (activeCatObj) {
      list = list.filter(c => catMatch(c.companyType, activeCatObj));
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(s));
    }
    if (!isClientExplorer && relFilter !== "all") {
      list = list.filter(c => {
        const f = explorerFlags[c.id];
        if (!f) return false;
        if (relFilter === "tenant") return f.isTenant;
        if (relFilter === "targeted") return (f.targetedAt || []).length > 0;
        if (relFilter === "contacts") return f.hasContacts;
        if (relFilter === "hunter") return f.hunterFlag;
        if (relFilter === "requirement") return f.liveRequirement;
        return true;
      });
    }
    if (!isClientExplorer && propFilter !== "all") {
      list = list.filter(c => (explorerFlags[c.id]?.targetedAt || []).some(t => t.propertyId === propFilter));
    }
    return list.sort((a: any, b: any) => a.name.localeCompare(b.name));
  }, [companies, activeCat, activeSub, activeCatObj, search, isClientExplorer, relFilter, propFilter, explorerFlags]);

  return (
    <div className="space-y-4">
      {/* Phone landing: search first — brands, contacts, acting agents. */}
      {isMobileExplorer && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search brands, contacts, agents…"
            value={quickQ}
            onChange={e => setQuickQ(e.target.value)}
            className="pl-9 h-11 rounded-xl"
            data-testid="brand-quick-search"
          />
        </div>
      )}

      {quickActive ? (
        <div className="space-y-4" data-testid="brand-quick-results">
          {quickLoading && !quick && (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full rounded-2xl" />
              <Skeleton className="h-14 w-full rounded-2xl" />
            </div>
          )}
          {quick && (quick.brands.length + quick.contacts.length + quick.agents.length) === 0 && (
            <p className="text-sm text-muted-foreground px-1">
              No matches for “{debouncedQ.trim()}” — try a shorter name.
            </p>
          )}

          {(quick?.brands?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">Brands</div>
              {quick!.brands.map((b: any) => (
                <div key={b.id} className="rounded-2xl bg-card border border-border min-w-0">
                  <Link href={`/companies/${b.id}`} className="flex items-center gap-3 p-3 min-w-0">
                    <BrandLogo name={b.name} domain={b.domain} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{b.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {(b.company_type || "").replace(/^Tenant\s*-?\s*/i, "") || "Brand"}
                      </div>
                    </div>
                    {b.store_count != null && (
                      <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">{b.store_count} stores</span>
                    )}
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </Link>
                  {(b.contacts?.length ?? 0) > 0 && (
                    <div className="border-t border-border/50">
                      {b.contacts.map((ct: any) => (
                        <div key={ct.id} className="flex items-center gap-3 px-3 py-2 min-w-0 border-b border-border/30 last:border-b-0">
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium truncate">{ct.name}</div>
                            {ct.role && <div className="text-[11px] text-muted-foreground truncate">{ct.role}</div>}
                          </div>
                          {ct.phone && (
                            <a href={`tel:${String(ct.phone).replace(/[^\d+]/g, "")}`} className="w-9 h-9 rounded-full border border-border flex items-center justify-center shrink-0" aria-label={`Call ${ct.name}`}>
                              <Phone className="w-4 h-4" />
                            </a>
                          )}
                          {ct.email && (
                            <a href={`mailto:${ct.email}`} className="w-9 h-9 rounded-full border border-border flex items-center justify-center shrink-0" aria-label={`Email ${ct.name}`}>
                              <Mail className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {(quick?.contacts?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">Contacts</div>
              {quick!.contacts.map((ct: any) => (
                <div key={ct.id} className="flex items-center gap-3 rounded-2xl bg-card border border-border p-3 min-w-0">
                  <Link href={`/companies/${ct.brand_id}`} className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{ct.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {[ct.role, ct.brand_name].filter(Boolean).join(" · ")}
                    </div>
                  </Link>
                  {ct.phone && (
                    <a href={`tel:${String(ct.phone).replace(/[^\d+]/g, "")}`} className="w-9 h-9 rounded-full border border-border flex items-center justify-center shrink-0" aria-label={`Call ${ct.name}`}>
                      <Phone className="w-4 h-4" />
                    </a>
                  )}
                  {ct.email && (
                    <a href={`mailto:${ct.email}`} className="w-9 h-9 rounded-full border border-border flex items-center justify-center shrink-0" aria-label={`Email ${ct.name}`}>
                      <Mail className="w-4 h-4" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {!isClientExplorer && (quick?.agents?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">Acting agents</div>
              {quick!.agents.map((a: any) => (
                <Link key={a.id} href={`/companies/${a.id}`} className="block rounded-2xl bg-card border border-border p-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Briefcase className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate flex-1">{a.name}</span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 truncate">
                    Acts for {(a.brands || []).slice(0, 4).join(", ")}{(a.brands || []).length > 4 ? ` +${a.brands.length - 4} more` : ""}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : (
      <>
      {/* Category cards — the category browser (docs/DESIGN.md §1/§8):
          standard token cards with a small category-coloured dot, no
          gradients. Distinct from the relationship pills below (tiles
          filter by category, pills by relationship status). */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
        <button
          type="button"
          className={`text-left rounded-2xl border bg-card p-3.5 transition-colors ${
            activeCat === null ? "border-foreground shadow-sm" : "border-border hover:bg-muted/50"
          }`}
          onClick={() => { setCat(null); setSub(null); }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-muted-foreground shrink-0" />
            <span className="text-sm font-semibold truncate">All Brands</span>
          </div>
          <div className="text-sm font-mono tabular-nums text-muted-foreground mt-1">{companies.length}</div>
        </button>
        {BRAND_CATEGORIES.filter(cat => !isClientExplorer || (catCounts[cat.key] || 0) > 0).map(cat => {
          const isActive = activeCat === cat.key;
          return (
            <button
              type="button"
              key={cat.key}
              className={`text-left rounded-2xl border bg-card p-3.5 transition-colors ${
                isActive ? "border-foreground shadow-sm" : "border-border hover:bg-muted/50"
              }`}
              onClick={() => { setCat(isActive ? null : cat.key); setSub(null); }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${cat.color}`} />
                <span className="text-sm font-semibold truncate">{cat.label}</span>
              </div>
              <div className="text-sm font-mono tabular-nums text-muted-foreground mt-1">{catCounts[cat.key] || 0}</div>
            </button>
          );
        })}
      </div>

      {/* Subcategory pills */}
      {activeCatObj && (
        <div className="flex flex-wrap gap-1.5">
          <Pill active={activeSub === null} onClick={() => setSub(null)}>
            All {activeCatObj.label} <span className="font-mono tabular-nums">{catCounts[activeCatObj.key] || 0}</span>
          </Pill>
          {activeCatObj.subs.filter(sub => !isClientExplorer || (catCounts[sub.key] || 0) > 0).map(sub => {
            const count = catCounts[sub.key] || 0;
            const isActive = activeSub === sub.key;
            return (
              <Pill key={sub.key} active={isActive} onClick={() => setSub(isActive ? null : sub.key)}>
                {sub.label} <span className="font-mono tabular-nums">{count}</span>
              </Pill>
            );
          })}
        </div>
      )}

      {/* Market commentary — sub takes precedence over top */}
      {activeCatObj && (() => {
        const activeSubObj = activeSub ? activeCatObj.subs.find(s => s.key === activeSub) : null;
        if (activeSubObj) {
          return (
            <MarketCommentaryBoard
              scopeKey={activeSubObj.key}
              scopeLabel={activeSubObj.label}
              scopeType="sub"
              parentKey={activeCatObj.key}
              parentLabel={activeCatObj.label}
              matches={activeSubObj.match}
              gradient={activeCatObj.gradient}
              accent={activeCatObj.color}
            />
          );
        }
        const allMatches = activeCatObj.subs.flatMap(s => s.match);
        return (
          <MarketCommentaryBoard
            scopeKey={activeCatObj.key}
            scopeLabel={activeCatObj.label}
            scopeType="top"
            matches={allMatches}
            gradient={activeCatObj.gradient}
            accent={activeCatObj.color}
          />
        );
      })()}

      {/* Search + relationship filters + count. The grid filter input is
          desktop-only — the phone already leads with the quick-search box. */}
      <div className="flex items-center gap-3 flex-wrap">
        {!isMobileExplorer && (
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search brands..."
            value={search}
            onChange={e => setSearchPersist(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        )}
        {!isClientExplorer && (
          <>
            <div className="flex gap-1.5 flex-wrap">
              {([
                ["all", "All"],
                ["tenant", "Existing tenants"],
                ["targeted", "Being targeted"],
                ["contacts", "With contacts"],
                ["requirement", "Live requirement"],
                ["hunter", "Hunter-flagged"],
              ] as const).map(([key, label]) => (
                <Pill
                  key={key}
                  active={relFilter === key}
                  onClick={() => setRelFilter(key)}
                  data-testid={`explorer-rel-${key}`}
                >
                  {label}
                </Pill>
              ))}
            </div>
            {targetProperties.length > 0 && (
              <select
                value={propFilter}
                onChange={e => setPropFilter(e.target.value)}
                className="h-7 rounded-full border bg-background px-2.5 text-xs text-muted-foreground"
                data-testid="explorer-prop-filter"
              >
                <option value="all">Targeted at: any property</option>
                {targetProperties.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </>
        )}
        <p className="text-sm text-muted-foreground ml-auto">{countLabel(filtered.length, "result")}</p>
      </div>

      {/* Brand cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 gap-2">
        {filtered.map((c: any) => {
          const parent = c.parentCompanyId ? companyById.get(c.parentCompanyId) : null;
          const cf = isClientExplorer ? undefined : explorerFlags[c.id];
          const targetCount = (cf?.targetedAt || []).length;
          return (
            <div key={c.id} className="relative flex flex-col items-center gap-1.5 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-center group">
              <Link href={`/companies/${c.id}`} className="absolute inset-0 rounded-lg" aria-label={c.name} />
              <BrandLogo name={c.name} domain={c.domain} size={36} />
              <p className="text-xs font-medium leading-tight truncate w-full group-hover:text-primary transition-colors">{c.name}</p>
              <p className="text-[10px] text-muted-foreground truncate w-full">{(c.companyType || "").replace("Tenant - ", "")}</p>
              {cf && (cf.isTenant || targetCount > 0 || cf.liveRequirement) && (
                <div className="flex items-center justify-center gap-1 flex-wrap">
                  {cf.isTenant && (
                    <span className="text-[9px] px-1.5 py-px rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">Tenant</span>
                  )}
                  {targetCount > 0 && (
                    <span
                      className="text-[9px] px-1.5 py-px rounded-full border border-amber-400 text-amber-700 dark:text-amber-400 inline-flex items-center gap-0.5"
                      title={(cf.targetedAt || []).map(t => `${t.unitName ? `${t.unitName} · ` : ""}${t.propertyName}`).join("\n")}
                    >
                      <Target className="w-2.5 h-2.5" />{targetCount}
                    </span>
                  )}
                  {cf.liveRequirement && (
                    <span className="text-[9px] px-1.5 py-px rounded-full border border-violet-400 text-violet-700 dark:text-violet-400 inline-flex items-center gap-0.5" title="Live leasing requirement">
                      <ClipboardList className="w-2.5 h-2.5" />Req
                    </span>
                  )}
                </div>
              )}
              {c.parentCompanyId && (
                <Link
                  href={`/companies/${c.parentCompanyId}`}
                  className="relative z-10 text-[10px] text-muted-foreground hover:text-primary transition-colors truncate w-full"
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  title={`Part of ${parent?.name || "parent company"}`}
                >
                  ↑ {parent?.name || "Parent co."}
                </Link>
              )}
            </div>
          );
        })}
        {!filtered.length && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            <Store className="w-10 h-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No brands found</p>
          </div>
        )}
      </div>

      {/* Brand news feed */}
      {brandNews.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Newspaper className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Brand News</h3>
            <Badge variant="secondary" className="text-[10px]">{brandNews.length}</Badge>
            <Link href="/news" className="ml-auto">
              <Button variant="ghost" size="sm" className="text-xs h-7">
                Show all <ChevronRight className="w-3 h-3 ml-0.5" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {brandNews.map((article: any) => (
              <a
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-2.5 p-2.5 rounded-lg border bg-card hover:bg-muted/50 transition-colors group"
              >
                {article.imageUrl && (
                  <img
                    src={article.imageUrl}
                    alt=""
                    className="w-14 h-14 rounded object-cover shrink-0 border"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">{article.title}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    {article.sourceName && <span className="text-[10px] text-muted-foreground truncate">{article.sourceName}</span>}
                    {article.publishedAt && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        · {new Date(article.publishedAt).toLocaleDateString("en-GB")}
                      </span>
                    )}
                    <ExternalLink className="w-2.5 h-2.5 text-muted-foreground ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Commentary Board — AI-generated sector view above the brand grid
// ─────────────────────────────────────────────────────────────────────────────

interface CommentaryEntry { name: string; reason: string }
interface CommentaryContent {
  headline: string;
  summary: string;
  trends: string[];
  winners: CommentaryEntry[];
  losers: CommentaryEntry[];
  watch: CommentaryEntry[];
  outlook: string;
}
interface MarketCommentary {
  scopeKey: string;
  scopeLabel: string;
  scopeType: "top" | "sub";
  parentKey: string | null;
  parentLabel: string | null;
  content: CommentaryContent;
  brandCount: number;
  newsCount: number;
  generatedAt: string;
  cached?: boolean;
  stale?: boolean;
  generating?: boolean;
}

function MarketCommentaryBoard({
  scopeKey, scopeLabel, scopeType, parentKey, parentLabel, matches, gradient, accent,
}: {
  scopeKey: string;
  scopeLabel: string;
  scopeType: "top" | "sub";
  parentKey?: string;
  parentLabel?: string;
  matches: string[];
  gradient: string;
  accent: string;
}) {
  const { toast } = useToast();
  const { data: mcViewer } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const mcIsClient = mcViewer?.role === "Client" || !!mcViewer?.companyScopeId;
  const params = new URLSearchParams({
    scope: scopeKey,
    label: scopeLabel,
    type: scopeType,
    matches: JSON.stringify(matches),
  });
  if (parentKey) params.set("parentKey", parentKey);
  if (parentLabel) params.set("parentLabel", parentLabel);
  const url = `/api/brands/market-commentary?${params.toString()}`;

  const { data, isLoading, refetch, isFetching } = useQuery<MarketCommentary>({
    queryKey: ["/api/brands/market-commentary", scopeKey],
    queryFn: async () => {
      const res = await apiRequest("GET", url);
      return res.json();
    },
    staleTime: 60 * 60 * 1000, // 1h — server has 24h TTL, this just stops refetch on tab switch
    // First-ever visit to a scope: the server replies {generating:true}
    // straight away and writes the commentary in the background — poll
    // until the row lands instead of blocking the page on a 20-60s wait.
    refetchInterval: (query) => (query.state.data?.generating ? 8000 : false),
  });

  const regenMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/brands/market-commentary/regenerate", {
        scope: scopeKey,
        label: scopeLabel,
        type: scopeType,
        parentKey: parentKey || null,
        parentLabel: parentLabel || null,
        matches,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Commentary refreshed" });
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Refresh failed", description: err?.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <Skeleton className="h-12 w-full rounded-xl" />;
  }
  if (!data) return null;
  if (data.generating || !data.content) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Sparkles className="w-4 h-4 shrink-0 animate-pulse" />
        <span>Market view for {scopeLabel} is being written — it'll appear here in a minute.</span>
      </div>
    );
  }

  const c = data.content;
  const generatedAgo = (() => {
    const ms = Date.now() - new Date(data.generatedAt).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  })();

  const refreshing = regenMut.isPending || isFetching;
  const hasWinners = c.winners?.length > 0;
  const hasLosers = c.losers?.length > 0;
  const hasWatch = c.watch?.length > 0;

  return (
    <Card className="overflow-hidden border">
      <div className={`bg-gradient-to-br ${gradient} text-white px-5 py-4`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Sparkles className="w-4 h-4 mt-0.5 shrink-0 opacity-90" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide opacity-80 font-medium">
                Market View {parentLabel ? `· ${parentLabel}` : ""}
              </div>
              <div className="text-lg font-bold leading-snug">
                {c.headline || scopeLabel}
              </div>
            </div>
          </div>
          {!mcIsClient && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px] text-white hover:bg-white/20 hover:text-white shrink-0"
            onClick={() => regenMut.mutate()}
            disabled={refreshing}
            title="Regenerate commentary"
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          )}
        </div>
      </div>

      <CardContent className="p-5 space-y-4">
        {c.summary && (
          <p className="text-sm leading-relaxed">{c.summary}</p>
        )}

        {(hasWinners || hasLosers || hasWatch) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {hasWinners && (
              <div className="rounded-lg border bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-900/40 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-2">
                  <TrendingUp className="w-3.5 h-3.5" /> Winners
                </div>
                <ul className="space-y-2">
                  {c.winners.map((w, i) => (
                    <li key={i}>
                      <div className="text-sm font-medium leading-tight">{w.name}</div>
                      <div className="text-[11px] text-muted-foreground leading-snug">{w.reason}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {hasLosers && (
              <div className="rounded-lg border bg-rose-50/60 dark:bg-rose-950/20 border-rose-200/60 dark:border-rose-900/40 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400 mb-2">
                  <TrendingDown className="w-3.5 h-3.5" /> Losers
                </div>
                <ul className="space-y-2">
                  {c.losers.map((w, i) => (
                    <li key={i}>
                      <div className="text-sm font-medium leading-tight">{w.name}</div>
                      <div className="text-[11px] text-muted-foreground leading-snug">{w.reason}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {hasWatch && (
              <div className="rounded-lg border bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-900/40 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2">
                  <Eye className="w-3.5 h-3.5" /> Watch
                </div>
                <ul className="space-y-2">
                  {c.watch.map((w, i) => (
                    <li key={i}>
                      <div className="text-sm font-medium leading-tight">{w.name}</div>
                      <div className="text-[11px] text-muted-foreground leading-snug">{w.reason}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {c.trends?.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1.5">
              <Lightbulb className="w-3.5 h-3.5" /> Trends
            </div>
            <ul className="space-y-1">
              {c.trends.map((t, i) => (
                <li key={i} className="text-sm flex gap-2">
                  <span className={`mt-1.5 w-1 h-1 rounded-full ${accent} shrink-0`} />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {c.outlook && (
          <div className="pt-2 border-t">
            <span className="text-xs font-semibold text-muted-foreground">Outlook · </span>
            <span className="text-sm italic">{c.outlook}</span>
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
          <span>Generated by ChatBGP from {data.brandCount} brands · {data.newsCount} recent articles</span>
          <span>Updated {generatedAgo}{data.stale ? " · stale" : ""}</span>
        </div>
      </CardContent>
    </Card>
  );
}

interface AutoTurnoverStatusData {
  enabled: boolean;
  running: boolean;
  intervalHours: number;
  batchSize: number;
  lastRun: string | null;
  lastResult: { processed?: number; brands?: string[]; error?: string } | null;
  nextRun: string | null;
}

function AutoTurnoverStatus() {
  const { toast } = useToast();

  const { data: status, refetch } = useQuery<AutoTurnoverStatusData>({
    queryKey: ["/api/brands/turnover-research/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/brands/turnover-research/status");
      return res.json();
    },
    refetchInterval: (query) => (query.state.data?.running ? 5000 : 30000),
    staleTime: 10_000,
  });

  const toggleMut = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("POST", "/api/brands/turnover-research/toggle", { enabled });
      return res.json();
    },
    onSuccess: () => refetch(),
  });

  const runNowMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/brands/turnover-research/run-now");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Research cycle started", description: `Researching up to ${status?.batchSize || 4} brands in background` });
      setTimeout(() => refetch(), 3000);
    },
  });

  if (!status) return null;

  const lastRunAgo = status.lastRun
    ? Math.floor((Date.now() - new Date(status.lastRun).getTime()) / 60000)
    : null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {status.running && (
        <span className="flex items-center gap-1.5 text-[10px] text-violet-600 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
          Researching…
        </span>
      )}
      {!status.running && status.enabled && (
        <span className="flex items-center gap-1.5 text-[10px] text-emerald-600">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Auto-on · {status.intervalHours}h cycle
          {lastRunAgo !== null && ` · ${lastRunAgo < 60 ? `${lastRunAgo}m ago` : `${Math.floor(lastRunAgo / 60)}h ago`}`}
          {status.lastResult?.processed ? ` · ${status.lastResult.processed} done` : ""}
        </span>
      )}
      {!status.enabled && (
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          Auto-off
        </span>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[10px] px-2"
        onClick={() => runNowMut.mutate()}
        disabled={runNowMut.isPending || status.running}
        title="Run a research batch now"
      >
        <RefreshCw className={`w-3 h-3 mr-1 ${status.running ? "animate-spin" : ""}`} />
        Run now
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[10px] px-2"
        onClick={() => toggleMut.mutate(!status.enabled)}
        disabled={toggleMut.isPending}
        title={status.enabled ? "Pause auto-research" : "Resume auto-research"}
      >
        {status.enabled ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
      </Button>
    </div>
  );
}

function TurnoverResearchPanel({ onResearch, researchingId }: { onResearch: (id: string) => void; researchingId: string | null }) {
  const [search, setSearch] = useState("");

  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/companies"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/crm/companies");
      const all = await res.json();
      return (all as any[]).filter((c: any) => (c.companyType || "").startsWith("Tenant"));
    },
    staleTime: 120_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return companies.slice(0, 20);
    const s = search.toLowerCase();
    return companies.filter((c: any) => c.name.toLowerCase().includes(s)).slice(0, 20);
  }, [companies, search]);

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search a brand to research..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-9"
        />
      </div>
      {search.trim() && (
        <div className="space-y-1.5">
          {filtered.map((c: any) => (
            <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg border bg-card">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{c.name}</p>
                <p className="text-[10px] text-muted-foreground">{(c.companyType || "").replace("Tenant - ", "")}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs shrink-0"
                onClick={() => onResearch(c.id)}
                disabled={researchingId === c.id}
              >
                {researchingId === c.id ? (
                  <><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Researching…</>
                ) : (
                  <><Sparkles className="w-3 h-3 mr-1" /> Research</>
                )}
              </Button>
            </div>
          ))}
          {!filtered.length && <p className="text-sm text-muted-foreground">No brands found</p>}
        </div>
      )}
      {!search.trim() && (
        <p className="text-xs text-muted-foreground">
          Type a brand name above. Claude will check Companies House accounts + public sources to estimate annual turnover and store it in your Turnover Board.
        </p>
      )}
    </div>
  );
}

// Client-only: pull a brand from the global directory into this client's CRM.
// Their CRM auto-shows the hospitality/F&B/leisure/fitness slice; this adds
// anything else (fashion, beauty, etc.) they want to track.
function ClientAddBrandButton() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/client/crm/global-brands?search=${encodeURIComponent(q.trim())}`, { credentials: "include", headers: getAuthHeaders() });
        const d = await r.json();
        if (!cancelled) setResults(Array.isArray(d) ? d : []);
      } catch { if (!cancelled) setResults([]); }
      finally { if (!cancelled) setLoading(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  const add = async (id: string) => {
    setAddingId(id);
    try {
      await apiRequest("POST", "/api/client/crm/add-brand", { brandId: id });
      setResults(prev => prev.map(b => b.id === id ? { ...b, added: true } : b));
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/brands/hub"] });
      toast({ title: "Brand added to your CRM", description: "Tap the brand name to open its profile." });
    } catch (e: any) {
      toast({ title: "Couldn't add brand", description: e.message, variant: "destructive" });
    } finally { setAddingId(null); }
  };

  const remove = async (id: string) => {
    setAddingId(id);
    try {
      await apiRequest("DELETE", `/api/client/crm/add-brand/${id}`);
      setResults(prev => prev.map(b => b.id === id ? { ...b, added: false } : b));
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/brands/hub"] });
      toast({ title: "Brand removed from your CRM" });
    } catch (e: any) {
      toast({ title: "Couldn't remove brand", description: e.message, variant: "destructive" });
    } finally { setAddingId(null); }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="client-add-brand">
        <Plus className="w-3 h-3 mr-1" /> Add brand
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a brand to your CRM</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Your CRM shows hospitality, F&amp;B, leisure and fitness brands automatically. Search the wider directory to add any other brand you want to track.</p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search all brands…" className="pl-8 h-9 text-sm" data-testid="client-add-brand-search" />
            </div>
            <div className="max-h-[320px] overflow-y-auto space-y-1">
              {loading && <p className="text-xs text-muted-foreground py-2 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Searching…</p>}
              {!loading && q.trim().length >= 2 && results.length === 0 && <p className="text-xs text-muted-foreground py-2">No brands match.</p>}
              {results.map(b => (
                <div key={b.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border bg-card">
                  <div className="min-w-0">
                    {/* Once a brand is visible (in-slice or just added), its
                        name links straight to the profile — no re-finding it
                        via Brand Explorer (UX #27). */}
                    {(b.inSlice || b.added) ? (
                      <a href={`/companies/${b.id}`} className="text-sm font-medium truncate block text-primary hover:underline" data-testid={`client-open-brand-${b.id}`}>{b.name}</a>
                    ) : (
                      <div className="text-sm font-medium truncate">{b.name}</div>
                    )}
                    <div className="text-[10px] text-muted-foreground">{(b.companyType || "").replace(/^Tenant - /, "")}{b.inSlice ? " · already in your CRM" : ""}</div>
                  </div>
                  {b.inSlice ? (
                    <Badge variant="outline" className="text-[10px] gap-1 shrink-0"><Check className="w-3 h-3" /> In CRM</Badge>
                  ) : b.added ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className="text-[10px] gap-1"><Check className="w-3 h-3" /> Added</Badge>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={addingId === b.id} onClick={() => remove(b.id)} data-testid={`client-remove-brand-${b.id}`}>
                        {addingId === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Remove"}
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" className="h-7 text-xs shrink-0" disabled={addingId === b.id} onClick={() => add(b.id)}>
                      {addingId === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Plus className="w-3 h-3 mr-1" /> Add</>}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
