// ─────────────────────────────────────────────────────────────────────────
// Mobile admin expenses — firm-wide spend + approvals on the phone.
//
// Two tabs, both backed by the SAME endpoints the desktop admin pages use
// (so the server doesn't care which surface drives them):
//
//   Spend ─────────────────────
//     /api/expenses/admin/summary — headline stats + spend by person +
//     spend by category for the selected range. Answers "who's spending
//     what" at a glance.
//
//   Approvals ─────────────────
//     /api/expenses/pending-approval — the approver's inbox, grouped by
//     submitter. Approve / reject per row, plus "approve all clean" per
//     group. Same approve / reject / bulk endpoints as the desktop inbox.
//
// Admin-gated: the summary + cardholder endpoints are requireAdmin, so a
// non-admin lands on a short "not authorised" note rather than a wall of
// failed requests.
// ─────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "wouter";
import ReceiptViewer from "@/components/receipt-viewer";
import {
  ChevronLeft, Loader2, Inbox, CheckCircle2, AlertCircle, Receipt, X,
  TrendingUp, Users, Snowflake, Banknote,
} from "lucide-react";

const fmt = (p: number) => `£${((p || 0) / 100).toFixed(2)}`;
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";

// Keep aligned with the FlagReason union in server/expense-approval.ts.
const FLAG_LABELS: Record<string, string> = {
  missing_receipt: "No receipt",
  entertainment_no_purpose: "No purpose given",
  entertainment_no_attendees: "No attendees listed",
  high_value_no_purpose: "Over £200, no purpose",
  possible_duplicate: "Possible duplicate",
  category_not_set: "No category",
};

// ─── Range presets (mirror the desktop Analysis selector) ────────────────
type RangeKey = "month" | "lastMonth" | "quarter" | "ytd" | "year";
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "year", label: "12 months" },
];

function rangeFor(key: RangeKey): { from: Date; to: Date } {
  const now = new Date();
  switch (key) {
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59) };
    case "lastMonth":
      return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59) };
    case "quarter":
      return { from: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1), to: now };
    case "ytd":
      return { from: new Date(now.getFullYear(), 0, 1), to: now };
    case "year":
      return { from: new Date(now.getFullYear() - 1, now.getMonth(), 1), to: now };
  }
}

interface AdminSummary {
  totalRangePence: number; totalRangeCount: number;
  pendingApproval: number; postedToXero: number; personalFlagged: number;
  byCardholder: Array<{ cardholderId: string; name: string; spentPence: number; txCount: number }>;
  byCategory: Array<{ category: string; count: number; pence: number }>;
}

interface PendingExpense {
  id: string;
  merchant: string | null;
  amountPence: number;
  category: string | null;
  transactionDate: string | null;
  businessPurpose: string | null;
  attendees: string | null;
  receiptFilename: string | null;
  submitterUserId: string | null;
  submitterName: string | null;
  cardholderName: string | null;
  flaggedForReview: boolean | null;
  flagReasons: string[] | null;
  attendeeContacts?: { id: string; name: string | null }[];
}

// ─── Spend tab ───────────────────────────────────────────────────────────

function SpendTab() {
  const [range, setRange] = useState<RangeKey>("month");
  const { from, to } = useMemo(() => rangeFor(range), [range]);

  const { data: summary, isLoading } = useQuery<AdminSummary>({
    queryKey: ["/api/expenses/admin/summary", from.toISOString(), to.toISOString()],
    queryFn: async () => {
      const url = `/api/expenses/admin/summary?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const people = (summary?.byCardholder || []).filter((c) => c.spentPence > 0);
  const peopleMax = people[0]?.spentPence || 0;
  const cats = summary?.byCategory || [];
  const catMax = cats[0]?.pence || 0;

  return (
    <div className="px-4 pb-8 space-y-5">
      {/* Range chips */}
      <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={`shrink-0 text-[12px] px-3 py-1.5 rounded-full border transition-colors ${
              range === r.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-muted-foreground active:bg-muted"
            }`}
            data-testid={`m-admin-range-${r.key}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
      ) : !summary ? (
        <p className="text-sm text-muted-foreground text-center py-8">Couldn't load spend.</p>
      ) : (
        <>
          {/* Headline stats */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total spend</div>
              <div className="text-xl font-bold mt-0.5">{fmt(summary.totalRangePence)}</div>
              <div className="text-[11px] text-muted-foreground">{summary.totalRangeCount} txns</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pending approval</div>
              <div className="text-xl font-bold mt-0.5 text-amber-600">{summary.pendingApproval}</div>
              <div className="text-[11px] text-muted-foreground">{summary.postedToXero} posted to Xero</div>
            </div>
          </div>

          {/* Spend by person */}
          <section>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Spend by person
            </h2>
            {people.length === 0 ? (
              <p className="text-xs text-muted-foreground">No spend in this range.</p>
            ) : (
              <div className="space-y-2">
                {people.map((c) => {
                  const pct = peopleMax > 0 ? Math.round((c.spentPence / peopleMax) * 100) : 0;
                  return (
                    <div key={c.cardholderId} data-testid={`m-admin-person-${c.cardholderId}`}>
                      <div className="flex items-baseline justify-between text-[13px] mb-1">
                        <span className="font-medium truncate pr-2">{c.name}</span>
                        <span className="font-mono shrink-0">{fmt(c.spentPence)}</span>
                      </div>
                      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500/70 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{c.txCount} txns</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Spend by category */}
          <section>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" /> Spend by category
            </h2>
            {cats.length === 0 ? (
              <p className="text-xs text-muted-foreground">No spend in this range.</p>
            ) : (
              <div className="space-y-2">
                {cats.map((c) => {
                  const pct = catMax > 0 ? Math.round((c.pence / catMax) * 100) : 0;
                  return (
                    <div key={c.category}>
                      <div className="flex items-baseline justify-between text-[13px] mb-1">
                        <span className="font-medium truncate pr-2">{c.category}</span>
                        <span className="font-mono shrink-0">{fmt(c.pence)}</span>
                      </div>
                      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{c.count} txns</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ─── Approvals tab ─────────────────────────────────────────────────────────

function ApprovalsTab() {
  const { toast } = useToast();
  const [rejecting, setRejecting] = useState<PendingExpense | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: rows = [], isLoading } = useQuery<PendingExpense[]>({
    queryKey: ["/api/expenses/pending-approval"],
  });

  const grouped = useMemo(() => {
    const byUser = new Map<string, { name: string; clean: PendingExpense[]; flagged: PendingExpense[] }>();
    for (const r of rows) {
      const key = r.submitterUserId || r.cardholderName || "Unknown";
      const display = r.submitterName || r.cardholderName || "Unknown submitter";
      if (!byUser.has(key)) byUser.set(key, { name: display, clean: [], flagged: [] });
      const bucket = byUser.get(key)!;
      if (r.flaggedForReview) bucket.flagged.push(r); else bucket.clean.push(r);
    }
    return Array.from(byUser.entries()).map(([key, v]) => ({ key, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const approveMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/expenses/${id}/approve`, {})).json(),
    onSuccess: (json: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/admin/summary"] });
      toast(json?.advanced
        ? { title: "Info check done", description: "Passed to a director for spend sign-off." }
        : { title: "Approved", description: "Final sign-off — posting to Xero." });
    },
    onError: (e: any) => toast({ title: "Approve failed", description: e?.message, variant: "destructive" }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => (await apiRequest("POST", `/api/expenses/approve-bulk`, { ids })).json(),
    onSuccess: (json: any) => {
      // Server responds immediately and processes in the background (see
      // expenses-approvals.tsx) — stagger refreshes so rows clear as they go.
      toast({ title: `Approving ${json.queued ?? "the selected"} expenses`, description: "Running in the background — the list clears as each one completes." });
      const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] });
        queryClient.invalidateQueries({ queryKey: ["/api/expenses/admin/summary"] });
      };
      refresh();
      [3000, 8000, 15000, 30000, 60000, 120000].forEach((ms) => setTimeout(refresh, ms));
    },
    onError: (e: any) => toast({ title: "Bulk approve failed", description: e?.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => (await apiRequest("POST", `/api/expenses/${id}/reject`, { reason })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] });
      setRejecting(null);
      setRejectReason("");
      toast({ title: "Rejected" });
    },
    onError: (e: any) => toast({ title: "Reject failed", description: e?.message, variant: "destructive" }),
  });

  const busy = approveMutation.isPending || bulkApproveMutation.isPending;

  if (isLoading) {
    return <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>;
  }

  if (rows.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <Inbox className="w-12 h-12 mx-auto mb-3 text-muted-foreground/60" />
        <h2 className="text-base font-semibold">Inbox zero</h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
          Nothing waiting for your approval. Expenses from your direct reports show up here, plus the shared inbox for anyone without a manager set.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-8 space-y-4">
      <p className="text-[11px] text-muted-foreground">
        {rows.length} pending · {rows.filter((r) => r.flaggedForReview).length} flagged for review
      </p>

      {grouped.map((group) => {
        const cleanIds = group.clean.map((r) => r.id);
        return (
          <div key={group.key} className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60">
              <span className="text-sm font-semibold truncate">{group.name}</span>
              <span className="text-[11px] text-muted-foreground shrink-0">
                {group.clean.length} clean{group.flagged.length > 0 ? ` · ${group.flagged.length} flagged` : ""}
              </span>
            </div>

            {group.clean.length > 0 && (
              <button
                type="button"
                onClick={() => bulkApproveMutation.mutate(cleanIds)}
                disabled={busy}
                className="w-full flex items-center justify-center gap-1.5 py-2 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 text-[12px] font-medium active:bg-emerald-100 disabled:opacity-60"
                data-testid={`m-admin-approve-all-${group.key}`}
              >
                {bulkApproveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Approve all {group.clean.length} clean
              </button>
            )}

            <div className="divide-y divide-border/60">
              {[...group.clean, ...group.flagged].map((r) => (
                <ApprovalRow
                  key={r.id}
                  r={r}
                  busy={busy}
                  onApprove={() => approveMutation.mutate(r.id)}
                  onReject={() => setRejecting(r)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Reject sheet */}
      <Sheet open={!!rejecting} onOpenChange={(v) => { if (!v) { setRejecting(null); setRejectReason(""); } }}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle>Reject expense</SheetTitle>
          </SheetHeader>
          {rejecting && (
            <div className="space-y-3 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <div className="text-sm">
                <div><strong>{rejecting.merchant || "—"}</strong> · {fmt(rejecting.amountPence)}</div>
                <div className="text-xs text-muted-foreground">
                  {rejecting.submitterName || rejecting.cardholderName} · {fmtDate(rejecting.transactionDate)}
                </div>
              </div>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason (the submitter sees this) — e.g. personal lunch, please mark personal and resubmit"
                rows={3}
                className="text-sm"
                data-testid="m-admin-reject-reason"
              />
              <Button
                variant="destructive"
                className="w-full h-11"
                disabled={rejectMutation.isPending || !rejectReason.trim()}
                onClick={() => rejecting && rejectMutation.mutate({ id: rejecting.id, reason: rejectReason })}
                data-testid="m-admin-reject-confirm"
              >
                {rejectMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Reject expense
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ApprovalRow({ r, busy, onApprove, onReject }: { r: PendingExpense; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const attendees = (r.attendeeContacts && r.attendeeContacts.length > 0)
    ? r.attendeeContacts.map((c) => c.name).filter(Boolean).join(", ")
    : r.attendees || null;
  const [showReceipt, setShowReceipt] = useState(false);
  return (
    <div className="p-3" data-testid={`m-admin-approval-${r.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-[14px] truncate">{r.merchant || "—"}</span>
            {r.receiptFilename && (
              <button
                type="button"
                onClick={() => setShowReceipt(true)}
                className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 shrink-0 active:opacity-70"
                data-testid={`m-admin-view-receipt-${r.id}`}
              >
                <Receipt className="w-3 h-3" /> View
              </button>
            )}
            <ReceiptViewer open={showReceipt} onClose={() => setShowReceipt(false)} expenseId={r.id} filename={r.receiptFilename} title="Receipt" />
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {fmtDate(r.transactionDate)}{r.category ? ` · ${r.category}` : ""}
          </div>
        </div>
        <span className="font-mono text-[14px] font-semibold shrink-0">{fmt(r.amountPence)}</span>
      </div>

      {(r.businessPurpose || attendees) && (
        <div className="text-[11px] text-muted-foreground mt-1.5 space-y-0.5">
          {r.businessPurpose && <div className="line-clamp-2">{r.businessPurpose}</div>}
          {attendees && <div className="truncate">w/ {attendees}</div>}
        </div>
      )}

      {r.flaggedForReview && r.flagReasons && r.flagReasons.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {r.flagReasons.map((reason) => (
            <span key={reason} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
              <AlertCircle className="w-2.5 h-2.5" />{FLAG_LABELS[reason] || reason}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2 mt-2.5">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="flex-1 h-9 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold active:bg-emerald-700 disabled:opacity-60"
          data-testid={`m-admin-approve-${r.id}`}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="h-9 px-4 rounded-lg border border-red-200 text-red-600 text-[13px] font-semibold active:bg-red-50 disabled:opacity-60"
          data-testid={`m-admin-reject-${r.id}`}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// ─── Payroll tab ─────────────────────────────────────────────────────────
// What's been marked personal this month and needs deducting from
// payroll, plus a "Run month-end freeze now" button for testing the
// freeze sweep without waiting for the 1st.

interface PayrollPayload {
  month: string;
  totalPence: number;
  groups: Array<{ userId: string | null; userName: string; totalPence: number; rows: Array<{ id: string; merchant: string | null; amountPence: number; transactionDate: string | null }> }>;
}

function PayrollTab() {
  const { toast } = useToast();
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });

  const { data, isLoading } = useQuery<PayrollPayload>({
    queryKey: ["/api/expenses/admin/payroll-deductions", month],
    queryFn: async () => {
      const r = await fetch(`/api/expenses/admin/payroll-deductions?month=${encodeURIComponent(month)}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  // Firm-wide Xero health. If disconnected, the auto-post-to-Xero flow on
  // expense approval is silently no-op-ing — admin needs to reconnect.
  const { data: xeroStatus } = useQuery<{ connected: boolean; tenantId: string | null; expiresAt: number | null }>({
    queryKey: ["/api/xero/system-status"],
    refetchInterval: 60_000,
  });

  const runFreezeMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/expenses/admin/run-month-end-freeze", {})).json(),
    onSuccess: (json: any) => {
      const n = json?.frozen?.length || 0;
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/cardholders"] });
      toast({
        title: n > 0 ? `Froze ${n} card(s)` : "Nothing to freeze",
        description: n > 0
          ? json.frozen.map((f: any) => `${f.userName} · ${f.blockingCount} missing`).join("\n")
          : `${json?.skipped || 0} cardholders checked — all clear or exempt`,
      });
    },
    onError: (e: any) => toast({ title: "Sweep failed", description: e?.message, variant: "destructive" }),
  });

  // Revolut API-scope probe. Tells you exactly which of the four scopes
  // are granted on the current token — the "Card Details says 403"
  // diagnostic loop should start here.
  const probeScopesMutation = useMutation({
    mutationFn: async () => (await fetch("/api/revolut/probe-scopes", { credentials: "include" })).json(),
    onSuccess: (json: any) => {
      const checks: Array<{ scope: string; label: string; ok: boolean; status: number | null; error: string | null }> = json?.checks || [];
      const fails = checks.filter(c => !c.ok);
      toast({
        title: fails.length === 0 ? "All Revolut scopes granted" : `${fails.length} scope(s) missing`,
        description: fails.length === 0
          ? checks.map(c => `✓ ${c.scope} — ${c.label}`).join("\n")
          : fails.map(c => `✗ ${c.scope} — ${c.error || `HTTP ${c.status}`}`).join("\n"),
        variant: fails.length === 0 ? "default" : "destructive",
      });
    },
    onError: (e: any) => toast({ title: "Scope probe failed", description: e?.message, variant: "destructive" }),
  });

  // Re-authorise Revolut. Hits the server for the consent URL (built
  // from REVOLUT_CLIENT_ID + the current host's callback path) and opens
  // it. After approving on Revolut's side, the existing callback handler
  // swaps the code for a fresh refresh token with whatever scopes the
  // cert was just granted.
  const openConsentMutation = useMutation({
    mutationFn: async () => (await fetch("/api/revolut/consent-url", { credentials: "include" })).json(),
    onSuccess: (json: any) => {
      if (json?.consentUrl) {
        window.location.href = json.consentUrl;
      } else {
        toast({ title: "Couldn't build consent URL", description: json?.error || "Unknown error", variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Couldn't build consent URL", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="px-4 pb-8 space-y-4">
      {/* Xero reconnect prompt. The system Xero session powers
          auto-post-on-approval; if its refresh token gets consumed in a
          parallel race (now prevented by a mutex in refreshXeroToken, but
          this banner is the recovery path) every approve-to-Xero call
          silently no-ops. Tapping the link drops the user into the OAuth
          flow; the callback writes the new tokens as the system session. */}
      {xeroStatus && !xeroStatus.connected && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-red-900">Xero not connected</div>
              <p className="text-[11px] text-red-800 mt-0.5">
                Approved expenses are not being posted to Xero because the firm-wide Xero session has expired. Reconnect to resume auto-posting.
              </p>
              <a
                href="/api/xero/connect"
                className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-red-600 text-white text-[12px] font-semibold active:scale-95 transition-transform"
                data-testid="m-admin-reconnect-xero"
              >
                Reconnect Xero
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Month picker */}
      <div className="flex items-center gap-2">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-sm"
          data-testid="m-admin-payroll-month"
        />
      </div>

      {/* Run freeze sweep — admin testing helper */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-start gap-2">
          <Snowflake className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-amber-900">Month-end freeze sweep</div>
            <p className="text-[11px] text-amber-800 mt-0.5">
              Runs automatically on the 1st of each month at 09:00 UTC. Freezes any non-admin cardholder with a Revolut swipe older than 3 days still missing a receipt (and ≥ £10).
            </p>
            <button
              type="button"
              onClick={() => runFreezeMutation.mutate()}
              disabled={runFreezeMutation.isPending}
              className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-amber-600 text-white text-[12px] font-semibold active:scale-95 transition-transform disabled:opacity-60"
              data-testid="m-admin-run-freeze"
            >
              {runFreezeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Snowflake className="w-3.5 h-3.5" />}
              Run sweep now
            </button>
          </div>
        </div>
      </div>

      {/* Revolut scope probe — diagnostic for the 'card details 403' loop.
          Hits each scoped endpoint and reports which scopes the current
          token actually has, so you know what to fix in Revolut Business
          → APIs without re-bootstrapping blindly. */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900">Revolut API scopes</div>
            <p className="text-[11px] text-slate-700 mt-0.5">
              Tap to probe the live token. If "Reveal card PAN" fails with 403, that's why Card Details shows the scope error — re-auth on Revolut Business with READ_SENSITIVE_CARD_DATA added.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => probeScopesMutation.mutate()}
                disabled={probeScopesMutation.isPending}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-slate-700 text-white text-[12px] font-semibold active:scale-95 transition-transform disabled:opacity-60"
                data-testid="m-admin-probe-revolut"
              >
                {probeScopesMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertCircle className="w-3.5 h-3.5" />}
                Probe scopes
              </button>
              <button
                type="button"
                onClick={() => openConsentMutation.mutate()}
                disabled={openConsentMutation.isPending}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-slate-900 text-white text-[12px] font-semibold active:scale-95 transition-transform disabled:opacity-60"
                data-testid="m-admin-reauth-revolut"
              >
                {openConsentMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Re-authorise Revolut
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Payroll deductions */}
      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Banknote className="w-3.5 h-3.5" /> Payroll deductions
          </h2>
          {data && <span className="text-sm font-bold font-mono">{fmt(data.totalPence)}</span>}
        </div>
        {isLoading ? (
          <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
        ) : !data || data.groups.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            Nothing marked personal in {month}. When a user marks an expense personal it shows up here for payroll.
          </p>
        ) : (
          <div className="space-y-2">
            {data.groups.map((g) => (
              <div key={g.userId || g.userName} className="rounded-2xl border border-border bg-card p-3" data-testid={`m-admin-payroll-${g.userId || g.userName}`}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm font-semibold truncate pr-2">{g.userName}</span>
                  <span className="font-mono text-sm font-bold shrink-0">{fmt(g.totalPence)}</span>
                </div>
                <div className="space-y-0.5">
                  {g.rows.map((r) => (
                    <div key={r.id} className="text-[11px] text-muted-foreground flex items-center justify-between gap-2">
                      <span className="truncate">{r.merchant || "—"} · {fmtDate(r.transactionDate)}</span>
                      <span className="font-mono shrink-0">{fmt(r.amountPence)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Page shell ────────────────────────────────────────────────────────────

export default function MobileAdminExpenses() {
  const [tab, setTab] = useState<"spend" | "approvals" | "payroll">("spend");
  const { data: user, isLoading: userLoading } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  // Pending count for the Approvals tab badge.
  const { data: pending = [] } = useQuery<PendingExpense[]>({
    queryKey: ["/api/expenses/pending-approval"],
    enabled: !!user?.isAdmin,
  });

  if (!userLoading && user && !user.isAdmin) {
    return (
      <div className="px-6 py-16 text-center">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground/60" />
        <h1 className="text-base font-semibold">Admins only</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Firm-wide spend and approvals are limited to admin users.
        </p>
        <Link href="/m/expenses" className="inline-block mt-4 text-sm text-primary font-medium">
          Go to my expenses
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-24" data-testid="mobile-admin-expenses">
      {/* Header */}
      <div
        className="px-4 pb-2 flex items-center gap-3 border-b border-border/40 bg-background/95 backdrop-blur sticky top-0 z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <Link href="/" className="p-2 -ml-2 rounded-full active:bg-gray-100">
          <ChevronLeft className="w-6 h-6" />
        </Link>
        <h1 className="text-2xl font-semibold flex-1">Expenses</h1>
        {/* Scope toggle — mirrors the one on /m/expenses so admins can
            flip back to their personal view without going via Home. */}
        <div className="flex rounded-full bg-muted p-0.5 text-[12px] font-medium" data-testid="m-admin-scope-toggle">
          <Link href="/m/expenses" className="px-3 py-1 rounded-full text-muted-foreground active:bg-background/60">Mine</Link>
          <span className="px-3 py-1 rounded-full bg-background shadow-sm">Team</span>
        </div>
      </div>

      {/* Tab toggle */}
      <div className="px-4 pt-3">
        <div className="flex rounded-full bg-muted p-1 text-[13px]">
          <button
            type="button"
            onClick={() => setTab("spend")}
            className={`flex-1 py-2 rounded-full font-medium transition-colors ${tab === "spend" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            data-testid="m-admin-tab-spend"
          >
            Spend
          </button>
          <button
            type="button"
            onClick={() => setTab("approvals")}
            className={`flex-1 py-2 rounded-full font-medium transition-colors flex items-center justify-center gap-1 ${tab === "approvals" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            data-testid="m-admin-tab-approvals"
          >
            Approvals
            {pending.length > 0 && (
              <span className="text-[10px] min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white font-semibold flex items-center justify-center">
                {pending.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab("payroll")}
            className={`flex-1 py-2 rounded-full font-medium transition-colors ${tab === "payroll" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            data-testid="m-admin-tab-payroll"
          >
            Payroll
          </button>
        </div>
      </div>

      <div className="pt-4">
        {tab === "spend" ? <SpendTab /> : tab === "approvals" ? <ApprovalsTab /> : <PayrollTab />}
      </div>
    </div>
  );
}
