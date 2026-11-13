// A Landsec scheme's units, in one place
// (docs/landsec-menu-plan-2026-11-12.md, part 3): every unit with its status,
// tenant or target, sq ft, passing rent, ERV, expiry or break, the brief tag
// and the live deal's stage and days, each opening the unit page. The
// property page's "Units and lettings" section and the older scheme page both
// draw the list from here.
//
// Fed by GET /api/landsec/scheme/:key, or the same answer found from a
// property record (GET /api/landsec/scheme/by-property/:propertyId). Both are
// cut on the server to the schemes the viewer can see.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Pill, PillCount } from "@/components/ui/pill";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DealStatusCode } from "@shared/deal-status";
import { StatusPill, StageChip, rowPill } from "@/components/landsec/deal-clock";

export interface SchemeUnit {
  id: string; propertyId: string; grouping: string | null; unit: string | null; floor: string | null;
  status: string | null; vacant: boolean; tenant: string | null; use: string | null;
  passingRent: number | null; erv: number | null; askingRent: number | null; sqft: number | null;
  leaseExpiry: string | null; breakDate: string | null; targetTenants: string | null; marketingActive: boolean;
  trackerStatus: string | null;
  brief: "agreed" | "drafted" | null;
  deal: { id: string; ref: number | null; name: string; tenant: string | null; code: DealStatusCode | null; days: number | null; stageConfirmed?: boolean } | null;
}
export interface SchemeData {
  scheme: { key: string; name: string; town: string; group: string; propertyId: string | null; properties: { id: string; name: string }[] };
  units: SchemeUnit[];
}

type Filter = "all" | "vacant" | "live" | "expiring" | "nobrief";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All units" },
  { key: "vacant", label: "Vacant" },
  { key: "live", label: "Live lettings" },
  { key: "expiring", label: "Expiry or break <12m" },
  { key: "nobrief", label: "No agreed brief" },
];

// The scheme a property record belongs to, with its units. A record that is
// not one of the schemes (or one outside the viewer's schemes) is an error
// here, which the property page reads as "no section".
export function useLandsecSchemeOfProperty(propertyId: string | null) {
  return useQuery<SchemeData>({
    queryKey: ["/api/landsec/scheme/by-property", propertyId],
    queryFn: async () => (await apiRequest("GET", `/api/landsec/scheme/by-property/${encodeURIComponent(propertyId!)}`)).json(),
    enabled: !!propertyId,
    staleTime: 60 * 1000,
    retry: false,
  });
}

export function schemeUnitCounts(units: SchemeUnit[]) {
  return { all: units.length, vacant: units.filter(u => u.vacant).length, live: units.filter(u => u.deal).length };
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function BriefTag({ brief }: { brief: SchemeUnit["brief"] }) {
  const cls = brief === "agreed" ? "border-emerald-600/60 text-emerald-700 dark:text-emerald-400" : brief === "drafted" ? "border-amber-500/60 text-amber-700 dark:text-amber-400" : "border-border text-muted-foreground";
  return <span className={cn(rowPill, "mt-0.5 px-1.5", cls)}>{brief === "agreed" ? "Brief agreed" : brief === "drafted" ? "Brief unsigned" : "No brief"}</span>;
}

function DealCell({ deal, href }: { deal: SchemeUnit["deal"]; href?: string | null }) {
  if (!deal) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <StageChip code={deal.code} days={deal.days} confirmed={deal.stageConfirmed} />
      {deal.tenant && (href
        ? <Link href={href} className="truncate max-w-[10rem] hover:underline" data-testid={`landsec-unit-deal-link-${deal.id}`}>{deal.tenant}</Link>
        : <span className="truncate max-w-[10rem]">{deal.tenant}</span>)}
      {!deal.tenant && href && <Link href={href} className="text-muted-foreground hover:underline" data-testid={`landsec-unit-deal-link-${deal.id}`}>Open deal</Link>}
    </span>
  );
}

const th = "px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap";

// The list: filter pills with counts, search, a table on desktop and a card
// list on phones. dealHref makes the deal a link, for logins that have the
// Deals page. currentPropertyId marks the property page the list sits on, so
// a unit on another record of the same scheme says which record it is on.
// compact is for a narrow host (the property page's left column): the Deal
// column, with its stage, days and link, comes straight after the status so
// it is on screen without a sideways scroll, and Sq ft and Passing rent are
// dropped below a wide screen (both are on the unit page).
export function SchemeUnitsList({ data, dealHref, currentPropertyId, maxHeight, compact }: {
  data: SchemeData;
  dealHref?: (dealId: string) => string;
  currentPropertyId?: string;
  maxHeight?: boolean;
  compact?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const units = data.units;

  const soon = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() + 12); return d.getTime(); }, []);
  const expiring = (x: SchemeUnit) => !x.vacant && ((!!x.leaseExpiry && new Date(x.leaseExpiry).getTime() < soon) || (!!x.breakDate && new Date(x.breakDate).getTime() < soon && new Date(x.breakDate).getTime() > Date.now()));
  const noBrief = (x: SchemeUnit) => (x.vacant || !!x.deal) && x.brief !== "agreed";
  const counts = useMemo<Record<Filter, number>>(() => ({
    ...schemeUnitCounts(units),
    expiring: units.filter(expiring).length,
    nobrief: units.filter(noBrief).length,
  }), [units, soon]);

  const rows = useMemo(() => {
    let u = units;
    if (filter === "vacant") u = u.filter(x => x.vacant);
    if (filter === "live") u = u.filter(x => x.deal);
    if (filter === "expiring") u = u.filter(expiring);
    if (filter === "nobrief") u = u.filter(noBrief);
    const q = search.trim().toLowerCase();
    if (q) u = u.filter(x => [x.unit, x.tenant, x.use, x.grouping, x.targetTenants, x.deal?.tenant].some(v => (v || "").toLowerCase().includes(q)));
    return u;
  }, [units, filter, search, soon]);

  // Units on another record of this scheme (a scheme can still have more
  // than one property record until an admin merges them).
  const recordName = useMemo(() => new Map(data.scheme.properties.map(p => [p.id, p.name])), [data]);
  const elsewhere = currentPropertyId ? units.filter(u => u.propertyId !== currentPropertyId).length : 0;
  const otherRecord = (u: SchemeUnit) => (currentPropertyId && u.propertyId !== currentPropertyId ? recordName.get(u.propertyId) || "another record" : null);

  const wide = compact ? "hidden min-[1800px]:table-cell" : "";
  const dealHead = <th className={cn(th, "text-left")}>Deal</th>;
  const dealCell = (u: SchemeUnit) => <td className="px-3 py-2"><DealCell deal={u.deal} href={u.deal && dealHref ? dealHref(u.deal.id) : null} /></td>;

  return (
    <div className="space-y-3" data-testid="landsec-scheme-units">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(f => (
          <Pill key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)} data-testid={`landsec-scheme-filter-${f.key}`}>
            {f.label} <PillCount n={counts[f.key]} active={filter === f.key} />
          </Pill>
        ))}
      </div>
      <Input placeholder="Search unit, tenant, use or target…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-md" data-testid="landsec-scheme-search" />
      {elsewhere > 0 && (
        <p className="text-[11px] text-muted-foreground" data-testid="landsec-scheme-other-records">
          {data.scheme.name} has {data.scheme.properties.length} property records. <span className="font-mono tabular-nums">{elsewhere}</span> of these units {elsewhere === 1 ? "sits" : "sit"} on another record, named under the unit.
        </p>
      )}

      {/* Desktop table */}
      <div className={cn("hidden md:block rounded-lg border border-border overflow-x-auto", maxHeight && "max-h-[640px] overflow-y-auto")}>
        <table className="w-full text-sm">
          <thead className={cn("bg-muted", maxHeight && "sticky top-0 z-10")}>
            <tr>
              <th className={cn(th, "text-left")}>Unit</th>
              <th className={cn(th, "text-left")}>Status</th>
              {compact && dealHead}
              <th className={cn(th, "text-left")}>Tenant / target</th>
              <th className={cn(th, "text-right", wide)}>Sq ft</th>
              <th className={cn(th, "text-right", wide)}>Passing</th>
              <th className={cn(th, "text-right")}>ERV</th>
              <th className={cn(th, "text-left")}>Expiry / break</th>
              {!compact && dealHead}
            </tr>
          </thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link href={`/landsec/unit/${u.id}`} className="font-medium hover:underline" data-testid={`landsec-unit-link-${u.id}`}>{u.unit || "—"}</Link>
                  {u.grouping && <span className="block text-[11px] text-muted-foreground">{u.grouping}{u.floor ? ` · ${u.floor}` : ""}</span>}
                  {otherRecord(u) && <span className="block text-[11px] text-muted-foreground">On {otherRecord(u)}</span>}
                  {(u.vacant || u.deal) && <BriefTag brief={u.brief} />}
                </td>
                <td className="px-3 py-2"><StatusPill status={u.status} vacant={u.vacant} /></td>
                {compact && dealCell(u)}
                <td className="px-3 py-2">
                  {u.tenant || <span className="text-muted-foreground">{u.targetTenants ? `Target: ${u.targetTenants}` : "—"}</span>}
                  {u.use && <span className="block text-[11px] text-muted-foreground">{u.use}</span>}
                </td>
                <td className={cn("px-3 py-2 text-right font-mono tabular-nums", wide)}>{u.sqft ? Math.round(u.sqft).toLocaleString("en-GB") : "—"}</td>
                <td className={cn("px-3 py-2 text-right font-mono tabular-nums", wide)}>{u.passingRent ? formatCurrency(u.passingRent) : "—"}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{u.erv ? formatCurrency(u.erv) : u.askingRent ? <span title="Target rent">{formatCurrency(u.askingRent)}*</span> : "—"}</td>
                <td className="px-3 py-2 text-xs font-mono tabular-nums whitespace-nowrap">{fmtDate(u.leaseExpiry)}{u.breakDate ? ` / ${fmtDate(u.breakDate)}` : ""}</td>
                {!compact && dealCell(u)}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{units.length === 0 ? "No units on the tenancy schedule yet." : "No units match."}</td></tr>}
          </tbody>
        </table>
      </div>
      {/* Phone cards */}
      <div className="md:hidden space-y-2">
        {rows.map(u => (
          <Link key={u.id} href={`/landsec/unit/${u.id}`} className="block rounded-2xl border border-border bg-card p-3 space-y-1" data-testid={`landsec-unit-card-${u.id}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium min-w-0 truncate">{u.unit || "—"}</span>
              <StatusPill status={u.status} vacant={u.vacant} />
            </div>
            <p className="text-[11px] text-muted-foreground truncate">{u.tenant || (u.targetTenants ? `Target: ${u.targetTenants}` : u.use || "")}{otherRecord(u) ? ` · on ${otherRecord(u)}` : ""}</p>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">{u.passingRent ? formatCurrency(u.passingRent) : u.erv ? `ERV ${formatCurrency(u.erv)}` : ""}</span>
              <DealCell deal={u.deal} />
            </div>
          </Link>
        ))}
        {rows.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">{units.length === 0 ? "No units on the tenancy schedule yet." : "No units match."}</p>}
      </div>
    </div>
  );
}
