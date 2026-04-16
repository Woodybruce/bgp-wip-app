import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getCompanyLogoUrl } from "@/lib/company-logos";
import {
  Store, TrendingUp, Flame, Star, Search, ChevronRight,
  MapPin, Maximize2, Zap, BarChart3, RefreshCw, Building2,
  ArrowUpRight, Users, FileText, Trophy, Sparkles,
} from "lucide-react";

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
  const url = getCompanyLogoUrl(name, domain);
  const [err, setErr] = useState(false);
  if (!err && url) {
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className="rounded object-contain bg-white"
        style={{ width: size, height: size }}
        onError={() => setErr(true)}
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

export default function BrandsHub() {
  const { toast } = useToast();
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

      {/* ── Stats bar ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Brands", value: totalBrands, icon: Store, colour: "text-pink-500" },
          { label: "Active Requirements", value: activeReqs, icon: FileText, colour: "text-blue-500" },
          { label: "With Turnover Data", value: brandsWithTurnover, icon: BarChart3, colour: "text-emerald-500" },
          { label: "Categories", value: 5, icon: Zap, colour: "text-purple-500" },
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-500" />
              <CardTitle className="text-sm font-semibold">Research Turnover</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">AI searches Companies House + public records</p>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <TurnoverResearchPanel onResearch={(id) => researchMut.mutate(id)} researchingId={researchingId} />
        </CardContent>
      </Card>

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
