// ─────────────────────────────────────────────────────────────────────────
// Mobile expenses — receipt-capture-first view.
//
// Designed for the most common in-the-wild flow: paid for a coffee with
// the card, got back to your desk an hour later, want to snap the
// receipt before you forget. The desktop /my-expenses page does a lot
// (cardholder dashboard, attendee picker, deal/property linking, Xero
// sync state, bulk import) — this strips that to:
//
//   1. Top: red banner with count of pending receipts. Tap → camera.
//   2. List of pending receipts (transaction matched but no photo yet)
//      with a per-row Snap button.
//   3. Recent expenses (last 20) below, status badge per row.
//
// Uses the same /api/expenses/me + /api/expenses/:id/receipt endpoints
// the desktop page hits, so nothing diverges server-side. Capture uses
// the standard <input type=file capture=environment> trick — opens the
// native camera on iOS Safari + Android Chrome with no native shell.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Camera, Receipt, CheckCircle2, AlertCircle, Loader2, ChevronLeft, Upload } from "lucide-react";
import { Link } from "wouter";

interface Expense {
  id: string;
  merchant: string | null;
  amountPence: number;
  status: string;
  category: string | null;
  transactionDate: string | null;
  receiptFilename: string | null;
}

interface MyData {
  cardholder: { id: string; userName: string } | null;
  card: { id: string; last4: string } | null;
  expenses: Expense[];
}

const fmtPence = (p: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format((p || 0) / 100);

const fmtDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

function StatusBadge({ status }: { status: string }) {
  if (status === "pending_receipt") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Receipt needed</span>;
  if (status === "receipt_uploaded") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">Receipt added</span>;
  if (status === "categorised") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">Categorised</span>;
  if (status === "approved") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">Approved</span>;
  if (status === "synced_to_xero") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">In Xero</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{status}</span>;
}

export default function MobileExpenses() {
  const { toast } = useToast();
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const generalInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<MyData>({
    queryKey: ["/api/expenses/me"],
  });

  // Single-receipt upload, keyed to a specific expense row.
  const uploadMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append("receipt", file);
      const r = await fetch(`/api/expenses/${id}/receipt`, { method: "POST", credentials: "include", body: fd });
      if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      toast({ title: "Receipt uploaded" });
      setUploadingFor(null);
    },
    onError: (e: any) => {
      toast({ title: "Upload failed", description: e?.message || "Try again", variant: "destructive" });
      setUploadingFor(null);
    },
  });

  const expenses = data?.expenses || [];
  const pending = expenses.filter((e) => e.status === "pending_receipt");
  const recent = expenses.filter((e) => e.status !== "pending_receipt").slice(0, 20);

  // Per-row capture: invokes the camera (mobile) or file picker (desktop
  // fallback). One hidden input per pending expense — multiple capture
  // flows would otherwise share state and race.
  const snapForExpense = (expense: Expense) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,application/pdf";
    input.setAttribute("capture", "environment");
    input.onchange = (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setUploadingFor(expense.id);
      uploadMutation.mutate({ id: expense.id, file });
    };
    input.click();
  };

  // Bulk import flow — user already has a folder of receipts. Server's
  // /api/expenses/me upload endpoint matches each file to a pending row
  // by amount + date heuristics (same as desktop), so we just need to
  // POST multiple files at once. Skipping for v1; users can add one at
  // a time via the per-row Snap button.

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full pt-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.cardholder) {
    return (
      <div className="p-6 text-center pt-12">
        <Receipt className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
        <h2 className="text-base font-semibold">No card on file</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Ask Finance to issue you a BGP expense card.
        </p>
        <Link href="/my-expenses" className="text-xs text-primary underline mt-3 inline-block">
          Open full expenses on desktop
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-24" data-testid="mobile-expenses">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <Link href="/" className="p-1.5 -ml-1.5 rounded-full active:bg-gray-100">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-lg font-semibold flex-1">Expenses</h1>
        {data.card && (
          <span className="text-[11px] text-muted-foreground">···· {data.card.last4}</span>
        )}
      </div>

      {/* Pending receipts banner — only shows when there's actually work. */}
      {pending.length > 0 && (
        <div className="mx-4 mb-3 rounded-2xl bg-amber-50 border border-amber-200 p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <AlertCircle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-amber-900">
              {pending.length} receipt{pending.length === 1 ? "" : "s"} needed
            </div>
            <div className="text-[11px] text-amber-700">
              Tap the camera on each row below to snap or upload.
            </div>
          </div>
        </div>
      )}

      {/* Pending list — the actionable ones, big cards. */}
      {pending.length > 0 && (
        <section className="px-4 mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Awaiting receipt
          </h2>
          <div className="space-y-2">
            {pending.map((e) => (
              <div
                key={e.id}
                className="rounded-2xl bg-white dark:bg-card border border-border shadow-sm p-3 flex items-center gap-3"
                data-testid={`mobile-expense-pending-${e.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{e.merchant || "Unknown merchant"}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {fmtDate(e.transactionDate)} · {fmtPence(e.amountPence)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => snapForExpense(e)}
                  disabled={uploadingFor === e.id}
                  className="shrink-0 h-11 px-3 rounded-full bg-primary text-primary-foreground flex items-center gap-1.5 text-sm font-medium disabled:opacity-50 active:scale-95 transition-transform"
                  data-testid={`mobile-expense-snap-${e.id}`}
                >
                  {uploadingFor === e.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Camera className="w-4 h-4" />
                  )}
                  {uploadingFor === e.id ? "Uploading…" : "Snap"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent — context, no actions. */}
      <section className="px-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Recent
        </h2>
        {recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center">
            <Receipt className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No expenses yet</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {recent.map((e) => (
              <div
                key={e.id}
                className="rounded-xl bg-white dark:bg-card border border-border/60 p-2.5 flex items-center gap-3"
                data-testid={`mobile-expense-recent-${e.id}`}
              >
                <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[13px] truncate">{e.merchant || "Unknown merchant"}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <span>{fmtDate(e.transactionDate)}</span>
                    <span>·</span>
                    <span className="font-medium">{fmtPence(e.amountPence)}</span>
                  </div>
                </div>
                <StatusBadge status={e.status} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Footer link to full desktop view for power features. */}
      <div className="mt-6 px-4 text-center">
        <Link href="/my-expenses" className="text-[11px] text-primary underline">
          Full expenses (categorise, link to deals)
        </Link>
      </div>

      <input
        ref={generalInputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        aria-hidden="true"
      />
    </div>
  );
}
