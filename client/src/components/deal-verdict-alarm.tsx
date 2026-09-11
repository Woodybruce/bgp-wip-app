// Invoice-verdict alarm (Woody, 2026-08-19). Deals due to exchange/complete
// this month demand a verdict from their assigned agent: on track / slipping
// (new date) / ready to invoice. Until answered: an un-dismissable red
// banner on every page; 3+ days past target → a full-screen block. The only
// way out is to answer.
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CalendarClock, CheckCircle2, Receipt } from "lucide-react";

interface PendingDeal {
  id: string;
  name: string;
  propertyName: string | null;
  fee: number | null;
  targetDate: string;
  daysOverdue: number;
}

function VerdictRow({ deal }: { deal: PendingDeal }) {
  const [slipping, setSlipping] = useState(false);
  const [newDate, setNewDate] = useState("");
  const answer = useMutation({
    mutationFn: async (body: { verdict: string; newTargetDate?: string }) => {
      const r = await apiRequest("POST", `/api/deal-verdicts/${deal.id}`, body);
      const out = await r.json();
      if (!r.ok) throw new Error(out?.error || "Failed to save verdict");
      return out;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deal-verdicts/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
    },
  });

  return (
    <div className="rounded-md border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{deal.name}</div>
          <div className="text-xs text-muted-foreground">
            {deal.propertyName ? `${deal.propertyName} · ` : ""}
            target {new Date(deal.targetDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            {deal.daysOverdue > 0 && (
              <span className="ml-1 text-red-600 font-medium">· {deal.daysOverdue}d overdue</span>
            )}
          </div>
        </div>
        {deal.fee != null && (
          <div className="text-sm font-semibold whitespace-nowrap">£{deal.fee.toLocaleString()}</div>
        )}
      </div>
      {answer.isError && (
        <p className="text-xs text-red-600">{(answer.error as Error)?.message}</p>
      )}
      {slipping ? (
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="text-xs border rounded px-2 py-1.5 bg-background"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            data-testid={`verdict-newdate-${deal.id}`}
          />
          <Button
            size="sm"
            disabled={!newDate || answer.isPending}
            onClick={() => answer.mutate({ verdict: "slipping", newTargetDate: newDate })}
          >
            Save new date
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSlipping(false)}>Back</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
            disabled={answer.isPending}
            onClick={() => answer.mutate({ verdict: "on_track" })}
            data-testid={`verdict-ontrack-${deal.id}`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> On track
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-amber-700 border-amber-300 hover:bg-amber-50"
            disabled={answer.isPending}
            onClick={() => setSlipping(true)}
            data-testid={`verdict-slipping-${deal.id}`}
          >
            <CalendarClock className="w-3.5 h-3.5 mr-1" /> Slipping — new date
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-blue-700 border-blue-300 hover:bg-blue-50"
            disabled={answer.isPending}
            onClick={() => answer.mutate({ verdict: "invoice_now" })}
            data-testid={`verdict-invoice-${deal.id}`}
          >
            <Receipt className="w-3.5 h-3.5 mr-1" /> Ready to invoice
          </Button>
        </div>
      )}
    </div>
  );
}

export default function DealVerdictAlarm() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<{ count: number; maxDaysOverdue: number; deals: PendingDeal[] }>({
    queryKey: ["/api/deal-verdicts/pending"],
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  // While the nag banner is up, push the app shell down (iOS in-call-bar
  // style) so the header + global search stay usable underneath it.
  const nagVisible = !!data && data.count > 0 && data.maxDaysOverdue < 3;
  useEffect(() => {
    if (!nagVisible) return;
    document.documentElement.style.setProperty("--app-banner-offset", "34px");
    return () => { document.documentElement.style.removeProperty("--app-banner-offset"); };
  }, [nagVisible]);

  if (!data || data.count === 0) return null;

  const list = (
    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
      {data.deals.map((d) => <VerdictRow key={d.id} deal={d} />)}
    </div>
  );

  // 3+ days ignored → full-screen block. Only answering clears it.
  if (data.maxDaysOverdue >= 3) {
    return (
      <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-xl rounded-lg border-2 border-red-500 bg-card shadow-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="w-5 h-5" />
            <h2 className="text-base font-bold">Your deals need invoice verdicts before you carry on</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            {data.count} deal{data.count === 1 ? " has" : "s have"} passed or reached their target date without a verdict —
            the longest has waited {data.maxDaysOverdue} days. Answer each one to unlock the dashboard.
          </p>
          {list}
        </div>
      </div>
    );
  }

  // Standard nag: un-dismissable banner on every page.
  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-[90] bg-red-600 text-white flex items-center justify-center gap-3 px-3 py-1.5 text-sm shadow-md">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="font-medium">
          {data.count} deal{data.count === 1 ? "" : "s"} awaiting your invoice verdict
        </span>
        <button
          onClick={() => setOpen(true)}
          className="rounded bg-white/15 hover:bg-white/25 px-2.5 py-0.5 text-xs font-semibold transition-colors"
          data-testid="verdict-banner-answer"
        >
          Answer now
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-[95] bg-black/40 flex items-start justify-center pt-16 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl rounded-lg border bg-card shadow-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" /> Deals awaiting your verdict
            </h2>
            {list}
          </div>
        </div>
      )}
    </>
  );
}
