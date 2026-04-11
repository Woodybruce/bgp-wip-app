import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useMemo } from "react";
import { Store, ChevronRight } from "lucide-react";
import type { CrmProperty } from "@shared/schema";

export function AvailableUnitsWidget() {
  const { data: units = [] } = useQuery<any[]>({ queryKey: ["/api/available-units"] });
  const { data: properties = [] } = useQuery<CrmProperty[]>({ queryKey: ["/api/crm/properties"] });
  const { data: favoriteIds = [] } = useQuery<string[]>({ queryKey: ["/api/favorite-instructions"] });

  const propMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of properties) m[p.id] = p.name;
    return m;
  }, [properties]);

  const filteredUnits = useMemo(() => {
    if (favoriteIds.length === 0) return units;
    return units.filter(u => favoriteIds.includes(u.propertyId));
  }, [units, favoriteIds]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { Reporting: 0, Available: 0, Negotiating: 0, "Under Offer": 0 };
    for (const u of filteredUnits) c[u.marketingStatus || "Available"] = (c[u.marketingStatus || "Available"] || 0) + 1;
    return c;
  }, [filteredUnits]);

  const activeUnits = useMemo(() => filteredUnits.slice(0, 12), [filteredUnits]);

  const statusColors: Record<string, string> = {
    Reporting: "bg-violet-500",
    Available: "bg-emerald-500",
    Negotiating: "bg-blue-500",
    "Under Offer": "bg-amber-500",
    Let: "bg-green-500",
    Withdrawn: "bg-gray-500",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <Store className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold">Letting Tracker</CardTitle>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{filteredUnits.length} total</Badge>
        </div>
        <Link href="/available">
          <Button variant="ghost" size="sm" className="h-7 text-xs" data-testid="button-view-all-units">
            View All <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className="flex gap-4">
          {Object.entries(statusCounts).filter(([k]) => k !== "Let").map(([status, count]) => (
            <div key={status} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${statusColors[status] || "bg-neutral-400"}`} />
              <span className="text-xs text-muted-foreground">{status}</span>
              <span className="text-xs font-semibold">{count}</span>
            </div>
          ))}
        </div>
        {activeUnits.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Store className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">{favoriteIds.length === 0 ? "Star instructions to see their units here" : "No available units for your starred instructions"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {activeUnits.map(u => (
              <Link key={u.id} href="/available">
                <div className="flex items-center gap-2 py-1.5 px-2 rounded-md border hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`widget-unit-${u.id}`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${statusColors[u.marketingStatus] || "bg-neutral-400"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{u.unitName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{propMap[u.propertyId] || ""}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {u.sqft && <span className="text-[10px] text-muted-foreground">{u.sqft.toLocaleString()} sf</span>}
                    {u.askingRent && <span className="text-[10px] font-medium">£{u.askingRent.toLocaleString()}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
