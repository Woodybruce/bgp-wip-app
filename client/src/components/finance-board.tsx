// Finance → Fees & pipeline (Woody, 2026-11-17: "fold reporting and board
// report in to finance ... make it sync and to the point"). The money views
// that were on Reporting and Board Report, from GET /api/finance/board: the
// deal book by the one pipeline rule (stage, team, deal type, largest deals),
// what was invoiced this year and fees by agent. Download Excel is the board
// pack. Record counts, activity trends, time to close and the news panel
// were left behind on purpose (Woody: "keep money only").
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StageRow } from "@/components/company-outlook";
import { Download } from "lucide-react";

interface Row { name: string; fee: number; weighted: number; deals: number }
export interface FinanceBoardData {
  fyStart: string;
  fyLabel: string;
  generatedAt: string;
  rule: string;
  book: {
    fee: number; weighted: number; count: number; thisYear: number;
    noDate: { weighted: number; count: number };
    afterYearEnd: { weighted: number; count: number };
    byStage: Array<{ code: string; label: string; weightPct: number; fee: number; weighted: number; count: number; deals: Array<{ id: string; name: string; fee: number; weighted: number }> }>;
    byTeam: Row[];
    byType: Row[];
    top: Array<{ id: string; name: string; stage: string; stageLabel: string; fee: number; weighted: number; team: string; dealType: string; expected: string | null }>;
  };
  invoiced: null | {
    total: number; count: number;
    byMonth: Array<{ month: string; total: number }>;
    house: number;
    notLinked: { total: number; count: number };
    noSplit: { total: number; count: number };
  };
  agents: Array<{ agent: string; invoiced: number; book: number }>;
}

function money(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(n));
}

function Figure({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  return (
    <div className="border rounded-xl p-4">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums mt-1" data-testid={testId}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{sub}</p>}
    </div>
  );
}

// One row per team or deal type: the weighted figure with a share bar, the
// full fee beside it.
function ShareList({ rows, total, testId }: { rows: Row[]; total: number; testId: string }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">Nothing in the book yet.</p>;
  return (
    <div className="space-y-2" data-testid={testId}>
      {rows.map(r => (
        <div key={r.name}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{r.name}</span>
            <span className="font-mono tabular-nums shrink-0">{money(r.weighted)}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${total > 0 ? Math.max(1, (r.weighted / total) * 100) : 0}%` }} />
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 w-28 text-right">{money(r.fee)} full fee</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function FinanceBoardSection() {
  const { toast } = useToast();
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const { data, isLoading, error } = useQuery<FinanceBoardData>({
    queryKey: ["/api/finance/board"],
    staleTime: 5 * 60 * 1000,
  });

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/finance/board.xlsx", { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BGP_Fees_and_pipeline_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Couldn't build the workbook", description: e?.message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (error || !data) {
    return (
      <Card><CardContent className="p-6 text-sm text-muted-foreground">
        Couldn't load the fees and pipeline{error ? `: ${(error as Error).message}` : ""}. Try again shortly.
      </CardContent></Card>
    );
  }

  const { book, invoiced } = data;
  const agentTotalInvoiced = data.agents.reduce((s, a) => s + a.invoiced, 0);
  const agentTotalBook = data.agents.reduce((s, a) => s + a.book, 0);

  return (
    <div className="space-y-4" data-testid="finance-board">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span>Fees and pipeline — {data.fyLabel}</span>
            <Button variant="outline" size="sm" onClick={download} disabled={downloading} data-testid="button-finance-board-excel">
              <Download className="w-4 h-4 mr-1" /> {downloading ? "Building…" : "Download Excel"}
            </Button>
          </CardTitle>
          <p className="text-xs text-muted-foreground">All ex VAT. Each transaction counted once; invoiced transactions are Xero income only.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Figure
              label="Transaction book — weighted"
              value={money(book.weighted)}
              sub={`${money(book.fee)} at full fee · ${book.count} live transaction${book.count === 1 ? "" : "s"}`}
              testId="finance-board-book"
            />
            <Figure
              label="Expected this year"
              value={money(book.thisYear + book.noDate.weighted)}
              sub={[
                book.noDate.count ? `incl. ${money(book.noDate.weighted)} with no date yet` : "",
                book.afterYearEnd.count ? `${money(book.afterYearEnd.weighted)} more after 30 April` : "",
              ].filter(Boolean).join(" · ") || "Every transaction in the book lands this year"}
              testId="finance-board-this-year"
            />
            <Figure
              label="Invoiced this year"
              value={invoiced ? money(invoiced.total) : "—"}
              sub={invoiced ? `${invoiced.count} Xero invoice${invoiced.count === 1 ? "" : "s"} since ${new Date(data.fyStart).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "Xero isn't connected"}
              testId="finance-board-invoiced"
            />
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">By stage</p>
            <div className="space-y-2" data-testid="finance-board-stages">
              {book.byStage.map(s => (
                <StageRow
                  key={s.code}
                  stage={{ code: s.code, label: s.label, weightPct: s.weightPct, weighted: s.weighted, unweighted: s.fee, count: s.count, deals: s.deals }}
                  open={openStage === s.code}
                  onToggle={() => setOpenStage(cur => (cur === s.code ? null : s.code))}
                />
              ))}
              {book.byStage.length === 0 && <p className="text-xs text-muted-foreground">No live transactions with fees on the boards yet.</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By team</CardTitle>
            <p className="text-xs text-muted-foreground">A transaction on two teams counts half to each, so the teams add up to the book.</p>
          </CardHeader>
          <CardContent><ShareList rows={book.byTeam} total={book.weighted} testId="finance-board-teams" /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By transaction type</CardTitle>
          </CardHeader>
          <CardContent><ShareList rows={book.byType} total={book.weighted} testId="finance-board-types" /></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Largest transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {book.top.length === 0 ? <p className="text-xs text-muted-foreground">No live transactions with fees yet.</p> : (
            <div className="divide-y" data-testid="finance-board-top">
              {book.top.map(d => (
                <Link key={d.id} href={`/deals/${d.id}`}>
                  <div className="flex items-center justify-between gap-3 py-2 cursor-pointer hover:bg-muted/50 -mx-2 px-2 rounded">
                    <span className="min-w-0">
                      <span className="text-sm font-medium truncate block">{d.name}</span>
                      <span className="text-[11px] text-muted-foreground">{[d.stageLabel, d.team, d.dealType].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="text-sm font-mono tabular-nums block">{money(d.weighted)}</span>
                      {d.weighted !== d.fee && <span className="text-[11px] text-muted-foreground tabular-nums">of {money(d.fee)}</span>}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Fees by agent</CardTitle>
          <p className="text-xs text-muted-foreground">Each invoice and each transaction shared by its fee split. BGP House is not an agent: its slice is the line below.</p>
        </CardHeader>
        <CardContent>
          {data.agents.length === 0 ? <p className="text-xs text-muted-foreground">No fee splits to share yet.</p> : (
            <div data-testid="finance-board-agents">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-[10px] uppercase tracking-widest text-muted-foreground pb-1 border-b">
                <span>Agent</span><span className="text-right w-24">Invoiced</span><span className="text-right w-24">Transaction book</span>
              </div>
              {data.agents.map(a => (
                <div key={a.agent} className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-sm py-1.5 border-b last:border-0">
                  <span className="truncate">{a.agent}</span>
                  <span className="text-right font-mono tabular-nums w-24">{invoiced ? money(a.invoiced) : "—"}</span>
                  <span className="text-right font-mono tabular-nums w-24">{money(a.book)}</span>
                </div>
              ))}
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-sm py-1.5 font-semibold border-t">
                <span>All agents</span>
                <span className="text-right font-mono tabular-nums w-24">{invoiced ? money(agentTotalInvoiced) : "—"}</span>
                <span className="text-right font-mono tabular-nums w-24">{money(agentTotalBook)}</span>
              </div>
              {invoiced && (
                <p className="text-[11px] text-muted-foreground pt-2 leading-snug" data-testid="finance-board-agents-reconcile">
                  Of {money(invoiced.total)} invoiced: {money(agentTotalInvoiced)} to agents · {money(invoiced.house)} BGP House
                  {invoiced.noSplit.count ? ` · ${money(invoiced.noSplit.total)} on ${invoiced.noSplit.count} transaction${invoiced.noSplit.count === 1 ? "" : "s"} with no fee split` : ""}
                  {invoiced.notLinked.count ? ` · ${money(invoiced.notLinked.total)} on ${invoiced.notLinked.count} invoice${invoiced.notLinked.count === 1 ? "" : "s"} raised in Xero and not linked to a transaction` : ""}.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground" data-testid="finance-board-rule">
        Weights: {data.rule}. Investment transactions count from Solicitors. Invoiced = Xero sales invoices dated this financial year, ex VAT.
      </p>
    </div>
  );
}
