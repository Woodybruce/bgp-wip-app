// Cashflow forecast section on the Finance page (v3 — Woody, 2026-08-27:
// one finance page, no password; Xero + the app are the receipts source of
// truth; Wendy's workbook lines are costs only; a single manual LEGACY line
// carries the pre-Xero (Sage-era) receivables — Wendy's cashflow yellow
// cell, £263,604 inc VAT = £219,670 ex VAT budgeted Nov 2026 (Woody,
// 2026-08-28 evening: "the number is in Wendy's sheet"); editable in
// place if it moves, and it also feeds the Debtors card on the Finance
// page. Everything on the board is ex VAT — Woody, 2026-08-27: "we
// don't want to see VAT").
// Receipts rows are read-only app data; the LEGACY line and the cost lines
// are editable in place. The balance chain anchors on Xero's live cash.
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollableTable } from "@/components/scrollable-table";
import { queryClient } from "@/lib/queryClient";
import {
  type CashflowData, buildCashflowModel, buildUnifiedForecast, cashflowFetch,
  CASHFLOW_MONTH_LABEL as ML, fmtCashflow as fmt,
} from "@/lib/cashflow-model";
import { useToast } from "@/hooks/use-toast";
import { Banknote, ChevronDown, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";

export function CashflowBoardSection() {
  const { toast } = useToast();
  const [addingLine, setAddingLine] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [editCell, setEditCell] = useState<{ lineId: string; month: string; basis: "budget" | "actual" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [mobileMonthIdx, setMobileMonthIdx] = useState<number | null>(null);
  // Minimise the whole board (Woody, 2026-08-28: it's a long scroll on the
  // phone) — remembered per device.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("finance:cashflow-collapsed") === "1"; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed(c => {
      try { localStorage.setItem("finance:cashflow-collapsed", c ? "0" : "1"); } catch { /* private mode */ }
      return !c;
    });
  };

  const { data, isLoading } = useQuery<CashflowData>({
    queryKey: ["/api/cashflow"],
    queryFn: async () => (await cashflowFetch("GET", "/api/cashflow")).json(),
  });

  const saveCell = useMutation({
    mutationFn: async (p: { lineId: string; month: string; basis: string; amount: number | null }) =>
      (await cashflowFetch("PATCH", "/api/cashflow/cell", p)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/cashflow"] }),
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  const addLine = useMutation({
    mutationFn: async (label: string) =>
      (await cashflowFetch("POST", "/api/cashflow/line", { label, section: "payments" })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/cashflow"] }); setAddingLine(false); setNewLabel(""); },
    onError: (e: any) => toast({ title: "Couldn't add line", description: e?.message, variant: "destructive" }),
  });
  const removeLine = useMutation({
    mutationFn: async (id: string) => { await cashflowFetch("DELETE", `/api/cashflow/line/${id}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/cashflow"] }),
  });

  const model = useMemo(() => (data ? buildCashflowModel(data) : null), [data]);
  const unified = useMemo(() => (data && model ? buildUnifiedForecast(data, model) : null), [data, model]);
  const legacyLine = model?.receipts.find(l => l.key === "LEGACY") || null;

  const chartData = useMemo(() => {
    if (!unified) return [];
    return unified.months.map(m => ({ month: ML(m), Close: unified.byMonth[m].close }));
  }, [unified]);

  const startEdit = (lineId: string, month: string, basis: "budget" | "actual", current: number | undefined) => {
    setEditCell({ lineId, month, basis });
    setEditValue(current === undefined ? "" : String(current));
  };
  const commitEdit = () => {
    if (!editCell) return;
    const trimmed = editValue.trim().replace(/,/g, "");
    const amount = trimmed === "" ? null : Number(trimmed);
    if (trimmed !== "" && !Number.isFinite(amount)) { setEditCell(null); return; }
    saveCell.mutate({ ...editCell, amount });
    setEditCell(null);
  };
  const editInput = (
    <Input
      autoFocus
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      onBlur={commitEdit}
      onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
      className="h-6 w-24 px-1 text-right text-xs font-mono inline-block"
    />
  );
  const isEditing = (lineId: string, month: string, basis: string) =>
    !!editCell && editCell.lineId === lineId && editCell.month === month && editCell.basis === basis;
  const cellTd = (lineId: string, month: string, basis: "budget" | "actual") => {
    const v = model!.get(lineId, month, basis);
    return (
      <td
        key={`${month}-${basis}`}
        className={`px-2 py-1 text-right font-mono tabular-nums cursor-pointer hover:bg-muted/60 ${basis === "actual" ? "border-r" : ""} ${v !== undefined && v < 0 ? "text-red-700 dark:text-red-400" : ""}`}
        onClick={() => !isEditing(lineId, month, basis) && startEdit(lineId, month, basis, v)}
        data-testid={`cf-cell-${lineId}-${month}-${basis}`}
      >
        {isEditing(lineId, month, basis) ? editInput : fmt(v)}
      </td>
    );
  };
  const appRow = (label: string, valueFor: (m: string) => number | undefined, testid: string) => (
    <tr className="text-violet-700 dark:text-violet-400" data-testid={testid}>
      <td className="px-3 py-1 sticky left-0 bg-card z-10 whitespace-nowrap">{label}</td>
      {unified!.months.map(m => {
        const v = valueFor(m);
        return <td key={m} colSpan={2} className="px-2 py-1 text-right font-mono tabular-nums border-r">{v ? fmt(Math.round(v)) : ""}</td>;
      })}
    </tr>
  );
  const chainRow = (label: string, pick: (m: string) => number, testid: string, strong = true) => (
    <tr className={`${strong ? "bg-muted/50 font-semibold" : ""} border-t`} data-testid={testid}>
      <td className="px-3 py-1.5 sticky left-0 bg-muted/50 backdrop-blur z-10">{label}</td>
      {unified!.months.map(m => (
        <td key={m} colSpan={2} className={`px-2 py-1.5 text-right font-mono tabular-nums border-r ${pick(m) < 0 ? "text-red-700 dark:text-red-400" : ""}`}>{fmt(pick(m))}</td>
      ))}
    </tr>
  );

  if (isLoading || !model || !unified) {
    return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>;
  }

  const mobileIdx = Math.min(mobileMonthIdx ?? 0, unified.months.length - 1);
  const mobileMonth = unified.months[mobileIdx];

  return (
    <Card data-testid="finance-cashflow-section">
      <CardHeader className="pb-2 cursor-pointer" onClick={toggleCollapsed} data-testid="cf-collapse-toggle" aria-expanded={!collapsed}>
        <CardTitle className="text-sm flex items-center gap-2">
          <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
          <Banknote className="w-4 h-4" /> Cashflow forecast
          {collapsed && (
            <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
              Cash now £{fmt(unified.anchor.value)} · low {unified.low.close < 0 ? "-" : ""}£{fmt(Math.abs(unified.low.close))} ({ML(unified.low.month)})
            </span>
          )}
        </CardTitle>
        {!collapsed && (
          <p className="text-xs text-muted-foreground">
            All figures ex VAT. Cash in comes from the app — pipeline-weighted deal fees and Xero invoices due — plus the legacy pre-Xero (Sage-era) receivables from Wendy's cashflow (£219,670 ex VAT, November) — editable on the Legacy line below if that moves; it also feeds the Debtors card above.
            Cash out is the costs plan below (Wendy's forecast). The chain starts from {unified.anchor.source === "xero" ? "Xero's live cash at bank" : "the typed opening balance (Xero not connected)"}. Tap the header to minimise.
          </p>
        )}
      </CardHeader>
      {!collapsed && (
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MiniStat label={`Cash now (${unified.anchor.source === "xero" ? "Xero" : "typed"})`} value={unified.anchor.value} />
          <MiniStat label="Close · this month" value={unified.current?.close ?? null} />
          <MiniStat label={`Low point · ${ML(unified.low.month)}`} value={unified.low.close} />
          <MiniStat label={`Close · ${ML(unified.months[unified.months.length - 1])}`} value={unified.byMonth[unified.months[unified.months.length - 1]].close} />
        </div>

        <div className="h-44 sm:h-52">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `£${Math.round(v / 1000)}k`} width={52} />
              <Tooltip formatter={(v: any) => `£${Number(v).toLocaleString("en-GB")}`} />
              <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="Close" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2.5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Phone: one month at a time */}
        <div className="md:hidden space-y-3" data-testid="cf-mobile">
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" className="h-9 w-9 p-0" disabled={mobileIdx === 0} onClick={() => setMobileMonthIdx(mobileIdx - 1)} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-sm font-semibold" data-testid="cf-mobile-month">{ML(mobileMonth)}</span>
            <Button variant="outline" size="sm" className="h-9 w-9 p-0" disabled={mobileIdx === unified.months.length - 1} onClick={() => setMobileMonthIdx(mobileIdx + 1)} aria-label="Next month"><ChevronRight className="w-4 h-4" /></Button>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border rounded-lg p-3">
            {([
              ["Opening", unified.byMonth[mobileMonth].open],
              ["Deals (weighted)", unified.byMonth[mobileMonth].dealsIn],
              ["Xero AR due", unified.byMonth[mobileMonth].arIn],
              ["Legacy receivables", unified.byMonth[mobileMonth].legacyIn],
              ["Costs", unified.byMonth[mobileMonth].out],
              ["Closing", unified.byMonth[mobileMonth].close],
            ] as Array<[string, number]>).map(([label, v]) => (
              <div key={label} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{label}</span>
                <span className={`font-mono tabular-nums ${v < 0 ? "text-red-700 dark:text-red-400" : ""}`}>{fmt(v)}</span>
              </div>
            ))}
          </div>
          <div className="border rounded-lg divide-y">
            <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-1 px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Costs</span><span className="text-right">Budget</span><span className="text-right">Actual</span>
            </div>
            {(legacyLine ? [legacyLine, ...model.payments] : model.payments).map(l => (
              <div key={l.id} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-1 px-3 py-1.5 text-xs" data-testid={`cf-m-line-${l.key}`}>
                <span className="truncate" title={l.label}>{l.key === "LEGACY" ? "Legacy receivables" : <><span className="text-muted-foreground mr-1">{l.key}</span>{l.label}</>}</span>
                {(["budget", "actual"] as const).map(basis => {
                  const v = model.get(l.id, mobileMonth, basis);
                  return (
                    <button key={basis} type="button" className={`text-right font-mono tabular-nums px-1 py-0.5 rounded active:bg-muted ${v !== undefined && v < 0 ? "text-red-700 dark:text-red-400" : ""}`} onClick={() => startEdit(l.id, mobileMonth, basis, v)}>
                      {isEditing(l.id, mobileMonth, basis) ? editInput : (fmt(v) || <span className="text-muted-foreground/50">·</span>)}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Desktop grid */}
        <div className="hidden md:block border rounded-lg overflow-hidden">
          <ScrollableTable minWidth={1100}>
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0 z-20">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground sticky left-0 bg-muted z-30 min-w-[220px]">Line</th>
                  {unified.months.map(m => (
                    <th key={m} colSpan={2} className="px-2 py-1 text-center font-medium text-muted-foreground border-l">{ML(m)}</th>
                  ))}
                </tr>
                <tr>
                  <th className="px-3 py-1 sticky left-0 bg-muted z-30" />
                  {unified.months.map(m => [
                    <th key={`${m}-b`} className="px-2 py-1 text-right font-normal text-[10px] uppercase tracking-wide text-muted-foreground border-l">Budget</th>,
                    <th key={`${m}-a`} className="px-2 py-1 text-right font-normal text-[10px] uppercase tracking-wide text-muted-foreground border-r">Actual</th>,
                  ])}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="bg-muted/30"><td colSpan={1 + unified.months.length * 2} className="px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground sticky left-0">Cash in — from the app</td></tr>
                {appRow(
                  `Deals pipeline, weighted${data?.deals?.undated.count ? ` (+£${fmt(data.deals.undated.weighted)} undated)` : ""}`,
                  m => data?.deals?.byMonth[m]?.weighted, "cf-app-deals")}
                {data?.xero && appRow("Xero invoices due (AR)", m => data.xero!.arByMonth?.[m], "cf-app-ar")}
                {legacyLine && (
                  <tr data-testid="cf-line-LEGACY">
                    <td className="px-3 py-1 sticky left-0 bg-card z-10 whitespace-nowrap" title={legacyLine.label}>Legacy receivables (pre-Xero, Sage era)</td>
                    {unified.months.map(m => [cellTd(legacyLine.id, m, "budget"), cellTd(legacyLine.id, m, "actual")])}
                  </tr>
                )}
                {chainRow("Total cash in", m => unified.byMonth[m].in, "cf-total-in")}

                <tr className="bg-muted/30"><td colSpan={1 + unified.months.length * 2} className="px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground sticky left-0">Costs — Wendy's plan</td></tr>
                {model.payments.map(l => (
                  <tr key={l.id} className="group" data-testid={`cf-line-${l.key}`}>
                    <td className="px-3 py-1 sticky left-0 bg-card z-10 whitespace-nowrap max-w-[320px] truncate" title={l.label}>
                      <span className="text-muted-foreground mr-1.5">{l.key}</span>{l.label}
                      <button type="button" className="ml-1.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-destructive align-middle" title="Remove line" aria-label={`Remove ${l.label}`} onClick={() => removeLine.mutate(l.id)}><X className="w-3 h-3 inline" /></button>
                    </td>
                    {unified.months.map(m => [cellTd(l.id, m, "budget"), cellTd(l.id, m, "actual")])}
                  </tr>
                ))}
                {chainRow("Total costs", m => unified.byMonth[m].out, "cf-total-out")}

                {chainRow("Opening", m => unified.byMonth[m].open, "cf-opening", false)}
                {chainRow("Closing", m => unified.byMonth[m].close, "cf-closing")}
              </tbody>
            </table>
          </ScrollableTable>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {addingLine ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newLabel.trim()) addLine.mutate(newLabel.trim()); if (e.key === "Escape") setAddingLine(false); }}
                placeholder="New cost line"
                className="h-8 w-64 text-xs"
                data-testid="cf-new-line-input"
              />
              <Button size="sm" className="h-8" disabled={!newLabel.trim() || addLine.isPending} onClick={() => addLine.mutate(newLabel.trim())}>Add</Button>
              <Button size="sm" variant="outline" className="h-8" onClick={() => setAddingLine(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => { setAddingLine(true); setNewLabel(""); }} data-testid="cf-add-cost"><Plus className="w-3.5 h-3.5" /> Cost line</Button>
          )}
          <span className="text-[11px] text-muted-foreground ml-auto">
            Deal fees weighted NEG 50% · SOL 75% · EXC 90% · completed-uninvoiced 100% — move a deal or raise an invoice and this updates itself.
          </span>
        </div>
      </CardContent>
      )}
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="border rounded-lg p-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold font-mono tabular-nums ${value != null && value < 0 ? "text-red-700 dark:text-red-400" : ""}`}>
        {value != null ? `£${fmt(Math.round(value))}` : "—"}
      </p>
    </div>
  );
}
