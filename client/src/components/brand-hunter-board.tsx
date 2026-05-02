import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { AIActivityTrigger } from "@/components/ai-activity-card";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { extractDomain } from "@/lib/company-logos";
import {
  Flame, Search, Crosshair, Star, TrendingUp, Building2,
  Globe2, Zap, Instagram, ChevronRight, MapPin, Filter,
  Trophy, Sparkles, Coins, Bookmark, BookmarkCheck,
  Users, Newspaper, Shuffle, ShoppingBag,
} from "lucide-react";

// ── TikTok icon (not in lucide) ───────────────────────────────────────────────
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.79a4.86 4.86 0 01-1.07-.1z" />
    </svg>
  );
}

interface HunterBrand {
  id: string;
  name: string;
  company_type: string | null;
  domain: string | null;
  description: string | null;
  rollout_status: string | null;
  store_count: number | null;
  backers: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  dept_store_presence: string | null;
  franchise_activity: string | null;
  hunter_flag: boolean;
  concept_pitch: string | null;
  brand_analysis: string | null;
  stock_ticker: string | null;
  expansionScore: number;
  expansionFlags: string[];
  recentSignals: Array<{
    signal_type: string;
    headline: string;
    magnitude: string | null;
    sentiment: string | null;
    signal_date: string;
  }>;
  stock: {
    ticker: string;
    price: number | null;
    currency: string | null;
    marketCapGBP: number | null;
    fiftyTwoWeekChange: number | null;
    peRatio: number | null;
    exchange: string | null;
  } | null;
}

const FLAG_META: Record<string, { color: string; icon: any }> = {
  "Hunter Pick":        { color: "bg-orange-100 text-orange-700 border-orange-200", icon: Flame },
  "Entering UK":        { color: "bg-green-100 text-green-700 border-green-200",   icon: Globe2 },
  "Scaling":            { color: "bg-blue-100 text-blue-700 border-blue-200",      icon: TrendingUp },
  "Rumoured":           { color: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: Zap },
  "Dept Store Entry":   { color: "bg-purple-100 text-purple-700 border-purple-200", icon: Building2 },
  "Franchise Abroad":   { color: "bg-pink-100 text-pink-700 border-pink-200",      icon: MapPin },
  "Funded":             { color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: Coins },
  "Funding Raised":     { color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: Coins },
  "TikTok":             { color: "bg-slate-100 text-slate-700 border-slate-200",   icon: TikTokIcon },
  "Instagram":          { color: "bg-rose-100 text-rose-700 border-rose-200",      icon: Instagram },
  "Has Stores":         { color: "bg-indigo-100 text-indigo-700 border-indigo-200", icon: Trophy },
  "DTC / Online-only":  { color: "bg-violet-100 text-violet-700 border-violet-200", icon: ShoppingBag },
  "European Presence":  { color: "bg-sky-100 text-sky-700 border-sky-200",         icon: Globe2 },
  "Pop-up Activity":    { color: "bg-amber-100 text-amber-700 border-amber-200",   icon: Zap },
  "New Leadership":     { color: "bg-teal-100 text-teal-700 border-teal-200",      icon: Users },
  "Press Momentum":     { color: "bg-cyan-100 text-cyan-700 border-cyan-200",      icon: Newspaper },
  "Format Pivot":       { color: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200", icon: Shuffle },
  "Stock Momentum":     { color: "bg-lime-100 text-lime-700 border-lime-200",      icon: TrendingUp },
  "Stock +40% YoY":     { color: "bg-lime-100 text-lime-800 border-lime-300",      icon: TrendingUp },
  "Large Cap":          { color: "bg-stone-100 text-stone-700 border-stone-200",   icon: Trophy },
  "Mid Cap":            { color: "bg-stone-100 text-stone-700 border-stone-200",   icon: Trophy },
};

function formatCap(gbp: number | null): string | null {
  if (gbp == null) return null;
  if (gbp >= 1_000_000_000) return `£${(gbp / 1_000_000_000).toFixed(1)}bn`;
  if (gbp >= 1_000_000) return `£${(gbp / 1_000_000).toFixed(0)}m`;
  return `£${(gbp / 1_000).toFixed(0)}k`;
}

function StockLine({ s }: { s: NonNullable<HunterBrand["stock"]> }) {
  const chg = s.fiftyTwoWeekChange != null ? s.fiftyTwoWeekChange * 100 : null;
  const chgColor = chg == null ? "text-muted-foreground" : chg >= 20 ? "text-emerald-600" : chg >= 0 ? "text-green-600" : "text-red-600";
  const cap = formatCap(s.marketCapGBP);
  return (
    <div className="flex items-center gap-2 text-xs">
      <TrendingUp className="w-3 h-3 shrink-0" />
      <span className="font-mono font-medium">{s.ticker}</span>
      {chg != null && (
        <span className={chgColor}>
          {chg >= 0 ? "+" : ""}{chg.toFixed(1)}% YoY
        </span>
      )}
      {cap && <span className="text-muted-foreground">Cap {cap}</span>}
    </div>
  );
}

function scoreBand(score: number): { label: string; color: string } {
  if (score >= 70) return { label: "Very Hot", color: "text-red-600" };
  if (score >= 45) return { label: "Hot",      color: "text-orange-500" };
  if (score >= 25) return { label: "Watch",    color: "text-yellow-600" };
  return             { label: "Warm",           color: "text-muted-foreground" };
}

function BrandLogo({ name, domain, size = 28 }: { name: string; domain?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const d = extractDomain(domain ?? null);
  const src = d ? `https://logo.clearbit.com/${d}?size=${size * 2}` : null;
  if (!failed && src) {
    return (
      <img
        src={src} alt={name}
        loading="lazy"
        decoding="async"
        className="rounded object-contain bg-white border border-gray-100 shrink-0"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className="rounded bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center text-white font-bold shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

const ALL_FILTERS = [
  "All", "Hunter Pick", "Entering UK", "Scaling",
  "Dept Store Entry", "Franchise Abroad", "DTC / Online-only",
  "European Presence", "Funding Raised", "Pop-up Activity",
  "New Leadership", "Stock Momentum",
] as const;

export default function BrandHunterBoard() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterFlag, setFilterFlag] = useState<string>("All");

  const { data: brands = [], isLoading } = useQuery<HunterBrand[]>({
    queryKey: ["/api/brands/hunter"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/brands/hunter");
      return res.json();
    },
    staleTime: 60_000,
  });

  const flagMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/brands/${id}/hunter-flag`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brands/hunter"] });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const displayed = useMemo(() => {
    let list = brands;
    if (filterFlag !== "All") list = list.filter(b => b.expansionFlags.includes(filterFlag));
    if (search.trim()) list = list.filter(b => b.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [brands, filterFlag, search]);

  const hotCount   = brands.filter(b => b.expansionScore >= 70).length;
  const watchCount = brands.filter(b => b.expansionScore >= 25 && b.expansionScore < 70).length;
  const flagCount  = brands.filter(b => b.hunter_flag).length;

  if (isLoading) {
    return (
      <div className="space-y-3 p-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Summary stats ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Very Hot", value: hotCount,   icon: Flame,        color: "text-red-500" },
          { label: "Watching", value: watchCount, icon: Star,         color: "text-yellow-500" },
          { label: "Flagged",  value: flagCount,  icon: BookmarkCheck, color: "text-orange-500" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-3 flex items-center gap-2">
              <s.icon className={`w-6 h-6 ${s.color} shrink-0`} />
              <div>
                <div className="text-xl font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Search + filter bar ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Search brands…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-muted-foreground self-center shrink-0" />
          {ALL_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilterFlag(f)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                filterFlag === f
                  ? "bg-pink-500 text-white border-pink-500"
                  : "border-gray-200 text-muted-foreground hover:border-pink-300 hover:text-pink-600"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* ── Brand cards ─────────────────────────────────────────────────── */}
      {displayed.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Crosshair className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            {brands.length === 0
              ? "No tracked brands yet — mark brands as tracked in the brand profile to start scoring."
              : "No brands match this filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((brand, idx) => {
            const band = scoreBand(brand.expansionScore);
            return (
              <Card key={brand.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">

                    {/* Rank number */}
                    <div className="text-xs text-muted-foreground font-mono w-5 shrink-0 pt-1">
                      {idx + 1}
                    </div>

                    {/* Logo */}
                    <BrandLogo name={brand.name} domain={brand.domain} size={36} />

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link href={`/companies/${brand.id}`}>
                            <span className="font-semibold text-sm hover:text-pink-600 cursor-pointer truncate block">
                              {brand.name}
                            </span>
                          </Link>
                          {brand.company_type && (
                            <span className="text-xs text-muted-foreground">{brand.company_type.replace("Tenant - ", "")}</span>
                          )}
                        </div>

                        {/* Score pill */}
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <div className={`text-lg font-bold leading-none ${band.color}`}>
                              {brand.expansionScore}
                            </div>
                            <div className={`text-[10px] font-medium ${band.color}`}>{band.label}</div>
                          </div>

                          {/* Hunter flag toggle */}
                          <button
                            onClick={() => flagMut.mutate(brand.id)}
                            className={`p-1.5 rounded-full transition-colors ${
                              brand.hunter_flag
                                ? "text-orange-500 bg-orange-50 hover:bg-orange-100"
                                : "text-muted-foreground hover:text-orange-500 hover:bg-orange-50"
                            }`}
                            title={brand.hunter_flag ? "Remove from Hunter watchlist" : "Flag as Hunter Pick"}
                          >
                            {brand.hunter_flag ? (
                              <BookmarkCheck className="w-4 h-4" />
                            ) : (
                              <Bookmark className="w-4 h-4" />
                            )}
                          </button>
                          <AIActivityTrigger subjectType="brand" subjectId={brand.id} title={`${brand.name} — Activity`} />
                        </div>
                      </div>

                      {/* Expansion flag badges */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {brand.expansionFlags.map(flag => {
                          const meta = FLAG_META[flag] ?? { color: "bg-gray-100 text-gray-600 border-gray-200", icon: Sparkles };
                          const Icon = meta.icon;
                          return (
                            <Badge
                              key={flag}
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 flex items-center gap-0.5 ${meta.color}`}
                            >
                              <Icon className="w-2.5 h-2.5" />
                              {flag}
                            </Badge>
                          );
                        })}
                      </div>

                      {/* Key expansion details */}
                      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                        {brand.dept_store_presence && (
                          <div className="flex items-center gap-1">
                            <Building2 className="w-3 h-3 shrink-0" />
                            <span className="truncate">{brand.dept_store_presence}</span>
                          </div>
                        )}
                        {brand.franchise_activity && (
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span className="truncate">{brand.franchise_activity}</span>
                          </div>
                        )}
                        {brand.backers && (
                          <div className="flex items-center gap-1">
                            <Coins className="w-3 h-3 shrink-0" />
                            <span className="truncate">{brand.backers}</span>
                          </div>
                        )}
                        {(brand.instagram_handle || brand.tiktok_handle) && (
                          <div className="flex items-center gap-2">
                            {brand.instagram_handle && (
                              <a
                                href={`https://instagram.com/${brand.instagram_handle.replace(/^@/, "")}`}
                                target="_blank" rel="noreferrer"
                                className="flex items-center gap-0.5 hover:text-rose-500"
                              >
                                <Instagram className="w-3 h-3" /> {brand.instagram_handle}
                              </a>
                            )}
                            {brand.tiktok_handle && (
                              <a
                                href={`https://tiktok.com/@${brand.tiktok_handle.replace(/^@/, "")}`}
                                target="_blank" rel="noreferrer"
                                className="flex items-center gap-0.5 hover:text-slate-800"
                              >
                                <TikTokIcon className="w-3 h-3" /> {brand.tiktok_handle}
                              </a>
                            )}
                          </div>
                        )}
                        {brand.stock && <StockLine s={brand.stock} /> }
                      </div>

                      {/* Recent signals */}
                      {brand.recentSignals.length > 0 && (
                        <div className="mt-2 space-y-0.5">
                          {brand.recentSignals.map((sig, i) => (
                            <div key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                              <Zap className="w-2.5 h-2.5 mt-0.5 shrink-0 text-yellow-500" />
                              <span className="line-clamp-1">{sig.headline}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Link to brand profile */}
                    <Link href={`/companies/${brand.id}`}>
                      <ChevronRight className="w-4 h-4 text-muted-foreground hover:text-foreground mt-1 shrink-0" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Explain the scoring ─────────────────────────────────────────── */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <div className="font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <Crosshair className="w-3.5 h-3.5" /> How the expansion score works
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5">
            {[
              ["Hunter Pick (manual flag)", "+25"],
              ["Entering UK (rollout status)", "+30"],
              ["Scaling (rollout status)", "+20"],
              ["Dept store entry (Selfridges, HN…)", "+20"],
              ["Franchise deal abroad", "+15"],
              ["Funding raised (signal)", "+15"],
              ["New store openings (per opening)", "+8"],
              ["European city presence detected", "+5–15"],
              ["DTC / online-only brand", "+10"],
              ["Pop-up activity", "+10"],
              ["Backers / investors known", "+10"],
              ["New leadership hire", "+8"],
              ["Press momentum (3+ news signals)", "+8"],
              ["TikTok / Instagram handle", "+5 ea"],
              ["Has stores elsewhere", "+5"],
              ["Format / sector pivot", "+5"],
              ["Stock +40% YoY (listed)", "+15"],
              ["Stock +20% YoY (listed)", "+10"],
              ["Large cap (£500m+)", "+5"],
              ["Mid cap (£50–500m)", "+3"],
            ].map(([label, pts]) => (
              <div key={label} className="flex justify-between gap-2">
                <span>{label}</span>
                <span className="font-mono font-medium text-foreground">{pts}</span>
              </div>
            ))}
          </div>
          <p className="pt-1 text-[11px]">
            Flag any brand as a "Hunter Pick" with the bookmark icon. Fill in Dept Store / Franchise / TikTok / stock ticker fields in the brand profile to boost the score. Brand signals (openings, funding, exec changes) are auto-detected from the news feed; stock data comes from Yahoo Finance (6h cache).
          </p>
        </CardContent>
      </Card>

    </div>
  );
}
