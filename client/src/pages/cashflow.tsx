// Cashflow board (Woody, 2026-08-27) — monthly Budget vs Actual cash flow,
// seeded from the 2026/27 forecast workbook and edited in place. Only the
// receipt/payment lines, the first opening balance and the reserve-account
// closing are stored; totals, the opening-balance chain (per basis) and
// closing balances are computed here. Equity/admin only, same gate as
// Finance (/api/cashflow is requireEquityOrAdmin).
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollableTable } from "@/components/scrollable-table";
import { apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Banknote, Plus, X } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
} from "recharts";

interface CashflowLine { id: string; key: string; label: string; section: "receipts" | "payments" | "balance"; sort: number }
interface CashflowCell { line_id: string; month: string; basis: "budget" | "actual"; amount: number }
interface CashflowData { lines: CashflowLine[]; cells: CashflowCell[]; months: string[] }

const MONTH_LABEL = (m: string) => {
  const [y, mm] = m.split("-");
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][parseInt(mm, 10) - 1]} ${y.slice(2)}`;
};

function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null) return "";
  if (n === 0) return "-";
  const abs = Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 });
  return n < 0 ? `(${abs})` : abs;
}

export default function CashflowPage() {
  const { toast } = useToast();
  const [addingTo, setAddingTo] = useState<"receipts" | "payments" | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [editCell, setEditCell] = useState<{ lineId: string; month: string; basis: "budget" | "actual" } | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data, isLoading } = useQuery<CashflowData>({
    queryKey: ["/api/cashflow"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const saveCell = useMutation({
    mutationFn: async (p: { lineId: string; month: string; basis: string; amount: number | null }) => {
      const res = await apiRequest("PATCH", "/api/cashflow/cell", p);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/cashflow"] }),
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  const addLine = useMutation({
    mutationFn: async (p: { label: string; section: string }) => {
      const res = await apiRequest("POST", "/api/cashflow/line", p);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/cashflow"] }); setAddingTo(null); setNewLabel(""); },
    onError: (e: any) => toast({ title: "Couldn't add line", description: e?.message, variant: "destructive" }),
  });
  const removeLine = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/cashflow/line/${id}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/cashflow"] }),
  });

  const model = useMemo(() => {
    if (!data) return null;
    const { lines, cells, months } = data;
    const cellMap = new Map<string, number>();
    for (const c of cells) cellMap.set(`${c.line_id}|${c.month}|${c.basis}`, Number(c.amount));
    const get = (lineId: string, month: string, basis: string) => cellMap.get(`${lineId}|${month}|${basis}`);
    const receipts = lines.filter(l => l.section === "receipts");
    const payments = lines.filter(l => l.section === "payments");
    const openLine = lines.find(l => l.key === "OPEN") || null;
    const reserveLine = lines.find(l => l.key === "RESERVE") || null;

    const totals: Record<string, Record<string, { rec: number; pay: number; open: number; close: number; reserve: number | undefined; all: number }>> = {};
    for (const basis of ["budget", "actual"] as const) {
      // Opening chain per basis: the OPEN line's earliest stored value
      // starts the chain; each month's closing feeds the next opening.
      let opening = openLine ? months.map(m => get(openLine.id, m, basis)).find(v => v !== undefined) ?? 0 : 0;
      const firstOpenMonth = openLine ? months.find(m => get(openLine.id, m, basis) !== undefined) : undefined;
      for (const m of months) {
        if (openLine && firstOpenMonth && m === firstOpenMonth) opening = get(openLine.id, m, basis)!;
        const rec = receipts.reduce((s, l) => s + (get(l.id, m, basis) || 0), 0);
        const pay = payments.reduce((s, l) => s + (get(l.id, m, basis) || 0), 0);
        const close = opening + rec + pay;
        const reserve = reserveLine ? get(reserveLine.id, m, basis) : undefined;
        (totals[m] ||= {} as any)[basis] = { rec, pay, open: opening, close, reserve, all: close + (reserve || 0) };
        opening = close;
      }
    }
    return { receipts, payments, openLine, reserveLine, months, get, totals };
  }, [data]);

  const chartData = useMemo(() => {
    if (!model) return [];
    return model.months.map(m => {
      const row: Record<string, any> = { month: MONTH_LABEL(m), Budget: Math.round(model.totals[m]?.budget?.close ?? 0) };
      if (hasAnyActual(model, m)) row.Actual = Math.round(model.totals[m]?.actual?.close ?? 0);
      return row;
    });
  }, [model]);

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

  const cellTd = (lineId: string, month: string, basis: "budget" | "actual") => {
    const v = model!.get(lineId, month, basis);
    const editing = editCell && editCell.lineId === lineId && editCell.month === month && editCell.basis === basis;
    return (
      <td
        key={`${month}-${basis}`}
        className={`px-2 py-1 text-right font-mono tabular-nums cursor-pointer hover:bg-muted/60 ${basis === "actual" ? "border-r" : ""} ${v !== undefined && v < 0 ? "text-red-700 dark:text-red-400" : ""}`}
        onClick={() => !editing && startEdit(lineId, month, basis, v)}
        data-testid={`cf-cell-${lineId}-${month}-${basis}`}
      >
        {editing ? (
          <Input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
            className="h-6 w-24 px-1 text-right text-xs font-mono"
          />
        ) : fmt(v)}
      </td>
    );
  };

  const totalRow = (label: string, pick: (t: any) => number, testid: string, strong = true) => (
    <tr className={`${strong ? "bg-muted/50 font-semibold" : ""} border-t`} data-testid={testid}>
      <td className="px-3 py-1.5 sticky left-0 bg-muted/50 backdrop-blur z-10">{label}</td>
      {model!.months.map(m => [
        <td key={`${m}-b`} className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(pick(model!.totals[m]?.budget))}</td>,
        <td key={`${m}-a`} className="px-2 py-1.5 text-right font-mono tabular-nums border-r">{hasAnyActual(model!, m) ? fmt(pick(model!.totals[m]?.actual)) : ""}</td>,
      ])}
    </tr>
  );

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
          <p className="text-sm text-muted-foreground mt-0.5">
            Monthly Budget vs Actual, £. Click any cell to edit — totals and the balance chain recompute.
            Openings chain per column from July 2026; receipts positive, payments negative.
          </p>
        </div>
      </div>

      {isLoading || !model ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Closing bank balance</CardTitle></CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `£${Math.round(v / 1000)}k`} width={56} />
                  <Tooltip formatter={(v: any) => `£${Number(v).toLocaleString("en-GB")}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="Budget" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2.5 }} />
                  <Line type="monotone" dataKey="Actual" stroke="#0d9488" strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <ScrollableTable minWidth={1100}>
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0 z-20">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground sticky left-0 bg-muted z-30 min-w-[220px]">Line</th>
                      {model.months.map(m => (
                        <th key={m} colSpan={2} className="px-2 py-1 text-center font-medium text-muted-foreground border-l">{MONTH_LABEL(m)}</th>
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
            <span className="text-[11px] text-muted-foreground ml-auto">
              Seeded from the 2026/27 forecast workbook · empty Actual columns simply haven't happened yet
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function hasAnyActual(model: { get: (l: string, m: string, b: string) => number | undefined; receipts: CashflowLine[]; payments: CashflowLine[] }, month: string): boolean {
  return [...model.receipts, ...model.payments].some(l => model.get(l.id, month, "actual") !== undefined);
}
