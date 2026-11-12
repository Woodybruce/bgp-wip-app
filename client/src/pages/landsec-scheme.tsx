// One Landsec scheme: its units with status, tenant, rent, ERV and the live
// deal's stage and days, each opening the single unit page
// (docs/landsec-pitch-plan.md, item 2).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ChevronRight, Clock } from "lucide-react";
import { Pill, PillCount } from "@/components/ui/pill";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { DEAL_STATUS_LABELS, type DealStatusCode } from "@shared/deal-status";
import { RESTRICTED_LANDSEC_ROLES } from "@shared/landsec";

interface SchemeUnit {
  id: string; propertyId: string; grouping: string | null; unit: string | null; floor: string | null;
  status: string | null; vacant: boolean; tenant: string | null; use: string | null;
  passingRent: number | null; erv: number | null; askingRent: number | null; sqft: number | null;
  leaseExpiry: string | null; breakDate: string | null; targetTenants: string | null; marketingActive: boolean;
  trackerStatus: string | null;
  brief: "agreed" | "drafted" | null;
  deal: { id: string; ref: number | null; name: string; tenant: string | null; code: DealStatusCode | null; days: number | null } | null;
}
interface SchemeData {
  scheme: { key: string; name: string; town: string; group: string; propertyId: string | null; properties: { id: string; name: string }[] };
  units: SchemeUnit[];
}

type Filter = "all" | "vacant" | "live" | "expiring" | "nobrief";

function fmtDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export default function LandsecScheme() {
  const { key } = useParams<{ key: string }>();
  const { data, isLoading, error } = useQuery<SchemeData>({ queryKey: [`/api/landsec/scheme/${key}`], staleTime: 60 * 1000 });
  // An asset manager or joint agent login has no property record page; a
  // joint agent has their own tracker for the scheme instead.
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const landsecRole = String(me?.landsecRole || "");
  const restricted = (RESTRICTED_LANDSEC_ROLES as string[]).includes(landsecRole);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const soon = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() + 12); return d.getTime(); }, []);
  const counts = useMemo(() => {
    const u = data?.units || [];
    return {
      all: u.length,
      vacant: u.filter(x => x.vacant).length,
      live: u.filter(x => x.deal).length,
      expiring: u.filter(x => !x.vacant && ((x.leaseExpiry && new Date(x.leaseExpiry).getTime() < soon) || (x.breakDate && new Date(x.breakDate).getTime() < soon && new Date(x.breakDate).getTime() > Date.now()))).length,
      nobrief: u.filter(x => (x.vacant || x.deal) && x.brief !== "agreed").length,
    };
  }, [data, soon]);

  const rows = useMemo(() => {
    let u = data?.units || [];
    if (filter === "vacant") u = u.filter(x => x.vacant);
    if (filter === "live") u = u.filter(x => x.deal);
    if (filter === "expiring") u = u.filter(x => !x.vacant && ((x.leaseExpiry && new Date(x.leaseExpiry).getTime() < soon) || (x.breakDate && new Date(x.breakDate).getTime() < soon && new Date(x.breakDate).getTime() > Date.now())));
    if (filter === "nobrief") u = u.filter(x => (x.vacant || x.deal) && x.brief !== "agreed");
    const q = search.trim().toLowerCase();
    if (q) u = u.filter(x => [x.unit, x.tenant, x.use, x.grouping, x.targetTenants, x.deal?.tenant].some(v => (v || "").toLowerCase().includes(q)));
    return u;
  }, [data, filter, search, soon]);

  if (error) {
    return <div className="p-4 md:p-6"><p className="text-sm text-muted-foreground">This scheme could not be loaded. {(error as any)?.message || ""}</p></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="landsec-scheme">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground"><Link href="/" className="hover:text-foreground">Landsec portfolio</Link> › {data?.scheme.group || ""}</p>
          <h1 className="text-2xl font-bold tracking-tight">{data?.scheme.name || "Scheme"}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data ? `${data.scheme.town} · ${counts.all} units · ${counts.vacant} vacant · ${counts.live} live lettings` : ""}
          </p>
        </div>
        {data?.scheme.propertyId && !restricted && (
          <Link href={`/properties/${data.scheme.propertyId}`}>
            <Button variant="outline" size="sm">Full property record <ChevronRight className="w-3 h-3 ml-1" /></Button>
          </Link>
        )}
        {landsecRole === "joint_agent" && (
          <Link href="/landsec/tracker">
            <Button variant="outline" size="sm" data-testid="landsec-scheme-tracker">Tracker <ChevronRight className="w-3 h-3 ml-1" /></Button>
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(["all", "vacant", "live", "expiring", "nobrief"] as Filter[]).map(f => (
          <Pill key={f} active={filter === f} onClick={() => setFilter(f)} data-testid={`landsec-scheme-filter-${f}`}>
            {f === "all" ? "All units" : f === "vacant" ? "Vacant" : f === "live" ? "Live lettings" : f === "expiring" ? "Expiry or break <12m" : "No agreed brief"} <PillCount n={counts[f]} active={filter === f} />
          </Pill>
        ))}
      </div>
      <Input placeholder="Search unit, tenant, use or target…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-md" />

      {isLoading && <Skeleton className="h-64 rounded-lg" />}

      {data && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Unit</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Tenant / target</th>
                  <th className="text-right px-3 py-2 font-medium">Sq ft</th>
                  <th className="text-right px-3 py-2 font-medium">Passing</th>
                  <th className="text-right px-3 py-2 font-medium">ERV</th>
                  <th className="text-left px-3 py-2 font-medium">Expiry / break</th>
                  <th className="text-left px-3 py-2 font-medium">Deal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(u => (
                  <tr key={u.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link href={`/landsec/unit/${u.id}`} className="font-medium hover:underline" data-testid={`landsec-unit-link-${u.id}`}>{u.unit || "—"}</Link>
                      {u.grouping && <span className="block text-[11px] text-muted-foreground">{u.grouping}{u.floor ? ` · ${u.floor}` : ""}</span>}
                      {(u.vacant || u.deal) && <BriefTag brief={u.brief} />}
                    </td>
                    <td className="px-3 py-2"><StatusPill status={u.status} vacant={u.vacant} /></td>
                    <td className="px-3 py-2">
                      {u.tenant || <span className="text-muted-foreground">{u.targetTenants ? `Target: ${u.targetTenants}` : "—"}</span>}
                      {u.use && <span className="block text-[11px] text-muted-foreground">{u.use}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{u.sqft ? Math.round(u.sqft).toLocaleString("en-GB") : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{u.passingRent ? formatCurrency(u.passingRent) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{u.erv ? formatCurrency(u.erv) : u.askingRent ? <span title="Target rent">{formatCurrency(u.askingRent)}*</span> : "—"}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{fmtDate(u.leaseExpiry)}{u.breakDate ? ` / ${fmtDate(u.breakDate)}` : ""}</td>
                    <td className="px-3 py-2"><DealCell deal={u.deal} /></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No units match.</td></tr>}
              </tbody>
            </table>
          </div>
          {/* Phone cards */}
          <div className="md:hidden space-y-2">
            {rows.map(u => (
              <Link key={u.id} href={`/landsec/unit/${u.id}`} className="block rounded-lg border p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{u.unit || "—"}</span>
                  <StatusPill status={u.status} vacant={u.vacant} />
                </div>
                <p className="text-sm text-muted-foreground truncate">{u.tenant || (u.targetTenants ? `Target: ${u.targetTenants}` : u.use || "")}</p>
                <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
                  <span>{u.passingRent ? formatCurrency(u.passingRent) : u.erv ? `ERV ${formatCurrency(u.erv)}` : ""}</span>
                  <DealCell deal={u.deal} />
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BriefTag({ brief }: { brief: SchemeUnit["brief"] }) {
  const cls = brief === "agreed" ? "border-emerald-600/60 text-emerald-700 dark:text-emerald-400" : brief === "drafted" ? "border-amber-500/60 text-amber-700 dark:text-amber-400" : "border-border text-muted-foreground";
  return <span className={`mt-0.5 inline-flex whitespace-nowrap rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${cls}`}>{brief === "agreed" ? "Brief agreed" : brief === "drafted" ? "Brief unsigned" : "No brief"}</span>;
}

export function StatusPill({ status, vacant }: { status: string | null; vacant: boolean }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide ${vacant ? "border-amber-500/50 text-amber-700 dark:text-amber-400" : "border-border text-muted-foreground"}`}>
      {status || "—"}
    </span>
  );
}

function DealCell({ deal }: { deal: SchemeUnit["deal"] }) {
  if (!deal) return <span className="text-muted-foreground">—</span>;
  const label = deal.code ? DEAL_STATUS_LABELS[deal.code] : "Live";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="rounded-full bg-foreground text-background px-2 py-px font-semibold uppercase tracking-wide text-[10px]">{label}</span>
      {deal.tenant && <span className="truncate max-w-[10rem]">{deal.tenant}</span>}
      {deal.days !== null && <span className="flex items-center gap-0.5 text-muted-foreground tabular-nums"><Clock className="w-3 h-3" />{deal.days}d</span>}
    </span>
  );
}
