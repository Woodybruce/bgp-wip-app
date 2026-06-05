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
  submittedForApprovalAt: string | null;
  flaggedForReview: boolean | null;
  flagReasons: string[] | null;
  attendeeContacts?: { id: string; name: string | null }[];
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

export default function ExpensesApprovals() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<PendingExpense | null>(null);
  const [rejectReason, setRejectReason] = useState("");

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] });
      toast({ title: "Approved" });
    },
    onError: (e: any) => toast({ title: "Approve failed", description: e?.message, variant: "destructive" }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const r = await apiRequest("POST", `/api/expenses/approve-bulk`, { ids });
      return r.json();
    },
    onSuccess: (json: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] });
      setSelected(new Set());
      const approved = json.approved || 0;
      const posted = json.posted || 0;
      toast({
        title: `${approved} approved`,
        description: posted > 0 ? `${posted} posted to Xero` : "Xero posting will retry separately",
      });
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

  if (isLoading) {
    return <div className="container mx-auto p-6"><ExpensesNavTabs /><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  if (rows.length === 0) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <ExpensesNavTabs />
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

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expense Approvals</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} pending · {rows.filter(r => r.flaggedForReview).length} flagged for review
          </p>
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
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

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
    </div>
  );
}

function ExpenseTable({
  rows, selected, onToggle, onApprove, onReject, isApproving, showFlags,
}: {
  rows: PendingExpense[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (r: PendingExpense) => void;
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
                <div className="font-medium">{r.merchant || "—"}</div>
                {r.receiptFilename && (
                  <div className="text-[10px] text-emerald-600 flex items-center gap-0.5 mt-0.5">
                    <Receipt className="w-2.5 h-2.5" /> Receipt
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-right font-mono">{fmt(r.amountPence)}</td>
              <td className="px-3 py-2 text-muted-foreground text-xs">{r.category || <span className="text-amber-600">—</span>}</td>
              <td className="px-3 py-2 text-xs max-w-[280px]">
                {r.businessPurpose && <div className="truncate">{r.businessPurpose}</div>}
                {/* Structured attendees from the CRM picker take precedence
                    over the legacy free-text column (which is filled by
                    Outlook calendar context for inbound WhatsApp receipts). */}
                {(r.attendeeContacts && r.attendeeContacts.length > 0) ? (
                  <div className="text-muted-foreground truncate">
                    w/ {r.attendeeContacts.map(c => c.name).filter(Boolean).join(", ")}
                  </div>
                ) : r.attendees ? (
                  <div className="text-muted-foreground truncate">w/ {r.attendees}</div>
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
