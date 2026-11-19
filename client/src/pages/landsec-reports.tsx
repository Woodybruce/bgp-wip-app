// Reports, for Landsec and BGP logins (Woody, 2026-11-19, after a call with
// Mark Warne at Landsec: the reports Landsec takes from VTS should come from
// the app; "quarters just have ability to pick one or several months"; who
// runs them: "yes landsec and BGP").
//
// Pick the months and the schemes once at the top; every card exports with
// them. The page leads with the reports to present, which are slide decks:
// each downloads as a PDF or as a PowerPoint of the same slides (Woody,
// 2026-11-19: "we dont need complicated excels just visual PDF which can also
// be power point"). The Excel data exports are under one fold at the foot.
// The list of reports and the period rule are shared/landsec-reports.ts, so a
// report added there shows here. What a login may read is decided on the
// server (server/landsec-reports.ts): this page only asks.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Download, FileSpreadsheet, Loader2, PenLine, Presentation } from "lucide-react";
import { Pill, PillCount, pillMetrics } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { downloadWithAuth } from "@/components/unit-hots/hots-api";
import { BoardMarketEditor } from "@/components/landsec/board-market-editor";
import {
  defaultReportMonths, landsecReportFileName, parseReportPeriod,
  type LandsecReportDef, type LandsecReportsIndex,
} from "@shared/landsec-reports";

const SECTION_LABEL = "text-xs font-semibold uppercase tracking-wider text-muted-foreground";
const FORMAT_CHIP = `${pillMetrics} border border-border px-2 py-[3px] text-[10px] text-muted-foreground`;

// The quick periods: whole months, ending with last month.
const QUICK: Array<{ label: string; months: number }> = [
  { label: "Last month", months: 1 }, { label: "Last 3 months", months: 3 }, { label: "Last 6 months", months: 6 }, { label: "Last 12 months", months: 12 },
];
const monthsBack = (to: string, months: number): string => {
  const [y, m] = to.split("-").map(Number);
  const index = y * 12 + (m - 1) - (months - 1);
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

export default function LandsecReports() {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<LandsecReportsIndex>({ queryKey: ["/api/landsec/reports"], retry: false });
  const initial = useMemo(() => defaultReportMonths(), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  // The schemes ticked: null = all of them.
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const [oneScheme, setOneScheme] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [marketOpen, setMarketOpen] = useState(false);

  const schemes = data?.schemes || [];
  const chosen = useMemo(() => (ticked ? schemes.filter(s => ticked.has(s.key)) : schemes), [schemes, ticked]);
  useEffect(() => {
    // The one-scheme report follows the ticks until a scheme is picked on its card.
    if (chosen.length && !chosen.some(s => s.key === oneScheme)) setOneScheme(chosen[0].key);
  }, [chosen, oneScheme]);

  const parsed = parseReportPeriod(from, to);
  const period = parsed.ok ? parsed.period : null;

  const toggle = (key: string) => {
    const next = new Set(ticked ?? schemes.map(s => s.key));
    if (next.has(key)) next.delete(key); else next.add(key);
    setTicked(next.size === schemes.length ? null : next);
  };

  // A deck comes as a PDF, or as a PowerPoint of the same slides.
  const exportReport = async (def: LandsecReportDef, as?: "pdf" | "pptx") => {
    if (!period) return;
    const one = def.schemes === "one";
    const keys = one ? [oneScheme] : chosen.map(s => s.key);
    const params = new URLSearchParams({ from: period.from, to: period.to });
    // All schemes ticked = none named: the server gives every scheme on the login.
    if (one || ticked) params.set("schemes", keys.join(","));
    if (as === "pptx") params.set("format", "pptx");
    setBusy(`${def.key}:${as || def.format}`);
    try {
      await downloadWithAuth(`/api/landsec/reports/${def.key}?${params.toString()}`,
        landsecReportFileName(def, period, one ? schemes.find(s => s.key === oneScheme)?.name : null, def.deck ? as || "pdf" : undefined));
    } catch (e) {
      toast({ title: `${def.title} could not be made`, description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4" data-testid="landsec-reports">
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-36 rounded-lg" />)}</div>
      </div>
    );
  }
  if (error || !data) {
    const refused = /^403/.test((error as Error | null)?.message || "");
    return (
      <div className="p-4 md:p-6 space-y-4" data-testid="landsec-reports">
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="landsec-reports-refused">
          {refused ? "Reports are for Landsec and BGP logins." : "The reports could not be loaded. Try again in a moment."}
        </p>
      </div>
    );
  }

  const noneTicked = chosen.length === 0;
  // The reports to present are decks; everything else is an Excel data export, under the fold.
  const decks = data.reports.filter(def => def.deck);
  const exports = data.reports.filter(def => !def.deck);
  return (
    <div className="p-4 md:p-6 space-y-5" data-testid="landsec-reports">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="mt-0.5 text-sm text-muted-foreground" data-testid="landsec-reports-summary">
          <span className="font-mono tabular-nums">{decks.length}</span> reports to present
          {period ? <> · {period.label}</> : null}
          {schemes.length > 0 && <> · <span className="font-mono tabular-nums">{chosen.length}</span> of <span className="font-mono tabular-nums">{schemes.length}</span> schemes</>}
        </p>
      </div>

      {schemes.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="landsec-reports-no-schemes">
          No scheme is on this login, so there is nothing to report on. Ask BGP to add your schemes.
        </p>
      ) : (
        <>
          <section className="space-y-2" aria-label="Period">
            <h2 className={SECTION_LABEL}>Period</h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-[calc(50%-0.375rem)] space-y-1 sm:w-44">
                <Label htmlFor="report-from" className="text-xs">From</Label>
                <Input id="report-from" type="month" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} aria-invalid={!parsed.ok} data-testid="landsec-reports-from" />
              </div>
              <div className="w-[calc(50%-0.375rem)] space-y-1 sm:w-44">
                <Label htmlFor="report-to" className="text-xs">To</Label>
                <Input id="report-to" type="month" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} aria-invalid={!parsed.ok} data-testid="landsec-reports-to" />
              </div>
              <div className="flex flex-wrap gap-1.5 pb-1.5">
                {QUICK.map(q => {
                  const qFrom = monthsBack(initial.to, q.months);
                  return (
                    <Pill key={q.label} active={from === qFrom && to === initial.to} onClick={() => { setFrom(qFrom); setTo(initial.to); }} data-testid={`landsec-reports-quick-${q.months}`}>
                      {q.label}
                    </Pill>
                  );
                })}
              </div>
            </div>
            {!parsed.ok
              ? <p className="text-xs text-destructive" role="alert" data-testid="landsec-reports-period-error">{parsed.error}</p>
              : <p className="text-[11px] text-muted-foreground">One month or several, both ends included. Each report says how it uses the period.</p>}
          </section>

          <section className="space-y-2" aria-label="Schemes">
            <h2 className={SECTION_LABEL}>Schemes</h2>
            <div className="flex flex-wrap gap-1.5">
              <Pill active={!ticked} onClick={() => setTicked(ticked ? null : new Set())} aria-pressed={!ticked} data-testid="landsec-reports-all-schemes">
                All <PillCount n={schemes.length} active={!ticked} />
              </Pill>
              {schemes.map(s => {
                const on = !ticked || ticked.has(s.key);
                return <Pill key={s.key} active={on} aria-pressed={on} onClick={() => toggle(s.key)} data-testid={`landsec-reports-scheme-${s.key}`}>{s.name}</Pill>;
              })}
            </div>
            {noneTicked && <p className="text-xs text-muted-foreground" data-testid="landsec-reports-none-ticked">Tick at least one scheme to export.</p>}
          </section>

          <section className="space-y-2" aria-label="Reports to present">
            <h2 className={SECTION_LABEL}>Reports to present</h2>
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {decks.map(def => {
                const one = def.schemes === "one";
                const blocked = !period || (one ? !oneScheme : noneTicked);
                const board = def.card === "board";
                return (
                  <li key={def.key} className="flex flex-col gap-2 rounded-lg border bg-card p-4" data-testid={`landsec-report-${def.key}`}>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="flex min-w-0 items-center gap-2 text-base font-semibold"><Presentation className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{def.title}</span></h3>
                      <span className={FORMAT_CHIP}>Slides</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{def.description}</p>
                    <p className="text-[11px] text-muted-foreground">{def.period}</p>
                    {def.note && <p className="text-[11px] text-muted-foreground" data-testid={`landsec-report-note-${def.key}`}>{def.note}</p>}
                    <div className="mt-auto flex flex-col gap-2 pt-1">
                      {one && (
                        <Select value={oneScheme} onValueChange={setOneScheme}>
                          <SelectTrigger className="h-9 w-full text-xs sm:w-56" aria-label="Scheme" data-testid={`landsec-report-scheme-${def.key}`}><SelectValue placeholder="Pick a scheme" /></SelectTrigger>
                          <SelectContent>{schemes.map(s => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                        {(["pdf", "pptx"] as const).map(as => {
                          const working = busy === `${def.key}:${as}`;
                          return (
                            <Button key={as} type="button" size="sm" variant={as === "pdf" ? "default" : "outline"} className="min-h-[44px] sm:min-h-0" disabled={blocked || !!busy}
                              onClick={() => exportReport(def, as)} data-testid={`landsec-report-export-${def.key}-${as}`}>
                              {working ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
                              {working ? "Making it" : as === "pdf" ? "PDF" : "PowerPoint"}
                            </Button>
                          );
                        })}
                        {board && (
                          <Button type="button" variant="outline" size="sm" className="min-h-[44px] sm:min-h-0" disabled={!period || noneTicked} onClick={() => setMarketOpen(true)} data-testid="landsec-report-board-market">
                            <PenLine className="mr-1 h-3.5 w-3.5" />
                            Market report
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] text-muted-foreground">The PDF and the PowerPoint are the same slides. In the PowerPoint the charts and tables can be edited. Each holds what is recorded in ChatBGP on the day it is made.</p>
            {period && !noneTicked && (
              <BoardMarketEditor open={marketOpen} onOpenChange={setMarketOpen} from={period.from} to={period.to} schemes={ticked ? chosen.map(s => s.key) : null} />
            )}
          </section>

          {exports.length > 0 && (
            <details className="group rounded-lg border bg-card" data-testid="landsec-reports-exports">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden" data-testid="landsec-reports-exports-toggle">
                <span className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-muted-foreground" />Data exports (Excel) <span className="font-mono text-xs tabular-nums text-muted-foreground">{exports.length}</span></span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <ul className="divide-y border-t">
                {exports.map(def => {
                  const working = busy === `${def.key}:${def.format}`;
                  return (
                    <li key={def.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`landsec-report-${def.key}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{def.title}</p>
                        <p className="text-xs text-muted-foreground">{def.description}</p>
                        <p className="text-[11px] text-muted-foreground">{def.period}{def.note ? ` ${def.note}` : ""}</p>
                      </div>
                      <Button type="button" variant="outline" size="sm" className="min-h-[44px] shrink-0 sm:min-h-0" disabled={!period || noneTicked || !!busy} onClick={() => exportReport(def)} data-testid={`landsec-report-export-${def.key}`}>
                        {working ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
                        {working ? "Making it" : "Excel"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
