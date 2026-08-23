/**
 * Covenant Watch — the monitoring surface of the house covenant engine.
 * Left: live alerts (grade drops / new red flags from the nightly watcher).
 * Right: the watchlist with current grades. Companies get here automatically
 * via KYC checks and pathway runs, or via check_covenant with watch=true.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert, RefreshCw, Eye } from "lucide-react";
import { CovenantBadge } from "@/components/covenant-badge";

export default function CovenantWatch() {
  const { data: alerts = [], isLoading: alertsLoading } = useQuery<any[]>({
    queryKey: ["covenant-alerts"],
    queryFn: async () => (await apiRequest("GET", "/api/covenant/alerts")).json(),
    refetchInterval: 5 * 60 * 1000,
  });
  const { data: watchlist = [], isLoading: watchLoading } = useQuery<any[]>({
    queryKey: ["covenant-watchlist"],
    queryFn: async () => (await apiRequest("GET", "/api/covenant/watchlist")).json(),
  });
  const runNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/covenant/watch/run")).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["covenant-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["covenant-watchlist"] });
    },
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Covenant Watch</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            House financial-strength monitoring — Companies House, The Gazette and filed accounts. Recomputed nightly; alerts on any deterioration.
          </p>
        </div>
        <Button variant="outline" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
          <RefreshCw className={`w-4 h-4 mr-1 ${runNow.isPending ? "animate-spin" : ""}`} /> Re-check all now
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Alerts</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {alertsLoading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)
              : alerts.length === 0 ? <p className="text-sm text-muted-foreground py-4">No deterioration alerts. The nightly watcher reports here the moment a watched company files a new charge, goes overdue, or hits The Gazette.</p>
              : alerts.map((a: any) => (
                <div key={a.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{a.headline}</span>
                    {a.previous_grade && a.new_grade && a.previous_grade !== a.new_grade && (
                      <Badge variant="destructive" className="text-[10px]">{a.previous_grade} → {a.new_grade}</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{new Date(a.created_at).toLocaleString("en-GB")} · #{a.company_number}</p>
                </div>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Eye className="w-4 h-4" /> Watchlist ({watchlist.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {watchLoading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-lg" />)
              : watchlist.length === 0 ? <p className="text-sm text-muted-foreground py-4">Nothing watched yet. Companies are added automatically by KYC checks and pathway runs, or ask the chat: “check the covenant of X and watch it”.</p>
              : watchlist.map((w: any) => (
                <div key={w.company_number} className="flex items-center justify-between gap-2 border rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{w.company_name || w.label || w.company_number}</p>
                    <p className="text-[11px] text-muted-foreground">#{w.company_number}{w.computed_at ? ` · checked ${new Date(w.computed_at).toLocaleDateString("en-GB")}` : ""}</p>
                  </div>
                  <CovenantBadge companyNumber={w.company_number} />
                </div>
              ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
