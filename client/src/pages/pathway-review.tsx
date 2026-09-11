import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Check, ExternalLink, FileSpreadsheet, Briefcase, Loader2, ChevronDown, ChevronRight, Inbox } from "lucide-react";

interface ReviewQueueItem {
  runId: string;
  propertyId: string | null;
  address: string;
  postcode: string | null;
  propertyName: string | null;
  gate: 3 | 6 | 7;
  gateLabel: string;
  waitingSince: string | null;
  startedBy: string | null;
  startedByName: string | null;
  price: number | null;
  niy: number | null;
  irr: number | null;
  moic: number | null;
  strategy: string | null;
  holdPeriodYrs: number | null;
  summary: string | null;
  recommendProceed: boolean | null;
  modelVersionLabel: string | null;
  workbookUrl: string | null;
}

function fmtMoney(v: number | null): string {
  if (v == null || !isFinite(v)) return "—";
  if (Math.abs(v) >= 1_000_000) return `£${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 2).replace(/\.?0+$/, "")}m`;
  if (Math.abs(v) >= 1_000) return `£${Math.round(v / 1_000)}k`;
  return `£${v.toLocaleString("en-GB")}`;
}

function fmtPct(v: number | null): string {
  if (v == null || !isFinite(v)) return "—";
  // Plans store decimals (0.0525) but hand-patched ones sometimes hold
  // whole percentages (5.25) — render both sensibly.
  const pct = v <= 1 ? v * 100 : v;
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 2).replace(/\.?0+$/, "")}%`;
}

function fmtMoic(v: number | null): string {
  if (v == null || !isFinite(v)) return "—";
  return `${v.toFixed(2).replace(/\.?0+$/, "")}x`;
}

function waitingLabel(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d waiting`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h waiting`;
  return "under an hour";
}

const GATE_META: Record<number, { label: string; action: string; icon: typeof Check; hint: string }> = {
  3: { label: "Review & Confirm", action: "Confirm & continue", icon: Check, hint: "Approving runs Property Intelligence + Investigation Board (stages 4–6)" },
  6: { label: "Business Plan", action: "Agree plan", icon: Briefcase, hint: "Agreeing locks the plan and builds the Excel model (stage 7)" },
  7: { label: "Excel Model", action: "Agree model", icon: FileSpreadsheet, hint: "Agreeing locks the model and runs Studio Time + Why Buy (stages 8–9)" },
};

export default function PathwayReview() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  // Rows the user has actioned this visit — kept visible with a "done"
  // state instead of vanishing, so ten quick approvals stay reviewable.
  const [approved, setApproved] = useState<Set<string>>(new Set());

  const { data: items, isLoading } = useQuery<ReviewQueueItem[]>({
    queryKey: ["/api/property-pathway/review-queue"],
    queryFn: getQueryFn({ on401: "throw" }),
    refetchInterval: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: async (item: ReviewQueueItem) => {
      if (item.gate === 3) {
        await apiRequest("POST", `/api/property-pathway/${item.runId}/advance`, { stage: 4, async: true });
      } else if (item.gate === 6) {
        await apiRequest("POST", `/api/property-pathway/${item.runId}/business-plan/agree`, {});
      } else {
        await apiRequest("POST", `/api/property-pathway/${item.runId}/excel-model/agree`, {});
      }
      return item;
    },
    onSuccess: (item) => {
      setApproved(prev => new Set(prev).add(item.runId));
      const followOn = item.gate === 3 ? "running stages 4–6" : item.gate === 6 ? "building the Excel model" : "running Studio Time + Why Buy";
      toast({ title: `${item.propertyName || item.address} approved`, description: `Gate cleared — ${followOn} in the background.` });
      // Give the server a beat to flip stage statuses before refetching,
      // otherwise the row can bounce back into the list.
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/property-pathway/review-queue"] }), 4000);
    },
    onError: (err: any, item) => {
      toast({ title: "Approval failed", description: `${item.propertyName || item.address}: ${err?.message || "unknown error"}`, variant: "destructive" });
    },
  });

  const pending = (items || []).filter(i => !approved.has(i.runId));
  const done = (items || []).filter(i => approved.has(i.runId));
  const grouped = [7, 6, 3].map(g => ({ gate: g, rows: pending.filter(i => i.gate === g) })).filter(g => g.rows.length > 0);

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every pathway run waiting on a human decision, with the numbers inline. Approve from here — the run picks itself up and flows to the next gate.
          </p>
        </div>
        <Link href="/property-pathway">
          <Button variant="outline" size="sm" className="shrink-0">Pathway board</Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : pending.length === 0 && done.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <Inbox className="w-10 h-10 mb-3 opacity-40" />
          <div className="text-sm font-medium">Nothing waiting on you</div>
          <div className="text-xs mt-1">Runs land here when they reach a sign-off gate.</div>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ gate, rows }) => {
            const meta = GATE_META[gate];
            return (
              <div key={gate}>
                <div className="flex items-baseline gap-2 mb-3">
                  <h2 className="text-sm font-medium">{meta.label}</h2>
                  <span className="text-xs text-muted-foreground">{rows.length} awaiting · {meta.hint}</span>
                </div>
                <div className="rounded-xl border bg-card divide-y overflow-hidden">
                  {rows.map(item => {
                    const isExpanded = expanded === item.runId;
                    const isApproving = approveMutation.isPending && approveMutation.variables?.runId === item.runId;
                    return (
                      <div key={item.runId} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <button
                            className="flex items-center gap-2 min-w-0 flex-1 text-left"
                            onClick={() => setExpanded(isExpanded ? null : item.runId)}
                            data-testid={`row-review-${item.runId}`}
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
                            <div className="min-w-0">
                              <div className="font-medium truncate">{item.propertyName || item.address}</div>
                              <div className="text-xs text-muted-foreground truncate">
                                {item.propertyName ? item.address : item.postcode || ""}
                                {item.startedByName ? ` · ${item.startedByName}` : ""}
                                {item.waitingSince ? ` · ${waitingLabel(item.waitingSince)}` : ""}
                              </div>
                            </div>
                          </button>

                          <div className="hidden md:flex items-center gap-5 text-sm tabular-nums">
                            <div className="text-right"><div className="text-[10px] uppercase text-muted-foreground">Price</div>{fmtMoney(item.price)}</div>
                            <div className="text-right"><div className="text-[10px] uppercase text-muted-foreground">NIY</div>{fmtPct(item.niy)}</div>
                            <div className="text-right"><div className="text-[10px] uppercase text-muted-foreground">IRR</div>{fmtPct(item.irr)}</div>
                            <div className="text-right"><div className="text-[10px] uppercase text-muted-foreground">MOIC</div>{fmtMoic(item.moic)}</div>
                          </div>

                          <div className="flex items-center gap-2 ml-auto">
                            {item.gate === 3 && item.recommendProceed === false && (
                              <Badge variant="destructive" className="text-[10px]">AI says pass</Badge>
                            )}
                            <Link href={`/property-pathway?runId=${item.runId}`}>
                              <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                                <ExternalLink className="w-3.5 h-3.5" /> Open
                              </Button>
                            </Link>
                            <Button
                              size="sm"
                              className="h-8 gap-1 text-xs"
                              disabled={isApproving}
                              onClick={() => approveMutation.mutate(item)}
                              data-testid={`button-approve-${item.runId}`}
                            >
                              {isApproving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                              {GATE_META[item.gate].action}
                            </Button>
                          </div>
                        </div>

                        {/* Mobile numbers row */}
                        <div className="flex md:hidden items-center gap-4 mt-2 ml-6 text-sm tabular-nums">
                          <span><span className="text-[10px] uppercase text-muted-foreground mr-1">Price</span>{fmtMoney(item.price)}</span>
                          <span><span className="text-[10px] uppercase text-muted-foreground mr-1">NIY</span>{fmtPct(item.niy)}</span>
                          <span><span className="text-[10px] uppercase text-muted-foreground mr-1">IRR</span>{fmtPct(item.irr)}</span>
                          <span><span className="text-[10px] uppercase text-muted-foreground mr-1">MOIC</span>{fmtMoic(item.moic)}</span>
                        </div>

                        {isExpanded && (
                          <div className="mt-3 ml-6 space-y-2 text-sm">
                            {item.strategy && (
                              <div><span className="text-xs uppercase text-muted-foreground mr-2">Strategy</span>{item.strategy}{item.holdPeriodYrs ? ` · ${item.holdPeriodYrs}yr hold` : ""}</div>
                            )}
                            {item.modelVersionLabel && (
                              <div><span className="text-xs uppercase text-muted-foreground mr-2">Model</span>{item.modelVersionLabel}</div>
                            )}
                            {item.summary && (
                              <p className="text-muted-foreground whitespace-pre-wrap">{item.summary}</p>
                            )}
                            {item.workbookUrl && (
                              <a href={item.workbookUrl} className="inline-flex items-center gap-1 text-primary hover:underline" target="_blank" rel="noreferrer">
                                <FileSpreadsheet className="w-3.5 h-3.5" /> Download workbook
                              </a>
                            )}
                            {!item.strategy && !item.summary && !item.modelVersionLabel && (
                              <p className="text-muted-foreground text-xs">No inline detail on this run — open it to review.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {done.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Approved this visit</h2>
              <div className="rounded-xl border bg-card divide-y overflow-hidden opacity-70">
                {done.map(item => (
                  <div key={item.runId} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="font-medium truncate">{item.propertyName || item.address}</span>
                    <span className="text-xs text-muted-foreground">{item.gateLabel} cleared — running on</span>
                    <Link href={`/property-pathway?runId=${item.runId}`} className="ml-auto">
                      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"><ExternalLink className="w-3 h-3" /> Open</Button>
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
