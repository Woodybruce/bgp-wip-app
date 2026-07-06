import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Building2, User2, Briefcase, Clock } from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

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
  const displayProperties = properties.slice(0, 8);

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
        ) : displayProperties.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-8">
            <div className="text-center">
              <Building2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-30" />
              <p className="text-xs text-muted-foreground">
                No active properties assigned to you
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1 overflow-y-auto max-h-[calc(100%-2rem)]">
            {displayProperties.map((prop) => {
              const activeDealCount = prop.deals.length;
              const expiringCount = prop.expiringUnits.length;
              const keyContact = prop.contacts[0];

              return (
                <div
                  key={prop.propertyId}
                  className="flex items-center gap-2 p-2 rounded-lg border bg-background hover:bg-muted/50 transition-colors text-xs"
                  data-testid={`portfolio-row-${prop.propertyId}`}
                >
                  <div className="flex-1 min-w-0">
                    <Link href={`/properties/${prop.propertyId}`}>
                      <span className="text-xs font-medium text-blue-600 hover:underline cursor-pointer truncate block">
                        {prop.propertyName}
                      </span>
                    </Link>
                    {prop.landlordName && (
                      <span className="text-[10px] text-muted-foreground truncate block">
                        {prop.landlordName}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {activeDealCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-4 px-1.5 gap-0.5"
                        data-testid={`portfolio-deals-${prop.propertyId}`}
                      >
                        <Briefcase className="w-2.5 h-2.5" />
                        {activeDealCount}
                      </Badge>
                    )}

                    {expiringCount > 0 && (
                      <Badge
                        className="text-[10px] h-4 px-1.5 gap-0.5 bg-amber-100 text-amber-800 hover:bg-amber-100"
                        data-testid={`portfolio-expiring-${prop.propertyId}`}
                      >
                        <Clock className="w-2.5 h-2.5" />
                        {expiringCount}
                      </Badge>
                    )}

                    {keyContact && (
                      <span
                        className="text-[10px] text-muted-foreground flex items-center gap-0.5 max-w-[80px] truncate"
                        title={keyContact.name}
                      >
                        <User2 className="w-2.5 h-2.5 shrink-0" />
                        {keyContact.name.split(" ")[0]}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
