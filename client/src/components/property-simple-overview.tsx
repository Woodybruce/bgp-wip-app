import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCalendarDate } from "@shared/calendar-date";
import { propertyOverviewFacts, type PropertyOverviewUnit } from "@shared/property-view";

const money = (value: number) => `£${Math.round(value).toLocaleString("en-GB")}`;

export function PropertySimpleOverview({ propertyId, rows, loading, failed, onRetry, onOpenTenancy, showUnits = true }: {
  propertyId: string; rows: PropertyOverviewUnit[] | undefined; loading: boolean; failed: boolean;
  showUnits?: boolean;
  onRetry: () => void; onOpenTenancy: () => void;
}) {
  if (failed) return <Card><CardContent className="p-4 space-y-2"><p className="text-sm">The tenancy summary could not load.</p><Button variant="outline" size="sm" onClick={onRetry}>Retry</Button></CardContent></Card>;
  if (loading || !rows) return <Card><CardContent className="p-4"><Skeleton className="h-40 w-full" /></CardContent></Card>;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { units, knownRent, rentRows, nextEvents, pastEvents } = propertyOverviewFacts(rows, today);
  const tenancyHref = (unit: PropertyOverviewUnit) => `/tenancy-schedule/${propertyId}${unit.is_vacant ? "" : `?unitId=${encodeURIComponent(String(unit.id))}`}`;
  return <Card data-testid="property-simple-overview">
    <CardHeader className="p-4 pb-3 flex flex-row items-center justify-between gap-2 space-y-0">
      <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tenancy at a glance</CardTitle>
      <Button variant="outline" size="sm" onClick={onOpenTenancy}>Open tenancy</Button>
    </CardHeader>
    <CardContent className="p-4 pt-0 space-y-4">
      {!units.length ? <div className="space-y-2"><p className="text-sm text-muted-foreground">No current tenancy rows recorded. Add the schedule to show tenants, rents and lease events.</p><Button size="sm" onClick={onOpenTenancy}>Add tenancy information</Button></div> : <>
        <div className="flex items-end justify-between border-b pb-3 gap-3">
          <div><p className="text-[11px] text-muted-foreground">Recorded passing rent / year</p><p className="text-2xl font-mono tabular-nums">{knownRent === null ? "Not recorded" : money(knownRent)}</p></div>
          <span className="text-sm text-muted-foreground"><span className="font-mono tabular-nums">{units.length}</span> tenancy {units.length === 1 ? "row" : "rows"}</span>
        </div>
        {rentRows < units.length && <p className="text-[11px] text-muted-foreground">Rent recorded for {rentRows} of {units.length} rows; this is not a complete income total.</p>}
        {showUnits && <div className="space-y-2">
          {units.slice(0, 6).map(unit => <Link key={unit.id} href={tenancyHref(unit)} className="block rounded-lg border p-3 hover:bg-muted/50">
            <div className="flex justify-between gap-3 text-sm"><span className="font-semibold">{unit.unit_number || unit.premises || "Unnamed unit"}</span><span className="text-muted-foreground">{unit.is_vacant ? "Vacant" : unit.status || "Status not recorded"}</span></div>
            <p className="text-sm mt-1">{unit.trading_name || unit.tenant_name || "Tenant not recorded"}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{[unit.floor_level, unit.permitted_use].filter(Boolean).join(" · ") || "Open tenancy details"}</p>
          </Link>)}
          {units.length > 6 && <Button variant="outline" size="sm" onClick={onOpenTenancy}>Show all {units.length} tenancy rows</Button>}
        </div>}
        <div className="border-t pt-3 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next lease events</h2>
          {nextEvents.slice(0, 3).map(event => <Link key={`${event.unit.id}-${event.kind}`} href={tenancyHref(event.unit)} className="flex justify-between gap-3 text-sm hover:underline"><span>{event.unit.unit_number || event.unit.premises || "Unit"} · {event.kind}</span><span className="font-mono tabular-nums whitespace-nowrap">{formatCalendarDate(event.date)}</span></Link>)}
          {!nextEvents.length && <p className="text-sm text-muted-foreground">No upcoming lease dates recorded.</p>}
          {pastEvents.length > 0 && <button type="button" onClick={onOpenTenancy} className="text-sm underline text-left">{pastEvents.length} recorded lease {pastEvents.length === 1 ? "date has" : "dates have"} passed — review the schedule</button>}
        </div>
      </>}
    </CardContent>
  </Card>;
}
