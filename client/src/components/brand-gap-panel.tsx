// Brand gap analysis — the hospitality & leisure gap board (Woody,
// 2026-08-04 rework: full width; competing centres + national peers +
// local market lenses; sector coverage with missing-sector callouts;
// AI gap read; international watchlist). Retail is excluded throughout —
// the server slices to hospitality/F&B/wellness/café/leisure.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAuthHeaders } from "@/lib/queryClient";
import { renderAiCommentary } from "@/components/property-asset-brief";
import {
  Target, MapPin, TrendingUp, AlertCircle, FileText, Sparkles, RefreshCw,
  Swords, Globe2, Store, ChevronRight, Loader2,
} from "lucide-react";

type GapBrand = {
  brand_company_id: string;
  brand_name: string;
  nearest_distance_km: number;
  total_stores: number;
  rollout_status: string | null;
  company_type: string | null;
  sector?: string | null;
  peer_schemes?: string[];
  competing_at?: string[];
  has_live_requirement?: boolean;
};

interface BrandGapResult {
  property: { id: string; name: string; postcode: string | null; lat: number; lng: number };
  onScheme: GapBrand[];
  wider: GapBrand[];
  gap: Array<GapBrand & { nearest_store: { name: string; address: string | null }; gap_score: number }>;
  peerGaps?: GapBrand[];
  competingCentres?: Array<{ name: string; distance_km: number }>;
  competitorGaps?: GapBrand[];
  localMarket?: GapBrand[];
  sectors?: Array<{
    key: string; label: string; on_scheme: number; on_scheme_names: string[];
    at_competing: number; at_peers: number; missing: boolean;
    examples: Array<{ id: string; name: string; peers: number; live_req: boolean }>;
  }>;
  missingSectors?: BrandGapResult["sectors"];
  peerSchemesConsidered?: number;
  categorySignature: Record<string, number>;
  matchingRequirements?: Array<{
    id: string; name: string | null; use: string[] | null; size: string | null;
    requirement_locations: string | null; company_id: string | null;
    company_name: string | null; domain: string | null;
  }>;
  stats: { totalBrands: number; hospitalityBrands?: number; brandsWithStores: number };
}

// Two-line row: the brand NAME owns the first line (badges after it, name
// never crushed to "W…"), the scheme evidence sits underneath (Woody,
// 2026-08-04: "design issues on the brand names").
function BrandRow({ b, context }: { b: GapBrand; context?: string }) {
  return (
    <Link
      href={`/companies/${b.brand_company_id}`}
      className="block text-xs hover:bg-muted/50 rounded px-1 py-1 min-w-0"
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="font-medium truncate min-w-0" title={b.brand_name}>{b.brand_name}</span>
        {b.has_live_requirement && (
          <Badge className="text-[9px] bg-violet-100 text-violet-700 border-violet-200 shrink-0">live req</Badge>
        )}
        {(b.rollout_status === "scaling" || b.rollout_status === "entering_uk") && (
          <Badge className="text-[9px] bg-emerald-100 text-emerald-700 border-emerald-200 shrink-0">
            <TrendingUp className="w-2 h-2 mr-0.5" />{b.rollout_status === "scaling" ? "scaling" : "entering UK"}
          </Badge>
        )}
      </span>
      {context && (
        <span className="block text-[10px] text-muted-foreground truncate mt-0.5" title={context}>
          {context}
        </span>
      )}
    </Link>
  );
}

function GapColumn({ icon: Icon, tint, title, sub, brands, contextFor, emptyText }: {
  icon: any; tint: string; title: string; sub?: string;
  brands: GapBrand[]; contextFor: (b: GapBrand) => string; emptyText: string;
}) {
  return (
    <div className="rounded-lg border p-2.5 min-w-0">
      <div className="text-[11px] font-semibold mb-0.5 flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${tint}`} />
        {title}
        <Badge variant="secondary" className="text-[10px]">{brands.length}</Badge>
      </div>
      {sub && <div className="text-[10px] text-muted-foreground mb-1.5">{sub}</div>}
      {brands.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic py-2">{emptyText}</p>
      ) : (
        <div className="space-y-0.5 max-h-[300px] overflow-y-auto pr-1">
          {brands.slice(0, 20).map(b => <BrandRow key={b.brand_company_id} b={b} context={contextFor(b)} />)}
          {brands.length > 20 && <p className="text-[10px] text-muted-foreground pl-1">+{brands.length - 20} more</p>}
        </div>
      )}
    </div>
  );
}

function GapCommentary({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const key = ["/api/property", propertyId, "gap-commentary"];
  const { data, isLoading } = useQuery<{ text: string; generatedAt: string }>({
    queryKey: key,
    queryFn: async () => {
      const r = await fetch(`/api/property/${propertyId}/brand-gaps/commentary`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const refresh = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/property/${propertyId}/brand-gaps/commentary?refresh=1`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (fresh) => qc.setQueryData(key, fresh),
  });
  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/50 dark:bg-purple-950/20 dark:border-purple-900 p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> BGP gap read
          {data?.generatedAt && (
            <span className="font-normal text-purple-500/70">
              — {new Date(data.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          )}
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="p-1 rounded hover:bg-purple-100 dark:hover:bg-purple-900/40"
          title="Regenerate the gap read"
          data-testid="gap-commentary-refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-purple-500 ${refresh.isPending ? "animate-spin" : ""}`} />
        </button>
      </div>
      {isLoading || refresh.isPending ? (
        <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Reading the gaps — competing centres, sectors, live demand…
        </p>
      ) : data?.text ? (
        <div className="text-xs leading-relaxed [&_p]:text-xs">{renderAiCommentary(data.text)}</div>
      ) : (
        <p className="text-xs text-muted-foreground italic">No read yet — hit refresh to generate.</p>
      )}
    </div>
  );
}

function InternationalWatchlist({ propertyId }: { propertyId: string }) {
  const { data, isLoading, error } = useQuery<{ items: Array<{ name: string; sector: string; origin: string; trades_in: string; uk_status: string; why: string }>; generatedAt: string }>({
    queryKey: ["/api/property", propertyId, "gap-international"],
    queryFn: async () => {
      const r = await fetch(`/api/property/${propertyId}/brand-gaps/international`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  return (
    <details className="rounded-lg border p-2.5 group/intl">
      <summary className="text-[11px] font-semibold cursor-pointer list-none flex items-center gap-1.5">
        <ChevronRight className="w-3 h-3 transition-transform group-open/intl:rotate-90" />
        <Globe2 className="w-3.5 h-3.5 text-sky-500" />
        International watchlist — concepts not yet in the UK
        <span className="text-[10px] font-normal text-muted-foreground">AI-researched · verify before pitching</span>
      </summary>
      <div className="mt-2">
        {isLoading ? (
          <p className="text-xs text-muted-foreground italic flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Researching international concepts…</p>
        ) : error || !data?.items?.length ? (
          <p className="text-xs text-muted-foreground italic">Nothing generated yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {data.items.map((it, i) => (
              <div key={i} className="text-xs rounded border px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold truncate">{it.name}</span>
                  <Badge variant="outline" className="text-[9px] shrink-0">{it.sector}</Badge>
                  <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{it.origin}</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Trades in {it.trades_in} · UK: {it.uk_status}
                </div>
                <div className="text-[11px] mt-0.5">{it.why}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

export function BrandGapPanel({ propertyId }: { propertyId: string }) {
  const { data, isLoading, error } = useQuery<BrandGapResult>({
    queryKey: ["/api/property", propertyId, "brand-gaps"],
    queryFn: async () => {
      // Hit the endpoint directly so we can read the server's specific
      // 400 body (no-postcode / no-key / geocode-failed) instead of
      // throwing on the apiRequest layer and losing the reason.
      const res = await fetch(`/api/property/${propertyId}/brand-gaps`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4 text-purple-500" />
            Brand gap analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground italic">Loading store network…</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4 text-purple-500" />
            Brand gap analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground italic">
            {error?.message || "Needs property geocoding or brand_stores data. Use the \"Find stores\" button on brands to populate store locations via Google Places."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const sectors = data.sectors || [];
  const missing = sectors.filter(s => s.missing);
  const present = sectors.filter(s => !s.missing);
  const competing = data.competingCentres || [];

  return (
    <Card data-testid="brand-gap-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Target className="w-4 h-4 text-purple-500" />
          Brand gap analysis
          <span className="text-[11px] font-normal text-muted-foreground">hospitality, F&B, wellness &amp; leisure</span>
          <Badge variant="secondary" className="text-[10px]">
            {data.stats.brandsWithStores} store locations
          </Badge>
          {competing.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              vs {competing.map(c => `${c.name} (${c.distance_km}km)`).join(" · ")}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* AI gap read */}
        <GapCommentary propertyId={propertyId} />

        {/* Matching brand requirements — active leasing reqs that fit available units */}
        {data.matchingRequirements && data.matchingRequirements.length > 0 && (
          <div className="rounded-md border border-purple-200 bg-purple-50/60 dark:bg-purple-950/20 dark:border-purple-900 p-2">
            <div className="text-[11px] text-purple-700 dark:text-purple-300 mb-1 flex items-center gap-1 font-medium">
              <FileText className="w-3 h-3" />
              Matching brand requirements ({data.matchingRequirements.length}) — use-class fits an available unit
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5">
              {data.matchingRequirements.slice(0, 12).map(r => (
                <Link
                  key={r.id}
                  href={r.company_id ? `/companies/${r.company_id}` : `/requirements/${r.id}`}
                  className="text-xs flex items-center gap-1.5 hover:bg-white/60 dark:hover:bg-white/5 rounded px-1 py-0.5 min-w-0 overflow-hidden"
                >
                  <span className="font-medium truncate flex-1 min-w-0">
                    {r.company_name || r.name || "Unnamed"}
                  </span>
                  {r.use && r.use.length > 0 && (
                    <Badge variant="outline" className="text-[9px] shrink-0 bg-white dark:bg-transparent">
                      {r.use.slice(0, 2).join(", ")}{r.use.length > 2 ? "…" : ""}
                    </Badge>
                  )}
                  {r.size && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[150px]" title={r.size}>{r.size}</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Three lenses — competing centres, national peers, local market */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <GapColumn
            icon={Swords}
            tint="text-red-500"
            title="At competing centres, not here"
            sub={competing.length ? `Trading at ${competing.map(c => c.name).join(" / ")}` : undefined}
            brands={data.competitorGaps || []}
            contextFor={(b) => (b.competing_at || []).join(", ")}
            emptyText="No competing-centre gaps found — or no competing centre within range."
          />
          <GapColumn
            icon={AlertCircle}
            tint="text-amber-500"
            title="At other UK schemes, not here"
            sub={data.peerSchemesConsidered ? `Across ${data.peerSchemesConsidered} major UK schemes` : undefined}
            brands={data.peerGaps || []}
            contextFor={(b) => {
              const ps = b.peer_schemes || [];
              return ps.slice(0, 2).join(", ") + (ps.length > 2 ? ` +${ps.length - 2}` : "");
            }}
            emptyText="No national peer-scheme gaps."
          />
          <GapColumn
            icon={MapPin}
            tint="text-blue-500"
            title="In the local market, not on scheme"
            sub="Trading within 5km — operators the scheme could capture"
            brands={data.localMarket || []}
            contextFor={(b) => `${b.nearest_distance_km.toFixed(1)}km away`}
            emptyText="Nothing nearby that isn't already on scheme."
          />
        </div>

        {/* Sector coverage — missing sectors first, loud */}
        {sectors.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold mb-1.5 flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5 text-teal-500" />
              Sector coverage
              {missing.length > 0 && (
                <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">
                  {missing.length} missing sector{missing.length === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
              {[...missing, ...present].map(s => (
                <div
                  key={s.key}
                  className={`rounded-lg border p-2 min-w-0 ${s.missing ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800" : ""}`}
                  data-testid={`sector-${s.key}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-semibold truncate">{s.label}</span>
                    {s.missing
                      ? <Badge className="text-[9px] bg-amber-200/70 text-amber-800 border-amber-300 shrink-0">missing</Badge>
                      : <span className="text-[10px] text-muted-foreground shrink-0">{s.on_scheme} here</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {s.missing
                      ? `0 on scheme · at ${s.at_peers} peer scheme${s.at_peers === 1 ? "" : "s"}${s.at_competing ? ` · ${s.at_competing} at competitors` : ""}`
                      : s.on_scheme_names.slice(0, 3).join(", ") + (s.on_scheme > 3 ? ` +${s.on_scheme - 3}` : "")}
                  </div>
                  {s.examples.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {s.examples.slice(0, 3).map(e => (
                        <Link key={e.id} href={`/companies/${e.id}`}>
                          <Badge
                            variant="outline"
                            className={`text-[9px] cursor-pointer hover:bg-muted ${e.live_req ? "border-violet-300 text-violet-700" : ""}`}
                            title={`At ${e.peers} peer scheme${e.peers === 1 ? "" : "s"}${e.live_req ? " · live requirement" : ""}`}
                          >
                            {e.name}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* International watchlist — larger-scheme play, collapsed by default */}
        <InternationalWatchlist propertyId={propertyId} />

        {/* On-scheme / wider chips — reference detail, tucked away */}
        <details className="group/os">
          <summary className="text-[11px] text-muted-foreground cursor-pointer list-none flex items-center gap-1 hover:text-foreground">
            <ChevronRight className="w-3 h-3 transition-transform group-open/os:rotate-90" />
            On-scheme &amp; nearby detail ({data.onScheme.length} on scheme · {data.wider.length} within 2km)
          </summary>
          <div className="mt-2 space-y-2">
            {data.onScheme.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {data.onScheme.slice(0, 30).map(b => (
                  <Link key={b.brand_company_id} href={`/companies/${b.brand_company_id}`}>
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 hover:bg-emerald-100 border-emerald-200 cursor-pointer dark:bg-emerald-950/30">
                      {b.brand_name}
                      <span className="ml-1 text-muted-foreground">
                        {b.nearest_distance_km < 0.1 ? "here" : `${(b.nearest_distance_km * 1000).toFixed(0)}m`}
                      </span>
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
            {data.wider.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {data.wider.slice(0, 30).map(b => (
                  <Link key={b.brand_company_id} href={`/companies/${b.brand_company_id}`}>
                    <Badge variant="outline" className="text-[10px] bg-blue-50 hover:bg-blue-100 border-blue-200 cursor-pointer dark:bg-blue-950/30">
                      {b.brand_name}
                      <span className="ml-1 text-muted-foreground">{b.nearest_distance_km.toFixed(1)}km</span>
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </details>

        {data.onScheme.length === 0 && (data.peerGaps || []).length === 0 && (data.localMarket || []).length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            No hospitality store data nearby yet. Populate stores for tracked brands via "Find stores" on each brand page.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
