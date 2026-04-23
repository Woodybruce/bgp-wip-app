import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Building2, FileText, ShieldCheck, Landmark, TrendingUp, ExternalLink, Sparkles } from "lucide-react";

interface PathwayIntelStripProps {
  propertyId?: string;
  address?: string;
  postcode?: string;
}

type PathwayRun = {
  id: string;
  address?: string | null;
  postcode?: string | null;
  updatedAt: string;
  stageResults?: any;
};

// Compact intelligence strip surfacing key Pathway findings (VOA rates, planning
// activity, listed status, market tone, retail comps) on property and deal detail
// pages so users don't need to open the Pathway tab to see the headline numbers.
export default function PathwayIntelStrip({ propertyId, address, postcode }: PathwayIntelStripProps) {
  const params = new URLSearchParams();
  if (propertyId) params.set("propertyId", propertyId);
  if (address) params.set("address", address);
  if (postcode) params.set("postcode", postcode);
  const queryKey = `/api/property-pathway/latest?${params.toString()}`;

  const { data: run, isLoading } = useQuery<PathwayRun | null>({
    queryKey: [queryKey],
    enabled: !!(propertyId || address || postcode),
  });

  if (isLoading) {
    return <Skeleton className="h-24" />;
  }

  if (!run) {
    return (
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">No Pathway intelligence yet</p>
              <p className="text-xs text-muted-foreground">Run a Pathway investigation to pull VOA rates, planning history, title ownership, listed status and comparable rents.</p>
            </div>
          </div>
          <Link href={`/property-pathway?address=${encodeURIComponent(address || "")}&postcode=${encodeURIComponent(postcode || "")}`}>
            <Button size="sm" variant="outline">Run Pathway</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const stage1 = run.stageResults?.stage1 || {};
  const stage4 = run.stageResults?.stage4 || {};

  const voaRv: number | undefined = stage1.rates?.totalRateableValue;
  const voaCount: number | undefined = stage1.rates?.assessmentCount;
  const planningCount: number = stage4.planningApplications?.length || 0;
  const titleCount: number = stage4.titleRegisters?.length || 0;
  const retailCompsCount: number = Array.isArray(stage1.retailComps) ? stage1.retailComps.length : 0;
  const marketTone: any = stage1.pdMarket;
  const listedHit: boolean = !!(stage1.listedBuildings?.length || stage4.listedBuildingStatus);
  const updated = run.updatedAt ? new Date(run.updatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";

  const formatGbp = (n: number) => `£${n.toLocaleString()}`;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Pathway Intelligence</h3>
            <Badge variant="secondary" className="text-[10px]">Updated {updated}</Badge>
          </div>
          <Link href={`/property-pathway?runId=${run.id}`}>
            <Button size="sm" variant="ghost" className="text-xs h-7">
              Open full investigation <ExternalLink className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <div className="flex items-start gap-2 p-2 rounded-md bg-muted/30">
            <Landmark className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Business Rates</p>
              {voaRv ? (
                <>
                  <p className="text-sm font-bold">{formatGbp(voaRv)}</p>
                  <p className="text-[10px] text-muted-foreground">{voaCount} assessment{voaCount === 1 ? "" : "s"}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No VOA data</p>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 p-2 rounded-md bg-muted/30">
            <FileText className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Planning</p>
              <p className="text-sm font-bold">{planningCount}</p>
              <p className="text-[10px] text-muted-foreground">application{planningCount === 1 ? "" : "s"}</p>
            </div>
          </div>

          <div className="flex items-start gap-2 p-2 rounded-md bg-muted/30">
            <Building2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Title</p>
              <p className="text-sm font-bold">{titleCount}</p>
              <p className="text-[10px] text-muted-foreground">title{titleCount === 1 ? "" : "s"} resolved</p>
            </div>
          </div>

          <div className="flex items-start gap-2 p-2 rounded-md bg-muted/30">
            <ShieldCheck className={`w-4 h-4 mt-0.5 shrink-0 ${listedHit ? "text-red-600" : "text-muted-foreground"}`} />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Listed</p>
              <p className="text-sm font-bold">{listedHit ? "Yes" : "No"}</p>
              <p className="text-[10px] text-muted-foreground">{listedHit ? "In register" : "Not listed"}</p>
            </div>
          </div>

          <div className="flex items-start gap-2 p-2 rounded-md bg-muted/30">
            <TrendingUp className="w-4 h-4 text-purple-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Market</p>
              {marketTone?.retail?.rentPsf ? (
                <>
                  <p className="text-sm font-bold">£{marketTone.retail.rentPsf.toFixed(0)} psf</p>
                  <p className="text-[10px] text-muted-foreground">Retail ask</p>
                </>
              ) : retailCompsCount > 0 ? (
                <>
                  <p className="text-sm font-bold">{retailCompsCount}</p>
                  <p className="text-[10px] text-muted-foreground">comp{retailCompsCount === 1 ? "" : "s"}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No data</p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
