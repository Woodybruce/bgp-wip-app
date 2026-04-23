import { useState, useMemo, lazy, Suspense } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { extractDomain, guessDomain } from "@/lib/company-logos";
import {
  Store, TrendingUp, Flame, Star, Search, ChevronRight,
  MapPin, Maximize2, Zap, BarChart3, RefreshCw, Building2,
  FileText, Trophy, Sparkles, Play, Pause, Newspaper, ExternalLink,
  LayoutGrid, Crown, Shirt, Activity, ShoppingBag, Home as HomeIcon,
  Gift, Landmark, Briefcase, Utensils, Coffee, Wine, CakeSlice,
  UtensilsCrossed, Soup, Diamond, Car, Wifi, BookOpen, Smartphone,
  Flower2, Clapperboard, Tv, Gamepad2, Baby, Palette, PartyPopper,
  HeartPulse, Bath, Dumbbell, Tag, Wrench, Watch, Gem, Footprints,
  ShoppingCart,
} from "lucide-react";

const TurnoverBoard = lazy(() => import("@/pages/turnover-board"));

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
  size_min: number | null;
  size_max: number | null;
  locations: string[] | null;
  use: string | null;
  notes: string | null;
  created_at: string;
  contact_count: string;
}

function formatTurnover(val: number): string {
  if (val >= 1_000_000_000) return `£${(val / 1_000_000_000).toFixed(1)}bn`;
  if (val >= 1_000_000) return `£${(val / 1_000_000).toFixed(0)}m`;
  if (val >= 1_000) return `£${(val / 1_000).toFixed(0)}k`;
  return `£${val.toFixed(0)}`;
}

function formatSize(min: number | null, max: number | null): string {
  if (!min && !max) return "—";
  if (min && max) return `${min.toLocaleString()}–${max.toLocaleString()} sq ft`;
  if (min) return `${min.toLocaleString()}+ sq ft`;
  return `up to ${max!.toLocaleString()} sq ft`;
}

function BrandLogo({ name, domain, size = 32 }: { name: string; domain?: string | null; size?: number }) {
  const [failCount, setFailCount] = useState(0);

  const d = extractDomain(domain ?? null);
  const guessed = guessDomain(name);

  const sources: string[] = [];
  if (d) {
    sources.push(`https://logo.clearbit.com/${d}?size=${Math.min(size * 3, 512)}`);
    sources.push(`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${d}&size=128`);
  }
  if (guessed && guessed !== d) {
    sources.push(`https://logo.clearbit.com/${guessed}?size=${Math.min(size * 3, 512)}`);
    sources.push(`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${guessed}&size=128`);
  }

  if (failCount < sources.length) {
    return (
      <img
        src={sources[failCount]}
        alt={name}
        className="rounded object-contain bg-white"
        style={{ width: size, height: size }}
        onError={() => setFailCount(c => c + 1)}
      />
    );
  }

  const initial = name.charAt(0).toUpperCase();
  const colours = ["bg-pink-600","bg-rose-600","bg-purple-600","bg-orange-600","bg-yellow-600","bg-teal-600","bg-sky-600","bg-emerald-600"];
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

type HubTab = "overview" | "explorer" | "turnover";

export default function BrandsHub() {
  const { toast } = useToast();
  const searchParams = useSearch();
  const rawTab = new URLSearchParams(searchParams).get("tab");
  const initialTab: HubTab = rawTab && ["overview", "explorer", "turnover"].includes(rawTab) ? rawTab as HubTab : "overview";
  const [activeTab, setActiveTab] = useState<HubTab>(initialTab);
  const [search, setSearch] = useState("");
  const [researchingId, setResearchingId] = useState<string | null>(null);

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
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Store className="w-6 h-6 text-pink-500" />
            Brand Intelligence
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Live view of every brand across the Hub</p>
        </div>
        <Link href="/companies?tab=tenants">
          <Button variant="outline" size="sm">
            All Brands <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        </Link>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b">
        {([
          { key: "overview", label: "Overview", icon: BarChart3 },
          { key: "explorer", label: "Brand Explorer", icon: LayoutGrid },
          { key: "turnover", label: "Turnover Board", icon: TrendingUp },
        ] as { key: HubTab; label: string; icon: any }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === t.key
                ? "border-pink-500 text-pink-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (<>

      {/* ── Stats bar ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Brands", value: totalBrands, icon: Store, colour: "text-pink-500" },
          { label: "Active Requirements", value: activeReqs, icon: FileText, colour: "text-blue-500" },
          { label: "With Turnover Data", value: brandsWithTurnover, icon: BarChart3, colour: "text-emerald-500" },
          { label: "Categories", value: BRAND_CATEGORIES.length, icon: Zap, colour: "text-purple-500" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`w-8 h-8 ${s.colour} shrink-0`} />
              <div>
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Turnover Leaderboard ────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3 pt-4 px-5">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-yellow-500" />
            <CardTitle className="text-sm font-semibold">Turnover Leaders</CardTitle>
            <Badge variant="secondary" className="text-[10px]">{data?.topTurnover?.length || 0} tracked</Badge>
          </div>
          <Link href="/turnover">
            <Button variant="ghost" size="sm" className="text-xs h-7">
              Full board <ChevronRight className="w-3 h-3 ml-0.5" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          {!data?.topTurnover?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No turnover data yet</p>
              <p className="text-xs mt-1">Click "Research" on any brand to start building your leaderboard</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.topTurnover.map((t, i) => (
                <div key={t.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                  <span className={`text-xs font-bold w-5 shrink-0 ${i < 3 ? "text-yellow-500" : "text-muted-foreground"}`}>
                    {i + 1}
                  </span>
                  <BrandLogo name={t.company_name} domain={t.domain} size={28} />
                  <div className="flex-1 min-w-0">
                    <Link href={`/companies/${t.company_id}`}>
                      <p className="text-sm font-medium hover:underline truncate">{t.company_name}</p>
                    </Link>
                    <p className="text-[10px] text-muted-foreground">{(t.company_type || "").replace("Tenant - ", "")} · {t.period}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-emerald-600">{formatTurnover(t.turnover)}</p>
                    {t.turnover_per_sqft && (
                      <p className="text-[10px] text-muted-foreground">£{t.turnover_per_sqft.toFixed(0)}/sq ft</p>
                    )}
                  </div>
                  <Badge className={`text-[9px] px-1.5 shrink-0 ${confidenceColour(t.confidence)}`}>{t.confidence}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Who's Hot + Super Brands side by side ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Who's Hot */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3 pt-4 px-5">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-500" />
              <CardTitle className="text-sm font-semibold">Who's Hot</CardTitle>
              <span className="text-[10px] text-muted-foreground">brands active in the last 90 days</span>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {!filteredHot.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">No recent brand activity</p>
            ) : (
              <div className="space-y-1.5">
                {filteredHot.slice(0, 12).map(b => {
                  const activity = parseInt(b.deal_count) + parseInt(b.req_count) + parseInt(b.contact_count);
                  const daysAgo = Math.floor((Date.now() - new Date(b.last_activity).getTime()) / 86400000);
                  return (
                    <Link key={b.id} href={`/companies/${b.id}`}>
                      <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                        <BrandLogo name={b.name} domain={b.domain} size={32} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{b.name}</p>
                          <p className="text-[10px] text-muted-foreground">{(b.company_type || "").replace("Tenant - ", "")}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="flex items-center gap-1 justify-end">
                            {parseInt(b.deal_count) > 0 && <Badge variant="secondary" className="text-[9px] px-1">{b.deal_count} deal{parseInt(b.deal_count) !== 1 ? "s" : ""}</Badge>}
                            {parseInt(b.req_count) > 0 && <Badge className="text-[9px] px-1 bg-blue-500">{b.req_count} req</Badge>}
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{daysAgo === 0 ? "today" : `${daysAgo}d ago`}</p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Super Brands */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3 pt-4 px-5">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-500" />
              <CardTitle className="text-sm font-semibold">Super Brands</CardTitle>
              <Badge variant="secondary" className="text-[10px]">{data?.superBrands?.length || 0}</Badge>
            </div>
            <Link href="/companies?tab=tenants&cat=luxury">
              <Button variant="ghost" size="sm" className="text-xs h-7">
                View all <ChevronRight className="w-3 h-3 ml-0.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <div className="flex flex-wrap gap-2">
              {(data?.superBrands || []).map(b => (
                <Link key={b.id} href={`/companies/${b.id}`}>
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-card hover:bg-muted/60 transition-colors cursor-pointer" title={b.name}>
                    <BrandLogo name={b.name} domain={b.domain} size={18} />
                    <span className="text-xs font-medium">{b.name}</span>
                  </div>
                </Link>
              ))}
              {!data?.superBrands?.length && (
                <p className="text-sm text-muted-foreground py-4">No luxury/flagship brands added yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Active Requirements Radar ───────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3 pt-4 px-5">
          <div className="flex items-center gap-2">
            <Maximize2 className="w-4 h-4 text-blue-500" />
            <CardTitle className="text-sm font-semibold">Active Requirements Radar</CardTitle>
            <Badge className="text-[10px] bg-blue-500">{data?.activeRequirements?.length || 0} brands searching</Badge>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          {!data?.activeRequirements?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No active requirements logged</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {data.activeRequirements.map(r => (
                <Link key={r.id} href={`/companies/${r.company_id}`}>
                  <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors cursor-pointer">
                    <BrandLogo name={r.company_name} domain={r.domain} size={28} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.company_name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{(r.company_type || "").replace("Tenant - ", "")}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {r.size_min || r.size_max ? (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                            <Maximize2 className="w-2.5 h-2.5 mr-0.5" />
                            {formatSize(r.size_min, r.size_max)}
                          </Badge>
                        ) : null}
                        {r.locations && r.locations.length > 0 && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                            <MapPin className="w-2.5 h-2.5 mr-0.5" />
                            {r.locations.slice(0, 2).join(", ")}
                          </Badge>
                        )}
                        {r.use && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0">{r.use}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Turnover Research Panel ─────────────────────────────────── */}
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

      </>)}

      {activeTab === "explorer" && (
        <BrandExplorer />
      )}

      {activeTab === "turnover" && (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <TurnoverBoard embedded={true} />
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
    key: "luxury", label: "Luxury", icon: Diamond, color: "bg-yellow-600", gradient: "from-yellow-500 to-amber-600",
    subs: [
      { key: "luxury-fashion", label: "Luxury Fashion", icon: Crown, match: ["Tenant - Luxury", "Tenant - Luxury Fashion"] },
      { key: "luxury-accessories", label: "Luxury Accessories", icon: Gem, match: ["Tenant - Luxury Accessories"] },
      { key: "luxury-beauty", label: "Luxury Beauty", icon: Sparkles, match: ["Tenant - Luxury Beauty"] },
      { key: "watches-jewellery", label: "Watches & Jewellery", icon: Watch, match: ["Tenant - Jewellery & Watches", "Tenant - Jewellery", "Tenant - Watches"] },
    ],
  },
  {
    key: "retail", label: "Fashion & Retail", icon: Store, color: "bg-pink-600", gradient: "from-pink-500 to-rose-600",
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
      { key: "other-retail", label: "Other Retail", icon: Store, match: ["Tenant - Retail", "Tenant - General Retail"] },
    ],
  },
  {
    key: "restaurants", label: "Food & Drink", icon: Utensils, color: "bg-rose-600", gradient: "from-rose-500 to-red-600",
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
    key: "leisure", label: "Leisure & Experience", icon: Clapperboard, color: "bg-purple-600", gradient: "from-purple-500 to-violet-600",
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
    key: "health", label: "Health & Wellness", icon: Dumbbell, color: "bg-orange-600", gradient: "from-orange-500 to-amber-600",
    subs: [
      { key: "gym", label: "Gym & Fitness", icon: Dumbbell, match: ["Tenant - Gym", "Tenant - Fitness", "Tenant - Gym & Fitness", "Tenant - Health & Fitness"] },
      { key: "wellness", label: "Wellness & Spa", icon: Bath, match: ["Tenant - Wellness", "Tenant - Spa", "Tenant - Hair", "Tenant - Nails", "Tenant - Aesthetics"] },
      { key: "yoga", label: "Yoga & Pilates", icon: HeartPulse, match: ["Tenant - Yoga", "Tenant - Pilates"] },
    ],
  },
  {
    key: "national", label: "National & Regional", icon: MapPin, color: "bg-teal-600", gradient: "from-teal-500 to-emerald-600",
    subs: [
      { key: "grocery", label: "Grocery & Convenience", icon: ShoppingCart, match: ["Tenant - Grocery", "Tenant - Convenience", "Tenant - Supermarket"] },
      { key: "value-retail", label: "Value & Discount", icon: Tag, match: ["Tenant - Value Retail", "Tenant - Discount", "Tenant - Pound Store"] },
      { key: "trade-diy", label: "Trade & DIY", icon: Wrench, match: ["Tenant - Trade", "Tenant - DIY", "Tenant - Hardware", "Tenant - Builders Merchants"] },
      { key: "national-other", label: "Other National", icon: Building2, match: ["Tenant - National Retail", "Tenant - High Street"] },
    ],
  },
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
  const [activeCat, setActiveCat] = useState<string | null>(() => {
    try { return localStorage.getItem("brand-explorer-cat") || null; } catch { return null; }
  });
  const [activeSub, setActiveSub] = useState<string | null>(() => {
    try { return localStorage.getItem("brand-explorer-sub") || null; } catch { return null; }
  });
  const [search, setSearch] = useState(() => {
    try { return localStorage.getItem("brand-explorer-search") || ""; } catch { return ""; }
  });

  const { data: allCompanies = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/companies"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/crm/companies");
      return res.json();
    },
    staleTime: 120_000,
  });

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
    return list.sort((a: any, b: any) => a.name.localeCompare(b.name));
  }, [companies, activeCat, activeSub, activeCatObj, search]);

  return (
    <div className="space-y-4">
      {/* Category cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
        <div
          className={`cursor-pointer rounded-xl p-4 text-white transition-all hover:scale-[1.02] active:scale-[0.98] bg-gradient-to-br from-teal-500 to-teal-700 ${
            activeCat === null ? "shadow-lg ring-2 ring-teal-400 ring-offset-2" : "opacity-80 hover:opacity-100"
          }`}
          onClick={() => { setCat(null); setSub(null); }}
        >
          <Store className="w-6 h-6 mb-2 opacity-90" />
          <div className="text-2xl font-bold">{companies.length}</div>
          <div className="text-xs font-medium opacity-90 mt-0.5">All Brands</div>
        </div>
        {BRAND_CATEGORIES.map(cat => {
          const isActive = activeCat === cat.key;
          const Icon = cat.icon;
          return (
            <div
              key={cat.key}
              className={`cursor-pointer rounded-xl p-4 text-white transition-all hover:scale-[1.02] active:scale-[0.98] bg-gradient-to-br ${cat.gradient} ${
                isActive ? "shadow-lg ring-2 ring-white/40 ring-offset-2" : "opacity-80 hover:opacity-100"
              }`}
              onClick={() => { setCat(isActive ? null : cat.key); setSub(null); }}
            >
              <Icon className="w-6 h-6 mb-2 opacity-90" />
              <div className="text-2xl font-bold">{catCounts[cat.key] || 0}</div>
              <div className="text-xs font-medium opacity-90 mt-0.5">{cat.label}</div>
            </div>
          );
        })}
      </div>

      {/* Subcategory pills */}
      {activeCatObj && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSub(null)}
            className={`text-sm px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all border ${
              activeSub === null
                ? `${activeCatObj.color} text-white border-transparent shadow-sm`
                : "bg-muted/50 hover:bg-muted border-border text-foreground"
            }`}
          >
            All {activeCatObj.label} <span className="text-xs opacity-75">({catCounts[activeCatObj.key] || 0})</span>
          </button>
          {activeCatObj.subs.map(sub => {
            const count = catCounts[sub.key] || 0;
            const isActive = activeSub === sub.key;
            const Icon = sub.icon;
            return (
              <button
                key={sub.key}
                onClick={() => setSub(isActive ? null : sub.key)}
                className={`text-sm px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all border ${
                  isActive
                    ? `${activeCatObj.color} text-white border-transparent shadow-sm`
                    : "bg-muted/50 hover:bg-muted border-border text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {sub.label} <span className="text-xs opacity-75">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Search + count */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search brands..."
            value={search}
            onChange={e => setSearchPersist(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <p className="text-sm text-muted-foreground">{filtered.length} results</p>
      </div>

      {/* Brand cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
        {filtered.map((c: any) => {
          const parent = c.parentCompanyId ? companyById.get(c.parentCompanyId) : null;
          return (
            <div key={c.id} className="relative flex flex-col items-center gap-1.5 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-center group">
              <Link href={`/companies/${c.id}`} className="absolute inset-0 rounded-lg" aria-label={c.name} />
              <BrandLogo name={c.name} domain={c.domain} size={36} />
              <p className="text-xs font-medium leading-tight truncate w-full group-hover:text-primary transition-colors">{c.name}</p>
              <p className="text-[10px] text-muted-foreground truncate w-full">{(c.companyType || "").replace("Tenant - ", "")}</p>
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
            <Newspaper className="w-4 h-4 text-pink-500" />
            <h3 className="text-sm font-semibold">Brand News</h3>
            <Badge variant="secondary" className="text-[10px]">{brandNews.length}</Badge>
            <Link href="/news" className="ml-auto">
              <Button variant="ghost" size="sm" className="text-xs h-7">
                Full feed <ChevronRight className="w-3 h-3 ml-0.5" />
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
    </div>
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
