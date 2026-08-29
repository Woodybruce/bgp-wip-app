// Historical billings (Sage era) on the Finance page — Woody, 2026-08-27:
// "This is the old WIP, we want to be able to see how we were doing against
// the year before under team, company, agent and client." Read-only pivot of
// the invoiced-WIP history (FY2019–FY2026, May–April fiscal years, ex VAT),
// served pre-aggregated by /api/historical-wip. Client = the landlord group
// (Land Sec, Hammerson…); Company = the occupier brand the deal was done with.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollableTable } from "@/components/scrollable-table";
import { Pill } from "@/components/ui/pill";
import { type CashflowData, cashflowFetch, fmtCashflow as fmt } from "@/lib/cashflow-model";
import { buildCompanyOutlook } from "@/lib/outlook-model";
import { History } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend,
} from "recharts";

interface DimEntry { name: string; totals: Record<number, number> }
interface HistData {
  source: string; note: string; fys: number[];
  fyTotals: Record<number, number>;
  monthly: Record<number, number[]>;
  dims: { team: DimEntry[]; agent: DimEntry[]; client: DimEntry[]; company: DimEntry[] };
}

const DIMENSIONS = [
  { key: "team" as const, label: "Team" },
  { key: "client" as const, label: "Client" },
  { key: "agent" as const, label: "Agent" },
  { key: "company" as const, label: "Company" },
];

const fyLabel = (fy: number) => `FY${String(fy).slice(2)}`;

function deltaPct(cur: number, prev: number): string {
  if (!prev) return "—";
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

export function HistoricalBillingsSection() {
  const [dim, setDim] = useState<(typeof DIMENSIONS)[number]["key"]>("team");
  const [fy, setFy] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading } = useQuery<HistData>({
    queryKey: ["/api/historical-wip"],
    queryFn: async () => (await cashflowFetch("GET", "/api/historical-wip")).json(),
    staleTime: 60 * 60 * 1000,
  });
  // This year so far, from Xero — overlaid on the historic years so the
  // current pace reads against every full year (Woody, 2026-08-29).
  const { data: cashflow } = useQuery<CashflowData>({
    queryKey: ["/api/cashflow"],
    queryFn: async () => (await cashflowFetch("GET", "/api/cashflow")).json(),
    staleTime: 5 * 60 * 1000,
  });
  const ytd = cashflow?.xero?.fytdIncome ?? null;
  const now = new Date();
  const curFy = now.getUTCMonth() >= 4 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  // Same-point comparison (Woody, 2026-08-29: "the this year difference not
  // working?") — the last full year's billings through the same fiscal
  // month, so the YTD bar reads against a like-for-like number, not twelve
  // months. fm 1 = May in the source data.
  const monthsElapsed = ((now.getUTCMonth() - 4 + 12) % 12) + 1;
  const lastHistFy = data?.fys?.length ? data.fys[data.fys.length - 1] : null;
  const samePoint = lastHistFy != null && data?.monthly?.[lastHistFy]
    ? data.monthly[lastHistFy].slice(0, monthsElapsed).reduce((s, v) => s + v, 0)
    : null;
  // Forecast billing stacked on the YTD bar (Woody, 2026-08-29: "can you
  // include forecast billing?") — the outlook's projected-year income
  // (billed + weighted deal book + legacy Sage), same figure as the
  // Income — projected year tile above.
  const outlook = useMemo(() => buildCompanyOutlook(cashflow, data as any), [cashflow, data]);
  const forecastRemainder = outlook && ytd != null
    ? Math.max(0, Math.round(outlook.income.projectedFy - ytd))
    : null;

  const selFy = fy ?? (data ? data.fys[data.fys.length - 1] : null);
  const prevFy = selFy != null ? selFy - 1 : null;

  const rows = useMemo(() => {
    if (!data || selFy == null) return [];
    const q = search.trim().toLowerCase();
    return data.dims[dim]
      .map((e) => ({ name: e.name, cur: e.totals[selFy] || 0, prev: e.totals[prevFy!] || 0 }))
      .filter((r) => r.cur !== 0 || r.prev !== 0)
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => b.cur - a.cur);
  }, [data, dim, selFy, prevFy, search]);

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (!data) return null;

  const curTotal = data.fyTotals[selFy!] || 0;
  const prevTotal = data.fyTotals[prevFy!] || 0;
  const visible = showAll ? rows : rows.slice(0, 25);
  const chartData: Array<{ name: string; total?: number; ytd?: number; prior?: number; forecast?: number }> =
    data.fys.map((y) => ({ name: fyLabel(y), total: Math.round(data.fyTotals[y] || 0) }));
  if (ytd != null && ytd > 0) chartData.push({
    name: `${fyLabel(curFy)} so far`,
    ytd: Math.round(ytd),
    ...(samePoint != null && samePoint > 0 ? { prior: Math.round(samePoint) } : {}),
    ...(forecastRemainder != null && forecastRemainder > 0 ? { forecast: forecastRemainder } : {}),
  });

  return (
    <Card className="border rounded-xl" data-testid="historical-billings">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="w-4 h-4" />
          Historical billings
          <span className="ml-auto text-[11px] font-normal text-muted-foreground">ex VAT</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center flex-wrap gap-1.5">
            {DIMENSIONS.map((d) => (
              <Pill key={d.key} active={dim === d.key} onClick={() => { setDim(d.key); setShowAll(false); setSearch(""); }} data-testid={`hist-dim-${d.key}`}>
                {d.label}
              </Pill>
            ))}
          </div>
          <div className="flex items-center flex-wrap gap-1.5">
            {data.fys.map((y) => (
              <Pill key={y} active={selFy === y} onClick={() => { setFy(y); setShowAll(false); }} data-testid={`hist-fy-${y}`}>
                {fyLabel(y)}
              </Pill>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="border rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{fyLabel(selFy!)} billed</p>
            <p className="text-lg font-semibold tabular-nums">£{fmt(curTotal)}</p>
          </div>
          <div className="border rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{prevFy && data.fyTotals[prevFy] != null ? `${fyLabel(prevFy)} billed` : "Year before"}</p>
            <p className="text-lg font-semibold tabular-nums">{prevTotal ? `£${fmt(prevTotal)}` : "—"}</p>
          </div>
          <div className="border rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Change</p>
            <p className={`text-lg font-semibold tabular-nums ${curTotal >= prevTotal ? "text-emerald-600" : "text-red-600"}`}>{deltaPct(curTotal, prevTotal)}</p>
          </div>
          <div className="border rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">All years</p>
            <p className="text-lg font-semibold tabular-nums">£{fmt(data.fys.reduce((s, y) => s + (data.fyTotals[y] || 0), 0))}</p>
          </div>
        </div>

        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" opacity={0.1} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v: number) => `£${(v / 1_000_000).toFixed(1)}m`} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip formatter={(v: any, name: any) => [`£${fmt(Number(v))}`, name]} />
              {ytd != null && ytd > 0 && (
                <ReferenceLine y={Math.round(ytd)} stroke="#10b981" strokeDasharray="4 4" ifOverflow="extendDomain" />
              )}
              <Bar dataKey="total" name="Billed" fill="#b45309" radius={[3, 3, 0, 0]} />
              <Bar dataKey="prior" name={lastHistFy != null ? `${fyLabel(lastHistFy)} by this point` : "Last year by this point"} fill="#a8a29e" radius={[3, 3, 0, 0]} />
              <Bar dataKey="ytd" name="This year so far" stackId="cur" fill="#10b981" />
              <Bar dataKey="forecast" name="Forecast billing to come" stackId="cur" fill="#6ee7b7" radius={[3, 3, 0, 0]} />
              {ytd != null && ytd > 0 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {(dim === "client" || dim === "company") && (
          <Input
            className="h-8 text-xs max-w-xs"
            placeholder={`Search ${dim === "client" ? "clients" : "companies"}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="hist-search"
          />
        )}

        {/* Phone: card list — the same fix as the Equity partners table,
            whose name column scrolled off-left inside a min-width table. */}
        <div className="md:hidden space-y-1.5" data-testid="hist-mobile">
          {visible.map((r) => (
            <div key={r.name} className="border rounded-xl p-3" data-testid={`hist-card-${r.name}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-medium min-w-0">{r.name}</p>
                <p className="text-sm font-semibold tabular-nums shrink-0">{r.cur ? `£${fmt(r.cur)}` : "—"}</p>
              </div>
              <div className="flex items-center justify-between gap-3 mt-1 text-[11px] text-muted-foreground tabular-nums">
                <span>{prevFy ? fyLabel(prevFy) : "Prior"} {r.prev ? `£${fmt(r.prev)}` : "—"}</span>
                <span className={r.prev && r.cur >= r.prev ? "text-emerald-600" : r.prev ? "text-red-600" : ""}>{deltaPct(r.cur, r.prev)}</span>
                <span>{curTotal && r.cur ? `${((r.cur / curTotal) * 100).toFixed(1)}% share` : "—"}</span>
              </div>
            </div>
          ))}
          {visible.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">Nothing billed under this lens in {fyLabel(selFy!)}{search ? " matching that search" : ""}.</p>
          )}
        </div>

        <div className="hidden md:block">
        <ScrollableTable minWidth={560}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b">
                <th className="text-left py-1.5 pr-3 font-medium">{DIMENSIONS.find((d) => d.key === dim)!.label}</th>
                <th className="text-right py-1.5 px-3 font-medium tabular-nums">{fyLabel(selFy!)}</th>
                <th className="text-right py-1.5 px-3 font-medium tabular-nums">{prevFy ? fyLabel(prevFy) : "Prior"}</th>
                <th className="text-right py-1.5 px-3 font-medium">vs year before</th>
                <th className="text-right py-1.5 pl-3 font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.name} className="border-b border-dashed last:border-0" data-testid={`hist-row-${r.name}`}>
                  <td className="py-1.5 pr-3 max-w-[260px] truncate" title={r.name}>{r.name}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{r.cur ? `£${fmt(r.cur)}` : "—"}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{r.prev ? `£${fmt(r.prev)}` : "—"}</td>
                  <td className={`py-1.5 px-3 text-right tabular-nums ${r.prev && r.cur >= r.prev ? "text-emerald-600" : r.prev ? "text-red-600" : "text-muted-foreground"}`}>{deltaPct(r.cur, r.prev)}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">{curTotal && r.cur ? `${((r.cur / curTotal) * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">Nothing billed under this lens in {fyLabel(selFy!)}{search ? " matching that search" : ""}.</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableTable>
        </div>
        {rows.length > 25 && !showAll && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAll(true)} data-testid="hist-show-all">
            Show all {rows.length}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
