// Equity Finance widget — the company's headline financial position on the
// dashboard, for the equity directors only (Woody, Jack, Rupert, Charlotte —
// Woody, 2026-08-22). Same data as the Finance page (/api/xero/financials,
// server-gated by requireEquityOrAdmin); this is the at-a-glance version with
// a jump-off to the full page. Every tile is a figure Finance shows, worked
// out the same way (Woody, 2026-11-17: "make it sync"): the deal book and the
// projected year come from the Company outlook itself (useCompanyOutlook).
import { useQuery } from "@tanstack/react-query";
import { useCompanyOutlook, outlookBookWeighted } from "@/lib/use-company-outlook";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Landmark, ArrowRight } from "lucide-react";

function money(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
}

export function EquityFinanceWidget() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/xero/financials"],
    staleTime: 5 * 60 * 1000,
  });
  const outlook = useCompanyOutlook();

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Landmark className="w-4 h-4" /> Equity Finance</CardTitle>
        </CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Loading from Xero…</p></CardContent>
      </Card>
    );
  }

  if (!data || data.notConnected || data.needsReconnect) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Landmark className="w-4 h-4" /> Equity Finance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {data?.needsReconnect ? "Xero needs reconnecting — open the Finance page to fix it." : "Xero isn't connected yet."}
          </p>
          <Link href="/finance"><span className="text-xs text-primary inline-flex items-center gap-1 mt-2 cursor-pointer">Open Finance <ArrowRight className="w-3 h-3" /></span></Link>
        </CardContent>
      </Card>
    );
  }

  const h = data.headline || {};
  const stats: Array<{ label: string; value: string; sub?: string; negative?: boolean }> = [
    { label: "Income FYTD", value: money(h.income) },
    {
      label: "Net profit FYTD",
      value: money(h.netProfit),
      negative: (h.netProfit ?? 0) < 0,
      sub: h.operatingExpenses != null ? `Costs ${money(h.operatingExpenses)}` : undefined,
    },
    { label: "Cash at bank", value: money(data.cashTotal) },
    {
      label: "Debtors",
      value: money(data.debtors?.outstanding),
      negative: (data.debtors?.overdue ?? 0) > 0,
      sub: data.debtors ? `${money(data.debtors.overdue)} overdue` : undefined,
    },
  ];
  const book = outlookBookWeighted(outlook);
  if (outlook && book != null) {
    const bookFee = outlook.income.byStage.reduce((s, st) => s + st.unweighted, 0);
    stats.push({
      label: "Transaction book",
      value: money(book),
      sub: `weighted · ${money(bookFee)} at full fee`,
    });
    stats.push({
      label: "Projected FY profit",
      value: money(outlook.profit.projectedFy),
      negative: outlook.profit.projectedFy < 0,
      sub: `Income ${money(outlook.income.projectedFy)} − costs ${money(outlook.costs.projectedFy)}`,
    });
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Landmark className="w-4 h-4" /> Equity Finance</span>
          <Link href="/finance">
            <span className="text-xs font-normal text-primary inline-flex items-center gap-1 cursor-pointer" data-testid="link-equity-finance-full">
              Full view <ArrowRight className="w-3 h-3" />
            </span>
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {stats.map((s, i) => (
            <div key={i} className="rounded-md border p-3">
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
              <p className={`text-lg font-semibold tracking-tight font-mono ${s.negative ? "text-red-600 dark:text-red-400" : ""}`}>{s.value}</p>
              {s.sub && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{s.sub}</p>}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Live from Xero · equity directors only · transaction book and projection as on Finance (Negotiating and HOTs at 50%, Solicitors on at 100%) ·{" "}
          <Link href="/wip-report"><span className="text-primary cursor-pointer" data-testid="link-equity-wip-report">WIP report</span></Link>
        </p>
      </CardContent>
    </Card>
  );
}
