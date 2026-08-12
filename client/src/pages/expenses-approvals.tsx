// Approval inbox. Group submitter is the top-level grouping; within
// each submitter rows split into "Clean" (no flags — bulk-approve
// candidate) and "Needs review" (one or more flag reasons). The point
// of the layout is that Layla / Wendy can approve the unflagged 80%
// in a single click and only spend attention on the flagged rows.
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertCircle, Loader2, X, Receipt, Inbox } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ExpensesNavTabs } from "@/components/expenses-nav-tabs";
import ReceiptViewer from "@/components/receipt-viewer";
import ExpenseEditDialog, { type EditableExpense } from "@/components/expense-edit-dialog";

interface PendingExpense {
  id: string;
  merchant: string | null;
  amountPence: number;
  status: string;
  category: string | null;
  transactionDate: string | null;
  businessPurpose: string | null;
  attendees: string | null;
  receiptFilename: string | null;
  isPersonal: boolean | null;
  submitterUserId: string | null;
  submitterName: string | null;
  cardholderName: string | null;
  approverUserId: string | null;
  approvalStage: number | null;
  submittedForApprovalAt: string | null;
  flaggedForReview: boolean | null;
  flagReasons: string[] | null;
  attendeeContacts?: { id: string; name: string | null }[];
  vatPence?: number | null;
  vatRate?: number | null;
  vatReclaimable?: boolean | null;
  allocatedToUserId?: string | null;
  allocatedToName?: string | null;
  splitCount?: number | null;
}

const fmt = (p: number) => `£${(p / 100).toFixed(2)}`;
const fmtDate = (d: string | null) => d
  ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
  : "—";

// Human-readable labels for each flag reason; keep aligned with the
// FlagReason union in server/expense-approval.ts.
const FLAG_LABELS: Record<string, string> = {
  missing_receipt: "No receipt attached",
  entertainment_no_purpose: "Entertainment — no purpose given",
  entertainment_no_attendees: "Entertainment — no attendees listed",
  high_value_no_purpose: "Over £200 with no purpose",
  possible_duplicate: "Looks like a duplicate of another expense",
  category_not_set: "No category picked",
};

// Purpose / attendees can run long. Show them truncated with a hover tooltip
// (title) and click-to-expand, so approvers can read the whole thing inline
// without opening a dialog — this was Wendy's "can't see the full purpose /
// attendees" issue.
function ExpandableText({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={`${expanded ? "whitespace-pre-wrap break-words" : "truncate"} cursor-pointer ${className || ""}`}
      title={text}
      onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
      data-testid="approvals-expandable-text"
    >
      {text}
    </div>
  );
}

export default function ExpensesApprovals() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<PendingExpense | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const [viewing, setViewing] = useState<PendingExpense | null>(null);
  const [editing, setEditing] = useState<PendingExpense | null>(null);

  const { data: rows = [], isLoading } = useQuery<PendingExpense[]>({
    queryKey: ["/api/expenses/pending-approval"],
  });

  // Group by submitter — that's how Layla and Wendy think about it.
  // Within each submitter, split clean vs flagged so the "approve all
  // clean" button has a clear target.
  const grouped = useMemo(() => {
    const byUser = new Map<string, { name: string; clean: PendingExpense[]; flagged: PendingExpense[] }>();
    for (const r of rows) {
      const key = r.submitterUserId || r.cardholderName || "Unknown";
      const display = r.submitterName || r.cardholderName || "Unknown submitter";
      if (!byUser.has(key)) byUser.set(key, { name: display, clean: [], flagged: [] });
      const bucket = byUser.get(key)!;
      if (r.flaggedForReview) bucket.flagged.push(r);
      else bucket.clean.push(r);
    }
    return Array.from(byUser.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("POST", `/api/expenses/${id}/approve`, {});
      return r.json();
    },
    onSuccess: (json: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] });
      toast(json?.advanced
        ? { title: "Info check done", description: "Passed to a director for spend sign-off." }
        : { title: "Approved", description: "Final sign-off — posting to Xero." });
    },
    onError: (e: any) => toast({ title: "Approve failed", description: e?.message, variant: "destructive" }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const r = await apiRequest("POST", `/api/expenses/approve-bulk`, { ids });
      return r.json();
    },
    onSuccess: (json: any) => {
      setSelected(new Set());
      // The server now responds immediately and works through the batch in
      // the background (each stage-2 approval posts to Xero, which takes
      // seconds per item — a synchronous request 504'd on big batches).
      // Refresh the list on a stagger so rows visibly clear as they process.
      toast({ title: `Approving ${json.queued ?? "the selected"} expenses`, description: "Running in the background — the list clears as each one completes." });
      [3000, 8000, 15000, 30000, 60000, 120000].forEach((ms) =>
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] }), ms));
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] });
    },
    onError: (e: any) => toast({ title: "Bulk approve failed", description: e?.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const r = await apiRequest("POST", `/api/expenses/${id}/reject`, { reason });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] });
      setRejecting(null);
      setRejectReason("");
      toast({ title: "Rejected" });
    },
    onError: (e: any) => toast({ title: "Reject failed", description: e?.message, variant: "destructive" }),
  });

  // Group reject — one shared reason applied to every ticked row.
  const bulkRejectMutation = useMutation({
    mutationFn: async ({ ids, reason }: { ids: string[]; reason: string }) => {
      const r = await apiRequest("POST", `/api/expenses/reject-bulk`, { ids, reason });
      return r.json();
    },
    onSuccess: (json: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] });
      setBulkRejecting(false);
      setRejectReason("");
      setSelected(new Set());
      toast({ title: "Rejected", description: `${json?.rejected || 0} sent back to submitters` });
    },
    onError: (e: any) => toast({ title: "Bulk reject failed", description: e?.message, variant: "destructive" }),
  });

  // Delete a £0.00 junk line outright (auth holds / reversals that aren't real
  // spend). The server only permits this for zero-value rows.
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("DELETE", `/api/expenses/${id}`, undefined);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] });
      toast({ title: "Deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e?.message, variant: "destructive" }),
  });

  const onDelete = (r: PendingExpense) => {
    if (window.confirm(`Delete this £0.00 entry${r.merchant ? ` from ${r.merchant}` : ""}? This removes it for good.`)) {
      deleteMutation.mutate(r.id);
    }
  };

  if (isLoading) {
    return <div className="container mx-auto p-6"><ExpensesNavTabs /><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  if (rows.length === 0) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <ExpensesNavTabs />
        <div className="flex justify-end mb-3">
          <CoverToggle />
        </div>
        <Card>
          <CardContent className="p-8 text-center">
            <Inbox className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Inbox zero</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Nothing waiting for your approval. Expenses submitted by your direct reports show up here, plus the shared
              inbox for anyone without a manager set.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const allIds = rows.map((r) => r.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expense Approvals</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} pending · {rows.filter(r => r.flaggedForReview).length} flagged for review
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CoverToggle />
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none" data-testid="label-select-all">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(v) => setSelected(v ? new Set(allIds) : new Set())}
              data-testid="checkbox-select-all"
            />
            Select all
          </label>
        </div>
      </div>

      {grouped.map((group) => {
        const allClean = group.clean.map(r => r.id);
        const groupSelected = allClean.filter(id => selected.has(id));
        return (
          <Card key={group.key}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{group.name}</CardTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{group.clean.length} clean</span>
                  {group.flagged.length > 0 && <span className="text-amber-600">· {group.flagged.length} flagged</span>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {/* Clean section — bulk approve target */}
              {group.clean.length > 0 && (
                <div>
                  <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-950/20 flex items-center justify-between text-xs">
                    <span className="font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Clean — ready to approve
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => bulkApproveMutation.mutate(allClean)}
                      disabled={bulkApproveMutation.isPending}
                      data-testid={`button-approve-all-${group.key}`}
                    >
                      {bulkApproveMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                      Approve all {group.clean.length}
                    </Button>
                  </div>
                  <ExpenseTable
                    rows={group.clean}
                    selected={selected}
                    onToggle={(id) => {
                      const next = new Set(selected);
                      if (next.has(id)) next.delete(id); else next.add(id);
                      setSelected(next);
                    }}
                    onApprove={(id) => approveMutation.mutate(id)}
                    onReject={(r) => setRejecting(r)}
                    onViewReceipt={(r) => setViewing(r)}
                    onEdit={(r) => setEditing(r)}
                    onDelete={onDelete}
                    isApproving={approveMutation.isPending}
                  />
                </div>
              )}

              {/* Flagged section */}
              {group.flagged.length > 0 && (
                <div>
                  <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/20 text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> Needs review
                  </div>
                  <ExpenseTable
                    rows={group.flagged}
                    selected={selected}
                    onToggle={(id) => {
                      const next = new Set(selected);
                      if (next.has(id)) next.delete(id); else next.add(id);
                      setSelected(next);
                    }}
                    onApprove={(id) => approveMutation.mutate(id)}
                    onReject={(r) => setRejecting(r)}
                    onViewReceipt={(r) => setViewing(r)}
                    onEdit={(r) => setEditing(r)}
                    onDelete={onDelete}
                    isApproving={approveMutation.isPending}
                    showFlags
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {selected.size > 0 && (
        <div className="sticky bottom-4 mx-auto max-w-md bg-background border rounded-lg shadow-lg p-3 flex items-center gap-3">
          <span className="text-sm">{selected.size} selected</span>
          <Button
            size="sm"
            onClick={() => bulkApproveMutation.mutate(Array.from(selected))}
            disabled={bulkApproveMutation.isPending}
            data-testid="button-approve-selected"
          >
            {bulkApproveMutation.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
            Approve selected
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setBulkRejecting(true)}
            disabled={bulkRejectMutation.isPending}
            data-testid="button-reject-selected"
          >
            Reject selected
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      <Dialog open={bulkRejecting} onOpenChange={(v) => { if (!v) { setBulkRejecting(false); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {selected.size} expense{selected.size === 1 ? "" : "s"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              One reason goes to every selected submitter. They'll see it on their card and can fix &amp; resubmit.
            </p>
            <div>
              <Label htmlFor="bulk-reject-reason" className="text-xs">Reason (all submitters see this)</Label>
              <Textarea
                id="bulk-reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Missing business purpose — add who you were with and resubmit"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkRejecting(false); setRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => bulkRejectMutation.mutate({ ids: Array.from(selected), reason: rejectReason })}
              disabled={bulkRejectMutation.isPending || !rejectReason.trim()}
              data-testid="button-confirm-bulk-reject"
            >
              {bulkRejectMutation.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
              Reject {selected.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejecting} onOpenChange={(v) => { if (!v) { setRejecting(null); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject expense</DialogTitle>
          </DialogHeader>
          {rejecting && (
            <div className="space-y-3">
              <div className="text-sm">
                <div><strong>{rejecting.merchant || "—"}</strong> · {fmt(rejecting.amountPence)}</div>
                <div className="text-xs text-muted-foreground">
                  {rejecting.submitterName || rejecting.cardholderName} · {fmtDate(rejecting.transactionDate)}
                </div>
              </div>
              <div>
                <Label htmlFor="reject-reason" className="text-xs">Reason (the submitter sees this)</Label>
                <Textarea
                  id="reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g. Receipt is for personal lunch — please mark personal and resubmit"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejecting(null); setRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => rejecting && rejectMutation.mutate({ id: rejecting.id, reason: rejectReason })}
              disabled={rejectMutation.isPending || !rejectReason.trim()}
            >
              {rejectMutation.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiptViewer
        open={!!viewing}
        onClose={() => setViewing(null)}
        expenseId={viewing?.id ?? null}
        title={viewing ? `${viewing.merchant || "Receipt"} · ${fmt(viewing.amountPence)}` : "Receipt"}
        filename={viewing?.receiptFilename}
      />

      <ExpenseEditDialog
        expense={editing as EditableExpense | null}
        open={!!editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function ExpenseTable({
  rows, selected, onToggle, onApprove, onReject, onViewReceipt, onEdit, onDelete, isApproving, showFlags,
}: {
  rows: PendingExpense[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (r: PendingExpense) => void;
  onViewReceipt: (r: PendingExpense) => void;
  onEdit: (r: PendingExpense) => void;
  onDelete: (r: PendingExpense) => void;
  isApproving: boolean;
  showFlags?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/20">
          <tr className="text-left">
            <th className="px-3 py-2 w-8"></th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Merchant</th>
            <th className="px-3 py-2 font-medium text-right">Amount</th>
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium">Purpose / attendees</th>
            <th className="px-3 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t hover:bg-muted/10">
              <td className="px-3 py-2">
                <Checkbox
                  checked={selected.has(r.id)}
                  onCheckedChange={() => onToggle(r.id)}
                  data-testid={`checkbox-expense-${r.id}`}
                />
              </td>
              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(r.transactionDate)}</td>
              <td className="px-3 py-2">
                <div className="font-medium flex items-center gap-1.5">
                  {r.merchant || "—"}
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${r.approvalStage === 2 ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"}`}>
                    {r.approvalStage === 2 ? "Sign-off" : "Info check"}
                  </span>
                </div>
                {r.receiptFilename ? (
                  <button
                    type="button"
                    onClick={() => onViewReceipt(r)}
                    className="text-[10px] text-emerald-600 hover:text-emerald-700 hover:underline flex items-center gap-0.5 mt-0.5"
                    data-testid={`button-view-receipt-${r.id}`}
                  >
                    <Receipt className="w-2.5 h-2.5" /> View receipt
                  </button>
                ) : (
                  <div className="text-[10px] text-amber-600 flex items-center gap-0.5 mt-0.5">
                    <Receipt className="w-2.5 h-2.5" /> No receipt
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-right font-mono">{fmt(r.amountPence)}</td>
              <td className="px-3 py-2 text-xs">
                <div className="text-muted-foreground">{r.category || <span className="text-amber-600">—</span>}</div>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {r.vatPence != null && (
                    <span className="text-[10px] text-muted-foreground" title="VAT read off the receipt">
                      VAT {fmt(r.vatPence)}{r.vatReclaimable === false ? " (cost)" : ""}
                    </span>
                  )}
                  {r.allocatedToName && (
                    <span className="text-[10px] px-1 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">for {r.allocatedToName}</span>
                  )}
                  {(r.splitCount ?? 0) > 0 && (
                    <span className="text-[10px] px-1 rounded bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">{r.splitCount}-way split</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-xs max-w-[280px]">
                {r.businessPurpose && <ExpandableText text={r.businessPurpose} />}
                {/* Structured attendees from the CRM picker take precedence
                    over the legacy free-text column (which is filled by
                    Outlook calendar context for inbound WhatsApp receipts). */}
                {(r.attendeeContacts && r.attendeeContacts.length > 0) ? (
                  <ExpandableText className="text-muted-foreground" text={`w/ ${r.attendeeContacts.map(c => c.name).filter(Boolean).join(", ")}`} />
                ) : r.attendees ? (
                  <ExpandableText className="text-muted-foreground" text={`w/ ${r.attendees}`} />
                ) : null}
                {!r.businessPurpose && !r.attendees && (!r.attendeeContacts || r.attendeeContacts.length === 0) && <span className="text-muted-foreground">—</span>}
                {showFlags && r.flagReasons && r.flagReasons.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {r.flagReasons.map((reason) => (
                      <Badge key={reason} variant="outline" className="text-[9px] py-0 px-1.5 text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-700">
                        {FLAG_LABELS[reason] || reason}
                      </Badge>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => onEdit(r)}
                  data-testid={`button-edit-${r.id}`}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-emerald-700 dark:text-emerald-400"
                  onClick={() => onApprove(r.id)}
                  disabled={isApproving}
                  data-testid={`button-approve-${r.id}`}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-red-600"
                  onClick={() => onReject(r)}
                  data-testid={`button-reject-${r.id}`}
                >
                  Reject
                </Button>
                {r.amountPence === 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-red-600"
                    onClick={() => onDelete(r)}
                    data-testid={`button-delete-${r.id}`}
                  >
                    Delete
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Wendy's "cry for help": hand the initial pass to Layla while she's away,
// take it back when she returns. Reads/writes the shared cover flag and
// nudges the pending list to refetch so the queue visibly moves.
function CoverToggle() {
  const { toast } = useToast();
  const { data: cover } = useQuery<{ active: boolean }>({
    queryKey: ["/api/expenses/stage1-cover"],
  });
  const active = !!cover?.active;
  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      const r = await apiRequest("POST", "/api/expenses/stage1-cover", { active: next });
      return r.json();
    },
    onSuccess: (json: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/stage1-cover"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] });
      toast({
        title: json?.active ? "Handed to Layla" : "Approvals back with you",
        description: typeof json?.reassigned === "number" && json.reassigned > 0
          ? `${json.reassigned} moved across`
          : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Couldn't switch cover", description: e?.message, variant: "destructive" }),
  });
  return (
    <div className="flex items-center gap-2">
      {active && (
        <Badge variant="outline" className="text-amber-600 border-amber-600/30">Layla is covering</Badge>
      )}
      <Button
        size="sm"
        variant={active ? "default" : "outline"}
        onClick={() => toggle.mutate(!active)}
        disabled={toggle.isPending}
        title={active ? "Take the initial pass back from Layla" : "Hand the initial pass to Layla while you're away"}
        data-testid="button-cry-for-help"
      >
        {toggle.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
        {active ? "Take approvals back" : "Cry for help"}
      </Button>
    </div>
  );
}
