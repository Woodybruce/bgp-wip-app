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
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
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
  // Line (cumulative race by month) vs Bars (one bar per year) — Woody,
  // 2026-08-29: "make it choice of line chart or bar chart". Sticks per
  // device.
  const [chartKind, setChartKind] = useState<"line" | "bar">(() => {
    try { return localStorage.getItem("finance:hist-chart-kind") === "bar" ? "bar" : "line"; } catch { return "line"; }
  });
  const pickChartKind = (k: "line" | "bar") => {
    setChartKind(k);
    try { localStorage.setItem("finance:hist-chart-kind", k); } catch { /* private mode */ }
  };

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
  // Same cache entry the Finance page's headline cards use — the fallback
  // when the cashflow snapshot's own Xero pull fails (a server restart or a
  // rate-limited pull briefly nulls it, and the whole "so far" group used
  // to vanish from the chart — Woody hit this 2026-08-29 12:35).
  const { data: fin } = useQuery<any>({
    queryKey: ["/api/xero/financials"],
    staleTime: 5 * 60 * 1000,
  });
  const effectiveCashflow = useMemo<CashflowData | undefined>(() => {
    if (!cashflow || cashflow.xero || !fin || fin.notConnected || !fin.headline) return cashflow;
    return {
      ...cashflow,
      xero: {
        cashTotal: fin.cashTotal ?? null,
        fytdIncome: fin.headline.income,
        fytdExpenses: fin.headline.operatingExpenses,
        bankAccounts: fin.bankAccounts || [],
        monthly: fin.monthly || [],
      },
    };
  }, [cashflow, fin]);
  const ytd = effectiveCashflow?.xero?.fytdIncome ?? null;
  const now = new Date();
  const curFy = now.getUTCMonth() >= 4 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  // Cumulative race chart (Woody, 2026-08-29: "track how each billing year
  // looks year to date as well as future — the bottom run should be the
  // months in each year"). fm 1 = May in the source data. The forecast
  // continuation comes from the outlook's per-month income, so its April
  // endpoint IS the Income — projected year tile.
  const monthsElapsed = ((now.getUTCMonth() - 4 + 12) % 12) + 1;
  const outlook = useMemo(() => buildCompanyOutlook(effectiveCashflow, data as any), [effectiveCashflow, data]);

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
  // One cumulative line per year, May → April. Recent full years dashed
  // grey; this year solid green to today, then dashed green forecast out to
  // April. fc starts at today's billed figure, so the first forecast step
  // includes the rest of the current month.
  const FM_LABELS = ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
  const lineFys = data.fys.slice(-3);
  const nowIdx = monthsElapsed - 1;
  const outlookCum: number[] = [];
  if (outlook) {
    let c = 0;
    for (const om of outlook.months.slice(0, 12)) { c += om.income; outlookCum.push(Math.round(c)); }
  }
  const haveCur = ytd != null && ytd > 0 && outlookCum.length === 12;
  const chartData = FM_LABELS.map((m, i) => {
    const row: Record<string, number | string> = { m };
    for (const y of lineFys) {
      const arr = data.monthly[y];
      if (arr) row[`fy${y}`] = Math.round(arr.slice(0, i + 1).reduce((s, v) => s + v, 0));
    }
    if (haveCur) {
      if (i < nowIdx) row.cur = Math.min(outlookCum[i], Math.round(ytd!));
      if (i === nowIdx) { row.cur = Math.round(ytd!); row.fc = Math.round(ytd!); }
      if (i > nowIdx) row.fc = outlookCum[i];
    }
    return row;
  });
  // Distinct hues per year — the grey shades were indistinguishable at
  // bar width on a phone (Woody, 2026-08-29).
  const HIST_STROKES = ["#60a5fa", "#f59e0b", "#334155"];

  // Bar mode: the same months-along-the-bottom view as the line chart
  // (Woody, 2026-08-29: "Months!!! not the years — need each year's
  // months"), but as raw monthly billings — grey bars per recent year,
  // green for this year's months, light green for the forecast months.
  const barData: Array<Record<string, number | string>> = FM_LABELS.map((m, i) => {
    const row: Record<string, number | string> = { m };
    for (const y of lineFys) {
      const arr = data.monthly[y];
      if (arr) row[`fy${y}`] = Math.round(arr[i] || 0);
    }
    if (haveCur && outlook) {
      const inc = Math.round(outlook.months[i]?.income || 0);
      if (i <= nowIdx) row.cur = inc;
      else row.fc = inc;
    }
    return row;
  });
  // Final "YTD" group — each year's May-to-now total next to this year's,
  // the like-for-like comparison (Woody, 2026-08-29: "a total year to date
  // one too, maybe at the end, so can compare").
  {
    const ytdRow: Record<string, number | string> = { m: "YTD" };
    for (const y of lineFys) {
      const arr = data.monthly[y];
      if (arr) ytdRow[`fy${y}`] = Math.round(arr.slice(0, monthsElapsed).reduce((s, v) => s + v, 0));
    }
    if (haveCur) ytdRow.cur = Math.round(ytd!);
    barData.push(ytdRow);
  }

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

        <div className="flex items-center gap-1.5">
          <Pill active={chartKind === "line"} onClick={() => pickChartKind("line")} data-testid="hist-chart-line">Line</Pill>
          <Pill active={chartKind === "bar"} onClick={() => pickChartKind("bar")} data-testid="hist-chart-bar">Bars</Pill>
        </div>

        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            {chartKind === "line" ? (
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" opacity={0.1} />
                <XAxis dataKey="m" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v: number) => `£${(v / 1_000_000).toFixed(1)}m`} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
                <Tooltip formatter={(v: any, name: any) => [`£${fmt(Number(v))}`, name]} />
                {lineFys.map((y, i) => (
                  <Line key={y} type="monotone" dataKey={`fy${y}`} name={fyLabel(y)} stroke={HIST_STROKES[i] || "#a8a29e"} strokeWidth={1.25} strokeDasharray="4 4" dot={false} />
                ))}
                <Line type="monotone" dataKey="cur" name={`${fyLabel(curFy)} so far`} stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="fc" name="Forecast" stroke="#10b981" strokeWidth={2} strokeDasharray="5 4" dot={false} opacity={0.7} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </LineChart>
            ) : (
              <BarChart data={barData} barGap={0} barCategoryGap="20%" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" opacity={0.1} />
                <XAxis dataKey="m" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v: number) => `£${(v / 1_000_000).toFixed(1)}m`} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
                <Tooltip formatter={(v: any, name: any) => [`£${fmt(Number(v))}`, name]} />
                {lineFys.map((y, i) => (
                  <Bar key={y} dataKey={`fy${y}`} name={fyLabel(y)} fill={HIST_STROKES[i] || "#a8a29e"} radius={[2, 2, 0, 0]} />
                ))}
                <Bar dataKey="cur" name={`${fyLabel(curFy)} so far`} stackId="cur" fill="#10b981" radius={[2, 2, 0, 0]} />
                <Bar dataKey="fc" name="Forecast" stackId="cur" fill="#6ee7b7" radius={[2, 2, 0, 0]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            )}
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
