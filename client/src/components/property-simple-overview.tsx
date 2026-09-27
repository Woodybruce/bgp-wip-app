import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCalendarDate } from "@shared/calendar-date";
import { propertyOverviewFacts, type PropertyOverviewUnit } from "@shared/property-view";

const money = (value: number) => `£${Math.round(value).toLocaleString("en-GB")}`;

// Lease events kinds → the Lease events board's event types.
const TRACK_TYPE: Record<string, string> = { "Lease expiry": "Lease Expiry", "Break date": "Break Option", "Landlord break": "Break Option", "Rent review": "Rent Review" };
// "Unit L033 Upper Thames Walk" → "L033": the code is what the team says.
const unitCode = (ref: string) => (ref.match(/^(?:unit|shop|kiosk)?\s*([A-Z]{0,3}\s?\d[\w./-]*)/i)?.[1] || ref.split(/\s+[-–]\s+|,/)[0]).trim();
const trackKey = (unit: string | null | undefined, type: string, date: string) => `${String(unit || "").toLowerCase().replace(/\s+/g, "")}|${type}|${String(date).slice(0, 7)}`;

// Next lease events with a Track button that adds the event to Lease events
// (the landlord page's Lease advisory tab does the same) — so lease advisory
// can approach ahead of it. Staff only; tracked ones link to the board.
export function NextLeaseEvents({ propertyId, propertyName, landlordName, rows, limit = 3, onOpenTenancy }: {
  propertyId: string; propertyName?: string | null; landlordName?: string | null; rows: PropertyOverviewUnit[]; limit?: number; onOpenTenancy?: () => void;
}) {
  const { toast } = useToast();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { nextEvents, pastEvents } = propertyOverviewFacts(rows, today);
  const { data: tracked = [] } = useQuery<any[]>({ queryKey: [`/api/lease-events?propertyId=${propertyId}`] });
  const trackedKeys = new Map((Array.isArray(tracked) ? tracked : []).map((t: any) => [trackKey(t.unitRef, t.eventType, t.eventDate ? new Date(t.eventDate).toISOString() : ""), t]));
  const track = useMutation({
    mutationFn: async (event: any) => (await apiRequest("POST", "/api/lease-events", {
      propertyId, address: propertyName || null, landlord: landlordName || null, tenant: event.unit.trading_name || event.unit.tenant_name || null,
      unitRef: event.unit.unit_number || event.unit.premises || null, eventType: TRACK_TYPE[event.kind] || event.kind, eventDate: event.date,
      status: "Monitoring", sourceEvidence: "Property page",
    })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [`/api/lease-events?propertyId=${propertyId}`] }); toast({ title: "Added to Lease events" }); },
    onError: (e: any) => toast({ title: "Couldn't track that event", description: e?.message, variant: "destructive" }),
  });
  const tenancyHref = (unit: PropertyOverviewUnit) => `/tenancy-schedule/${propertyId}${unit.is_vacant ? "" : `?unitId=${encodeURIComponent(String(unit.id))}`}`;
  return <div className="space-y-2">
    {nextEvents.slice(0, limit).map(event => {
      const unitRef = event.unit.unit_number || event.unit.premises || "Unit";
      // "Unit 2.18 211 Trinity Leeds - Unit 2.18" → "Unit 2.18 211": the
      // scheme's name (and whatever follows it) is noise on its own page.
      const nameAt = propertyName ? unitRef.toLowerCase().indexOf(propertyName.toLowerCase().split(/[,(]/)[0].trim()) : -1;
      const shortRef = (nameAt > 2 ? unitRef.slice(0, nameAt) : unitRef).replace(/[\s,·-]+$/, "").slice(0, 40) || unitRef;
      const done = trackedKeys.get(trackKey(unitRef, TRACK_TYPE[event.kind] || event.kind, event.date));
      return <div key={`${event.unit.id}-${event.kind}`} className="flex items-center justify-between gap-3 text-sm">
        {/* Two lines so the event kind never truncates away on a phone —
            "Leomonica Yoshoku · …" twice couldn't tell a break from an expiry. */}
        <Link href={tenancyHref(event.unit)} className="hover:underline min-w-0 flex flex-col leading-tight" title={`${unitRef} · ${event.unit.tenant_name || ""}`}>
          <span className="font-medium truncate">{event.unit.trading_name || event.unit.tenant_name || shortRef}</span>
          <span className="text-[11px] text-muted-foreground truncate">{event.unit.trading_name || event.unit.tenant_name ? `${unitCode(shortRef)} · ` : ""}{event.kind}</span>
        </Link>
        <span className="flex items-center gap-2 shrink-0">
          <span className="font-mono tabular-nums whitespace-nowrap">{formatCalendarDate(event.date)}</span>
          {done ? <Link href="/lease-events" className="text-[10px] text-emerald-700 hover:underline">{done.status || "Tracked"}</Link>
            : <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" disabled={track.isPending} onClick={() => track.mutate(event)} data-testid="button-track-property-lease-event">Track</Button>}
        </span>
      </div>;
    })}
    {!nextEvents.length && <p className="text-sm text-muted-foreground">No upcoming lease dates recorded.</p>}
    {nextEvents.length > limit && <Link href="/lease-events" className="text-[11px] text-primary hover:underline">{nextEvents.length - limit} more upcoming · Lease events →</Link>}
    {pastEvents.length > 0 && onOpenTenancy && <button type="button" onClick={onOpenTenancy} className="text-sm underline text-left block">{pastEvents.length} recorded lease {pastEvents.length === 1 ? "date has" : "dates have"} passed — review the schedule</button>}
  </div>;
}

export function PropertySimpleOverview({ propertyId, propertyName, landlordName, canTrack = false, rows, loading, failed, onRetry, onOpenTenancy, showUnits = true }: {
  propertyId: string; rows: PropertyOverviewUnit[] | undefined; loading: boolean; failed: boolean;
  propertyName?: string | null; landlordName?: string | null; canTrack?: boolean;
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
        {/* Multi-let puts the compact schedule (with its own passing-rent
            tile) on the same screen — the figure showed twice. */}
        {showUnits && <>
        <div className="flex items-end justify-between border-b pb-3 gap-3">
          <div><p className="text-[11px] text-muted-foreground">Recorded passing rent / year</p>{knownRent === null ? <p className="text-sm text-muted-foreground">Not recorded</p> : <p className="text-2xl font-mono tabular-nums">{money(knownRent)}</p>}</div>
          <span className="text-sm text-muted-foreground"><span className="font-mono tabular-nums">{units.length}</span> tenancy {units.length === 1 ? "row" : "rows"}</span>
        </div>
        {rentRows > 0 && rentRows < units.length && <p className="text-[11px] text-muted-foreground -mt-2" title={`Rent is recorded for ${rentRows} of ${units.length} rows, so this is not a complete income total.`}>Partial · {rentRows} of {units.length} rows</p>}
        </>}
        {showUnits && <div className="space-y-2">
          {units.slice(0, 6).map(unit => <Link key={unit.id} href={tenancyHref(unit)} className="block rounded-lg border p-3 hover:bg-muted/50">
            <div className="flex justify-between gap-3 text-sm"><span className="font-semibold">{unit.unit_number || unit.premises || "Unnamed unit"}</span><span className="text-muted-foreground">{unit.is_vacant ? "Vacant" : unit.status || "Status not recorded"}</span></div>
            <p className="text-sm mt-1">{unit.trading_name || unit.tenant_name || "Tenant not recorded"}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{[unit.floor_level, unit.permitted_use].filter(Boolean).join(" · ") || "Open tenancy details"}</p>
          </Link>)}
          {units.length > 6 && <Button variant="outline" size="sm" onClick={onOpenTenancy}>Show all {units.length} tenancy rows</Button>}
        </div>}
        <div className={`${showUnits ? "border-t pt-3 " : ""}space-y-2`}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next lease events</h2>
          {canTrack ? <NextLeaseEvents propertyId={propertyId} propertyName={propertyName} landlordName={landlordName} rows={rows} limit={showUnits ? 3 : 5} onOpenTenancy={onOpenTenancy} /> : <>
          {nextEvents.slice(0, showUnits ? 3 : 5).map(event => <Link key={`${event.unit.id}-${event.kind}`} href={tenancyHref(event.unit)} className="flex justify-between gap-3 text-sm hover:underline"><span>{event.unit.unit_number || event.unit.premises || "Unit"} · {event.kind}</span><span className="font-mono tabular-nums whitespace-nowrap">{formatCalendarDate(event.date)}</span></Link>)}
          {!nextEvents.length && <p className="text-sm text-muted-foreground">No upcoming lease dates recorded.</p>}
          {pastEvents.length > 0 && <button type="button" onClick={onOpenTenancy} className="text-sm underline text-left">{pastEvents.length} recorded lease {pastEvents.length === 1 ? "date has" : "dates have"} passed — review the schedule</button>}
          </>}
        </div>
      </>}
    </CardContent>
  </Card>;
}
