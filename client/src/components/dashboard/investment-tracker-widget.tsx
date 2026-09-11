import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "wouter";
import { useMemo, useState } from "react";
import { TrendingUp, ChevronRight, X } from "lucide-react";
import type { InvestmentTracker as InvTracker } from "@shared/schema";

export function InvestmentTrackerWidget() {
  const { data: items = [] } = useQuery<InvTracker[]>({ queryKey: ["/api/investment-tracker"] });

  // Status pills are FILTERS, not a legend (Woody, 2026-08-05: "filters
  // don't work on the investment tracker"). Group case-insensitively so
  // "Live" and "LIVE" data variants land on one pill.
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const normStatus = (s: string | null | undefined) => (s || "Reporting").trim().toUpperCase();

  const statusCounts = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const u of items) {
      const key = normStatus(u.status);
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { label: (u.status || "Reporting").trim(), count: 1 });
    }
    return [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [items]);

  const activeItems = useMemo(() => {
    if (statusFilter) return items.filter(u => normStatus(u.status) === statusFilter).slice(0, 30);
    return items.filter(u => normStatus(u.status) !== "COMPLETED").slice(0, 12);
  }, [items, statusFilter]);

  const statusColors: Record<string, string> = {
    REPORTING: "bg-slate-500",
    REP: "bg-slate-500",
    SPECULATIVE: "bg-violet-500",
    SPEC: "bg-violet-500",
    LIVE: "bg-blue-500",
    AVAILABLE: "bg-amber-500",
    AVA: "bg-amber-500",
    "UNDER OFFER": "bg-orange-500",
    OPP: "bg-orange-500",
    SOL: "bg-orange-500",
    COMPLETED: "bg-green-500",
    COM: "bg-green-500",
    SOLD: "bg-green-500",
    WIT: "bg-neutral-400",
  };
  const dotFor = (s: string | null | undefined) => statusColors[normStatus(s)] || "bg-neutral-400";

  return (
    <Card className="h-full flex flex-col">
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
      <CardContent className="pt-0 flex-1 overflow-hidden flex flex-col gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {statusCounts.map(([key, { label, count }]) => {
            const active = statusFilter === key;
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(active ? null : key)}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-colors ${
                  active ? "bg-foreground text-background border-foreground" : "bg-card hover:bg-muted border-border"
                }`}
                data-testid={`inv-widget-filter-${key.toLowerCase().replace(/\s/g, "-")}`}
              >
                <div className={`w-2 h-2 rounded-full ${statusColors[key] || "bg-neutral-400"}`} />
                <span className={`text-xs ${active ? "" : "text-muted-foreground"}`}>{label}</span>
                <span className="text-xs font-semibold tabular-nums">{count}</span>
                {active && <X className="w-3 h-3" />}
              </button>
            );
          })}
        </div>
        {activeItems.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">{statusFilter ? "Nothing with this status" : "No active investment items"}</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-1 pr-2">
              {activeItems.map(u => (
                <Link key={u.id} href="/investment-tracker">
                  <div className="flex items-center gap-2 py-1.5 px-2 rounded-md border hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`widget-inv-${u.id}`}>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${dotFor(u.status)}`} />
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
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
