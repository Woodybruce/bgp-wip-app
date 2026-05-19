// Brand gap analysis for a property's leasing pitch.
// Shows peer brands present in similar locations but missing from this area.
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { Target, MapPin, TrendingUp, AlertCircle, FileText } from "lucide-react";

interface BrandGapResult {
  property: { id: string; name: string; postcode: string | null; lat: number; lng: number };
  onScheme: Array<{
    brand_company_id: string;
    brand_name: string;
    nearest_distance_km: number;
    total_stores: number;
    rollout_status: string | null;
    company_type: string | null;
  }>;
  wider: Array<{
    brand_company_id: string;
    brand_name: string;
    nearest_distance_km: number;
    total_stores: number;
    rollout_status: string | null;
    company_type: string | null;
  }>;
  gap: Array<{
    brand_company_id: string;
    brand_name: string;
    nearest_distance_km: number;
    total_stores: number;
    rollout_status: string | null;
    company_type: string | null;
    nearest_store: { name: string; address: string | null };
    gap_score: number;
  }>;
  categorySignature: Record<string, number>;
  matchingRequirements?: Array<{
    id: string;
    name: string | null;
    use: string[] | null;
    size: string | null;
    requirement_locations: string | null;
    company_id: string | null;
    company_name: string | null;
    domain: string | null;
  }>;
  stats: { totalBrands: number; brandsWithStores: number };
}

export function BrandGapPanel({ propertyId }: { propertyId: string }) {
  const { data, isLoading, error } = useQuery<BrandGapResult>({
    queryKey: ["/api/property", propertyId, "brand-gaps"],
    queryFn: async () => {
      // Hit the endpoint directly so we can read the server's specific
      // 400 body (no-postcode / no-key / geocode-failed) instead of
      // throwing on the apiRequest layer and losing the reason.
      const res = await fetch(`/api/property/${propertyId}/brand-gaps`, { credentials: "include" });
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
          <p className="text-xs text-muted-foreground italic">Loading nearby brand stores…</p>
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

  return (
    <Card data-testid="brand-gap-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="w-4 h-4 text-purple-500" />
          Brand gap analysis
          <Badge variant="secondary" className="text-[10px]">
            {data.stats.brandsWithStores} store locations
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Matching brand requirements — active leasing reqs that fit available units */}
        {data.matchingRequirements && data.matchingRequirements.length > 0 && (
          <div className="rounded-md border border-purple-200 bg-purple-50/60 p-2">
            <div className="text-[11px] text-purple-700 mb-1 flex items-center gap-1 font-medium">
              <FileText className="w-3 h-3" />
              Matching brand requirements ({data.matchingRequirements.length}) — use-class fits an available unit
            </div>
            <div className="space-y-0.5">
              {data.matchingRequirements.slice(0, 12).map(r => (
                <Link
                  key={r.id}
                  href={r.company_id ? `/companies/${r.company_id}` : `/requirements/${r.id}`}
                  className="text-xs flex items-center gap-1.5 hover:bg-white/60 rounded px-1 py-0.5"
                >
                  <span className="font-medium truncate flex-1">
                    {r.company_name || r.name || "Unnamed"}
                  </span>
                  {r.use && r.use.length > 0 && (
                    <Badge variant="outline" className="text-[9px] shrink-0 bg-white">
                      {r.use.slice(0, 2).join(", ")}{r.use.length > 2 ? "…" : ""}
                    </Badge>
                  )}
                  {r.size && (
                    <span className="text-[10px] text-muted-foreground shrink-0">{r.size}</span>
                  )}
                </Link>
              ))}
              {data.matchingRequirements.length > 12 && (
                <p className="text-[10px] text-muted-foreground pl-1">
                  +{data.matchingRequirements.length - 12} more matching requirements
                </p>
              )}
            </div>
          </div>
        )}

        {/* Two-column body: chip lists on the left (compact), peer-brand
            gaps table on the right. Stops the long gap table from
            stretching the whole card past the Risk Register column. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-3">
            {/* On-scheme brands */}
            {data.onScheme.length > 0 && (
              <div>
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-emerald-500" />
                  On-scheme &amp; immediate area ({data.onScheme.length}) — within 500m
                </div>
                <div className="flex flex-wrap gap-1">
                  {data.onScheme.slice(0, 20).map(b => (
                    <Link key={b.brand_company_id} href={`/companies/${b.brand_company_id}`}>
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-emerald-50 hover:bg-emerald-100 border-emerald-200 cursor-pointer"
                      >
                        {b.brand_name}
                        <span className="ml-1 text-muted-foreground">
                          {b.nearest_distance_km < 0.1 ? "here" : `${(b.nearest_distance_km * 1000).toFixed(0)}m`}
                        </span>
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Wider area brands */}
            {data.wider.length > 0 && (
              <div>
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-blue-500" />
                  Wider catchment ({data.wider.length}) — 500m–2km
                </div>
                <div className="flex flex-wrap gap-1">
                  {data.wider.slice(0, 20).map(b => (
                    <Link key={b.brand_company_id} href={`/companies/${b.brand_company_id}`}>
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-blue-50 hover:bg-blue-100 border-blue-200 cursor-pointer"
                      >
                        {b.brand_name}
                        <span className="ml-1 text-muted-foreground">{b.nearest_distance_km.toFixed(1)}km</span>
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Gap brands — missing from area. Sits to the right of the
              chip lists on desktop so it doesn't stretch the card. */}
          {data.gap.length > 0 && (
            <div>
              <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 text-amber-500" />
                Peer brand gaps ({data.gap.length}) — in similar locations but not here
              </div>
              <div className="space-y-0.5 max-h-[260px] overflow-y-auto pr-1">
                {data.gap.slice(0, 15).map(b => (
                  <Link
                    key={b.brand_company_id}
                    href={`/companies/${b.brand_company_id}`}
                    className="text-xs flex items-center gap-1.5 hover:bg-muted/50 rounded px-1 py-0.5"
                  >
                    <span className="font-medium truncate flex-1">{b.brand_name}</span>
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      {b.total_stores} UK store{b.total_stores === 1 ? "" : "s"}
                    </Badge>
                    {b.rollout_status === "scaling" && (
                      <Badge className="text-[9px] bg-emerald-100 text-emerald-700 border-emerald-200 shrink-0">
                        <TrendingUp className="w-2 h-2 mr-0.5" />scaling
                      </Badge>
                    )}
                    {b.rollout_status === "entering_uk" && (
                      <Badge className="text-[9px] bg-purple-100 text-purple-700 border-purple-200 shrink-0">
                        entering UK
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      nearest {b.nearest_distance_km.toFixed(0)}km
                    </span>
                  </Link>
                ))}
                {data.gap.length > 15 && (
                  <p className="text-[10px] text-muted-foreground pl-1">+{data.gap.length - 15} more gap brands</p>
                )}
              </div>
            </div>
          )}
        </div>

        {data.onScheme.length === 0 && data.wider.length === 0 && data.gap.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            No brand_stores data nearby yet. Populate stores for tracked brands via "Find stores" on each brand page.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
