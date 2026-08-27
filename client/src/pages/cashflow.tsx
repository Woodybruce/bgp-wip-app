// Cashflow board (Woody, 2026-08-27) — monthly Budget vs Actual cash flow,
// seeded from the 2026/27 forecast workbook and edited in place. Sits
// behind a password on top of the equity gate (like the source workbook);
// cross-references Xero (cash at bank + monthly income/expenses); phones
// get a one-month-at-a-time layout instead of the 21-column grid.
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollableTable } from "@/components/scrollable-table";
import { queryClient, getAuthHeaders } from "@/lib/queryClient";
import {
  type CashflowData, type CashflowModel, buildCashflowModel, buildLinkedProjection, cashflowFetch, CashflowLocked,
  getCashflowKey, setCashflowKey, CASHFLOW_MONTH_LABEL as ML, fmtCashflow as fmt, xeroLabelToMonth,
} from "@/lib/cashflow-model";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Banknote, ChevronLeft, ChevronRight, Lock, Plus, X } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
} from "recharts";

export default function CashflowPage() {
  const { toast } = useToast();
  const [addingTo, setAddingTo] = useState<"receipts" | "payments" | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [editCell, setEditCell] = useState<{ lineId: string; month: string; basis: "budget" | "actual" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);
  const [mobileMonthIdx, setMobileMonthIdx] = useState<number | null>(null);

  const { data, isLoading, error, refetch } = useQuery<CashflowData>({
    queryKey: ["/api/cashflow"],
    queryFn: async () => (await cashflowFetch("GET", "/api/cashflow")).json(),
    retry: (count, err) => !(err instanceof CashflowLocked) && count < 2,
  });
  const locked = error instanceof CashflowLocked;

  const unlock = useMutation({
    mutationFn: async (password: string) => {
      const res = await fetch("/api/cashflow/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ password }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("wrong");
      return password;
    },
    onSuccess: (password) => { setCashflowKey(password); setPwError(false); refetch(); },
    onError: () => setPwError(true),
  });

  const saveCell = useMutation({
    mutationFn: async (p: { lineId: string; month: string; basis: string; amount: number | null }) =>
      (await cashflowFetch("PATCH", "/api/cashflow/cell", p)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/cashflow"] }),
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  const addLine = useMutation({
    mutationFn: async (p: { label: string; section: string }) =>
      (await cashflowFetch("POST", "/api/cashflow/line", p)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/cashflow"] }); setAddingTo(null); setNewLabel(""); },
    onError: (e: any) => toast({ title: "Couldn't add line", description: e?.message, variant: "destructive" }),
  });
  const removeLine = useMutation({
    mutationFn: async (id: string) => { await cashflowFetch("DELETE", `/api/cashflow/line/${id}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/cashflow"] }),
  });

  const model = useMemo(() => (data ? buildCashflowModel(data) : null), [data]);
  const linked = useMemo(() => (data && model ? buildLinkedProjection(data, model) : null), [data, model]);

  const chartData = useMemo(() => {
    if (!model) return [];
    return model.months.map(m => {
      const row: Record<string, any> = { month: ML(m), Budget: Math.round(model.totals[m]?.budget?.close ?? 0) };
      if (model.hasActual(m)) row.Actual = Math.round(model.totals[m]?.actual?.close ?? 0);
      if (linked?.byMonth[m]) row["App-linked"] = linked.byMonth[m].close;
      return row;
    });
  }, [model, linked]);

  // Xero cross-reference: current cash vs the forecast, and monthly
  // income/expenses vs the forecast's receipts/payments (actual basis).
  const xeroCompare = useMemo(() => {
    const x = data?.xero;
    if (!x || !model) return null;
    const nowMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const t = model.totals[nowMonth];
    const forecastClose = t ? (model.hasActual(nowMonth) ? t.actual.close : t.budget.close) : null;
    const rows = (x.monthly || []).map(m => {
      const key = xeroLabelToMonth(m.month);
      if (!key || !model.totals[key]) return null;
      const basis = model.hasActual(key) ? "actual" as const : "budget" as const;
      return {
        month: key, label: ML(key), basis,
        xeroIn: m.income, xeroOut: -Math.abs(m.expenses),
        fcIn: model.totals[key][basis].rec, fcOut: model.totals[key][basis].pay,
      };
    }).filter(Boolean) as Array<{ month: string; label: string; basis: string; xeroIn: number; xeroOut: number; fcIn: number; fcOut: number }>;
    return { cashTotal: x.cashTotal, asAt: x.asAt, nowMonth, forecastClose, rows };
  }, [data?.xero, model]);

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

  // Read-only app-linked rows — one figure per month (no budget/actual
  // split), violet + italic so they can't be mistaken for typed forecast.
  const projRow = (label: string, valueFor: (m: string) => number | undefined, testid: string) => (
    <tr className="text-violet-700 dark:text-violet-400 italic" data-testid={testid}>
      <td className="px-3 py-1 sticky left-0 bg-card z-10 whitespace-nowrap">→ {label}</td>
      {model!.months.map(m => {
        const v = valueFor(m);
        return <td key={m} colSpan={2} className="px-2 py-1 text-right font-mono tabular-nums border-r">{v ? fmt(Math.round(v)) : ""}</td>;
      })}
    </tr>
  );

  const totalRow = (label: string, pick: (t: any) => number, testid: string, strong = true) => (
    <tr className={`${strong ? "bg-muted/50 font-semibold" : ""} border-t`} data-testid={testid}>
      <td className="px-3 py-1.5 sticky left-0 bg-muted/50 backdrop-blur z-10">{label}</td>
      {model!.months.map(m => [
        <td key={`${m}-b`} className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(pick(model!.totals[m]?.budget))}</td>,
        <td key={`${m}-a`} className="px-2 py-1.5 text-right font-mono tabular-nums border-r">{model!.hasActual(m) ? fmt(pick(model!.totals[m]?.actual)) : ""}</td>,
      ])}
    </tr>
  );

  if (locked) {
    return (
      <div className="p-4 md:p-6 flex justify-center">
        <Card className="w-full max-w-sm mt-10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Lock className="w-4 h-4" /> Cashflow is locked</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">Enter the cashflow password. It stays unlocked for this browser session.</p>
            <Input
              autoFocus
              type="password"
              value={pw}
              onChange={(e) => { setPw(e.target.value); setPwError(false); }}
              onKeyDown={(e) => { if (e.key === "Enter" && pw) unlock.mutate(pw); }}
              placeholder="Password"
              data-testid="cf-password-input"
            />
            {pwError && <p className="text-xs text-destructive">Wrong password.</p>}
            <Button className="w-full" disabled={!pw || unlock.isPending} onClick={() => unlock.mutate(pw)} data-testid="cf-password-submit">Unlock</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const mobileIdx = model ? (mobileMonthIdx ?? defaultMonthIdx(model.months)) : 0;
  const mobileMonth = model?.months[mobileIdx];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/finance">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Back to Finance"><ArrowLeft className="w-4 h-4" /></Button>
            </Link>
            <Banknote className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-2xl font-bold tracking-tight" data-testid="page-title">Cashflow</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5 hidden sm:block">
            Monthly Budget vs Actual, £. Click any cell to edit — totals and the balance chain recompute.
            Openings chain per column from July 2026; receipts positive, payments negative.
          </p>
        </div>
      </div>

      {isLoading || !model ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
      ) : (
        <>
          {/* Xero cross-check */}
          {xeroCompare && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="cf-xero-strip">
              <Card><CardContent className="p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Cash at bank · Xero</p>
                <p className="text-lg font-semibold font-mono tabular-nums">{xeroCompare.cashTotal != null ? `£${fmt(Math.round(xeroCompare.cashTotal))}` : "—"}</p>
              </CardContent></Card>
              <Card><CardContent className="p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Forecast close · {ML(xeroCompare.nowMonth)}</p>
                <p className="text-lg font-semibold font-mono tabular-nums">{xeroCompare.forecastClose != null ? `£${fmt(Math.round(xeroCompare.forecastClose))}` : "—"}</p>
              </CardContent></Card>
              <Card className="col-span-2 sm:col-span-1"><CardContent className="p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Xero vs forecast</p>
                <p className={`text-lg font-semibold font-mono tabular-nums ${xeroCompare.cashTotal != null && xeroCompare.forecastClose != null && xeroCompare.cashTotal - xeroCompare.forecastClose < 0 ? "text-red-700 dark:text-red-400" : ""}`}>
                  {xeroCompare.cashTotal != null && xeroCompare.forecastClose != null ? `£${fmt(Math.round(xeroCompare.cashTotal - xeroCompare.forecastClose))}` : "—"}
                </p>
              </CardContent></Card>
            </div>
          )}
          {!data?.xero && (
            <p className="text-[11px] text-muted-foreground" data-testid="cf-xero-missing">Xero cross-check unavailable — Xero isn't connected in this environment.</p>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Closing bank balance</CardTitle></CardHeader>
            <CardContent className="h-48 sm:h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `£${Math.round(v / 1000)}k`} width={52} />
                  <Tooltip formatter={(v: any) => `£${Number(v).toLocaleString("en-GB")}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="Budget" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2.5 }} />
                  <Line type="monotone" dataKey="Actual" stroke="#0d9488" strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
                  {linked && <Line type="monotone" dataKey="App-linked" stroke="#7c3aed" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />}
                </LineChart>
              </ResponsiveContainer>
              {linked && (
                <p className="text-[10px] text-muted-foreground -mt-1">
                  Dashed = app-linked projection: weighted deal fees{linked.hasXero ? " + Xero invoices due, less Xero bills due + the opex run-rate" : " (Xero not connected — deals only)"}. Reference, not the plan — it can't see VAT quarters, and it can't see receipts invoiced before the Xero crossover (the Sage-era receivables in lines 1–4a), so expect it to sit BELOW the forecast while that legacy cash collects.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Phone: one month at a time (§7 phone card rules) — the full
              21-column grid stays a desktop surface. */}
          <div className="md:hidden space-y-3" data-testid="cf-mobile">
            {mobileMonth && (
              <>
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" className="h-9 w-9 p-0" disabled={mobileIdx === 0} onClick={() => setMobileMonthIdx(mobileIdx - 1)} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></Button>
                  <span className="text-sm font-semibold" data-testid="cf-mobile-month">{ML(mobileMonth)}</span>
                  <Button variant="outline" size="sm" className="h-9 w-9 p-0" disabled={mobileIdx === model.months.length - 1} onClick={() => setMobileMonthIdx(mobileIdx + 1)} aria-label="Next month"><ChevronRight className="w-4 h-4" /></Button>
                </div>
                <Card>
                  <CardContent className="p-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {([
                      ["Opening", (t: any) => t?.open],
                      ["Receipts", (t: any) => t?.rec],
                      ["Payments", (t: any) => t?.pay],
                      ["Closing", (t: any) => t?.close],
                      ["Reserve", (t: any) => t?.reserve],
                      ["All accounts", (t: any) => t?.all],
                    ] as Array<[string, (t: any) => number | undefined]>).map(([label, pick]) => (
                      <div key={label} className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono tabular-nums">
                          {fmt(pick(model.totals[mobileMonth]?.[model.hasActual(mobileMonth) ? "actual" : "budget"]))}
                        </span>
                      </div>
                    ))}
                    <p className="col-span-2 text-[10px] text-muted-foreground pt-1">
                      {model.hasActual(mobileMonth) ? "Actual basis" : "Budget basis (no actuals yet)"}
                    </p>
                  </CardContent>
                </Card>
                {linked?.byMonth[mobileMonth] && (
                  <Card data-testid="cf-mobile-linked">
                    <CardContent className="p-3 grid grid-cols-3 gap-2 text-xs text-violet-700 dark:text-violet-400">
                      <div><p className="text-[10px] uppercase tracking-wide opacity-70">App in</p><p className="font-mono tabular-nums">{fmt(linked.byMonth[mobileMonth].in)}</p></div>
                      <div><p className="text-[10px] uppercase tracking-wide opacity-70">App out</p><p className="font-mono tabular-nums">{fmt(-linked.byMonth[mobileMonth].out)}</p></div>
                      <div><p className="text-[10px] uppercase tracking-wide opacity-70">App close</p><p className="font-mono tabular-nums">{fmt(linked.byMonth[mobileMonth].close)}</p></div>
                      <p className="col-span-3 text-[10px] text-muted-foreground">App-linked: deals pipeline{linked.hasXero ? " + Xero AR/AP + run-rate" : " only (Xero not connected)"}</p>
                    </CardContent>
                  </Card>
                )}
                {(["receipts", "payments"] as const).map(section => (
                  <Card key={section}>
                    <CardHeader className="py-2"><CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">{section}</CardTitle></CardHeader>
                    <CardContent className="p-0 divide-y">
                      <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-1 px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span /><span className="text-right">Budget</span><span className="text-right">Actual</span>
                      </div>
                      {(section === "receipts" ? model.receipts : model.payments).map(l => (
                        <div key={l.id} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-1 px-3 py-1.5 text-xs" data-testid={`cf-m-line-${l.key}`}>
                          <span className="truncate" title={l.label}><span className="text-muted-foreground mr-1">{l.key}</span>{l.label}</span>
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
                    </CardContent>
                  </Card>
                ))}
              </>
            )}
          </div>

          {/* Desktop: the full grid */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <ScrollableTable minWidth={1100}>
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0 z-20">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground sticky left-0 bg-muted z-30 min-w-[220px]">Line</th>
                      {model.months.map(m => (
                        <th key={m} colSpan={2} className="px-2 py-1 text-center font-medium text-muted-foreground border-l">{ML(m)}</th>
                      ))}
                    </tr>
                    <tr>
                      <th className="px-3 py-1 sticky left-0 bg-muted z-30" />
                      {model.months.map(m => [
                        <th key={`${m}-b`} className="px-2 py-1 text-right font-normal text-[10px] uppercase tracking-wide text-muted-foreground border-l">Budget</th>,
                        <th key={`${m}-a`} className="px-2 py-1 text-right font-normal text-[10px] uppercase tracking-wide text-muted-foreground border-r">Actual</th>,
                      ])}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr className="bg-muted/30"><td colSpan={1 + model.months.length * 2} className="px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground sticky left-0">Receipts</td></tr>
                    {model.receipts.map(l => (
                      <tr key={l.id} className="group" data-testid={`cf-line-${l.key}`}>
                        <td className="px-3 py-1 sticky left-0 bg-card z-10 whitespace-nowrap">
                          <span className="text-muted-foreground mr-1.5">{l.key}</span>{l.label}
                          <button type="button" className="ml-1.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-destructive align-middle" title="Remove line" aria-label={`Remove ${l.label}`} onClick={() => removeLine.mutate(l.id)}><X className="w-3 h-3 inline" /></button>
                        </td>
                        {model.months.map(m => [cellTd(l.id, m, "budget"), cellTd(l.id, m, "actual")])}
                      </tr>
                    ))}
                    {totalRow("Total Receipts", t => t?.rec ?? 0, "cf-total-receipts")}
                    {data?.deals && projRow(
                      `Deals pipeline, weighted${data.deals.undated.count ? ` (+£${fmt(data.deals.undated.weighted)} undated)` : ""}`,
                      m => data.deals!.byMonth[m]?.weighted, "cf-proj-deals")}
                    {data?.xero?.arByMonth && projRow("Xero invoices due (AR)", m => data.xero!.arByMonth![m], "cf-proj-ar")}

                    <tr className="bg-muted/30"><td colSpan={1 + model.months.length * 2} className="px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground sticky left-0">Payments</td></tr>
                    {model.payments.map(l => (
                      <tr key={l.id} className="group" data-testid={`cf-line-${l.key}`}>
                        <td className="px-3 py-1 sticky left-0 bg-card z-10 whitespace-nowrap max-w-[320px] truncate" title={l.label}>
                          <span className="text-muted-foreground mr-1.5">{l.key}</span>{l.label}
                          <button type="button" className="ml-1.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-destructive align-middle" title="Remove line" aria-label={`Remove ${l.label}`} onClick={() => removeLine.mutate(l.id)}><X className="w-3 h-3 inline" /></button>
                        </td>
                        {model.months.map(m => [cellTd(l.id, m, "budget"), cellTd(l.id, m, "actual")])}
                      </tr>
                    ))}
                    {totalRow("Total Payments", t => t?.pay ?? 0, "cf-total-payments")}
                    {data?.xero?.apByMonth && projRow("Xero bills due (AP)", m => data.xero!.apByMonth![m] ? -data.xero!.apByMonth![m] : undefined, "cf-proj-ap")}
                    {data?.xero?.costRunRate != null && linked && projRow("Opex run-rate (Xero)", m => (linked.byMonth[m] ? -data.xero!.costRunRate! : undefined), "cf-proj-runrate")}

                    {totalRow("Opening balance", t => t?.open ?? 0, "cf-opening", false)}
                    {totalRow("Closing balance", t => t?.close ?? 0, "cf-closing")}
                    {model.reserveLine && (
                      <tr data-testid="cf-line-RESERVE">
                        <td className="px-3 py-1 sticky left-0 bg-card z-10 whitespace-nowrap">Reserve accounts (closing)</td>
                        {model.months.map(m => [cellTd(model.reserveLine!.id, m, "budget"), cellTd(model.reserveLine!.id, m, "actual")])}
                      </tr>
                    )}
                    {totalRow("Closing — all accounts", t => t?.all ?? 0, "cf-all-accounts")}
                  </tbody>
                </table>
              </ScrollableTable>
            </CardContent>
          </Card>

          {/* Forecast vs Xero, month by month */}
          {xeroCompare && xeroCompare.rows.length > 0 && (
            <Card data-testid="cf-xero-compare">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Forecast vs Xero</CardTitle></CardHeader>
              <CardContent className="p-0">
                <ScrollableTable minWidth={520}>
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Month</th>
                        <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Forecast in</th>
                        <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Xero income</th>
                        <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Forecast out</th>
                        <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Xero expenses</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {xeroCompare.rows.map(r => (
                        <tr key={r.month}>
                          <td className="px-3 py-1.5">{r.label} <span className="text-muted-foreground text-[10px]">({r.basis})</span></td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(Math.round(r.fcIn))}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(Math.round(r.xeroIn))}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-red-700 dark:text-red-400">{fmt(Math.round(r.fcOut))}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-red-700 dark:text-red-400">{fmt(Math.round(r.xeroOut))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollableTable>
                <p className="px-3 py-2 text-[10px] text-muted-foreground">
                  Xero figures are P&amp;L income/expenses (excl. VAT and balance-sheet movements), the forecast is cash in/out incl. VAT — and the forecast's early months include Sage-era receivables invoiced before the Xero crossover, which Xero never sees. Expect those differences; gaps beyond them are the signal.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {addingTo ? (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newLabel.trim()) addLine.mutate({ label: newLabel.trim(), section: addingTo }); if (e.key === "Escape") setAddingTo(null); }}
                  placeholder={`New ${addingTo === "receipts" ? "receipt" : "payment"} line`}
                  className="h-8 w-64 text-xs"
                  data-testid="cf-new-line-input"
                />
                <Button size="sm" className="h-8" disabled={!newLabel.trim() || addLine.isPending} onClick={() => addLine.mutate({ label: newLabel.trim(), section: addingTo })}>Add</Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setAddingTo(null)}>Cancel</Button>
              </div>
            ) : (
              <>
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => { setAddingTo("receipts"); setNewLabel(""); }} data-testid="cf-add-receipt"><Plus className="w-3.5 h-3.5" /> Receipt line</Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => { setAddingTo("payments"); setNewLabel(""); }} data-testid="cf-add-payment"><Plus className="w-3.5 h-3.5" /> Payment line</Button>
              </>
            )}
            <span className="text-[11px] text-muted-foreground ml-auto hidden sm:inline">
              Seeded from the 2026/27 forecast workbook · empty Actual columns simply haven't happened yet
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function defaultMonthIdx(months: string[]): number {
  const now = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const i = months.indexOf(now);
  return i >= 0 ? i : 0;
}
