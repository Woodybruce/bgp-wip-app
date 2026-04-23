// Brand gap analysis for a property's leasing pitch.
// Shows peer brands present in similar locations but missing from this area.
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { Target, MapPin, TrendingUp, AlertCircle } from "lucide-react";

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
  stats: { totalBrands: number; brandsWithStores: number };
}

export function BrandGapPanel({ propertyId }: { propertyId: string }) {
  const { data, isLoading, error } = useQuery<BrandGapResult>({
    queryKey: ["/api/property", propertyId, "brand-gaps"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/property/${propertyId}/brand-gaps`, {});
      return res.json();
    },
  });

  if (isLoading) return null;

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
            Needs property geocoding or brand_stores data.
            Use the "Find stores" button on brands to populate store locations via Google Places.
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

        {/* Gap brands — missing from area */}
        {data.gap.length > 0 && (
          <div>
            <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 text-amber-500" />
              Peer brand gaps ({data.gap.length}) — in similar locations but not here
            </div>
            <div className="space-y-0.5">
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

        {data.onScheme.length === 0 && data.wider.length === 0 && data.gap.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            No brand_stores data nearby yet. Populate stores for tracked brands via "Find stores" on each brand page.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
