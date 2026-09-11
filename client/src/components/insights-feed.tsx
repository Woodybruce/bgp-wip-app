// Insights feed — the "what's happening" stream distilled from news,
// publisher market reports and portfolio activity. Sits beside News as a
// tab; the server slices client viewers to their categories + own-company
// rows. Theme badges show accumulation ("3rd signal since 12 Jul") so a
// building pattern reads differently from a one-off headline.
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb, Newspaper, FileText, Activity, RefreshCw, Loader2 } from "lucide-react";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Insight = {
  id: number;
  headline: string;
  detail: string | null;
  category: string | null;
  source_kind: "news" | "market-report" | "portfolio";
  evidence: any[] | null;
  created_at: string;
  theme_title: string | null;
  theme_strength: number | null;
  theme_first_seen: string | null;
};

const SOURCE_META: Record<string, { icon: any; label: string }> = {
  news: { icon: Newspaper, label: "Trade press" },
  "market-report": { icon: FileText, label: "Market report" },
  portfolio: { icon: Activity, label: "Your portfolio" },
};

const CATEGORY_TINT: Record<string, string> = {
  hospitality: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  retail: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  leisure: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  fitness: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  investment: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  offices: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  market: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

function insightTimeAgo(date: string): string {
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export function InsightsFeed({ isStaff = false }: { isStaff?: boolean }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ insights: Insight[] }>({
    queryKey: ["/api/insights"],
    queryFn: async () => {
      const r = await fetch("/api/insights?limit=40", { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error("Failed to load insights");
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
  const run = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/insights/run");
      return r.json();
    },
    onSuccess: (j: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/insights"] });
      toast({ title: "Insight legs run", description: `news ${j.news} · reports ${j.reports} · portfolio ${j.portfolio}` });
    },
    onError: (e: any) => toast({ title: "Run failed", description: e?.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>;
  }
  const insights = data?.insights || [];
  return (
    <div className="space-y-3" data-testid="insights-feed">
      {isStaff && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => run.mutate()} disabled={run.isPending} data-testid="insights-run-now">
            {run.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
            Distil now
          </Button>
        </div>
      )}
      {insights.length === 0 ? (
        <div className="text-center py-14 text-muted-foreground">
          <Lightbulb className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No insights yet — they appear within minutes of new market material arriving.</p>
        </div>
      ) : (
        insights.map(ins => {
          const src = SOURCE_META[ins.source_kind] || SOURCE_META.news;
          const SrcIcon = src.icon;
          return (
            <Card key={ins.id} className="overflow-hidden" data-testid={`insight-${ins.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Lightbulb className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug">{ins.headline}</p>
                    {ins.detail && <p className="text-[13px] text-muted-foreground leading-snug mt-1">{ins.detail}</p>}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {ins.category && (
                        <Badge className={`text-[10px] border-transparent capitalize ${CATEGORY_TINT[ins.category] || "bg-muted"}`}>{ins.category}</Badge>
                      )}
                      <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                        <SrcIcon className="w-3 h-3" />{src.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground">· {insightTimeAgo(ins.created_at)}</span>
                      {ins.theme_title && (ins.theme_strength || 0) > 1 && (
                        <Badge variant="outline" className="text-[10px]">
                          {ins.theme_strength}× signal{ins.theme_first_seen ? ` since ${new Date(ins.theme_first_seen).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""} — {ins.theme_title}
                        </Badge>
                      )}
                    </div>
                    {Array.isArray(ins.evidence) && ins.evidence.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ins.evidence.filter((e: any) => e.url || e.title).slice(0, 3).map((e: any, i: number) => (
                          e.url ? (
                            <a key={i} href={e.url} target="_blank" rel="noopener noreferrer"
                               className="text-[11px] text-primary hover:underline truncate max-w-[260px]">
                              {e.title || e.url}
                            </a>
                          ) : (
                            <span key={i} className="text-[11px] text-muted-foreground truncate max-w-[260px]">{e.title}</span>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
