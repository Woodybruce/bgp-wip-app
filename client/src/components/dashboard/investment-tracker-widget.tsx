import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useMemo } from "react";
import { TrendingUp, ChevronRight } from "lucide-react";
import type { InvestmentTracker as InvTracker } from "@shared/schema";

export function InvestmentTrackerWidget() {
  const { data: items = [] } = useQuery<InvTracker[]>({ queryKey: ["/api/investment-tracker"] });

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { Reporting: 0, Speculative: 0, Live: 0, Available: 0, "Under Offer": 0, Completed: 0 };
    for (const u of items) c[u.status || "Reporting"] = (c[u.status || "Reporting"] || 0) + 1;
    return c;
  }, [items]);

  const activeItems = useMemo(() => items.filter(u => u.status !== "Completed").slice(0, 12), [items]);

  const statusColors: Record<string, string> = {
    Reporting: "bg-slate-500",
    Speculative: "bg-violet-500",
    Live: "bg-blue-500",
    Available: "bg-amber-500",
    "Under Offer": "bg-orange-500",
    Completed: "bg-green-500",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold">Investment Tracker</CardTitle>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{items.length} total</Badge>
        </div>
        <Link href="/investment-tracker">
          <Button variant="ghost" size="sm" className="h-7 text-xs" data-testid="button-view-all-investments">
            View All <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className="flex gap-4 flex-wrap">
          {Object.entries(statusCounts).filter(([, count]) => count > 0).map(([status, count]) => (
            <div key={status} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${statusColors[status] || "bg-neutral-400"}`} />
              <span className="text-xs text-muted-foreground">{status}</span>
              <span className="text-xs font-semibold">{count}</span>
            </div>
          ))}
        </div>
        {activeItems.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">No active investment items</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {activeItems.map(u => (
              <Link key={u.id} href="/investment-tracker">
                <div className="flex items-center gap-2 py-1.5 px-2 rounded-md border hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`widget-inv-${u.id}`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${statusColors[u.status || "Reporting"] || "bg-neutral-400"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{u.assetName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{u.address || u.assetType || ""}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {u.sqft && <span className="text-[10px] text-muted-foreground">{u.sqft.toLocaleString()} sf</span>}
                    {u.guidePrice && <span className="text-[10px] font-medium">£{u.guidePrice.toLocaleString()}</span>}
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
