import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Building2 } from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";
import { PropertiesSummary } from "@/components/properties-summary";

interface PortfolioProperty {
  propertyId: string;
  propertyName: string;
  address: any;
  assetClass: string | null;
  landlordName: string | null;
  deals: Array<{
    id: string;
    name: string;
    dealType: string | null;
    status: string | null;
    fee: number | null;
    targetDate: string | null;
    exchangedAt: string | null;
    completedAt: string | null;
    invoicedAt: string | null;
  }>;
  expiringUnits: Array<{
    id: string;
    unitName: string | null;
    leaseExpiry: string;
    sqft: number | null;
    status: string | null;
  }>;
  contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    jobTitle: string | null;
  }>;
}

export function MyPortfolioWidget() {
  const { data, isLoading } = useQuery<PortfolioProperty[]>({
    queryKey: ["/api/dashboard/my-portfolio"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const properties = data || [];

  return (
    <Card className="h-full flex flex-col">
      <CardContent className="p-3 space-y-2 flex-1 overflow-hidden">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-xs flex items-center gap-1.5" data-testid="text-my-portfolio-title">
            <Building2 className="w-3.5 h-3.5 text-indigo-500" />
            My Portfolio
            {properties.length > 0 && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-1">
                {properties.length}
              </Badge>
            )}
          </h3>
          {properties.length > 8 && (
            <Link href="/properties">
              <span className="text-[10px] text-blue-600 hover:underline cursor-pointer">
                View all
              </span>
            </Link>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : properties.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-8">
            <div className="text-center">
              <Building2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-30" />
              <p className="text-xs text-muted-foreground">
                No active properties assigned to you
              </p>
            </div>
          </div>
        ) : (
          // Canonical PropertiesSummary rows scoped to your assigned
          // properties (Woody, 2026-08-03) — the same board design as the
          // Landsec portfolio and Properties & Deals widgets.
          <div className="overflow-y-auto max-h-[calc(100%-2rem)]">
            <PropertiesSummary propertyIds={properties.map(p => p.propertyId)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
