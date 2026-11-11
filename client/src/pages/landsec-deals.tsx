// The Landsec deal clock (docs/landsec-pitch-plan.md, item 4): every live
// deal across the 14 schemes with its stage, days at that stage, who it is
// waiting on, what it depends on and its Net Effective Rent against the
// agreed brief — sorted so the deals stuck longest are at the top.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Clock, ChevronRight } from "lucide-react";
import { Pill, PillCount } from "@/components/ui/pill";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { DEAL_STATUS_LABELS, type DealStatusCode } from "@shared/deal-status";
import type { LandsecDealClock, LandsecNer } from "@shared/landsec";

interface ClockDeal {
  id: string; ref: number | null; name: string; dealType: string | null; tenant: string | null; jointAgent: string | null;
  scheme: { key: string; name: string } | null; propertyId: string; unitId: string | null; unit: string | null;
  code: DealStatusCode | null; since: string | null; days: number | null; waitingDays: number | null;
  clock: LandsecDealClock | null; ner: LandsecNer | null; briefCheck: "pass" | "fail" | null; brief: "agreed" | "drafted" | null;
}
interface DealsData { deals: ClockDeal[]; parties: Record<string, number> }

const STUCK_DAYS = 30;

export default function LandsecDeals() {
  const { data, isLoading, error } = useQuery<DealsData>({ queryKey: ["/api/landsec/deals"], staleTime: 60 * 1000 });
  const [party, setParty] = useState<string | "all" | "stuck" | "none">("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const d = data?.deals || [];
    return { all: d.length, stuck: d.filter(x => (x.days ?? 0) >= STUCK_DAYS).length, none: d.filter(x => !x.clock?.waitingOnParty).length };
  }, [data]);

  const rows = useMemo(() => {
    let d = data?.deals || [];
    if (party === "stuck") d = d.filter(x => (x.days ?? 0) >= STUCK_DAYS);
    else if (party === "none") d = d.filter(x => !x.clock?.waitingOnParty);
    else if (party !== "all") d = d.filter(x => x.clock?.waitingOnParty === party);
    const q = search.trim().toLowerCase();
    if (q) d = d.filter(x => [x.name, x.tenant, x.unit, x.scheme?.name, x.clock?.waitingOnName, x.clock?.waitingNote].some(v => (v || "").toLowerCase().includes(q)));
    return d;
  }, [data, party, search]);

  if (error) return <div className="p-4 md:p-6"><p className="text-sm text-muted-foreground">The deal clock could not be loaded. {(error as any)?.message || ""}</p></div>;

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="landsec-deals">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lettings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data ? `${counts.all} live deals · ${counts.stuck} at the same stage for ${STUCK_DAYS}+ days · ${counts.none} with no one named as waiting on` : "Every live deal, its stage, its clock and who it is waiting on"}
          </p>
        </div>
        <Link href="/deals/letting"><Button variant="outline" size="sm">Letting tracker <ChevronRight className="w-3 h-3 ml-1" /></Button></Link>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Pill active={party === "all"} onClick={() => setParty("all")}>All <PillCount n={counts.all} active={party === "all"} /></Pill>
        <Pill active={party === "stuck"} onClick={() => setParty("stuck")} data-testid="landsec-deals-stuck">Stuck {STUCK_DAYS}d+ <PillCount n={counts.stuck} active={party === "stuck"} /></Pill>
        {Object.entries(data?.parties || {}).sort((a, b) => b[1] - a[1]).map(([p, n]) => (
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
                {rows.map(d => <DealRow key={d.id} d={d} />)}
                {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No deals match.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-2">
            {rows.map(d => (
              <Link key={d.id} href={d.unitId ? `/landsec/unit/${d.unitId}` : `/deals/${d.id}`} className="block rounded-lg border p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{d.tenant || d.name}</span>
                  <StageChip code={d.code} days={d.days} />
                </div>
                <p className="text-xs text-muted-foreground truncate">{d.scheme?.name}{d.unit ? ` · ${d.unit}` : ""}</p>
                <WaitingText d={d} />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DealRow({ d }: { d: ClockDeal }) {
  const stuck = (d.days ?? 0) >= STUCK_DAYS;
  return (
    <tr className={`border-t hover:bg-muted/30 ${stuck ? "bg-amber-500/5" : ""}`} data-testid={`landsec-deal-${d.id}`}>
      <td className="px-3 py-2">
        <Link href={`/deals/${d.id}`} className="font-medium hover:underline">{d.tenant || d.name}</Link>
        <span className="block text-[11px] text-muted-foreground">{d.ref ? `#${d.ref} · ` : ""}{d.dealType || ""}{d.jointAgent ? ` · joint: ${d.jointAgent}` : ""}</span>
      </td>
      <td className="px-3 py-2">
        {d.scheme ? <Link href={`/landsec/scheme/${d.scheme.key}`} className="hover:underline">{d.scheme.name}</Link> : "—"}
        {d.unit && <span className="block text-[11px]">{d.unitId ? <Link href={`/landsec/unit/${d.unitId}`} className="hover:underline">{d.unit}</Link> : d.unit}</span>}
      </td>
      <td className="px-3 py-2"><StageChip code={d.code} /></td>
      <td className={`px-3 py-2 text-right tabular-nums ${stuck ? "font-semibold" : ""}`}>{d.days ?? "—"}</td>
      <td className="px-3 py-2"><WaitingText d={d} /></td>
      <td className="px-3 py-2 text-xs">{d.clock?.dependsOn ? <Link href={`/deals/${d.clock.dependsOn.id}`} className="hover:underline">{d.clock.dependsOn.unit || d.clock.dependsOn.name}{d.clock.dependsOn.ref ? ` #${d.clock.dependsOn.ref}` : ""}</Link> : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {d.ner ? <span title={`${formatCurrency(d.ner.headlinePa)} headline · ${d.ner.termCertainYears} yr term certain${d.ner.assumedTerm ? " (assumed)" : ""} · ${d.ner.rentFreeMonths} mo rent free · ${formatCurrency(d.ner.capital)} capital`}>{formatCurrency(d.ner.nerPa)}</span> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2"><BriefCheck brief={d.brief} check={d.briefCheck} /></td>
    </tr>
  );
}

export function StageChip({ code, days }: { code: DealStatusCode | null; days?: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="rounded-full bg-foreground text-background px-2 py-px font-semibold uppercase tracking-wide text-[10px] whitespace-nowrap">{code ? DEAL_STATUS_LABELS[code] : "Live"}</span>
      {days != null && <span className="flex items-center gap-0.5 text-muted-foreground tabular-nums"><Clock className="w-3 h-3" />{days}d</span>}
    </span>
  );
}

function WaitingText({ d }: { d: ClockDeal }) {
  const c = d.clock;
  if (!c?.waitingOnParty) return <span className="text-xs text-muted-foreground italic">No one named</span>;
  return (
    <span className="text-xs">
      <span className="font-medium">{c.waitingOnParty}</span>{c.waitingOnName ? ` · ${c.waitingOnName}` : ""}
      {d.waitingDays != null && <span className="text-muted-foreground tabular-nums"> · {d.waitingDays}d</span>}
      {c.waitingNote && <span className="block text-muted-foreground truncate max-w-[16rem]">{c.waitingNote}</span>}
    </span>
  );
}

export function BriefCheck({ brief, check }: { brief: "agreed" | "drafted" | null; check: "pass" | "fail" | null }) {
  if (check === "fail") return <span className="rounded-full border border-red-600/60 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400 whitespace-nowrap">Below NER floor</span>;
  if (check === "pass") return <span className="rounded-full border border-emerald-600/60 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 whitespace-nowrap">Meets floor</span>;
  if (brief === "agreed") return <span className="rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Agreed · no floor</span>;
  return <span className="text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">{brief === "drafted" ? "Brief unsigned" : "No brief"}</span>;
}
