// The Landsec deal clock (docs/landsec-pitch-plan.md, item 4): every live
// deal across the 14 schemes with its stage, days at that stage, who it is
// waiting on, what it depends on and its Net Effective Rent against the
// agreed brief — sorted so the deals stuck longest are at the top.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { Pill, PillCount } from "@/components/ui/pill";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LANDSEC_STUCK_DAYS, RESTRICTED_LANDSEC_ROLES } from "@shared/landsec";
import {
  StageChip, BriefCheck, DaysAtStage, NerFigure, WaitingLine, DependsOn, LANDSEC_CLOCK_KEY, STUCK_LABEL,
  isStuck, matchesClockFilter, clockCounts, clockSearchText, type ClockDeal, type ClockFeed,
} from "@/components/landsec/deal-clock";

export default function LandsecDeals() {
  const { data, isLoading, error } = useQuery<ClockFeed>({ queryKey: LANDSEC_CLOCK_KEY, staleTime: 60 * 1000 });
  // An asset manager or joint agent login has no deal page (it carries
  // BGP's fee): their deals open on the unit. A joint agent has their own
  // tracker for their schemes; an asset manager has none.
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const landsecRole = String(me?.landsecRole || "");
  const restricted = (RESTRICTED_LANDSEC_ROLES as string[]).includes(landsecRole);
  const trackerHref = landsecRole === "joint_agent" ? "/landsec/tracker" : restricted ? null : "/deals/letting";
  const [party, setParty] = useState<string | "all" | "stuck" | "none">("all");
  const [search, setSearch] = useState("");

  // Stuck and "no one named" count deals in negotiation, HOTs or solicitors
  // only: a unit still at Marketing is a void, not a stuck deal.
  const counts = useMemo(() => {
    const d = data?.deals || [];
    return { all: d.length, ...clockCounts(d) };
  }, [data]);

  const rows = useMemo(() => {
    let d = (data?.deals || []).filter(x => matchesClockFilter(x, party));
    const q = search.trim().toLowerCase();
    if (q) d = d.filter(x => [x.name, x.tenant, x.unit, x.scheme?.name].some(v => (v || "").toLowerCase().includes(q)) || clockSearchText(x).includes(q));
    return d;
  }, [data, party, search]);

  if (error) return <div className="p-4 md:p-6"><p className="text-sm text-muted-foreground">The deal clock could not be loaded. {(error as any)?.message || ""}</p></div>;

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="landsec-deals">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Deals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data ? `${counts.all} live deals · ${counts.stuck} in negotiation at the same stage for ${LANDSEC_STUCK_DAYS}+ days · ${counts.none} in negotiation with no one named as waiting on` : "Every live deal, its stage, its clock and who it is waiting on"}
          </p>
        </div>
        {trackerHref && <Link href={trackerHref}><Button variant="outline" size="sm">{restricted ? "Tracker" : "Letting tracker"} <ChevronRight className="w-3 h-3 ml-1" /></Button></Link>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Pill active={party === "all"} onClick={() => setParty("all")}>All <PillCount n={counts.all} active={party === "all"} /></Pill>
        <Pill active={party === "stuck"} onClick={() => setParty("stuck")} data-testid="landsec-deals-stuck">{STUCK_LABEL} <PillCount n={counts.stuck} active={party === "stuck"} /></Pill>
        {counts.parties.map(([p, n]) => (
          <Pill key={p} active={party === p} onClick={() => setParty(p)}>Waiting on {p} <PillCount n={n} active={party === p} /></Pill>
        ))}
        <Pill active={party === "none"} onClick={() => setParty("none")}>No one named <PillCount n={counts.none} active={party === "none"} /></Pill>
      </div>
      <Input placeholder="Search deal, tenant, unit, scheme or note…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-md" />

      {isLoading && <Skeleton className="h-64 rounded-lg" />}

      {data && (
        <>
          <div className="hidden md:block rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Deal</th>
                  <th className="text-left px-3 py-2 font-medium">Scheme · unit</th>
                  <th className="text-left px-3 py-2 font-medium">Stage</th>
                  <th className="text-right px-3 py-2 font-medium">Days</th>
                  <th className="text-left px-3 py-2 font-medium">Waiting on</th>
                  <th className="text-left px-3 py-2 font-medium">Depends on</th>
                  <th className="text-right px-3 py-2 font-medium">NER</th>
                  <th className="text-left px-3 py-2 font-medium">Brief</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(d => <DealRow key={d.id} d={d} restricted={restricted} />)}
                {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No deals match.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-2">
            {rows.map(d => {
              const card = (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{d.tenant || d.name}</span>
                    <StageChip code={d.code} days={d.days} />
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{d.scheme?.name}{d.unit ? ` · ${d.unit}` : ""}</p>
                  <WaitingLine clock={d.clock} waitingDays={d.waitingDays} />
                </>
              );
              const href = d.unitId ? `/landsec/unit/${d.unitId}` : restricted ? null : `/deals/${d.id}`;
              return href
                ? <Link key={d.id} href={href} className="block rounded-lg border p-3 space-y-1">{card}</Link>
                : <div key={d.id} className="rounded-lg border p-3 space-y-1">{card}</div>;
            })}
          </div>
        </>
      )}
    </div>
  );
}

function DealRow({ d, restricted }: { d: ClockDeal; restricted: boolean }) {
  const stuck = isStuck(d);
  const dealHref = restricted ? (d.unitId ? `/landsec/unit/${d.unitId}` : null) : `/deals/${d.id}`;
  return (
    <tr className={`border-t hover:bg-muted/30 ${stuck ? "bg-amber-500/5" : ""}`} data-testid={`landsec-deal-${d.id}`}>
      <td className="px-3 py-2">
        {dealHref ? <Link href={dealHref} className="font-medium hover:underline">{d.tenant || d.name}</Link> : <span className="font-medium">{d.tenant || d.name}</span>}
        <span className="block text-[11px] text-muted-foreground">{d.ref ? `#${d.ref} · ` : ""}{d.dealType || ""}{d.jointAgent ? ` · joint: ${d.jointAgent}` : ""}</span>
      </td>
      <td className="px-3 py-2">
        {d.scheme ? <Link href={`/landsec/scheme/${d.scheme.key}`} className="hover:underline">{d.scheme.name}</Link> : "—"}
        {d.unit && <span className="block text-[11px]">{d.unitId ? <Link href={`/landsec/unit/${d.unitId}`} className="hover:underline">{d.unit}</Link> : d.unit}</span>}
      </td>
      <td className="px-3 py-2"><StageChip code={d.code} /></td>
      <td className="px-3 py-2 text-right text-xs">{d.days != null ? <DaysAtStage code={d.code} days={d.days} /> : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-3 py-2"><WaitingLine clock={d.clock} waitingDays={d.waitingDays} /></td>
      <td className="px-3 py-2 text-xs">{d.clock?.dependsOn || d.clock?.dependsOnHidden ? <DependsOn clock={d.clock} linkDeals={!restricted} /> : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-3 py-2 text-right"><NerFigure ner={d.ner} incentivesRecorded={d.incentivesRecorded} /></td>
      <td className="px-3 py-2"><BriefCheck brief={d.brief} check={d.briefCheck} /></td>
    </tr>
  );
}
