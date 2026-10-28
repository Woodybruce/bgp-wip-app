// Xero invoices to match — the WIP's Needs Attention card for invoices
// approved or paid in Xero that no deal claims (Woody, 2026-10-28: deals
// read Invoiced once the invoice has gone out). The hourly matcher links
// what it can; accounts put the Sage job number in the Xero reference and
// the app only knows job numbers that came through the WIP import, so the
// rest get a hand here: a suggestion pill, Find deal…, or Not a deal.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, invalidateDealCaches, queryClient } from "@/lib/queryClient";
import { legacyToCode, DEAL_STATUS_LABELS } from "@shared/deal-status";

type Suggestion = { id: string; dealRef: number | null; name: string | null; status: string | null; fee: number | null; why: string };
type UnmatchedInvoice = {
  xeroInvoiceId: string;
  invoiceNumber: string | null;
  reference: string | null;
  contactName: string | null;
  date: string | null;
  dueDate: string | null;
  status: string | null;
  total: number | null;
  net: number | null;
  firstLine: string | null;
  xeroUrl: string;
  suggestions: Suggestion[];
};
type IgnoredInvoice = { xeroInvoiceId: string; invoiceNumber: string | null; by: string | null; at: string; reason: string | null; xeroUrl: string };
type UnmatchedResponse = { invoices: UnmatchedInvoice[]; ignored: IgnoredInvoice[]; checked: number; sinceDays: number; cachedAt: string | null };
type DealHit = { id: string; dealRef: number | null; name: string | null; status: string | null; fee: number | null };

const UNMATCHED_KEY = ["/api/xero/invoices/unmatched"];
const money = (n: number | null | undefined) => n == null ? "—" : `£${Math.round(n).toLocaleString("en-GB")}`;
const shortDate = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
};
const statusLabel = (s: string | null) => { const c = legacyToCode(s); return c ? DEAL_STATUS_LABELS[c] : (s || "—"); };
const dealLabel = (d: { dealRef: number | null; name: string | null }) => `${d.dealRef ? `#${d.dealRef} ` : ""}${d.name || "(unnamed deal)"}`;

function refreshAfterChange() {
  queryClient.invalidateQueries({ queryKey: UNMATCHED_KEY });
  queryClient.invalidateQueries({ queryKey: ["/api/wip/health"] });
}

// Find deal… — searches by Ref # or name server-side (the WIP's own list
// only carries deals already on the report), one pill per hit.
function DealFinder({ onPick, busy }: { onPick: (d: DealHit) => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const term = q.trim();
  const { data: hits = [], isFetching } = useQuery<DealHit[]>({
    queryKey: ["/api/xero/invoices/deal-search", term],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/xero/invoices/deal-search?q=${encodeURIComponent(term)}`);
      return r.json();
    },
    enabled: term.length >= 2,
    staleTime: 60_000,
    refetchInterval: false,
  });
  return (
    <div className="mt-2 space-y-1.5" data-testid="xero-unmatched-finder">
      <input
        type="search"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Ref # or deal name…"
        className="w-full sm:w-72 h-11 md:h-8 px-2.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:border-ring"
        data-testid="xero-unmatched-finder-input"
      />
      {term.length >= 2 && (
        <div className="flex flex-wrap gap-1.5">
          {isFetching && hits.length === 0 && <span className="text-[11px] text-muted-foreground">Searching…</span>}
          {!isFetching && hits.length === 0 && <span className="text-[11px] text-muted-foreground">No deal matches "{term}".</span>}
          {hits.map(d => (
            <Pill key={d.id} onClick={() => onPick(d)} disabled={busy} className="max-w-full normal-case tracking-normal" data-testid={`xero-unmatched-hit-${d.id}`}>
              <span className="truncate">{dealLabel(d)}</span>
              <span className="text-muted-foreground"> · {statusLabel(d.status)}{d.fee != null ? ` · ${money(d.fee)}` : ""}</span>
            </Pill>
          ))}
        </div>
      )}
    </div>
  );
}

export function XeroUnmatchedCard() {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<UnmatchedResponse>({
    queryKey: UNMATCHED_KEY,
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/xero/invoices/unmatched");
      return r.json();
    },
    staleTime: 5 * 60_000,
    refetchInterval: false,
    retry: false,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [finderFor, setFinderFor] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);

  const link = async (inv: UnmatchedInvoice, deal: { id: string; dealRef: number | null; name: string | null }) => {
    if (!window.confirm(`Link Xero invoice ${inv.invoiceNumber || ""} (${inv.contactName || "no contact"}, ${money(inv.net)} net) to ${dealLabel(deal)}?\n\nThe deal moves to Invoiced if it isn't already.`)) return;
    setBusyId(inv.xeroInvoiceId);
    try {
      const r = await apiRequest("POST", "/api/xero/invoices/link", { xeroInvoiceId: inv.xeroInvoiceId, dealId: deal.id });
      const j = await r.json();
      const ref = j.dealRef ? `#${j.dealRef}` : (j.dealName || "the deal");
      toast({ title: j.promoted ? `Linked to ${ref} — deal now Invoiced` : `Linked to ${ref}`, description: j.promoted ? undefined : (j.alreadyInvoiced ? "The deal was already Invoiced." : "Invoice linked; the deal's status was left as it is.") });
      setFinderFor(null);
      refreshAfterChange();
      invalidateDealCaches(deal.id);
    } catch (e: any) {
      toast({ title: "Couldn't link the invoice", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const ignore = async (inv: UnmatchedInvoice) => {
    const reason = window.prompt(`Set aside Xero invoice ${inv.invoiceNumber || ""} as not a deal (consultancy retainer, disbursement…)?\n\nReason (optional):`, "");
    if (reason === null) return;
    setBusyId(inv.xeroInvoiceId);
    try {
      await apiRequest("POST", "/api/xero/invoices/ignore", { xeroInvoiceId: inv.xeroInvoiceId, invoiceNumber: inv.invoiceNumber, reason: reason.trim() || undefined });
      toast({ title: `${inv.invoiceNumber || "Invoice"} set aside`, description: "It won't be offered again — restore it from the Set aside list if that was wrong." });
      refreshAfterChange();
    } catch (e: any) {
      toast({ title: "Couldn't set the invoice aside", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (ig: IgnoredInvoice) => {
    setBusyId(ig.xeroInvoiceId);
    try {
      await apiRequest("DELETE", `/api/xero/invoices/ignore/${encodeURIComponent(ig.xeroInvoiceId)}`);
      toast({ title: `${ig.invoiceNumber || "Invoice"} back on the list` });
      refreshAfterChange();
    } catch (e: any) {
      toast({ title: "Couldn't restore the invoice", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const invoices = data?.invoices || [];
  const ignored = data?.ignored || [];
  const netTotal = invoices.reduce((s, i) => s + (i.net || 0), 0);

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden" data-testid="xero-unmatched-card">
      <div className="px-4 py-2.5 border-b bg-muted/50 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            Xero invoices to match{" "}
            {data && <span className="text-muted-foreground font-normal">({invoices.length}{netTotal ? ` · ${money(netTotal)} net` : ""})</span>}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Accounts put the Sage job number in the Xero reference; the app only knows job numbers that came through the WIP import, so these need a hand. Link each to its deal and it reads Invoiced.
          </p>
        </div>
        {data && invoices.length > 0 && (
          <Badge variant="secondary" className="text-[10px] shrink-0 font-mono tabular-nums" data-testid="xero-unmatched-count">{invoices.length}</Badge>
        )}
      </div>

      {isLoading ? (
        <div className="p-4"><Skeleton className="h-16 w-full" /></div>
      ) : error ? (
        <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="xero-unmatched-error">
          Couldn't list Xero invoices — {(error as any)?.message?.replace(/^\d{3}:\s*/, "") || "try again shortly"}.
        </p>
      ) : invoices.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="xero-unmatched-empty">
          Nothing waiting — every invoice approved or paid in Xero in the last {data?.sinceDays || 180} days is on a deal.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {invoices.map(inv => {
            const busy = busyId === inv.xeroInvoiceId;
            return (
              <div key={inv.xeroInvoiceId} className="px-4 py-2.5 text-sm" data-testid={`xero-unmatched-${inv.xeroInvoiceId}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <a href={inv.xeroUrl} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{inv.invoiceNumber || "No number"}</a>
                      <span className="text-xs text-muted-foreground">{shortDate(inv.date)}</span>
                      <Badge variant="secondary" className="text-[10px]">{inv.status === "PAID" ? "Paid" : inv.status === "AUTHORISED" ? "Sent" : inv.status || "—"}</Badge>
                    </p>
                    <p className="truncate">{inv.contactName || "No contact"}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {inv.reference ? `Ref ${inv.reference}` : "No reference"}{inv.firstLine ? ` · ${inv.firstLine}` : ""}
                    </p>
                  </div>
                  <span className="font-mono tabular-nums text-xs shrink-0 text-right">
                    {money(inv.net)}
                    <span className="block text-[10px] text-muted-foreground">net</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {inv.suggestions.map(s => (
                    <Pill
                      key={s.id}
                      onClick={() => link(inv, s)}
                      disabled={busy}
                      title={s.why}
                      className="max-w-full normal-case tracking-normal"
                      data-testid={`xero-unmatched-suggest-${inv.xeroInvoiceId}-${s.id}`}
                    >
                      <span className="truncate">{dealLabel(s)}</span>
                      {s.fee != null && <span className="font-mono tabular-nums"> · {money(s.fee)}</span>}
                    </Pill>
                  ))}
                  <Pill active={finderFor === inv.xeroInvoiceId} onClick={() => setFinderFor(f => f === inv.xeroInvoiceId ? null : inv.xeroInvoiceId)} disabled={busy} data-testid={`xero-unmatched-find-${inv.xeroInvoiceId}`}>
                    Find deal…
                  </Pill>
                  <Pill onClick={() => ignore(inv)} disabled={busy} data-testid={`xero-unmatched-ignore-${inv.xeroInvoiceId}`}>
                    Not a deal
                  </Pill>
                  {busy && <span className="text-[11px] text-muted-foreground">Saving…</span>}
                </div>
                {finderFor === inv.xeroInvoiceId && <DealFinder busy={busy} onPick={(d) => link(inv, d)} />}
              </div>
            );
          })}
        </div>
      )}

      {ignored.length > 0 && (
        <div className="border-t border-border px-4 py-2" data-testid="xero-unmatched-ignored">
          <button type="button" onClick={() => setShowIgnored(v => !v)} className="text-[11px] text-muted-foreground hover:text-foreground" data-testid="xero-unmatched-ignored-toggle">
            {showIgnored ? "Hide" : "Show"} set aside ({ignored.length})
          </button>
          {showIgnored && (
            <div className="mt-1.5 space-y-1">
              {ignored.map(ig => (
                <div key={ig.xeroInvoiceId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <a href={ig.xeroUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{ig.invoiceNumber || ig.xeroInvoiceId.slice(0, 8)}</a>
                  <span className="text-muted-foreground">{shortDate(ig.at)}{ig.reason ? ` · ${ig.reason}` : ""}</span>
                  <Pill onClick={() => restore(ig)} disabled={busyId === ig.xeroInvoiceId} data-testid={`xero-unmatched-restore-${ig.xeroInvoiceId}`}>Restore</Pill>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {data?.cachedAt && invoices.length > 0 && (
        <p className="px-4 pb-2 text-[10px] text-muted-foreground">
          Xero list as of {new Date(data.cachedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} (refreshes every 10 minutes). Linked deals open from the <Link href="/deals/list"><span className="underline cursor-pointer">Deals list</span></Link>.
        </p>
      )}
    </div>
  );
}
