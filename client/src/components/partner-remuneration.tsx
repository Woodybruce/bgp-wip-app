// Equity partners remuneration on the Finance page — Woody, 2026-08-28,
// mirroring his Woody_.xlsx: Gross Salary / Bonus / Cash Advances / Total
// per director per fiscal year (May–April), FY25 + FY26 seeded from the
// workbook, FY27 typed in as drawn. The FY27 view adds the forecast Woody
// asked for: the Company outlook's projected FY profit (income minus the
// full cost base, see lib/outlook-model.ts) split equally between the four
// equity partners on top of the £145k basic — "what the guys might make
// this year", moving live with the deal pipeline.
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollableTable } from "@/components/scrollable-table";
import { Pill } from "@/components/ui/pill";
import { queryClient } from "@/lib/queryClient";
import {
  type CashflowData, cashflowFetch, fmtCashflow as fmt,
} from "@/lib/cashflow-model";
import { buildCompanyOutlook, type HistoricalWip } from "@/lib/outlook-model";
import { useToast } from "@/hooks/use-toast";
import { Users } from "lucide-react";

interface RemRow { fy: number; partner: string; salary: number; bonus: number; advances: number }
interface RemData { rows: RemRow[]; partners: string[] }

const FY_LABEL: Record<number, string> = { 2025: "FY 2024–25", 2026: "FY 2025–26", 2027: "FY 2026–27" };
const FIELDS = [
  { key: "salary" as const, label: "Gross Salary" },
  { key: "bonus" as const, label: "Bonus" },
  { key: "advances" as const, label: "Cash Advances" },
];

export function PartnerRemunerationSection() {
  const { toast } = useToast();
  const [fy, setFy] = useState(2027);
  const [editCell, setEditCell] = useState<{ partner: string; field: "salary" | "bonus" | "advances" } | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data, isLoading } = useQuery<RemData>({
    queryKey: ["/api/partner-remuneration"],
    queryFn: async () => (await cashflowFetch("GET", "/api/partner-remuneration")).json(),
  });
  const { data: cashflow } = useQuery<CashflowData>({
    queryKey: ["/api/cashflow"],
    queryFn: async () => (await cashflowFetch("GET", "/api/cashflow")).json(),
    staleTime: 5 * 60 * 1000,
  });

  const saveCell = useMutation({
    mutationFn: async (v: { fy: number; partner: string; field: string; value: number }) => {
      const res = await cashflowFetch("PATCH", "/api/partner-remuneration/cell", v);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/partner-remuneration"] }),
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });

  const fys = useMemo(() => (data ? [...new Set(data.rows.map(r => r.fy))].sort() : []), [data]);
  const yearRows = useMemo(() => {
    if (!data) return [];
    return data.partners.map(p => data.rows.find(r => r.fy === fy && r.partner === p) || { fy, partner: p, salary: 0, bonus: 0, advances: 0 });
  }, [data, fy]);

  // Historical billings — prior-year context for the forecast.
  const { data: hist } = useQuery<HistoricalWip>({
    queryKey: ["/api/historical-wip"],
    queryFn: async () => (await cashflowFetch("GET", "/api/historical-wip")).json(),
    staleTime: 60 * 60 * 1000,
  });

  // Forecast v4 (Woody, 2026-08-28): the pool is the Company outlook's
  // projected FY profit — income (Xero to date + weighted deal book +
  // legacy Sage) minus the full cost base (basic costs + salaries +
  // app-computed commissions), pre corporation tax. Salaries are already
  // a cost, so the share sits ON TOP of the £145k basic. Replaces the
  // earlier last-year-margin heuristic with the same P&L the outlook
  // panel above shows.
  const forecast = useMemo(() => {
    const outlook = buildCompanyOutlook(cashflow, hist ?? null);
    if (!outlook) return null;
    return { pool: outlook.profit.projectedFy, share: outlook.profit.perPartner };
  }, [cashflow, hist]);

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (!data) return null;

  const totals = yearRows.reduce(
    (a, r) => ({ salary: a.salary + r.salary, bonus: a.bonus + r.bonus, advances: a.advances + r.advances }),
    { salary: 0, bonus: 0, advances: 0 },
  );
  const beginEdit = (partner: string, field: "salary" | "bonus" | "advances", current: number) => {
    setEditCell({ partner, field });
    setEditValue(current ? String(current) : "");
  };
  const commitEdit = () => {
    if (!editCell) return;
    const value = Number(editValue.replace(/[,£\s]/g, ""));
    if (Number.isFinite(value) && value >= 0) {
      saveCell.mutate({ fy, partner: editCell.partner, field: editCell.field, value });
    }
    setEditCell(null);
  };

  return (
    <Card className="border rounded-xl" data-testid="partner-remuneration">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4" />
          Equity partners
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Remuneration by fiscal year (May–April) — salary, bonus and cash advances per partner, with profits split equally between the four of you. Tap a figure to edit. Salaries £145k from 1 Apr 2026.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center flex-wrap gap-1.5">
          {fys.map(y => (
            <Pill key={y} active={fy === y} onClick={() => { setFy(y); setEditCell(null); }} data-testid={`rem-fy-${y}`}>
              {FY_LABEL[y] || `FY ${y}`}
            </Pill>
          ))}
        </div>

        <ScrollableTable minWidth={520}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b">
                <th className="text-left py-1.5 pr-3 font-medium">Director</th>
                {FIELDS.map(f => <th key={f.key} className="text-right py-1.5 px-3 font-medium">{f.label}</th>)}
                <th className="text-right py-1.5 pl-3 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {yearRows.map(r => (
                <tr key={r.partner} className="border-b border-dashed last:border-0" data-testid={`rem-row-${r.partner}`}>
                  <td className="py-1.5 pr-3 font-medium">{r.partner}</td>
                  {FIELDS.map(f => (
                    <td key={f.key} className="py-1 px-3 text-right tabular-nums">
                      {editCell && editCell.partner === r.partner && editCell.field === f.key ? (
                        <input
                          autoFocus
                          className="w-24 text-right text-xs border rounded px-1 py-0.5 bg-background tabular-nums"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
                          data-testid={`rem-input-${r.partner}-${f.key}`}
                        />
                      ) : (
                        <button className="tabular-nums hover:underline underline-offset-2" onClick={() => beginEdit(r.partner, f.key, (r as any)[f.key])} data-testid={`rem-cell-${r.partner}-${f.key}`}>
                          {(r as any)[f.key] ? `£${fmt((r as any)[f.key])}` : "—"}
                        </button>
                      )}
                    </td>
                  ))}
                  <td className="py-1.5 pl-3 text-right tabular-nums font-semibold">£{fmt(r.salary + r.bonus + r.advances)}</td>
                </tr>
              ))}
              <tr className="border-t">
                <td className="py-1.5 pr-3 text-[10px] uppercase tracking-widest text-muted-foreground">Total</td>
                <td className="py-1.5 px-3 text-right tabular-nums font-semibold">{totals.salary ? `£${fmt(totals.salary)}` : "—"}</td>
                <td className="py-1.5 px-3 text-right tabular-nums font-semibold">{totals.bonus ? `£${fmt(totals.bonus)}` : "—"}</td>
                <td className="py-1.5 px-3 text-right tabular-nums font-semibold">{totals.advances ? `£${fmt(totals.advances)}` : "—"}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums font-semibold">£{fmt(totals.salary + totals.bonus + totals.advances)}</td>
              </tr>
            </tbody>
          </table>
        </ScrollableTable>

        {/* The four per-partner forecast cards were retired 2026-08-28 —
            the Company outlook at the top of the page carries the live
            per-partner number; this table is the record of what's actually
            drawn. One line ties the two together. */}
        {fy === 2027 && forecast && (
          <p className="text-[11px] text-muted-foreground leading-relaxed" data-testid="rem-forecast">
            Live forecast (from the Company outlook above): profit pool £{fmt(forecast.pool)} → £{fmt(forecast.share)} each on top of the £145k salary. Bonus and cash advances typed above are draws against that share.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
