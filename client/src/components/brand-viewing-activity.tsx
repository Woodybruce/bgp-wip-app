import { useQuery } from "@tanstack/react-query";
import { calendarDateValue } from "@shared/calendar-date";
import type { ViewingRecord } from "@shared/viewing-workflow";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function BrandViewingActivity({ companyId }: { companyId: string }) {
  const query = useQuery<{ viewings: ViewingRecord[] }>({
    queryKey: ["/api/leasing-viewings", "brand", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/leasing-viewings?companyId=${encodeURIComponent(companyId)}`)).json(),
    staleTime: 30_000,
  });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const cutoff = new Date(`${today}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 89);
  const firstDate = cutoff.toISOString().slice(0, 10);
  const brandRows = (query.data?.viewings || []).filter(v => v.companyId === companyId && calendarDateValue(v.viewingDate) === v.viewingDate);
  const attended = brandRows.filter(v => v.status === "completed" && v.detailsConfirmedAt && v.unitId && v.viewingDate >= firstDate && v.viewingDate <= today);
  const upcoming = brandRows.filter(v => v.status === "scheduled" && v.viewingDate >= today);
  const activity = [...upcoming.sort((a, b) => a.viewingDate.localeCompare(b.viewingDate)), ...attended.sort((a, b) => b.viewingDate.localeCompare(a.viewingDate))];
  const formatDate = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  return (
    <Card data-testid="brand-viewing-activity">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Viewing activity</h3>
          <Button variant="outline" size="sm" asChild><a href={`/available?workspace=viewings&brandId=${encodeURIComponent(companyId)}`}>Open viewing calendar</a></Button>
        </div>
        {query.isLoading ? <Skeleton className="h-24 w-full" /> : query.isError ? (
          <div className="space-y-2"><p className="text-sm">Viewing activity could not be loaded.</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>Refresh</Button></div>
        ) : <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>Attended · 90 days <strong className="font-mono tabular-nums text-foreground">{attended.length}</strong></span>
            <span>Upcoming <strong className="font-mono tabular-nums text-foreground">{upcoming.length}</strong></span>
          </div>
          {activity.length === 0 ? <p className="text-sm text-muted-foreground">No confirmed attended or upcoming viewings recorded.</p> : (
            <div className="space-y-2">{activity.slice(0, 6).map(viewing => (
              <div key={viewing.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="text-sm font-semibold break-words">{viewing.propertyName || "Property to confirm"} · {viewing.unitName || "Unit to confirm"}</p>
                  <span className="text-[11px] text-muted-foreground">{formatDate(viewing.viewingDate)}{viewing.viewingTime ? ` · ${viewing.viewingTime}` : ""}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{viewing.status === "completed" ? "Attended" : "Scheduled"}{viewing.sqft != null && <span className="font-mono tabular-nums"> · {viewing.sqft.toLocaleString("en-GB")} sq ft</span>}{viewing.outcome ? ` · ${viewing.outcome}` : ""}</p>
                <Button variant="outline" size="sm" asChild><a href={`/available?workspace=viewings&viewing=${encodeURIComponent(viewing.id)}`}>Open viewing</a></Button>
              </div>
            ))}</div>
          )}
          {activity.length > 6 && <Button variant="outline" size="sm" asChild><a href={`/available?workspace=viewings&brandId=${encodeURIComponent(companyId)}`}>Show all {brandRows.length} viewing records</a></Button>}
        </>}
      </CardContent>
    </Card>
  );
}
